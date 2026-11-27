// ==================== SEGURANÇA FERROVIÁRIA ====================
// Passagens de nível perto de ti (com aviso de voz/vibração ao aproximar),
// avisos oficiais das linhas que segues, reportar um perigo às entidades
// certas e guia de emergência a bordo. Servidor: /api/rail/level-crossings,
// /api/rail/alerts e /api/rail/follow (server.js, "SEGURANÇA FERROVIÁRIA").
// Usa APP, socket, escapeHtml e openSosModal de js/app.js.
(function () {
    const RS = { map: null, layer: null, crossings: [], center: null, watchId: null, alertedAt: {}, wakeLock: null, sources: [], follows: [], reportLocation: null, reportPhoto: null };
    const PROXIMITY_ROAD_M = 300, PROXIMITY_PEDESTRIAN_M = 150, REALERT_MS = 10 * 60 * 1000;
    const PROTECTION_LABEL = { barrier: '🚧 Com cancela', signals: '🚥 Luzes/sino, sem cancela', none: '⚠️ Sem proteção', unknown: '❔ Proteção desconhecida' };
    const OFFICIAL_REPORT_LINKS = [
        { name: 'Infraestruturas de Portugal — contactos', url: 'https://www.infraestruturasdeportugal.pt' },
        { name: 'CP — Comboios de Portugal — contactos', url: 'https://www.cp.pt' },
        { name: 'Adif (Espanha) — contactos', url: 'https://www.adif.es' }
    ];
    const authHeaders = (json) => Object.assign({ 'x-auth-token': APP.token || '' }, json ? { 'Content-Type': 'application/json' } : {});
    function haversine(a, b) {
        const R = 6371000, toRad = (d) => d * Math.PI / 180;
        const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    }
    function getPosition() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) return reject(new Error('Este aparelho não dá acesso à localização.'));
            navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }), () => reject(new Error('Sem acesso à localização. Autoriza a localização para esta app nas definições do telemóvel.')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
        });
    }
    function fmtDist(m) { return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`; }

    // ---------- abrir / tabs ----------
    window.openRailSafetyScreen = function () {
        document.getElementById('railSafetyScreen').classList.add('active');
        switchRailSafetyTab('crossings');
        document.getElementById('rsOfficialLinks').innerHTML = '';
        document.getElementById('rsReportLinks').innerHTML = OFFICIAL_REPORT_LINKS.map(l => `<div><a href="${l.url}" target="_blank" rel="noopener">${escapeHtml(l.name)}</a></div>`).join('');
    };
    window.closeRailSafetyScreen = function () {
        document.getElementById('railSafetyScreen').classList.remove('active');
    };
    window.switchRailSafetyTab = function (tab) {
        document.querySelectorAll('.rs-tab').forEach(b => b.classList.toggle('active', b.dataset.rs === tab));
        const panels = { crossings: 'rsCrossings', alerts: 'rsAlerts', report: 'rsReport', onboard: 'rsOnboard' };
        Object.entries(panels).forEach(([k, id]) => { document.getElementById(id).style.display = k === tab ? 'flex' : 'none'; });
        if (tab === 'crossings' && RS.map) setTimeout(() => RS.map.invalidateSize(), 50);
        if (tab === 'alerts') loadRailAlerts();
    };

    // ---------- 1) passagens de nível ----------
    async function fetchCrossings(center) {
        const radius = Number(document.getElementById('rsRadius').value) || 2000;
        const res = await fetch(`/api/rail/level-crossings?lat=${center.lat}&lon=${center.lon}&radius=${radius}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Não foi possível obter as passagens de nível.');
        RS.crossings = data.crossings || [];
        RS.center = center;
        return data;
    }
    function renderCrossings(center) {
        const status = document.getElementById('rsCrossingsStatus');
        const list = document.getElementById('rsCrossingsList');
        const items = RS.crossings.map(c => ({ ...c, distance: haversine(center, c) })).sort((a, b) => a.distance - b.distance);
        status.textContent = items.length ? `${items.length} passagem(ns) de nível nesta zona · fonte: OpenStreetMap` : 'Não há passagens de nível registadas no OpenStreetMap nesta zona.';
        list.innerHTML = items.slice(0, 40).map(c => `<div class="rs-item">
            <span style="font-size:22px;">${c.kind === 'pedestrian' ? '🚶' : '🚗'}</span>
            <div style="flex:1;min-width:0;"><b>${escapeHtml(c.name || (c.kind === 'pedestrian' ? 'Passagem pedonal' : 'Passagem de nível'))}</b><div class="rs-small">a ${fmtDist(c.distance)}</div></div>
            <span class="rs-badge ${c.protection}">${PROTECTION_LABEL[c.protection]}</span></div>`).join('');
        if (typeof L === 'undefined') { document.getElementById('rsCrossingsMap').style.display = 'none'; return; }
        if (!RS.map) {
            RS.map = L.map('rsCrossingsMap', { zoomControl: true });
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(RS.map);
            RS.layer = L.layerGroup().addTo(RS.map);
        }
        RS.layer.clearLayers();
        L.circleMarker([center.lat, center.lon], { radius: 7, color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 1 }).addTo(RS.layer).bindPopup('Estás aqui');
        const colors = { barrier: '#16a34a', signals: '#d97706', none: '#dc2626', unknown: '#64748b' };
        items.forEach(c => L.circleMarker([c.lat, c.lon], { radius: 6, color: '#fff', weight: 2, fillColor: colors[c.protection], fillOpacity: 1 })
            .addTo(RS.layer).bindPopup(`${c.kind === 'pedestrian' ? '🚶 Pedonal' : '🚗 Estrada'} · ${PROTECTION_LABEL[c.protection]} · ${fmtDist(c.distance)}`));
        RS.map.setView([center.lat, center.lon], 14);
        setTimeout(() => RS.map.invalidateSize(), 50);
    }
    window.loadLevelCrossingsHere = async function () {
        const status = document.getElementById('rsCrossingsStatus');
        status.textContent = 'A obter a tua localização…';
        try {
            const center = await getPosition();
            status.textContent = 'A procurar passagens de nível…';
            await fetchCrossings(center);
            renderCrossings(center);
        } catch (err) { status.textContent = '⚠️ ' + err.message; }
    };

    // Aviso ao aproximar (voz + vibração + faixa vermelha).
    function speak(text) {
        try {
            if (!window.speechSynthesis) return;
            const u = new SpeechSynthesisUtterance(text);
            u.lang = APP.uiLang === 'es' ? 'es-ES' : APP.uiLang === 'en' ? 'en-GB' : 'pt-PT';
            u.rate = 1;
            speechSynthesis.cancel();
            speechSynthesis.speak(u);
        } catch (e) {}
    }
    function checkProximity(pos) {
        const banner = document.getElementById('rsProximityBanner');
        let nearest = null;
        RS.crossings.forEach(c => {
            const d = haversine(pos, c);
            const limit = c.kind === 'pedestrian' ? PROXIMITY_PEDESTRIAN_M : PROXIMITY_ROAD_M;
            if (d <= limit && (!nearest || d < nearest.d)) nearest = { c, d };
        });
        if (!nearest) { banner.style.display = 'none'; return; }
        const label = nearest.c.protection === 'none' ? 'sem cancela nem sinais' : nearest.c.protection === 'signals' ? 'sem cancela' : '';
        banner.textContent = `🚦 Passagem de nível a ${fmtDist(nearest.d)}${label ? ' — ' + label : ''}. Abranda, olha e escuta.`;
        banner.style.display = 'block';
        const last = RS.alertedAt[nearest.c.id] || 0;
        if (Date.now() - last > REALERT_MS) {
            RS.alertedAt[nearest.c.id] = Date.now();
            speak(`Atenção: passagem de nível a ${Math.round(nearest.d / 10) * 10} metros${label ? ', ' + label : ''}. Abranda e confirma que não vem comboio.`);
            if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
        }
    }
    async function onPosition(pos) {
        // Volta a pedir as passagens se te afastaste mais de 1 km do último centro.
        if (!RS.center || haversine(pos, RS.center) > 1000) {
            try { await fetchCrossings(pos); renderCrossings(pos); } catch (e) { document.getElementById('rsCrossingsStatus').textContent = '⚠️ ' + e.message; }
        }
        checkProximity(pos);
    }
    window.toggleCrossingProximity = async function (on) {
        const status = document.getElementById('rsCrossingsStatus');
        if (!on) {
            if (RS.watchId != null) navigator.geolocation.clearWatch(RS.watchId);
            RS.watchId = null;
            document.getElementById('rsProximityBanner').style.display = 'none';
            if (RS.wakeLock) { RS.wakeLock.release().catch(() => {}); RS.wakeLock = null; }
            status.textContent = 'Avisos de aproximação desligados.';
            return;
        }
        if (!navigator.geolocation) { status.textContent = '⚠️ Este aparelho não dá acesso à localização.'; document.getElementById('rsProximityToggle').checked = false; return; }
        speak(''); // no iPhone, a voz só funciona depois de um toque: "desbloqueia-a" já aqui
        try { if (navigator.wakeLock) RS.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
        status.textContent = '🔔 Avisos de aproximação ligados. Mantém a app aberta.';
        RS.watchId = navigator.geolocation.watchPosition(
            (p) => onPosition({ lat: p.coords.latitude, lon: p.coords.longitude }),
            () => { status.textContent = '⚠️ Sem acesso à localização.'; document.getElementById('rsProximityToggle').checked = false; },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
        );
    };

    // ---------- 2) avisos das linhas ----------
    async function loadRailAlerts() {
        const status = document.getElementById('rsAlertsStatus');
        status.textContent = 'A carregar os avisos…';
        try {
            const res = await fetch('/api/rail/alerts', { headers: authHeaders() });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Não foi possível carregar os avisos.');
            RS.sources = data.sources || []; RS.follows = data.follows || [];
            document.getElementById('rsAlertSources').innerHTML = RS.sources.map(src => {
                const f = RS.follows.find(x => x.source === src.id);
                return `<div class="rs-source" data-source="${escapeHtml(src.id)}">
                    <label style="display:flex;gap:8px;align-items:center;font-weight:600;color:var(--text-primary);"><input type="checkbox" class="rs-follow-check" ${f ? 'checked' : ''}> ${escapeHtml(src.name)}</label>
                    <input type="text" class="rs-follow-filter" maxlength="40" placeholder="Só a linha… (ex.: C-5, Rodalies R2). Vazio = todas" value="${escapeHtml(f?.filter || '')}">
                    ${src.error ? `<span class="rs-small">⚠️ Fonte indisponível agora (${escapeHtml(src.error)}).</span>` : ''}
                </div>`;
            }).join('');
            document.getElementById('rsOfficialLinks').innerHTML = (data.officialLinks || []).map(l => `<div><a href="${l.url}" target="_blank" rel="noopener">${escapeHtml(l.name)}</a></div>`).join('');
            const list = document.getElementById('rsAlertsList');
            list.innerHTML = (data.alerts || []).map(a => `<div class="rs-alert"><b>🚆 ${escapeHtml(a.title)}</b>${a.description ? `<div class="rs-small">${escapeHtml(a.description)}</div>` : ''}<div class="rs-small">${escapeHtml(a.sourceName)}${a.routes.length ? ' · ' + escapeHtml(a.routes.join(', ')) : ''}</div></div>`).join('');
            status.textContent = !RS.follows.length ? 'Ainda não segues nenhuma linha.' : (data.alerts.length ? `${data.alerts.length} aviso(s) ativo(s) nas tuas linhas.` : '✅ Sem avisos ativos nas tuas linhas.');
        } catch (err) { status.textContent = '⚠️ ' + err.message; }
    }
    window.loadRailAlerts = loadRailAlerts;
    window.saveRailFollows = async function () {
        const follows = [...document.querySelectorAll('#rsAlertSources .rs-source')].filter(el => el.querySelector('.rs-follow-check').checked)
            .map(el => ({ source: el.dataset.source, filter: el.querySelector('.rs-follow-filter').value }));
        const status = document.getElementById('rsAlertsStatus');
        try {
            const res = await fetch('/api/rail/follow', { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ follows }) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Não foi possível guardar.');
            status.textContent = '✅ Guardado. Vais receber os avisos destas linhas.';
            try { if (typeof initPushNotifications === 'function') initPushNotifications(); } catch (e) {} // pede para ativar as notificações, se ainda não estiverem
            loadRailAlerts();
        } catch (err) { status.textContent = '⚠️ ' + err.message; }
    };
    socket.on('rail_alert', (a) => {
        const text = `🚆 ${a.sourceName}: ${a.title}`;
        if (document.getElementById('railSafetyScreen').classList.contains('active')) loadRailAlerts();
        const toast = document.createElement('div');
        toast.className = 'rs-toast';
        toast.textContent = text;
        toast.onclick = () => { toast.remove(); openRailSafetyScreen(); switchRailSafetyTab('alerts'); };
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 12000);
    });

    // ---------- 3) reportar perigo ----------
    window.attachReportLocation = async function () {
        const box = document.getElementById('rsReportLocation');
        box.textContent = 'A obter a localização…';
        try {
            RS.reportLocation = await getPosition();
            const { lat, lon } = RS.reportLocation;
            box.innerHTML = `📍 ${lat.toFixed(5)}, ${lon.toFixed(5)} · <a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank" rel="noopener">ver no mapa</a>`;
        } catch (err) { box.textContent = '⚠️ ' + err.message; }
    };
    window.onReportPhoto = function (input) {
        RS.reportPhoto = input.files && input.files[0] || null;
        document.getElementById('rsReportPhotoInfo').textContent = RS.reportPhoto ? `📷 Foto junta (${Math.round(RS.reportPhoto.size / 1024)} KB)` : '';
    };
    function reportText() {
        const type = document.getElementById('rsReportType').value;
        const desc = document.getElementById('rsReportText').value.trim();
        const loc = RS.reportLocation;
        const when = new Date().toLocaleString('pt-PT');
        return `⚠️ Reporte de perigo na linha ferroviária\nTipo: ${type}\n${desc ? 'Descrição: ' + desc + '\n' : ''}Quando: ${when}\n` +
            (loc ? `Localização: ${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)} — https://www.google.com/maps?q=${loc.lat},${loc.lon}\n` : '') + '(enviado pela app NADIO)';
    }
    window.shareRailReport = async function () {
        const status = document.getElementById('rsReportStatus');
        if (!RS.reportLocation) status.textContent = 'Dica: junta a tua localização para quem recebe saber onde é.';
        const text = reportText();
        try {
            const data = { title: 'Perigo na linha ferroviária', text };
            if (RS.reportPhoto && navigator.canShare && navigator.canShare({ files: [RS.reportPhoto] })) data.files = [RS.reportPhoto];
            if (navigator.share) { await navigator.share(data); status.textContent = '✅ Reporte partilhado.'; return; }
        } catch (err) { if (err && err.name === 'AbortError') return; }
        try { await navigator.clipboard.writeText(text); status.textContent = '📋 Reporte copiado — cola-o na mensagem ou no formulário de contacto oficial.'; }
        catch (e) { prompt('Copia o reporte:', text); }
    };
    window.railReportText = reportText; // para os testes
})();

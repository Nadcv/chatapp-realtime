// ==================== ATUALIZAÇÕES SEM PERDER DADOS ====================
// 1) Deteta quando o servidor tem uma versão nova da app (GET /api/version):
//    ao abrir, de 5 em 5 minutos, quando a app volta a ficar visível e quando a
//    ligação ao servidor volta (num deploy, o servidor reinicia e o socket
//    volta a ligar). Mostra "Há uma versão nova" com o botão "Atualizar agora"
//    — nunca recarrega sozinha a meio de uma conversa ou de uma chamada.
// 2) Rascunhos: o que estiveres a escrever numa conversa ou no feed fica
//    guardado neste aparelho e volta a aparecer depois de atualizar (ou de a
//    app fechar sem querer). A sessão, as mensagens por enviar (fila offline)
//    e as preferências já ficam no localStorage e não se perdem ao recarregar;
//    contas, mensagens, grupos e feed estão no servidor (MongoDB).
// 3) Ao atualizar, o service worker novo toma conta logo e apaga a cache antiga,
//    para não ficar meia app antiga e meia nova.
(function () {
    const CHECK_EVERY_MS = 5 * 60 * 1000;
    let loadedVersion = null, newVersion = null, checking = false;
    const DRAFT_PREFIX = 'draft:';

    async function fetchVersion() {
        const r = await fetch('/api/version', { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return (await r.json()).version;
    }
    async function checkForUpdate() {
        if (checking) return;
        checking = true;
        try {
            const v = await fetchVersion();
            if (!loadedVersion) loadedVersion = v;
            else if (v !== loadedVersion && v !== newVersion) { newVersion = v; showUpdateBanner(); }
        } catch (e) { /* sem rede ou servidor a reiniciar: tenta na próxima */ }
        checking = false;
    }
    window.checkForAppUpdate = checkForUpdate;

    function showUpdateBanner() {
        if (document.getElementById('appUpdateBanner')) return;
        const el = document.createElement('div');
        el.id = 'appUpdateBanner';
        el.className = 'app-update-banner';
        el.innerHTML = '<span>✨ Há uma versão nova da NADIO.</span><button type="button" id="appUpdateBtn">Atualizar agora</button><button type="button" class="app-update-later" aria-label="Mais tarde">✕</button>';
        el.querySelector('#appUpdateBtn').onclick = applyUpdate;
        el.querySelector('.app-update-later').onclick = () => el.remove();
        document.body.appendChild(el);
    }

    // ---------- rascunhos ----------
    function currentChatId() { try { return APP.currentChatId || null; } catch (e) { return null; } }
    function saveDraft(key, value) {
        try { if (value && value.trim()) localStorage.setItem(DRAFT_PREFIX + key, value); else localStorage.removeItem(DRAFT_PREFIX + key); } catch (e) {}
    }
    function saveAllDrafts() {
        const input = document.getElementById('messageInput');
        const chatId = currentChatId();
        if (input && chatId) saveDraft('chat:' + chatId, input.value);
        const feed = document.getElementById('feedText');
        if (feed) saveDraft('feed', feed.value);
    }
    window.saveAllDrafts = saveAllDrafts;
    function restoreChatDraft() {
        const input = document.getElementById('messageInput');
        const chatId = currentChatId();
        if (!input || !chatId) return;
        let d = null;
        try { d = localStorage.getItem(DRAFT_PREFIX + 'chat:' + chatId); } catch (e) {}
        if (d && !input.value) input.value = d;
    }
    function restoreFeedDraft() {
        const feed = document.getElementById('feedText');
        let d = null;
        try { d = localStorage.getItem(DRAFT_PREFIX + 'feed'); } catch (e) {}
        if (feed && d && !feed.value) feed.value = d;
    }
    // Guarda enquanto se escreve (também protege se a app fechar sem querer).
    let draftTimer = null;
    document.addEventListener('input', (ev) => {
        if (ev.target && (ev.target.id === 'messageInput' || ev.target.id === 'feedText')) {
            clearTimeout(draftTimer);
            draftTimer = setTimeout(saveAllDrafts, 400);
        }
    });
    window.addEventListener('pagehide', saveAllDrafts);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveAllDrafts(); });
    // Ao abrir uma conversa ou o feed, repõe o rascunho; ao enviar, apaga-o.
    if (typeof window.openChat === 'function') {
        const originalOpenChat = window.openChat;
        window.openChat = function () {
            const prev = currentChatId();
            const input = document.getElementById('messageInput');
            if (prev && input) saveDraft('chat:' + prev, input.value);
            const result = originalOpenChat.apply(this, arguments);
            if (input) input.value = '';
            restoreChatDraft();
            return result;
        };
    }
    if (typeof window.sendMessage === 'function') {
        const originalSend = window.sendMessage;
        window.sendMessage = function () {
            const chatId = currentChatId();
            const result = originalSend.apply(this, arguments);
            const input = document.getElementById('messageInput');
            if (chatId && input && !input.value.trim()) saveDraft('chat:' + chatId, '');
            return result;
        };
    }
    if (typeof window.openFeedScreen === 'function') {
        const originalOpenFeed = window.openFeedScreen;
        window.openFeedScreen = function () { const r = originalOpenFeed.apply(this, arguments); restoreFeedDraft(); return r; };
    }
    if (typeof window.publishFeedPost === 'function') {
        const originalPublish = window.publishFeedPost;
        window.publishFeedPost = async function () {
            const r = await originalPublish.apply(this, arguments);
            const feed = document.getElementById('feedText');
            if (feed && !feed.value.trim()) saveDraft('feed', '');
            return r;
        };
    }

    // ---------- aplicar a atualização ----------
    async function applyUpdate() {
        let inCall = false;
        try { inCall = !!APP.callActive; } catch (e) {}
        if (inCall && !confirm('Estás numa chamada. Atualizar agora termina a chamada. Continuar?')) return;
        const btn = document.getElementById('appUpdateBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'A atualizar…'; }
        saveAllDrafts();
        try {
            if ('serviceWorker' in navigator) {
                const reg = await navigator.serviceWorker.getRegistration();
                if (reg) {
                    await reg.update().catch(() => {});
                    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                }
            }
            // Apaga as caches da app (são só cópias dos ficheiros — os dados não estão lá).
            if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.filter(k => k.startsWith('chatapp-shell')).map(k => caches.delete(k))); }
        } catch (e) {}
        location.reload();
    }
    window.applyAppUpdate = applyUpdate;

    // ---------- quando verificar ----------
    checkForUpdate();
    setInterval(checkForUpdate, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
    try { socket.on('connect', () => setTimeout(checkForUpdate, 1500)); } catch (e) {}
    // Se a app abrir já com uma conversa ativa (raro), repõe o rascunho.
    setTimeout(restoreChatDraft, 1500);
})();

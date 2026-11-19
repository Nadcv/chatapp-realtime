// ==================== FEED (publicações dos contactos) ====================
// Ecrã de rolar com as publicações (texto, foto, vídeo) da própria pessoa e dos
// contactos, com gostos/reações e comentários. Servidor: /api/feed* (server.js,
// secção "FEED"). Fotos e vídeos vão primeiro para o Cloudinary (/api/upload)
// e a publicação guarda só o link. Usa o APP, socket, escapeHtml, timeAgo e
// closeModal de js/app.js (scripts clássicos, partilham o âmbito global).
(function () {
    const FEED = { posts: [], loading: false, hasMore: true, reactions: ['❤️', '😂', '😮', '😢', '🔥', '👏'], media: null, mediaUploads: true, commentsPostId: null, observer: null, videoObserver: null };
    const icon = (name, size) => (window.uiIcon ? window.uiIcon(name, size) : '');
    const authHeaders = (json) => Object.assign({ 'x-auth-token': APP.token || '' }, json ? { 'Content-Type': 'application/json' } : {});
    async function api(url, opts = {}) {
        const res = await fetch(url, opts);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Não foi possível ligar ao servidor.');
        return data;
    }
    function avatarHtml(a) {
        return `<div class="feed-avatar">${a.avatarUrl ? `<img src="${escapeHtml(a.avatarUrl)}" alt="">` : escapeHtml((a.name || '?').charAt(0).toUpperCase())}</div>`;
    }

    // ---------- abrir / fechar ----------
    window.openFeedScreen = function () {
        document.getElementById('feedScreen').classList.add('active');
        const badge = document.getElementById('feedBadge'); if (badge) badge.style.display = 'none';
        const attachIcon = document.querySelector('#feedAttachLabel .feed-attach-icon');
        if (attachIcon && window.uiIcon && !attachIcon.dataset.done) { attachIcon.innerHTML = icon('image', 18); attachIcon.dataset.done = '1'; }
        refreshFeed();
        setupInfiniteScroll();
    };
    window.closeFeedScreen = function () {
        document.getElementById('feedScreen').classList.remove('active');
        document.querySelectorAll('#feedList video').forEach(v => v.pause());
    };
    window.refreshFeed = function () {
        FEED.posts = []; FEED.hasMore = true;
        document.getElementById('feedList').innerHTML = '';
        document.getElementById('feedNewPill').style.display = 'none';
        document.getElementById('feedScroll').scrollTop = 0;
        loadMoreFeed();
    };

    // ---------- carregar (rolar infinito) ----------
    async function loadMoreFeed() {
        if (FEED.loading || !FEED.hasMore) return;
        FEED.loading = true;
        const sentinel = document.getElementById('feedSentinel');
        sentinel.textContent = 'A carregar…';
        try {
            const last = FEED.posts[FEED.posts.length - 1];
            const data = await api('/api/feed?limit=8' + (last ? '&before=' + encodeURIComponent(last.createdAt) : ''), { headers: authHeaders() });
            FEED.reactions = data.reactions || FEED.reactions;
            FEED.mediaUploads = data.mediaUploads !== false;
            FEED.hasMore = !!data.hasMore;
            data.posts.forEach(p => { FEED.posts.push(p); document.getElementById('feedList').insertAdjacentHTML('beforeend', postHtml(p)); });
            observeVideos();
            if (!FEED.posts.length) document.getElementById('feedList').innerHTML = '<div class="feed-empty">Ainda não há publicações.<br>Publica a primeira, ou adiciona contactos para veres o que eles partilham. 💜</div>';
            sentinel.textContent = FEED.hasMore ? '' : (FEED.posts.length ? 'Não há mais publicações' : '');
        } catch (err) {
            sentinel.textContent = '⚠️ ' + err.message;
        }
        FEED.loading = false;
    }
    function setupInfiniteScroll() {
        if (FEED.observer) return;
        FEED.observer = new IntersectionObserver((entries) => { if (entries.some(e => e.isIntersecting)) loadMoreFeed(); }, { root: document.getElementById('feedScroll'), rootMargin: '300px' });
        FEED.observer.observe(document.getElementById('feedSentinel'));
    }
    // Vídeos tocam sozinhos (sem som) quando estão no ecrã e param quando saem.
    function observeVideos() {
        if (!FEED.videoObserver) {
            FEED.videoObserver = new IntersectionObserver((entries) => {
                entries.forEach(e => { if (e.isIntersecting && e.intersectionRatio >= 0.6) e.target.play().catch(() => {}); else e.target.pause(); });
            }, { root: document.getElementById('feedScroll'), threshold: [0, 0.6] });
        }
        document.querySelectorAll('#feedList video:not([data-observed])').forEach(v => { v.dataset.observed = '1'; FEED.videoObserver.observe(v); });
    }

    // ---------- desenhar uma publicação ----------
    function summaryHtml(p) {
        const total = Object.values(p.reactions || {}).reduce((a, b) => a + b, 0);
        const emojis = Object.entries(p.reactions || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e]) => e).join('');
        const left = total ? `<span title="${escapeHtml(Object.entries(p.reactions).map(([e, n]) => e + ' ' + n).join('  '))}">${emojis} ${total}</span>` : '<span></span>';
        const right = p.commentCount ? `<span class="feed-comment-count" onclick="openFeedComments('${p.id}')" style="cursor:pointer;">${p.commentCount} comentário${p.commentCount === 1 ? '' : 's'}</span>` : '';
        return left + right;
    }
    function postHtml(p) {
        const media = !p.media ? '' : p.media.type === 'video'
            ? `<div class="feed-media"><video src="${escapeHtml(p.media.url)}" playsinline muted loop controls preload="metadata"></video></div>`
            : `<div class="feed-media"><img src="${escapeHtml(p.media.url)}" loading="lazy" alt=""></div>`;
        const reacted = p.myReaction;
        return `<div class="feed-card" id="post_${p.id}" data-post-id="${p.id}">
            <div class="feed-card-head">${avatarHtml(p.author)}
                <div class="feed-author"><b>${escapeHtml(p.author.name)}</b><span>${escapeHtml(timeAgo(p.createdAt))}</span></div>
                <button class="feed-menu-btn" onclick="feedPostMenu('${p.id}')" aria-label="Opções">${icon('more', 20) || '⋯'}</button>
            </div>
            ${p.text ? `<div class="feed-text">${escapeHtml(p.text)}</div>` : ''}
            ${media}
            <div class="feed-summary">${summaryHtml(p)}</div>
            <div class="feed-actions">
                <button class="feed-like${reacted ? ' reacted' : ''}" onclick="toggleFeedLike('${p.id}')" oncontextmenu="event.preventDefault();showFeedReactions('${p.id}')">
                    ${reacted && reacted !== '❤️' ? `<span style="font-size:18px;">${reacted}</span>` : icon('heart', 19)}<span>${reacted ? 'Gostei' : 'Gosto'}</span></button>
                <button class="feed-react-btn" onclick="showFeedReactions('${p.id}')" aria-label="Reagir">${icon('smile', 19)}<span>Reagir</span></button>
                <button class="feed-comment-btn" onclick="openFeedComments('${p.id}')">${icon('comment', 19)}<span>Comentar</span></button>
            </div>
        </div>`;
    }
    function rerenderPost(p) {
        const i = FEED.posts.findIndex(x => x.id === p.id);
        if (i >= 0) FEED.posts[i] = p;
        const el = document.getElementById('post_' + p.id);
        if (!el) return;
        const video = el.querySelector('video');
        const wasPlaying = video && !video.paused;
        // Só atualiza o resumo e os botões (não recarrega a foto/vídeo).
        const tmp = document.createElement('div'); tmp.innerHTML = postHtml(p);
        el.querySelector('.feed-summary').replaceWith(tmp.querySelector('.feed-summary'));
        el.querySelector('.feed-actions').replaceWith(tmp.querySelector('.feed-actions'));
        if (wasPlaying) video.play().catch(() => {});
    }

    // ---------- gostos e reações ----------
    async function react(postId, emoji) {
        try {
            const data = await api(`/api/feed/${postId}/react`, { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ emoji }) });
            rerenderPost(data.post);
        } catch (err) { alert('⚠️ ' + err.message); }
    }
    window.toggleFeedLike = function (postId) {
        const p = FEED.posts.find(x => x.id === postId);
        react(postId, p && p.myReaction ? null : '❤️');
    };
    window.showFeedReactions = function (postId) {
        document.querySelectorAll('.feed-reaction-picker').forEach(x => x.remove());
        const actions = document.querySelector(`#post_${postId} .feed-actions`);
        if (!actions) return;
        const picker = document.createElement('div');
        picker.className = 'feed-reaction-picker';
        picker.innerHTML = FEED.reactions.map(e => `<button data-emoji="${e}" aria-label="${e}">${e}</button>`).join('');
        picker.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; picker.remove(); react(postId, b.dataset.emoji); });
        actions.appendChild(picker);
        setTimeout(() => document.addEventListener('click', function close(ev) { if (!picker.contains(ev.target)) { picker.remove(); document.removeEventListener('click', close); } }), 0);
    };

    // ---------- publicar ----------
    window.onFeedFileChosen = function (input) {
        const file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        const status = document.getElementById('feedComposerStatus');
        if (!FEED.mediaUploads) { status.textContent = '⚠️ Fotos e vídeos precisam do Cloudinary configurado no servidor.'; return; }
        const isVideo = file.type.startsWith('video/');
        if (isVideo && file.size > 14 * 1024 * 1024) { status.textContent = '⚠️ Vídeo demasiado grande (máx. 14 MB).'; return; }
        const reader = new FileReader();
        reader.onload = () => {
            if (isVideo) { setFeedMedia({ dataUrl: reader.result, type: 'video' }); return; }
            // Fotos: reduz para no máximo 1600 px (mais rápido a enviar e a ver).
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
                const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                setFeedMedia({ dataUrl: c.toDataURL('image/jpeg', 0.85), type: 'image' });
            };
            img.onerror = () => { status.textContent = '⚠️ Não foi possível ler esta imagem.'; };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    };
    function setFeedMedia(m) {
        FEED.media = m;
        const box = document.getElementById('feedMediaPreview');
        if (!m) { box.style.display = 'none'; box.innerHTML = ''; return; }
        box.innerHTML = (m.type === 'video' ? `<video src="${m.dataUrl}" muted playsinline controls></video>` : `<img src="${m.dataUrl}" alt="">`) + '<button onclick="clearFeedMedia()" aria-label="Remover">✕</button>';
        box.style.display = 'block';
        document.getElementById('feedComposerStatus').textContent = '';
    }
    window.clearFeedMedia = () => setFeedMedia(null);
    window.publishFeedPost = async function () {
        const textEl = document.getElementById('feedText');
        const text = textEl.value.trim();
        const status = document.getElementById('feedComposerStatus');
        const btn = document.getElementById('feedPublishBtn');
        if (!text && !FEED.media) { status.textContent = 'Escreve alguma coisa ou junta uma foto/vídeo.'; return; }
        btn.disabled = true;
        try {
            let mediaUrl = null, mediaType = null;
            if (FEED.media) {
                status.textContent = FEED.media.type === 'video' ? 'A enviar o vídeo…' : 'A enviar a foto…';
                const up = await api('/api/upload', { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ fileData: FEED.media.dataUrl }) });
                if (!up.success || !up.url) throw new Error('Fotos e vídeos precisam do Cloudinary configurado no servidor.');
                mediaUrl = up.url; mediaType = FEED.media.type;
            }
            status.textContent = 'A partilhar…';
            const data = await api('/api/feed', { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ text, mediaUrl, mediaType }) });
            textEl.value = ''; setFeedMedia(null); status.textContent = '';
            const list = document.getElementById('feedList');
            if (list.querySelector('.feed-empty')) list.innerHTML = '';
            FEED.posts.unshift(data.post);
            list.insertAdjacentHTML('afterbegin', postHtml(data.post));
            observeVideos();
        } catch (err) {
            status.textContent = '⚠️ ' + err.message;
        }
        btn.disabled = false;
    };

    // ---------- menu da publicação: apagar / denunciar ----------
    window.feedPostMenu = async function (postId) {
        const p = FEED.posts.find(x => x.id === postId);
        if (!p) return;
        if (p.mine || APP.user?.isAdmin) {
            if (!confirm(p.mine ? 'Apagar esta publicação?' : 'Apagar esta publicação (administrador)?')) return;
            try {
                await api('/api/feed/' + postId, { method: 'DELETE', headers: authHeaders() });
                FEED.posts = FEED.posts.filter(x => x.id !== postId);
                document.getElementById('post_' + postId)?.remove();
            } catch (err) { alert('⚠️ ' + err.message); }
            return;
        }
        const reason = prompt(`Denunciar a publicação de ${p.author.name}? Diz-nos porquê (o administrador vai ver):`);
        if (reason === null) return;
        try {
            await api(`/api/feed/${postId}/report`, { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ reason }) });
            alert('Obrigado — a denúncia foi enviada ao administrador.');
        } catch (err) { alert('⚠️ ' + err.message); }
    };

    // ---------- comentários ----------
    window.openFeedComments = async function (postId) {
        FEED.commentsPostId = postId;
        const list = document.getElementById('feedCommentsList');
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;">A carregar…</p>';
        document.getElementById('modalFeedComments').classList.add('active');
        try {
            const data = await api(`/api/feed/${postId}/comments`, { headers: authHeaders() });
            renderComments(data.comments);
        } catch (err) { list.innerHTML = `<p style="color:var(--text-secondary);text-align:center;">⚠️ ${escapeHtml(err.message)}</p>`; }
        setTimeout(() => document.getElementById('feedCommentInput').focus(), 150);
    };
    function commentHtml(c) {
        return `<div class="feed-comment" data-comment-id="${c.id}">${avatarHtml(c.author)}<div class="feed-comment-bubble"><b>${escapeHtml(c.author.name)}</b> <small>${escapeHtml(timeAgo(c.createdAt))}</small><p>${escapeHtml(c.text)}</p></div></div>`;
    }
    function renderComments(comments) {
        const list = document.getElementById('feedCommentsList');
        list.innerHTML = comments.length ? comments.map(commentHtml).join('') : '<p class="feed-no-comments" style="color:var(--text-secondary);text-align:center;">Ainda sem comentários. Sê o primeiro!</p>';
        list.scrollTop = list.scrollHeight;
    }
    window.sendFeedComment = async function () {
        const input = document.getElementById('feedCommentInput');
        const text = input.value.trim();
        const postId = FEED.commentsPostId;
        if (!text || !postId) return;
        input.value = '';
        try {
            const data = await api(`/api/feed/${postId}/comments`, { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ text }) });
            const list = document.getElementById('feedCommentsList');
            list.querySelector('.feed-no-comments')?.remove();
            list.insertAdjacentHTML('beforeend', commentHtml(data.comment));
            list.scrollTop = list.scrollHeight;
            const p = FEED.posts.find(x => x.id === postId);
            if (p) { p.commentCount = data.commentCount; rerenderPost(p); }
        } catch (err) { input.value = text; alert('⚠️ ' + err.message); }
    };

    // ---------- tempo real ----------
    socket.on('feed_new_post', () => {
        const open = document.getElementById('feedScreen').classList.contains('active');
        if (open) document.getElementById('feedNewPill').style.display = 'block';
        else { const b = document.getElementById('feedBadge'); if (b) b.style.display = 'block'; }
    });
    socket.on('feed_new_comment', (d) => {
        const b = document.getElementById('feedBadge');
        if (b && !document.getElementById('feedScreen').classList.contains('active')) b.style.display = 'block';
    });
})();

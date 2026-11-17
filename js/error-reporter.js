// Aviso de erros: envia os erros de JavaScript deste aparelho ao servidor.
    // ==================== AVISO DE ERROS (envia para o servidor) ====================
    // Erros de JavaScript neste aparelho são enviados ao servidor (/api/client-error),
    // para o administrador os ver nos logs e no aviso por email. No máximo 10 por
    // visita e sem repetir o mesmo erro, para não gastar dados.
    (function () {
        const sent = new Set();
        let count = 0;
        function report(message, source, line, column, stack) {
            try {
                const key = message + '|' + source + '|' + line;
                if (count >= 10 || sent.has(key)) return;
                sent.add(key); count++;
                let token = '';
                try { token = localStorage.getItem('authToken') || ''; } catch (e) {}
                fetch('/api/client-error', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                    body: JSON.stringify({ message: String(message || ''), source: String(source || ''), line, column, stack: stack ? String(stack) : '' }),
                    keepalive: true
                }).catch(() => {});
            } catch (e) { /* nunca deixar o próprio aviso partir a app */ }
        }
        window.addEventListener('error', (ev) => {
            if (!ev.message) return; // erros a carregar imagens/scripts externos não têm mensagem
            report(ev.message, ev.filename, ev.lineno, ev.colno, ev.error && ev.error.stack);
        });
        window.addEventListener('unhandledrejection', (ev) => {
            const r = ev.reason;
            report('Promise rejeitada: ' + (r && r.message ? r.message : String(r)), location.pathname, 0, 0, r && r.stack);
        });
    })();

// Código da app NADIO (antes dentro do index.html). Script clássico, carregado no fim do <body>.
    const socket = io();
    let peerConnection = null;
    let pendingIceCandidates = []; // candidatos ICE (1-para-1) chegados antes de existir peerConnection/remoteDescription
    let incomingCallData = null; // dados da chamada 1-para-1 a chegar, à espera de Aceitar/Recusar
    let callPeerPhone = null; // telefone da outra pessoa na chamada 1-para-1 atual (entrega direta, não depende de sala)
    let callRingTimeout = null; // timeout de "sem resposta" para chamadas 1-para-1 a sair
    // STUN resolve a maioria dos casos na mesma rede. TURN (OpenRelay, gratuito para testes)
    // é necessário quando os dois lados estão atrás de NAT/roteadores restritivos —
    // ele retransmite a mídia quando a conexão direta P2P não é possível.
    // Para produção séria, troque pelo seu próprio servidor TURN (ex: coturn ou metered.ca pago).
    const ICE_SERVERS_FALLBACK = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:openrelay.metered.ca:80' },
            { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
        ]
    };
    let cachedIceServers = null;
    let cachedIceServersAt = 0;
    // Busca servidores TURN/STUN atualizados no servidor (ver /api/turn-credentials).
    // Guardados em cache por 20 minutos para não pedir de novo a cada chamada.
    async function getIceServers() {
        if (cachedIceServers && (Date.now() - cachedIceServersAt) < 20 * 60 * 1000) return cachedIceServers;
        // O servidor só dá o TURN dedicado a quem tem sessão iniciada; antes do
        // login recebe o TURN público e não fica em cache, para voltar a pedir
        // depois de entrar.
        let sessionToken = '';
        try { sessionToken = APP.token || ''; } catch (e) { /* APP ainda não existe */ }
        let servers;
        try {
            const r = await fetch('/api/turn-credentials', { headers: sessionToken ? { 'x-auth-token': sessionToken } : {} });
            const data = await r.json();
            servers = (data && data.iceServers && data.iceServers.length) ? data : ICE_SERVERS_FALLBACK;
        } catch (e) {
            servers = ICE_SERVERS_FALLBACK;
        }
        if (sessionToken) { cachedIceServers = servers; cachedIceServersAt = Date.now(); }
        return servers;
    }
    // Já começa a pedir assim que o script carrega, para estar pronto quando a
    // primeira chamada acontecer (sem atrasar o "Chamando...").
    getIceServers();

    // ==================== INTERFACE EM VÁRIOS IDIOMAS (PT/EN/ES) ====================
    // Isto muda os BOTÕES E MENUS da aplicação — é diferente de "preferredLang"
    // (esse só traduz as MENSAGENS recebidas, ver autoTranslateIfNeeded mais abaixo).
    // É uma preferência só deste aparelho (guardada no localStorage, tal como
    // 'translatorLang'), não uma definição da conta sincronizada entre dispositivos.
    //
    // Cobertura DELIBERADAMENTE reduzida (ver README, secção "Interface em vários
    // idiomas — o que está coberto"): o ecrã de login/registo, o modal de perfil,
    // os menus em grelha de funcionalidades, e as palavras de ação genéricas
    // (Cancelar/Fechar/Guardar/etc.) que aparecem em toda a aplicação — não
    // traduzimos as centenas de textos explicativos específicos de cada
    // funcionalidade (Transportes, Turismo, etc.), que continuam em português.
    const UI_STRINGS = {
        pt: {
            appName: 'NADIO',
            appTagline: 'O teu mundo. A tua gente.',
            tourNext: 'Seguinte',
            tourDone: 'Começar! 🚀',
            tourSkip: 'Saltar',
            tour1t: '👋 Bem-vindo à NADIO!',
            tour1d: 'Vamos ver em 30 segundos onde está tudo. As tuas conversas aparecem aqui — pesquisa qualquer uma neste campo.',
            tour2t: '📇 Contactos e grupos',
            tour2d: 'Cria grupos e comunidades, faz chamadas, procura pessoas pelo @ e convida amigos.',
            tour3t: '⋯ Dezenas de ferramentas',
            tour3d: 'Transportes ao vivo, meteorologia, câmbio, mapas, lembretes, SOS e muito mais.',
            tour4t: '🎬 TV, notícias e música',
            tour4d: 'Vê TV em direto, notícias, onde ver filmes e ouve música.',
            tour5t: '👤 O teu perfil',
            tour5d: 'Muda a foto, o nome de utilizador (@), a língua e a segurança da conta. A visita guiada fica em ⋯ se a quiseres rever.',
            landTitle: 'O teu mundo. A tua gente.',
            landSub: 'Mensagens, chamadas de vídeo, IA e dezenas de ferramentas — numa só app, grátis e sem anúncios.',
            landCreate: '✨ Começar — é grátis',
            landLogin: 'Já tenho uma conta',
            f1t: 'Mensagens e grupos',
            f1d: 'Em tempo real, com encriptação, reações e tradução automática.',
            f2t: 'Chamadas de voz e vídeo',
            f2d: 'Grátis, a dois ou em conferência.',
            f3t: 'Assistente de IA',
            f3d: 'Pergunta, resume conversas e transcreve áudios.',
            f4t: 'Transportes, notícias, TV',
            f4d: 'Horários ao vivo, meteorologia, câmbio, música e muito mais.',
            f5t: 'Sondagens e eventos',
            f5d: 'Combina saídas com amigos num toque.',
            f6t: 'Segurança',
            f6d: 'Bloqueio por PIN, SOS e denúncias.',
            landFoot: 'Funciona no telemóvel e no computador. Instala-a no ecrã principal como uma app.',
            phonePlaceholder: 'Número de telemóvel',
            passwordPlaceholder: 'Senha',
            loginSubmitBtn: '🚀 Entrar',
            loginQrBtn: '🔗 Associar por QR (já tenho conta noutro aparelho)',
            loginNoAccount: 'Não tem conta? Criar conta',
            loginForgotPassword: 'Esqueceste a senha?',
            regNamePlaceholder: 'Seu nome',
            regUsernamePlaceholder: 'Nome de utilizador (ex: joao_silva) — usado para te encontrarem',
            emailPlaceholder: 'Email',
            regBirthdayLabel: '🎂 Data de nascimento (opcional)',
            regPasswordPlaceholder: 'Senha (mín. 8 caracteres, nada óbvio)',
            regSubmitBtn: '✅ Criar conta',
            regHasAccount: 'Já tem conta? Entrar',
            verify2faIntro: '🔐 Este é um dispositivo novo. Enviámos um código para',
            verify2faIntroEnd: '— insere-o abaixo.',
            codePlaceholder: 'Código de 6 dígitos',
            confirmBtn: '✅ Confirmar',
            backBtn: 'Voltar',
            forgotIntro: 'Indica o teu número de telemóvel — enviamos um código por email para redefinires a senha.',
            forgotSubmitBtn: '📧 Enviar código por email',
            resetIntro: 'Enviámos um código para',
            resetSubmitBtn: '✅ Redefinir senha',
            cancelBtn: 'Cancelar',
            messageInputPlaceholder: 'Digite uma mensagem...',
            profileSpokenLangLabel: '🌐 A língua que eu falo',
            profileSpokenLangHint: 'As mensagens que recebes são traduzidas automaticamente para esta língua quando a "Tradução automática" está ligada numa conversa (ícone 🌐🔁 no cabeçalho).',
            profileUiLangLabel: '🖥️ Idioma da interface',
            profileUiLangHint: 'Muda os botões e menus da aplicação (não as mensagens — para isso usa "A língua que eu falo", acima).',
        },
        en: {
            appName: 'NADIO',
            appTagline: 'Your World. Your People.',
            tourNext: 'Next',
            tourDone: "Let's go! 🚀",
            tourSkip: 'Skip',
            tour1t: '👋 Welcome to NADIO!',
            tour1d: "Let's see where everything is in 30 seconds. Your chats show up here — search any of them in this field.",
            tour2t: '📇 Contacts & groups',
            tour2d: 'Create groups and communities, make calls, find people by @ and invite friends.',
            tour3t: '⋯ Dozens of tools',
            tour3d: 'Live transport, weather, currency, maps, reminders, SOS and much more.',
            tour4t: '🎬 TV, news & music',
            tour4d: 'Watch live TV and news, find where to watch movies and listen to music.',
            tour5t: '👤 Your profile',
            tour5d: 'Change your photo, username (@), language and account security. The tour lives in ⋯ if you want to see it again.',
            landTitle: 'Your World. Your People.',
            landSub: 'Messages, video calls, AI and dozens of tools — in one free app, with no ads.',
            landCreate: '✨ Get started — it’s free',
            landLogin: 'I already have an account',
            f1t: 'Messages & groups',
            f1d: 'Real time, encrypted, with reactions and auto-translation.',
            f2t: 'Voice & video calls',
            f2d: 'Free, one-to-one or conference.',
            f3t: 'AI assistant',
            f3d: 'Ask anything, summarize chats and transcribe voice notes.',
            f4t: 'Transport, news, TV',
            f4d: 'Live timetables, weather, currency, music and more.',
            f5t: 'Polls & events',
            f5d: 'Plan outings with friends in one tap.',
            f6t: 'Safety',
            f6d: 'PIN lock, SOS and reporting.',
            landFoot: 'Works on phone and computer. Add it to your home screen like an app.',
            phonePlaceholder: 'Phone number',
            passwordPlaceholder: 'Password',
            loginSubmitBtn: '🚀 Log in',
            loginQrBtn: '🔗 Link by QR (I already have an account on another device)',
            loginNoAccount: "Don't have an account? Sign up",
            loginForgotPassword: 'Forgot your password?',
            regNamePlaceholder: 'Your name',
            regUsernamePlaceholder: 'Username (e.g. joao_silva) — used so people can find you',
            emailPlaceholder: 'Email',
            regBirthdayLabel: '🎂 Date of birth (optional)',
            regPasswordPlaceholder: 'Password (min. 8 characters, nothing obvious)',
            regSubmitBtn: '✅ Sign up',
            regHasAccount: 'Already have an account? Log in',
            verify2faIntro: '🔐 This is a new device. We sent a code to',
            verify2faIntroEnd: '— enter it below.',
            codePlaceholder: '6-digit code',
            confirmBtn: '✅ Confirm',
            backBtn: 'Back',
            forgotIntro: "Enter your phone number — we'll email you a code to reset your password.",
            forgotSubmitBtn: '📧 Send code by email',
            resetIntro: 'We sent a code to',
            resetSubmitBtn: '✅ Reset password',
            cancelBtn: 'Cancel',
            messageInputPlaceholder: 'Type a message...',
            profileSpokenLangLabel: '🌐 The language I speak',
            profileSpokenLangHint: 'Messages you receive are automatically translated to this language when "Auto-translate" is on in a conversation (🌐🔁 icon in the header).',
            profileUiLangLabel: '🖥️ Interface language',
            profileUiLangHint: 'Changes the app\'s buttons and menus (not messages — use "The language I speak" above for that).',
        },
        es: {
            appName: 'NADIO',
            appTagline: 'Tu mundo. Tu gente.',
            tourNext: 'Siguiente',
            tourDone: '¡Empezar! 🚀',
            tourSkip: 'Saltar',
            tour1t: '👋 ¡Bienvenido a NADIO!',
            tour1d: 'Veamos en 30 segundos dónde está todo. Tus chats aparecen aquí — busca cualquiera en este campo.',
            tour2t: '📇 Contactos y grupos',
            tour2d: 'Crea grupos y comunidades, haz llamadas, busca personas por @ e invita a amigos.',
            tour3t: '⋯ Decenas de herramientas',
            tour3d: 'Transporte en vivo, el tiempo, divisas, mapas, recordatorios, SOS y mucho más.',
            tour4t: '🎬 TV, noticias y música',
            tour4d: 'Mira TV en directo y noticias, descubre dónde ver películas y escucha música.',
            tour5t: '👤 Tu perfil',
            tour5d: 'Cambia la foto, el nombre de usuario (@), el idioma y la seguridad. La visita guiada está en ⋯ si quieres verla otra vez.',
            landTitle: 'Tu mundo. Tu gente.',
            landSub: 'Mensajes, videollamadas, IA y decenas de herramientas — en una sola app, gratis y sin anuncios.',
            landCreate: '✨ Empezar — es gratis',
            landLogin: 'Ya tengo una cuenta',
            f1t: 'Mensajes y grupos',
            f1d: 'En tiempo real, cifrados, con reacciones y traducción automática.',
            f2t: 'Llamadas de voz y vídeo',
            f2d: 'Gratis, a dos o en conferencia.',
            f3t: 'Asistente de IA',
            f3d: 'Pregunta, resume chats y transcribe audios.',
            f4t: 'Transporte, noticias, TV',
            f4d: 'Horarios en vivo, el tiempo, divisas, música y más.',
            f5t: 'Encuestas y eventos',
            f5d: 'Organiza planes con amigos en un toque.',
            f6t: 'Seguridad',
            f6d: 'Bloqueo con PIN, SOS y denuncias.',
            landFoot: 'Funciona en el móvil y en el ordenador. Añádela a tu pantalla de inicio como una app.',
            phonePlaceholder: 'Número de teléfono',
            passwordPlaceholder: 'Contraseña',
            loginSubmitBtn: '🚀 Entrar',
            loginQrBtn: '🔗 Vincular por QR (ya tengo cuenta en otro dispositivo)',
            loginNoAccount: '¿No tienes cuenta? Crear cuenta',
            loginForgotPassword: '¿Olvidaste la contraseña?',
            regNamePlaceholder: 'Tu nombre',
            regUsernamePlaceholder: 'Nombre de usuario (ej: joao_silva) — para que te encuentren',
            emailPlaceholder: 'Email',
            regBirthdayLabel: '🎂 Fecha de nacimiento (opcional)',
            regPasswordPlaceholder: 'Contraseña (mín. 8 caracteres, nada obvio)',
            regSubmitBtn: '✅ Crear cuenta',
            regHasAccount: '¿Ya tienes cuenta? Entrar',
            verify2faIntro: '🔐 Este es un dispositivo nuevo. Enviamos un código a',
            verify2faIntroEnd: '— introdúcelo abajo.',
            codePlaceholder: 'Código de 6 dígitos',
            confirmBtn: '✅ Confirmar',
            backBtn: 'Volver',
            forgotIntro: 'Indica tu número de teléfono — te enviamos un código por email para restablecer la contraseña.',
            forgotSubmitBtn: '📧 Enviar código por email',
            resetIntro: 'Enviamos un código a',
            resetSubmitBtn: '✅ Restablecer contraseña',
            cancelBtn: 'Cancelar',
            messageInputPlaceholder: 'Escribe un mensaje...',
            profileSpokenLangLabel: '🌐 El idioma que hablo',
            profileSpokenLangHint: 'Los mensajes que recibes se traducen automáticamente a este idioma cuando la "Traducción automática" está activada en una conversación (icono 🌐🔁 en la cabecera).',
            profileUiLangLabel: '🖥️ Idioma de la interfaz',
            profileUiLangHint: 'Cambia los botones y menús de la aplicación (no los mensajes — para eso usa "El idioma que hablo", arriba).',
        },
    };

    // Os botões dos menus em grelha ("Mais funcionalidades", "TV/Media",
    // "Grupos/contactos") já têm uma chave natural e única — a função chamada
    // no onclick — por isso não precisam de nenhum atributo novo no HTML.
    const FEATURE_BUTTON_LABELS = {
        openCalcScreen: { pt: 'Calculadora', en: 'Calculator', es: 'Calculadora' },
        openCurrencyScreen: { pt: 'Câmbio', en: 'Exchange', es: 'Cambio' },
        openNavScreen: { pt: 'Navegação', en: 'Navigation', es: 'Navegación' },
        openFiresScreen: { pt: 'Incêndios', en: 'Fires', es: 'Incendios' },
        openSpaceScreen: { pt: 'Espaço', en: 'Space', es: 'Espacio' },
        openTransportScreen: { pt: 'Transportes', en: 'Transport', es: 'Transporte' },
        openTourismScreen: { pt: 'Turismo', en: 'Tourism', es: 'Turismo' },
        openMapSearchScreen: { pt: 'Mapa', en: 'Map', es: 'Mapa' },
        openEventsScreen: { pt: 'Eventos (Lisboa)', en: 'Events (Lisbon)', es: 'Eventos (Lisboa)' },
        openShoppingScreen: { pt: 'Compras', en: 'Shopping', es: 'Compras' },
        openRemindersScreen: { pt: 'Lembretes', en: 'Reminders', es: 'Recordatorios' },
        openDriveListenScreen: { pt: 'Conduzir e Ouvir', en: 'Drive & Listen', es: 'Conducir y Escuchar' },
        openWeatherScreen: { pt: 'Meteorologia', en: 'Weather', es: 'Meteorología' },
        openActivitiesScreen: { pt: 'Atividades', en: 'Activities', es: 'Actividades' },
        openRouletteScreen: { pt: 'Roleta/Sorteio', en: 'Roulette/Draw', es: 'Ruleta/Sorteo' },
        openPinSetupModal: { pt: 'Bloqueio por PIN', en: 'PIN lock', es: 'Bloqueo por PIN' },
        openDevicesModal: { pt: 'Dispositivos ligados', en: 'Linked devices', es: 'Dispositivos vinculados' },
        openSosModal: { pt: 'SOS', en: 'SOS', es: 'SOS' },
        openTvScreen: { pt: 'TV em Direto', en: 'Live TV', es: 'TV en Directo' },
        openWatchScreen: { pt: 'Onde Assistir', en: 'Where to Watch', es: 'Dónde Ver' },
        openNewsScreen: { pt: 'Notícias', en: 'News', es: 'Noticias' },
        openJamendoScreen: { pt: 'Música', en: 'Music', es: 'Música' },
        openFunnyFeedScreen: { pt: 'Vídeos engraçados', en: 'Funny videos', es: 'Vídeos graciosos' },
        openCreateGroupModal: { pt: 'Criar grupo', en: 'Create group', es: 'Crear grupo' },
        openCommunitiesScreen: { pt: 'Comunidades', en: 'Communities', es: 'Comunidades' },
        openBroadcastScreen: { pt: 'Lista de transmissão', en: 'Broadcast list', es: 'Lista de difusión' },
        openNewCallModal: { pt: 'Nova chamada', en: 'New call', es: 'Nueva llamada' },
        openSearchUserModal: { pt: 'Utilizadores cadastrados', en: 'Registered users', es: 'Usuarios registrados' },
        openCallLogScreen: { pt: 'Histórico de chamadas', en: 'Call history', es: 'Historial de llamadas' },
        openArchivedScreen: { pt: 'Conversas arquivadas', en: 'Archived chats', es: 'Chats archivados' },
        openBlockedUsersModal: { pt: 'Contas bloqueadas', en: 'Blocked accounts', es: 'Cuentas bloqueadas' },
    };

    // Palavras de ação genéricas que se repetem em dezenas de modais — em vez
    // de anotar cada botão um a um no HTML, procuramos por estas palavras
    // exatas (ignorando um possível emoji à frente) em qualquer botão/label
    // simples (sem elementos filhos) já presente na página.
    const GENERIC_WORD_MAP = {
        'Cancelar': { en: 'Cancel', es: 'Cancelar' },
        'Fechar': { en: 'Close', es: 'Cerrar' },
        'Guardar': { en: 'Save', es: 'Guardar' },
        'Salvar': { en: 'Save', es: 'Guardar' },
        'Criar': { en: 'Create', es: 'Crear' },
        'Enviar': { en: 'Send', es: 'Enviar' },
        'Apagar': { en: 'Delete', es: 'Eliminar' },
        'Remover': { en: 'Remove', es: 'Quitar' },
        'Confirmar': { en: 'Confirm', es: 'Confirmar' },
        'Sair': { en: 'Exit', es: 'Salir' },
        'Adicionar': { en: 'Add', es: 'Añadir' },
        'Continuar': { en: 'Continue', es: 'Continuar' },
        'Voltar': { en: 'Back', es: 'Volver' },
        'Sim': { en: 'Yes', es: 'Sí' },
        'Não': { en: 'No', es: 'No' },
        'Ligar': { en: 'Link', es: 'Vincular' },
        'Desligar': { en: 'Unlink', es: 'Desvincular' },
    };
    function splitEmojiPrefix(text) {
        const m = text.match(/^([^\p{L}\p{N}]*)([\s\S]*)$/u);
        if (!m) return { prefix: '', word: text.trim() };
        return { prefix: m[1], word: m[2].trim() };
    }
    function t(key) {
        return (UI_STRINGS[APP.uiLang] && UI_STRINGS[APP.uiLang][key]) || UI_STRINGS.pt[key] || key;
    }
    function applyUiLanguage() {
        document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });

        document.querySelectorAll('#modalMoreFeatures button, #modalMediaFeatures button, #modalContactsFeatures button').forEach(btn => {
            const span = btn.querySelector('span');
            if (!span) return;
            const onclick = btn.getAttribute('onclick') || '';
            const fnMatch = Object.keys(FEATURE_BUTTON_LABELS).find(fn => onclick.includes(fn + '()'));
            if (fnMatch) span.textContent = FEATURE_BUTTON_LABELS[fnMatch][APP.uiLang] || FEATURE_BUTTON_LABELS[fnMatch].pt;
        });

        document.querySelectorAll('button, .login-switch').forEach(el => {
            if (el.children.length || el.hasAttribute('data-i18n')) return;
            const original = el.dataset.i18nOriginal || el.textContent;
            if (!el.dataset.i18nOriginal) el.dataset.i18nOriginal = original;
            const { prefix, word } = splitEmojiPrefix(original);
            const entry = GENERIC_WORD_MAP[word];
            if (entry) el.textContent = (prefix ? prefix + ' ' : '') + (APP.uiLang === 'pt' ? word : (entry[APP.uiLang] || word));
        });

        const uiSelect = document.getElementById('profileUiLangSelect');
        if (uiSelect) uiSelect.value = APP.uiLang;
    }
    function setUiLanguage(lang) {
        APP.uiLang = lang;
        localStorage.setItem('uiLang', lang);
        applyUiLanguage();
    }

    const APP = {
        user: null,
        token: null,
        chats: [],
        currentChatId: null,
        messages: {},
        activeTopic: {}, // chatId -> nome do tópico selecionado num grupo (null = "Tudo")
        offlineQueue: [], // mensagens enviadas sem ligação, à espera do socket reconectar (ver queueOfflineMessage)
        callStream: null,
        callActive: false, // evita loop de "end_call" indo e voltando entre os dois lados
        isMuted: false,
        isSpeakerOn: true,
        isCameraOn: true,
        callType: null,
        sharedStream: null,
        callTimerInterval: null,
        callStartTime: null,
        videoShare: {
            active: false,
            minimized: false,
            videoEl: null,
            audioCtx: null,
            gainNode: null,
            camVideoTrack: null,
            camAudioTrack: null,
            stopCapture: null,
            stream: null
        },
        musicShare: {
            active: false
        },
        _musicMix: null, // AudioContext/nodes persistentes p/ partilhar música na chamada (ver getMusicMix)
        translatorLang: localStorage.getItem('translatorLang') || '',
        uiLang: localStorage.getItem('uiLang') || 'pt', // idioma da INTERFACE (botões/menus) — ver applyUiLanguage()
        musicAudio: document.getElementById('bgMusic'),
        onlineContacts: [], // vem do servidor: todos os usuários cadastrados + status online/offline
        groupsList: [], // vem do servidor: grupos visíveis a todos os usuários
        communitiesList: [], // vem do servidor: comunidades (ligam vários grupos + canal de anúncios)
        badges: [], // vem do servidor: conquistas já desbloqueadas (ver BADGE_CATALOG)
        trustedContacts: [], // vem do servidor: contactos de confiança para o alerta de SOS
        audioRoomMode: false, // true quando a chamada de grupo atual é uma "Sala de áudio ao vivo" (ver startAudioRoom)
        currentManagedCommunityId: null, // comunidade aberta em "Gerir" (modalManageCommunity)
        broadcasts: [], // vem do servidor: as minhas listas de transmissão
        joinedRooms: new Set(), // salas já ligadas (join_room) para receber mensagens em segundo plano
        whiteboard: {
            canvas: document.getElementById('whiteboardCanvas'),
            ctx: document.getElementById('whiteboardCanvas').getContext('2d'),
            drawing: false,
            remote: false // true enquanto desenha um traço recebido do outro lado (evita reenviar)
        },
        // Estava a ser atribuído mais abaixo (fora deste objeto) — mas
        // restoreSession() pode chamar enterApp() -> renderHeaderAvatar() ->
        // hasActiveStatus() de forma síncrona logo ao carregar a página, antes
        // de o script chegar lá, e isso rebentava com "Cannot read properties
        // of undefined (reading 'find')" em todo reload/sessão restaurada.
        statusFeed: [],
        pendingStatusPhotoUrl: null
    };
    // Aplica já o idioma da interface guardado (ex.: recarregar a página com o
    // ecrã de login ainda por autenticar) — não precisa de esperar pelo login.
    applyUiLanguage();

    // Declarado aqui (bem cedo no script) e não junto do resto do código do
    // bloqueio por PIN mais abaixo, porque restoreSession() já pode chamar
    // enterApp() -> showPinUnlockScreen() de forma síncrona logo ao carregar a
    // página, antes de o script chegar à zona onde o bloqueio por PIN vive.
    const PIN_STATE = { entered: '', mode: null, firstEntry: null, cancelable: false };

    // Biblioteca de emojis por categoria (não precisa de nenhuma dependência
    // externa — são só carateres unicode normais, tal como os 30 de sempre,
    // só que organizados e muito mais completos).
    const EMOJI_LIBRARY = {
        'Sorrisos': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👻','👽','🤖'],
        'Pessoas': ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦵','🦶','👂','👃','🧠','👀','👁️','👅','👄','👶','🧒','👦','👧','🧑','👨','👩','🧓','👴','👵','😀','👮','🕵️','💂','👷','🤴','👸','👳','👲','🧕','🤵','👰','🤰','🤱','👼','🎅','🤶','🦸','🦹','🧙','🧚','🧛','🧜','🧝','🧞','🧟','💆','💇','🚶','🧍','🧎','🏃','💃','🕺','👯','🧖','🧘','👭','👬','👫','💏','💑','👪'],
        'Animais': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐽','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷️','🕸️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🐈','🐓','🦃','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦦','🦥','🐁','🐀','🐿️','🦔'],
        'Comida': ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🧂','🥜','🍯','🥛','🍼','☕','🍵','🧃','🥤','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🍾'],
        'Atividades': ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🏋️','🤼','🤸','⛹️','🤺','🤾','🏌️','🏇','🧘','🏄','🏊','🤽','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎫','🎟️','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🪘','🎷','🎺','🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🎰','🧩'],
        'Viagens': ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🛵','🏍️','🛺','🚲','🛴','🚨','🚔','🚍','🚘','🚖','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','🛩️','💺','🛰️','🚀','🛸','🚁','🛶','⛵','🚤','🛥️','🛳️','⛴️','🚢','⚓','🪝','⛽','🚧','🚦','🚥','🗺️','🗿','🗽','🗼','🏰','🏯','🏟️','🎡','🎢','🎠','⛲','⛱️','🏖️','🏝️','🏜️','🌋','⛰️','🏔️','🗻','🏕️','⛺','🏠','🏡','🏘️','🏢','🏬','🏣','🏤','🏥','🏦','🏨','🏪','🏫','🏩','💒','🏛️','⛪','🕌','🕍','🛕','🕋','⛩️','🌍','🌎','🌏'],
        'Objetos': ['⌚','📱','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','💽','💾','💿','📀','📷','📸','📹','🎥','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🪫','🔌','💡','🔦','🕯️','🪔','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛','🔧','🔨','⚒️','🛠️','⛏️','🪚','🔩','⚙️','🪤','🧱','⛓️','🧲','🔫','💣','🧨','🪓','🔪','🗡️','⚔️','🛡️','🚬','⚰️','🪦','⚱️','🏺','🔮','📿','🧿','💈','⚗️','🔭','🔬','🕳️','💊','💉','🩸','🩹','🩺','🌡️','🧬','🦠','🧫','🧪','🧹','🧺','🧻','🚽','🚰','🚿','🛁','🛀','🧼','🪥','🪒','🧴','🛎️','🔑','🗝️','🚪','🪑','🛋️','🛏️','🖼️','📦','📫'],
        'Símbolos': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❓','❕','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🈳','🈂️','🛂','🛃','🛄','🛅'],
        'Bandeiras': ['🏁','🚩','🎌','🏴','🏳️','🏳️‍🌈','🇵🇹','🇧🇷','🇦🇴','🇲🇿','🇨🇻','🇬🇼','🇸🇹','🇹🇱','🇪🇸','🇫🇷','🇬🇧','🇺🇸','🇮🇹','🇩🇪','🇳🇱','🇧🇪','🇨🇭','🇨🇦','🇲🇽','🇦🇷','🇨🇱','🇨🇴','🇵🇪','🇻🇪','🇺🇾','🇯🇵','🇨🇳','🇰🇷','🇮🇳','🇷🇺','🇦🇺','🇿🇦','🇲🇦','🇪🇬','🇹🇷']
    };
    const EMOJI_CATEGORY_ICONS = { 'Recentes': '🕐', 'Sorrisos': '😀', 'Pessoas': '👋', 'Animais': '🐶', 'Comida': '🍔', 'Atividades': '⚽', 'Viagens': '🚗', 'Objetos': '💡', 'Símbolos': '❤️', 'Bandeiras': '🚩' };

    const DEFAULT_CONTACTS = [
        { id: 'gemini_assistant', name: '✨ Gemini', phone: '', avatar: '✨', type: 'ai', provider: 'gemini', memberCount: 1 },
    ];

    // Gera o mesmo id de sala para os dois lados de uma conversa 1-para-1,
    // não importa quem abriu a conversa primeiro.
    function dmRoomId(phoneA, phoneB) {
        return 'dm_' + [phoneA, phoneB].sort().join('_').replace(/[^a-zA-Z0-9_]/g, '');
    }

    // ==================== CONTATOS E GRUPOS EM TEMPO REAL (vindos do servidor) ====================
    // Toda pessoa cadastrada aparece automaticamente na lista de conversas de
    // todo mundo (com bolinha online/offline), e todo grupo criado aparece
    // para todos os usuários — sem precisar de convite.
    function rebuildChatsFromServer() {
        if (!APP.user) return;
        // Guarda as chaves públicas antigas antes de reconstruir a lista, para
        // detetar se algum contacto mudou de chave (ex.: reinstalou a app,
        // trocou de telemóvel) — sem isto, a chave AES partilhada ficava em
        // cache para sempre com a chave antiga, e as mensagens paravam de se
        // conseguir desencriptar de um dos lados sem nenhum aviso claro.
        const oldPublicKeys = {};
        (APP.chats || []).forEach(c => { if (c.type === 'user') oldPublicKeys[c.phone] = c.publicKey || null; });
        const contactChats = APP.onlineContacts
            .filter(c => c.phone !== APP.user.phone)
            .map(c => ({
                id: dmRoomId(APP.user.phone, c.phone),
                name: c.name, phone: c.phone, username: c.username || null, avatar: c.name.charAt(0).toUpperCase(), avatarUrl: c.avatarUrl || null,
                type: 'user', online: c.online, publicKey: c.publicKey || null
            }));
        contactChats.forEach(c => {
            const previous = oldPublicKeys[c.phone];
            if (previous !== undefined && previous !== c.publicKey && E2EE.sharedKeys[c.phone]) {
                delete E2EE.sharedKeys[c.phone];
            }
        });
        const groupChats = APP.groupsList
            .filter(g => !g.bannedPhones?.includes(APP.user.phone))
            .map(g => ({
                id: g.id, name: g.name, phone: '', avatar: g.announcementsOnly ? '📢' : (g.private ? '🔒' : '👥'), type: 'group',
                memberCount: APP.onlineContacts.length, createdBy: g.createdBy, createdByPhone: g.createdByPhone,
                admins: g.admins || [], moderators: g.moderators || [], mutedPhones: g.mutedPhones || [], bannedPhones: g.bannedPhones || [],
                private: !!g.private, memberPhones: g.memberPhones || [], memberNames: g.memberNames || [], inviteToken: g.inviteToken || null,
                announcementsOnly: !!g.announcementsOnly, communityId: g.communityId || null, dailySummaryEnabled: !!g.dailySummaryEnabled
            }));
        const aiChats = DEFAULT_CONTACTS;
        APP.chats = [...aiChats, ...groupChats, ...contactChats];
        APP.chats.forEach(chat => {
            if (!APP.messages[chat.id]) {
                if (chat.type === 'ai' && chat.provider === 'gemini') {
                    APP.messages[chat.id] = [{ id: 'm1', sender: 'Gemini', text: 'Olá! Sou o Gemini, o assistente da Google integrado aqui. Podes enviar-me texto, fotos, vídeos e documentos — pergunta o que quiseres! ✨', time: '10:30', type: 'received' }];
                } else {
                    APP.messages[chat.id] = [];
                }
            }
            // Entra automaticamente na sala para receber mensagens mesmo com a conversa fechada
            if (chat.type !== 'ai' && !APP.joinedRooms.has(chat.id)) {
                socket.emit('join_room', { chatId: chat.id, toPhone: chat.phone });
                APP.joinedRooms.add(chat.id);
            }
        });
        renderChatList();
        updateCallContactList();
        // Se acabaste de encontrar alguém pela pesquisa e "Iniciar conversa", abre já a conversa
        if (APP.pendingOpenChatPhone) {
            const found = APP.chats.find(c => c.type === 'user' && c.phone === APP.pendingOpenChatPhone);
            if (found) { APP.pendingOpenChatPhone = null; openChat(found.id); }
        }
        // Se a conversa aberta agora é de um contato, atualiza o "Online/Offline" no cabeçalho
        if (APP.currentChatId) {
            const openChatData = APP.chats.find(c => c.id === APP.currentChatId);
            if (openChatData && openChatData.type === 'user') {
                document.getElementById('chatSubtitle').textContent = openChatData.online ? 'Online' : 'Offline';
            }
            if (openChatData?.type === 'group') {
                document.getElementById('manageGroupBtn').style.display = openChatData.admins?.includes(APP.user.phone) ? 'flex' : 'none';
                if (document.getElementById('modalManageGroup').classList.contains('active')) openManageGroupModal();
            }
            updateEncryptionBadge();
        }
    }

    socket.on('message_rejected', (data) => {
        if (data?.reason) alert('⚠️ ' + data.reason);
    });

    // O Socket.IO reconecta sozinho depois de qualquer queda de rede (app em
    // segundo plano no telemóvel, mudar de rede, servidor reiniciar, etc.),
    // mas o socket novo não tem login nem salas — sem isto, chamadas e
    // mensagens em segundo plano deixavam de chegar depois de reconectar.
    socket.on('connect', () => {
        setOfflineBannerVisible(false);
        if (APP.user) {
            socket.emit('user_login', { name: APP.user.name, phone: APP.user.phone, token: APP.token });
            APP.joinedRooms.clear();
            APP.chats.forEach(chat => {
                if (chat.type !== 'ai') { socket.emit('join_room', { chatId: chat.id, toPhone: chat.phone }); APP.joinedRooms.add(chat.id); }
            });
            flushOfflineQueue();
        }
    });

    // ==================== MODO OFFLINE COM FILA DE MENSAGENS ====================
    // Sem ligação (rede em baixo, avião, socket a tentar reconectar), as
    // mensagens que a pessoa manda ficam guardadas aqui (memória + localStorage,
    // por conta) em vez de se perderem — aparecem já na conversa com um relógio
    // 🕓 em vez do "✓" normal, e são enviadas a sério assim que a ligação volta.
    socket.on('disconnect', () => setOfflineBannerVisible(true));
    window.addEventListener('offline', () => setOfflineBannerVisible(true));
    window.addEventListener('online', () => { if (socket.connected) setOfflineBannerVisible(false); });

    function setOfflineBannerVisible(visible) {
        const banner = document.getElementById('offlineBanner');
        if (banner) banner.style.display = visible ? 'block' : 'none';
    }

    function offlineQueueStorageKey() {
        return APP.user ? ('chatapp_offline_queue_' + APP.user.phone) : null;
    }

    function saveOfflineQueueToStorage() {
        const key = offlineQueueStorageKey();
        if (!key) return;
        try { localStorage.setItem(key, JSON.stringify(APP.offlineQueue)); } catch (e) {}
    }

    function loadOfflineQueueFromStorage() {
        APP.offlineQueue = [];
        const key = offlineQueueStorageKey();
        if (!key) return;
        try {
            const raw = localStorage.getItem(key);
            APP.offlineQueue = raw ? JSON.parse(raw) : [];
        } catch (e) { APP.offlineQueue = []; }
    }

    // Reconstrói na conversa as mensagens ainda por enviar de uma sala — chamado
    // depois do histórico do servidor chegar, já que este substitui por completo
    // APP.messages[chatId] (ver room_history) e apagaria a mensagem pendente.
    function appendPendingOfflineMessages(chatId) {
        const pending = APP.offlineQueue.filter(item => item.chatId === chatId);
        if (!pending.length) return;
        if (!APP.messages[chatId]) APP.messages[chatId] = [];
        pending.forEach(item => {
            if (!APP.messages[chatId].some(m => m.id === item.msgId)) {
                APP.messages[chatId].push({ id: item.msgId, sender: 'Você', text: item.previewText, time: item.time, type: 'sent', replyTo: item.replyTo || null, read: false, topic: item.topic || null, pending: true });
            }
        });
    }

    function queueOfflineMessage(item) {
        APP.offlineQueue.push(item);
        saveOfflineQueueToStorage();
    }

    function flushOfflineQueue() {
        if (!APP.offlineQueue.length) return;
        const queue = APP.offlineQueue;
        APP.offlineQueue = [];
        saveOfflineQueueToStorage();
        queue.forEach(item => {
            socket.emit('send_message', item.outgoing);
            const msg = APP.messages[item.chatId]?.find(m => m.id === item.msgId);
            if (msg) msg.pending = false;
        });
        renderMessages();
        renderChatList();
    }

    socket.on('contacts_update', (list) => {
        APP.onlineContacts = list || [];
        rebuildChatsFromServer();
        checkBirthdaysToday();
        handlePendingInvite();
    });

    // ==================== ANIVERSÁRIOS ====================
    // Aviso simples (mês/dia, sem depender do ano) quando é hoje o aniversário
    // do próprio utilizador ou de algum contacto — comparado com 'YYYY-MM-DD'
    // guardado em cada conta.
    function checkBirthdaysToday() {
        const banner = document.getElementById('birthdayBanner');
        if (!banner || !APP.user) return;
        const today = new Date();
        const todayMD = String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        const isToday = (birthday) => typeof birthday === 'string' && birthday.slice(5) === todayMD;
        const lines = [];
        if (isToday(APP.user.birthday)) lines.push('🎉 É o teu aniversário! Parabéns!');
        (APP.onlineContacts || []).forEach(c => {
            if (isToday(c.birthday)) lines.push('🎂 Hoje é aniversário de ' + escapeHtml(c.name) + '!');
        });
        if (lines.length) {
            banner.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
            banner.style.display = 'block';
        } else {
            banner.style.display = 'none';
        }
    }

    socket.on('groups_update', (list) => {
        APP.groupsList = list || [];
        rebuildChatsFromServer();
    });

    socket.on('communities_update', (list) => {
        APP.communitiesList = list || [];
        if (document.getElementById('modalCommunities')?.classList.contains('active')) renderCommunitiesList();
        if (APP.currentManagedCommunityId && document.getElementById('modalManageCommunity')?.classList.contains('active')) renderManageCommunityModal();
    });

    // ==================== LIMITE DE 2 DISPOSITIVOS POR CONTA ====================
    // "Dispositivo" aqui = este navegador/aparelho, identificado por um id
    // aleatório gerado uma única vez e guardado no localStorage — persiste
    // entre logins/logouts no mesmo aparelho, mas nunca sai dele nem é
    // partilhado. O nome é só uma etiqueta legível (ex.: "Chrome · Android")
    // para a pessoa reconhecer o dispositivo na lista, não é usado para nada
    // de segurança.
    function getOrCreateDeviceId() {
        let id = localStorage.getItem('deviceId');
        if (!id) {
            id = (crypto.randomUUID ? crypto.randomUUID() : 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2));
            localStorage.setItem('deviceId', id);
        }
        return id;
    }
    function getDeviceName() {
        const ua = navigator.userAgent || '';
        let os = 'Dispositivo';
        if (/iPhone/.test(ua)) os = 'iPhone';
        else if (/iPad/.test(ua)) os = 'iPad';
        else if (/Android/.test(ua)) os = 'Android';
        else if (/Macintosh/.test(ua)) os = 'Mac';
        else if (/Windows/.test(ua)) os = 'Windows';
        else if (/Linux/.test(ua)) os = 'Linux';
        let browser = '';
        if (/Edg\//.test(ua)) browser = 'Edge';
        else if (/Chrome\//.test(ua)) browser = 'Chrome';
        else if (/Firefox\//.test(ua)) browser = 'Firefox';
        else if (/Safari\//.test(ua)) browser = 'Safari';
        return browser ? `${browser} · ${os}` : os;
    }

    // ==================== VISITA GUIADA (primeira entrada) ====================
    // Na primeira vez que uma conta entra neste aparelho, 5 balões mostram onde
    // estão as coisas principais. Fica marcada como vista por conta
    // (localStorage 'tourDone:<telefone>'); pode rever-se em ⋯ → Visita guiada.
    // Em browsers automatizados não arranca sozinha (os outros testes não
    // contam com ela); test_tour.js força-a com window.__forceTour.
    const TOUR_STEPS = [
        { sel: '#chatSearchInput', t: 'tour1t', d: 'tour1d' },
        { sel: 'button[onclick="openContactsFeaturesModal()"]', t: 'tour2t', d: 'tour2d' },
        { sel: 'button[onclick="openMoreFeaturesModal()"]', t: 'tour3t', d: 'tour3d' },
        { sel: '#mediaBtn', t: 'tour4t', d: 'tour4d' },
        { sel: '#headerAvatar', t: 'tour5t', d: 'tour5d' }
    ];
    let tourIndex = -1;
    function maybeStartTour() {
        try {
            if (!APP.user?.phone || localStorage.getItem('tourDone:' + APP.user.phone)) return;
            if (navigator.webdriver && !window.__forceTour) return;
        } catch (e) { return; }
        setTimeout(startTour, 1200);
    }
    function startTour() {
        endTour(false);
        tourIndex = 0;
        const spot = document.createElement('div'); spot.className = 'tour-spot'; spot.id = 'tourSpot';
        const tip = document.createElement('div'); tip.className = 'tour-tip'; tip.id = 'tourTip';
        document.body.append(spot, tip);
        window.addEventListener('resize', renderTourStep);
        renderTourStep();
    }
    function renderTourStep() {
        const step = TOUR_STEPS[tourIndex];
        const spot = document.getElementById('tourSpot'), tip = document.getElementById('tourTip');
        if (!step || !spot || !tip) return;
        const target = document.querySelector(step.sel);
        if (target && target.scrollIntoView) target.scrollIntoView({ block: 'nearest', inline: 'center' });
        const r = target && target.offsetParent !== null ? target.getBoundingClientRect() : { left: innerWidth / 2 - 40, top: 80, width: 80, height: 40, bottom: 120 };
        const pad = 6;
        Object.assign(spot.style, { left: (r.left - pad) + 'px', top: (r.top - pad) + 'px', width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px' });
        const last = tourIndex === TOUR_STEPS.length - 1;
        tip.innerHTML = `<h4>${escapeHtml(t(step.t))}</h4><div>${escapeHtml(t(step.d))}</div>
            <div class="tour-actions"><button class="tour-skip" onclick="endTour(true)">${escapeHtml(t('tourSkip'))}</button>
            <span class="tour-count">${tourIndex + 1}/${TOUR_STEPS.length}</span>
            <button class="tour-next" onclick="nextTourStep()">${escapeHtml(t(last ? 'tourDone' : 'tourNext'))}</button></div>`;
        const tipW = tip.offsetWidth, tipH = tip.offsetHeight;
        let top = r.bottom + 14;
        if (top + tipH > innerHeight - 10) top = Math.max(10, r.top - tipH - 14);
        const left = Math.min(Math.max(12, r.left + r.width / 2 - tipW / 2), innerWidth - tipW - 12);
        Object.assign(tip.style, { top: top + 'px', left: left + 'px' });
    }
    function nextTourStep() {
        tourIndex++;
        if (tourIndex >= TOUR_STEPS.length) return endTour(true);
        renderTourStep();
    }
    function endTour(markDone) {
        document.getElementById('tourSpot')?.remove();
        document.getElementById('tourTip')?.remove();
        window.removeEventListener('resize', renderTourStep);
        if (markDone && APP.user?.phone) { try { localStorage.setItem('tourDone:' + APP.user.phone, '1'); } catch (e) {} }
        tourIndex = -1;
    }

    // ==================== PÁGINA DE APRESENTAÇÃO ====================
    // Aparece a quem abre a app sem sessão iniciada e nunca entrou neste
    // aparelho. Não aparece: com sessão, depois do primeiro login neste
    // aparelho (localStorage 'hasLoggedInBefore'), com um link de convite
    // (esse vai direto ao registo com o aviso "X convidou-te") nem em browsers
    // automatizados (navigator.webdriver — a suite de testes abre o ecrã de
    // entrada diretamente; test_landing.js força-a com window.__forceLanding).
    function initLanding() {
        const el = document.getElementById('landingScreen');
        if (!el) return;
        let show = false;
        try {
            show = !localStorage.getItem('authToken') && !localStorage.getItem('hasLoggedInBefore') && !localStorage.getItem('pendingInvite')
                && (!navigator.webdriver || window.__forceLanding);
        } catch (e) {}
        el.classList.toggle('hidden', !show);
    }
    // Botões de língua da apresentação (função à parte para não duplicar os
    // seletores dos botões de língua do ecrã de entrada).
    function setLandingLanguage(lang) { setUiLanguage(lang); }
    function closeLanding(which) {
        document.getElementById('landingScreen').classList.add('hidden');
        showAuthForm(which === 'register' ? 'register' : 'login');
    }

    function showAuthForm(which) {
        document.getElementById('loginFormBox').style.display = which === 'login' ? 'flex' : 'none';
        document.getElementById('registerFormBox').style.display = which === 'register' ? 'flex' : 'none';
        document.getElementById('verifyCodeBox').style.display = 'none';
        document.getElementById('registerVerifyBox').style.display = which === 'registerVerify' ? 'flex' : 'none';
        document.getElementById('forgotPasswordBox').style.display = which === 'forgotPassword' ? 'flex' : 'none';
        document.getElementById('resetPasswordBox').style.display = 'none';
        document.getElementById('loginError').textContent = '';
        document.getElementById('registerError').textContent = '';
        if (which === 'forgotPassword') document.getElementById('forgotPasswordError').textContent = '';
        if (which === 'registerVerify') document.getElementById('registerVerifyError').textContent = '';
    }

    let pendingResetPhone = null; // guardado só entre pedir o código e confirmar a nova senha
    async function requestPasswordReset() {
        const phone = document.getElementById('forgotPhoneInput').value.trim();
        const errEl = document.getElementById('forgotPasswordError');
        errEl.textContent = '';
        if (!phone) { errEl.textContent = 'Indica o teu número de telemóvel.'; return; }
        try {
            const res = await fetch('/api/password-reset/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) });
            const data = await res.json();
            if (!res.ok) { errEl.textContent = data.error || 'Erro ao pedir o código.'; return; }
            pendingResetPhone = phone;
            document.getElementById('resetPasswordEmailLabel').textContent = data.maskedEmail || 'o teu email';
            document.getElementById('resetCodeInput').value = '';
            document.getElementById('resetNewPasswordInput').value = '';
            document.getElementById('resetPasswordError').textContent = '';
            document.getElementById('forgotPasswordBox').style.display = 'none';
            document.getElementById('resetPasswordBox').style.display = 'flex';
        } catch (err) {
            errEl.textContent = 'Não foi possível ligar ao servidor.';
        }
    }
    async function confirmPasswordReset() {
        const code = document.getElementById('resetCodeInput').value.trim();
        const newPassword = document.getElementById('resetNewPasswordInput').value;
        const errEl = document.getElementById('resetPasswordError');
        errEl.textContent = '';
        if (!pendingResetPhone) { showAuthForm('login'); return; }
        if (!code || !newPassword) { errEl.textContent = 'Preenche o código e a nova senha.'; return; }
        try {
            const res = await fetch('/api/password-reset/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: pendingResetPhone, code, newPassword }) });
            const data = await res.json();
            if (!res.ok) { errEl.textContent = data.error || 'Erro ao redefinir a senha.'; return; }
            const resetPhone = pendingResetPhone;
            pendingResetPhone = null;
            alert('Senha redefinida com sucesso! Entra com a nova senha.');
            showAuthForm('login');
            document.getElementById('loginPhone').value = resetPhone;
        } catch (err) {
            errEl.textContent = 'Não foi possível ligar ao servidor.';
        }
    }

    let pendingLoginPhone = null; // guardado só entre o pedido de login e a confirmação do código (ver 2FA)

    async function doLogin() {
        const phone = document.getElementById('loginPhone').value.trim();
        const password = document.getElementById('loginPassword').value;
        const errEl = document.getElementById('loginError');
        errEl.textContent = '';
        if (!phone || !password) { errEl.textContent = 'Preencha telemóvel e senha.'; return; }
        try {
            const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password, deviceId: getOrCreateDeviceId(), deviceName: getDeviceName() }) });
            const data = await res.json();
            if (!res.ok) { errEl.textContent = data.error || 'Erro ao entrar.'; return; }
            if (data.needsVerification) {
                pendingLoginPhone = phone;
                document.getElementById('loginFormBox').style.display = 'none';
                document.getElementById('verifyCodeBox').style.display = 'flex';
                document.getElementById('verifyCodeEmailLabel').textContent = data.maskedEmail || 'o teu email';
                document.getElementById('verifyCodeInput').value = '';
                document.getElementById('verifyCodeError').textContent = '';
                return;
            }
            enterApp(data.user, data.token);
        } catch (err) {
            errEl.textContent = 'Não foi possível ligar ao servidor.';
        }
    }

    async function doVerifyLoginCode() {
        const code = document.getElementById('verifyCodeInput').value.trim();
        const errEl = document.getElementById('verifyCodeError');
        errEl.textContent = '';
        if (!pendingLoginPhone) return cancelLoginVerification();
        if (!code) { errEl.textContent = 'Insere o código recebido por email.'; return; }
        try {
            const res = await fetch('/api/login/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: pendingLoginPhone, code }) });
            const data = await res.json();
            if (!res.ok) { errEl.textContent = data.error || 'Erro ao verificar o código.'; return; }
            pendingLoginPhone = null;
            enterApp(data.user, data.token);
        } catch (err) {
            errEl.textContent = 'Não foi possível ligar ao servidor.';
        }
    }

    function cancelLoginVerification() {
        pendingLoginPhone = null;
        showAuthForm('login');
    }

    // Guardado só entre "Criar conta" devolver "precisa de confirmar o email"
    // e a pessoa inserir o código — usado tanto pelo registo normal como pela
    // Área do administrador (as duas passam por aqui, ver /api/register).
    let pendingRegisterPhone = null;
    function goToRegisterEmailVerification(phone, maskedEmail) {
        pendingRegisterPhone = phone;
        document.getElementById('registerVerifyEmailLabel').textContent = maskedEmail || 'o teu email';
        document.getElementById('registerVerifyCodeInput').value = '';
        showAuthForm('registerVerify');
    }
    async function doVerifyRegistrationEmail() {
        const code = document.getElementById('registerVerifyCodeInput').value.trim();
        const errEl = document.getElementById('registerVerifyError');
        errEl.textContent = '';
        if (!pendingRegisterPhone) return cancelRegisterVerification();
        if (!code) { errEl.textContent = 'Insere o código recebido por email.'; return; }
        try {
            const res = await fetch('/api/register/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: pendingRegisterPhone, code }) });
            const data = await res.json();
            if (!res.ok) { errEl.textContent = data.error || 'Erro ao verificar o código.'; return; }
            pendingRegisterPhone = null;
            enterApp(data.user, data.token);
        } catch (err) {
            errEl.textContent = 'Não foi possível ligar ao servidor.';
        }
    }
    function cancelRegisterVerification() {
        pendingRegisterPhone = null;
        showAuthForm('register');
    }
    async function doRegister() {
        const name = document.getElementById('regName').value.trim();
        const username = document.getElementById('regUsername').value.trim();
        const phone = document.getElementById('regPhone').value.trim();
        const country = document.getElementById('regCountry').value;
        const email = document.getElementById('regEmail').value.trim();
        const birthday = document.getElementById('regBirthday').value || null;
        const password = document.getElementById('regPassword').value;
        const errEl = document.getElementById('registerError');
        errEl.textContent = '';
        if (!name || !username || !phone || !country || !password || !email) { errEl.textContent = 'Preencha nome, nome de utilizador, telemóvel, país, email e senha.'; return; }
        try {
            const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, username, phone, country, email, birthday, password, deviceId: getOrCreateDeviceId(), deviceName: getDeviceName() }) });
            const data = await res.json();
            if (!res.ok) { errEl.textContent = data.error || 'Erro ao criar conta.'; return; }
            if (data.needsEmailVerification) { goToRegisterEmailVerification(phone, data.maskedEmail); return; }
            enterApp(data.user, data.token);
        } catch (err) {
            errEl.textContent = 'Não foi possível ligar ao servidor.';
        }
    }

    // ==================== ÁREA DO ADMINISTRADOR (janela própria) ====================
    // Janela dedicada, separada do formulário normal de criar conta, para
    // registar uma conta de administrador — continua a exigir a senha de
    // administrador do servidor (ADMIN_SIGNUP_SECRET); só o local mudou.
    function openAdminRegisterModal() {
        ['adminRegName', 'adminRegUsername', 'adminRegPhone', 'adminRegEmail', 'adminRegPassword', 'adminRegSecret'].forEach(id => { document.getElementById(id).value = ''; });
        document.getElementById('adminRegCountry').value = '';
        document.getElementById('adminRegisterError').textContent = '';
        document.getElementById('modalAdminRegister').classList.add('active');
    }
    async function doAdminRegister() {
        const name = document.getElementById('adminRegName').value.trim();
        const username = document.getElementById('adminRegUsername').value.trim();
        const phone = document.getElementById('adminRegPhone').value.trim();
        const country = document.getElementById('adminRegCountry').value;
        const email = document.getElementById('adminRegEmail').value.trim();
        const password = document.getElementById('adminRegPassword').value;
        const adminSecret = document.getElementById('adminRegSecret').value;
        const errEl = document.getElementById('adminRegisterError');
        errEl.textContent = '';
        if (!name || !username || !phone || !country || !password || !email) { errEl.textContent = 'Preencha nome, nome de utilizador, telemóvel, país, email e senha.'; return; }
        if (!adminSecret) { errEl.textContent = 'Preencha a senha de administrador.'; return; }
        try {
            const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, username, phone, country, email, password, adminSecret, deviceId: getOrCreateDeviceId(), deviceName: getDeviceName() }) });
            const data = await res.json();
            if (!res.ok) { errEl.textContent = data.error || 'Erro ao criar conta.'; return; }
            if (data.needsEmailVerification) { closeModal('modalAdminRegister'); goToRegisterEmailVerification(phone, data.maskedEmail); return; }
            closeModal('modalAdminRegister');
            enterApp(data.user, data.token);
        } catch (err) {
            errEl.textContent = 'Não foi possível ligar ao servidor.';
        }
    }

    // ==================== FACE ID / TOUCH ID (WEBAUTHN/PASSKEYS) ====================
    // Sem biblioteca externa nenhuma — usa a Web Authentication API nativa do
    // navegador (navigator.credentials.create/get) diretamente. O servidor
    // (via @simplewebauthn/server) manda/recebe tudo em base64url (o mesmo
    // formato usado pela biblioteca de referência @simplewebauthn/browser),
    // por isso só é preciso converter para/de ArrayBuffer aqui.
    function webauthnBase64urlToBuffer(base64url) {
        const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
        const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(base64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return bytes.buffer;
    }
    function webauthnBufferToBase64url(buffer) {
        const bytes = new Uint8Array(buffer);
        let str = '';
        for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
        return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function webauthnCreationOptionsFromServer(options) {
        return {
            ...options,
            challenge: webauthnBase64urlToBuffer(options.challenge),
            user: { ...options.user, id: webauthnBase64urlToBuffer(options.user.id) },
            excludeCredentials: (options.excludeCredentials || []).map(c => ({ ...c, id: webauthnBase64urlToBuffer(c.id) })),
        };
    }
    function webauthnRequestOptionsFromServer(options) {
        return {
            ...options,
            challenge: webauthnBase64urlToBuffer(options.challenge),
            allowCredentials: (options.allowCredentials || []).map(c => ({ ...c, id: webauthnBase64urlToBuffer(c.id) })),
        };
    }
    function webauthnRegistrationCredentialToJSON(cred) {
        return {
            id: cred.id,
            rawId: webauthnBufferToBase64url(cred.rawId),
            type: cred.type,
            response: {
                clientDataJSON: webauthnBufferToBase64url(cred.response.clientDataJSON),
                attestationObject: webauthnBufferToBase64url(cred.response.attestationObject),
                transports: (cred.response.getTransports && cred.response.getTransports()) || [],
            },
            clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
        };
    }
    function webauthnAssertionCredentialToJSON(cred) {
        return {
            id: cred.id,
            rawId: webauthnBufferToBase64url(cred.rawId),
            type: cred.type,
            response: {
                clientDataJSON: webauthnBufferToBase64url(cred.response.clientDataJSON),
                authenticatorData: webauthnBufferToBase64url(cred.response.authenticatorData),
                signature: webauthnBufferToBase64url(cred.response.signature),
                userHandle: cred.response.userHandle ? webauthnBufferToBase64url(cred.response.userHandle) : undefined,
            },
            clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
        };
    }
    // Ativa um Face ID/Touch ID/PIN NESTE dispositivo para a conta com sessão
    // iniciada — cada dispositivo tem de o fazer separadamente (a "passkey"
    // fica guardada no próprio aparelho, nunca no servidor).
    async function setupWebauthn() {
        if (!window.PublicKeyCredential) { alert('⚠️ Este dispositivo/navegador não suporta Face ID/Touch ID (WebAuthn).'); return; }
        try {
            const optsRes = await fetch('/api/webauthn/register-options', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': APP.token }, body: JSON.stringify({ origin: location.origin }) });
            const optsData = await optsRes.json();
            if (!optsRes.ok) { alert('⚠️ ' + (optsData.error || 'Não foi possível preparar o registo.')); return; }
            const credential = await navigator.credentials.create({ publicKey: webauthnCreationOptionsFromServer(optsData.options) });
            const verifyRes = await fetch('/api/webauthn/register-verify', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': APP.token },
                body: JSON.stringify({ origin: location.origin, response: webauthnRegistrationCredentialToJSON(credential), deviceName: getDeviceName() })
            });
            const verifyData = await verifyRes.json();
            if (!verifyRes.ok) { alert('⚠️ ' + (verifyData.error || 'Não foi possível ativar.')); return; }
            loadWebauthnCredentials();
        } catch (e) {
            if (e.name === 'NotAllowedError') return; // cancelado pela própria pessoa — sem alarido
            alert('⚠️ Não foi possível ativar o Face ID/Touch ID: ' + e.message);
        }
    }
    async function loadWebauthnCredentials() {
        try {
            const res = await fetch('/api/webauthn/credentials?token=' + encodeURIComponent(APP.token));
            const data = await res.json();
            renderWebauthnCredentials(data.credentials || []);
        } catch (e) { /* sem ligação — a secção fica só sem a lista, sem bloquear o resto do perfil */ }
    }
    function renderWebauthnCredentials(credentials) {
        document.getElementById('webauthnCredentialsList').innerHTML = credentials.length ? credentials.map(c => `
            <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.06);border-radius:6px;padding:5px 8px;font-size:12px;">
                <span>📱 ${escapeHtml(c.deviceName || 'Dispositivo')}</span>
                <button class="btn-small" onclick="removeWebauthnCredential('${c.id}')" style="padding:2px 8px;">Remover</button>
            </div>`).join('') : '<div style="font-size:12px;opacity:0.7;">Ainda não ativaste em nenhum dispositivo.</div>';
    }
    async function removeWebauthnCredential(id) {
        try {
            const res = await fetch('/api/webauthn/credentials/remove', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': APP.token }, body: JSON.stringify({ id }) });
            const data = await res.json();
            if (res.ok) renderWebauthnCredentials(data.credentials || []);
        } catch (e) { alert('⚠️ Não foi possível remover agora.'); }
    }
    // Botão do ecrã de login: "usernameless" — nem sequer se pede o telefone
    // primeiro, é o próprio autenticador que escolhe qual passkey usar (ver
    // grande comentário nas rotas /api/webauthn/* no servidor).
    if (window.PublicKeyCredential) document.getElementById('webauthnLoginBtn').style.display = 'block';
    async function doWebauthnLogin() {
        const errEl = document.getElementById('loginError');
        errEl.textContent = '';
        try {
            const optsRes = await fetch('/api/webauthn/login-options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origin: location.origin }) });
            const optsData = await optsRes.json();
            if (!optsRes.ok) { errEl.textContent = optsData.error || 'Não foi possível preparar o login.'; return; }
            const credential = await navigator.credentials.get({ publicKey: webauthnRequestOptionsFromServer(optsData.options) });
            const verifyRes = await fetch('/api/webauthn/login-verify', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ challengeId: optsData.challengeId, origin: location.origin, response: webauthnAssertionCredentialToJSON(credential), deviceId: getOrCreateDeviceId(), deviceName: getDeviceName() })
            });
            const verifyData = await verifyRes.json();
            if (!verifyRes.ok) { errEl.textContent = verifyData.error || 'Não foi possível entrar.'; return; }
            enterApp(verifyData.user, verifyData.token);
        } catch (e) {
            if (e.name === 'NotAllowedError') return; // cancelado pela própria pessoa — sem alarido
            errEl.textContent = 'Não foi possível entrar com Face ID/Touch ID: ' + e.message;
        }
    }

    // ==================== ENCRIPTAÇÃO PONTA-A-PONTA (conversas 1-para-1) ====================
    // Usa a Web Crypto API nativa do navegador (nenhuma biblioteca externa): cada
    // dispositivo gera o seu próprio par de chaves ECDH (P-256); a chave PRIVADA
    // nunca sai do aparelho (fica só no localStorage deste navegador) — o servidor
    // só recebe e guarda a chave PÚBLICA, que é normal e seguro partilhar.
    // Quando duas pessoas conversam, cada uma combina a sua chave privada com a
    // chave pública da outra (ECDH) para chegar à MESMA chave secreta partilhada,
    // sem que essa chave secreta seja jamais transmitida pela rede — é usada para
    // cifrar/decifrar com AES-GCM. O servidor só vê o texto cifrado.
    //
    // Limitações importantes (para seres honesto contigo mesmo sobre o que isto
    // cobre): só protege chats 1-para-1 (não grupos, nem a IA); a chave fica presa
    // a ESTE navegador/dispositivo — se entrares noutro telemóvel/computador, gera-se
    // um par novo e as mensagens antigas encriptadas com a chave antiga deixam de
    // poder ser lidas nesse novo aparelho; fotos/áudios/documentos NÃO são encriptados
    // nesta versão, só o texto. Não é ao nível do protocolo Signal (sem "ratcheting"),
    // mas é encriptação ponta-a-ponta real, não é só "https".
    const E2EE = { privateKey: null, publicJwk: null, sharedKeys: {} }; // sharedKeys: phone -> CryptoKey (AES) já derivada
    // Promessa que só resolve quando a chave de encriptação estiver pronta. Usada
    // pelos pontos que desencriptam mensagens, para nunca tentarem decifrar antes
    // da chave existir (o que antes causava falsos "não foi possível desencriptar").
    let resolveE2eeReady;
    const e2eeReadyPromise = new Promise((res) => { resolveE2eeReady = res; });

    function b64encode(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
    function b64decode(str) { return Uint8Array.from(atob(str), c => c.charCodeAt(0)); }

    async function initE2EE() {
        if (!window.crypto?.subtle) { console.warn('Web Crypto API não disponível — encriptação ponta-a-ponta desativada.'); resolveE2eeReady(); return; }
        const storeKey = 'e2ee_' + APP.user.phone;
        let stored = null;
        try { stored = JSON.parse(localStorage.getItem(storeKey) || 'null'); } catch (e) {}
        try {
            if (stored?.privateJwk && stored?.publicJwk) {
                E2EE.privateKey = await crypto.subtle.importKey('jwk', stored.privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
                E2EE.publicJwk = stored.publicJwk;
            } else {
                const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
                const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
                const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
                localStorage.setItem(storeKey, JSON.stringify({ privateJwk, publicJwk }));
                E2EE.privateKey = pair.privateKey;
                E2EE.publicJwk = publicJwk;
            }
            await fetch('/api/publish-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token },
                body: JSON.stringify({ token: APP.token, publicKeyJwk: E2EE.publicJwk })
            });
        } catch (err) {
            console.warn('Não foi possível preparar a encriptação ponta-a-ponta:', err.message);
        }
        resolveE2eeReady(); // liberta quem estava à espera da chave, mesmo que tenha falhado (fica sem E2EE, mas não fica preso à espera para sempre)
    }

    async function getSharedKey(peerPhone, peerPublicJwk) {
        if (!peerPublicJwk || !E2EE.privateKey) return null;
        if (E2EE.sharedKeys[peerPhone]) return E2EE.sharedKeys[peerPhone];
        try {
            const peerPublicKey = await crypto.subtle.importKey('jwk', peerPublicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
            const aesKey = await crypto.subtle.deriveKey(
                { name: 'ECDH', public: peerPublicKey }, E2EE.privateKey,
                { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
            );
            E2EE.sharedKeys[peerPhone] = aesKey;
            return aesKey;
        } catch (err) {
            console.warn('Falha ao derivar chave partilhada:', err.message);
            return null;
        }
    }

    async function encryptFor(peerPhone, peerPublicJwk, plainText) {
        const key = await getSharedKey(peerPhone, peerPublicJwk);
        if (!key) return null;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(plainText);
        const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
        return { iv: b64encode(iv), data: b64encode(cipher) };
    }

    async function decryptFrom(peerPhone, peerPublicJwk, ivB64, dataB64) {
        const key = await getSharedKey(peerPhone, peerPublicJwk);
        if (!key) return null;
        try {
            const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(ivB64) }, key, b64decode(dataB64));
            return new TextDecoder().decode(plain);
        } catch (err) {
            return null; // provavelmente cifrado com a chave de outro dispositivo
        }
    }

    function updateEncryptionBadge() {
        const badge = document.getElementById('encryptionBadge');
        if (!badge) return;
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        const isE2ee = !!(chat?.type === 'user' && chat.publicKey && E2EE.publicJwk);
        badge.style.display = isE2ee ? 'inline' : 'none';
        const securityBtn = document.getElementById('securityCodeBtn');
        if (securityBtn) securityBtn.style.display = isE2ee ? 'flex' : 'none';
    }

    // ==================== CÓDIGO DE SEGURANÇA (verificação de "safety number" E2EE) ====================
    // Mesma ideia do "número de segurança" do WhatsApp/Signal: um código
    // calculado a partir das duas chaves públicas ECDH da conversa. Se um
    // atacante conseguisse substituir a chave pública de alguém a meio (para
    // decifrar as mensagens sem ninguém notar), o código deixaria de bater
    // certo entre os dois lados — é por isso que só serve se for comparado
    // por um canal diferente da própria app (voz, mensagem noutro sítio).
    function bytesToDigitGroups(bytes, groupCount) {
        const groups = [];
        for (let i = 0; i < groupCount; i++) {
            const b0 = bytes[(i * 2) % bytes.length];
            const b1 = bytes[(i * 2 + 1) % bytes.length];
            const num = ((b0 << 8) | b1) % 100000;
            groups.push(String(num).padStart(5, '0'));
        }
        return groups;
    }
    async function computeSecurityCode(myJwk, peerJwk) {
        const a = (myJwk.x || '') + (myJwk.y || '');
        const b = (peerJwk.x || '') + (peerJwk.y || '');
        // Ordenado para que os dois lados da conversa cheguem exatamente ao
        // mesmo código, independentemente de quem é "eu" e quem é o contacto.
        const combined = [a, b].sort().join('|');
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(combined));
        return bytesToDigitGroups(new Uint8Array(digest), 12);
    }
    async function openSecurityCodeModal() {
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat || chat.type !== 'user' || !chat.publicKey || !E2EE.publicJwk) return;
        document.getElementById('securityCodeContactName').textContent = chat.name;
        document.getElementById('securityCodeDigits').innerHTML = 'A calcular…';
        document.getElementById('modalSecurityCode').classList.add('active');
        const groups = await computeSecurityCode(E2EE.publicJwk, chat.publicKey);
        const rows = [];
        for (let i = 0; i < groups.length; i += 4) rows.push(groups.slice(i, i + 4).join(' '));
        document.getElementById('securityCodeDigits').innerHTML = rows.map(r => escapeHtml(r)).join('<br>');
        document.getElementById('securityCodeDigits').dataset.rawCode = groups.join(' ');
    }
    function copySecurityCode() {
        const code = document.getElementById('securityCodeDigits').dataset.rawCode || '';
        if (!code) return;
        navigator.clipboard?.writeText(code).then(() => alert('Código copiado!')).catch(() => {});
    }

    async function enterApp(user, token) {
        APP.user = { name: user.name, phone: user.phone, username: user.username || null, isAdmin: !!user.isAdmin, avatar: user.name.charAt(0).toUpperCase(), avatarUrl: user.avatarUrl || null, preferredLang: user.preferredLang || (navigator.language || 'pt').split('-')[0], accentColor: user.accentColor || null, chatWallpaper: user.chatWallpaper || null, totalTimeSpentSec: user.totalTimeSpentSec || 0, birthday: user.birthday || null, email: user.email || '', twoFactorEnabled: !!user.twoFactorEnabled, pixKey: user.pixKey || null, googleCalendarConnected: !!user.googleCalendarConnected, googleCalendarSyncedRooms: user.googleCalendarSyncedRooms || [], slackConnected: !!user.slackConnected, slackTeamName: user.slackTeamName || null, slackLinkedRooms: user.slackLinkedRooms || {} };
        APP.token = token;
        localStorage.setItem('authToken', token);
        localStorage.setItem('authUser', JSON.stringify(APP.user));
        localStorage.setItem('hasLoggedInBefore', '1');
        document.getElementById('landingScreen')?.classList.add('hidden');
        // A conta pode ter uma cor/fundo guardados de outro aparelho — aplica-os
        // agora, para a personalização acompanhar a pessoa em qualquer login.
        if (APP.user.accentColor) applyAccentColor(APP.user.accentColor);
        applyChatWallpaper(APP.user.chatWallpaper || null, { save: true });
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('mainApp').style.display = 'flex';
        // Se houver PIN definido neste aparelho, bloqueia já a vista por cima de
        // tudo — o resto da entrada na app (socket, e2ee, histórico) continua a
        // decorrer por baixo, sem esperar pelo desbloqueio.
        if (hasPinSet()) showPinUnlockScreen();
        renderHeaderAvatar();
        document.getElementById('headerName').textContent = APP.user.name;
        document.getElementById('adminBtn').style.display = APP.user.isAdmin ? 'flex' : 'none';
        socket.emit('user_login', { name: APP.user.name, phone: APP.user.phone, token: APP.token });
        socket.emit('google_calendar_get_status', {}); // atualiza APP.user.googleCalendarConnected sem depender do localStorage (ex.: acabado de voltar do OAuth)
        socket.emit('slack_get_status', {}); // idem, para o Slack
        checkDndActive(); // sincroniza logo o estado do "não incomodar" com o servidor
        loadOfflineQueueFromStorage(); // mensagens por enviar de antes de fechar/recarregar a app (ver "Modo offline")
        setOfflineBannerVisible(!socket.connected);
        initApp();
        if (!hasPinSet()) maybeStartTour(); // visita guiada na primeira entrada desta conta neste aparelho
        // Importante: espera a chave de encriptação ficar pronta ANTES de pedir o
        // histórico das conversas — caso contrário, mensagens podiam chegar
        // enquanto a chave ainda não existia e apareciam como "não foi possível
        // desencriptar", mesmo sendo perfeitamente decifráveis.
        await initE2EE();
        APP.chats.forEach(chat => socket.emit('join_room', { chatId: chat.id, toPhone: chat.phone }));
        initPushNotifications(); // não bloqueia a entrada na app — corre em segundo plano
        startTimeSpentTracking();
        checkBirthdaysToday();
        loadQuoteOfDay();
        if (APP.pendingGroupInviteToken) {
            const inviteToken = APP.pendingGroupInviteToken;
            APP.pendingGroupInviteToken = null;
            redeemGroupInvite(inviteToken);
        }
    }

    // ==================== FRASE DO DIA ====================
    async function loadQuoteOfDay() {
        try {
            const r = await fetch('/api/quote-of-day');
            const data = await r.json();
            if (!r.ok || !data.quote) return;
            const bar = document.getElementById('quoteOfDayBar');
            const text = `💬 "${data.quote}" — ${data.author} · ZenQuotes.io`;
            bar.textContent = text;
            bar.title = text;
            bar.style.display = 'block';
        } catch (err) {
            // sem frase do dia hoje, sem problema — a barra simplesmente não aparece
        }
    }

    // ==================== CRONÓMETRO "QUANTAS HORAS PERDEU NA APP" ====================
    // Conta o tempo total acumulado (guardado na conta, não só nesta sessão) que
    // a pessoa já passou com a app em primeiro plano — pausa sozinho quando a
    // aba fica em segundo plano, para não contar tempo que não foi mesmo gasto
    // a olhar para a app.
    const TIME_SPENT = { pendingSec: 0, tickTimer: null, flushTimer: null };
    function formatTimeSpent(totalSec) {
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
    function updateTimeSpentDisplay() {
        const el = document.getElementById('timeSpentValue');
        if (el && APP.user) el.textContent = formatTimeSpent(APP.user.totalTimeSpentSec);
    }
    function startTimeSpentTracking() {
        stopTimeSpentTracking();
        updateTimeSpentDisplay();
        TIME_SPENT.tickTimer = setInterval(() => {
            if (document.hidden || !APP.user) return;
            APP.user.totalTimeSpentSec++;
            TIME_SPENT.pendingSec++;
            updateTimeSpentDisplay();
        }, 1000);
        TIME_SPENT.flushTimer = setInterval(flushTimeSpent, 30000);
        window.addEventListener('beforeunload', flushTimeSpent);
    }
    function stopTimeSpentTracking() {
        if (TIME_SPENT.tickTimer) clearInterval(TIME_SPENT.tickTimer);
        if (TIME_SPENT.flushTimer) clearInterval(TIME_SPENT.flushTimer);
        TIME_SPENT.tickTimer = null;
        TIME_SPENT.flushTimer = null;
    }
    function flushTimeSpent() {
        if (TIME_SPENT.pendingSec <= 0 || !APP.token) return;
        const seconds = TIME_SPENT.pendingSec;
        TIME_SPENT.pendingSec = 0;
        const payload = JSON.stringify({ token: APP.token, seconds });
        if (navigator.sendBeacon) {
            navigator.sendBeacon('/api/time-spent', new Blob([payload], { type: 'application/json' }));
        } else {
            fetch('/api/time-spent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }).catch(() => {});
        }
    }

    // ==================== PWA: SERVICE WORKER + NOTIFICAÇÕES PUSH ====================
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Erro ao registar service worker:', err.message));
        });
    }

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = atob(base64);
        return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
    }

    async function initPushNotifications() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return; // navegador sem suporte (ex: alguns iPhones mais antigos)
        try {
            const keyRes = await fetch('/api/vapid-public-key');
            const { publicKey } = await keyRes.json();
            if (!publicKey) return; // servidor ainda não tem notificações push configuradas
            const reg = await navigator.serviceWorker.ready;
            let sub = await reg.pushManager.getSubscription();
            if (!sub) {
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') return; // usuário recusou — respeita a escolha, sem insistir
                sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
            }
            await fetch('/api/push-subscribe', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: APP.token, subscription: sub })
            });
        } catch (err) {
            console.warn('Não foi possível ativar notificações push:', err.message);
        }
    }

    // Restaura a sessão se já havia login guardado neste dispositivo. Adiado
    // com setTimeout (em vez de correr já, aqui mesmo) para só disparar depois
    // de todo o resto do script correr — várias propriedades de APP (ex.:
    // APP.statusFeed, APP.archivedChats) só são atribuídas mais abaixo no
    // ficheiro, e enterApp() já lê algumas delas logo ao renderizar o
    // cabeçalho/lista de conversas; sem este adiamento, uma sessão restaurada
    // rebentava com "Cannot read properties of undefined" nelas.
    setTimeout(function restoreSession() {
        // Abriu o URL de um convite de grupo privado (?joinGroup=...) — ao contrário do
        // pareamento de dispositivo, isto faz sentido mesmo já com sessão iniciada (é o
        // caso mais comum: alguém já tem a app e só quer entrar num grupo novo), por isso
        // fica guardado para ser resgatado dentro de enterApp(), depois do login em
        // qualquer um dos dois casos (sessão restaurada aqui, ou login/registo manual).
        const joinGroupToken = new URLSearchParams(location.search).get('joinGroup');
        if (joinGroupToken) {
            history.replaceState(null, '', location.pathname);
            APP.pendingGroupInviteToken = joinGroupToken;
        }
        // Voltou do OAuth do Google Calendar (ver /api/google-calendar/callback
        // em server.js) — faz sentido mesmo já com sessão iniciada (é sempre o
        // caso: só se liga a conta Google depois de já se ter entrado na app).
        // O token da app não vai nesse redirect (é a Google a mandar de
        // volta), por isso o estado real só chega a seguir, via
        // 'google_calendar_get_status' (ver enterApp()).
        const gcalResult = new URLSearchParams(location.search).get('gcal');
        if (gcalResult) {
            history.replaceState(null, '', location.pathname);
            APP.pendingGoogleCalendarResult = gcalResult;
        }
        // Voltou do OAuth do Slack (ver /api/slack/callback em server.js) —
        // mesmo raciocínio do Google Calendar acima.
        const slackResult = new URLSearchParams(location.search).get('slack');
        if (slackResult) {
            history.replaceState(null, '', location.pathname);
            APP.pendingSlackResult = slackResult;
        }
        const token = localStorage.getItem('authToken');
        const userRaw = localStorage.getItem('authUser');
        if (token && userRaw) {
            try { enterApp(JSON.parse(userRaw), token); } catch (e) { /* ignora sessão corrompida */ }
            return;
        }
        // Abriu o URL de um código QR de associação (ver openDevicePairingModal)
        // — só faz sentido quando este aparelho ainda não tem sessão nenhuma.
        const pairingToken = new URLSearchParams(location.search).get('pair');
        if (pairingToken) redeemDevicePairing(pairingToken);
        else initLanding();
    }, 0);

    // Troca o código do QR por uma sessão válida nesta conta, sem precisar de
    // escrever a senha — usado quando este dispositivo abriu o URL de um QR
    // gerado noutro dispositivo já ligado (ver /api/device-pairing/redeem).
    async function redeemDevicePairing(pairingToken) {
        history.replaceState(null, '', location.pathname); // tira o ?pair= do URL, para um refresh não tentar usar o código outra vez
        try {
            const res = await fetch('/api/device-pairing/redeem', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pairingToken, deviceId: getOrCreateDeviceId(), deviceName: getDeviceName() })
            });
            const data = await res.json();
            if (!res.ok) { alert('⚠️ ' + (data.error || 'Não foi possível associar este dispositivo.')); return; }
            enterApp(data.user, data.token);
        } catch (e) {
            alert('⚠️ Não foi possível ligar ao servidor para associar este dispositivo.');
        }
    }

    // ---- Ler o QR com a câmara, direto no ecrã de login (sem precisar da
    // câmara nativa do telemóvel) ----
    // Usa a API nativa BarcodeDetector do navegador (Chrome/Edge/Android) em
    // vez de trazer uma biblioteca de leitura de QR só para isto — mais
    // simples e sem risco de uma implementação própria mal-feita a falhar a
    // ler códigos válidos. Onde não há suporte (ex.: Safari/iPhone), mostra
    // logo um aviso claro em vez de ficar preso num ecrã de câmara que nunca
    // deteta nada — nesses casos continua a dar para associar abrindo o URL
    // do código com a câmara normal do telemóvel (já funciona sem isto).
    const QR_SCAN = { stream: null, rafId: null };
    async function openQrScanModal() {
        document.getElementById('modalQrScan').classList.add('active');
        const content = document.getElementById('qrScanContent');
        const video = document.getElementById('qrScanVideo');
        video.style.display = 'none';
        if (!('BarcodeDetector' in window)) {
            content.innerHTML = '<p style="color:var(--text-secondary);">O teu navegador não suporta leitura de QR pela câmara. Em alternativa, abre a câmara normal do telemóvel e aponta para o código mostrado no outro dispositivo — funciona na mesma.</p>';
            return;
        }
        try {
            QR_SCAN.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            video.srcObject = QR_SCAN.stream;
            video.style.display = 'block';
            await video.play();
            const detector = new BarcodeDetector({ formats: ['qr_code'] });
            const tick = async () => {
                if (!QR_SCAN.stream) return; // já cancelado
                if (!document.getElementById('modalQrScan').classList.contains('active')) { closeQrScanModal(); return; } // fechado pelo fundo escuro, sem passar por closeQrScanModal()
                try {
                    const codes = await detector.detect(video);
                    if (codes.length) {
                        const pairingToken = new URL(codes[0].rawValue, location.origin).searchParams.get('pair');
                        if (pairingToken) { closeQrScanModal(); redeemDevicePairing(pairingToken); return; }
                    }
                } catch (e) { /* frame sem código legível — tenta outra vez no próximo */ }
                QR_SCAN.rafId = requestAnimationFrame(tick);
            };
            tick();
        } catch (e) {
            content.innerHTML = `<p style="color:var(--text-secondary);">⚠️ Não foi possível aceder à câmara: ${escapeHtml(e.message)}</p>`;
        }
    }
    function closeQrScanModal() {
        if (QR_SCAN.rafId) cancelAnimationFrame(QR_SCAN.rafId);
        QR_SCAN.rafId = null;
        if (QR_SCAN.stream) QR_SCAN.stream.getTracks().forEach((t) => t.stop());
        QR_SCAN.stream = null;
        closeModal('modalQrScan');
    }

    function logout() {
        if (APP.callStream) endCall();
        if (VR.active) closeVrRoom();
        stopMusic();
        flushTimeSpent();
        stopTimeSpentTracking();
        socket.emit('user_logout');
        APP.user = null;
        APP.token = null;
        localStorage.removeItem('authToken');
        localStorage.removeItem('authUser');
        APP.chats = [];
        APP.messages = {};
        APP.currentChatId = null;
        APP.onlineContacts = [];
        APP.groupsList = [];
        APP.communitiesList = [];
        APP.badges = [];
        APP.trustedContacts = [];
        APP.joinedRooms = new Set();
        document.getElementById('mainApp').style.display = 'none';
        document.getElementById('loginScreen').classList.remove('hidden');
        showAuthForm('login');
        document.getElementById('chatArea').classList.remove('active');
        document.getElementById('musicPlayer').classList.remove('active');
    }

    // ==================== BLOQUEIO POR PIN (só neste aparelho) ====================
    // Pensado como barreira simples contra alguém pegar no telemóvel destrancado,
    // não como segurança a sério: o PIN (com hash SHA-256) fica só no
    // localStorage deste aparelho, nunca no servidor — quem tivesse acesso à
    // consola do navegador conseguiria contornar isto. É por isto que se
    // escolheu um PIN simples em vez de WebAuthn/Face ID a sério: para o
    // objetivo real (impedir um olhar rápido de alguém que pega no telemóvel)
    // dá o mesmo resultado prático com uma fração da complexidade.
    // (PIN_STATE está declarado bem mais acima, junto de APP — ver o comentário lá.)
    async function sha256Hex(text) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    function hasPinSet() { return !!localStorage.getItem('pinHash'); }
    function updatePinDots() {
        document.querySelectorAll('#pinDots .pin-dot').forEach((dot, i) => dot.classList.toggle('filled', i < PIN_STATE.entered.length));
    }
    function setPinLockLabel(text) {
        document.querySelector('#pinLockScreen > div:nth-child(2)').textContent = text;
    }
    function setPinBottomButton(cancelable) {
        PIN_STATE.cancelable = cancelable;
        const btn = document.querySelector('#pinLockScreen button.btn-small');
        btn.textContent = cancelable ? 'Cancelar' : 'Esqueci o PIN';
        btn.onclick = cancelable ? cancelPinFlow : forgotPin;
    }
    // Ecrã cheio mostrado ao abrir a app (se já houver PIN definido) ou ao
    // voltar do segundo plano — bloqueia visualmente o conteúdo por cima de
    // tudo o resto, mas não impede a app de continuar a ligar-se ao servidor
    // por baixo (não há razão para atrasar isso).
    function showPinUnlockScreen() {
        PIN_STATE.entered = '';
        PIN_STATE.mode = 'unlock';
        setPinLockLabel('Introduz o teu PIN');
        setPinBottomButton(false);
        updatePinDots();
        document.getElementById('pinError').textContent = '';
        document.getElementById('pinLockScreen').style.display = 'flex';
    }
    function hidePinLockScreen() {
        document.getElementById('pinLockScreen').style.display = 'none';
    }
    function cancelPinFlow() {
        hidePinLockScreen();
        // Cancelar ao tentar ver conversas bloqueadas só fecha o ecrã do PIN — as
        // outras origens (criar/alterar/remover PIN) é que voltam às definições do PIN.
        if (PIN_STATE.mode === 'verify-chat-lock') { APP.pendingChatIdAfterUnlock = null; return; }
        openPinSetupModal();
    }
    async function pinKeyPress(digit) {
        if (PIN_STATE.entered.length >= 4) return;
        PIN_STATE.entered += digit;
        updatePinDots();
        if (PIN_STATE.entered.length < 4) return;
        const hash = await sha256Hex(PIN_STATE.entered);
        const errorEl = document.getElementById('pinError');

        if (PIN_STATE.mode === 'unlock') {
            if (hash === localStorage.getItem('pinHash')) { hidePinLockScreen(); return; }
            return pinRejectEntry('PIN incorreto');
        }
        if (PIN_STATE.mode === 'verify-chat-lock') {
            if (hash !== localStorage.getItem('pinHash')) return pinRejectEntry('PIN incorreto');
            hidePinLockScreen();
            PIN_STATE.mode = null; // volta a neutro — senão o bloqueio ao voltar de segundo plano nunca mais disparava (ver visibilitychange)
            APP.lockedChatsRevealed = true;
            renderChatList();
            if (APP.pendingChatIdAfterUnlock) {
                const chatId = APP.pendingChatIdAfterUnlock;
                APP.pendingChatIdAfterUnlock = null;
                openChat(chatId);
            }
            return;
        }
        if (PIN_STATE.mode === 'verify-old') {
            if (hash !== localStorage.getItem('pinHash')) return pinRejectEntry('PIN incorreto');
            PIN_STATE.mode = 'create-first';
            PIN_STATE.entered = '';
            setPinLockLabel('Cria o novo PIN');
            errorEl.textContent = '';
            updatePinDots();
            return;
        }
        if (PIN_STATE.mode === 'verify-remove') {
            if (hash !== localStorage.getItem('pinHash')) return pinRejectEntry('PIN incorreto');
            localStorage.removeItem('pinHash');
            // Sem PIN já não há como voltar a desbloquear conversas bloqueadas — desbloqueia
            // todas agora, para não ficarem presas na lista para sempre.
            if (APP.lockedChats.size) {
                APP.lockedChats.clear();
                localStorage.setItem('lockedChatsCache', '[]');
                APP.lockedChatsRevealed = true;
            }
            hidePinLockScreen();
            PIN_STATE.mode = null; // idem — sem isto, o bloqueio ao voltar de segundo plano ficava preso neste modo para sempre
            openPinSetupModal();
            renderChatList();
            return;
        }
        if (PIN_STATE.mode === 'create-first') {
            PIN_STATE.firstEntry = PIN_STATE.entered;
            PIN_STATE.mode = 'create-confirm';
            PIN_STATE.entered = '';
            setPinLockLabel('Confirma o PIN');
            errorEl.textContent = '';
            updatePinDots();
            return;
        }
        if (PIN_STATE.mode === 'create-confirm') {
            if (PIN_STATE.entered !== PIN_STATE.firstEntry) {
                PIN_STATE.mode = 'create-first';
                PIN_STATE.firstEntry = null;
                setPinLockLabel('Cria o novo PIN');
                return pinRejectEntry('Os PINs não coincidem, tenta outra vez');
            }
            localStorage.setItem('pinHash', hash);
            hidePinLockScreen();
            PIN_STATE.mode = null; // idem — sem isto, o bloqueio ao voltar de segundo plano ficava preso neste modo para sempre
            openPinSetupModal();
        }
    }
    function pinRejectEntry(message) {
        document.getElementById('pinError').textContent = message;
        const dotsEl = document.getElementById('pinDots');
        dotsEl.classList.add('pin-dots-shake');
        setTimeout(() => dotsEl.classList.remove('pin-dots-shake'), 400);
        PIN_STATE.entered = '';
        setTimeout(updatePinDots, 150);
    }
    function pinBackspace() {
        PIN_STATE.entered = PIN_STATE.entered.slice(0, -1);
        updatePinDots();
    }
    function forgotPin() {
        if (!confirm('Esqueceste o PIN? Isto vai terminar a sessão neste aparelho — ao entrares de novo podes definir um PIN novo.')) return;
        localStorage.removeItem('pinHash');
        hidePinLockScreen();
        logout();
    }

    // Configuração do PIN (criar/alterar/remover), a partir do menu "Mais funcionalidades"
    function openPinSetupModal() {
        renderPinSetupForm();
        document.getElementById('modalPinSetup').classList.add('active');
    }
    function renderPinSetupForm() {
        const status = document.getElementById('pinSetupStatus');
        const form = document.getElementById('pinSetupForm');
        status.textContent = hasPinSet() ? '✅ Bloqueio por PIN ativo neste aparelho.' : 'Bloqueio por PIN desativado.';
        form.innerHTML = hasPinSet()
            ? `<button class="btn-small" onclick="startPinChangeFlow()">Alterar PIN</button>
               <button class="btn-small" onclick="startPinRemoveFlow()" style="margin-top:6px;">Remover PIN</button>`
            : `<button class="btn-small btn-accept" onclick="startPinCreateFlow()">Criar PIN</button>`;
    }
    function startPinCreateFlow() {
        closeModal('modalPinSetup');
        PIN_STATE.entered = '';
        PIN_STATE.mode = 'create-first';
        setPinLockLabel('Cria o novo PIN');
        setPinBottomButton(true);
        updatePinDots();
        document.getElementById('pinError').textContent = '';
        document.getElementById('pinLockScreen').style.display = 'flex';
    }
    function startPinChangeFlow() {
        closeModal('modalPinSetup');
        PIN_STATE.entered = '';
        PIN_STATE.mode = 'verify-old';
        setPinLockLabel('Confirma o PIN atual');
        setPinBottomButton(true);
        updatePinDots();
        document.getElementById('pinError').textContent = '';
        document.getElementById('pinLockScreen').style.display = 'flex';
    }
    function startPinRemoveFlow() {
        closeModal('modalPinSetup');
        PIN_STATE.entered = '';
        PIN_STATE.mode = 'verify-remove';
        setPinLockLabel('Confirma o PIN para remover');
        setPinBottomButton(true);
        updatePinDots();
        document.getElementById('pinError').textContent = '';
        document.getElementById('pinLockScreen').style.display = 'flex';
    }
    // Bloqueia de novo sempre que a aba volta a ficar visível depois de ter
    // estado em segundo plano (troca de app, ecrã bloqueado, etc.) — não só
    // ao abrir a app pela primeira vez.
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && APP.user && hasPinSet() && PIN_STATE.mode !== 'create-first' && PIN_STATE.mode !== 'create-confirm' && PIN_STATE.mode !== 'verify-old' && PIN_STATE.mode !== 'verify-remove' && PIN_STATE.mode !== 'verify-chat-lock') {
            showPinUnlockScreen();
            // Reentrar no PIN da app volta a esconder as conversas bloqueadas também —
            // quem as tinha revelado antes de a app ir para segundo plano tem de o
            // fazer de novo, tal como o resto da app volta a pedir o PIN.
            if (APP.lockedChatsRevealed) { APP.lockedChatsRevealed = false; renderChatList(); }
        }
    });

    // ==================== DISPOSITIVOS LIGADOS (máx. 2 por conta) ====================
    function openDevicesModal() {
        document.getElementById('modalDevices').classList.add('active');
        loadDevices();
    }
    async function loadDevices() {
        const list = document.getElementById('devicesList');
        list.innerHTML = '<p style="text-align:center;color:var(--text-secondary);">A carregar...</p>';
        try {
            const res = await fetch(`/api/devices?deviceId=${encodeURIComponent(getOrCreateDeviceId())}`, { headers: { 'X-Auth-Token': APP.token } });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Falha');
            const devices = data.devices || [];
            list.innerHTML = devices.length ? devices.map(d => `
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px;background:var(--bg-secondary);border-radius:8px;margin-bottom:8px;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:600;font-size:13px;">${escapeHtml(d.name)}${d.isThisDevice ? ' <span style="color:var(--blue);">(este dispositivo)</span>' : ''}</div>
                        <div style="font-size:11px;color:var(--text-secondary);">Última vez: ${new Date(d.lastSeenAt).toLocaleString('pt-BR')}</div>
                    </div>
                    <button class="btn-small" onclick="removeDevice('${d.id}')" style="flex:0 0 auto;">Remover</button>
                </div>`).join('') : '<p style="text-align:center;color:var(--text-secondary);">Nenhum dispositivo ligado.</p>';
        } catch (e) {
            list.innerHTML = '<p style="text-align:center;color:var(--text-secondary);">⚠️ Não foi possível carregar os dispositivos agora.</p>';
        }
    }
    async function removeDevice(deviceId) {
        if (!confirm('Remover este dispositivo? Ele deixa de contar para o limite de 2 — mas se ainda tiver sessão aberta, continua a funcionar até se desligar sozinho.')) return;
        try {
            const res = await fetch('/api/devices/remove', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': APP.token }, body: JSON.stringify({ deviceId }) });
            const data = await res.json();
            if (!res.ok) return alert(data.error || 'Não foi possível remover.');
            loadDevices();
        } catch (e) {
            alert('Não foi possível remover agora.');
        }
    }

    // ---- Associar novo dispositivo por QR (tipo WhatsApp Web) ----
    // O QR é gerado inteiramente no nosso servidor (nunca enviado a uma API
    // de QR de terceiros, que veria o código de acesso) e expira em 60s.
    let devicePairingTicker = null;
    async function openDevicePairingModal() {
        document.getElementById('modalDevicePairing').classList.add('active');
        await createDevicePairingCode();
    }
    function closeDevicePairingModal() {
        clearInterval(devicePairingTicker);
        closeModal('modalDevicePairing');
    }
    async function createDevicePairingCode() {
        clearInterval(devicePairingTicker);
        const content = document.getElementById('devicePairingContent');
        content.innerHTML = '<p style="color:var(--text-secondary);">A gerar código...</p>';
        try {
            const res = await fetch('/api/device-pairing/create', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': APP.token },
                body: JSON.stringify({ origin: location.origin })
            });
            const data = await res.json();
            if (!res.ok) { content.innerHTML = `<p style="color:var(--text-secondary);">⚠️ ${escapeHtml(data.error || 'Não foi possível gerar o código.')}</p>`; return; }
            content.innerHTML = `<img src="${data.qrDataUrl}" style="width:220px;height:220px;border-radius:8px;background:#fff;padding:8px;" alt="Código QR"><div id="devicePairingCountdown" style="margin-top:8px;font-size:12px;color:var(--text-secondary);"></div>`;
            const expiresAt = Date.now() + data.expiresInSec * 1000;
            devicePairingTicker = setInterval(() => pollDevicePairing(data.pairingToken, expiresAt), 2000);
            pollDevicePairing(data.pairingToken, expiresAt);
        } catch (e) {
            content.innerHTML = '<p style="color:var(--text-secondary);">⚠️ Não foi possível gerar o código agora.</p>';
        }
    }
    async function pollDevicePairing(pairingToken, expiresAt) {
        // Se o modal foi fechado por fora (clique no fundo escuro, que não
        // passa pelo closeDevicePairingModal()), pára de consultar o servidor.
        if (!document.getElementById('modalDevicePairing').classList.contains('active')) {
            clearInterval(devicePairingTicker);
            return;
        }
        const countdownEl = document.getElementById('devicePairingCountdown');
        const remaining = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
        if (countdownEl) countdownEl.textContent = remaining > 0 ? `Expira em ${remaining}s` : 'A expirar...';
        try {
            const res = await fetch(`/api/device-pairing/status?pairingToken=${encodeURIComponent(pairingToken)}`, { headers: { 'X-Auth-Token': APP.token } });
            const data = await res.json();
            if (data.status === 'completed') {
                clearInterval(devicePairingTicker);
                document.getElementById('devicePairingContent').innerHTML = `<p style="font-size:15px;">✅ Associado a "${escapeHtml(data.deviceName || 'novo dispositivo')}" com sucesso!</p>`;
                setTimeout(() => closeModal('modalDevicePairing'), 2500);
            } else if (data.status === 'expired') {
                clearInterval(devicePairingTicker);
                document.getElementById('devicePairingContent').innerHTML = `<p style="color:var(--text-secondary);margin-bottom:10px;">Código expirado.</p><button class="btn-small btn-accept" onclick="createDevicePairingCode()">Gerar novo código</button>`;
            }
        } catch (e) {
            // falha momentânea a consultar o estado — tenta de novo no próximo tick, sem incomodar com um alerta
        }
    }

    // ==================== TEMA CLARO/ESCURO ====================
    (function initTheme() {
        const saved = localStorage.getItem('themeMode') || 'dark';
        document.documentElement.setAttribute('data-theme', saved);
    })();
    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = current === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('themeMode', next);
        applyAccentColor(localStorage.getItem('accentColor') || DEFAULT_ACCENT, { save: false });
        applyChatWallpaper(localStorage.getItem('chatWallpaper') || null, { save: false });
    }

    // ==================== COR DE DESTAQUE PERSONALIZADA ====================
    const DEFAULT_ACCENT = '#7c5cff';
    const ACCENT_PRESETS = [
        { name: 'Violeta', hex: '#7c5cff' },
        { name: 'Índigo', hex: '#4f6df5' },
        { name: 'Céu', hex: '#0ea5e9' },
        { name: 'Turquesa', hex: '#14b8a6' },
        { name: 'Esmeralda', hex: '#10b981' },
        { name: 'Âmbar', hex: '#f59e0b' },
        { name: 'Coral', hex: '#fb7185' },
        { name: 'Rosa', hex: '#ec4899' }
    ];
    function hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const n = parseInt(hex, 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
    function rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
    }
    function mixColor(hex, withHex, ratio) {
        const a = hexToRgb(hex), b = hexToRgb(withHex);
        return rgbToHex(a.r + (b.r - a.r) * ratio, a.g + (b.g - a.g) * ratio, a.b + (b.b - a.b) * ratio);
    }
    function getAccentHex() {
        return (localStorage.getItem('accentColor') || DEFAULT_ACCENT);
    }
    function applyAccentColor(hex, opts = {}) {
        if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
        const root = document.documentElement;
        root.style.setProperty('--green', hex);
        const isLight = root.getAttribute('data-theme') === 'light';
        const bubble = isLight ? mixColor(hex, '#ffffff', 0.85) : mixColor(hex, '#000000', 0.35);
        root.style.setProperty('--green-dark', bubble);
        root.style.setProperty('--msg-out', bubble);
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) metaTheme.setAttribute('content', hex);
        const label = document.getElementById('accentColorHex');
        if (label) label.textContent = hex.toUpperCase();
        const picker = document.getElementById('accentColorPicker');
        if (picker) picker.value = hex;
        if (opts.save !== false) localStorage.setItem('accentColor', hex);
    }
    // Guarda a cor no servidor, associada à conta — assim ela acompanha a
    // pessoa quando faz login noutro aparelho (chamar só em escolhas
    // "finais", não a cada frame do arrastar do seletor de cor).
    function syncAccentColorToServer(hex) {
        if (!APP.user || !socket) return;
        socket.emit('update_accent_color', { color: hex });
    }
    function chooseAccentColor(hex) {
        applyAccentColor(hex);
        syncAccentColorToServer(hex);
    }
    function resetAccentColor() {
        localStorage.removeItem('accentColor');
        applyAccentColor(DEFAULT_ACCENT, { save: false });
        syncAccentColorToServer(DEFAULT_ACCENT);
    }
    function renderAccentPresets() {
        const el = document.getElementById('accentPresets');
        if (!el) return;
        el.innerHTML = ACCENT_PRESETS.map(p =>
            `<button onclick="chooseAccentColor('${p.hex}')" title="${p.name}" style="width:34px;height:34px;border-radius:50%;border:2px solid var(--bg-tertiary);background:${p.hex};cursor:pointer;padding:0;"></button>`
        ).join('');
    }
    function openCustomizeModal() {
        const current = getAccentHex();
        renderAccentPresets();
        renderWallpaperPresets();
        applyAccentColor(current, { save: false });
        const savedFontSize = localStorage.getItem('msgFontSize') || '14';
        document.getElementById('msgFontSizeSlider').value = savedFontSize;
        document.getElementById('msgFontSizeLabel').textContent = savedFontSize + 'px';
        document.getElementById('modalCustomize').classList.add('active');
    }
    (function initAccentColor() {
        applyAccentColor(getAccentHex(), { save: false });
    })();

    // ==================== TAMANHO DO TEXTO DAS MENSAGENS ====================
    function applyMsgFontSize(px) {
        document.documentElement.style.setProperty('--font-size-msg', px + 'px');
        document.getElementById('msgFontSizeLabel').textContent = px + 'px';
    }
    function saveMsgFontSize(px) {
        localStorage.setItem('msgFontSize', px);
    }
    (function initMsgFontSize() {
        applyMsgFontSize(localStorage.getItem('msgFontSize') || '14');
    })();

    // ==================== FUNDO DAS CONVERSAS PERSONALIZADO ====================
    const WALLPAPER_PRESETS = [
        { name: 'Padrão', value: null },
        { name: 'Grafite', value: '#1a1f24' },
        { name: 'Meia-noite', value: '#0d1321' },
        { name: 'Oceano', value: 'linear-gradient(135deg,#0f2027,#203a43,#2c5364)' },
        { name: 'Pôr do sol', value: 'linear-gradient(135deg,#3a1c71,#d76d77,#ffaf7b)' },
        { name: 'Floresta', value: 'linear-gradient(135deg,#134e5e,#71b280)' },
        { name: 'Ameixa', value: 'linear-gradient(135deg,#41295a,#2f0743)' }
    ];
    function applyChatWallpaper(value, opts = {}) {
        const root = document.documentElement;
        const isLight = root.getAttribute('data-theme') === 'light';
        root.style.setProperty('--bg-chat', value || (isLight ? '#efeae2' : '#0b141a'));
        if (opts.save !== false) {
            if (value) localStorage.setItem('chatWallpaper', value);
            else localStorage.removeItem('chatWallpaper');
        }
    }
    function syncChatWallpaperToServer(value) {
        if (!APP.user || !socket) return;
        socket.emit('update_chat_wallpaper', { wallpaper: value || '' });
    }
    function selectWallpaperPreset(value) {
        applyChatWallpaper(value);
        syncChatWallpaperToServer(value);
    }
    function resetChatWallpaper() {
        applyChatWallpaper(null);
        syncChatWallpaperToServer('');
    }
    function renderWallpaperPresets() {
        const el = document.getElementById('wallpaperPresets');
        if (!el) return;
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        el.innerHTML = WALLPAPER_PRESETS.map(p => {
            const bg = p.value || (isLight ? '#efeae2' : '#0b141a');
            const safeValue = p.value ? `'${p.value.replace(/'/g, "\\'")}'` : 'null';
            return `<button onclick="selectWallpaperPreset(${safeValue})" title="${p.name}" style="width:44px;height:44px;border-radius:10px;border:2px solid var(--bg-tertiary);background:${bg};cursor:pointer;padding:0;"></button>`;
        }).join('');
    }
    function handleWallpaperPhotoSelected(input) {
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) return alert('Escolhe um ficheiro de imagem.');
        const img = new Image();
        const reader = new FileReader();
        reader.onload = () => {
            img.onload = async () => {
                const maxW = 900, maxH = 1400;
                const scale = Math.min(1, maxW / img.width, maxH / img.height);
                const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
                let finalUrl = dataUrl;
                try {
                    const res = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token || '' }, body: JSON.stringify({ fileData: dataUrl }) });
                    const data = await res.json();
                    if (data.success && data.url) finalUrl = data.url;
                } catch (e) { /* mantém o dataUrl local se o upload falhar */ }
                const cssValue = `url('${finalUrl}') center/cover no-repeat`;
                applyChatWallpaper(cssValue);
                syncChatWallpaperToServer(cssValue);
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    }
    (function initChatWallpaper() {
        applyChatWallpaper(localStorage.getItem('chatWallpaper') || null, { save: false });
    })();

    // ==================== FOTO DE PERFIL ====================
    function avatarInnerHtml(name, avatarUrl) {
        return avatarUrl ? `<img src="${avatarUrl}" alt="${escapeHtml(name || '')}">` : escapeHtml((name || '?').charAt(0).toUpperCase());
    }
    function hasActiveStatus(phone) {
        const feed = APP.statusFeed.find(s => s.phone === phone);
        return !!(feed && feed.items && feed.items.length);
    }
    function renderHeaderAvatar() {
        const el = document.getElementById('headerAvatar');
        if (!el || !APP.user) return;
        el.innerHTML = avatarInnerHtml(APP.user.name, APP.user.avatarUrl);
        el.classList.toggle('avatar-status-ring', hasActiveStatus(APP.user.phone));
    }
    function openProfileModal() {
        if (!APP.user) return;
        document.getElementById('profilePhotoPreview').innerHTML = avatarInnerHtml(APP.user.name, APP.user.avatarUrl);
        document.getElementById('profileNameLabel').textContent = APP.user.name;
        document.getElementById('profilePhoneLabel').textContent = APP.user.phone + (APP.user.username ? ' · @' + APP.user.username : '');
        document.getElementById('profileUsernameInput').value = APP.user.username || '';
        const select = document.getElementById('profileLangSelect');
        select.innerHTML = TRANSLATE_LANGUAGES.map(l => `<option value="${l.code}">${l.label}</option>`).join('');
        select.value = APP.user.preferredLang || 'pt';
        document.getElementById('profileBirthdayInput').value = APP.user.birthday || '';
        document.getElementById('profilePixKeyInput').value = APP.user.pixKey || '';
        document.getElementById('profileEmailInput').value = APP.user.email || '';
        document.getElementById('twoFactorCheck').checked = !!APP.user.twoFactorEnabled;
        document.getElementById('hideOnlineStatusCheck').checked = !!APP.user.hideOnlineStatus;
        document.getElementById('hideReadReceiptsCheck').checked = !!APP.user.hideReadReceipts;
        loadDndSettingsIntoProfile();
        renderGoogleCalendarProfileSection();
        renderSlackProfileSection();
        if (window.PublicKeyCredential) { document.getElementById('webauthnSection').style.display = 'block'; loadWebauthnCredentials(); }
        document.getElementById('modalProfile').classList.add('active');
    }
    function saveProfileUsername() {
        if (!APP.user) return;
        const username = document.getElementById('profileUsernameInput').value.trim();
        if (!username) return;
        socket.emit('set_username', { username });
    }
    socket.on('username_updated', (data) => {
        if (!APP.user || !data) return;
        document.getElementById('profileUsernameInput').value = data.username || '';
        if (data.error) { alert(data.error); return; }
        APP.user.username = data.username;
        document.getElementById('profilePhoneLabel').textContent = APP.user.phone + (APP.user.username ? ' · @' + APP.user.username : '');
    });
    function saveProfileEmail(email) {
        if (!APP.user) return;
        socket.emit('set_email', { email: email.trim() });
    }
    socket.on('email_updated', (data) => {
        if (!APP.user || !data) return;
        if (data.error) { alert(data.error); document.getElementById('profileEmailInput').value = APP.user.email || ''; return; }
        APP.user.email = data.email;
        if (typeof data.twoFactorEnabled === 'boolean') {
            APP.user.twoFactorEnabled = data.twoFactorEnabled;
            document.getElementById('twoFactorCheck').checked = data.twoFactorEnabled;
        }
        localStorage.setItem('authUser', JSON.stringify(APP.user));
    });
    function saveTwoFactorSetting() {
        if (!APP.user) return;
        const enabled = document.getElementById('twoFactorCheck').checked;
        socket.emit('set_two_factor', { enabled });
    }
    socket.on('two_factor_updated', (data) => {
        if (!APP.user || !data) return;
        APP.user.twoFactorEnabled = !!data.twoFactorEnabled;
        document.getElementById('twoFactorCheck').checked = APP.user.twoFactorEnabled;
        localStorage.setItem('authUser', JSON.stringify(APP.user));
        if (data.error) alert(data.error);
    });

    // ==================== GOOGLE CALENDAR (ligação da conta) ====================
    // Ver server.js ("GOOGLE CALENDAR") para a troca de OAuth em si — aqui só
    // se pede o estado atual e se reflete no perfil. A sincronização de cada
    // grupo em si liga-se dentro do próprio calendário do grupo (mais abaixo).
    function connectGoogleCalendar() {
        if (!APP.token) return;
        location.href = '/api/google-calendar/connect?token=' + encodeURIComponent(APP.token);
    }
    function disconnectGoogleCalendar() {
        if (!confirm('Desligar o Google Calendar? Os grupos que sincronizavas param de receber novidades (o calendário e os eventos já criados na Google ficam intactos).')) return;
        socket.emit('google_calendar_disconnect');
    }
    function renderGoogleCalendarProfileSection() {
        const box = document.getElementById('googleCalendarProfileBox');
        if (!box || !APP.user) return;
        box.innerHTML = APP.user.googleCalendarConnected
            ? `<p style="color:#8696a0;font-size:11px;margin:0 0 8px;">✅ Conta Google ligada. Em cada grupo, abre "📆 Calendário" para ligar a sincronização desse grupo.</p><button class="btn-small btn-danger" onclick="disconnectGoogleCalendar()">Desligar Google Calendar</button>`
            : `<p style="color:#8696a0;font-size:11px;margin:0 0 8px;">Sincroniza os calendários dos teus grupos com o Google Calendar (nos dois sentidos, num calendário próprio por grupo).</p><button class="btn-small btn-accept" onclick="connectGoogleCalendar()">🔗 Ligar ao Google Calendar</button>`;
    }
    socket.on('google_calendar_status', (data) => {
        if (!APP.user || !data) return;
        APP.user.googleCalendarConnected = !!data.connected;
        APP.user.googleCalendarSyncedRooms = data.syncedRooms || [];
        localStorage.setItem('authUser', JSON.stringify(APP.user));
        renderGoogleCalendarProfileSection();
        if (APP.pendingGoogleCalendarResult) {
            const result = APP.pendingGoogleCalendarResult;
            APP.pendingGoogleCalendarResult = null;
            if (result === 'connected') alert('✅ Conta Google ligada! Agora podes ativar a sincronização em cada grupo, dentro do calendário do grupo.');
            else alert('⚠️ Não foi possível ligar a conta Google. Tenta novamente.');
        }
    });
    socket.on('google_calendar_disconnected', () => {
        if (!APP.user) return;
        APP.user.googleCalendarConnected = false;
        APP.user.googleCalendarSyncedRooms = [];
        localStorage.setItem('authUser', JSON.stringify(APP.user));
        renderGoogleCalendarProfileSection();
    });

    // ==================== SLACK (ligação da conta) ====================
    // Ver server.js ("SLACK") para o OAuth e a ponte de mensagens em si —
    // aqui só se pede o estado atual e reflete-se no perfil. Ligar/desligar
    // o CANAL de cada grupo faz-se dentro do próprio grupo (mais abaixo).
    function connectSlack() {
        if (!APP.token) return;
        location.href = '/api/slack/connect?token=' + encodeURIComponent(APP.token);
    }
    function disconnectSlack() {
        if (!confirm('Desligar o Slack? Os grupos que tinham um canal ligado deixam de espelhar mensagens para lá.')) return;
        socket.emit('slack_disconnect');
    }
    function renderSlackProfileSection() {
        const box = document.getElementById('slackProfileBox');
        if (!box || !APP.user) return;
        box.innerHTML = APP.user.slackConnected
            ? `<p style="color:#8696a0;font-size:11px;margin:0 0 8px;">✅ Ligado ao workspace "${escapeHtml(APP.user.slackTeamName || '')}". Em cada grupo, abre "💬 Slack" para ligar o canal desse grupo.</p><button class="btn-small btn-danger" onclick="disconnectSlack()">Desligar Slack</button>`
            : `<p style="color:#8696a0;font-size:11px;margin:0 0 8px;">Liga um canal do Slack a um grupo — mensagens aparecem nos dois lados.</p><button class="btn-small btn-accept" onclick="connectSlack()">🔗 Ligar ao Slack</button>`;
    }
    socket.on('slack_status', (data) => {
        if (!APP.user || !data) return;
        APP.user.slackConnected = !!data.connected;
        APP.user.slackTeamName = data.teamName || null;
        APP.user.slackLinkedRooms = data.channels || {};
        localStorage.setItem('authUser', JSON.stringify(APP.user));
        renderSlackProfileSection();
        if (APP.pendingSlackResult) {
            const result = APP.pendingSlackResult;
            APP.pendingSlackResult = null;
            if (result === 'connected') alert('✅ Slack ligado! Agora podes ligar um canal em cada grupo, dentro do menu "⋯ Mais desta conversa" → "💬 Slack".');
            else alert('⚠️ Não foi possível ligar o Slack. Tenta novamente.');
        }
    });
    socket.on('slack_disconnected', () => {
        if (!APP.user) return;
        APP.user.slackConnected = false;
        APP.user.slackTeamName = null;
        APP.user.slackLinkedRooms = {};
        localStorage.setItem('authUser', JSON.stringify(APP.user));
        renderSlackProfileSection();
    });

    // ==================== OS MEUS DADOS (exportar / apagar conta) ====================
    async function exportMyData() {
        if (!APP.token) return;
        try {
            const res = await fetch('/api/account/export', { headers: { 'x-auth-token': APP.token } });
            if (!res.ok) { alert('Não foi possível exportar os teus dados agora.'); return; }
            const data = await res.json();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'os-meus-dados-chatapp.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            alert('Não foi possível ligar ao servidor.');
        }
    }
    async function handleImportDataFileSelected(input) {
        const file = input.files[0];
        input.value = ''; // permite escolher o mesmo ficheiro outra vez, se precisar
        if (!file) return;
        let data;
        try {
            data = JSON.parse(await file.text());
        } catch (err) {
            alert('Esse ficheiro não é um JSON válido — usa o ficheiro tal como "Exportar os meus dados" o gerou, sem o editar.');
            return;
        }
        if (!confirm('Isto vai trazer de volta idioma, aniversário, chave Pix, contactos, lembretes, lista de compras e favoritos de turismo deste ficheiro para a tua conta atual (nunca mensagens, senha ou nome de utilizador). Continuar?')) return;
        try {
            const res = await fetch('/api/account/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token },
                body: JSON.stringify({ data })
            });
            const result = await res.json();
            if (!res.ok) { alert(result.error || 'Não foi possível restaurar os dados.'); return; }
            // Sem isto, o location.reload() a seguir voltava a carregar o perfil
            // "authUser" antigo já guardado no localStorage (de antes do
            // restauro) — os campos ficavam certos no servidor mas nunca
            // apareciam no ecrã até a pessoa sair e entrar de novo.
            if (result.user) { APP.user = result.user; localStorage.setItem('authUser', JSON.stringify(result.user)); }
            const r = result.resumo;
            alert(`Dados restaurados:\n- Contactos readicionados: ${r.contactos}\n- Lembretes trazidos de volta: ${r.lembretes}\n- Favoritos de turismo trazidos de volta: ${r.favoritosDeTurismo}\n- Lista de compras restaurada: ${r.listaDeCompras ? 'sim' : 'não havia nenhuma no ficheiro, ou já tinhas uma'}\n\nA página vai recarregar para tudo aparecer certo.`);
            location.reload();
        } catch (err) {
            alert('Não foi possível ligar ao servidor.');
        }
    }
    function openDeleteAccountModal() {
        document.getElementById('deleteAccountPasswordInput').value = '';
        document.getElementById('deleteAccountError').textContent = '';
        document.getElementById('modalDeleteAccount').classList.add('active');
    }
    async function confirmDeleteAccount() {
        const password = document.getElementById('deleteAccountPasswordInput').value;
        const errEl = document.getElementById('deleteAccountError');
        errEl.textContent = '';
        if (!password) { errEl.textContent = 'Confirma a tua senha para continuar.'; return; }
        if (!confirm('Tens mesmo a certeza? Isto é permanente e não pode ser desfeito.')) return;
        try {
            const res = await fetch('/api/account/delete', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token }, body: JSON.stringify({ password }) });
            const data = await res.json();
            if (!res.ok) { errEl.textContent = data.error || 'Erro ao apagar a conta.'; return; }
            closeModal('modalDeleteAccount');
            alert('A tua conta foi apagada.');
            logout();
        } catch (err) {
            errEl.textContent = 'Não foi possível ligar ao servidor.';
        }
    }
    // Chega às OUTRAS sessões/aparelhos desta conta quando alguém a apaga a
    // partir de um deles — sem isto, esses aparelhos ficavam com um socket
    // desligado e nenhuma explicação, parecendo só uma falha de rede.
    socket.on('account_deleted', () => {
        alert('Esta conta foi apagada (noutro dispositivo, ou agora mesmo).');
        logout();
    });
    socket.on('password_was_reset', () => {
        alert('A senha desta conta foi redefinida — por segurança, todas as sessões foram encerradas. Entra de novo com a nova senha.');
        logout();
    });
    function savePrivacySettings() {
        if (!APP.user) return;
        const hideOnlineStatus = document.getElementById('hideOnlineStatusCheck').checked;
        const hideReadReceipts = document.getElementById('hideReadReceiptsCheck').checked;
        APP.user.hideOnlineStatus = hideOnlineStatus;
        APP.user.hideReadReceipts = hideReadReceipts;
        localStorage.setItem('authUser', JSON.stringify(APP.user));
        socket.emit('set_privacy', { hideOnlineStatus, hideReadReceipts });
    }
    socket.on('privacy_updated', (data) => {
        if (!APP.user || !data) return;
        APP.user.hideOnlineStatus = !!data.hideOnlineStatus;
        APP.user.hideReadReceipts = !!data.hideReadReceipts;
        localStorage.setItem('authUser', JSON.stringify(APP.user));
        if (document.getElementById('modalProfile').classList.contains('active')) {
            document.getElementById('hideOnlineStatusCheck').checked = APP.user.hideOnlineStatus;
            document.getElementById('hideReadReceiptsCheck').checked = APP.user.hideReadReceipts;
        }
    });
    function setBirthday(birthday) {
        if (!APP.user || !birthday) return;
        APP.user.birthday = birthday;
        localStorage.setItem('authUser', JSON.stringify(APP.user));
        socket.emit('set_birthday', { birthday });
        checkBirthdaysToday();
    }
    function saveProfilePixKey(pixKey) {
        if (!APP.user) return;
        socket.emit('set_pix_key', { pixKey: pixKey.trim() });
    }
    socket.on('pix_key_updated', (data) => {
        if (!APP.user || !data) return;
        APP.user.pixKey = data.pixKey || null;
        localStorage.setItem('authUser', JSON.stringify(APP.user));
    });
    function setPreferredLang(lang) {
        if (!APP.user) return;
        APP.user.preferredLang = lang;
        localStorage.setItem('authUser', JSON.stringify(APP.user));
        socket.emit('set_preferred_lang', { lang });
    }
    socket.on('preferred_lang_updated', (data) => {
        if (!APP.user || !data?.lang) return;
        APP.user.preferredLang = data.lang;
        localStorage.setItem('authUser', JSON.stringify(APP.user));
    });
    function handleProfilePhotoSelected(input) {
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) return alert('Escolhe um ficheiro de imagem.');
        const img = new Image();
        const reader = new FileReader();
        reader.onload = () => {
            img.onload = async () => {
                const size = 400; // recorta ao centro e reduz — evita fotos gigantes desnecessárias
                const canvas = document.createElement('canvas');
                canvas.width = size; canvas.height = size;
                const ctx = canvas.getContext('2d');
                const minSide = Math.min(img.width, img.height);
                const sx = (img.width - minSide) / 2, sy = (img.height - minSide) / 2;
                ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                let finalUrl = dataUrl;
                try {
                    const res = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token || '' }, body: JSON.stringify({ fileData: dataUrl }) });
                    const data = await res.json();
                    if (data.success && data.url) finalUrl = data.url;
                } catch (e) { /* mantém o dataUrl local se o upload falhar */ }
                socket.emit('update_avatar', { avatarUrl: finalUrl });
                document.getElementById('profilePhotoPreview').innerHTML = avatarInnerHtml(APP.user.name, finalUrl);
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    }
    socket.on('avatar_updated', (data) => {
        if (!APP.user || !data?.avatarUrl) return;
        APP.user.avatarUrl = data.avatarUrl;
        localStorage.setItem('authUser', JSON.stringify(APP.user));
        renderHeaderAvatar();
    });

    // ==================== TRADUÇÃO AUTOMÁTICA (por conversa) ====================
    // Guarda, por conversa, se as mensagens recebidas devem ser traduzidas
    // sozinhas para a "língua que eu falo" (definida em O meu perfil) — sem
    // precisar de tocar no 🌐 em cada mensagem. Fica guardado no aparelho.
    APP.autoTranslateChats = new Set(JSON.parse(localStorage.getItem('autoTranslateChats') || '[]'));
    function toggleAutoTranslate() {
        if (!APP.currentChatId) return;
        if (APP.autoTranslateChats.has(APP.currentChatId)) APP.autoTranslateChats.delete(APP.currentChatId);
        else APP.autoTranslateChats.add(APP.currentChatId);
        localStorage.setItem('autoTranslateChats', JSON.stringify([...APP.autoTranslateChats]));
        updateAutoTranslateButton();
    }
    function updateAutoTranslateButton() {
        const btn = document.getElementById('autoTranslateBtn');
        if (!btn) return;
        const on = APP.currentChatId && APP.autoTranslateChats.has(APP.currentChatId);
        btn.classList.toggle('btn-accept', !!on);
        btn.title = on ? 'Tradução automática LIGADA nesta conversa — toca para desligar' : 'Ligar tradução automática nesta conversa';
    }
    // Traduz um texto para a língua da pessoa, só se a língua detetada for
    // mesmo diferente (poupa pedidos e evita "traduzir" o que já está certo).
    async function autoTranslateIfNeeded(text) {
        if (!text || !text.trim()) return null;
        const target = APP.user?.preferredLang || 'pt';
        try {
            const res = await fetch(`/api/translate?text=${encodeURIComponent(text)}&target=${encodeURIComponent(target)}`);
            const data = await res.json();
            if (!res.ok) return null;
            if (data.detected && data.detected === target) return null; // já está na língua certa
            return { text: data.translated, lang: target };
        } catch (e) {
            return null;
        }
    }

    // ==================== ESTADOS (stories, 24h) ====================
    function openStatusScreen() {
        document.getElementById('statusScreen').classList.add('active');
        socket.emit('get_statuses');
        renderStatusPanel();
    }
    function closeStatusScreen() { document.getElementById('statusScreen').classList.remove('active'); }
    function renderStatusPanel() {
        const panel = document.getElementById('statusPanel');
        const mine = APP.statusFeed.find(s => s.phone === APP.user?.phone);
        const others = APP.statusFeed.filter(s => s.phone !== APP.user?.phone);
        const mineTapAction = mine ? `viewStatusFeed('${APP.user.phone}')` : 'openNewStatusModal()';
        let html = `
        <div class="chat-item">
            <div class="chat-item-avatar avatar-user${mine ? ' avatar-status-ring' : ''}" onclick="${mineTapAction}">${mine ? avatarInnerHtml(APP.user.name, APP.user.avatarUrl) : '➕'}</div>
            <div class="chat-item-info" onclick="${mineTapAction}">
                <h4>O meu estado</h4>
                <p>${mine ? mine.items.length + ' estado(s) ativo(s) — toca para ver ou apagar' : 'Toca para adicionar um estado'}</p>
            </div>
            ${mine ? `<button class="btn-icon" style="width:34px;height:34px;font-size:16px;flex:0 0 auto;" onclick="openNewStatusModal()" title="Adicionar novo estado">➕</button>` : ''}
        </div>`;
        if (others.length === 0) {
            html += '<p style="color:#8696a0;text-align:center;padding:30px;">Nenhum estado dos teus contactos nas últimas 24h</p>';
        } else {
            others.forEach(s => {
                const last = s.items[s.items.length - 1];
                html += `
                <div class="chat-item" onclick='viewStatusFeed(${JSON.stringify(s.phone)})'>
                    <div class="chat-item-avatar avatar-user avatar-status-ring">${avatarInnerHtml(s.name, s.avatarUrl)}</div>
                    <div class="chat-item-info">
                        <h4>${escapeHtml(s.name)}</h4>
                        <p>${s.items.length} estado(s) · ${new Date(last.postedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                </div>`;
            });
        }
        panel.innerHTML = html;
    }
    socket.on('statuses_update', (feed) => {
        APP.statusFeed = feed || [];
        if (document.getElementById('statusScreen').classList.contains('active')) renderStatusPanel();
        renderHeaderAvatar(); // liga/desliga o anel verde do meu próprio avatar
        renderChatList(); // liga/desliga o anel verde à volta dos avatares dos contactos com estado ativo
    });
    function openNewStatusModal() {
        APP.pendingStatusPhotoUrl = null;
        document.getElementById('newStatusText').value = '';
        document.getElementById('newStatusPhotoPreview').style.display = 'none';
        document.getElementById('modalNewStatus').classList.add('active');
    }
    function handleStatusPhotoSelected(input) {
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) return alert('Escolhe um ficheiro de imagem.');
        const img = new Image();
        const reader = new FileReader();
        reader.onload = () => {
            img.onload = async () => {
                const maxW = 720;
                const scale = Math.min(1, maxW / img.width);
                const canvas = document.createElement('canvas');
                canvas.width = img.width * scale; canvas.height = img.height * scale;
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                let finalUrl = dataUrl;
                try {
                    const res = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token || '' }, body: JSON.stringify({ fileData: dataUrl }) });
                    const data = await res.json();
                    if (data.success && data.url) finalUrl = data.url;
                } catch (e) { /* mantém o dataUrl local se o upload falhar */ }
                APP.pendingStatusPhotoUrl = finalUrl;
                document.getElementById('newStatusPhotoImg').src = finalUrl;
                document.getElementById('newStatusPhotoPreview').style.display = 'block';
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    }
    function postStatus() {
        const text = document.getElementById('newStatusText').value.trim();
        if (!text && !APP.pendingStatusPhotoUrl) return alert('Escreve algo ou escolhe uma foto.');
        socket.emit('post_status', { text, photoData: APP.pendingStatusPhotoUrl });
        closeModal('modalNewStatus');
    }
    // Reaproveita o mesmo editor de fotos já usado nos anexos de conversa (ver openPhotoEditor).
    // Diferença aqui: a foto do estado já pode estar num URL remoto (Cloudinary) em vez de um
    // dataUrl local, por já ter sido carregada ao ser escolhida — por isso, ao gravar a edição,
    // volta a carregar para o Cloudinary da mesma forma que handleStatusPhotoSelected já fazia,
    // para o estado publicado não ficar preso ao dataUrl local.
    function editStatusPhoto() {
        if (!APP.pendingStatusPhotoUrl) return;
        openPhotoEditor({
            dataUrl: APP.pendingStatusPhotoUrl,
            onSave: async (dataUrl) => {
                let finalUrl = dataUrl;
                try {
                    const res = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token || '' }, body: JSON.stringify({ fileData: dataUrl }) });
                    const data = await res.json();
                    if (data.success && data.url) finalUrl = data.url;
                } catch (e) { /* mantém o dataUrl local se o upload falhar */ }
                APP.pendingStatusPhotoUrl = finalUrl;
                document.getElementById('newStatusPhotoImg').src = finalUrl;
            }
        });
    }
    APP.viewingStatus = null;
    function viewStatusFeed(phone) {
        const feed = APP.statusFeed.find(s => s.phone === phone);
        if (!feed || !feed.items.length) return;
        APP.viewingStatus = { phone, items: feed.items, index: 0, name: feed.name, avatarUrl: feed.avatarUrl };
        showStatusItem();
    }
    function showStatusItem() {
        const v = APP.viewingStatus;
        if (!v) return;
        const item = v.items[v.index];
        document.getElementById('statusViewerName').textContent = v.name;
        document.getElementById('statusViewerAvatar').innerHTML = v.avatarUrl ? `<img src="${v.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : v.name.charAt(0).toUpperCase();
        document.getElementById('statusViewerTime').textContent = new Date(item.postedAt).toLocaleString('pt-BR');
        document.getElementById('statusViewerText').textContent = item.text || '';
        const photoBox = document.getElementById('statusViewerPhoto');
        if (item.photoData) { photoBox.style.display = 'block'; document.getElementById('statusViewerImg').src = item.photoData; }
        else photoBox.style.display = 'none';
        const navBox = document.getElementById('statusViewerNav');
        if (v.items.length > 1) {
            navBox.style.display = 'flex';
            document.getElementById('statusViewerCount').textContent = `${v.index + 1} / ${v.items.length}`;
        } else {
            navBox.style.display = 'none';
        }
        document.getElementById('statusViewerOwnActions').style.display = v.phone === APP.user?.phone ? 'block' : 'none';
        const seenBox = document.getElementById('statusViewerSeenBy');
        if (v.phone === APP.user?.phone) {
            // É o meu próprio estado — mostra quem já viu, em vez de registar uma visualização
            const viewers = item.viewedBy || [];
            seenBox.style.display = 'block';
            seenBox.textContent = viewers.length ? `👁️ Visto por: ${viewers.map(x => x.name).join(', ')}` : '👁️ Ainda ninguém viu este estado';
        } else {
            seenBox.style.display = 'none';
            socket.emit('view_status', { ownerPhone: v.phone, statusId: item.id });
        }
        document.getElementById('modalViewStatus').classList.add('active');
    }
    function statusViewerPrev() {
        const v = APP.viewingStatus;
        if (!v) return;
        v.index = (v.index - 1 + v.items.length) % v.items.length;
        showStatusItem();
    }
    function statusViewerNext() {
        const v = APP.viewingStatus;
        if (!v) return;
        v.index = (v.index + 1) % v.items.length;
        showStatusItem();
    }
    function deleteViewedStatus() {
        const v = APP.viewingStatus;
        if (!v) return;
        socket.emit('delete_status', { statusId: v.items[v.index].id });
        closeModal('modalViewStatus');
    }

    // ==================== HISTÓRICO DE CHAMADAS ====================
    APP.callLog = [];
    APP.callDirection = null;
    function logCallEvent(status) {
        const durationSec = APP.callStartTime ? Math.floor((Date.now() - APP.callStartTime) / 1000) : 0;
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        socket.emit('call_log_entry', {
            peerPhone: callPeerPhone || chat?.phone || null,
            peerName: chat?.name || 'Alguém',
            type: APP.callType || 'voice',
            direction: APP.callDirection || 'outgoing',
            status, durationSec
        });
        APP.callDirection = null;
    }
    socket.on('call_log_update', (log) => { APP.callLog = log || []; renderCallLog(); });
    function openCallLogScreen() {
        document.getElementById('callLogScreen').classList.add('active');
        socket.emit('get_call_log');
        renderCallLog();
    }
    function closeCallLogScreen() { document.getElementById('callLogScreen').classList.remove('active'); }
    function renderCallLog() {
        const el = document.getElementById('callLogList');
        if (!el) return;
        if (!APP.callLog.length) { el.innerHTML = '<p style="color:#8696a0;text-align:center;padding:30px;">Sem chamadas ainda</p>'; return; }
        el.innerHTML = APP.callLog.map(c => {
            const icon = c.status === 'missed' ? '📵' : (c.direction === 'outgoing' ? '📤' : '📥');
            const dur = c.durationSec ? `${Math.floor(c.durationSec / 60)}:${String(c.durationSec % 60).padStart(2, '0')}` : (c.status === 'declined' ? 'Recusada' : 'Sem resposta');
            return `
            <div class="chat-item" style="cursor:default;">
                <div class="chat-item-avatar avatar-user">${(c.peerName || 'A').charAt(0).toUpperCase()}</div>
                <div class="chat-item-info">
                    <h4>${icon} ${c.peerName} ${c.type === 'video' ? '📹' : '📞'}</h4>
                    <p>${new Date(c.timestamp).toLocaleString('pt-BR')} · ${dur}</p>
                </div>
                ${c.peerPhone ? `<button class="btn-icon" style="width:34px;height:34px;font-size:15px;flex:0 0 auto;" onclick="callBackFromLog('${c.peerPhone}','${c.type}')" title="Ligar de volta">${c.type === 'video' ? '📹' : '📞'}</button>` : ''}
            </div>`;
        }).join('');
    }
    function clearCallLog() { socket.emit('clear_call_log'); }

    // Liga logo de volta a partir do histórico — poupa ter de procurar a
    // conversa primeiro, sobretudo útil para chamadas perdidas.
    function callBackFromLog(phone, type) {
        const chat = APP.chats.find(c => c.type === 'user' && c.phone === phone);
        if (!chat) return alert('Ainda não tens esta pessoa nos teus contactos — procura-a primeiro para poderes ligar.');
        closeCallLogScreen();
        openChat(chat.id);
        setTimeout(() => startCall(type === 'video' ? 'video' : 'voice'), 200);
    }

    // ==================== MENSAGENS FIXADAS (até 10 por conversa) ====================
    APP.pinnedByChatId = {};
    socket.on('message_pinned_received', (data) => {
        if (!data?.chatId) return;
        const pins = Array.isArray(data.pins) ? data.pins : (data.pin ? [data.pin] : []);
        if (pins.length) APP.pinnedByChatId[data.chatId] = pins; else delete APP.pinnedByChatId[data.chatId];
        if (APP.currentChatId === data.chatId) { updatePinnedBanner(); renderMessages(); }
        if (document.getElementById('modalPinnedMessages').classList.contains('active')) renderPinnedMessagesList();
    });
    socket.on('message_pin_rejected', (data) => {
        if (data?.reason) alert(data.reason);
    });
    function updatePinnedBanner() {
        const banner = document.getElementById('pinnedBanner');
        const pins = APP.pinnedByChatId[APP.currentChatId] || [];
        if (!pins.length) { banner.style.display = 'none'; return; }
        banner.style.display = 'flex';
        if (pins.length === 1) {
            document.getElementById('pinnedBannerLabel').textContent = 'Mensagem fixada';
            document.getElementById('pinnedBannerText').textContent = `${pins[0].sender}: ${pins[0].text}`;
            document.getElementById('pinnedBannerUnpinBtn').style.display = 'block';
        } else {
            document.getElementById('pinnedBannerLabel').textContent = `${pins.length} mensagens fixadas`;
            document.getElementById('pinnedBannerText').textContent = 'Toca para ver todas';
            document.getElementById('pinnedBannerUnpinBtn').style.display = 'none';
        }
    }
    function pinMessage(msgId) {
        const msgs = APP.messages[APP.currentChatId];
        const msg = msgs?.find(m => m.id === msgId);
        if (!msg || !APP.currentChatId) return;
        socket.emit('pin_message', { chatId: APP.currentChatId, messageId: msgId, text: (msg.text || '').substring(0, 200), sender: msg.type === 'sent' ? 'Você' : msg.sender });
    }
    function unpinMessage(msgId) {
        if (!APP.currentChatId || !msgId) return;
        socket.emit('unpin_message', { chatId: APP.currentChatId, messageId: msgId });
    }
    function unpinBannerMessage() {
        const pins = APP.pinnedByChatId[APP.currentChatId] || [];
        if (pins.length === 1) unpinMessage(pins[0].messageId);
    }
    function onPinnedBannerClick() {
        const pins = APP.pinnedByChatId[APP.currentChatId] || [];
        if (pins.length <= 1) scrollToPinned(pins[0]?.messageId);
        else openPinnedMessagesModal();
    }
    function scrollToPinned(messageId) {
        const targetId = messageId || (APP.pinnedByChatId[APP.currentChatId] || [])[0]?.messageId;
        if (!targetId) return;
        const el = document.querySelector(`[data-msg-id="${targetId}"]`);
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.background = 'rgba(0,168,132,0.25)'; setTimeout(() => el.style.background = '', 1500); }
    }
    function openPinnedMessagesModal() {
        renderPinnedMessagesList();
        document.getElementById('modalPinnedMessages').classList.add('active');
    }
    function renderPinnedMessagesList() {
        const pins = APP.pinnedByChatId[APP.currentChatId] || [];
        const list = document.getElementById('pinnedMessagesList');
        list.innerHTML = pins.length ? pins.map(p => `
            <div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:8px 10px;display:flex;gap:8px;align-items:flex-start;">
                <div style="flex:1;cursor:pointer;overflow:hidden;" onclick="closeModal('modalPinnedMessages');scrollToPinned('${p.messageId}')">
                    <div style="font-size:12px;font-weight:600;">${escapeHtml(p.sender)}</div>
                    <div style="font-size:13px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.text)}</div>
                </div>
                <button onclick="unpinMessage('${p.messageId}')" title="Desafixar" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:14px;">✖️</button>
            </div>`).join('') : '<p style="color:#8696a0;font-size:13px;">Nenhuma mensagem fixada nesta conversa.</p>';
    }

    // ==================== MENSAGENS TEMPORÁRIAS ====================
    APP.disappearingByChatId = {};
    socket.on('disappearing_updated', (data) => {
        if (!data?.chatId) return;
        if (data.seconds > 0) APP.disappearingByChatId[data.chatId] = data.seconds; else delete APP.disappearingByChatId[data.chatId];
    });
    socket.on('message_expired', (data) => {
        if (!data?.chatId || !APP.messages[data.chatId]) return;
        APP.messages[data.chatId] = APP.messages[data.chatId].filter(m => m.id !== data.messageId);
        if (APP.currentChatId === data.chatId) renderMessages();
        renderChatList();
    });
    function openDisappearingModal() {
        if (!APP.currentChatId) return;
        document.getElementById('modalDisappearing').classList.add('active');
    }
    function setDisappearing(seconds) {
        if (!APP.currentChatId) return;
        socket.emit('set_disappearing', { chatId: APP.currentChatId, seconds });
        closeModal('modalDisappearing');
    }

    // ==================== SILENCIAR CONVERSA ====================
    APP.mutedChats = new Set();
    socket.on('muted_list', (list) => { APP.mutedChats = new Set(list || []); updateMuteButton(); });
    function toggleMuteChat() {
        if (!APP.currentChatId) return;
        const willMute = !APP.mutedChats.has(APP.currentChatId);
        if (willMute) APP.mutedChats.add(APP.currentChatId); else APP.mutedChats.delete(APP.currentChatId);
        socket.emit('set_muted', { chatId: APP.currentChatId, muted: willMute });
        updateMuteButton();
    }
    function updateMuteButton() {
        const btn = document.getElementById('muteToggleBtn');
        const icon = document.getElementById('muteToggleIcon');
        if (!btn || !icon) return;
        const muted = APP.currentChatId && APP.mutedChats.has(APP.currentChatId);
        icon.textContent = muted ? '🔕' : '🔔';
        btn.title = muted ? 'Reativar notificações' : 'Silenciar conversa';
    }

    // ==================== EXPORTAR CONVERSA ====================
    function exportChat() {
        if (!APP.currentChatId) return;
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        const msgs = APP.messages[APP.currentChatId] || [];
        const lines = msgs.map(m => `[${m.time || ''}] ${m.type === 'sent' ? 'Você' : m.sender}: ${m.deleted ? '(mensagem apagada)' : (m.fileData ? '(ficheiro/anexo)' : m.text)}`);
        const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `conversa_${(chat?.name || 'chat').replace(/[^a-zA-Z0-9]/g, '_')}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }
    // Mesma fonte de dados do exportChat() acima (texto simples), só que formatado
    // como um PDF com paginação automática em vez de um ficheiro .txt — reaproveita
    // o mesmo gerador (jsPDF, carregado sob demanda) já usado para a lista de compras.
    // Fotos/vídeos/documentos aparecem como "(anexo: nome)", nunca embutidos como
    // imagem — mesma limitação que o .txt já tinha, para manter isto simples.
    async function exportChatToPdf() {
        if (!APP.currentChatId) return;
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        const msgs = APP.messages[APP.currentChatId] || [];
        try {
            await loadJsPdfScript();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            const marginX = 14;
            const maxWidth = doc.internal.pageSize.getWidth() - marginX * 2;
            doc.setFontSize(16);
            doc.text(`Conversa: ${chat?.name || 'Chat'}`, marginX, 18);
            doc.setFontSize(9);
            doc.setTextColor(120);
            doc.text(`Exportado em ${new Date().toLocaleString('pt-BR')}`, marginX, 25);
            doc.setTextColor(0);
            doc.setFontSize(11);
            let y = 34;
            if (!msgs.length) doc.text('(Sem mensagens nesta conversa.)', marginX, y);
            msgs.forEach((m) => {
                const who = m.type === 'sent' ? 'Você' : (m.sender || 'Alguém');
                const body = m.deleted ? '(mensagem apagada)' : (m.fileData ? `(anexo: ${m.fileName || m.fileType || 'ficheiro'})` : (m.text || ''));
                const wrapped = doc.splitTextToSize(`[${m.time || ''}] ${who}: ${body}`, maxWidth);
                wrapped.forEach((line) => {
                    if (y > 280) { doc.addPage(); y = 20; }
                    doc.text(line, marginX, y);
                    y += 6;
                });
                y += 2;
            });
            doc.save(`conversa_${(chat?.name || 'chat').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
        } catch (err) {
            alert('⚠️ Não foi possível gerar o PDF agora: ' + err.message);
        }
    }

    // ==================== MENSAGENS AGENDADAS ====================
    APP.scheduledMessages = [];
    function openScheduleModal() {
        if (!APP.currentChatId) return;
        document.getElementById('scheduleMsgText').value = '';
        removeScheduleAttachment();
        const now = new Date(Date.now() + 5 * 60000);
        document.getElementById('scheduleMsgWhen').value = now.toISOString().slice(0, 16);
        document.getElementById('scheduleRecurrenceSelect').value = '';
        document.getElementById('modalScheduleMessage').classList.add('active');
    }

    // Atalhos rápidos para não ter de mexer no seletor de data/hora à mão —
    // "daqui a X horas/dias" ou "amanhã às Y horas". O seletor continua
    // disponível por baixo para qualquer outra data (não há limite máximo:
    // pode agendar-se para daqui a um dia, uma semana, um mês, o que for).
    function setScheduleQuickTime(unit, amount) {
        const input = document.getElementById('scheduleMsgWhen');
        const target = new Date();
        if (unit === 'hours') {
            target.setHours(target.getHours() + amount);
        } else if (unit === 'days') {
            target.setDate(target.getDate() + amount);
        } else if (unit === 'tomorrow') {
            target.setDate(target.getDate() + 1);
            target.setHours(amount, 0, 0, 0); // 'amount' aqui é a hora do dia (ex.: 9 = 9h da manhã)
        }
        // Ajusta para o fuso horário local antes de cortar para o formato do input
        const local = new Date(target.getTime() - target.getTimezoneOffset() * 60000);
        input.value = local.toISOString().slice(0, 16);
    }

    // ---- Anexo (foto/vídeo/ficheiro) para a mensagem agendada ----
    APP.scheduleAttachment = null; // { dataUrl, fileName, fileType, transcript }
    function handleScheduleFileAttach(input) {
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) return alert(`Este ficheiro tem ${(file.size / 1024 / 1024).toFixed(1)}MB — o limite é ${MAX_ATTACHMENT_MB}MB.`);
        const reader = new FileReader();
        reader.onload = () => {
            APP.scheduleAttachment = { dataUrl: reader.result, fileName: file.name, fileType: file.type, transcript: null };
            showScheduleAttachPreview();
        };
        reader.onerror = () => alert('Não foi possível ler o ficheiro.');
        reader.readAsDataURL(file);
    }
    function showScheduleAttachPreview() {
        const a = APP.scheduleAttachment;
        const box = document.getElementById('scheduleAttachPreview');
        if (!a) { box.style.display = 'none'; return; }
        box.style.display = 'flex';
        const icon = (a.fileType || '').startsWith('image/') ? '📷' : (a.fileType || '').startsWith('video/') ? '🎥' : (a.fileType || '').startsWith('audio/') ? '🎤' : '📎';
        document.getElementById('scheduleAttachLabel').textContent = `${icon} ${a.fileName}`;
    }
    function removeScheduleAttachment() {
        APP.scheduleAttachment = null;
        showScheduleAttachPreview();
    }

    // ---- Gravar um áudio diretamente para a mensagem agendada ----
    let scheduleRecorder = null, scheduleChunks = [], scheduleStream = null, scheduleRecordStart = 0, scheduleRecordTimer = null;
    function toggleScheduleVoiceRecording() {
        if (scheduleRecorder && scheduleRecorder.state === 'recording') { scheduleRecorder.stop(); return; }
        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            scheduleStream = stream;
            scheduleChunks = [];
            scheduleRecorder = new MediaRecorder(stream);
            scheduleRecorder.ondataavailable = (e) => { if (e.data.size > 0) scheduleChunks.push(e.data); };
            scheduleRecorder.onstop = () => {
                scheduleStream.getTracks().forEach(t => t.stop());
                clearInterval(scheduleRecordTimer);
                const btn = document.getElementById('scheduleRecordBtn');
                btn.textContent = '🎤 Gravar áudio';
                btn.classList.remove('btn-danger');
                if (!scheduleChunks.length) return;
                const blob = new Blob(scheduleChunks, { type: scheduleRecorder.mimeType || 'audio/webm' });
                if (blob.size > MAX_ATTACHMENT_MB * 1024 * 1024) return alert('Áudio muito longo (acima de ' + MAX_ATTACHMENT_MB + 'MB).');
                const reader = new FileReader();
                reader.onload = () => {
                    APP.scheduleAttachment = { dataUrl: reader.result, fileName: 'audio.webm', fileType: blob.type, transcript: null };
                    showScheduleAttachPreview();
                };
                reader.readAsDataURL(blob);
            };
            scheduleRecorder.start();
            scheduleRecordStart = Date.now();
            const btn = document.getElementById('scheduleRecordBtn');
            btn.classList.add('btn-danger');
            scheduleRecordTimer = setInterval(() => {
                const secs = Math.floor((Date.now() - scheduleRecordStart) / 1000);
                btn.textContent = '🔴 ' + secs + 's (toca para parar)';
                if (secs >= 240) scheduleRecorder.stop();
            }, 500);
        }).catch(err => alert('Não foi possível aceder ao microfone: ' + err.message));
    }

    async function submitScheduledMessage() {
        const text = document.getElementById('scheduleMsgText').value.trim();
        const when = document.getElementById('scheduleMsgWhen').value;
        const attachment = APP.scheduleAttachment;
        if (!text && !attachment) return alert('Escreve uma mensagem ou anexa uma foto/vídeo/áudio.');
        if (!when || !APP.currentChatId) return alert('Escolhe a data/hora.');
        const sendAt = new Date(when).getTime();
        if (sendAt <= Date.now()) return alert('Escolhe uma data/hora no futuro.');
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        const recurrence = document.getElementById('scheduleRecurrenceSelect').value || null;
        const payload = { chatId: APP.currentChatId, text, sendAt, toPhone: chat?.type === 'user' ? chat.phone : undefined, recurrence };
        if (attachment) {
            let uploadedUrl = attachment.dataUrl;
            try {
                const res = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token || '' }, body: JSON.stringify({ fileData: attachment.dataUrl }) });
                const data = await res.json();
                if (data.success && data.url) uploadedUrl = data.url;
            } catch (e) { /* mantém o dataUrl local se o upload falhar */ }
            payload.fileData = uploadedUrl;
            payload.fileName = attachment.fileName;
            payload.fileType = attachment.fileType;
            payload.transcript = attachment.transcript;
        }
        socket.emit('schedule_message', payload);
        closeModal('modalScheduleMessage');
    }
    const RECURRENCE_LABELS = { daily: 'todos os dias', weekly: 'toda a semana', monthly: 'todo o mês' };
    socket.on('scheduled_message_saved', (entry) => {
        APP.scheduledMessages.push(entry);
        const recurrenceNote = entry.recurrence ? ` — repete ${RECURRENCE_LABELS[entry.recurrence]}` : '';
        alert('📅 Mensagem agendada para ' + new Date(entry.sendAt).toLocaleString('pt-BR') + recurrenceNote);
    });
    socket.on('scheduled_message_cancelled', (data) => {
        APP.scheduledMessages = APP.scheduledMessages.filter(s => s.id !== data.id);
        openScheduledList();
    });
    socket.on('scheduled_messages_list', (list) => { APP.scheduledMessages = list || []; });
    socket.on('scheduled_message_sent', (data) => {
        if (!data?.chatId) return;
        if (!APP.messages[data.chatId]) APP.messages[data.chatId] = [];
        APP.messages[data.chatId].push({ id: data.id, sender: 'Você', text: data.text, time: data.time, type: 'sent', read: false, scheduled: true, fileData: data.fileData || null, fileName: data.fileName || null, fileType: data.fileType || null, transcript: data.transcript || null });
        if (APP.currentChatId === data.chatId) renderMessages();
        renderChatList();
    });
    function openScheduledList() {
        closeModal('modalScheduleMessage');
        socket.emit('get_scheduled_messages');
        const el = document.getElementById('scheduledListContent');
        const render = () => {
            if (!APP.scheduledMessages.length) { el.innerHTML = '<p style="color:#8696a0;text-align:center;padding:20px;">Nenhuma mensagem agendada</p>'; return; }
            el.innerHTML = APP.scheduledMessages.map(s => {
                const chat = APP.chats.find(c => c.id === s.chatId);
                const attachIcon = (s.fileType || '').startsWith('image/') ? '📷 ' : (s.fileType || '').startsWith('video/') ? '🎥 ' : (s.fileType || '').startsWith('audio/') ? '🎤 ' : (s.fileData ? '📎 ' : '');
                const recurrenceLabel = s.recurrence ? `<div style="font-size:11px;color:var(--blue);">🔁 Repete ${RECURRENCE_LABELS[s.recurrence]}</div>` : '';
                return `
                <div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div style="font-size:13px;">${escapeHtml(chat?.name || s.chatId)}: ${attachIcon}${escapeHtml(s.text || (s.fileData ? '(sem legenda)' : ''))}</div>
                    ${recurrenceLabel}
                    <div style="font-size:11px;color:var(--text-secondary);display:flex;justify-content:space-between;align-items:center;">
                        <span>${new Date(s.sendAt).toLocaleString('pt-BR')}</span>
                        <button class="btn-small btn-danger" style="padding:2px 8px;font-size:11px;" onclick="socket.emit('cancel_scheduled_message', {id:'${s.id}'})">Cancelar</button>
                    </div>
                </div>`;
            }).join('');
        };
        setTimeout(render, 150);
        document.getElementById('modalScheduledList').classList.add('active');
    }

    // ==================== THREAD DE RESPOSTAS ====================
    APP.threadOriginalId = null;
    function openThread(originalMsgId) {
        const msgs = APP.messages[APP.currentChatId] || [];
        const original = msgs.find(m => m.id === originalMsgId);
        APP.threadOriginalId = originalMsgId;
        document.getElementById('threadOriginal').innerHTML = original ? `<strong>${escapeHtml(original.type === 'sent' ? 'Você' : original.sender)}</strong><br>${escapeHtml(original.text || '')}` : 'Mensagem original';
        const replies = msgs.filter(m => m.replyTo?.id === originalMsgId);
        document.getElementById('threadReplies').innerHTML = replies.map(r => `
            <div style="background:var(--bg-tertiary);border-radius:8px;padding:8px;font-size:13px;">
                <strong>${escapeHtml(r.type === 'sent' ? 'Você' : r.sender)}</strong> <span style="color:var(--text-secondary);font-size:11px;">${escapeHtml(r.time || '')}</span><br>${r.deleted ? '(apagada)' : escapeHtml(r.text || '')}
            </div>`).join('') || '<p style="color:#8696a0;font-size:13px;">Ainda sem respostas nesta thread</p>';
        document.getElementById('modalThread').classList.add('active');
    }
    function sendThreadReply() {
        const input = document.getElementById('threadReplyInput');
        const text = input.value.trim();
        if (!text || !APP.threadOriginalId) return;
        const original = (APP.messages[APP.currentChatId] || []).find(m => m.id === APP.threadOriginalId);
        APP.replyingTo = original ? { id: original.id, sender: original.type === 'sent' ? 'Você' : original.sender, text: original.text } : null;
        document.getElementById('messageInput').value = text;
        sendMessage('messageInput');
        input.value = '';
        openThread(APP.threadOriginalId);
    }

    // ==================== PESQUISA DENTRO DA CONVERSA ====================
    APP.chatSearchMatches = [];
    APP.chatSearchIndex = -1;
    function toggleChatSearch() {
        const bar = document.getElementById('chatSearchBar');
        const show = bar.style.display === 'none';
        bar.style.display = show ? 'flex' : 'none';
        if (show) { document.getElementById('chatSearchInput').focus(); }
        else { document.getElementById('chatSearchInput').value = ''; runChatSearch(''); }
    }
    function runChatSearch(query) {
        document.querySelectorAll('#chatMessages .message.search-hit').forEach(el => el.classList.remove('search-hit'));
        const q = query.trim().toLowerCase();
        if (!q) { document.getElementById('chatSearchCount').textContent = ''; APP.chatSearchMatches = []; return; }
        const msgs = APP.messages[APP.currentChatId] || [];
        APP.chatSearchMatches = msgs.filter(m => !m.deleted && (m.text || '').toLowerCase().includes(q)).map(m => m.id);
        APP.chatSearchIndex = APP.chatSearchMatches.length ? 0 : -1;
        document.getElementById('chatSearchCount').textContent = APP.chatSearchMatches.length ? `${APP.chatSearchIndex + 1}/${APP.chatSearchMatches.length}` : '0/0';
        APP.chatSearchMatches.forEach(id => document.querySelector(`[data-msg-id="${id}"]`)?.classList.add('search-hit'));
        if (APP.chatSearchIndex >= 0) scrollToSearchMatch();
    }
    function chatSearchNav(dir) {
        if (!APP.chatSearchMatches.length) return;
        APP.chatSearchIndex = (APP.chatSearchIndex + dir + APP.chatSearchMatches.length) % APP.chatSearchMatches.length;
        document.getElementById('chatSearchCount').textContent = `${APP.chatSearchIndex + 1}/${APP.chatSearchMatches.length}`;
        scrollToSearchMatch();
    }
    function scrollToSearchMatch() {
        const id = APP.chatSearchMatches[APP.chatSearchIndex];
        const el = document.querySelector(`[data-msg-id="${id}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // ==================== NAVEGAÇÃO GPS (tipo Waze — mundo inteiro) ====================
    const NAV = {
        map: null, userMarker: null, destMarker: null, routeLines: [], routes: [], selectedRouteIndex: 0,
        steps: [], currentStepIndex: 0, origin: null, destination: null, watchId: null, navigating: false,
        recalcCooldown: 0, alerts: [], alertMarkers: {}, announcedAlertIds: new Set(),
        voiceEnabled: localStorage.getItem('navVoiceEnabled') !== 'off'
    };
    const ALERT_ICONS = { police: '🚓', accident: '💥', roadwork: '🚧', traffic: '🐌', hazard: '⚠️', camera: '📷' };
    const ALERT_LABELS = { police: 'Polícia', accident: 'Acidente', roadwork: 'Obras na via', traffic: 'Trânsito', hazard: 'Perigo na via', camera: 'Radar' };

    function openNavScreen() {
        if (!navigator.geolocation) return alert('Este navegador não suporta geolocalização.');
        document.getElementById('navScreen').classList.add('active');
        document.getElementById('navVoiceBtn').textContent = NAV.voiceEnabled ? '🔊' : '🔇';
        if (!NAV.map) {
            NAV.map = L.map('navMap').setView([20, 0], 2); // vista mundial por padrão, até sabermos a tua localização
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(NAV.map);
        }
        setTimeout(() => NAV.map.invalidateSize(), 200);
        navigator.geolocation.getCurrentPosition((pos) => {
            NAV.origin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            placeUserMarker(NAV.origin.lat, NAV.origin.lng, pos.coords.heading);
            NAV.map.setView([NAV.origin.lat, NAV.origin.lng], 14);
        }, (err) => { console.warn('Não foi possível obter a localização inicial:', err.message); }, { enableHighAccuracy: true, timeout: 10000 });
        socket.emit('get_road_alerts');
    }
    function closeNavScreen() {
        document.getElementById('navScreen').classList.remove('active');
        document.getElementById('navAlertMenu').style.display = 'none';
        if (NAV.navigating) toggleNavigation();
        if (window.speechSynthesis) speechSynthesis.cancel();
    }
    function toggleNavVoice() {
        NAV.voiceEnabled = !NAV.voiceEnabled;
        localStorage.setItem('navVoiceEnabled', NAV.voiceEnabled ? 'on' : 'off');
        document.getElementById('navVoiceBtn').textContent = NAV.voiceEnabled ? '🔊' : '🔇';
        if (!NAV.voiceEnabled && window.speechSynthesis) speechSynthesis.cancel();
    }
    function speak(text) {
        if (!NAV.voiceEnabled || !window.speechSynthesis) return;
        try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'pt-PT'; u.rate = 1.0; speechSynthesis.speak(u); }
        catch (e) { console.warn('Voz indisponível:', e.message); }
    }
    function toggleAlertMenu() {
        const menu = document.getElementById('navAlertMenu');
        menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
    }
    function reportAlert(type) {
        document.getElementById('navAlertMenu').style.display = 'none';
        if (!NAV.origin) return alert('Ainda não sei a tua localização — espera um momento e tenta outra vez.');
        socket.emit('report_alert', { type, lat: NAV.origin.lat, lng: NAV.origin.lng });
    }
    socket.on('road_alerts_update', (alerts) => {
        NAV.alerts = alerts || [];
        renderAlertMarkers();
        if (NAV.routes.length) checkTrafficOnRoute();
    });
    function renderAlertMarkers() {
        if (!NAV.map) return;
        const activeIds = new Set(NAV.alerts.map(a => a.id));
        Object.keys(NAV.alertMarkers).forEach((id) => { if (!activeIds.has(id)) { NAV.map.removeLayer(NAV.alertMarkers[id]); delete NAV.alertMarkers[id]; } });
        NAV.alerts.forEach((a) => {
            const popupHtml = `
                <div style="text-align:center;min-width:150px;">
                    <strong>${ALERT_ICONS[a.type] || '⚠️'} ${ALERT_LABELS[a.type] || a.type}</strong><br>
                    <span style="font-size:11px;color:#666;">reportado por ${a.reportedBy}</span><br><br>
                    <button class="btn-small btn-accept" style="font-size:11px;padding:4px 8px;" onclick="socket.emit('confirm_alert',{id:'${a.id}'})">✅ Ainda aqui</button>
                    <button class="btn-small" style="font-size:11px;padding:4px 8px;" onclick="socket.emit('dismiss_alert',{id:'${a.id}'})">❌ Já não está</button>
                </div>`;
            if (NAV.alertMarkers[a.id]) { NAV.alertMarkers[a.id].setPopupContent(popupHtml); }
            else {
                const icon = L.divIcon({ className: '', html: `<div style="font-size:22px;filter:drop-shadow(0 0 3px rgba(0,0,0,0.5));">${ALERT_ICONS[a.type] || '⚠️'}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
                NAV.alertMarkers[a.id] = L.marker([a.lat, a.lng], { icon }).addTo(NAV.map).bindPopup(popupHtml);
            }
        });
    }
    function checkAlertsProximity(lat, lng) {
        const banner = document.getElementById('navAlertBanner');
        let nearest = null, nearestDist = Infinity;
        NAV.alerts.forEach((a) => { const d = haversineMeters(lat, lng, a.lat, a.lng); if (d < 400 && d < nearestDist) { nearest = a; nearestDist = d; } });
        if (nearest) {
            banner.style.display = 'flex';
            document.getElementById('navAlertBannerIcon').textContent = ALERT_ICONS[nearest.type] || '⚠️';
            document.getElementById('navAlertBannerText').textContent = `${ALERT_LABELS[nearest.type]} a ${Math.round(nearestDist)}m`;
            if (!NAV.announcedAlertIds.has(nearest.id)) { NAV.announcedAlertIds.add(nearest.id); speak(`Atenção, ${ALERT_LABELS[nearest.type]} daqui a ${Math.round(nearestDist)} metros`); }
        } else { banner.style.display = 'none'; }
    }
    function checkTrafficOnRoute() {
        const line = NAV.routeLines[NAV.selectedRouteIndex];
        const banner = document.getElementById('navTrafficBanner');
        if (!line) { banner.style.display = 'none'; return; }
        const latlngs = line.getLatLngs();
        const trafficAlerts = NAV.alerts.filter(a => a.type === 'traffic');
        let hits = 0;
        trafficAlerts.forEach((a) => { if (distanceToPolyline(a.lat, a.lng, latlngs) < 150) hits++; });
        banner.style.display = hits > 0 ? 'block' : 'none';
        return hits;
    }
    function placeUserMarker(lat, lng, heading) {
        const rotation = (typeof heading === 'number' && !isNaN(heading)) ? heading : 0;
        const icon = L.divIcon({ className: '', html: `<div style="width:22px;height:22px;transform:rotate(${rotation}deg);font-size:22px;line-height:22px;text-align:center;filter:drop-shadow(0 0 3px rgba(0,0,0,0.6));">🧭</div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
        if (NAV.userMarker) NAV.userMarker.setLatLng([lat, lng]).setIcon(icon);
        else NAV.userMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(NAV.map);
    }
    async function searchNavDestination() {
        const q = document.getElementById('navDestInput').value.trim();
        if (!q) return;
        const list = document.getElementById('navResultsList');
        list.style.display = 'block';
        list.innerHTML = '<p style="padding:12px;color:var(--text-secondary);font-size:13px;">A procurar...</p>';
        try {
            const res = await fetch('/api/nav/geocode?q=' + encodeURIComponent(q));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Falha na pesquisa');
            if (!data.length) { list.innerHTML = '<p style="padding:12px;color:var(--text-secondary);font-size:13px;">Nada encontrado para essa pesquisa.</p>'; return; }
            list.innerHTML = data.map((r) => `
                <div class="chat-item" style="cursor:pointer;" onclick='selectNavResult(${JSON.stringify(r.lat)}, ${JSON.stringify(r.lon)}, ${JSON.stringify(r.display_name)})'>
                    <div class="chat-item-avatar avatar-user">📍</div>
                    <div class="chat-item-info"><h4>${(r.display_name || '').split(',')[0]}</h4><p>${r.display_name}</p></div>
                </div>`).join('');
        } catch (err) { list.innerHTML = `<p style="padding:12px;color:var(--red);font-size:13px;">⚠️ ${err.message}</p>`; }
    }
    async function selectNavResult(lat, lng, label) {
        document.getElementById('navResultsList').style.display = 'none';
        document.getElementById('navDestInput').value = label.split(',')[0];
        NAV.destination = { lat: parseFloat(lat), lng: parseFloat(lng), label };
        if (NAV.destMarker) NAV.map.removeLayer(NAV.destMarker);
        NAV.destMarker = L.marker([NAV.destination.lat, NAV.destination.lng]).addTo(NAV.map).bindPopup(label.split(',')[0]);
        if (!NAV.origin) {
            await new Promise((resolve) => {
                navigator.geolocation.getCurrentPosition((pos) => { NAV.origin = { lat: pos.coords.latitude, lng: pos.coords.longitude }; placeUserMarker(NAV.origin.lat, NAV.origin.lng, pos.coords.heading); resolve(); }, () => resolve(), { enableHighAccuracy: true, timeout: 10000 });
            });
        }
        if (!NAV.origin) return alert('Não foi possível obter a tua localização atual.');
        await computeRoute();
    }
    async function computeRoute() {
        if (!NAV.origin || !NAV.destination) return;
        document.getElementById('navRouteSummary').style.display = 'block';
        document.getElementById('navRouteSummary').textContent = 'A calcular rota...';
        try {
            const url = `/api/nav/route?fromLat=${NAV.origin.lat}&fromLng=${NAV.origin.lng}&toLat=${NAV.destination.lat}&toLng=${NAV.destination.lng}`;
            const res = await fetch(url);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Falha ao calcular a rota');
            NAV.routes = data.routes;
            NAV.selectedRouteIndex = 0;
            drawRoutes();
            renderAltBar();
            selectRoute(0);
            document.getElementById('navStartBtn').disabled = false;
            document.getElementById('navStartBtn').textContent = '▶️ Iniciar navegação';
        } catch (err) { document.getElementById('navRouteSummary').textContent = '⚠️ ' + err.message; }
    }
    function drawRoutes() {
        NAV.routeLines.forEach(l => NAV.map.removeLayer(l));
        NAV.routeLines = NAV.routes.map((r, i) => {
            const latlngs = r.geometry.coordinates.map(c => [c[1], c[0]]);
            const line = L.polyline(latlngs, { color: i === NAV.selectedRouteIndex ? getAccentHex() : '#8696a0', weight: i === NAV.selectedRouteIndex ? 6 : 4, opacity: i === NAV.selectedRouteIndex ? 0.95 : 0.6 }).addTo(NAV.map);
            line.on('click', () => selectRoute(i));
            return line;
        });
        NAV.routeLines[NAV.selectedRouteIndex]?.bringToFront();
        const bounds = NAV.routeLines[NAV.selectedRouteIndex]?.getBounds();
        if (bounds) NAV.map.fitBounds(bounds, { padding: [30, 30] });
    }
    function renderAltBar() {
        const bar = document.getElementById('navAltBar');
        if (NAV.routes.length < 2) { bar.style.display = 'none'; return; }
        bar.style.display = 'flex';
        bar.innerHTML = NAV.routes.map((r, i) => {
            const mins = Math.round(r.duration / 60);
            const km = (r.distance / 1000).toFixed(1);
            return `<button class="btn-small ${i === NAV.selectedRouteIndex ? 'btn-accept' : ''}" style="flex:0 0 auto;" onclick="selectRoute(${i})">${i === 0 ? '⭐ ' : ''}${mins} min · ${km} km</button>`;
        }).join('');
    }
    function selectRoute(index) {
        NAV.selectedRouteIndex = index;
        const route = NAV.routes[index];
        NAV.steps = route.legs.flatMap(leg => leg.steps);
        NAV.currentStepIndex = 0;
        drawRoutes();
        renderAltBar();
        const hits = checkTrafficOnRoute();
        const mins = Math.round(route.duration / 60) + (hits ? hits * 5 : 0);
        const km = (route.distance / 1000).toFixed(1);
        document.getElementById('navRouteSummary').textContent = hits ? `🕐 ~${mins} min (com trânsito) · 📏 ${km} km` : `🕐 ${mins} min · 📏 ${km} km`;
        showCurrentInstruction();
    }
    const NAV_MODIFIER_PT = { left: 'à esquerda', right: 'à direita', 'slight left': 'ligeiramente à esquerda', 'slight right': 'ligeiramente à direita', 'sharp left': 'com força à esquerda', 'sharp right': 'com força à direita', straight: 'em frente', uturn: 'inversão de marcha' };
    function maneuverText(step) {
        const type = step.maneuver?.type;
        const mod = NAV_MODIFIER_PT[step.maneuver?.modifier] || '';
        const streetName = step.name ? ` para ${step.name}` : '';
        if (type === 'depart') return 'Siga em frente' + streetName;
        if (type === 'arrive') return 'Chegou ao destino 🎉';
        if (type === 'roundabout' || type === 'rotary') return `Na rotunda, saia na saída ${step.maneuver.exit || ''}` + streetName;
        if (type === 'merge') return 'Junte-se à via' + streetName;
        if (type === 'fork') return `Mantenha-se ${mod || 'em frente'}` + streetName;
        if (type === 'end of road') return `No final da via, vire ${mod}` + streetName;
        if (type === 'continue') return 'Continue em frente' + streetName;
        if (type === 'on ramp' || type === 'off ramp') return `Entre ${mod} na rampa` + streetName;
        if (mod) return `Vire ${mod}` + streetName;
        return 'Siga' + streetName;
    }
    function maneuverIcon(step) {
        const mod = step.maneuver?.modifier || '';
        if (step.maneuver?.type === 'arrive') return '🏁';
        if (step.maneuver?.type === 'roundabout' || step.maneuver?.type === 'rotary') return '🔄';
        if (mod.includes('left')) return '⬅️';
        if (mod.includes('right')) return '➡️';
        if (mod === 'uturn') return '↩️';
        return '⬆️';
    }
    function showCurrentInstruction(spokenAloud) {
        const step = NAV.steps[NAV.currentStepIndex];
        const bar = document.getElementById('navInstructionBar');
        if (!step) { bar.style.display = 'none'; return; }
        bar.style.display = 'flex';
        document.getElementById('navInstructionIcon').textContent = maneuverIcon(step);
        document.getElementById('navInstructionText').textContent = maneuverText(step);
        document.getElementById('navInstructionDist').textContent = step.distance >= 1000 ? `${(step.distance / 1000).toFixed(1)} km` : `${Math.round(step.distance)} m`;
        if (spokenAloud) speak(maneuverText(step));
    }
    function recenterNavMap() { if (NAV.origin) NAV.map.setView([NAV.origin.lat, NAV.origin.lng], NAV.navigating ? 17 : 14); }
    function toggleNavigation() {
        if (NAV.navigating) {
            if (NAV.watchId) navigator.geolocation.clearWatch(NAV.watchId);
            NAV.watchId = null; NAV.navigating = false;
            document.getElementById('navStartBtn').textContent = '▶️ Iniciar navegação';
            document.getElementById('navAlertBanner').style.display = 'none';
            if (window.speechSynthesis) speechSynthesis.cancel();
            return;
        }
        if (!NAV.steps.length) return;
        NAV.navigating = true;
        NAV.announcedAlertIds.clear();
        document.getElementById('navStartBtn').textContent = '⏹️ Parar navegação';
        NAV.map.setView([NAV.origin.lat, NAV.origin.lng], 17);
        showCurrentInstruction(true);
        NAV.watchId = navigator.geolocation.watchPosition(onNavPositionUpdate, (err) => { console.warn('Erro no GPS durante a navegação:', err.message); }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
    }
    function onNavPositionUpdate(pos) {
        const lat = pos.coords.latitude, lng = pos.coords.longitude, heading = pos.coords.heading;
        NAV.origin = { lat, lng };
        placeUserMarker(lat, lng, heading);
        if (NAV.navigating) { NAV.map.setView([lat, lng], NAV.map.getZoom() < 15 ? 17 : NAV.map.getZoom()); checkAlertsProximity(lat, lng); }
        const step = NAV.steps[NAV.currentStepIndex];
        if (step) {
            const loc = step.maneuver.location;
            const distToManeuver = haversineMeters(lat, lng, loc[1], loc[0]);
            if (distToManeuver < 35 && NAV.currentStepIndex < NAV.steps.length - 1) { NAV.currentStepIndex++; showCurrentInstruction(true); }
            else {
                document.getElementById('navInstructionDist').textContent = distToManeuver >= 1000 ? `${(distToManeuver / 1000).toFixed(1)} km` : `${Math.round(distToManeuver)} m`;
                if (NAV.navigating && distToManeuver < 150 && !step._warned150) { step._warned150 = true; speak(maneuverText(step)); }
            }
        }
        const line = NAV.routeLines[NAV.selectedRouteIndex];
        if (line && Date.now() > NAV.recalcCooldown) {
            const nearest = distanceToPolyline(lat, lng, line.getLatLngs());
            if (nearest > 60) { NAV.recalcCooldown = Date.now() + 15000; computeRoute(); }
        }
    }
    function distanceToPolyline(lat, lng, latlngs) {
        let min = Infinity;
        for (const p of latlngs) { const d = haversineMeters(lat, lng, p.lat, p.lng); if (d < min) min = d; }
        return min;
    }

    // ==================== ESPAÇO (ISS, Sol e Lua) ====================
    const SPACE = { map: null, issMarker: null, issInterval: null };

    function openSpaceScreen() {
        document.getElementById('spaceScreen').classList.add('active');
        if (!SPACE.map) {
            SPACE.map = L.map('issMap', { zoomControl: false, attributionControl: false }).setView([0, 0], 1);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(SPACE.map);
        }
        setTimeout(() => SPACE.map.invalidateSize(), 200);
        renderMoonPhase();
        fetchIssPosition();
        if (!SPACE.issInterval) SPACE.issInterval = setInterval(fetchIssPosition, 8000);
        loadSunTimes();
        loadVisibleSatellites();
    }
    function closeSpaceScreen() {
        document.getElementById('spaceScreen').classList.remove('active');
        if (SPACE.issInterval) { clearInterval(SPACE.issInterval); SPACE.issInterval = null; }
    }
    async function fetchIssPosition() {
        try {
            const res = await fetch('/api/space/iss');
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'falha');
            const icon = L.divIcon({ className: '', html: '<div style="font-size:26px;">🛰️</div>', iconSize: [26, 26], iconAnchor: [13, 13] });
            if (SPACE.issMarker) SPACE.issMarker.setLatLng([data.lat, data.lon]);
            else { SPACE.issMarker = L.marker([data.lat, data.lon], { icon }).addTo(SPACE.map); SPACE.map.setView([data.lat, data.lon], 2); }
            document.getElementById('issInfo').textContent = `📍 ${data.lat.toFixed(2)}°, ${data.lon.toFixed(2)}° · ~28.000 km/h · atualizado agora`;
            if (data.peopleInSpace?.length) {
                document.getElementById('issCrew').textContent = `👨‍🚀 ${data.peopleInSpace.length} pessoas no espaço agora: ${data.peopleInSpace.map(p => p.name).join(', ')}`;
            }
        } catch (err) {
            document.getElementById('issInfo').textContent = '⚠️ Não foi possível obter a posição da ISS agora.';
        }
    }
    // Fase da Lua — cálculo simples e conhecido (idade sinódica ~29.53 dias),
    // não precisa de nenhuma API.
    function renderMoonPhase() {
        const synodicMonth = 29.530588853;
        const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14); // lua nova de referência
        const daysSince = (Date.now() - knownNewMoon) / 86400000;
        const age = daysSince % synodicMonth;
        const illum = (1 - Math.cos((2 * Math.PI * age) / synodicMonth)) / 2;
        let emoji, name;
        if (age < 1.84566) { emoji = '🌑'; name = 'Lua Nova'; }
        else if (age < 5.53699) { emoji = '🌒'; name = 'Crescente'; }
        else if (age < 9.22831) { emoji = '🌓'; name = 'Quarto Crescente'; }
        else if (age < 12.91963) { emoji = '🌔'; name = 'Gibosa Crescente'; }
        else if (age < 16.61096) { emoji = '🌕'; name = 'Lua Cheia'; }
        else if (age < 20.30228) { emoji = '🌖'; name = 'Gibosa Minguante'; }
        else if (age < 23.99361) { emoji = '🌗'; name = 'Quarto Minguante'; }
        else if (age < 27.68493) { emoji = '🌘'; name = 'Minguante'; }
        else { emoji = '🌑'; name = 'Lua Nova'; }
        document.getElementById('moonPhaseEmoji').textContent = emoji;
        document.getElementById('moonPhaseName').textContent = name;
        document.getElementById('moonPhaseIllum').textContent = `${Math.round(illum * 100)}% iluminada · dia ${Math.floor(age)} do ciclo lunar`;
    }
    function loadSunTimes() {
        const el = document.getElementById('sunInfo');
        navigator.geolocation.getCurrentPosition(async (pos) => {
            try {
                const res = await fetch(`/api/space/sun?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'falha');
                const fmt = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                el.textContent = `🌅 Nascer do sol: ${fmt(data.sunrise)} · 🌇 Pôr do sol: ${fmt(data.sunset)} · ☀️ Meio-dia solar: ${fmt(data.solar_noon)}`;
            } catch (err) {
                el.textContent = '⚠️ Não foi possível obter os horários do sol.';
            }
        }, () => { el.textContent = '⚠️ Precisamos da tua localização para calcular os horários do sol.'; }, { enableHighAccuracy: false, timeout: 10000 });
    }
    function loadVisibleSatellites() {
        const el = document.getElementById('satellitesList');
        navigator.geolocation.getCurrentPosition(async (pos) => {
            try {
                const res = await fetch(`/api/space/satellites?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
                const data = await res.json();
                if (res.status === 501) { el.textContent = 'ℹ️ ' + data.message; return; }
                if (!res.ok) throw new Error(data.error || 'falha');
                if (!data.satellites?.length) { el.textContent = 'Nenhum satélite visível de momento nesta zona.'; return; }
                el.innerHTML = data.satellites.map(s => `<div style="padding:4px 0;">🛰️ ${s.satname}</div>`).join('');
            } catch (err) {
                el.textContent = '⚠️ Não foi possível obter os satélites agora.';
            }
        }, () => { el.textContent = '⚠️ Precisamos da tua localização.'; }, { enableHighAccuracy: false, timeout: 10000 });
    }

    function escapeHtml(str) {
        return (str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // ==================== INCÊNDIOS EM TEMPO REAL ====================
    const FIRES = { map: null, layer: null, smsContact: localStorage.getItem('fireSmsContact') || '', emailContact: localStorage.getItem('fireEmailContact') || '' };
    function openFiresScreen() {
        document.getElementById('firesScreen').classList.add('active');
        document.getElementById('fireSmsContact').value = FIRES.smsContact;
        document.getElementById('fireEmailContact').value = FIRES.emailContact;
        document.getElementById('fireEmailStatus').textContent = '';
        if (!FIRES.map) {
            FIRES.map = L.map('firesMap').setView([39.5, -8], 6); // Portugal por padrão — o mapa cobre o mundo todo
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(FIRES.map);
            FIRES.layer = L.layerGroup().addTo(FIRES.map);
        }
        setTimeout(() => FIRES.map.invalidateSize(), 200);
        loadFires();
    }
    function closeFiresScreen() { document.getElementById('firesScreen').classList.remove('active'); }
    function loadFires() {
        const status = document.getElementById('firesStatus');
        status.textContent = 'A atualizar incêndios...';
        const bounds = FIRES.map.getBounds();
        const params = new URLSearchParams({
            west: bounds.getWest().toFixed(2), south: bounds.getSouth().toFixed(2),
            east: bounds.getEast().toFixed(2), north: bounds.getNorth().toFixed(2)
        });
        fetch('/api/fires?' + params.toString()).then(r => r.json()).then(data => {
            if (data.error) throw new Error(data.error);
            if (data.configured === false) {
                status.textContent = '⚠️ Mapa de incêndios ainda não configurado — falta a chave NASA_FIRMS_KEY no servidor (grátis, ver README).';
                return;
            }
            FIRES.layer.clearLayers();
            (data.fires || []).forEach(f => {
                const isHigh = f.confidence === 'h' || f.confidence === 'high';
                const isLow = f.confidence === 'l' || f.confidence === 'low';
                const color = isHigh ? '#dc2626' : (isLow ? '#fbbf24' : '#f97316');
                const timeStr = f.time ? `${String(f.time).padStart(4, '0').slice(0, 2)}:${String(f.time).padStart(4, '0').slice(2)}` : '—';
                L.circleMarker([f.lat, f.lng], { radius: 5, color, fillColor: color, fillOpacity: 0.8, weight: 1 })
                    .bindPopup(`🔥 Foco de incêndio<br>Detetado: ${f.date || '—'} ${timeStr}<br>Confiança: ${f.confidence || '—'}${f.frp ? '<br>Intensidade (FRP): ' + f.frp : ''}`)
                    .addTo(FIRES.layer);
            });
            status.textContent = `${(data.fires || []).length} foco(s) de incêndio na área visível (últimas 24h, NASA FIRMS) — mova/afaste o mapa e toque em 🔄 para atualizar`;
        }).catch(err => {
            status.textContent = '⚠️ Não foi possível carregar os incêndios: ' + err.message;
        });
    }
    function saveFireSmsContact(value) {
        FIRES.smsContact = value.trim();
        localStorage.setItem('fireSmsContact', FIRES.smsContact);
    }
    function saveFireEmailContact(value) {
        FIRES.emailContact = value.trim();
        localStorage.setItem('fireEmailContact', FIRES.emailContact);
    }
    function sendFireEmail() {
        const to = (FIRES.emailContact || '').trim();
        const statusEl = document.getElementById('fireEmailStatus');
        if (!to) { statusEl.style.color = 'var(--red)'; statusEl.textContent = 'Escreve primeiro o email para quem queres avisar.'; return; }
        if (!navigator.geolocation) { statusEl.style.color = 'var(--red)'; statusEl.textContent = 'Este navegador não permite obter a localização.'; return; }
        statusEl.style.color = 'var(--text-secondary)';
        statusEl.textContent = 'A obter a tua localização...';
        navigator.geolocation.getCurrentPosition(async (pos) => {
            statusEl.textContent = 'A enviar email...';
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            try {
                const res = await fetch('/api/fires/send-email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token },
                    body: JSON.stringify({ token: APP.token, to, lat: pos.coords.latitude, lng: pos.coords.longitude }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                const data = await res.json();
                if (data.configured === false) {
                    statusEl.style.color = 'var(--red)';
                    statusEl.textContent = '⚠️ Envio de email ainda não configurado no servidor (ver README — EMAIL_USER/EMAIL_PASS).';
                    return;
                }
                if (!res.ok) throw new Error(data.error || 'Falha ao enviar.');
                statusEl.style.color = 'var(--green)';
                statusEl.textContent = '✅ Email enviado para ' + to + '.';
            } catch (err) {
                clearTimeout(timeoutId);
                statusEl.style.color = 'var(--red)';
                statusEl.textContent = err.name === 'AbortError' ? '⚠️ O servidor demorou demasiado a responder — o email pode não ter sido enviado. Tenta de novo.' : '⚠️ ' + err.message;
            }
        }, () => {
            statusEl.style.color = 'var(--red)';
            statusEl.textContent = 'Não foi possível obter a tua localização.';
        }, { enableHighAccuracy: true, timeout: 8000 });
    }
    function prepareFireSms() {
        const number = (FIRES.smsContact || '').trim();
        if (!number) return alert('Escreve primeiro o número para quem queres enviar o SMS.');
        const send = (locationText) => {
            const body = encodeURIComponent(`🔥 Possível incêndio perto de mim! ${locationText}`);
            window.location.href = `sms:${number}?body=${body}`;
        };
        if (!navigator.geolocation) return send('(sem localização disponível neste navegador)');
        navigator.geolocation.getCurrentPosition(
            (pos) => send(`Localização: https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`),
            () => send('(não foi possível obter a localização exata)'),
            { enableHighAccuracy: true, timeout: 8000 }
        );
    }

    // ==================== TURISMO (pontos de interesse pelo mundo) ====================
    // "Como chegar" calcula e desenha a rota dentro do próprio mapa desta aba
    // (reaproveitando o /api/nav/route já usado na Navegação, sem sair da app).
    // Sem API de comboios/autocarros próprios, esta rota é sempre de carro —
    // não há dados de transporte público mundiais grátis para desenhar aqui.
    // Dentro de Portugal, o botão "🚌 Transportes (PT)" continua a abrir a aba
    // de Transportes já existente, essa sim com estações reais de metro/comboio.
    const TOURISM_CATEGORIES = {
        geral: { label: '📍 Geral', endpoint: 'poi' },
        praias: { label: '🏖️ Praias', endpoint: 'category' },
        museus: { label: '🏛️ Museus', endpoint: 'category' },
        atracoes: { label: '🎭 Atrações', endpoint: 'category' },
        parques: { label: '🌳 Parques/Praças', endpoint: 'category' }
    };
    const TOURISM = {
        map: null, layer: null, lastPoi: null, routeLine: null, routeMarkers: [], category: 'geral', favorites: [],
        cities: {
            valencia: { lat: 39.4699, lon: -0.3763, zoom: 12 },
            madrid: { lat: 40.4168, lon: -3.7038, zoom: 12 },
            paris: { lat: 48.8566, lon: 2.3522, zoom: 12 },
            portugal: { lat: 39.5, lon: -8.0, zoom: 7 },
            alemanha: { lat: 51.1657, lon: 10.4515, zoom: 6 },
            holanda: { lat: 52.1326, lon: 5.2913, zoom: 7 },
            world: { lat: 20, lon: 0, zoom: 2 }
        }
    };
    // ==================== EVENTOS CULTURAIS (Agenda Cultural de Lisboa) ====================
    // API oficial, aberta e gratuita da Câmara Municipal de Lisboa — só cobre
    // eventos em Lisboa (não há equivalente confirmado para o Porto). Busca-se
    // a lista completa uma vez e filtra-se aqui no cliente (a API não parece
    // aceitar parâmetros de pesquisa).
    let EVENTS_CACHE = null;
    function openEventsScreen() {
        document.getElementById('eventsScreen').classList.add('active');
        if (!EVENTS_CACHE) loadEvents();
    }
    function closeEventsScreen() { document.getElementById('eventsScreen').classList.remove('active'); }
    async function loadEvents() {
        document.getElementById('eventsStatus').textContent = 'A carregar eventos...';
        try {
            const res = await fetch('/api/culture/events');
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            EVENTS_CACHE = data.events || [];
            renderEventsList();
        } catch (err) {
            document.getElementById('eventsStatus').textContent = '⚠️ Não foi possível carregar os eventos: ' + err.message;
        }
    }
    function renderEventsList() {
        const list = document.getElementById('eventsList');
        if (!EVENTS_CACHE) return;
        const q = (document.getElementById('eventsSearchInput').value || '').trim().toLowerCase();
        const filtered = q
            ? EVENTS_CACHE.filter((e) => e.title.toLowerCase().includes(q) || e.categories.some((c) => c.toLowerCase().includes(q)))
            : EVENTS_CACHE;
        if (!filtered.length) {
            list.innerHTML = '<p style="color:var(--text-secondary);padding:8px 0;">Nenhum evento encontrado.</p>';
            document.getElementById('eventsStatus').textContent = `0 de ${EVENTS_CACHE.length} eventos — Agenda Cultural de Lisboa`;
            return;
        }
        list.innerHTML = filtered.map((e) => `
            <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
                ${e.image ? `<img src="${escapeHtml(e.image)}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;flex-shrink:0;">` : ''}
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;">${escapeHtml(e.title)}</div>
                    ${e.subtitle ? `<div style="font-size:12px;color:var(--text-secondary);">${escapeHtml(e.subtitle)}</div>` : ''}
                    <div style="font-size:12px;color:var(--text-secondary);">📅 ${escapeHtml(e.dates || '—')}${e.times ? ' · ' + escapeHtml(e.times) : ''}</div>
                    ${e.venue ? `<div style="font-size:12px;color:var(--text-secondary);">📍 ${escapeHtml(e.venue)}</div>` : ''}
                    ${e.categories && e.categories.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">${e.categories.map((c) => `<span style="font-size:10px;background:var(--bg-secondary);border-radius:10px;padding:2px 8px;color:var(--text-secondary);">${escapeHtml(c)}</span>`).join('')}</div>` : ''}
                    ${e.description ? `<div style="font-size:12px;margin-top:4px;">${escapeHtml(e.description)}</div>` : ''}
                    ${e.url ? `<a href="${escapeHtml(e.url)}" target="_blank" rel="noopener noreferrer" style="font-size:12px;">🔗 Ver mais</a>` : ''}
                </div>
            </div>`).join('');
        document.getElementById('eventsStatus').textContent = `${filtered.length} de ${EVENTS_CACHE.length} eventos — Agenda Cultural de Lisboa`;
    }

    function openTourismScreen() {
        document.getElementById('tourismScreen').classList.add('active');
        if (!TOURISM.map) {
            TOURISM.map = L.map('tourismMap').setView([39.5, -8], 6);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(TOURISM.map);
            TOURISM.layer = L.layerGroup().addTo(TOURISM.map);
            TOURISM.map.on('click', (e) => {
                TOURISM.map.setView(e.latlng, Math.max(TOURISM.map.getZoom(), 12));
                searchTourismHere();
            });
        }
        setTimeout(() => TOURISM.map.invalidateSize(), 200);
    }
    function closeTourismScreen() { document.getElementById('tourismScreen').classList.remove('active'); }
    function flyTourismTo(place) {
        const c = TOURISM.cities[place];
        if (!c || !TOURISM.map) return;
        TOURISM.map.setView([c.lat, c.lon], c.zoom);
        searchTourismHere();
    }
    function isInPortugal(lat, lon) {
        return lat >= 36.8 && lat <= 42.2 && lon >= -9.6 && lon <= -6.0;
    }
    // Reaproveita a API de meteorologia já existente noutra aba (/api/weather),
    // agora também aceitando coordenadas diretas em vez de só o nome de uma
    // cidade — mostra o tempo de onde quer que o mapa do Turismo esteja centrado.
    async function loadTourismWeather(lat, lon) {
        const el = document.getElementById('tourismWeather');
        try {
            const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Falha.');
            const info = weatherInfo(data.current.weather_code);
            el.textContent = `${info.icon} ${Math.round(data.current.temperature_2m)}°C`;
            el.style.display = 'block';
        } catch (err) {
            el.style.display = 'none';
        }
    }
    function setTourismCategory(cat) {
        if (!TOURISM_CATEGORIES[cat]) return;
        TOURISM.category = cat;
        document.querySelectorAll('.tourism-category').forEach((btn) => {
            btn.classList.toggle('btn-accept', btn.dataset.category === cat);
        });
        searchTourismHere();
    }
    async function searchTourismHere() {
        const status = document.getElementById('tourismStatus');
        const center = TOURISM.map.getCenter();
        const zoom = TOURISM.map.getZoom();
        loadTourismWeather(center.lat, center.lng);
        if (zoom < 8) {
            status.textContent = 'Aproxima-te mais (zoom) para veres pontos turísticos nesta área.';
            return;
        }
        const catInfo = TOURISM_CATEGORIES[TOURISM.category] || TOURISM_CATEGORIES.geral;
        status.textContent = 'A procurar...';
        try {
            const url = catInfo.endpoint === 'category'
                ? `/api/tourism/category?lat=${center.lat}&lon=${center.lng}&radius=10000&category=${TOURISM.category}`
                : `/api/tourism/poi?lat=${center.lat}&lon=${center.lng}&radius=10000`;
            const res = await fetch(url);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Falha ao procurar.');
            clearTourismRoute();
            TOURISM.layer.clearLayers();
            (data.points || []).forEach(p => {
                L.marker([p.lat, p.lon]).bindTooltip(p.title).on('click', () => openTourismPoi(p)).addTo(TOURISM.layer);
            });
            status.textContent = data.points?.length ? `${data.points.length} ponto(s) encontrados nesta área — toca num marcador para saber mais.` : `Nada encontrado em "${catInfo.label}" nesta área — tenta noutra área ou categoria.`;
        } catch (err) {
            status.textContent = '⚠️ ' + err.message;
        }
    }
    async function openTourismPoi(point) {
        TOURISM.lastPoi = point;
        // Pontos vindos do OpenStreetMap (praias/museus/atrações/parques) trazem o
        // nome real do sítio (point.title), que pode não bater certo com o título
        // do artigo na Wikipédia — quando o próprio OSM já liga a um artigo
        // (point.wikiTitle), usamos esse em vez de adivinhar pelo nome.
        const detailsTitle = point.wikiTitle || point.title;
        document.getElementById('tourismPoiTitle').textContent = point.title;
        document.getElementById('tourismPoiExtract').textContent = 'A carregar informação...';
        document.getElementById('tourismPoiImage').style.display = 'none';
        document.getElementById('tourismPoiWikiLink').href = `https://pt.wikipedia.org/wiki/${encodeURIComponent(detailsTitle)}`;
        document.getElementById('tourismPoiGoogleMapsLink').href = `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lon}&travelmode=transit`;
        document.getElementById('tourismPoiTransportBtn').style.display = isInPortugal(point.lat, point.lon) ? 'flex' : 'none';
        updateTourismFavButton();
        document.getElementById('modalTourismPoi').classList.add('active');
        try {
            const res = await fetch(`/api/tourism/details?title=${encodeURIComponent(detailsTitle)}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Falha.');
            document.getElementById('tourismPoiExtract').textContent = data.extract || 'Sem descrição disponível para este local.';
            if (data.thumbnail) {
                document.getElementById('tourismPoiImg').src = data.thumbnail;
                document.getElementById('tourismPoiImage').style.display = 'block';
            }
            if (data.wikiUrl) document.getElementById('tourismPoiWikiLink').href = data.wikiUrl;
        } catch (err) {
            document.getElementById('tourismPoiExtract').textContent = 'Sem descrição disponível para este local.';
        }
    }
    function openTransportFromTourism() {
        closeModal('modalTourismPoi');
        closeTourismScreen();
        openTransportScreen();
    }

    // ==================== MAPA (pesquisar um sítio qualquer e ver no mapa) ====================
    // Diferente do Turismo (que pesquisa pontos de interesse por categoria numa área)
    // e da Navegação (focada em traçar rota): aqui é só escrever um sítio — morada,
    // cidade, monumento — e vê-lo no mapa, sem mais nada. Reaproveita a mesma
    // geocodificação (Nominatim, via /api/nav/geocode) já usada pela Navegação.
    const MAPSEARCH = { map: null, marker: null };
    function openMapSearchScreen() {
        document.getElementById('mapSearchScreen').classList.add('active');
        if (!MAPSEARCH.map) {
            MAPSEARCH.map = L.map('mapSearchMap').setView([39.5, -8], 6);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(MAPSEARCH.map);
        }
        setTimeout(() => MAPSEARCH.map.invalidateSize(), 200);
    }
    function closeMapSearchScreen() {
        document.getElementById('mapSearchScreen').classList.remove('active');
    }
    let mapSearchTimer = null;
    function debounceMapSearch() {
        clearTimeout(mapSearchTimer);
        mapSearchTimer = setTimeout(runMapSearch, 400);
    }
    async function runMapSearch() {
        const q = document.getElementById('mapSearchInput').value.trim();
        const box = document.getElementById('mapSearchResults');
        if (!q) { box.innerHTML = ''; return; }
        box.innerHTML = '<p style="padding:10px;color:var(--text-secondary);font-size:13px;">A procurar...</p>';
        try {
            const res = await fetch('/api/nav/geocode?q=' + encodeURIComponent(q));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Falha na pesquisa');
            if (!data.length) { box.innerHTML = '<p style="padding:10px;color:var(--text-secondary);font-size:13px;">Nada encontrado para essa pesquisa.</p>'; return; }
            box.innerHTML = data.map((r) => `
                <div style="padding:8px 10px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onclick='selectMapSearchResult(${JSON.stringify(r.lat)}, ${JSON.stringify(r.lon)}, ${JSON.stringify(r.display_name)})'>
                    📍 <strong>${escapeHtml((r.display_name || '').split(',')[0])}</strong><br>
                    <span style="font-size:11px;color:var(--text-secondary);">${escapeHtml(r.display_name || '')}</span>
                </div>`).join('');
        } catch (err) {
            box.innerHTML = `<p style="padding:10px;color:var(--red);font-size:13px;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }
    function selectMapSearchResult(lat, lon, label) {
        lat = parseFloat(lat); lon = parseFloat(lon);
        document.getElementById('mapSearchResults').innerHTML = '';
        document.getElementById('mapSearchInput').value = (label || '').split(',')[0];
        document.getElementById('mapSearchStatus').textContent = label || '';
        MAPSEARCH.map.setView([lat, lon], 16);
        const popupHtml = `
            <div style="text-align:center;min-width:160px;">
                <strong>${escapeHtml((label || '').split(',')[0])}</strong>
                <div style="margin-top:6px;display:flex;gap:6px;justify-content:center;flex-wrap:wrap;">
                    <a href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;"><button class="btn-small">🗺️ Google Maps</button></a>
                    <button class="btn-small btn-accept" onclick='mapSearchGoToNav(${lat}, ${lon}, ${JSON.stringify(label || '')})'>🧭 Como chegar</button>
                </div>
            </div>`;
        if (MAPSEARCH.marker) MAPSEARCH.map.removeLayer(MAPSEARCH.marker);
        MAPSEARCH.marker = L.marker([lat, lon]).addTo(MAPSEARCH.map).bindPopup(popupHtml).openPopup();
    }
    function mapSearchGoToNav(lat, lon, label) {
        closeMapSearchScreen();
        openNavScreen();
        selectNavResult(lat, lon, label);
    }

    // ==================== FAVORITOS DO TURISMO ====================
    socket.on('tourism_favorites_list', (list) => {
        TOURISM.favorites = list || [];
        updateTourismFavButton();
        if (document.getElementById('modalTourismFavorites').classList.contains('active')) renderTourismFavoritesList();
    });
    function findTourismFavorite(point) {
        return TOURISM.favorites.find((f) => f.title === point.title && Math.abs(f.lat - point.lat) < 0.0005 && Math.abs(f.lon - point.lon) < 0.0005);
    }
    function updateTourismFavButton() {
        const btn = document.getElementById('tourismPoiFavBtn');
        if (!btn || !TOURISM.lastPoi) return;
        const fav = findTourismFavorite(TOURISM.lastPoi);
        btn.textContent = fav ? '★ Guardado' : '⭐ Guardar';
        btn.classList.toggle('btn-accept', !!fav);
    }
    function toggleTourismFavorite() {
        const point = TOURISM.lastPoi;
        if (!point) return;
        const existing = findTourismFavorite(point);
        if (existing) socket.emit('delete_tourism_favorite', { id: existing.id });
        else socket.emit('save_tourism_favorite', { title: point.title, lat: point.lat, lon: point.lon, wikiTitle: point.wikiTitle || null });
    }
    function openTourismFavoritesModal() {
        renderTourismFavoritesList();
        document.getElementById('modalTourismFavorites').classList.add('active');
    }
    function renderTourismFavoritesList() {
        const el = document.getElementById('tourismFavoritesList');
        if (!TOURISM.favorites.length) {
            el.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">Ainda não guardaste nenhum favorito. Abre um ponto turístico e toca em "⭐ Guardar".</p>';
            return;
        }
        el.innerHTML = TOURISM.favorites.map((f) => `
            <div class="chat-item" style="cursor:pointer;" onclick="goToTourismFavorite('${f.id}')">
                <div class="chat-item-avatar avatar-user">⭐</div>
                <div class="chat-item-info"><h4>${escapeHtml(f.title)}</h4><p>Toca para ver no mapa</p></div>
                <button class="btn-icon" style="width:30px;height:30px;font-size:13px;flex:0 0 auto;" onclick="event.stopPropagation(); socket.emit('delete_tourism_favorite', { id: '${f.id}' })" title="Remover">🗑️</button>
            </div>`).join('');
    }
    function goToTourismFavorite(id) {
        const f = TOURISM.favorites.find((x) => x.id === id);
        if (!f) return;
        closeModal('modalTourismFavorites');
        if (!TOURISM.map) openTourismScreen();
        TOURISM.map.setView([f.lat, f.lon], 14);
        openTourismPoi({ title: f.title, lat: f.lat, lon: f.lon, wikiTitle: f.wikiTitle });
    }

    // Desenha a rota (de carro — ver nota acima sobre não termos dados de
    // transporte público) diretamente no mapa desta aba, sem abrir nenhuma
    // app/site externo. Fecha a ficha do ponto e volta a mostrar o mapa com a
    // rota traçada, tal como já acontece na aba de Navegação.
    function clearTourismRoute() {
        if (TOURISM.routeLine) { TOURISM.map.removeLayer(TOURISM.routeLine); TOURISM.routeLine = null; }
        TOURISM.routeMarkers.forEach((m) => TOURISM.map.removeLayer(m));
        TOURISM.routeMarkers = [];
    }
    function showTourismDirections() {
        const point = TOURISM.lastPoi;
        if (!point) return;
        if (!navigator.geolocation) {
            alert('Este navegador não suporta geolocalização — não é possível calcular a rota.');
            return;
        }
        closeModal('modalTourismPoi');
        const status = document.getElementById('tourismStatus');
        status.textContent = 'A obter a tua localização...';
        navigator.geolocation.getCurrentPosition(async (pos) => {
            const origin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            status.textContent = 'A calcular a rota...';
            try {
                const url = `/api/nav/route?fromLat=${origin.lat}&fromLng=${origin.lng}&toLat=${point.lat}&toLng=${point.lon}`;
                const res = await fetch(url);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Não foi possível calcular a rota.');
                const route = data.routes[0];
                clearTourismRoute();
                const latlngs = route.geometry.coordinates.map((c) => [c[1], c[0]]);
                TOURISM.routeLine = L.polyline(latlngs, { color: getAccentHex(), weight: 5 }).addTo(TOURISM.map);
                TOURISM.routeMarkers.push(L.marker([origin.lat, origin.lng]).bindTooltip('A tua localização').addTo(TOURISM.map));
                TOURISM.routeMarkers.push(L.marker([point.lat, point.lon]).bindTooltip(point.title).addTo(TOURISM.map));
                TOURISM.map.fitBounds(TOURISM.routeLine.getBounds(), { padding: [30, 30] });
                const km = (route.distance / 1000).toFixed(1);
                const min = Math.round(route.duration / 60);
                status.textContent = `🚗 ${point.title}: ${km} km, ~${min} min de carro (não temos dados de transporte público para desenhar aqui).`;
            } catch (err) {
                status.textContent = '⚠️ ' + err.message;
            }
        }, () => {
            status.textContent = '⚠️ Não foi possível obter a tua localização — permite o acesso à localização para calcular a rota.';
        }, { enableHighAccuracy: true, timeout: 10000 });
    }

    // ==================== LISTA DE COMPRAS ====================
    // Lista pessoal, sem reset automático mensal — "Finalizar" arquiva a lista
    // atual no histórico (com data e total) e limpa-a para recomeçar, dando o
    // mesmo efeito sem depender de um dia fixo do mês.
    // Ordem fixa = ordem sugerida de corredores no supermercado (mesma lista
    // de chaves usada no servidor, para agrupar a lista por categoria).
    const SHOPPING_CATEGORIES = {
        frutas: '🍎 Frutas e Legumes',
        padaria: '🍞 Padaria',
        laticinios: '🧀 Laticínios e Ovos',
        carnes: '🥩 Carnes e Peixe',
        congelados: '🧊 Congelados',
        mercearia: '🥫 Mercearia',
        bebidas: '🥤 Bebidas',
        limpeza: '🧽 Limpeza',
        higiene: '🧴 Higiene e Beleza',
        outros: '📦 Outros'
    };
    const SHOPPING_UNITS = { un: 'un', kg: 'kg', g: 'g', l: 'L', ml: 'ml' };
    const SHOPPING = { items: [], history: [] };
    let EDITING_SHOPPING_ITEM_ID = null;
    let EDITING_SHOPPING_PRICE = null; // { itemId, priceId } | null
    let EXPANDED_SHOPPING_HISTORY_ID = null;
    let EDITING_SHOPPING_HISTORY_PRICE = null; // { historyId, itemId, priceId } | null
    socket.on('shopping_list_updated', (list) => {
        SHOPPING.items = list?.items || [];
        SHOPPING.history = list?.history || [];
        if (document.getElementById('shoppingScreen').classList.contains('active')) renderShoppingList();
        if (document.getElementById('modalShoppingHistory').classList.contains('active')) renderShoppingHistory();
    });
    function populateShoppingCategorySelect(selectEl, selected) {
        selectEl.innerHTML = Object.entries(SHOPPING_CATEGORIES).map(([key, label]) => `<option value="${key}" ${key === selected ? 'selected' : ''}>${label}</option>`).join('');
    }
    function populateShoppingUnitSelect(selectEl, selected) {
        selectEl.innerHTML = Object.entries(SHOPPING_UNITS).map(([key, label]) => `<option value="${key}" ${key === selected ? 'selected' : ''}>${label}</option>`).join('');
    }
    function formatShoppingQty(qty, unit) {
        return (unit || 'un') === 'un' ? `x${qty}` : `${qty} ${SHOPPING_UNITS[unit] || unit}`;
    }
    function openShoppingScreen() {
        document.getElementById('shoppingScreen').classList.add('active');
        populateShoppingCategorySelect(document.getElementById('shoppingItemCategoryInput'), 'outros');
        populateShoppingUnitSelect(document.getElementById('shoppingItemUnitInput'), 'un');
        EDITING_SHOPPING_ITEM_ID = null;
        renderShoppingList();
    }
    function closeShoppingScreen() { document.getElementById('shoppingScreen').classList.remove('active'); }
    function computeShoppingTotal(items) {
        return items.reduce((sum, item) => {
            const cheapest = item.prices.length ? Math.min(...item.prices.map((p) => p.price)) : 0;
            return sum + cheapest * item.qty;
        }, 0);
    }
    function formatEuro(value) {
        return value.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
    }
    function addShoppingItem() {
        const nameInput = document.getElementById('shoppingItemNameInput');
        const name = nameInput.value.trim();
        const qty = parseFloat(document.getElementById('shoppingItemQtyInput').value) || 1;
        const unit = document.getElementById('shoppingItemUnitInput').value || 'un';
        const category = document.getElementById('shoppingItemCategoryInput').value || 'outros';
        if (!name) return;
        socket.emit('add_shopping_item', { name, qty, unit, category });
        nameInput.value = '';
        document.getElementById('shoppingItemQtyInput').value = '1';
        nameInput.focus();
    }
    function deleteShoppingItem(itemId) { socket.emit('delete_shopping_item', { itemId }); }
    function toggleShoppingItem(itemId) { socket.emit('toggle_shopping_item', { itemId }); }
    function startEditShoppingItem(itemId) {
        EDITING_SHOPPING_ITEM_ID = itemId;
        renderShoppingList();
    }
    function cancelEditShoppingItem() {
        EDITING_SHOPPING_ITEM_ID = null;
        renderShoppingList();
    }
    function saveEditShoppingItem(itemId) {
        const name = document.getElementById(`shoppingEditName_${itemId}`).value.trim();
        const qty = parseFloat(document.getElementById(`shoppingEditQty_${itemId}`).value) || 1;
        const unit = document.getElementById(`shoppingEditUnit_${itemId}`).value;
        const category = document.getElementById(`shoppingEditCategory_${itemId}`).value;
        if (!name) return alert('O nome não pode ficar vazio.');
        socket.emit('edit_shopping_item', { itemId, name, qty, unit, category });
        EDITING_SHOPPING_ITEM_ID = null;
    }
    function addShoppingPrice(itemId) {
        const storeInput = document.querySelector(`.shopping-store-input[data-item="${itemId}"]`);
        const priceInput = document.querySelector(`.shopping-price-input[data-item="${itemId}"]`);
        const store = storeInput.value.trim();
        const price = parseFloat(priceInput.value);
        if (!store || !Number.isFinite(price) || price < 0) return alert('Indica a loja e um preço válido.');
        socket.emit('add_shopping_price', { itemId, store, price });
        storeInput.value = '';
        priceInput.value = '';
    }
    function deleteShoppingPrice(itemId, priceId) { socket.emit('delete_shopping_price', { itemId, priceId }); }
    function startEditShoppingPrice(itemId, priceId) {
        EDITING_SHOPPING_PRICE = { itemId, priceId };
        renderShoppingList();
    }
    function cancelEditShoppingPrice() {
        EDITING_SHOPPING_PRICE = null;
        renderShoppingList();
    }
    function saveEditShoppingPrice(itemId, priceId) {
        const store = document.getElementById(`shoppingEditPriceStore_${priceId}`).value.trim();
        const price = parseFloat(document.getElementById(`shoppingEditPriceValue_${priceId}`).value);
        if (!store || !Number.isFinite(price) || price < 0) return alert('Indica a loja e um preço válido.');
        socket.emit('edit_shopping_price', { itemId, priceId, store, price });
        EDITING_SHOPPING_PRICE = null;
    }
    function renderShoppingItemRow(item) {
        if (EDITING_SHOPPING_ITEM_ID === item.id) {
            return `<div style="background:rgba(255,255,255,0.08);border-radius:8px;padding:10px;margin:8px 0;border:1px solid var(--green);">
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                    <input type="text" id="shoppingEditName_${item.id}" value="${escapeHtml(item.name)}" style="flex:1;min-width:100px;font-size:13px;padding:5px 8px;">
                    <input type="number" id="shoppingEditQty_${item.id}" value="${item.qty}" min="0.001" step="any" style="width:55px;font-size:13px;padding:5px 8px;">
                    <select id="shoppingEditUnit_${item.id}" style="font-size:12px;"></select>
                    <select id="shoppingEditCategory_${item.id}" style="font-size:12px;"></select>
                </div>
                <div class="modal-actions" style="margin-top:8px;">
                    <button class="btn-small" onclick="cancelEditShoppingItem()">Cancelar</button>
                    <button class="btn-small btn-accept" onclick="saveEditShoppingItem('${item.id}')">Guardar</button>
                </div>
            </div>`;
        }
        const cheapest = item.prices.length ? Math.min(...item.prices.map((p) => p.price)) : null;
        const pricesHtml = item.prices.map((p) => {
            const isCheapest = p.price === cheapest;
            const isEditing = EDITING_SHOPPING_PRICE && EDITING_SHOPPING_PRICE.itemId === item.id && EDITING_SHOPPING_PRICE.priceId === p.id;
            if (isEditing) {
                return `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.1);border-radius:12px;padding:3px 6px;">
                    <input type="text" id="shoppingEditPriceStore_${p.id}" value="${escapeHtml(p.store)}" style="width:70px;font-size:11px;padding:2px 4px;">
                    <input type="number" id="shoppingEditPriceValue_${p.id}" value="${p.price}" step="0.01" min="0" style="width:50px;font-size:11px;padding:2px 4px;">
                    <span onclick="saveEditShoppingPrice('${item.id}','${p.id}')" style="cursor:pointer;color:var(--green);">✓</span>
                    <span onclick="cancelEditShoppingPrice()" style="cursor:pointer;opacity:0.7;">✕</span>
                </span>`;
            }
            return `<span style="background:${isCheapest ? 'rgba(37,211,102,0.3)' : 'rgba(255,255,255,0.08)'};border:1px solid ${isCheapest ? 'var(--green)' : 'transparent'};border-radius:12px;padding:3px 8px;font-size:11px;display:inline-flex;align-items:center;gap:5px;">
                ${isCheapest ? '✅ ' : ''}${escapeHtml(p.store)}: ${p.price.toFixed(2)}€
                <span onclick="startEditShoppingPrice('${item.id}','${p.id}')" style="cursor:pointer;opacity:0.7;">✏️</span>
                <span onclick="deleteShoppingPrice('${item.id}','${p.id}')" style="cursor:pointer;opacity:0.7;">✕</span>
            </span>`;
        }).join('');
        return `<div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:10px;margin:8px 0;">
            <div style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" ${item.bought ? 'checked' : ''} onchange="toggleShoppingItem('${item.id}')">
                <div style="flex:1;font-weight:600;text-decoration:${item.bought ? 'line-through' : 'none'};opacity:${item.bought ? 0.6 : 1};">${escapeHtml(item.name)} <span style="font-size:11px;opacity:0.7;font-weight:400;">${formatShoppingQty(item.qty, item.unit)}</span></div>
                <button onclick="startEditShoppingItem('${item.id}')" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:14px;">✏️</button>
                <button onclick="deleteShoppingItem('${item.id}')" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:14px;">🗑️</button>
            </div>
            ${pricesHtml ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;">${pricesHtml}</div>` : ''}
            <div style="display:flex;gap:6px;margin-top:6px;">
                <input type="text" placeholder="Loja" class="shopping-store-input" data-item="${item.id}" style="flex:1;font-size:12px;padding:5px 8px;">
                <input type="number" placeholder="Preço" class="shopping-price-input" data-item="${item.id}" step="0.01" min="0" style="width:70px;font-size:12px;padding:5px 8px;">
                <button class="btn-small" onclick="addShoppingPrice('${item.id}')" style="font-size:11px;padding:5px 8px;">+ Preço</button>
            </div>
        </div>`;
    }
    function renderShoppingList() {
        const el = document.getElementById('shoppingListItems');
        if (!SHOPPING.items.length) {
            el.innerHTML = '<p style="color:#8696a0;text-align:center;padding:20px;">A tua lista está vazia. Adiciona o primeiro artigo acima.</p>';
        } else {
            // Agrupa por categoria (ordem fixa = ordem de corredores), só mostra
            // secções que tenham pelo menos um artigo.
            const groups = Object.entries(SHOPPING_CATEGORIES)
                .map(([key, label]) => ({ key, label, items: SHOPPING.items.filter((i) => (i.category || 'outros') === key) }))
                .filter((g) => g.items.length);
            el.innerHTML = groups.map((g) => `
                <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin:14px 0 4px;text-transform:uppercase;letter-spacing:0.5px;">${g.label} (${g.items.length})</div>
                ${g.items.map(renderShoppingItemRow).join('')}
            `).join('');
            // O <select> de edição é montado à parte (não dá para pôr <option selected>
            // dinâmico dentro do template de forma simples com o valor certo já ativo).
            if (EDITING_SHOPPING_ITEM_ID) {
                const editingItem = SHOPPING.items.find((i) => i.id === EDITING_SHOPPING_ITEM_ID);
                const catSel = document.getElementById(`shoppingEditCategory_${EDITING_SHOPPING_ITEM_ID}`);
                const unitSel = document.getElementById(`shoppingEditUnit_${EDITING_SHOPPING_ITEM_ID}`);
                if (editingItem && catSel) populateShoppingCategorySelect(catSel, editingItem.category || 'outros');
                if (editingItem && unitSel) populateShoppingUnitSelect(unitSel, editingItem.unit || 'un');
            }
        }
        document.getElementById('shoppingListTotal').textContent = formatEuro(computeShoppingTotal(SHOPPING.items));
    }
    function openShoppingShareModal() {
        if (!SHOPPING.items.length) return alert('A tua lista está vazia — adiciona artigos antes de partilhar.');
        const el = document.getElementById('shoppingShareChatList');
        const chats = APP.chats.filter((c) => c.type === 'user' || c.type === 'group');
        el.innerHTML = chats.length ? chats.map((c) => `
            <div class="chat-item" style="cursor:pointer;" onclick="shareShoppingListToChat('${c.id}')">
                <div class="chat-item-avatar ${c.type === 'group' ? 'avatar-group' : 'avatar-user'}">${c.type === 'group' ? '👥' : escapeHtml((c.name || '?').charAt(0).toUpperCase())}</div>
                <div class="chat-item-info"><h4>${escapeHtml(c.name)}</h4></div>
            </div>`).join('') : '<p style="color:#8696a0;text-align:center;">Ainda não tens conversas.</p>';
        document.getElementById('modalShoppingShare').classList.add('active');
    }
    function shareShoppingListToChat(chatId) {
        const chat = APP.chats.find((c) => c.id === chatId);
        if (!chat) return;
        closeModal('modalShoppingShare');
        const items = SHOPPING.items.map((item) => {
            const cheapest = item.prices.length ? item.prices.reduce((a, b) => (a.price < b.price ? a : b)) : null;
            return { name: item.name, qty: item.qty, unit: item.unit || 'un', store: cheapest ? cheapest.store : null, price: cheapest ? cheapest.price : null };
        });
        const shoppingList = { items, total: computeShoppingTotal(SHOPPING.items) };
        const msgId = 'm' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        if (!APP.messages[chatId]) APP.messages[chatId] = [];
        APP.messages[chatId].push({ id: msgId, sender: 'Você', text: '', time, type: 'sent', shoppingList, read: false });
        if (APP.currentChatId === chatId) renderMessages();
        renderChatList();
        socket.emit('send_message', { id: msgId, chatId, sender: APP.user.name, senderPhone: APP.user.phone, toPhone: chat.type === 'user' ? chat.phone : undefined, text: '', time, shoppingList });
    }
    function renderSharedShoppingList(msg) {
        const sl = msg.shoppingList;
        const itemsHtml = sl.items.map((item) => `
            <div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;font-size:12px;">
                <span>${escapeHtml(item.name)} <span style="opacity:0.7;">${formatShoppingQty(item.qty, item.unit)}</span></span>
                <span style="flex-shrink:0;">${item.price != null ? `${escapeHtml(item.store)}: ${item.price.toFixed(2)}€` : '—'}</span>
            </div>`).join('');
        return `<div style="min-width:220px;">
            <div style="font-weight:600;margin-bottom:6px;">🛒 Lista de compras</div>
            ${itemsHtml}
            <div style="font-size:11px;opacity:0.7;margin-top:4px;">${sl.items.length} artigo${sl.items.length !== 1 ? 's' : ''}</div>
            <div style="font-weight:700;margin-top:6px;border-top:1px solid rgba(255,255,255,0.15);padding-top:4px;">Total: ${sl.total.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</div>
        </div>`;
    }
    function finalizeShoppingList() {
        if (!SHOPPING.items.length) return alert('A tua lista está vazia.');
        if (!confirm('Finalizar a lista? Fica guardada no histórico com o total, o PDF é gerado agora, e a lista atual fica vazia para recomeçares.')) return;
        generateShoppingPdf([...SHOPPING.items], computeShoppingTotal(SHOPPING.items), new Date());
        socket.emit('finalize_shopping_list');
    }
    function openShoppingHistoryModal() {
        renderShoppingHistory();
        document.getElementById('modalShoppingHistory').classList.add('active');
    }
    function renderShoppingHistory() {
        const el = document.getElementById('shoppingHistoryList');
        el.innerHTML = SHOPPING.history.length ? SHOPPING.history.map((h) => {
            const isExpanded = EXPANDED_SHOPPING_HISTORY_ID === h.id;
            return `<div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:8px 10px;margin:6px 0;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;" onclick="toggleShoppingHistoryExpand('${h.id}')">
                    <div>
                        <div style="font-size:13px;">${new Date(h.finalizedAt).toLocaleDateString('pt-PT')}</div>
                        <div style="font-size:11px;opacity:0.7;">${h.items.length} artigo${h.items.length !== 1 ? 's' : ''} · toca para ${isExpanded ? 'esconder' : 'corrigir preços'}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <div style="font-weight:600;">${formatEuro(h.total)}</div>
                        <button class="btn-small" onclick="event.stopPropagation();regenerateShoppingPdf('${h.id}')">📄 PDF</button>
                    </div>
                </div>
                ${isExpanded ? renderShoppingHistoryItems(h) : ''}
            </div>`;
        }).join('') : '<p style="color:#8696a0;text-align:center;padding:20px;">Ainda não finalizaste nenhuma lista.</p>';
    }
    function toggleShoppingHistoryExpand(historyId) {
        EXPANDED_SHOPPING_HISTORY_ID = EXPANDED_SHOPPING_HISTORY_ID === historyId ? null : historyId;
        EDITING_SHOPPING_HISTORY_PRICE = null;
        renderShoppingHistory();
    }
    function renderShoppingHistoryItems(entry) {
        return `<div style="margin-top:8px;border-top:1px solid rgba(255,255,255,0.1);padding-top:8px;">
            ${entry.items.map((item) => renderShoppingHistoryItemRow(entry.id, item)).join('')}
        </div>`;
    }
    function renderShoppingHistoryItemRow(historyId, item) {
        const cheapest = item.prices.length ? Math.min(...item.prices.map((p) => p.price)) : null;
        const pricesHtml = item.prices.length ? item.prices.map((p) => {
            const isCheapest = p.price === cheapest;
            const isEditing = EDITING_SHOPPING_HISTORY_PRICE && EDITING_SHOPPING_HISTORY_PRICE.historyId === historyId && EDITING_SHOPPING_HISTORY_PRICE.itemId === item.id && EDITING_SHOPPING_HISTORY_PRICE.priceId === p.id;
            if (isEditing) {
                return `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.1);border-radius:12px;padding:3px 6px;">
                    <input type="text" id="shoppingHistEditStore_${p.id}" value="${escapeHtml(p.store)}" style="width:70px;font-size:11px;padding:2px 4px;">
                    <input type="number" id="shoppingHistEditValue_${p.id}" value="${p.price}" step="0.01" min="0" style="width:50px;font-size:11px;padding:2px 4px;">
                    <span onclick="saveEditShoppingHistoryPrice('${historyId}','${item.id}','${p.id}')" style="cursor:pointer;color:var(--green);">✓</span>
                    <span onclick="cancelEditShoppingHistoryPrice()" style="cursor:pointer;opacity:0.7;">✕</span>
                </span>`;
            }
            return `<span style="background:${isCheapest ? 'rgba(37,211,102,0.3)' : 'rgba(255,255,255,0.08)'};border:1px solid ${isCheapest ? 'var(--green)' : 'transparent'};border-radius:12px;padding:3px 8px;font-size:11px;display:inline-flex;align-items:center;gap:5px;">
                ${isCheapest ? '✅ ' : ''}${escapeHtml(p.store)}: ${p.price.toFixed(2)}€
                <span onclick="startEditShoppingHistoryPrice('${historyId}','${item.id}','${p.id}')" style="cursor:pointer;opacity:0.7;">✏️</span>
            </span>`;
        }).join('') : '<span style="font-size:11px;opacity:0.6;">sem preço registado</span>';
        return `<div style="padding:4px 0;">
            <div style="font-size:12px;">${escapeHtml(item.name)} <span style="opacity:0.7;">${formatShoppingQty(item.qty, item.unit)}</span></div>
            <div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:5px;">${pricesHtml}</div>
        </div>`;
    }
    function startEditShoppingHistoryPrice(historyId, itemId, priceId) {
        EDITING_SHOPPING_HISTORY_PRICE = { historyId, itemId, priceId };
        renderShoppingHistory();
    }
    function cancelEditShoppingHistoryPrice() {
        EDITING_SHOPPING_HISTORY_PRICE = null;
        renderShoppingHistory();
    }
    function saveEditShoppingHistoryPrice(historyId, itemId, priceId) {
        const store = document.getElementById(`shoppingHistEditStore_${priceId}`).value.trim();
        const price = parseFloat(document.getElementById(`shoppingHistEditValue_${priceId}`).value);
        if (!store || !Number.isFinite(price) || price < 0) return alert('Indica a loja e um preço válido.');
        socket.emit('edit_shopping_history_price', { historyId, itemId, priceId, store, price });
        EDITING_SHOPPING_HISTORY_PRICE = null;
    }
    function regenerateShoppingPdf(historyId) {
        const entry = SHOPPING.history.find((h) => h.id === historyId);
        if (!entry) return;
        generateShoppingPdf(entry.items, entry.total, new Date(entry.finalizedAt));
    }
    // O jsPDF é pesado (não vale a pena no carregamento normal da app) — só é
    // carregado do CDN quando esta funcionalidade é mesmo usada pela primeira vez.
    let JSPDF_LOAD_PROMISE = null;
    function loadJsPdfScript() {
        if (window.jspdf) return Promise.resolve();
        if (JSPDF_LOAD_PROMISE) return JSPDF_LOAD_PROMISE;
        JSPDF_LOAD_PROMISE = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
            script.onload = () => resolve();
            script.onerror = () => { JSPDF_LOAD_PROMISE = null; reject(new Error('Não foi possível carregar o gerador de PDF.')); };
            document.head.appendChild(script);
        });
        return JSPDF_LOAD_PROMISE;
    }
    async function generateShoppingPdf(items, total, date) {
        try {
            await loadJsPdfScript();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            doc.setFontSize(16);
            doc.text('Lista de Compras', 14, 18);
            doc.setFontSize(10);
            doc.text(date.toLocaleDateString('pt-PT') + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), 14, 25);
            let y = 36;
            doc.setFontSize(11);
            items.forEach((item) => {
                const cheapest = item.prices.length ? item.prices.reduce((a, b) => (a.price < b.price ? a : b)) : null;
                const line = `${item.name} ${formatShoppingQty(item.qty, item.unit)}` + (cheapest ? ` — ${cheapest.store}: ${cheapest.price.toFixed(2)}€ (subtotal ${(cheapest.price * item.qty).toFixed(2)}€)` : ' — sem preço registado');
                doc.text(line, 14, y);
                y += 8;
                if (y > 280) { doc.addPage(); y = 20; }
            });
            y += 6;
            doc.setFontSize(13);
            doc.setFont(undefined, 'bold');
            doc.text(`Total: ${total.toFixed(2)} €`, 14, y);
            doc.save(`lista-compras-${date.toISOString().slice(0, 10)}.pdf`);
        } catch (err) {
            alert('⚠️ Não foi possível gerar o PDF agora: ' + err.message);
        }
    }

    // ==================== LEMBRETES PESSOAIS ====================
    // Avisa mesmo com a app fechada (notificação push, se ativada) — e também
    // em tempo real se estiveres ligado nesse momento (ver o alert() abaixo).
    // 'initialized' evita um problema real: sem isto, o PRIMEIRO 'reminders_list'
    // que chega ao entrar (que já pode trazer lembretes antigos já notificados
    // de sessões passadas) seria interpretado como "acabaram de disparar agora",
    // mostrando um alerta por cada um logo ao abrir a app.
    const REMINDERS = { items: [], initialized: false };
    socket.on('reminders_list', (list) => {
        if (!REMINDERS.initialized) {
            REMINDERS.items = list || [];
            REMINDERS.initialized = true;
            if (document.getElementById('remindersScreen').classList.contains('active')) renderReminders();
            return;
        }
        const prevNotifiedIds = new Set(REMINDERS.items.filter((r) => r.notified).map((r) => r.id));
        const newlyNotified = (list || []).filter((r) => r.notified && !prevNotifiedIds.has(r.id));
        REMINDERS.items = list || [];
        if (document.getElementById('remindersScreen').classList.contains('active')) renderReminders();
        newlyNotified.forEach((r) => alert(`🔔 Lembrete: ${r.text}`));
    });
    function openRemindersScreen() {
        document.getElementById('remindersScreen').classList.add('active');
        renderReminders();
    }
    function closeRemindersScreen() { document.getElementById('remindersScreen').classList.remove('active'); }
    function setReminderDatetimeInput(d) {
        const pad = (n) => String(n).padStart(2, '0');
        document.getElementById('reminderDatetimeInput').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    function quickPickReminderTime(hours) {
        setReminderDatetimeInput(new Date(Date.now() + hours * 60 * 60 * 1000));
    }
    function quickPickReminderTonight() {
        const d = new Date();
        d.setHours(20, 0, 0, 0);
        if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); // já passou das 20h — é amanhã à noite
        setReminderDatetimeInput(d);
    }
    function quickPickReminderTomorrow() {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        setReminderDatetimeInput(d);
    }
    // Seletor de "qualquer hora": escolhe só a hora (input nativo type="time",
    // o mais simples/rápido no telemóvel) e assume hoje — ou amanhã, se essa
    // hora já tiver passado hoje, para nunca acabar a marcar uma hora no passado.
    function quickPickReminderTimeToday() {
        const timeStr = document.getElementById('reminderTimeOnlyInput').value;
        if (!timeStr) return alert('Escolhe uma hora primeiro.');
        const [h, m] = timeStr.split(':').map(Number);
        const d = new Date();
        d.setHours(h, m, 0, 0);
        if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
        setReminderDatetimeInput(d);
    }
    function addReminder() {
        const textInput = document.getElementById('reminderTextInput');
        const text = textInput.value.trim();
        const datetimeStr = document.getElementById('reminderDatetimeInput').value;
        if (!text) return alert('Escreve o que queres que te lembre.');
        if (!datetimeStr) return alert('Escolhe quando queres ser lembrado.');
        const remindAt = new Date(datetimeStr).getTime();
        if (!Number.isFinite(remindAt) || remindAt <= Date.now()) return alert('Escolhe uma data/hora no futuro.');
        socket.emit('add_reminder', { text, remindAt });
        textInput.value = '';
        document.getElementById('reminderDatetimeInput').value = '';
    }
    function deleteReminder(id) { socket.emit('delete_reminder', { id }); }
    function renderReminders() {
        const el = document.getElementById('remindersList');
        const sorted = [...REMINDERS.items].sort((a, b) => a.remindAt - b.remindAt);
        el.innerHTML = sorted.length ? sorted.map((r) => {
            const dateStr = new Date(r.remindAt).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            return `<div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:10px;margin:8px 0;display:flex;justify-content:space-between;align-items:center;gap:8px;opacity:${r.notified ? 0.6 : 1};">
                <div>
                    <div style="font-weight:600;">${escapeHtml(r.text)}</div>
                    <div style="font-size:11px;opacity:0.7;">${dateStr}${r.notified ? ' · 🔔 já notificado' : ''}</div>
                </div>
                <button onclick="deleteReminder('${r.id}')" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:14px;">🗑️</button>
            </div>`;
        }).join('') : '<p style="color:#8696a0;text-align:center;padding:20px;">Ainda não tens lembretes. Adiciona um acima.</p>';
    }

    // ==================== NOTÍCIAS ====================
    const NEWS = { items: [], tab: 'portugal', loaded: false, articleLink: null };
    async function openNewsArticle(link, source) {
        NEWS.articleLink = link;
        document.getElementById('newsArticleSource').textContent = source || 'Notícia';
        document.getElementById('newsArticleScreen').classList.add('active');
        document.getElementById('newsArticleNotice').style.display = 'none';
        document.getElementById('newsArticleFrame').style.display = 'none';
        const reader = document.getElementById('newsArticleReader');
        reader.style.display = 'block';
        reader.innerHTML = '<p style="padding:24px;text-align:center;color:var(--text-secondary);">A carregar o artigo...</p>';
        try {
            const res = await fetch('/api/news/read?url=' + encodeURIComponent(link));
            const data = await res.json();
            if (!data.success || !data.content) throw new Error('sem conteúdo');
            reader.innerHTML = `
                <div style="padding:18px 16px 40px;max-width:640px;margin:0 auto;">
                    <h2 style="margin:0 0 6px;font-size:20px;line-height:1.3;">${escapeHtml(data.title)}</h2>
                    ${data.byline ? `<p style="color:var(--text-secondary);font-size:13px;margin:0 0 16px;">${escapeHtml(data.byline)}</p>` : '<div style="margin-bottom:16px;"></div>'}
                    <div class="news-article-content">${data.content}</div>
                </div>`;
        } catch (e) {
            // não conseguiu extrair o texto (site bloqueou o servidor, artigo com formato
            // atípico, etc.) — volta ao iframe normal como reserva, com o aviso já existente
            reader.style.display = 'none';
            document.getElementById('newsArticleNotice').style.display = 'block';
            const frame = document.getElementById('newsArticleFrame');
            frame.style.display = 'block';
            frame.src = link;
        }
    }
    function closeNewsArticle() {
        document.getElementById('newsArticleScreen').classList.remove('active');
        document.getElementById('newsArticleFrame').src = 'about:blank'; // para o site parar de correr em segundo plano
    }

    // ==================== TV EM DIRETO ====================
    // Notícias: transmissões oficiais e gratuitas de cada emissora no YouTube,
    // através do endpoint público "embed/live_stream?channel=" — o YouTube
    // resolve sozinho qual é a emissão ao vivo atual do canal, sem precisarmos
    // de saber o ID de um vídeo específico (que mudaria a cada transmissão nova).
    // Alguns canais (ex.: TVS) não têm live 24h configurado no YouTube, mas têm
    // o próprio site com transmissão direta — nesse caso usamos "directUrl" em
    // vez de "channelId" (ver selectTvChannel). Só canais gratuitos e
    // licenciados de verdade — nunca sites/canais piratas.
    const TV_NEWS_CHANNELS = [
        { id: 'pt', name: 'Euronews (Português)', flag: '🇵🇹', channelId: 'UCUmEPYxmnyQDeRUcFkslmQw' },
        { id: 'es', name: 'Euronews (Español)', flag: '🇪🇸', channelId: 'UCyoGb3SMlTlB8CLGVH4c8Rw' },
        { id: 'fr', name: 'France 24', flag: '🇫🇷', channelId: 'UCCCPCZNChQdGa9EkATeye4g' },
        { id: 'stp2', name: 'TVS (site)', flag: '🇸🇹', directUrl: 'https://tvs.st/index.php?controller=home&action=tvsplay' },
        { id: 'rn', name: 'Record News', flag: '🇧🇷', channelId: 'UCuiLR4p6wQ3xLEm15pEn1Xw' },
        { id: 'dw', name: 'DW Español', flag: '🇩🇪', channelId: 'UCT4Jg8h03dD0iN3Pb5L0PMA' },
        { id: 'doce', name: 'El Doce', flag: '🇦🇷', channelId: 'UCiaePeoCqpU8hBHiNrgkzrA' }
    ];
    const TV = { current: null };
    // DOM guardado uma única vez (evita repetir getElementById em cada função).
    const tvEl = {
        get screen() { return document.getElementById('tvScreen'); },
        get channelTabs() { return document.getElementById('tvTabs'); },
        get frame() { return document.getElementById('tvFrame'); }
    };
    function openTvScreen() {
        tvEl.screen.classList.add('active');
        renderTvChannelTabs();
        if (!TV.current) selectTvChannel(TV_NEWS_CHANNELS[0].id);
    }
    function closeTvScreen() {
        tvEl.screen.classList.remove('active');
        tvEl.frame.src = 'about:blank'; // para o vídeo parar de correr em segundo plano
    }
    function renderTvChannelTabs() {
        tvEl.channelTabs.innerHTML = TV_NEWS_CHANNELS.map(c => `
            <button class="btn-small tv-tab ${TV.current === c.id ? 'btn-accept' : ''}" style="flex-shrink:0;" onclick="selectTvChannel('${c.id}')">${c.flag} ${c.name}</button>
        `).join('');
    }
    function selectTvChannel(id) {
        const ch = TV_NEWS_CHANNELS.find(c => c.id === id);
        if (!ch) return;
        TV.current = id;
        renderTvChannelTabs();
        tvEl.frame.src = ch.directUrl || `https://www.youtube.com/embed/live_stream?channel=${ch.channelId}&autoplay=1`;
    }

    // ==================== BIBLIOTECA GRATUITA (Project Gutenberg + EPUB local) ====================
    // Lê ficheiros EPUB dentro da própria app — livros de domínio público
    // (via /api/library/gutenberg, que passa pelo Gutendex no servidor) ou um
    // EPUB próprio do utilizador. A leitura em si (desenhar as páginas) usa a
    // biblioteca epub.js (carregada via CDN); a lista de livros gratuitos
    // passa pelo servidor, tal como as outras integrações externas desta app.
    let libraryCurrentBook = null;
    let libraryCurrentRendition = null;
    let libraryBooksCache = [];
    function openLibraryScreen() {
        document.getElementById('libraryScreen').classList.add('active');
    }
    function closeLibraryScreen() {
        document.getElementById('libraryScreen').classList.remove('active');
        closeLibraryReader();
    }
    function closeLibraryReader() {
        document.getElementById('libraryReader').style.display = 'none';
        document.getElementById('libraryListView').style.display = 'block';
        if (libraryCurrentBook) { libraryCurrentBook.destroy(); libraryCurrentBook = null; }
        libraryCurrentRendition = null;
    }
    function libraryPrevPage() { libraryCurrentRendition?.prev(); }
    function libraryNextPage() { libraryCurrentRendition?.next(); }
    // Setas do teclado também viram a página (útil no computador) — só ativo
    // enquanto o leitor da Biblioteca está mesmo visível, para não roubar as
    // setas a outras partes da app (ex.: navegar entre fotos).
    document.addEventListener('keydown', (e) => {
        if (document.getElementById('libraryReader').style.display !== 'block') return;
        if (e.key === 'ArrowRight') libraryNextPage();
        else if (e.key === 'ArrowLeft') libraryPrevPage();
    });
    async function openLibraryBook(bookData) {
        document.getElementById('libraryListView').style.display = 'none';
        document.getElementById('libraryReader').style.display = 'block';
        const contentDiv = document.getElementById('libraryReaderContent');
        contentDiv.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:30px;">A abrir o livro...</p>';
        // A mensagem inclui sempre o MOTIVO exato (não só "não foi possível") —
        // sem isto, um problema no proxy do servidor (ver /api/library/gutenberg/file)
        // e um bloqueador de anúncios a impedir o CDN do leitor pareciam
        // exatamente o mesmo erro genérico, tornando impossível perceber qual
        // dos dois estava mesmo a acontecer sem aceder aos logs do servidor.
        const showOpenError = (reason) => {
            contentDiv.innerHTML = `<p style="color:#e74c3c;text-align:center;padding:30px;">Não foi possível abrir este livro.<br><span style="font-size:12px;opacity:0.85;">${escapeHtml(reason)}</span></p>`;
        };
        // Se "bookData" for um URL do nosso próprio proxy (livro do Gutenberg,
        // ao contrário de um EPUB local já em ArrayBuffer), confirma primeiro
        // que o ficheiro chega mesmo — assim, se o servidor recusar ou falhar,
        // a mensagem mostra a razão exata devolvida por ele, em vez de deixar
        // o epub.js falhar por conta própria de forma pouco clara. Reaproveita
        // logo os bytes já descarregados (em vez de deixar o epub.js pedir o
        // mesmo ficheiro outra vez) — evita duplicar o pedido ao Gutenberg.
        if (typeof bookData === 'string' && bookData.startsWith('/api/')) {
            try {
                const r = await fetch(bookData);
                if (!r.ok) {
                    let detail = 'HTTP ' + r.status;
                    try { const errData = await r.clone().json(); if (errData.error) detail = errData.error; } catch (e) { /* corpo não era JSON, mantém o HTTP status */ }
                    showOpenError(detail);
                    return;
                }
                bookData = await r.arrayBuffer();
            } catch (err) {
                showOpenError('Falha de rede ao contactar o servidor (' + err.message + ').');
                return;
            }
        }
        // epub.js vem de um CDN externo — se falhar ao carregar (rede em baixo,
        // bloqueador de anúncios, CDN em baixo), ePub() nem existe: chamar isso
        // diretamente lançava um erro não tratado, deixando o ecrã preso sem
        // explicação nenhuma em vez de mostrar o aviso amigável.
        if (typeof ePub === 'undefined') { showOpenError('O leitor de livros não carregou (pode ser um bloqueador de anúncios, ou o CDN estar em baixo) — tenta recarregar a página.'); return; }
        try {
            if (libraryCurrentBook) libraryCurrentBook.destroy();
            libraryCurrentBook = ePub(bookData);
            const rendition = libraryCurrentBook.renderTo(contentDiv, { width: '100%', height: '100%', spread: 'none', flow: 'paginated' });
            libraryCurrentRendition = rendition;
            let rendered = false;
            // "display()" pode resolver a promessa sem o livro chegar a
            // aparecer de verdade no ecrã (ex.: o ficheiro veio corrompido, ou
            // uma falha silenciosa dentro do epub.js) — sem o evento 'rendered'
            // + o "watchdog" abaixo, o ecrã ficava preso em branco, com o botão
            // "Voltar à lista" a ser a única coisa visível, sem erro nenhum.
            rendition.on('rendered', () => {
                rendered = true;
                const loadingMsg = contentDiv.querySelector('p');
                if (loadingMsg) loadingMsg.remove();
            });
            rendition.display().catch((err) => showOpenError('O ficheiro não é um EPUB válido (' + (err?.message || 'erro desconhecido do leitor') + ').'));
            setTimeout(() => { if (!rendered && !contentDiv.querySelector('iframe')) showOpenError('O leitor não conseguiu mostrar o livro a tempo (pode ser um ficheiro corrompido ou demasiado lento a carregar).'); }, 10000);
        } catch (err) {
            showOpenError('Erro inesperado do leitor (' + err.message + ').');
        }
    }
    async function fetchLibraryBooks(searchQuery) {
        const loading = document.getElementById('libraryLoading');
        const bookList = document.getElementById('libraryBookList');
        const source = document.getElementById('librarySourceSelect').value;
        loading.style.display = 'block';
        bookList.innerHTML = '';
        try {
            const endpoint = source === 'archive' ? '/api/library/archive' : '/api/library/gutenberg';
            const url = endpoint + (searchQuery ? '?search=' + encodeURIComponent(searchQuery) : '');
            const r = await fetch(url);
            const data = await r.json();
            libraryBooksCache = data.books || [];
            if (!libraryBooksCache.length) {
                bookList.innerHTML = data.error
                    ? `<p style="color:#e74c3c;grid-column:1/-1;text-align:center;">${escapeHtml(data.error)}</p>`
                    : '<p style="color:var(--text-secondary);grid-column:1/-1;text-align:center;">Nenhum livro encontrado.</p>';
                loading.style.display = 'none';
                return;
            }
            // Se o servidor não conseguiu mesmo contactar o Gutendex, "books"
            // vem preenchido com a lista de reserva (ver server.js) — mostra
            // sempre os livros, mas com um aviso a explicar que não são o
            // resultado da tua pesquisa/lista pedida. (O Internet Archive não
            // tem lista de reserva própria — se falhar, mostra o erro real.)
            const warningHtml = data.fallback
                ? `<p style="color:orange;grid-column:1/-1;text-align:center;font-size:12px;margin:0 0 8px;">⚠️ ${escapeHtml(data.error || 'Não foi possível contactar o Gutendex agora.')} A mostrar livros pré-carregados:</p>`
                : '';
            bookList.innerHTML = warningHtml + libraryBooksCache.map((b, i) => `
                <div style="background:var(--bg-tertiary);padding:10px;border-radius:8px;cursor:pointer;text-align:center;" onclick="abrirLivroDaLista(${i})">
                    <div style="font-size:28px;">📖</div>
                    <h4 style="margin:5px 0;font-size:13px;color:var(--text-primary);">${escapeHtml(b.title)}</h4>
                    <p style="margin:0;font-size:11px;color:var(--text-secondary);">${escapeHtml(b.author)}</p>
                </div>`).join('');
        } catch (err) {
            bookList.innerHTML = '<p style="color:#e74c3c;grid-column:1/-1;text-align:center;">Não foi possível ligar ao servidor.</p>';
        }
        loading.style.display = 'none';
    }
    function carregarListaGutenberg() { fetchLibraryBooks(); }
    function doLibrarySearch() {
        const q = document.getElementById('librarySearchInput').value.trim();
        if (q) fetchLibraryBooks(q);
    }
    function abrirLivroDaLista(index) {
        const book = libraryBooksCache[index];
        if (!book) return;
        // Cada fonte tem o seu próprio proxy de ficheiro no servidor — nunca
        // pedido diretamente ao gutenberg.org/archive.org pelo browser, tal
        // como o resto desta app (ver server.js).
        if (book.source === 'archive') {
            openLibraryBook('/api/library/archive/file?identifier=' + encodeURIComponent(book.id));
        } else {
            openLibraryBook('/api/library/gutenberg/file?url=' + encodeURIComponent(book.epubUrl));
        }
    }
    function handleLibraryFileSelected(input) {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => openLibraryBook(ev.target.result);
        reader.readAsArrayBuffer(file);
        input.value = '';
    }

    // ==================== ONDE ASSISTIR (filmes e séries) ====================
    const WATCH_COUNTRY_TO_REGION = {
        'Portugal': 'PT', 'Brasil': 'BR', 'Angola': 'AO', 'Moçambique': 'MZ', 'Cabo Verde': 'CV',
        'Estados Unidos': 'US', 'Espanha': 'ES', 'França': 'FR', 'Reino Unido': 'GB'
    };
    const WATCH = { region: 'PT', lastResults: [] };
    function openWatchScreen() {
        WATCH.region = WATCH_COUNTRY_TO_REGION[APP.user?.country] || 'PT';
        document.getElementById('watchScreen').classList.add('active');
        document.getElementById('watchSearchInput').value = '';
        document.getElementById('watchResults').innerHTML = '<p style="color:#8696a0;text-align:center;padding:30px;">Pesquisa um filme ou série para ver em que serviços de streaming está disponível.</p>';
        setTimeout(() => document.getElementById('watchSearchInput').focus(), 150);
    }
    function closeWatchScreen() { document.getElementById('watchScreen').classList.remove('active'); }
    async function doWatchSearch() {
        const query = document.getElementById('watchSearchInput').value.trim();
        if (!query) return;
        const el = document.getElementById('watchResults');
        el.innerHTML = '<p style="color:#8696a0;text-align:center;padding:20px;">A pesquisar...</p>';
        try {
            const r = await fetch('/api/watch/search?q=' + encodeURIComponent(query));
            const data = await r.json();
            if (!data.configured) {
                el.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:30px;">⚠️ Esta funcionalidade ainda não está configurada no servidor (falta a chave gratuita do TMDB — ver README).</p>';
                return;
            }
            WATCH.lastResults = data.results || [];
            if (!WATCH.lastResults.length) {
                el.innerHTML = '<p style="color:#8696a0;text-align:center;padding:30px;">Nada encontrado para "' + escapeHtml(query) + '".</p>';
                return;
            }
            el.innerHTML = WATCH.lastResults.map((r, i) => `
                <div class="chat-item" style="cursor:pointer;" onclick="openWatchProviders(${i})">
                    ${r.posterUrl ? `<img src="${r.posterUrl}" style="width:40px;height:60px;object-fit:cover;border-radius:6px;flex:0 0 auto;">` : `<div class="chat-item-avatar avatar-group">🎬</div>`}
                    <div class="chat-item-info"><h4>${escapeHtml(r.title)}${r.year ? ' (' + escapeHtml(r.year) + ')' : ''}</h4><p>${r.mediaType === 'tv' ? 'Série' : 'Filme'}</p></div>
                </div>`).join('');
        } catch (err) {
            el.innerHTML = '<p style="color:var(--red);text-align:center;padding:30px;">Erro ao pesquisar. Tenta outra vez.</p>';
        }
    }
    async function openWatchProviders(index) {
        const item = WATCH.lastResults[index];
        if (!item) return;
        document.getElementById('watchProviderTitle').textContent = '🍿 ' + item.title + (item.year ? ' (' + item.year + ')' : '');
        const content = document.getElementById('watchProviderContent');
        content.innerHTML = '<p style="color:#8696a0;text-align:center;">A carregar...</p>';
        document.getElementById('modalWatchProviders').classList.add('active');
        try {
            const r = await fetch(`/api/watch/providers?id=${item.id}&type=${item.mediaType}`);
            const data = await r.json();
            if (!data.configured) { content.innerHTML = '<p style="color:var(--text-secondary);">Funcionalidade não configurada no servidor.</p>'; return; }
            const region = data.results?.[WATCH.region] || Object.values(data.results || {})[0];
            if (!region) { content.innerHTML = '<p style="color:#8696a0;">Não há informação de onde assistir para este título.</p>'; return; }
            const section = (label, list) => (list && list.length) ? `
                <p style="font-weight:600;margin:10px 0 4px;">${label}</p>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">${list.map(p => `
                    <div style="display:flex;flex-direction:column;align-items:center;width:56px;" title="${escapeHtml(p.provider_name)}">
                        <img src="https://image.tmdb.org/t/p/w92${p.logo_path}" style="width:40px;height:40px;border-radius:8px;">
                        <span style="font-size:9px;text-align:center;margin-top:2px;">${escapeHtml(p.provider_name)}</span>
                    </div>`).join('')}</div>` : '';
            const hasAny = region.free?.length || region.ads?.length || region.flatrate?.length || region.rent?.length || region.buy?.length;
            content.innerHTML = section('🆓 Grátis', region.free) + section('🆓 Grátis (com anúncios)', region.ads) + section('📺 Incluído na subscrição', region.flatrate) + section('💳 Alugar', region.rent) + section('🛒 Comprar', region.buy)
                + (!hasAny ? '<p style="color:#8696a0;">Não há informação de onde assistir para este título na tua região.</p>' : '')
                + (region.link ? `<div class="modal-actions" style="margin-top:14px;"><a href="${region.link}" target="_blank" rel="noopener" class="btn-small btn-accept" style="text-decoration:none;display:inline-block;">🔗 Ver todas as opções</a></div>` : '');
        } catch (err) {
            content.innerHTML = '<p style="color:var(--red);">Erro ao obter informação. Tenta outra vez.</p>';
        }
    }

    // ==================== CÂMBIO (conversor de moedas) ====================
    const CURRENCY_INFO = {
        EUR: { name: 'Euro', flag: '🇪🇺' }, USD: { name: 'Dólar americano', flag: '🇺🇸' },
        BRL: { name: 'Real brasileiro', flag: '🇧🇷' }, AOA: { name: 'Kwanza (Angola)', flag: '🇦🇴' },
        CVE: { name: 'Escudo cabo-verdiano', flag: '🇨🇻' }, MZN: { name: 'Metical (Moçambique)', flag: '🇲🇿' },
        STN: { name: 'Dobra (São Tomé e Príncipe)', flag: '🇸🇹' }, MOP: { name: 'Pataca (Macau)', flag: '🇲🇴' },
        GBP: { name: 'Libra esterlina', flag: '🇬🇧' }, JPY: { name: 'Iene japonês', flag: '🇯🇵' },
        CHF: { name: 'Franco suíço', flag: '🇨🇭' }, CAD: { name: 'Dólar canadiano', flag: '🇨🇦' },
        AUD: { name: 'Dólar australiano', flag: '🇦🇺' }, CNY: { name: 'Yuan chinês', flag: '🇨🇳' },
        INR: { name: 'Rupia indiana', flag: '🇮🇳' }, RUB: { name: 'Rublo russo', flag: '🇷🇺' },
        ZAR: { name: 'Rand sul-africano', flag: '🇿🇦' }, MXN: { name: 'Peso mexicano', flag: '🇲🇽' },
        ARS: { name: 'Peso argentino', flag: '🇦🇷' }, NOK: { name: 'Coroa norueguesa', flag: '🇳🇴' },
        SEK: { name: 'Coroa sueca', flag: '🇸🇪' }, DKK: { name: 'Coroa dinamarquesa', flag: '🇩🇰' },
        PLN: { name: 'Zloty polaco', flag: '🇵🇱' }, TRY: { name: 'Lira turca', flag: '🇹🇷' },
        KRW: { name: 'Won sul-coreano', flag: '🇰🇷' }, SGD: { name: 'Dólar de Singapura', flag: '🇸🇬' },
        AED: { name: 'Dirham dos EAU', flag: '🇦🇪' }, SAR: { name: 'Riyal saudita', flag: '🇸🇦' },
        EGP: { name: 'Libra egípcia', flag: '🇪🇬' }, NGN: { name: 'Naira nigeriana', flag: '🇳🇬' }
    };
    const CURRENCY_PRIORITY = ['EUR', 'USD', 'BRL', 'AOA', 'CVE', 'MZN', 'STN', 'GBP'];
    const CURRENCY = { rates: null, loaded: false };
    function openCurrencyScreen() {
        document.getElementById('currencyScreen').classList.add('active');
        if (!CURRENCY.loaded) loadCurrencyRates();
    }
    function closeCurrencyScreen() { document.getElementById('currencyScreen').classList.remove('active'); }
    async function loadCurrencyRates() {
        document.getElementById('currencyResult').textContent = 'A carregar...';
        try {
            const r = await fetch('/api/currency/rates?base=EUR');
            const data = await r.json();
            if (data.error) throw new Error(data.error);
            CURRENCY.rates = data.rates;
            CURRENCY.loaded = true;
            populateCurrencySelects();
            document.getElementById('currencyUpdated').textContent = data.updated ? ('Atualizado: ' + data.updated) : '';
            convertCurrency();
        } catch (err) {
            document.getElementById('currencyResult').textContent = '⚠️ Não foi possível carregar as taxas agora.';
        }
    }
    function populateCurrencySelects() {
        const codes = Object.keys(CURRENCY.rates);
        const sorted = [...codes].sort((a, b) => {
            const pa = CURRENCY_PRIORITY.indexOf(a), pb = CURRENCY_PRIORITY.indexOf(b);
            if (pa !== -1 || pb !== -1) return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
            return a.localeCompare(b);
        });
        const optionsHtml = sorted.map(code => {
            const info = CURRENCY_INFO[code];
            const label = info ? `${info.flag} ${code} — ${info.name}` : code;
            return `<option value="${code}">${escapeHtml(label)}</option>`;
        }).join('');
        const fromSel = document.getElementById('currencyFrom');
        const toSel = document.getElementById('currencyTo');
        fromSel.innerHTML = optionsHtml;
        toSel.innerHTML = optionsHtml;
        if (codes.includes('EUR')) fromSel.value = 'EUR';
        if (codes.includes('USD')) toSel.value = 'USD';
    }
    function convertCurrency() {
        if (!CURRENCY.rates) return;
        const amount = parseFloat(document.getElementById('currencyAmount').value) || 0;
        const from = document.getElementById('currencyFrom').value;
        const to = document.getElementById('currencyTo').value;
        const fromRate = CURRENCY.rates[from];
        const toRate = CURRENCY.rates[to];
        if (!fromRate || !toRate) return;
        // As taxas são relativas à moeda base (EUR): converte para EUR primeiro, depois para o destino.
        const result = (amount / fromRate) * toRate;
        document.getElementById('currencyResult').textContent = result.toLocaleString('pt-PT', { maximumFractionDigits: 4 }) + ' ' + to;
    }
    function swapCurrency() {
        const fromSel = document.getElementById('currencyFrom');
        const toSel = document.getElementById('currencyTo');
        const tmp = fromSel.value;
        fromSel.value = toSel.value;
        toSel.value = tmp;
        convertCurrency();
    }

    // ==================== MÚSICA (Jamendo) ====================
    const JAMENDO = { lastResults: [], currentIndex: null };
    function openJamendoScreen() {
        document.getElementById('jamendoScreen').classList.add('active');
        document.getElementById('jamendoSearchInput').value = '';
        if (!JAMENDO.lastResults.length) searchJamendo();
        setTimeout(() => document.getElementById('jamendoSearchInput').focus(), 150);
    }
    function closeJamendoScreen() { document.getElementById('jamendoScreen').classList.remove('active'); }
    function renderJamendoResults() {
        const el = document.getElementById('jamendoResults');
        if (!JAMENDO.lastResults.length) {
            el.innerHTML = '<p style="color:#8696a0;text-align:center;padding:30px;">Nada encontrado.</p>';
            return;
        }
        el.innerHTML = JAMENDO.lastResults.map((t, i) => `
            <div class="chat-item" style="cursor:pointer;" onclick="playJamendoTrack(${i})">
                ${t.image ? `<img src="${t.image}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;flex:0 0 auto;">` : `<div class="chat-item-avatar avatar-group">🎧</div>`}
                <div class="chat-item-info"><h4>${escapeHtml(t.title)}</h4><p>${escapeHtml(t.artist)}</p></div>
            </div>`).join('');
    }
    async function searchJamendo() {
        const query = document.getElementById('jamendoSearchInput').value.trim();
        const el = document.getElementById('jamendoResults');
        el.innerHTML = '<p style="color:#8696a0;text-align:center;padding:20px;">A carregar...</p>';
        try {
            const r = await fetch('/api/music/search?q=' + encodeURIComponent(query));
            const data = await r.json();
            if (!data.configured) {
                el.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:30px;">⚠️ Esta funcionalidade ainda não está configurada no servidor (falta a chave gratuita da Jamendo — ver README).</p>';
                return;
            }
            JAMENDO.lastResults = data.results || [];
            renderJamendoResults();
        } catch (err) {
            el.innerHTML = '<p style="color:var(--red);text-align:center;padding:30px;">Erro ao pesquisar. Tenta outra vez.</p>';
        }
    }
    function playJamendoTrack(index) {
        const t = JAMENDO.lastResults[index];
        if (!t) return;
        JAMENDO.currentIndex = index;
        document.getElementById('jamendoPlayerBar').style.display = 'flex';
        document.getElementById('jamendoPlayerImg').src = t.image || '';
        document.getElementById('jamendoPlayerTitle').textContent = t.title;
        document.getElementById('jamendoPlayerArtist').textContent = t.artist;
        const audio = document.getElementById('jamendoAudio');
        audio.src = t.audio;
        audio.play().catch(() => {});
    }

    // ==================== ROLETA / SORTEIO ====================
    const ROULETTE = { options: [], rotation: 0, spinning: false };
    const ROULETTE_COLORS = ['#6c5ce7', '#a29bfe', '#f093fb', '#f5576c', '#4285F4', '#9b72cb', '#25d366', '#f5a623', '#e74c3c', '#1abc9c'];
    function openRouletteScreen() {
        document.getElementById('rouletteScreen').classList.add('active');
        document.getElementById('rouletteResult').textContent = '';
        setTimeout(() => document.getElementById('rouletteOptionInput').focus(), 150);
    }
    function closeRouletteScreen() { document.getElementById('rouletteScreen').classList.remove('active'); }
    function addRouletteOption() {
        const input = document.getElementById('rouletteOptionInput');
        const value = input.value.trim();
        if (!value || ROULETTE.spinning) return;
        ROULETTE.options.push(value);
        input.value = '';
        renderRouletteOptions();
        renderRouletteWheel();
        input.focus();
    }
    function removeRouletteOption(index) {
        if (ROULETTE.spinning) return;
        ROULETTE.options.splice(index, 1);
        renderRouletteOptions();
        renderRouletteWheel();
    }
    function renderRouletteOptions() {
        document.getElementById('rouletteOptionsList').innerHTML = ROULETTE.options.map((opt, i) => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--bg-secondary);border-radius:8px;">
                <span style="font-size:13px;">${escapeHtml(opt)}</span>
                <button class="btn-icon" style="width:26px;height:26px;font-size:12px;" onclick="removeRouletteOption(${i})">✖️</button>
            </div>`).join('');
        document.getElementById('rouletteSpinBtn').disabled = ROULETTE.options.length < 2 || ROULETTE.spinning;
    }
    function renderRouletteWheel() {
        const wheel = document.getElementById('rouletteWheel');
        const n = ROULETTE.options.length;
        if (n === 0) {
            wheel.style.background = 'var(--bg-secondary)';
            document.getElementById('rouletteWheelLabels').innerHTML = '';
            return;
        }
        const slice = 360 / n;
        const stops = ROULETTE.options.map((_, i) => `${ROULETTE_COLORS[i % ROULETTE_COLORS.length]} ${i * slice}deg ${(i + 1) * slice}deg`).join(', ');
        wheel.style.background = `conic-gradient(${stops})`;
        document.getElementById('rouletteWheelLabels').innerHTML = ROULETTE.options.map((opt, i) => {
            const angle = (i + 0.5) * slice;
            return `<div style="position:absolute;left:50%;top:50%;transform-origin:0 0;transform:rotate(${angle}deg) translate(0,-78px) rotate(${-angle}deg);width:90px;margin-left:-45px;text-align:center;font-size:11px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.6);pointer-events:none;">${escapeHtml(opt.length > 14 ? opt.slice(0, 13) + '…' : opt)}</div>`;
        }).join('');
    }
    // Roda a roleta inteira (transform:rotate) até o centro da fatia vencedora
    // ficar debaixo do ponteiro fixo (topo, ângulo 0) — soma voltas extras só
    // para dar sensação de movimento, o resultado real já é escolhido antes de
    // a animação começar.
    function spinRoulette() {
        if (ROULETTE.spinning || ROULETTE.options.length < 2) return;
        ROULETTE.spinning = true;
        document.getElementById('rouletteSpinBtn').disabled = true;
        document.getElementById('rouletteResult').textContent = '';
        const n = ROULETTE.options.length;
        const winnerIndex = Math.floor(Math.random() * n);
        const slice = 360 / n;
        const centerAngle = (winnerIndex + 0.5) * slice;
        const extraSpins = 5 + Math.floor(Math.random() * 3);
        const finalMod = (360 - centerAngle) % 360;
        const currentMod = ((ROULETTE.rotation % 360) + 360) % 360;
        let delta = finalMod - currentMod;
        if (delta < 0) delta += 360;
        ROULETTE.rotation += extraSpins * 360 + delta;
        const wheel = document.getElementById('rouletteWheel');
        wheel.style.transition = 'transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99)';
        wheel.style.transform = `rotate(${ROULETTE.rotation}deg)`;
        setTimeout(() => {
            ROULETTE.spinning = false;
            document.getElementById('rouletteSpinBtn').disabled = false;
            document.getElementById('rouletteResult').textContent = '🎉 ' + ROULETTE.options[winnerIndex];
        }, 4100);
    }

    // ==================== METEOROLOGIA (Open-Meteo) ====================
    // Mapa dos códigos WMO devolvidos pela Open-Meteo para um ícone + descrição em português.
    const WEATHER_CODES = {
        0: { icon: '☀️', desc: 'Céu limpo' }, 1: { icon: '🌤️', desc: 'Poucas nuvens' },
        2: { icon: '⛅', desc: 'Parcialmente nublado' }, 3: { icon: '☁️', desc: 'Nublado' },
        45: { icon: '🌫️', desc: 'Nevoeiro' }, 48: { icon: '🌫️', desc: 'Nevoeiro com geada' },
        51: { icon: '🌦️', desc: 'Chuvisco fraco' }, 53: { icon: '🌦️', desc: 'Chuvisco' }, 55: { icon: '🌦️', desc: 'Chuvisco forte' },
        56: { icon: '🌨️', desc: 'Chuvisco gelado' }, 57: { icon: '🌨️', desc: 'Chuvisco gelado forte' },
        61: { icon: '🌧️', desc: 'Chuva fraca' }, 63: { icon: '🌧️', desc: 'Chuva' }, 65: { icon: '🌧️', desc: 'Chuva forte' },
        66: { icon: '🌨️', desc: 'Chuva gelada' }, 67: { icon: '🌨️', desc: 'Chuva gelada forte' },
        71: { icon: '❄️', desc: 'Neve fraca' }, 73: { icon: '❄️', desc: 'Neve' }, 75: { icon: '❄️', desc: 'Neve forte' },
        77: { icon: '🌨️', desc: 'Grãos de neve' },
        80: { icon: '🌦️', desc: 'Aguaceiros fracos' }, 81: { icon: '🌦️', desc: 'Aguaceiros' }, 82: { icon: '🌦️', desc: 'Aguaceiros fortes' },
        85: { icon: '🌨️', desc: 'Aguaceiros de neve' }, 86: { icon: '🌨️', desc: 'Aguaceiros de neve fortes' },
        95: { icon: '⛈️', desc: 'Trovoada' }, 96: { icon: '⛈️', desc: 'Trovoada com granizo' }, 99: { icon: '⛈️', desc: 'Trovoada com granizo forte' }
    };
    function weatherInfo(code) { return WEATHER_CODES[code] || { icon: '🌡️', desc: 'Sem informação' }; }
    function openWeatherScreen() {
        document.getElementById('weatherScreen').classList.add('active');
        document.getElementById('weatherSearchInput').value = '';
        document.getElementById('weatherResults').innerHTML = '<p style="color:#8696a0;text-align:center;padding:30px;">Pesquisa uma cidade para ver a meteorologia.</p>';
        setTimeout(() => document.getElementById('weatherSearchInput').focus(), 150);
    }
    function closeWeatherScreen() { document.getElementById('weatherScreen').classList.remove('active'); }
    async function searchWeather() {
        const query = document.getElementById('weatherSearchInput').value.trim();
        if (!query) return;
        const el = document.getElementById('weatherResults');
        el.innerHTML = '<p style="color:#8696a0;text-align:center;padding:20px;">A carregar...</p>';
        try {
            const r = await fetch('/api/weather?q=' + encodeURIComponent(query));
            const data = await r.json();
            if (!r.ok) { el.innerHTML = '<p style="color:var(--red);text-align:center;padding:30px;">' + escapeHtml(data.error || 'Erro ao obter meteorologia.') + '</p>'; return; }
            const cur = weatherInfo(data.current.weather_code);
            const placeLabel = [data.place.name, data.place.admin1, data.place.country].filter(Boolean).join(', ');
            let html = `
                <div style="text-align:center;padding:16px 0;">
                    <div style="font-size:15px;color:var(--text-secondary);">${escapeHtml(placeLabel)}</div>
                    <div style="font-size:50px;margin:6px 0;">${cur.icon}</div>
                    <div style="font-size:34px;font-weight:600;">${Math.round(data.current.temperature_2m)}°C</div>
                    <div style="color:var(--text-secondary);">${cur.desc} · Sensação ${Math.round(data.current.apparent_temperature)}°C</div>
                    <div style="color:var(--text-secondary);font-size:12px;margin-top:4px;">💧 ${data.current.relative_humidity_2m}% · 💨 ${Math.round(data.current.wind_speed_10m)} km/h</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;">`;
            (data.daily.time || []).forEach((date, i) => {
                const d = weatherInfo(data.daily.weather_code[i]);
                const dayLabel = new Date(date + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' });
                html += `
                    <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg-secondary);border-radius:10px;">
                        <span style="flex:1;font-size:13px;text-transform:capitalize;">${escapeHtml(dayLabel)}</span>
                        <span style="font-size:20px;">${d.icon}</span>
                        <span style="font-size:12px;color:var(--text-secondary);width:60px;text-align:right;">${Math.round(data.daily.temperature_2m_min[i])}° / ${Math.round(data.daily.temperature_2m_max[i])}°</span>
                        <span style="font-size:11px;color:var(--text-secondary);width:36px;text-align:right;">☔${data.daily.precipitation_probability_max[i]}%</span>
                    </div>`;
            });
            html += '</div>';
            el.innerHTML = html;
        } catch (err) {
            el.innerHTML = '<p style="color:var(--red);text-align:center;padding:30px;">Erro ao pesquisar. Tenta outra vez.</p>';
        }
    }

    function openNewsScreen() {
        document.getElementById('newsScreen').classList.add('active');
        document.getElementById('newsBadge').style.display = 'none';
        if (!NEWS.loaded) loadNews();
    }
    function closeNewsScreen() { document.getElementById('newsScreen').classList.remove('active'); }
    function setNewsTab(tab) {
        NEWS.tab = tab;
        document.getElementById('newsTabPortugal').classList.toggle('btn-accept', tab === 'portugal');
        document.getElementById('newsTabMundo').classList.toggle('btn-accept', tab === 'mundo');
        document.getElementById('newsTabFutebol').classList.toggle('btn-accept', tab === 'futebol');
        renderNewsList();
    }
    async function loadNews(manual) {
        const list = document.getElementById('newsList');
        if (manual) list.innerHTML = 'A atualizar...';
        try {
            const res = await fetch('/api/news');
            NEWS.items = await res.json();
            NEWS.loaded = true;
            renderNewsList();
        } catch (e) {
            list.innerHTML = '<p style="color:var(--text-secondary);">⚠️ Não foi possível carregar as notícias agora.</p>';
        }
    }
    function timeAgo(iso) {
        const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
        if (diffMin < 1) return 'agora mesmo';
        if (diffMin < 60) return 'há ' + diffMin + ' min';
        const diffH = Math.round(diffMin / 60);
        if (diffH < 24) return 'há ' + diffH + 'h';
        return 'há ' + Math.round(diffH / 24) + 'd';
    }
    function renderNewsList() {
        const list = document.getElementById('newsList');
        const filtered = NEWS.items.filter(it => it.category === NEWS.tab);
        if (!filtered.length) { list.innerHTML = '<p style="color:var(--text-secondary);">Sem notícias por agora.</p>'; return; }
        list.innerHTML = filtered.map(it => `
            <div class="news-card" onclick="openNewsArticle('${it.link.replace(/'/g, "\\'")}', '${(it.source || '').replace(/'/g, "\\'")}')">
                <div class="news-source">${it.flag} ${escapeHtml(it.source)}</div>
                <div class="news-title">${escapeHtml(it.title)}</div>
                ${it.snippet ? `<div class="news-snippet">${escapeHtml(it.snippet)}</div>` : ''}
                <div class="news-time">${timeAgo(it.time)}</div>
            </div>
        `).join('');
    }
    socket.on('news_new_item', (item) => {
        NEWS.items = [item, ...NEWS.items].slice(0, 80);
        const screenOpen = document.getElementById('newsScreen').classList.contains('active');
        if (screenOpen) {
            renderNewsList();
            const toast = document.getElementById('newsToast');
            toast.textContent = '📰 Nova notícia: ' + item.title;
            toast.style.display = 'block';
            toast.onclick = () => openNewsArticle(item.link, item.source);
            setTimeout(() => { toast.style.display = 'none'; }, 6000);
        } else {
            document.getElementById('newsBadge').style.display = 'block';
        }
    });

    // ==================== CALCULADORA (científica + gráfica) ====================
    // Avaliador de expressões próprio (sem eval/Function) — usado tanto pela
    // calculadora científica como pela gráfica (esta última substitui "x" pelo
    // valor de cada ponto ao desenhar a curva).
    const MATH_FUNCS = {
        sin: Math.sin, cos: Math.cos, tan: Math.tan,
        asin: Math.asin, acos: Math.acos, atan: Math.atan,
        sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
        ln: Math.log, log: Math.log10, floor: Math.floor, ceil: Math.ceil, round: Math.round
    };
    const MATH_CONSTS = { pi: Math.PI, e: Math.E };
    function tokenizeMathExpr(expr) {
        const tokens = [];
        const re = /\s*([A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*|\.\d+|[()+\-*/^,]|.)/g;
        let m;
        while ((m = re.exec(expr))) { if (m[1].trim() !== '') tokens.push(m[1]); }
        return tokens;
    }
    function evalMathExpr(expr, vars, degrees) {
        vars = vars || {};
        const tokens = tokenizeMathExpr(expr);
        let pos = 0;
        const peek = () => tokens[pos];
        const next = () => tokens[pos++];
        function parseExpr() { return parseAddSub(); }
        function parseAddSub() {
            let left = parseMulDiv();
            while (peek() === '+' || peek() === '-') { const op = next(); const right = parseMulDiv(); left = op === '+' ? left + right : left - right; }
            return left;
        }
        function parseMulDiv() {
            let left = parsePow();
            while (peek() === '*' || peek() === '/') {
                const op = next(); const right = parsePow();
                if (op === '/' && right === 0) throw new Error('Divisão por zero');
                left = op === '*' ? left * right : left / right;
            }
            return left;
        }
        function parsePow() {
            let left = parseUnary();
            if (peek() === '^') { next(); left = Math.pow(left, parsePow()); }
            return left;
        }
        function parseUnary() {
            if (peek() === '-') { next(); return -parseUnary(); }
            if (peek() === '+') { next(); return parseUnary(); }
            return parsePrimary();
        }
        function parsePrimary() {
            const t = next();
            if (t === undefined) throw new Error('Expressão incompleta');
            if (t === '(') { const v = parseExpr(); if (next() !== ')') throw new Error('Falta fechar parêntesis'); return v; }
            if (/^[\d.]/.test(t)) return parseFloat(t);
            if (/^[A-Za-z_]/.test(t)) {
                const name = t.toLowerCase();
                if (peek() === '(') {
                    next();
                    const args = [parseExpr()];
                    while (peek() === ',') { next(); args.push(parseExpr()); }
                    if (next() !== ')') throw new Error('Falta fechar parêntesis');
                    if (name === 'pow') return Math.pow(args[0], args[1]);
                    if (name === 'log' && args.length === 2) return Math.log(args[1]) / Math.log(args[0]);
                    if (!MATH_FUNCS[name]) throw new Error('Função desconhecida: ' + t);
                    let a0 = args[0];
                    if (degrees && (name === 'sin' || name === 'cos' || name === 'tan')) a0 = a0 * Math.PI / 180;
                    let result = MATH_FUNCS[name](a0);
                    if (degrees && (name === 'asin' || name === 'acos' || name === 'atan')) result = result * 180 / Math.PI;
                    return result;
                }
                if (name in vars) return vars[name];
                if (name in MATH_CONSTS) return MATH_CONSTS[name];
                throw new Error('Desconhecido: ' + t);
            }
            throw new Error('Token inesperado: ' + t);
        }
        const result = parseExpr();
        if (pos < tokens.length) throw new Error('Expressão inválida perto de "' + tokens[pos] + '"');
        if (typeof result !== 'number' || isNaN(result)) throw new Error('Resultado inválido');
        return result;
    }

    const CALC = { expr: '', tab: 'sci', degrees: true };
    const CALC_KEYS = [
        { l: 'C', cls: 'calc-clear', act: () => { CALC.expr = ''; updateCalcDisplay(); } },
        { l: '(', act: () => calcAppend('(') },
        { l: ')', act: () => calcAppend(')') },
        { l: '⌫', cls: 'calc-clear', act: () => { CALC.expr = CALC.expr.slice(0, -1); updateCalcDisplay(); } },
        { l: '÷', cls: 'calc-op', act: () => calcAppend('/') },
        { l: 'sin', act: () => calcAppend('sin(') },
        { l: 'cos', act: () => calcAppend('cos(') },
        { l: 'tan', act: () => calcAppend('tan(') },
        { l: '√', act: () => calcAppend('sqrt(') },
        { l: '×', cls: 'calc-op', act: () => calcAppend('*') },
        { l: '7', act: () => calcAppend('7') },
        { l: '8', act: () => calcAppend('8') },
        { l: '9', act: () => calcAppend('9') },
        { l: 'xʸ', act: () => calcAppend('^') },
        { l: '−', cls: 'calc-op', act: () => calcAppend('-') },
        { l: '4', act: () => calcAppend('4') },
        { l: '5', act: () => calcAppend('5') },
        { l: '6', act: () => calcAppend('6') },
        { l: 'ln', act: () => calcAppend('ln(') },
        { l: '+', cls: 'calc-op', act: () => calcAppend('+') },
        { l: '1', act: () => calcAppend('1') },
        { l: '2', act: () => calcAppend('2') },
        { l: '3', act: () => calcAppend('3') },
        { l: 'log', act: () => calcAppend('log(') },
        { l: 'π', act: () => calcAppend('pi') },
        { l: '0', act: () => calcAppend('0') },
        { l: '.', act: () => calcAppend('.') },
        { l: 'e', act: () => calcAppend('e') },
        { l: '%', act: () => calcAppend('/100') },
        { l: '=', cls: 'calc-eq', act: () => calcEquals() }
    ];
    function renderCalcKeypad() {
        document.getElementById('calcKeypad').innerHTML = CALC_KEYS.map((k, i) =>
            `<button class="calc-key ${k.cls || ''}" onclick="CALC_KEYS[${i}].act()">${k.l}</button>`
        ).join('');
    }
    function calcAppend(s) { CALC.expr += s; updateCalcDisplay(); }
    function formatCalcNumber(n) {
        if (!isFinite(n)) throw new Error('Resultado infinito');
        return Math.round(n * 1e10) / 1e10;
    }
    function updateCalcDisplay() {
        document.getElementById('calcDisplay').value = CALC.expr || '0';
        const preview = document.getElementById('calcResultPreview');
        if (!CALC.expr) { preview.textContent = ''; return; }
        try { preview.textContent = '= ' + formatCalcNumber(evalMathExpr(CALC.expr, {}, CALC.degrees)); }
        catch (e) { preview.textContent = ''; }
    }
    function calcEquals() {
        try {
            CALC.expr = String(formatCalcNumber(evalMathExpr(CALC.expr, {}, CALC.degrees)));
            updateCalcDisplay();
        } catch (e) {
            document.getElementById('calcResultPreview').textContent = '⚠️ ' + e.message;
        }
    }
    function toggleCalcDeg() {
        CALC.degrees = !CALC.degrees;
        document.getElementById('calcDegBtn').textContent = CALC.degrees ? 'DEG' : 'RAD';
        updateCalcDisplay();
    }
    function openCalcScreen() {
        document.getElementById('calcScreen').classList.add('active');
        if (!document.getElementById('calcKeypad').children.length) renderCalcKeypad();
        if (CALC.tab === 'graph') setTimeout(drawGraph, 50);
    }
    function closeCalcScreen() { document.getElementById('calcScreen').classList.remove('active'); }
    function setCalcTab(tab) {
        CALC.tab = tab;
        document.getElementById('calcTabSci').classList.toggle('btn-accept', tab === 'sci');
        document.getElementById('calcTabGraph').classList.toggle('btn-accept', tab === 'graph');
        document.getElementById('calcSciPanel').style.display = tab === 'sci' ? 'flex' : 'none';
        document.getElementById('calcGraphPanel').style.display = tab === 'graph' ? 'flex' : 'none';
        if (tab === 'graph') setTimeout(drawGraph, 50);
    }

    const GRAPH = { scale: 40, offsetX: 0, offsetY: 0, dragging: false, lastX: 0, lastY: 0 };
    function sizeGraphCanvas() {
        const canvas = document.getElementById('graphCanvas');
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
    }
    function drawGraph() {
        const canvas = document.getElementById('graphCanvas');
        if (!canvas || !canvas.offsetParent) return; // painel escondido, não desenha à toa
        sizeGraphCanvas();
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        ctx.fillStyle = isLight ? '#ffffff' : '#0b141a';
        ctx.fillRect(0, 0, w, h);
        const cx = w / 2 + GRAPH.offsetX, cy = h / 2 + GRAPH.offsetY, scale = GRAPH.scale;
        ctx.strokeStyle = 'rgba(134,150,160,0.25)'; ctx.lineWidth = 1;
        for (let gx = cx % scale; gx < w; gx += scale) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
        for (let gy = cy % scale; gy < h; gy += scale) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }
        ctx.strokeStyle = '#8696a0'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
        const fn = document.getElementById('graphFnInput').value.trim() || 'x';
        const errEl = document.getElementById('graphError');
        let hadError = false;
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--green').trim() || '#7c5cff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        let started = false;
        for (let px = 0; px <= w; px++) {
            const x = (px - cx) / scale;
            let y;
            try { y = evalMathExpr(fn, { x }, false); } catch (e) { hadError = true; started = false; continue; }
            if (!isFinite(y)) { started = false; continue; }
            const py = cy - y * scale;
            if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
        errEl.textContent = hadError ? '⚠️ Parte da expressão não pôde ser calculada (ex.: fora do domínio).' : '';
    }
    function zoomGraph(factor) { GRAPH.scale = Math.min(400, Math.max(4, GRAPH.scale * factor)); drawGraph(); }
    function resetGraphView() { GRAPH.scale = 40; GRAPH.offsetX = 0; GRAPH.offsetY = 0; drawGraph(); }
    (function initGraphDrag() {
        const canvas = document.getElementById('graphCanvas');
        const start = (x, y) => { GRAPH.dragging = true; GRAPH.lastX = x; GRAPH.lastY = y; };
        const move = (x, y) => {
            if (!GRAPH.dragging) return;
            GRAPH.offsetX += x - GRAPH.lastX; GRAPH.offsetY += y - GRAPH.lastY;
            GRAPH.lastX = x; GRAPH.lastY = y;
            drawGraph();
        };
        const end = () => { GRAPH.dragging = false; };
        canvas.addEventListener('mousedown', e => start(e.clientX, e.clientY));
        canvas.addEventListener('mousemove', e => move(e.clientX, e.clientY));
        window.addEventListener('mouseup', end);
        canvas.addEventListener('touchstart', e => { const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: true });
        canvas.addEventListener('touchmove', e => { const t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: true });
        canvas.addEventListener('touchend', end);
    })();
    window.addEventListener('resize', () => {
        if (CALC.tab === 'graph' && document.getElementById('calcScreen').classList.contains('active')) drawGraph();
    });

    // ==================== VÍDEOS ENGRAÇADOS (feed estilo TikTok/Reels) ====================
    // Lista curada de vídeos do YouTube — mesmo espírito da lista de cidades do
    // "Conduzir e Ouvir" (fácil de editar aqui). Se algum ID deixar de
    // funcionar (vídeo removido), o feed salta sozinho para o próximo, sem travar.
    const FUNNY_VIDEOS = [
        { id: '8y1yaNW-eZ8', title: 'Charlie bit my finger' },
        { id: '9T1vfsHYiKY', title: 'Sneezing Panda' },
        { id: 'jwGfwbsF4c4', title: 'Dramatic Chipmunk' },
        { id: 'FzRH3iTQPrk', title: 'Double Rainbow' },
        { id: 'ZZ5LpwO-An4', title: 'Hey Jude Baby Dance' },
        { id: 'MtN1YnoL46Q', title: 'Evolution of Dance' }
    ];
    const FUNNY_FEED = { queue: [], index: 0, ytPlayer: null, ytReady: false, muted: true };
    function shuffleArray(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; }
        return a;
    }
    function openFunnyFeedScreen() {
        document.getElementById('funnyFeedScreen').classList.add('active');
        loadYouTubeIframeAPI(); // já usado pelo "Conduzir e Ouvir" — reaproveita o mesmo carregamento
        FUNNY_FEED.muted = true;
        document.getElementById('funnyFeedUnmute').style.display = 'block';
        document.getElementById('funnyFeedUnmute').textContent = '🔇 Toque para ativar som';
        if (!FUNNY_FEED.queue.length) { FUNNY_FEED.queue = shuffleArray(FUNNY_VIDEOS); FUNNY_FEED.index = 0; }
        startFunnyVideo();
    }
    function closeFunnyFeedScreen() {
        document.getElementById('funnyFeedScreen').classList.remove('active');
        if (FUNNY_FEED.ytPlayer && FUNNY_FEED.ytPlayer.pauseVideo) FUNNY_FEED.ytPlayer.pauseVideo();
    }
    function startFunnyVideo() {
        document.getElementById('funnyFeedError').style.display = 'none';
        const video = FUNNY_FEED.queue[FUNNY_FEED.index];
        if (!video) return;
        if (!(window.YT && window.YT.Player)) {
            const wait = setInterval(() => { if (window.YT && window.YT.Player) { clearInterval(wait); startFunnyVideo(); } }, 300);
            return;
        }
        if (!FUNNY_FEED.ytPlayer) {
            FUNNY_FEED.ytPlayer = new YT.Player('funnyFeedPlayer', {
                videoId: video.id,
                playerVars: { autoplay: 1, mute: 1, controls: 1, rel: 0, playsinline: 1 },
                events: {
                    onReady: (e) => { e.target.mute(); e.target.playVideo(); },
                    onError: () => funnyFeedNext() // vídeo indisponível — passa ao seguinte sozinho
                }
            });
        } else {
            FUNNY_FEED.ytPlayer.loadVideoById(video.id);
            if (FUNNY_FEED.muted) FUNNY_FEED.ytPlayer.mute(); else FUNNY_FEED.ytPlayer.unMute();
            FUNNY_FEED.ytPlayer.playVideo();
        }
    }
    function funnyFeedNext() {
        FUNNY_FEED.index++;
        if (FUNNY_FEED.index >= FUNNY_FEED.queue.length) { FUNNY_FEED.queue = shuffleArray(FUNNY_VIDEOS); FUNNY_FEED.index = 0; } // "infinito": baralha de novo ao chegar ao fim
        startFunnyVideo();
    }
    function toggleFunnyFeedMute() {
        FUNNY_FEED.muted = !FUNNY_FEED.muted;
        if (FUNNY_FEED.ytPlayer) { if (FUNNY_FEED.muted) FUNNY_FEED.ytPlayer.mute(); else FUNNY_FEED.ytPlayer.unMute(); }
        document.getElementById('funnyFeedUnmute').style.display = FUNNY_FEED.muted ? 'block' : 'none';
    }
    (function initFunnyFeedSwipe() {
        const stage = document.getElementById('funnyFeedStage');
        let startY = 0;
        stage.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
        stage.addEventListener('touchend', e => {
            if (startY - e.changedTouches[0].clientY > 60) funnyFeedNext(); // deslizar para cima = próximo, como nas redes sociais
        }, { passive: true });
    })();

    // ==================== CONVERSAS ARQUIVADAS ====================
    APP.archivedChats = new Set(JSON.parse(localStorage.getItem('archivedChatsCache') || '[]'));
    socket.on('archived_list', (list) => {
        APP.archivedChats = new Set(list || []);
        localStorage.setItem('archivedChatsCache', JSON.stringify([...APP.archivedChats]));
        renderChatList();
        if (document.getElementById('archivedScreen').classList.contains('active')) renderArchivedList();
        updateArchiveButton();
    });
    function toggleArchiveChat() {
        if (!APP.currentChatId) return;
        const willArchive = !APP.archivedChats.has(APP.currentChatId);
        if (willArchive) APP.archivedChats.add(APP.currentChatId); else APP.archivedChats.delete(APP.currentChatId);
        socket.emit('set_archived', { chatId: APP.currentChatId, archived: willArchive });
        localStorage.setItem('archivedChatsCache', JSON.stringify([...APP.archivedChats]));
        updateArchiveButton();
        renderChatList();
        if (willArchive) closeChat();
    }
    function updateArchiveButton() {
        const btn = document.getElementById('archiveChatBtn');
        if (!btn) return;
        const archived = APP.currentChatId && APP.archivedChats.has(APP.currentChatId);
        btn.title = archived ? 'Desarquivar conversa' : 'Arquivar conversa';
        btn.classList.toggle('btn-accept', !!archived);
    }

    // ==================== CONVERSAS FIXADAS NO TOPO ====================
    // Mesmo modelo das arquivadas (lista de chatIds por conta), para o efeito
    // oposto: destacar uma conversa sempre no topo da lista, em vez de a
    // esconder. Limite de 5 fixadas, como no WhatsApp.
    APP.pinnedChats = new Set(JSON.parse(localStorage.getItem('pinnedChatsCache') || '[]'));
    socket.on('pinned_chats_list', (list) => {
        APP.pinnedChats = new Set(list || []);
        localStorage.setItem('pinnedChatsCache', JSON.stringify([...APP.pinnedChats]));
        renderChatList();
        updatePinChatButton();
    });
    function togglePinChat() {
        if (!APP.currentChatId) return;
        const willPin = !APP.pinnedChats.has(APP.currentChatId);
        if (willPin && APP.pinnedChats.size >= 5) { alert('Só podes fixar até 5 conversas. Desafixa uma primeiro.'); return; }
        if (willPin) APP.pinnedChats.add(APP.currentChatId); else APP.pinnedChats.delete(APP.currentChatId);
        socket.emit('set_pinned_chat', { chatId: APP.currentChatId, pinned: willPin });
        localStorage.setItem('pinnedChatsCache', JSON.stringify([...APP.pinnedChats]));
        updatePinChatButton();
        renderChatList();
    }
    function updatePinChatButton() {
        const btn = document.getElementById('pinChatBtn');
        if (!btn) return;
        const pinned = APP.currentChatId && APP.pinnedChats.has(APP.currentChatId);
        btn.title = pinned ? 'Desafixar conversa' : 'Fixar conversa no topo';
        btn.classList.toggle('btn-accept', !!pinned);
    }

    // ==================== BLOQUEAR UMA CONVERSA COM PIN ====================
    // Ao contrário do bloqueio da app inteira (ver "BLOQUEIO POR PIN" acima), isto
    // esconde só UMA conversa específica da lista — reaproveita o mesmo PIN já
    // definido (não faz sentido ter dois PINs diferentes neste aparelho) em vez de
    // criar um segundo mecanismo de bloqueio do zero. Só existe neste aparelho,
    // tal como o PIN em si (nunca é sincronizado com o servidor nem outros aparelhos).
    APP.lockedChats = new Set(JSON.parse(localStorage.getItem('lockedChatsCache') || '[]'));
    APP.lockedChatsRevealed = false; // nunca persiste — cada vez que a app carrega, as conversas bloqueadas começam escondidas
    function toggleLockChat() {
        if (!APP.currentChatId) return;
        if (APP.lockedChats.has(APP.currentChatId)) {
            APP.lockedChats.delete(APP.currentChatId);
            localStorage.setItem('lockedChatsCache', JSON.stringify([...APP.lockedChats]));
            updateLockChatButton();
            renderChatList();
            return;
        }
        if (!hasPinSet()) {
            alert('Precisas de definir um PIN primeiro — vai a "Mais funcionalidades" → "Bloqueio por PIN" e cria um antes de bloqueares uma conversa.');
            return;
        }
        APP.lockedChats.add(APP.currentChatId);
        localStorage.setItem('lockedChatsCache', JSON.stringify([...APP.lockedChats]));
        updateLockChatButton();
        closeChat(); // sai já da conversa — não faria sentido acabar de a bloquear e continuar a vê-la aberta
        renderChatList();
    }
    function updateLockChatButton() {
        const btn = document.getElementById('lockChatBtn');
        if (!btn) return;
        const locked = APP.currentChatId && APP.lockedChats.has(APP.currentChatId);
        btn.title = locked ? 'Desbloquear conversa' : 'Bloquear conversa com PIN';
        btn.classList.toggle('btn-accept', !!locked);
    }
    // Pede o PIN de novo antes de revelar as conversas bloqueadas na lista — mesmo já
    // com a app desbloqueada, para quem só quer mostrar o telemóvel a alguém por um
    // instante sem revelar essas conversas específicas.
    function unlockLockedChatsSection() {
        if (!hasPinSet()) { APP.lockedChatsRevealed = true; renderChatList(); return; } // não deveria acontecer (só se bloqueia com PIN já definido), mas nunca deixa preso
        PIN_STATE.entered = '';
        PIN_STATE.mode = 'verify-chat-lock';
        setPinLockLabel('PIN para ver as conversas bloqueadas');
        setPinBottomButton(true);
        updatePinDots();
        document.getElementById('pinError').textContent = '';
        document.getElementById('pinLockScreen').style.display = 'flex';
    }
    function openArchivedScreen() {
        document.getElementById('archivedScreen').classList.add('active');
        socket.emit('get_archived');
        renderArchivedList();
    }
    function closeArchivedScreen() { document.getElementById('archivedScreen').classList.remove('active'); }
    function renderArchivedList() {
        const el = document.getElementById('archivedList');
        const chats = APP.chats.filter(c => APP.archivedChats.has(c.id));
        if (!chats.length) { el.innerHTML = '<p style="color:#8696a0;text-align:center;padding:30px;">Nenhuma conversa arquivada</p>'; return; }
        el.innerHTML = chats.map(chat => `
            <div class="chat-item" onclick="closeArchivedScreen(); openChat('${chat.id}');">
                <div class="chat-item-avatar avatar-user">${avatarInnerHtml(chat.name, chat.avatarUrl)}</div>
                <div class="chat-item-info"><h4>${escapeHtml(chat.name)}</h4><p>Toca para abrir</p></div>
                <button class="btn-icon" style="width:34px;height:34px;font-size:14px;flex:0 0 auto;" onclick="event.stopPropagation(); socket.emit('set_archived',{chatId:'${chat.id}',archived:false}); APP.archivedChats.delete('${chat.id}'); renderArchivedList(); renderChatList();" title="Desarquivar">🗄️</button>
            </div>`).join('');
    }

    // ==================== PASTAS/ETIQUETAS PARA ORGANIZAR CONVERSAS ====================
    APP.folders = [];
    APP.activeFolderId = null;
    renderFolderTabs();
    socket.on('folders_list', (list) => {
        APP.folders = list || [];
        renderFolderTabs();
        renderChatList(document.getElementById('chatSearchInput')?.value || '');
        if (document.getElementById('modalChatFolders').classList.contains('active')) renderChatFoldersModalList();
    });
    function renderFolderTabs() {
        const el = document.getElementById('folderTabs');
        if (!el) return;
        const chipStyle = (active) => `padding:5px 12px;border-radius:16px;font-size:12px;white-space:nowrap;flex:0 0 auto;${active ? 'background:var(--accent);color:#fff;' : ''}`;
        const chips = [`<button class="btn-small" onclick="setActiveFolder(null)" style="${chipStyle(APP.activeFolderId === null)}">Tudo</button>`];
        APP.folders.forEach(f => {
            chips.push(`<button class="btn-small" onclick="setActiveFolder('${f.id}')" style="${chipStyle(APP.activeFolderId === f.id)}">${escapeHtml(f.name)}</button>`);
        });
        chips.push(`<button class="btn-small" onclick="openChatFoldersModal()" title="Gerir pastas" style="${chipStyle(false)}">+</button>`);
        el.innerHTML = chips.join('');
    }
    function setActiveFolder(folderId) {
        APP.activeFolderId = folderId;
        renderFolderTabs();
        renderChatList(document.getElementById('chatSearchInput')?.value || '');
    }
    function openChatFoldersModal() {
        document.getElementById('newFolderNameInput').value = '';
        renderChatFoldersModalList();
        document.getElementById('modalChatFolders').classList.add('active');
    }
    function renderChatFoldersModalList() {
        const el = document.getElementById('chatFoldersList');
        const chatId = APP.currentChatId;
        if (!APP.folders.length) { el.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:10px;">Ainda não tens pastas — cria uma abaixo.</p>'; return; }
        el.innerHTML = APP.folders.map(f => {
            const inFolder = chatId && (f.chatIds || []).includes(chatId);
            const checkbox = chatId ? `<input type="checkbox" ${inFolder ? 'checked' : ''} onchange="toggleChatInFolder('${f.id}', this.checked)" style="margin-right:8px;">` : '';
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 4px;border-bottom:1px solid var(--bg-tertiary);">
                <label style="display:flex;align-items:center;flex:1;cursor:pointer;">${checkbox}${escapeHtml(f.name)}</label>
                <button class="btn-icon" style="width:28px;height:28px;font-size:12px;" onclick="deleteFolder('${f.id}')" title="Apagar pasta">🗑️</button>
            </div>`;
        }).join('');
    }
    function toggleChatInFolder(folderId, inFolder) {
        if (!APP.currentChatId) return;
        socket.emit('set_chat_folder', { folderId, chatId: APP.currentChatId, inFolder });
    }
    function createFolderFromModal() {
        const input = document.getElementById('newFolderNameInput');
        const name = input.value.trim();
        if (!name) return;
        socket.emit('save_folder', { name });
        input.value = '';
    }
    function deleteFolder(folderId) {
        if (!confirm('Apagar esta pasta? As conversas não são apagadas, só deixam de estar organizadas nela.')) return;
        if (APP.activeFolderId === folderId) APP.activeFolderId = null;
        socket.emit('delete_folder', { id: folderId });
    }

    // ==================== LISTAS DE TRANSMISSÃO ====================
    socket.on('broadcast_list', (list) => {
        APP.broadcasts = list || [];
        if (document.getElementById('broadcastScreen').classList.contains('active')) renderBroadcastList();
    });
    function openBroadcastScreen() {
        document.getElementById('broadcastScreen').classList.add('active');
        socket.emit('get_broadcasts');
        renderBroadcastList();
    }
    function closeBroadcastScreen() { document.getElementById('broadcastScreen').classList.remove('active'); }
    function renderBroadcastList() {
        const el = document.getElementById('broadcastList');
        if (!APP.broadcasts.length) { el.innerHTML = '<p style="color:#8696a0;text-align:center;padding:30px;">Ainda não tens nenhuma lista de transmissão</p>'; return; }
        el.innerHTML = APP.broadcasts.map(b => `
            <div class="chat-item" style="cursor:pointer;" onclick="openBroadcastSendModal('${b.id}')">
                <div class="chat-item-avatar avatar-group">📢</div>
                <div class="chat-item-info"><h4>${escapeHtml(b.name)}</h4><p>${b.members.length} contacto${b.members.length === 1 ? '' : 's'} · toca para enviar</p></div>
                <button class="btn-icon" style="width:34px;height:34px;font-size:13px;flex:0 0 auto;" onclick="event.stopPropagation(); openBroadcastEditModal('${b.id}')" title="Editar">✏️</button>
                <button class="btn-icon" style="width:34px;height:34px;font-size:13px;flex:0 0 auto;" onclick="event.stopPropagation(); deleteBroadcastList('${b.id}')" title="Apagar">🗑️</button>
            </div>`).join('');
    }
    function openBroadcastEditModal(id) {
        const editing = id ? APP.broadcasts.find(b => b.id === id) : null;
        document.getElementById('broadcastEditTitle').textContent = editing ? '✏️ Editar lista' : '➕ Nova lista de transmissão';
        document.getElementById('broadcastName').value = editing ? editing.name : '';
        document.getElementById('modalBroadcastEdit').dataset.editingId = editing ? editing.id : '';
        const contacts = APP.chats.filter(c => c.type === 'user');
        const picker = document.getElementById('broadcastMemberPicker');
        picker.innerHTML = contacts.length ? contacts.map(c => `
            <label style="display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;">
                <input type="checkbox" value="${c.phone}" ${editing?.members.includes(c.phone) ? 'checked' : ''}>
                <span>${escapeHtml(c.name)}</span>
            </label>`).join('') : '<p style="color:#8696a0;text-align:center;">Nenhum contacto disponível</p>';
        document.getElementById('modalBroadcastEdit').classList.add('active');
    }
    function saveBroadcastList() {
        const name = document.getElementById('broadcastName').value.trim();
        if (!name) return alert('Escreve um nome para a lista!');
        const members = [...document.querySelectorAll('#broadcastMemberPicker input:checked')].map(i => i.value);
        if (!members.length) return alert('Escolhe pelo menos um contacto!');
        const editingId = document.getElementById('modalBroadcastEdit').dataset.editingId;
        socket.emit('save_broadcast', { id: editingId || undefined, name, members });
        closeModal('modalBroadcastEdit');
    }
    function deleteBroadcastList(id) {
        if (!confirm('Apagar esta lista de transmissão?')) return;
        socket.emit('delete_broadcast', { id });
    }
    function openBroadcastSendModal(id) {
        const list = APP.broadcasts.find(b => b.id === id);
        if (!list) return;
        document.getElementById('broadcastSendTitle').textContent = `📢 Enviar para "${list.name}" (${list.members.length})`;
        document.getElementById('broadcastSendText').value = '';
        document.getElementById('modalBroadcastSend').dataset.listId = id;
        document.getElementById('modalBroadcastSend').classList.add('active');
    }
    async function sendBroadcastMessage() {
        const id = document.getElementById('modalBroadcastSend').dataset.listId;
        const list = APP.broadcasts.find(b => b.id === id);
        const text = document.getElementById('broadcastSendText').value.trim();
        if (!list || !text) return;
        closeModal('modalBroadcastSend');
        const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        let sent = 0;
        for (const phone of list.members) {
            const chat = APP.chats.find(c => c.type === 'user' && c.phone === phone);
            if (!chat) continue;
            const chatId = dmRoomId(APP.user.phone, phone);
            const msgId = 'm' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            if (!APP.messages[chatId]) APP.messages[chatId] = [];
            APP.messages[chatId].push({ id: msgId, sender: 'Você', text, time, type: 'sent', read: false });
            let outgoing = { id: msgId, chatId, sender: APP.user.name, senderPhone: APP.user.phone, toPhone: phone, text, time };
            if (chat.publicKey && E2EE.publicJwk) {
                await e2eeReadyPromise;
                const enc = await encryptFor(phone, chat.publicKey, text);
                if (enc) outgoing = { ...outgoing, text: '🔒 Mensagem encriptada', encrypted: true, iv: enc.iv, data: enc.data };
            }
            socket.emit('send_message', outgoing);
            sent++;
        }
        renderChatList();
        if (APP.currentChatId) renderMessages();
        alert(`Mensagem enviada para ${sent} contacto${sent === 1 ? '' : 's'} da lista "${list.name}".`);
    }

    // ==================== ENCAMINHAR MENSAGEM ====================
    // Reaproveita a mensagem já carregada em APP.messages (com o texto já desencriptado,
    // se vier de uma conversa 1-para-1 com E2EE) — não pede nada novo ao servidor, só
    // reenvia o mesmo conteúdo como uma mensagem nova em cada conversa escolhida,
    // encriptando de novo para quem tiver chave pública (tal como já faz o envio para
    // uma lista de transmissão, ver sendBroadcastMessage acima).
    let APP_FORWARD_MSG_ID = null;
    function openForwardMessageModal(msgId) {
        APP_FORWARD_MSG_ID = msgId;
        const picker = document.getElementById('forwardTargetPicker');
        const targets = APP.chats.filter(c => c.type === 'user' || c.type === 'group');
        picker.innerHTML = targets.length ? targets.map(c => `
            <label style="display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;">
                <input type="checkbox" value="${c.id}">
                <span>${c.type === 'group' ? '👥 ' : ''}${escapeHtml(c.name)}</span>
            </label>`).join('') : '<p style="color:#8696a0;text-align:center;">Sem conversas disponíveis</p>';
        document.getElementById('modalForwardMessage').classList.add('active');
    }
    async function confirmForwardMessage() {
        const msgId = APP_FORWARD_MSG_ID;
        const msg = (APP.messages[APP.currentChatId] || []).find(m => m.id === msgId);
        const targetIds = [...document.querySelectorAll('#forwardTargetPicker input:checked')].map(i => i.value);
        if (!msg) { closeModal('modalForwardMessage'); return; }
        if (!targetIds.length) return alert('Escolhe pelo menos uma conversa.');
        closeModal('modalForwardMessage');
        const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        let sent = 0;
        for (const targetId of targetIds) {
            const chat = APP.chats.find(c => c.id === targetId);
            if (!chat) continue;
            const newId = 'm' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            const localMsg = {
                id: newId, sender: 'Você', text: msg.text || '', time, type: 'sent', read: false, forwarded: true,
                fileData: msg.fileData || null, fileName: msg.fileName || null, fileType: msg.fileType || null, transcript: msg.transcript || null
            };
            if (!APP.messages[targetId]) APP.messages[targetId] = [];
            APP.messages[targetId].push(localMsg);
            let outgoing = { ...localMsg, chatId: targetId, senderPhone: APP.user.phone, toPhone: chat.type === 'user' ? chat.phone : undefined };
            delete outgoing.read; // campo só de uso local, não faz parte da mensagem em si
            // Anexos nunca são encriptados nesta app (ver limitações do E2EE no README) — só
            // faz sentido tentar encriptar quando é texto puro.
            if (chat.type === 'user' && chat.publicKey && E2EE.publicJwk && !msg.fileData) {
                await e2eeReadyPromise;
                const enc = await encryptFor(chat.phone, chat.publicKey, msg.text || '');
                if (enc) outgoing = { ...outgoing, text: '🔒 Mensagem encriptada', encrypted: true, iv: enc.iv, data: enc.data };
            }
            socket.emit('send_message', outgoing);
            sent++;
        }
        renderChatList();
        if (APP.currentChatId) renderMessages();
        alert(`Mensagem encaminhada para ${sent} conversa${sent === 1 ? '' : 's'}.`);
    }

    // ==================== BLOQUEAR / DENUNCIAR ====================
    APP.blockedUsers = new Set();
    socket.on('blocked_list', (list) => {
        APP.blockedUsers = new Set(list || []);
        updateBlockButton();
        // Atualiza a lista de contas bloqueadas ao vivo, se estiver aberta (ex.: depois de
        // desbloquear alguém, some logo da lista sem precisar de fechar e reabrir o modal).
        if (document.getElementById('modalBlockedUsers')?.classList.contains('active')) renderBlockedUsersList();
    });
    function updateBlockButton() {
        const btn = document.getElementById('blockUserBtn');
        if (!btn) return;
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        btn.style.display = chat?.type === 'user' ? 'flex' : 'none';
        const label = btn.querySelector('span');
        if (chat?.phone && APP.blockedUsers.has(chat.phone)) {
            btn.title = 'Utilizador bloqueado — toca para desbloquear';
            btn.classList.add('btn-danger');
            if (label) label.textContent = 'Desbloquear';
        } else {
            btn.title = 'Bloquear ou denunciar';
            btn.classList.remove('btn-danger');
            if (label) label.textContent = 'Bloquear';
        }
    }
    // Lista de todas as contas bloqueadas, com nome (quando ainda é um contacto reconhecido —
    // senão mostra só o número) e um botão para desbloquear ali mesmo, sem ter de reabrir a
    // conversa com a pessoa só para lá chegar (era o único caminho antes desta lista existir).
    function openBlockedUsersModal() {
        renderBlockedUsersList();
        document.getElementById('modalBlockedUsers').classList.add('active');
    }
    function renderBlockedUsersList() {
        const el = document.getElementById('blockedUsersList');
        const phones = [...APP.blockedUsers];
        if (!phones.length) { el.innerHTML = '<p style="color:#8696a0;text-align:center;padding:20px;">Não bloqueaste ninguém.</p>'; return; }
        el.innerHTML = phones.map(phone => {
            const contact = APP.onlineContacts.find(c => c.phone === phone);
            const name = contact ? escapeHtml(contact.name) : escapeHtml(phone);
            return `
            <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
                <div style="flex:1;font-size:14px;">${name}</div>
                <button class="btn-small" onclick="socket.emit('unblock_user', {phone:'${phone}'})">✅ Desbloquear</button>
            </div>`;
        }).join('');
    }
    function openBlockUserModal() {
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat || chat.type !== 'user') return;
        const isBlocked = APP.blockedUsers.has(chat.phone);
        document.getElementById('blockUserTargetLabel').textContent = `${chat.name}${isBlocked ? ' — já está bloqueado(a)' : ''}`;
        document.getElementById('blockUserToggleBtn').textContent = isBlocked ? '✅ Desbloquear' : '🚫 Bloquear';
        document.getElementById('modalBlockUser').classList.add('active');
    }
    function confirmBlockUser() {
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat) return;
        const isBlocked = APP.blockedUsers.has(chat.phone);
        socket.emit(isBlocked ? 'unblock_user' : 'block_user', { phone: chat.phone });
        closeModal('modalBlockUser');
    }
    function openReportUserPrompt() {
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat) return;
        const reason = prompt(`Porque estás a denunciar ${chat.name}? (isto também bloqueia a pessoa)`);
        if (reason === null) return;
        socket.emit('report_user', { phone: chat.phone, reason });
        closeModal('modalBlockUser');
        alert('Denúncia registada e utilizador bloqueado.');
    }

    // ==================== "NÃO INCOMODAR" AGENDADO ====================
    function loadDndSettingsIntoProfile() {
        const startSel = document.getElementById('dndStartHour');
        const endSel = document.getElementById('dndEndHour');
        if (!startSel.options.length) {
            for (let h = 0; h < 24; h++) {
                startSel.innerHTML += `<option value="${h}">${String(h).padStart(2, '0')}:00</option>`;
                endSel.innerHTML += `<option value="${h}">${String(h).padStart(2, '0')}:00</option>`;
            }
        }
        const settings = JSON.parse(localStorage.getItem('dndSettings') || '{"enabled":false,"start":22,"end":7}');
        document.getElementById('dndEnabledCheck').checked = settings.enabled;
        startSel.value = settings.start;
        endSel.value = settings.end;
    }
    function saveDndSettings() {
        const settings = {
            enabled: document.getElementById('dndEnabledCheck').checked,
            start: parseInt(document.getElementById('dndStartHour').value, 10),
            end: parseInt(document.getElementById('dndEndHour').value, 10)
        };
        localStorage.setItem('dndSettings', JSON.stringify(settings));
        checkDndActive();
    }
    function checkDndActive() {
        const settings = JSON.parse(localStorage.getItem('dndSettings') || '{"enabled":false,"start":22,"end":7}');
        let active = false;
        if (settings.enabled) {
            const h = new Date().getHours();
            active = settings.start <= settings.end ? (h >= settings.start && h < settings.end) : (h >= settings.start || h < settings.end);
        }
        socket.emit('set_dnd_active', { active });
    }
    setInterval(checkDndActive, 60000); // reavalia a cada minuto

    function openSearchUserModal() {
        document.getElementById('searchUsernameInput').value = '';
        document.getElementById('searchUserResult').innerHTML = '';
        document.getElementById('modalSearchUser').classList.add('active');
        setTimeout(() => document.getElementById('searchUsernameInput').focus(), 150);
    }

    function doSearchUser() {
        const username = document.getElementById('searchUsernameInput').value.trim();
        if (!username) return;
        document.getElementById('searchUserResult').innerHTML = '<p style="color:#8696a0;">A procurar...</p>';
        socket.emit('search_user', { username });
    }

    socket.on('search_user_result', (data) => {
        if (APP.pendingInviteUsername && data.query && data.query.toLowerCase() === APP.pendingInviteUsername) {
            APP.pendingInviteUsername = null;
            if (data.found) {
                const banner = document.getElementById('inviteBanner');
                if (banner) banner.style.display = 'none';
                startChatWithFoundUser(data.user.phone);
            }
            return;
        }
        const box = document.getElementById('searchUserResult');
        if (!box) return;
        if (!data.found) {
            box.innerHTML = `<p style="color:#8696a0;">Não foi encontrado ninguém com o nome de utilizador "@${escapeHtml(data.query)}".</p>`;
            return;
        }
        const u = data.user;
        box.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;">
                <div class="chat-item-avatar avatar-user">${escapeHtml(u.name.charAt(0).toUpperCase())}</div>
                <div style="flex:1;">
                    <strong>${escapeHtml(u.name)}</strong><br>
                    <span style="color:#8696a0;font-size:12px;">@${escapeHtml(u.username)} · ${u.online ? '🟢 Online' : '⚪ Offline'}</span>
                </div>
            </div>
            <button class="btn btn-primary" style="margin-top:12px;" onclick="startChatWithFoundUser('${u.phone}')">💬 Iniciar conversa</button>`;
    });

    // ==================== CONVIDAR AMIGOS POR LINK ====================
    // O link é https://<app>/?convite=<o teu nome de utilizador>. Quem o abre vê
    // "<Nome> convidou-te" no ecrã de entrada e, depois de entrar ou criar
    // conta, a conversa contigo abre-se sozinha.
    function inviteLink() {
        return `${location.origin}/?convite=${encodeURIComponent(APP.user.username)}`;
    }
    async function inviteFriends() {
        if (!APP.user?.username) {
            alert('Para convidar amigos precisas primeiro de um nome de utilizador (@). Define-o no teu perfil (👤 → 🔖 Nome de utilizador).');
            return;
        }
        const url = inviteLink();
        const text = `Junta-te a mim na NADIO — O teu mundo. A tua gente. 💜`;
        if (navigator.share) {
            try { await navigator.share({ title: 'NADIO', text, url }); return; }
            catch (e) { if (e && e.name === 'AbortError') return; }
        }
        try {
            await navigator.clipboard.writeText(`${text}\n${url}`);
            alert(`Link de convite copiado! Cola-o numa mensagem para os teus amigos:\n\n${url}`);
        } catch (e) {
            prompt('Copia este link de convite e envia-o aos teus amigos:', url);
        }
    }
    // Lê ?convite= do endereço (uma vez), guarda-o e limpa o endereço.
    (function readInviteFromUrl() {
        try {
            const params = new URLSearchParams(location.search);
            const inviter = (params.get('convite') || '').trim().toLowerCase();
            if (!inviter) return;
            localStorage.setItem('pendingInvite', inviter);
            params.delete('convite');
            history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
        } catch (e) {}
    })();
    (async function showInviteBanner() {
        let inviter = '';
        try { inviter = localStorage.getItem('pendingInvite') || ''; } catch (e) {}
        if (!inviter) return;
        try {
            const data = await fetch('/api/invite/' + encodeURIComponent(inviter)).then(r => r.json());
            if (!data.found) { localStorage.removeItem('pendingInvite'); return; }
            const banner = document.getElementById('inviteBanner');
            if (banner) {
                banner.textContent = `💌 ${data.name} convidou-te para a NADIO! Cria a tua conta (ou entra) e a conversa com ${data.name} abre-se sozinha.`;
                banner.style.display = 'block';
            }
        } catch (e) {}
    })();
    // Chamado quando a lista de contactos chega (sessão já ligada ao servidor).
    function handlePendingInvite() {
        let inviter = '';
        try { inviter = localStorage.getItem('pendingInvite') || ''; } catch (e) {}
        if (!inviter || APP.inviteHandled) return;
        APP.inviteHandled = true;
        localStorage.removeItem('pendingInvite');
        if (APP.user?.username && APP.user.username.toLowerCase() === inviter) return; // abriu o próprio link
        APP.pendingInviteUsername = inviter;
        socket.emit('search_user', { username: inviter });
    }

    function startChatWithFoundUser(phone) {
        socket.emit('add_contact', { phone });
        closeModal('modalSearchUser');
        // rebuildChatsFromServer() vai correr assim que 'contacts_update' chegar de volta;
        // guardamos o telefone para abrir a conversa automaticamente assim que ela aparecer.
        APP.pendingOpenChatPhone = phone;
    }

    // Cartões em vez de tabela de propósito: uma tabela larga (nome/telefone/
    // país/email/ações lado a lado) fica cortada em ecrãs de telemóvel — a
    // pessoa via só as primeiras colunas e precisava de adivinhar que dava
    // para arrastar para o lado para ver o resto (incluindo o botão de
    // apagar). Cada utilizador em cartão próprio nunca corta nada.
    async function openAdminModal() {
        if (!APP.user?.isAdmin) return;
        const body = document.getElementById('adminUsersBody');
        body.innerHTML = '<p style="color:#8696a0;text-align:center;padding:16px;font-size:13px;">A carregar...</p>';
        document.getElementById('modalAdmin').classList.add('active');
        try {
            const res = await fetch('/api/admin/users?token=' + encodeURIComponent(APP.token));
            const data = await res.json();
            if (!res.ok) { body.innerHTML = `<p style="color:#8696a0;text-align:center;padding:16px;font-size:13px;">${escapeHtml(data.error || 'Erro ao carregar.')}</p>`; return; }
            const onlineCount = (data.users || []).filter(u => u.online).length;
            document.getElementById('adminUsersOnlineCount').textContent = `${data.users?.length || 0} cadastrado(s) · ${onlineCount} online agora`;
            fetch('/api/admin/reports', { headers: { 'x-auth-token': APP.token } }).then(r => r.json()).then(d => {
                document.getElementById('adminReportsBtn').textContent = d.open ? `🚩 Denúncias (${d.open})` : '🚩 Denúncias';
            }).catch(() => {});
            body.innerHTML = (data.users || []).map(u => `
                <div style="background:rgba(255,255,255,0.06);border-radius:8px;padding:8px 10px;font-size:13px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        <strong><span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;background:${u.online ? '#25d366' : '#8696a0'};" title="${u.online ? 'Online' : 'Offline'}"></span>${escapeHtml(u.name)}${u.isAdmin ? ' 👑' : ''}</strong>
                        ${u.isAdmin ? '' : `<button class="btn-small" style="background:#e74c3c;color:#fff;padding:3px 8px;font-size:11px;flex:0 0 auto;" onclick="adminDeleteAccount('${u.phone}', '${escapeHtml(u.name).replace(/'/g, "\\'")}')">🗑️ Apagar</button>`}
                    </div>
                    <div style="opacity:0.8;margin-top:2px;">${escapeHtml(u.phone)} · ${escapeHtml(u.country || '—')} · ${u.online ? 'online agora' : 'offline'}</div>
                    ${u.email ? `<div style="opacity:0.8;word-break:break-all;">${escapeHtml(u.email)}</div>` : ''}
                </div>`).join('') || '<p style="color:#8696a0;text-align:center;padding:16px;font-size:13px;">Nenhum usuário cadastrado.</p>';
        } catch (err) {
            body.innerHTML = '<p style="color:#8696a0;text-align:center;padding:16px;font-size:13px;">Não foi possível ligar ao servidor.</p>';
        }
    }
    // Antes disto, diagnosticar um erro em produção dependia inteiramente de
    // um screenshot da pessoa que reportou o problema — o servidor não
    // guardava os próprios erros nenhures visíveis. Isto mostra os últimos
    // (ver RECENT_ERROR_LOGS no server.js) diretamente aqui.
    async function openAdminLogsModal() {
        if (!APP.user?.isAdmin) return;
        const body = document.getElementById('adminLogsBody');
        body.innerHTML = '<p style="color:#8696a0;text-align:center;padding:16px;font-size:13px;">A carregar...</p>';
        document.getElementById('modalAdminLogs').classList.add('active');
        try {
            const res = await fetch('/api/admin/logs?token=' + encodeURIComponent(APP.token));
            const data = await res.json();
            if (!res.ok) { body.innerHTML = `<p style="color:#8696a0;text-align:center;padding:16px;font-size:13px;">${escapeHtml(data.error || 'Erro ao carregar.')}</p>`; return; }
            body.innerHTML = (data.logs || []).map(l => `
                <div style="background:rgba(255,255,255,0.06);border-radius:6px;padding:6px 8px;">
                    <div style="opacity:0.7;" data-iso-time="${escapeHtml(l.time)}">${escapeHtml(new Date(l.time).toLocaleString('pt-PT'))}</div>
                    <div style="white-space:pre-wrap;word-break:break-word;color:#ff8a8a;">${escapeHtml(l.message)}</div>
                </div>`).join('') || '<p style="color:#8696a0;text-align:center;padding:16px;font-size:13px;">Sem erros registados.</p>';
        } catch (err) {
            body.innerHTML = '<p style="color:#8696a0;text-align:center;padding:16px;font-size:13px;">Não foi possível ligar ao servidor.</p>';
        }
    }
    // ==================== ESTATÍSTICAS (painel do administrador) ====================
    // Uma cor só (cada gráfico tem uma série, o título diz qual), barras finas
    // com 2px de intervalo e ponta arredondada, valor em tooltip ao passar o
    // dedo/rato, e uma tabela com todos os números para quem preferir.
    const STATS_FEATURE_LABELS = {
        transport: '🚌 Transportes', news: '📰 Notícias', 'gemini-chat': '🤖 Assistente IA', transcribe: '🎙️ Transcrever áudio', 'smart-replies': '💡 Respostas sugeridas',
        gifs: '🎞️ GIFs', weather: '🌦️ Meteorologia', exchange: '🏦 Câmbio', currency: '🏦 Câmbio', library: '📚 Biblioteca', tv: '📺 TV', watch: '🍿 Onde assistir',
        music: '🎧 Música', space: '🛰️ Espaço', fires: '🔥 Incêndios', tourism: '🗺️ Turismo', events: '🎭 Eventos', flights: '✈️ Voos', translate: '🌐 Tradução',
        'link-preview': '🔗 Pré-visualização de links', geocode: '🔎 Mapa', 'generate-image': '🎨 Imagens IA', trains: '🚆 Comboios', metro: '🚇 Metro', nav: '🧭 Navegação', culture: '🎭 Eventos', drivelisten: '🚗 Conduzir e ouvir', 'price-alerts': '🔔 Alertas de preço', 'travel-stats': '🧳 Viagens', 'google-calendar': '📆 Google Calendar', slack: '💬 Slack', feed: '🖼️ Feed'
    };
    function statsLabel(name) { return STATS_FEATURE_LABELS[name] || name; }
    function statsFmtDay(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}`; }
    function statsBarChart(title, series, field, unit) {
        const max = Math.max(1, ...series.map(d => d[field]));
        const total = series.reduce((a, d) => a + d[field], 0);
        const bars = series.map(d => {
            const v = d[field];
            const h = Math.round((v / max) * 100);
            return `<div class="stats-bar${v ? '' : ' zero'}" tabindex="0" data-tip="${statsFmtDay(d.day)}: ${v} ${unit}" aria-label="${statsFmtDay(d.day)}: ${v} ${unit}"><i style="height:${h}%"></i></div>`;
        }).join('');
        return `<div class="stats-chart"><h4>${title}<span class="meta">total ${total} · máx. ${max === 1 && !total ? 0 : max}/dia</span></h4>
            <div class="stats-bars">${bars}</div>
            <div class="stats-axis"><span>${statsFmtDay(series[0].day)}</span><span>${statsFmtDay(series[series.length - 1].day)}</span></div></div>`;
    }
    function openAdminStatsModal() {
        if (!APP.user?.isAdmin) return;
        document.getElementById('modalAdminStats').classList.add('active');
        loadAdminStats(APP.adminStatsDays || 14);
    }
    async function loadAdminStats(days) {
        APP.adminStatsDays = days;
        document.querySelectorAll('.stats-range').forEach(b => b.classList.toggle('active', Number(b.dataset.days) === days));
        const body = document.getElementById('adminStatsBody');
        body.innerHTML = '<p style="color:#8696a0;text-align:center;padding:16px;font-size:13px;">A carregar...</p>';
        try {
            const res = await fetch('/api/admin/stats?days=' + days, { headers: { 'x-auth-token': APP.token } });
            const data = await res.json();
            if (!res.ok) { body.innerHTML = `<p style="color:#8696a0;text-align:center;padding:16px;font-size:13px;">${escapeHtml(data.error || 'Erro ao carregar.')}</p>`; return; }
            const T = data.totals;
            const kpi = (v, l) => `<div class="stats-kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`;
            const maxF = Math.max(1, ...data.topFeatures.map(f => f.count));
            body.innerHTML = `
                <div class="stats-kpis">
                    ${kpi(T.users, 'contas no total')}${kpi(T.online, 'online agora')}${kpi(T.activeToday, 'ativos hoje')}
                    ${kpi(T.active7d, 'ativos nos últimos 7 dias')}${kpi(T.registrationsPeriod, `registos em ${days} dias`)}${kpi(T.messagesPeriod, `mensagens em ${days} dias`)}
                </div>
                ${statsBarChart('🆕 Registos por dia', data.series, 'registrations', 'registos')}
                ${statsBarChart('👥 Pessoas ativas por dia', data.series, 'active', 'pessoas')}
                ${statsBarChart('💬 Mensagens por dia', data.series, 'messages', 'mensagens')}
                ${statsBarChart('📞 Chamadas por dia', data.series, 'calls', 'chamadas')}
                <div class="stats-chart"><h4>⭐ Funcionalidades mais usadas<span class="meta">pedidos em ${days} dias</span></h4>
                    ${data.topFeatures.length ? data.topFeatures.map(f => `<div class="stats-feat"><span>${escapeHtml(statsLabel(f.name))}</span><div class="track"><i style="width:${Math.max(2, Math.round(f.count / maxF * 100))}%"></i></div><span class="n">${f.count}</span></div>`).join('') : '<p style="color:#8696a0;font-size:13px;">Ainda sem dados — aparecem à medida que as pessoas usam a app.</p>'}
                </div>
                <details><summary style="cursor:pointer;color:var(--text-secondary);font-size:13px;">📋 Ver todos os números (tabela)</summary>
                    <table class="stats-table"><thead><tr><th>Dia</th><th>Registos</th><th>Ativos</th><th>Mensagens</th><th>Chamadas</th></tr></thead>
                    <tbody>${data.series.slice().reverse().map(d => `<tr><td>${statsFmtDay(d.day)}</td><td>${d.registrations}</td><td>${d.active}</td><td>${d.messages}</td><td>${d.calls}</td></tr>`).join('')}</tbody></table>
                </details>`;
        } catch (err) {
            body.innerHTML = '<p style="color:#8696a0;text-align:center;padding:16px;font-size:13px;">Não foi possível ligar ao servidor.</p>';
        }
    }
    // Tooltip das barras (rato, toque e teclado).
    (function () {
        let tip = null;
        const show = (el) => {
            if (!tip) { tip = document.createElement('div'); tip.className = 'stats-tip'; document.body.appendChild(tip); }
            tip.textContent = el.dataset.tip;
            const r = el.getBoundingClientRect();
            tip.style.display = 'block';
            tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2)) + 'px';
            tip.style.top = Math.max(8, r.top - tip.offsetHeight - 6) + 'px';
        };
        const hide = () => { if (tip) tip.style.display = 'none'; };
        ['mouseover', 'focusin', 'touchstart'].forEach(ev => document.addEventListener(ev, (e) => {
            const el = e.target.closest && e.target.closest('.stats-bar');
            if (el) show(el); else if (ev !== 'touchstart') hide();
        }, { passive: true }));
        ['mouseout', 'focusout'].forEach(ev => document.addEventListener(ev, (e) => { if (e.target.closest && e.target.closest('.stats-bar')) hide(); }));
    })();

    // Denúncias feitas pelos utilizadores (ver "DENÚNCIAS" no server.js).
    async function openAdminReportsModal() {
        if (!APP.user?.isAdmin) return;
        const body = document.getElementById('adminReportsBody');
        body.innerHTML = '<p style="color:#8696a0;text-align:center;padding:16px;font-size:13px;">A carregar...</p>';
        document.getElementById('modalAdminReports').classList.add('active');
        try {
            const res = await fetch('/api/admin/reports', { headers: { 'x-auth-token': APP.token } });
            const data = await res.json();
            if (!res.ok) { body.innerHTML = `<p style="color:#8696a0;text-align:center;padding:16px;font-size:13px;">${escapeHtml(data.error || 'Erro ao carregar.')}</p>`; return; }
            const statusLabel = { aberta: '🟠 Aberta', resolvida: '✅ Resolvida', rejeitada: '⚪ Rejeitada' };
            body.innerHTML = (data.reports || []).map(r => `
                <div class="admin-report" data-report-id="${escapeHtml(r.id)}" style="background:rgba(255,255,255,0.06);border-radius:8px;padding:8px 10px;font-size:13px;${r.status === 'aberta' ? '' : 'opacity:0.65;'}">
                    <div style="display:flex;justify-content:space-between;gap:8px;"><strong>${escapeHtml(r.targetName)}</strong><span class="admin-report-status">${statusLabel[r.status] || escapeHtml(r.status)}</span></div>
                    <div style="opacity:0.8;">${escapeHtml(r.targetPhone)} · ${r.reportsAgainstTarget} denúncia(s) contra esta pessoa${r.targetExists ? '' : ' · conta já apagada'}</div>
                    <div style="margin:4px 0;white-space:pre-wrap;word-break:break-word;">“${escapeHtml(r.reason)}”</div>
                    <div style="opacity:0.7;font-size:12px;">Denunciado por ${escapeHtml(r.reporterName)} · ${escapeHtml(new Date(r.time).toLocaleString('pt-PT'))}${r.resolvedBy ? ` · tratada por ${escapeHtml(r.resolvedBy)}` : ''}</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
                        ${r.status === 'aberta'
                            ? `<button class="btn-small" style="padding:3px 8px;font-size:11px;" onclick="adminResolveReport('${escapeHtml(r.id)}','resolvida')">✅ Resolvida</button>
                               <button class="btn-small" style="padding:3px 8px;font-size:11px;" onclick="adminResolveReport('${escapeHtml(r.id)}','rejeitada')">⚪ Rejeitar</button>`
                            : `<button class="btn-small" style="padding:3px 8px;font-size:11px;" onclick="adminResolveReport('${escapeHtml(r.id)}','aberta')">↩️ Reabrir</button>`}
                        ${r.targetExists ? `<button class="btn-small" style="background:#e74c3c;color:#fff;padding:3px 8px;font-size:11px;" onclick="adminDeleteAccount('${escapeHtml(r.targetPhone)}', '${escapeHtml(r.targetName).replace(/'/g, "\\'")}')">🗑️ Apagar conta</button>` : ''}
                    </div>
                </div>`).join('') || '<p style="color:#8696a0;text-align:center;padding:16px;font-size:13px;">Sem denúncias. 🎉</p>';
            document.getElementById('adminReportsBtn').textContent = data.open ? `🚩 Denúncias (${data.open})` : '🚩 Denúncias';
        } catch (err) {
            body.innerHTML = '<p style="color:#8696a0;text-align:center;padding:16px;font-size:13px;">Não foi possível ligar ao servidor.</p>';
        }
    }
    async function adminResolveReport(id, status) {
        try {
            const res = await fetch('/api/admin/reports/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token }, body: JSON.stringify({ id, status }) });
            const data = await res.json();
            if (!res.ok) { alert(data.error || 'Erro ao atualizar a denúncia.'); return; }
            openAdminReportsModal();
        } catch (err) {
            alert('Não foi possível ligar ao servidor.');
        }
    }
    // Apagar em nome de outra pessoa: pensado para quem esqueceu a senha e
    // não tem 2FA/email para recuperar o acesso de outra forma — como ainda
    // não há redefinição de senha a sério, isto liberta o telefone/nome de
    // utilizador para a pessoa se voltar a registar do zero.
    async function adminDeleteAccount(phone, name) {
        if (!confirm(`Apagar a conta de "${name}" (${phone})?\n\nIsto é permanente. Usa isto quando a pessoa esqueceu a senha e precisa de se registar de novo — não existe (ainda) forma de redefinir a senha.`)) return;
        try {
            const res = await fetch('/api/admin/delete-account', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token }, body: JSON.stringify({ phone }) });
            const data = await res.json();
            if (!res.ok) { alert(data.error || 'Erro ao apagar a conta.'); return; }
            openAdminModal();
        } catch (err) {
            alert('Não foi possível ligar ao servidor.');
        }
    }

    function initApp() {
        APP.chats = JSON.parse(JSON.stringify(DEFAULT_CONTACTS));
        APP.messages = { gemini_assistant: [
            { id: 'm1', sender: 'Gemini', text: 'Olá! Sou o Gemini, o assistente da Google integrado aqui. Podes enviar-me texto, fotos, vídeos e documentos — pergunta o que quiseres! ✨', time: '10:30', type: 'received' }
        ] };
        renderChatList();
        updateCallContactList();
        initWhiteboard();
        // A lista real de contatos (online/offline) e de grupos chega pelo socket
        // ('contacts_update' / 'groups_update') e é montada em rebuildChatsFromServer().
    }

    function renderChatList(filter = '') {
        const list = document.getElementById('chatList');
        const activeFolder = APP.activeFolderId ? (APP.folders || []).find(f => f.id === APP.activeFolderId) : null;
        let filtered = APP.chats.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()) && !APP.archivedChats.has(c.id) && (!activeFolder || (activeFolder.chatIds || []).includes(c.id)));
        // Conversas bloqueadas por PIN ficam de fora da lista normal até seres
        // autenticado nesta sessão (ver unlockLockedChatsSection) — a contagem usa
        // sempre TODAS as conversas (não só as filtradas pela pesquisa/pasta), para o
        // número não variar consoante o que se pesquisa e acabar por revelar pistas.
        const lockedCount = APP.chats.filter(c => APP.lockedChats.has(c.id)).length;
        if (!APP.lockedChatsRevealed) filtered = filtered.filter(c => !APP.lockedChats.has(c.id));
        // Fixadas sempre no topo, mantendo a ordem normal entre elas e entre
        // as restantes (sort é estável) — não depende da pesquisa/pasta ativa.
        filtered.sort((a, b) => (APP.pinnedChats.has(b.id) ? 1 : 0) - (APP.pinnedChats.has(a.id) ? 1 : 0));
        let html = filtered.map(chat => {
            const lastMsg = APP.messages[chat.id]?.slice(-1)[0];
            const lastText = lastMsg ? (lastMsg.sender === 'Você' ? 'Você: ' : '') + escapeHtml(lastMsg.text || '') : 'Nenhuma mensagem';
            const isGroup = chat.type === 'group';
            const isAI = chat.type === 'ai';
            const avatarContent = isAI ? '✨' : (isGroup ? (chat.avatar || '👥') : avatarInnerHtml(chat.name, chat.avatarUrl));
            const avatarClass = isAI ? 'avatar-ai' : (isGroup ? 'avatar-group' : 'avatar-user');
            const statusRingClass = (!isAI && !isGroup && hasActiveStatus(chat.phone)) ? ' avatar-status-ring' : '';
            const badgeClass = isAI ? 'badge badge-ai' : 'badge';
            const onlineDot = (!isAI && !isGroup) ? `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;background:${chat.online ? '#25d366' : '#8696a0'};"></span>` : '';
            return `
            <div class="chat-item ${APP.currentChatId === chat.id ? 'active' : ''}" onclick="openChat('${chat.id}')">
                <div class="chat-item-avatar ${avatarClass}${statusRingClass}">${avatarContent}</div>
                <div class="chat-item-info">
                    <h4>${APP.pinnedChats.has(chat.id) ? '📌 ' : ''}${APP.lockedChats.has(chat.id) ? '🔒 ' : ''}${onlineDot}${escapeHtml(chat.name)} ${isGroup ? '<span style="font-size:11px;color:#8696a0;">('+chat.memberCount+' membros)</span>' : ''}</h4>
                    <p>${lastText}</p>
                </div>
                <div class="chat-item-meta">
                    <span>${lastMsg?.time || ''}</span>
                    ${isAI ? '<br><span class="'+badgeClass+'">IA</span>' : (isGroup ? '<br><span class="badge">grupo</span>' : (chat.online ? '<br><span style="font-size:10px;color:#25d366;">online</span>' : ''))}
                </div>
            </div>`;
        }).join('');
        if (!APP.lockedChatsRevealed && lockedCount > 0) {
            html += `<div class="chat-item" style="cursor:pointer;" onclick="unlockLockedChatsSection()">
                <div class="chat-item-avatar avatar-user">🔒</div>
                <div class="chat-item-info">
                    <h4>Conversas bloqueadas</h4>
                    <p>${lockedCount} conversa${lockedCount !== 1 ? 's' : ''} — toca para desbloquear</p>
                </div>
            </div>`;
        }
        list.innerHTML = html;
        if (filtered.length === 0 && !(!APP.lockedChatsRevealed && lockedCount > 0)) {
            list.innerHTML = '<p style="color:#8696a0;text-align:center;padding:30px;">Nenhuma conversa encontrada</p>';
        }
    }

    function filterChats(query) { renderChatList(query); }

    // ==================== PESQUISA GLOBAL (todas as conversas) ====================
    // Já temos todo o histórico de mensagens de todos os chats carregado em
    // APP.messages (entra-se logo em todas as salas ao iniciar sessão — ver
    // enterApp), incluindo o texto já desencriptado das conversas 1-para-1
    // com E2EE, por isso a pesquisa corre inteiramente no cliente, sem
    // precisar de pedir nada ao servidor.
    let globalSearchTimer = null;
    function openGlobalSearchModal() {
        document.getElementById('globalSearchInput').value = '';
        document.getElementById('globalSearchResults').innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">Escreve para pesquisar em todas as conversas.</p>';
        document.getElementById('modalGlobalSearch').classList.add('active');
        document.getElementById('globalSearchInput').focus();
    }
    function debounceGlobalSearch() {
        clearTimeout(globalSearchTimer);
        globalSearchTimer = setTimeout(runGlobalSearch, 250);
    }
    function runGlobalSearch() {
        const query = document.getElementById('globalSearchInput').value.trim().toLowerCase();
        const resultsEl = document.getElementById('globalSearchResults');
        if (!query) {
            resultsEl.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">Escreve para pesquisar em todas as conversas.</p>';
            return;
        }
        const results = [];
        Object.entries(APP.messages).forEach(([chatId, msgs]) => {
            const chat = APP.chats.find(c => c.id === chatId);
            if (!chat) return; // conversa já não existe na lista (ex.: chat da IA usa outro fluxo)
            if (APP.lockedChats.has(chatId) && !APP.lockedChatsRevealed) return; // bloqueada — não aparece na pesquisa enquanto não for desbloqueada
            (msgs || []).forEach(msg => {
                if (msg.deleted || msg.encrypted) return; // "encrypted" aqui só sobra se não foi possível desencriptar
                const textMatch = !!msg.text && msg.text.toLowerCase().includes(query);
                const attachmentMatch = !textMatch && !!msg.attachmentText && msg.attachmentText.toLowerCase().includes(query);
                if (textMatch || attachmentMatch) results.push({ chat, msg, inAttachment: attachmentMatch });
            });
        });
        results.sort((a, b) => (b.msg.time || '').localeCompare(a.msg.time || ''));
        const top = results.slice(0, 50);
        if (!top.length) {
            resultsEl.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">Nenhuma mensagem encontrada.</p>';
            return;
        }
        const queryRe = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
        resultsEl.innerHTML = top.map(({ chat, msg, inAttachment }) => {
            // Quando a correspondência só existe DENTRO do anexo (não no texto/nome da mensagem em
            // si), o trecho mostrado vem do conteúdo do documento, com uma etiqueta 📎 a explicar
            // porque é que aquele resultado apareceu (o utilizador nunca vê o texto do PDF na tela).
            const source = inAttachment ? msg.attachmentText : msg.text;
            const idx = source.toLowerCase().indexOf(query);
            const snippetRaw = source.length > 140 ? '…' + source.slice(Math.max(0, idx - 40), idx + 100) + '…' : source;
            const snippet = escapeHtml(snippetRaw).replace(queryRe, '<mark style="background:rgba(255,193,7,0.5);color:inherit;">$1</mark>');
            const attachmentBadge = inAttachment ? `<span style="opacity:0.7;">📎 ${escapeHtml(msg.fileName || 'anexo')}: </span>` : '';
            return `<div class="chat-item" style="cursor:pointer;" onclick="jumpToSearchResult('${chat.id}','${msg.id}')">
                <div class="chat-item-avatar ${chat.type === 'group' ? 'avatar-group' : 'avatar-user'}">${chat.avatar || chat.name.charAt(0)}</div>
                <div class="chat-item-info">
                    <h4>${escapeHtml(chat.name)}</h4>
                    <p>${attachmentBadge}${snippet}</p>
                </div>
                <div class="chat-item-meta"><span>${msg.time || ''}</span></div>
            </div>`;
        }).join('');
    }
    // ==================== AS MINHAS ESTATÍSTICAS (estilo "Wrapped") ====================
    // Tal como a pesquisa global, aproveita o histórico já carregado em
    // APP.messages para todas as conversas — sem pedir nada novo ao servidor.
    const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
    function computeMyStats() {
        let sentCount = 0, receivedCount = 0, photos = 0, videos = 0, audios = 0, gifs = 0, viewOnceSent = 0;
        let longestMessage = '';
        const emojiTally = {};
        const hourTally = {};
        const chatTotals = {};
        Object.entries(APP.messages).forEach(([chatId, msgs]) => {
            const chat = APP.chats.find(c => c.id === chatId);
            if (!chat) return;
            (msgs || []).forEach(msg => {
                if (msg.deleted) return;
                const isSent = msg.type === 'sent';
                if (isSent) sentCount++; else receivedCount++;
                chatTotals[chatId] = (chatTotals[chatId] || 0) + 1;
                if (isSent) {
                    if (msg.fileData || msg.viewOnce) {
                        const t = msg.fileType || '';
                        if (msg.viewOnce) viewOnceSent++;
                        if (t === 'image/gif') gifs++;
                        else if (t.startsWith('image/')) photos++;
                        else if (t.startsWith('video/')) videos++;
                        else if (t.startsWith('audio/')) audios++;
                    } else if (msg.text && !msg.encrypted) {
                        if (msg.text.length > longestMessage.length) longestMessage = msg.text;
                        const emojis = msg.text.match(EMOJI_REGEX) || [];
                        emojis.forEach(e => { emojiTally[e] = (emojiTally[e] || 0) + 1; });
                    }
                    const hour = (msg.time || '').split(':')[0];
                    if (hour) hourTally[hour] = (hourTally[hour] || 0) + 1;
                }
            });
        });
        const topEmojiEntry = Object.entries(emojiTally).sort((a, b) => b[1] - a[1])[0];
        const topHourEntry = Object.entries(hourTally).sort((a, b) => b[1] - a[1])[0];
        const topChatEntry = Object.entries(chatTotals).sort((a, b) => b[1] - a[1])[0];
        const topChat = topChatEntry ? APP.chats.find(c => c.id === topChatEntry[0]) : null;
        const contactCount = APP.chats.filter(c => c.type === 'user').length;
        const groupCount = APP.chats.filter(c => c.type === 'group').length;
        return {
            sentCount, receivedCount, photos, videos, audios, gifs, viewOnceSent,
            longestMessage, contactCount, groupCount,
            topEmoji: topEmojiEntry ? topEmojiEntry[0] : null,
            topHour: topHourEntry ? topHourEntry[0] : null,
            topChatName: topChat ? topChat.name : null,
            timeSpentSec: APP.user?.totalTimeSpentSec || 0
        };
    }
    function statCard(emoji, value, label) {
        return `<div style="background:var(--bg-secondary);border-radius:10px;padding:14px 10px;text-align:center;">
            <div style="font-size:22px;">${emoji}</div>
            <div style="font-size:20px;font-weight:700;margin:4px 0;">${value}</div>
            <div style="font-size:11px;color:var(--text-secondary);">${label}</div>
        </div>`;
    }
    function openMyStatsModal() {
        const s = computeMyStats();
        const cards = [
            statCard('💬', s.sentCount, 'Mensagens enviadas'),
            statCard('📥', s.receivedCount, 'Mensagens recebidas'),
            statCard('👥', s.contactCount, 'Contactos'),
            statCard('🧑‍🤝‍🧑', s.groupCount, 'Grupos'),
            statCard('📷', s.photos, 'Fotos enviadas'),
            statCard('🎥', s.videos, 'Vídeos enviados'),
            statCard('🎤', s.audios, 'Áudios enviados'),
            statCard('🎬', s.gifs, 'GIFs/Stickers'),
            statCard('👁️', s.viewOnceSent, 'Fotos "ver uma vez"'),
            statCard('⏱️', formatTimeSpent(s.timeSpentSec), 'Tempo total na app'),
        ];
        if (s.topEmoji) cards.push(statCard('⭐', s.topEmoji, 'O teu emoji favorito'));
        if (s.topHour) cards.push(statCard('🕐', `${s.topHour}h`, 'Hora em que mais falas'));
        if (s.topChatName) cards.push(statCard('🏆', escapeHtml(s.topChatName), 'Conversa mais ativa'));
        document.getElementById('myStatsContent').innerHTML = cards.join('');
        renderBadgesGrid();
        document.getElementById('modalMyStats').classList.add('active');
    }

    // ==================== CONQUISTAS/GAMIFICAÇÃO ====================
    // Espelha exatamente os ids/emojis/títulos do BADGE_CATALOG em server.js —
    // o servidor é quem decide quando um badge é desbloqueado (fiável entre
    // dispositivos), aqui só desenhamos a grelha com o que já foi conquistado
    // a cinzento vs. a cores, e mostramos um toast quando chega um novo.
    const BADGE_CATALOG = {
        first_message: { emoji: '💬', title: 'Primeira conversa', desc: 'Enviaste a tua primeira mensagem.' },
        messages_100: { emoji: '🗣️', title: 'Tagarela', desc: 'Enviaste 100 mensagens.' },
        first_group: { emoji: '👥', title: 'Fundador', desc: 'Criaste o teu primeiro grupo.' },
        first_community: { emoji: '🌐', title: 'Organizador', desc: 'Criaste a tua primeira comunidade.' },
        first_call: { emoji: '📞', title: 'Primeira chamada', desc: 'Completaste a tua primeira chamada.' },
        calls_10: { emoji: '☎️', title: 'Sempre em linha', desc: 'Completaste 10 chamadas.' },
        first_expense: { emoji: '💰', title: 'Organizado', desc: 'Registaste a tua primeira despesa dividida.' },
        first_game: { emoji: '🃏', title: 'Jogador', desc: 'Jogaste o teu primeiro jogo.' },
        photos_50: { emoji: '📸', title: 'Fotógrafo', desc: 'Enviaste 50 fotos.' },
        night_owl: { emoji: '🌙', title: 'Coruja', desc: 'Enviaste uma mensagem entre a meia-noite e as 5h.' },
        streak_7: { emoji: '🔥', title: 'Sequência de 7 dias', desc: 'Falaste 7 dias seguidos.' },
        collector: { emoji: '🏅', title: 'Colecionador', desc: 'Desbloqueaste 5 conquistas diferentes.' },
    };
    function renderBadgesGrid() {
        const box = document.getElementById('myBadgesContent');
        if (!box) return;
        const unlocked = new Set(APP.badges || []);
        box.innerHTML = Object.entries(BADGE_CATALOG).map(([id, b]) => {
            const has = unlocked.has(id);
            return `<div title="${escapeHtml(b.desc)}" style="text-align:center;padding:10px 4px;border-radius:10px;background:var(--bg-secondary);opacity:${has ? '1' : '0.35'};">
                <div style="font-size:24px;filter:${has ? 'none' : 'grayscale(1)'};">${b.emoji}</div>
                <div style="font-size:10px;margin-top:4px;">${escapeHtml(b.title)}</div>
            </div>`;
        }).join('');
    }
    function showBadgeUnlockedToast(badge) {
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);background:var(--bg-secondary);border:1px solid var(--accent-color,#7c5cff);border-radius:12px;padding:12px 18px;z-index:9999;display:flex;align-items:center;gap:10px;box-shadow:0 4px 16px rgba(0,0,0,0.3);animation:fadeIn 0.3s;';
        el.innerHTML = `<span style="font-size:28px;">${badge.emoji}</span><div><div style="font-weight:700;font-size:13px;">🏆 Conquista desbloqueada!</div><div style="font-size:12px;color:var(--text-secondary);">${escapeHtml(badge.title)}</div></div>`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 5000);
    }
    socket.on('badges_update', (list) => {
        APP.badges = list || [];
        if (document.getElementById('modalMyStats')?.classList.contains('active')) renderBadgesGrid();
    });
    socket.on('badge_unlocked', (badge) => { showBadgeUnlockedToast(badge); });

    // ==================== ESTATÍSTICAS DO GRUPO ====================
    // A versão "grupo" das estatísticas pessoais acima — mesma técnica (deriva
    // tudo do histórico já carregado em APP.messages, sem pedir nada novo ao
    // servidor), mas por PESSOA em vez de por conta própria, para responder a
    // "quem manda mais mensagens/fotos" dentro deste grupo.
    function computeGroupStats(chatId) {
        const msgs = (APP.messages[chatId] || []).filter(m => !m.deleted);
        const perSender = {}; // nome -> {sent, photos, videos, audios}
        let totalPhotos = 0, totalVideos = 0, totalAudios = 0;
        const hourTally = {};
        const emojiTally = {};
        msgs.forEach(msg => {
            const name = msg.sender || 'Desconhecido';
            if (!perSender[name]) perSender[name] = { sent: 0, photos: 0, videos: 0, audios: 0 };
            perSender[name].sent++;
            if (msg.fileData || msg.viewOnce) {
                const t = msg.fileType || '';
                if (t.startsWith('image/')) { perSender[name].photos++; totalPhotos++; }
                else if (t.startsWith('video/')) { perSender[name].videos++; totalVideos++; }
                else if (t.startsWith('audio/')) { perSender[name].audios++; totalAudios++; }
            } else if (msg.text && !msg.encrypted) {
                const emojis = msg.text.match(EMOJI_REGEX) || [];
                emojis.forEach(e => { emojiTally[e] = (emojiTally[e] || 0) + 1; });
            }
            const hour = (msg.time || '').split(':')[0];
            if (hour) hourTally[hour] = (hourTally[hour] || 0) + 1;
        });
        const ranking = Object.entries(perSender).sort((a, b) => b[1].sent - a[1].sent).map(([name, s]) => ({ name, ...s }));
        const topHourEntry = Object.entries(hourTally).sort((a, b) => b[1] - a[1])[0];
        const topEmojiEntry = Object.entries(emojiTally).sort((a, b) => b[1] - a[1])[0];
        return {
            totalMessages: msgs.length, totalPhotos, totalVideos, totalAudios,
            memberCount: ranking.length, ranking,
            topHour: topHourEntry ? topHourEntry[0] : null,
            topEmoji: topEmojiEntry ? topEmojiEntry[0] : null
        };
    }
    function openGroupStatsModal() {
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat || chat.type !== 'group') return;
        const s = computeGroupStats(APP.currentChatId);
        const cards = [
            statCard('💬', s.totalMessages, 'Mensagens no total'),
            statCard('🧑‍🤝‍🧑', s.memberCount, 'Pessoas que já falaram'),
            statCard('📷', s.totalPhotos, 'Fotos partilhadas'),
            statCard('🎥', s.totalVideos, 'Vídeos partilhados'),
            statCard('🎤', s.totalAudios, 'Áudios partilhados'),
        ];
        if (s.topHour) cards.push(statCard('🕐', `${s.topHour}h`, 'Hora mais movimentada'));
        if (s.topEmoji) cards.push(statCard('⭐', s.topEmoji, 'Emoji mais usado'));
        document.getElementById('groupStatsContent').innerHTML = cards.join('');
        document.getElementById('groupStatsRankings').innerHTML = s.ranking.length ? `
            <h4 style="margin:0 0 6px;font-size:13px;opacity:0.8;">🏆 Quem mais fala</h4>
            <div style="display:flex;flex-direction:column;gap:6px;">
                ${s.ranking.slice(0, 10).map((r, i) => `
                    <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.05);border-radius:8px;padding:6px 10px;font-size:13px;">
                        <span>${i + 1}. ${escapeHtml(r.name)}</span>
                        <span style="opacity:0.75;">${r.sent} msg${r.photos ? ` · ${r.photos} 📷` : ''}${r.videos ? ` · ${r.videos} 🎥` : ''}</span>
                    </div>`).join('')}
            </div>` : '';
        document.getElementById('modalGroupStats').classList.add('active');
    }

    // ==================== CHAMADA AGENDADA ====================
    // Não liga sozinha — pedir câmara/microfone precisa de um toque genuíno
    // da pessoa, por isso na hora marcada só avisa (push + este evento em
    // tempo real, se estiver ligado) com um botão para iniciar a chamada já,
    // que passa pelo mesmo startCall()/joinGroupCall() normal de sempre.
    const SCHEDULED_CALLS = {}; // chatId -> lista
    socket.on('scheduled_calls_list', (data) => {
        if (!data?.chatId) return;
        SCHEDULED_CALLS[data.chatId] = data.list || [];
        if (APP.currentChatId === data.chatId && document.getElementById('modalScheduleCall').classList.contains('active')) renderScheduledCallsModal();
    });
    function openScheduleCallModal() {
        if (!APP.currentChatId) return;
        renderScheduledCallsModal();
        document.getElementById('scheduleCallDatetimeInput').value = '';
        document.getElementById('modalScheduleCall').classList.add('active');
    }
    function renderScheduledCallsModal() {
        const list = (SCHEDULED_CALLS[APP.currentChatId] || []).slice().sort((a, b) => a.scheduledAt - b.scheduledAt);
        document.getElementById('scheduledCallsList').innerHTML = list.length ? list.map(c => {
            const dateStr = new Date(c.scheduledAt).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            return `<div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:8px 10px;font-size:13px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
                <span>${c.callType === 'video' ? '🎥' : '📞'} ${dateStr}${c.notified ? ' · já avisado' : ''}</span>
                <button onclick="cancelScheduledCall('${c.id}')" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:14px;">🗑️</button>
            </div>`;
        }).join('') : '<p style="color:#8696a0;text-align:center;padding:10px;">Ainda não há chamadas agendadas nesta conversa.</p>';
    }
    function submitScheduleCall() {
        const datetimeStr = document.getElementById('scheduleCallDatetimeInput').value;
        const callType = document.getElementById('scheduleCallTypeSelect').value;
        if (!datetimeStr) return alert('Escolhe uma data/hora.');
        const scheduledAt = new Date(datetimeStr).getTime();
        if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) return alert('Escolhe uma data/hora no futuro.');
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        socket.emit('schedule_call', { chatId: APP.currentChatId, callType, scheduledAt, toPhone: (chat && chat.type !== 'group') ? chat.phone : null });
        document.getElementById('scheduleCallDatetimeInput').value = '';
    }
    function cancelScheduledCall(id) {
        if (!APP.currentChatId) return;
        socket.emit('cancel_scheduled_call', { chatId: APP.currentChatId, id });
    }
    let scheduledCallAlertData = null;
    socket.on('scheduled_call_due', (data) => {
        scheduledCallAlertData = data;
        const chat = APP.chats.find(c => c.id === data.chatId);
        const name = data.chatName || chat?.name || 'a conversa';
        document.getElementById('scheduledCallAlertText').textContent = `${data.callType === 'video' ? 'Chamada de vídeo' : 'Chamada de voz'} agendada com ${name}.`;
        document.getElementById('modalScheduledCallAlert').classList.add('active');
    });
    function startScheduledCallNow() {
        if (!scheduledCallAlertData) return;
        const data = scheduledCallAlertData;
        scheduledCallAlertData = null;
        closeModal('modalScheduledCallAlert');
        if (APP.currentChatId !== data.chatId) openChat(data.chatId);
        setTimeout(() => startCall(data.callType), 400);
    }

    function jumpToSearchResult(chatId, messageId) {
        closeModal('modalGlobalSearch');
        openChat(chatId);
        setTimeout(() => {
            const el = document.querySelector(`[data-msg-id="${messageId}"]`);
            if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.background = 'rgba(0,168,132,0.25)'; setTimeout(() => el.style.background = '', 1500); }
        }, 300);
    }

    function openChat(chatId) {
        // Uma conversa bloqueada não pode ser aberta por atalho nenhum (ex.: um
        // resultado da pesquisa global) sem passar pelo PIN primeiro — sem isto, o
        // bloqueio da lista era só cosmético, dava para contornar na mesma.
        if (APP.lockedChats.has(chatId) && !APP.lockedChatsRevealed) {
            APP.pendingChatIdAfterUnlock = chatId;
            unlockLockedChatsSection();
            return;
        }
        APP.currentChatId = chatId;
        const chat = APP.chats.find(c => c.id === chatId);
        if (!chat) return;
        hideMentionAutocomplete();
        if (!APP.joinedRooms.has(chatId)) { socket.emit('join_room', { chatId, toPhone: chat.phone }); APP.joinedRooms.add(chatId); }
        if (chat.type !== 'ai') socket.emit('message_read', { chatId });
        document.getElementById('chatArea').classList.add('active');
        document.getElementById('sidebar').classList.add('chat-open');
        document.getElementById('chatName').textContent = chat.name;
        const isGroup = chat.type === 'group';
        const isAI = chat.type === 'ai';
        document.getElementById('chatSubtitle').textContent = isAI ? 'Gemini (Google) · respondendo instantaneamente' : (isGroup ? (chat.announcementsOnly ? ('📢 Canal de anúncios' + (chat.admins?.includes(APP.user.phone) ? '' : ' · só administradores podem publicar')) : `Grupo · ${chat.memberCount} membros`) : (chat.online ? 'Online' : 'Offline'));
        document.getElementById('manageGroupBtn').style.display = (isGroup && chat.admins?.includes(APP.user.phone)) ? 'flex' : 'none';
        document.getElementById('vrRoomBtn').style.display = isGroup ? 'flex' : 'none';
        document.getElementById('groupStatsBtn').style.display = isGroup ? 'flex' : 'none';
        document.getElementById('groupCalendarBtn').style.display = isGroup ? 'flex' : 'none';
        document.getElementById('slackLinkBtn').style.display = isGroup ? 'flex' : 'none';
        document.getElementById('audioRoomBtn').style.display = isGroup ? 'flex' : 'none';
        document.getElementById('pollBtn').style.display = isGroup ? 'flex' : 'none';
        document.getElementById('rsvpBtn').style.display = isGroup ? 'flex' : 'none';
        document.getElementById('gamesBtn').style.display = (chat.type === 'user' || chat.type === 'group') ? 'flex' : 'none';
        updateEncryptionBadge();
        const avatarContent = isAI ? '✨' : (isGroup ? (chat.avatar || '👥') : avatarInnerHtml(chat.name, chat.avatarUrl));
        document.getElementById('chatAvatar').innerHTML = avatarContent;
        const avatarEl = document.getElementById('chatAvatar');
        avatarEl.className = 'header-avatar' + ((!isAI && !isGroup && hasActiveStatus(chat.phone)) ? ' avatar-status-ring' : '');
        avatarEl.style.background = isAI ? 'linear-gradient(135deg, #4285F4, #9b72cb)' : (isGroup ? 'linear-gradient(135deg, #4caf84, #2196a4)' : 'linear-gradient(135deg, #6c5ce7, #a29bfe)');
        renderMessages();
        document.getElementById('messageInput').focus();
        renderChatList();
        updatePinnedBanner();
        updateMuteButton();
        updateAutoTranslateButton();
        updateArchiveButton();
        updatePinChatButton();
        updateLockChatButton();
        updateBlockButton();
        document.getElementById('chatSearchBar').style.display = 'none';
        document.getElementById('chatSearchInput').value = '';
        setTimeout(() => { const msgDiv = document.getElementById('chatMessages'); msgDiv.scrollTop = msgDiv.scrollHeight; }, 100);
    }

    // ==================== TRANSPORTES (autocarros, metro/comboio, aviões) ====================
    const TRANSPORT = {
        map: null,
        activeTab: 'bus',
        layers: { bus: null, rail: null, flight: null },
        pollInterval: null,
        tripOriginCode: null,
        tripDestinationCode: null
    };

    function openTransportScreen() {
        document.getElementById('transportScreen').classList.add('active');
        if (!TRANSPORT.map) {
            TRANSPORT.map = L.map('transportMap').setView([39.5, -6.5], 6); // centrado em Portugal/Espanha
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(TRANSPORT.map);
            TRANSPORT.layers.bus = L.layerGroup().addTo(TRANSPORT.map);
            TRANSPORT.layers.rail = L.layerGroup();
            TRANSPORT.layers.flight = L.layerGroup();
            TRANSPORT.layers.bikes = L.layerGroup();
            TRANSPORT.layers.trainsEstimated = L.layerGroup();
        }
        setTimeout(() => TRANSPORT.map.invalidateSize(), 200);
        switchTransportTab('bus');
    }

    function closeTransportScreen() {
        document.getElementById('transportScreen').classList.remove('active');
        if (TRANSPORT.pollInterval) { clearInterval(TRANSPORT.pollInterval); TRANSPORT.pollInterval = null; }
    }

    function closeTransportScreen() {
        document.getElementById('transportScreen').classList.remove('active');
        if (TRANSPORT.pollInterval) { clearInterval(TRANSPORT.pollInterval); TRANSPORT.pollInterval = null; }
    }

    // ==================== SALA "CONDUZIR E OUVIR" (Drive & Listen) ====================
    // Vídeo de condução (YouTube, sem som) + rádio local a tocar por cima —
    // a mesma técnica do driveandlisten.app. O YouTube fornece só a imagem;
    // o som vem de uma rádio real do país obtida pela Radio Browser.
    const DRIVE_LISTEN = {
        cities: [],
        currentCity: null,
        ytPlayer: null,
        ytReady: false,
        radioAudio: new Audio(),
        playing: false
    };
    DRIVE_LISTEN.radioAudio.volume = 0.7;
    DRIVE_LISTEN.radioAudio.crossOrigin = 'anonymous';

    function loadYouTubeIframeAPI() {
        if (window.YT && window.YT.Player) { DRIVE_LISTEN.ytReady = true; return; }
        if (document.getElementById('ytIframeApiScript')) return;
        const tag = document.createElement('script');
        tag.id = 'ytIframeApiScript';
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
    }
    // Chamado automaticamente pelo script do YouTube quando está pronto
    window.onYouTubeIframeAPIReady = function () { DRIVE_LISTEN.ytReady = true; };

    function openDriveListenScreen() {
        document.getElementById('driveListenScreen').classList.add('active');
        loadYouTubeIframeAPI();
        if (!DRIVE_LISTEN.cities.length) {
            fetch('/api/drivelisten/cities').then(r => r.json()).then(cities => {
                DRIVE_LISTEN.cities = cities;
                renderDriveListenCityBar();
            }).catch(() => {
                document.getElementById('driveListenCityBar').innerHTML = '<span style="color:var(--text-secondary);font-size:12px;">⚠️ Não foi possível carregar a lista de cidades.</span>';
            });
        } else {
            renderDriveListenCityBar();
        }
    }

    function closeDriveListenScreen() {
        document.getElementById('driveListenScreen').classList.remove('active');
        DRIVE_LISTEN.radioAudio.pause();
        if (DRIVE_LISTEN.ytPlayer && DRIVE_LISTEN.ytPlayer.pauseVideo) DRIVE_LISTEN.ytPlayer.pauseVideo();
        DRIVE_LISTEN.playing = false;
    }

    function renderDriveListenCityBar() {
        const bar = document.getElementById('driveListenCityBar');
        bar.innerHTML = DRIVE_LISTEN.cities.map(c => `
            <button class="btn-small ${DRIVE_LISTEN.currentCity === c.id ? 'btn-accept' : ''}" style="flex:0 0 auto;" onclick="selectDriveListenCity('${c.id}')">${c.flag} ${c.name}</button>
        `).join('');
    }

    function selectDriveListenCity(cityId) {
        const city = DRIVE_LISTEN.cities.find(c => c.id === cityId);
        if (!city) return;
        DRIVE_LISTEN.currentCity = cityId;
        renderDriveListenCityBar();
        document.getElementById('driveListenOverlay').style.display = 'none';
        document.getElementById('driveListenRadioStatus').textContent = 'A procurar uma rádio de ' + city.country + '...';

        // Vídeo (imagem, sem som — o som vem da rádio)
        const showVideoError = () => {
            document.getElementById('driveListenOverlay').innerHTML = `⚠️ O vídeo de ${city.name} está indisponível agora (o dono do vídeo pode tê-lo removido ou desativado a partilha).<br><br>Escolhe outra cidade na barra acima — o áudio da rádio continua a funcionar normalmente.`;
            document.getElementById('driveListenOverlay').style.display = 'flex';
        };
        const startVideo = (useFallback) => {
            const vid = useFallback && city.videoId2 ? city.videoId2 : city.videoId;
            // O player é reaproveitado entre trocas de cidade, mas o "onError" só é
            // registado UMA VEZ na criação — por isso guardamos aqui qual função deve
            // correr agora, e o handler fixo (mais abaixo) vai sempre buscar a mais recente.
            DRIVE_LISTEN.currentOnError = () => {
                if (!useFallback && city.videoId2) startVideo(true); // tenta o vídeo alternativo desta cidade antes de desistir
                else showVideoError();
            };
            if (!DRIVE_LISTEN.ytPlayer) {
                DRIVE_LISTEN.ytPlayer = new YT.Player('driveListenPlayer', {
                    videoId: vid,
                    playerVars: { autoplay: 1, mute: 1, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, loop: 1, playlist: vid },
                    events: {
                        onReady: (e) => { e.target.mute(); e.target.playVideo(); },
                        onError: () => { if (DRIVE_LISTEN.currentOnError) DRIVE_LISTEN.currentOnError(); }
                    }
                });
            } else {
                DRIVE_LISTEN.ytPlayer.loadVideoById(vid);
                DRIVE_LISTEN.ytPlayer.mute();
            }
        };
        if (DRIVE_LISTEN.ytReady) startVideo(false);
        else { const wait = setInterval(() => { if (DRIVE_LISTEN.ytReady) { clearInterval(wait); startVideo(false); } }, 300); }

        // Rádio local (o som real da sala)
        fetch('/api/drivelisten/radio?country=' + encodeURIComponent(city.country)).then(r => r.json()).then(data => {
            if (data.error) throw new Error(data.error);
            DRIVE_LISTEN.radioAudio.src = data.url;
            DRIVE_LISTEN.radioAudio.play()
                .then(() => {
                    DRIVE_LISTEN.playing = true;
                    document.getElementById('driveListenPlayBtn').textContent = '⏸️';
                    document.getElementById('driveListenRadioStatus').textContent = '📻 ' + data.name;
                })
                .catch(() => {
                    document.getElementById('driveListenRadioStatus').textContent = '📻 ' + data.name + ' — toque em ▶️ para ouvir (o navegador bloqueou o som automático)';
                    document.getElementById('driveListenPlayBtn').textContent = '▶️';
                    DRIVE_LISTEN.playing = false;
                });
        }).catch(err => {
            document.getElementById('driveListenRadioStatus').textContent = '⚠️ Não encontrei uma rádio para ' + city.country + ' agora: ' + err.message;
        });
    }

    function toggleDriveListenPlay() {
        const btn = document.getElementById('driveListenPlayBtn');
        if (DRIVE_LISTEN.playing) {
            DRIVE_LISTEN.radioAudio.pause();
            if (DRIVE_LISTEN.ytPlayer && DRIVE_LISTEN.ytPlayer.pauseVideo) DRIVE_LISTEN.ytPlayer.pauseVideo();
            DRIVE_LISTEN.playing = false;
            btn.textContent = '▶️';
        } else {
            DRIVE_LISTEN.radioAudio.play().catch(() => {});
            if (DRIVE_LISTEN.ytPlayer && DRIVE_LISTEN.ytPlayer.playVideo) DRIVE_LISTEN.ytPlayer.playVideo();
            DRIVE_LISTEN.playing = true;
            btn.textContent = '⏸️';
        }
    }

    function setDriveListenVolume(value) {
        DRIVE_LISTEN.radioAudio.volume = value / 100;
    }

    function switchTransportTab(tab) {
        TRANSPORT.activeTab = tab;
        document.querySelectorAll('.transport-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
        document.getElementById('railScheduleBar').style.display = tab === 'rail' ? 'flex' : 'none';
        document.getElementById('busCityToggle').style.display = tab === 'bus' ? 'flex' : 'none';
        document.getElementById('flightFilterBar').style.display = tab === 'flight' ? 'flex' : 'none';
        document.getElementById('tripSearchBar').style.display = tab === 'priceSearch' ? 'flex' : 'none';
        Object.values(TRANSPORT.layers).forEach(layer => TRANSPORT.map.removeLayer(layer));
        if (TRANSPORT.layers[tab]) TRANSPORT.layers[tab].addTo(TRANSPORT.map);
        if (TRANSPORT.pollInterval) clearInterval(TRANSPORT.pollInterval);
        if (railEstimatedInterval) { clearInterval(railEstimatedInterval); railEstimatedInterval = null; }
        if (tab !== 'rail') { const cb = document.getElementById('railEstimatedToggle'); if (cb) cb.checked = false; TRANSPORT.layers.trainsEstimated.clearLayers(); railSelectedTripId = null; document.getElementById('railTrainDetail').style.display = 'none'; }
        if (tab === 'bus') {
            switchBusCity(TRANSPORT.busCity || 'lisboa');
        } else if (tab === 'flight') {
            document.getElementById('transportMap').style.display = '';
            document.getElementById('guimaraesScheduleBar').style.display = 'none';
            document.getElementById('portoScheduleBar').style.display = 'none';
            document.getElementById('madridBusScheduleBar').style.display = 'none';
            document.getElementById('valenciaBusScheduleBar').style.display = 'none';
            TRANSPORT.map.setView([39.5, -6.5], 6);
            loadFlights();
            TRANSPORT.pollInterval = setInterval(loadFlights, 15000);
        } else if (tab === 'rail') {
            document.getElementById('transportMap').style.display = '';
            document.getElementById('guimaraesScheduleBar').style.display = 'none';
            document.getElementById('portoScheduleBar').style.display = 'none';
            document.getElementById('madridBusScheduleBar').style.display = 'none';
            document.getElementById('valenciaBusScheduleBar').style.display = 'none';
            TRANSPORT.map.setView([38.75, -9.15], 11);
            loadRailStations();
            loadMetroLineStatus();
        } else if (tab === 'priceSearch') {
            document.getElementById('transportMap').style.display = 'none';
            document.getElementById('guimaraesScheduleBar').style.display = 'none';
            document.getElementById('portoScheduleBar').style.display = 'none';
            document.getElementById('madridBusScheduleBar').style.display = 'none';
            document.getElementById('valenciaBusScheduleBar').style.display = 'none';
            document.getElementById('transportStatus').textContent = 'Pesquisa preços de comboio/autocarro na Europa por cidade/estação e data (Tictactrip).';
        } else if (tab === 'bikes') {
            document.getElementById('transportMap').style.display = '';
            document.getElementById('guimaraesScheduleBar').style.display = 'none';
            document.getElementById('portoScheduleBar').style.display = 'none';
            document.getElementById('madridBusScheduleBar').style.display = 'none';
            document.getElementById('valenciaBusScheduleBar').style.display = 'none';
            TRANSPORT.map.setView([38.72, -9.14], 13);
            loadBikes();
            TRANSPORT.pollInterval = setInterval(loadBikes, 60000);
        }
    }
    function switchBusCity(city) {
        TRANSPORT.busCity = city;
        document.querySelectorAll('.bus-city-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.city === city));
        if (TRANSPORT.pollInterval) clearInterval(TRANSPORT.pollInterval);
        document.getElementById('guimaraesScheduleBar').style.display = city === 'guimaraes' ? 'flex' : 'none';
        document.getElementById('portoScheduleBar').style.display = city === 'porto' ? 'flex' : 'none';
        document.getElementById('madridBusScheduleBar').style.display = city === 'madrid' ? 'flex' : 'none';
        document.getElementById('valenciaBusScheduleBar').style.display = city === 'valencia' ? 'flex' : 'none';
        if (city === 'guimaraes') {
            document.getElementById('transportMap').style.display = 'none';
            document.getElementById('transportStatus').textContent = 'Horários da GUIMABUS (autocarros de Guimarães) — pesquisa uma paragem acima.';
        } else if (city === 'porto') {
            document.getElementById('transportMap').style.display = 'none';
            document.getElementById('transportStatus').textContent = 'Porto: Metro (horários) e STCP (chegadas em tempo real) — pesquisa uma paragem/estação acima.';
        } else if (city === 'madrid') {
            document.getElementById('transportMap').style.display = 'none';
            document.getElementById('transportStatus').textContent = 'Horários da EMT Madrid (autocarros) — pesquisa uma paragem acima.';
        } else if (city === 'valencia') {
            document.getElementById('transportMap').style.display = 'none';
            document.getElementById('transportStatus').textContent = 'Horários da EMT Valência (autocarros) — pesquisa uma paragem acima.';
        } else {
            document.getElementById('transportMap').style.display = '';
            TRANSPORT.map.setView([38.75, -9.15], 11);
            setTimeout(() => TRANSPORT.map.invalidateSize(), 100);
            loadBuses();
            TRANSPORT.pollInterval = setInterval(loadBuses, 15000);
        }
    }
    const METRO_LINE_EMOJI = { azul: '🔵', amarela: '🟡', vermelha: '🔴', verde: '🟢' };
    async function loadMetroLineStatus() {
        const box = document.getElementById('metroStatusBar');
        box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;">A carregar estado do Metro de Lisboa...</p>';
        try {
            const res = await fetch('/api/metro/status');
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            const lines = data.lines || [];
            if (!lines.length) { box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;">Estado do Metro de Lisboa indisponível.</p>'; return; }
            box.innerHTML = lines.map(l => {
                const emoji = METRO_LINE_EMOJI[(l.name || '').toLowerCase()] || '⚪';
                return `<div><strong>${emoji} ${escapeHtml(l.name || l.id)}:</strong> ${escapeHtml(l.status)}</div>`;
            }).join('');
        } catch (err) {
            box.innerHTML = `<p style="color:var(--text-secondary);font-size:12px;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }

    function loadBuses() {
        document.getElementById('transportStatus').textContent = 'A atualizar autocarros...';
        fetch('/api/transport/buses').then(r => r.json()).then(data => {
            if (!Array.isArray(data)) throw new Error(data.error || 'Erro');
            TRANSPORT.layers.bus.clearLayers();
            data.forEach(v => {
                if (!v.lat || !v.lon) return;
                L.circleMarker([v.lat, v.lon], { radius: 5, color: getAccentHex(), fillColor: getAccentHex(), fillOpacity: 0.9, weight: 1 })
                    .bindPopup(`🚌 Linha <strong>${v.line_id || '?'}</strong><br>Velocidade: ${v.speed != null ? Math.round(v.speed * 3.6) + ' km/h' : '—'}`)
                    .addTo(TRANSPORT.layers.bus);
            });
            document.getElementById('transportStatus').textContent = `${data.length} autocarros da Carris Metropolitana (Área Metropolitana de Lisboa) — atualizado agora`;
        }).catch(err => {
            document.getElementById('transportStatus').textContent = '⚠️ Não foi possível carregar os autocarros: ' + err.message;
        });
    }

    function loadBikes() {
        document.getElementById('transportStatus').textContent = 'A atualizar estações GIRA...';
        fetch('/api/transport/bikes/gira').then(r => r.json()).then(data => {
            if (!data.stations) throw new Error(data.error || 'Erro');
            TRANSPORT.layers.bikes.clearLayers();
            data.stations.forEach(s => {
                const bikesText = s.bikes != null ? `🚲 ${s.bikes} bicicleta(s)` : '🚲 nº de bicicletas indisponível';
                const docksText = s.docks != null ? ` · 🅿️ ${s.docks} doca(s) livre(s)` : '';
                L.circleMarker([s.lat, s.lon], { radius: 6, color: '#2ecc71', fillColor: '#2ecc71', fillOpacity: 0.9, weight: 1 })
                    .bindPopup(`<strong>${escapeHtml(s.name)}</strong><br>${bikesText}${docksText}`)
                    .addTo(TRANSPORT.layers.bikes);
            });
            document.getElementById('transportStatus').textContent = `${data.stations.length} estações GIRA (Lisboa) — dados abertos da EMEL, atualizado agora`;
        }).catch(err => {
            document.getElementById('transportStatus').textContent = '⚠️ Não foi possível carregar as estações GIRA: ' + err.message;
        });
    }

    // Códigos ICAO das companhias mais comuns na Europa — para o filtro de
    // aviões aceitar o nome (ex.: "Ryanair") e não só o código (ex.: "RYR"),
    // já que o callsign de cada voo só tem o código.
    const AIRLINE_NAME_TO_ICAO = {
        'tap': 'TAP', 'tap portugal': 'TAP', 'tap air portugal': 'TAP',
        'ryanair': 'RYR',
        'easyjet': 'EZY', 'easy jet': 'EZY',
        'iberia': 'IBE',
        'vueling': 'VLG',
        'transavia': 'TRA',
        'air france': 'AFR',
        'klm': 'KLM',
        'lufthansa': 'DLH',
        'british airways': 'BAW',
        'swiss': 'SWR', 'swiss international air lines': 'SWR',
        'eurowings': 'EWG',
        'wizz air': 'WZZ', 'wizzair': 'WZZ',
        'aer lingus': 'EIN',
        'sas': 'SAS', 'scandinavian airlines': 'SAS',
        'turkish airlines': 'THY',
        'pegasus': 'PGT', 'pegasus airlines': 'PGT',
        'norwegian': 'NAX', 'norwegian air': 'NAX',
        'ita airways': 'ITY', 'ita': 'ITY',
        'emirates': 'UAE',
        'qatar airways': 'QTR',
        'air europa': 'AEA',
        'azores airlines': 'RZO', 'sata': 'RZO'
    };
    function resolveAirlineFilter(text) {
        const t = text.trim().toLowerCase();
        if (!t) return '';
        if (AIRLINE_NAME_TO_ICAO[t]) return AIRLINE_NAME_TO_ICAO[t];
        return text.trim().toUpperCase();
    }
    function onFlightAirlineFilterChange() {
        if (TRANSPORT.activeTab === 'flight' && TRANSPORT.lastFlightStates) renderFlights(TRANSPORT.lastFlightStates);
    }
    function loadFlights() {
        document.getElementById('transportStatus').textContent = 'A atualizar voos...';
        // Usa a área do mapa que está visível agora — assim funciona em
        // qualquer parte do mundo (não só Ibéria), sem gastar a cota gratuita
        // da OpenSky a pedir o mundo inteiro de cada vez.
        const bounds = TRANSPORT.map.getBounds();
        const params = new URLSearchParams({
            lamin: bounds.getSouth().toFixed(2),
            lomin: bounds.getWest().toFixed(2),
            lamax: bounds.getNorth().toFixed(2),
            lomax: bounds.getEast().toFixed(2)
        });
        fetch('/api/transport/flights?' + params.toString()).then(r => r.json()).then(data => {
            if (data.error) throw new Error(data.error);
            TRANSPORT.lastFlightStates = data.states || [];
            renderFlights(TRANSPORT.lastFlightStates);
        }).catch(err => {
            document.getElementById('transportStatus').textContent = '⚠️ Não foi possível carregar os voos: ' + err.message;
        });
    }
    function renderFlights(states) {
        // Filtro por companhia: o callsign de um voo começa tipicamente pelo
        // código ICAO da companhia (ex.: "TAP123" para a TAP, "RYR456" para a
        // Ryanair) — filtramos aqui no cliente, já que os dados da área toda
        // já vieram no pedido (não gasta mais cota da OpenSky).
        const filterRaw = resolveAirlineFilter(document.getElementById('flightAirlineFilterInput').value || '');
        TRANSPORT.layers.flight.clearLayers();
        let shown = 0;
        states.forEach(s => {
            // formato OpenSky: [icao24, callsign, origin_country, ..., lon(5), lat(6), baro_altitude(7), ..., velocity(9), true_track(10), ...]
            const lon = s[5], lat = s[6], altitude = s[7], velocity = s[9], heading = s[10] || 0, callsign = (s[1] || '').trim();
            if (lat == null || lon == null) return;
            if (filterRaw && !callsign.toUpperCase().startsWith(filterRaw)) return;
            shown++;
            const icon = L.divIcon({ html: `<div style="transform:rotate(${heading}deg);font-size:16px;">✈️</div>`, className: '', iconSize: [20, 20] });
            L.marker([lat, lon], { icon })
                .bindPopup(`✈️ <strong>${escapeHtml(callsign) || 'Desconhecido'}</strong><br>Altitude: ${altitude != null ? Math.round(altitude) + ' m' : '—'}<br>Velocidade: ${velocity != null ? Math.round(velocity * 3.6) + ' km/h' : '—'}`)
                .addTo(TRANSPORT.layers.flight);
        });
        const suffix = filterRaw ? ` filtrados por "${filterRaw}" (de ${states.length} na área)` : ' na área visível do mapa';
        document.getElementById('transportStatus').textContent = `${shown} voos${suffix} (OpenSky Network) — mova/afaste o mapa e toque em 🔄 para atualizar`;
    }

    // ==================== PREÇOS DE COMBOIO/AUTOCARRO NA EUROPA (Tictactrip) ====================
    let tripStopSearchTimers = { origin: null, destination: null };
    function debounceTripStopSearch(field) {
        clearTimeout(tripStopSearchTimers[field]);
        tripStopSearchTimers[field] = setTimeout(() => runTripStopSearch(field), 300);
    }
    async function runTripStopSearch(field) {
        const inputId = field === 'origin' ? 'tripOriginInput' : 'tripDestinationInput';
        const resultsId = field === 'origin' ? 'tripOriginResults' : 'tripDestinationResults';
        const q = document.getElementById(inputId).value.trim();
        const box = document.getElementById(resultsId);
        if (field === 'origin') TRANSPORT.tripOriginCode = null; else TRANSPORT.tripDestinationCode = null;
        if (q.length < 2) { box.innerHTML = ''; return; }
        box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">A procurar...</p>';
        try {
            const res = await fetch('/api/transport/trip-search/stops?q=' + encodeURIComponent(q));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (data.configured === false) {
                box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">⚠️ Pesquisa de preços por configurar (falta TICTACTRIP_API_TOKEN no servidor).</p>';
                return;
            }
            if (!data.results.length) { box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">Nenhuma cidade/estação encontrada.</p>'; return; }
            box.innerHTML = data.results.map(r => `
                <div style="padding:6px 8px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onclick='selectTripStop(${JSON.stringify(field)}, ${JSON.stringify(r.id)}, ${JSON.stringify(r.name + " (" + r.city + ")")})'>
                    ${escapeHtml(r.name)} <span style="color:var(--text-secondary);font-size:12px;">${escapeHtml(r.city)}, ${escapeHtml(r.country)}</span>
                </div>`).join('');
        } catch (err) {
            box.innerHTML = `<p style="color:#e74c3c;font-size:12px;padding:6px 0;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }
    function selectTripStop(field, id, label) {
        const inputId = field === 'origin' ? 'tripOriginInput' : 'tripDestinationInput';
        const resultsId = field === 'origin' ? 'tripOriginResults' : 'tripDestinationResults';
        document.getElementById(inputId).value = label;
        document.getElementById(resultsId).innerHTML = '';
        if (field === 'origin') TRANSPORT.tripOriginCode = id; else TRANSPORT.tripDestinationCode = id;
    }
    const TRIP_TYPE_EMOJI = { train: '🚆', bus: '🚌' };
    async function searchTripOffers() {
        const box = document.getElementById('tripOffersResults');
        const date = document.getElementById('tripDateInput').value;
        const returnDate = document.getElementById('tripReturnDateInput').value;
        if (!TRANSPORT.tripOriginCode || !TRANSPORT.tripDestinationCode) {
            box.innerHTML = '<p style="color:#e74c3c;font-size:13px;padding:6px 0;">Escolhe uma cidade/estação de origem e destino a partir da lista (não basta escrever texto livre).</p>';
            return;
        }
        if (!date) {
            box.innerHTML = '<p style="color:#e74c3c;font-size:13px;padding:6px 0;">Escolhe uma data de partida.</p>';
            return;
        }
        box.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:6px 0;">A pesquisar preços...</p>';
        try {
            const params = new URLSearchParams({ origin: TRANSPORT.tripOriginCode, destination: TRANSPORT.tripDestinationCode, date });
            if (returnDate) params.set('returnDate', returnDate);
            const res = await fetch('/api/transport/trip-search/offers?' + params.toString());
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (data.configured === false) {
                box.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:6px 0;">⚠️ Pesquisa de preços por configurar (falta TICTACTRIP_API_TOKEN no servidor).</p>';
                return;
            }
            if (!data.offers.length) { box.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:6px 0;">Nenhuma viagem encontrada para esta rota/data.</p>'; return; }
            box.innerHTML = data.offers.map(o => {
                const dep = o.departure ? new Date(o.departure) : null;
                const arr = o.arrival ? new Date(o.arrival) : null;
                const fmt = (d) => d ? d.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
                const icon = TRIP_TYPE_EMOJI[o.transportType] || '🚏';
                const dirLabel = returnDate ? (o.direction === 'inbound' ? '⬅️ Volta · ' : '➡️ Ida · ') : '';
                return `<div style="padding:8px;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div>${dirLabel}<strong>${o.priceEur != null ? o.priceEur + ' €' : '—'}</strong> · ${icon} ${escapeHtml(o.providers || '')}</div>
                    <div style="font-size:12px;color:var(--text-secondary);">${fmt(dep)} → ${fmt(arr)} ${o.stops > 0 ? `· ${o.stops} escala(s)` : '· direto'}${o.co2g != null ? ` · 🌱 ${(o.co2g / 1000).toFixed(1)} kg CO₂` : ''}</div>
                </div>`;
            }).join('');
        } catch (err) {
            box.innerHTML = `<p style="color:#e74c3c;font-size:13px;padding:6px 0;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }

    function switchPriceMode(mode) {
        document.querySelectorAll('.price-mode-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
        document.getElementById('tripModeFields').style.display = mode === 'trip' ? 'flex' : 'none';
        document.getElementById('flightModeFields').style.display = mode === 'flight' ? 'flex' : 'none';
        document.getElementById('plannerModeFields').style.display = mode === 'planner' ? 'flex' : 'none';
    }
    // ==================== PLANEADOR DE VIAGENS MULTIMODAL ====================
    function formatPlannerDuration(min) {
        if (min == null) return null;
        const h = Math.floor(min / 60);
        const m = Math.round(min % 60);
        return (h > 0 ? h + 'h ' : '') + m + 'min';
    }
    async function searchTripPlanner() {
        const origin = document.getElementById('plannerOriginInput').value.trim().toUpperCase();
        const destination = document.getElementById('plannerDestinationInput').value.trim().toUpperCase();
        const date = document.getElementById('plannerDateInput').value;
        const box = document.getElementById('plannerResults');
        if (!origin || !destination) { box.innerHTML = '<p style="color:#e74c3c;font-size:13px;padding:6px 0;">Escolhe a origem e o destino.</p>'; return; }
        if (origin === destination) { box.innerHTML = '<p style="color:#e74c3c;font-size:13px;padding:6px 0;">A origem e o destino não podem ser os mesmos.</p>'; return; }
        if (!date) { box.innerHTML = '<p style="color:#e74c3c;font-size:13px;padding:6px 0;">Escolhe uma data.</p>'; return; }
        box.innerHTML = '<p style="font-size:13px;padding:6px 0;">A comparar opções...</p>';
        try {
            const res = await fetch(`/api/transport/planner?origin=${origin}&destination=${destination}&date=${date}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.options.length) {
                box.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:6px 0;">Nenhuma opção disponível para esta rota (verifica se o Ignav/Tictactrip estão configurados, ou tenta outra rota).</p>';
                return;
            }
            const rows = data.options.map((o) => {
                const priceText = o.price != null ? `${o.price} ${o.currency}` : (o.extra?.priceNote || 'Preço não disponível');
                const durationText = formatPlannerDuration(o.durationMin) || '—';
                const stopsText = o.stops != null ? (o.stops === 0 ? 'direto' : `${o.stops} escala(s)`) : '—';
                const co2Text = `${o.co2Estimated ? '~' : ''}${o.co2Kg} kg CO₂${o.co2Estimated ? ' (estimativa)' : ''}`;
                const recommended = data.recommendation && data.recommendation.mode === o.mode;
                return `<div style="padding:8px;margin-bottom:6px;border-radius:8px;background:var(--bg-secondary);${recommended ? 'border:2px solid #2ecc71;' : ''}">
                    <div style="font-weight:600;">${escapeHtml(o.label)} ${recommended ? '🏆' : ''}</div>
                    <div style="font-size:12px;color:var(--text-secondary);">💰 ${escapeHtml(priceText)} · ⏱️ ${escapeHtml(durationText)} · 🔀 ${escapeHtml(stopsText)}</div>
                    <div style="font-size:12px;color:var(--text-secondary);">🌱 ${escapeHtml(co2Text)}${o.extra?.airline ? ' · ' + escapeHtml(o.extra.airline) : ''}${o.extra?.providers ? ' · ' + escapeHtml(o.extra.providers) : ''}</div>
                    ${o.extra?.routeName ? `<div style="font-size:12px;color:var(--text-secondary);">🚄 ${escapeHtml(o.extra.routeName)}${o.extra.departure ? ' · ' + escapeHtml(o.extra.departure) + ' → ' + escapeHtml(o.extra.arrival) : ''}</div>` : ''}
                </div>`;
            }).join('');
            const distanceLine = `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;">📏 ~${data.distanceKm} km em linha reta</div>`;
            const recBanner = data.recommendation ? `<div style="font-size:12px;padding:6px 8px;background:rgba(46,204,113,0.15);border-radius:6px;margin-bottom:6px;">🏆 Recomendação: <strong>${escapeHtml(data.recommendation.label)}</strong>${data.recommendation.tip ? `<div style="margin-top:2px;">💡 ${escapeHtml(data.recommendation.tip)}</div>` : ''}</div>` : '';
            box.innerHTML = distanceLine + recBanner + rows;
        } catch (err) {
            box.innerHTML = `<p style="color:#e74c3c;font-size:13px;padding:6px 0;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }
    function switchFlightSubTab(sub) {
        document.querySelectorAll('.flight-sub-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.sub === sub));
        document.getElementById('flightSearchSection').style.display = sub === 'search' ? 'flex' : 'none';
        document.getElementById('flightAlertsSection').style.display = sub === 'alerts' ? 'flex' : 'none';
        document.getElementById('flightStatsSection').style.display = sub === 'stats' ? 'flex' : 'none';
        if (sub === 'alerts') loadPriceAlerts();
        if (sub === 'stats') loadFlightStats();
    }

    // ==================== PREÇOS DE VOOS (Ignav) ====================
    // A Amadeus (GDS oficial) fechou o self-service em 2026; a Ignav é uma
    // alternativa self-serve real, que só devolve preços + um link de reserva
    // para a própria companhia/OTA — nunca processa pagamento nenhum aqui.
    function renderIgnavLeg(leg, label) {
        if (!leg) return '';
        const dep = leg.departure ? new Date(leg.departure) : null;
        const arr = leg.arrival ? new Date(leg.arrival) : null;
        const fmt = (d) => d ? d.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
        return `<div style="font-size:12px;color:var(--text-secondary);">${label} ✈️ ${escapeHtml(leg.airline || '')} · ${fmt(dep)} → ${fmt(arr)} ${leg.stops > 0 ? `· ${leg.stops} escala(s)` : '· direto'}</div>`;
    }
    async function searchFlightPriceOffers() {
        const box = document.getElementById('fpResults');
        const origin = document.getElementById('fpOriginInput').value.trim().toUpperCase();
        const destination = document.getElementById('fpDestinationInput').value.trim().toUpperCase();
        const date = document.getElementById('fpDateInput').value;
        const returnDate = document.getElementById('fpReturnDateInput').value;
        if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) {
            box.innerHTML = '<p style="color:#e74c3c;font-size:13px;padding:6px 0;">Indica os códigos IATA de origem e destino (3 letras, ex.: LIS, OPO, MAD).</p>';
            return;
        }
        if (!date) {
            box.innerHTML = '<p style="color:#e74c3c;font-size:13px;padding:6px 0;">Escolhe uma data de partida.</p>';
            return;
        }
        if (returnDate && returnDate < date) {
            box.innerHTML = '<p style="color:#e74c3c;font-size:13px;padding:6px 0;">A data de volta não pode ser antes da data de ida.</p>';
            return;
        }
        box.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:6px 0;">A pesquisar voos...</p>';
        try {
            const params = new URLSearchParams({ origin, destination, date, token: APP.token || '' });
            if (returnDate) params.set('returnDate', returnDate);
            const res = await fetch('/api/transport/flight-price/offers?' + params.toString());
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (data.configured === false) {
                box.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:6px 0;">⚠️ Pesquisa de voos por configurar (falta IGNAV_API_KEY no servidor).</p>';
                return;
            }
            if (!data.offers.length) { box.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:6px 0;">Nenhum voo encontrado para esta rota/data.</p>'; return; }
            box.innerHTML = data.offers.map((o) => {
                return `<div style="padding:8px;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div><strong>${o.price != null ? o.price + ' ' + escapeHtml(o.currency || '') : '—'}</strong>${returnDate ? ' (ida e volta)' : ''}</div>
                    ${renderIgnavLeg(o.outbound, '➡️ Ida:')}
                    ${renderIgnavLeg(o.inbound, '⬅️ Volta:')}
                    <button class="btn-small" style="margin-top:4px;" onclick='openFlightBookingLink(${JSON.stringify(o.ignavId)}, this)'>🔗 Ver opções de reserva</button>
                </div>`;
            }).join('');
        } catch (err) {
            box.innerHTML = `<p style="color:#e74c3c;font-size:13px;padding:6px 0;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }
    async function searchFlightDeals() {
        const box = document.getElementById('fpResults');
        const origin = document.getElementById('fpOriginInput').value.trim().toUpperCase();
        const date = document.getElementById('fpDateInput').value;
        if (!/^[A-Z]{3}$/.test(origin)) {
            box.innerHTML = '<p style="color:#e74c3c;font-size:13px;padding:6px 0;">Indica o código IATA de origem (3 letras, ex.: LIS).</p>';
            return;
        }
        if (!date) {
            box.innerHTML = '<p style="color:#e74c3c;font-size:13px;padding:6px 0;">Escolhe uma data de partida.</p>';
            return;
        }
        box.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:6px 0;">A pesquisar voos baratos pela Europa e São Tomé (~16 pedidos)...</p>';
        try {
            const params = new URLSearchParams({ origin, date });
            const res = await fetch('/api/transport/flight-price/deals?' + params.toString());
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (data.configured === false) {
                box.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:6px 0;">⚠️ Pesquisa de voos por configurar (falta IGNAV_API_KEY no servidor).</p>';
                return;
            }
            if (!data.deals.length) { box.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:6px 0;">Não encontrei voos para nenhum destino nesta data.</p>'; return; }
            box.innerHTML = data.deals.map(d => {
                const dep = d.departure ? new Date(d.departure) : null;
                const fmt = (dt) => dt ? dt.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
                return `<div style="padding:8px;border-bottom:1px solid rgba(255,255,255,0.08);cursor:pointer;" onclick='selectFlightDeal(${JSON.stringify(d.destinationCode)})'>
                    <div><strong>${escapeHtml(d.destinationName)}</strong> (${escapeHtml(d.destinationCode)}) · <strong>${d.price != null ? d.price + ' ' + escapeHtml(d.currency || '') : '—'}</strong></div>
                    <div style="font-size:12px;color:var(--text-secondary);">✈️ ${escapeHtml(d.airline || '')} · ${fmt(dep)} ${d.stops > 0 ? `· ${d.stops} escala(s)` : '· direto'}</div>
                </div>`;
            }).join('');
        } catch (err) {
            box.innerHTML = `<p style="color:#e74c3c;font-size:13px;padding:6px 0;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }
    function selectFlightDeal(destinationCode) {
        document.getElementById('fpDestinationInput').value = destinationCode;
        searchFlightPriceOffers();
    }
    async function openFlightBookingLink(ignavId, btn) {
        btn.disabled = true;
        btn.textContent = 'A obter link...';
        try {
            const res = await fetch('/api/transport/flight-price/booking-link?ignavId=' + encodeURIComponent(ignavId));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.url) throw new Error('Sem link de reserva disponível para este voo.');
            window.open(data.url, '_blank', 'noopener');
        } catch (err) {
            alert('⚠️ ' + err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = '🔗 Ver opções de reserva';
        }
    }

    async function createPriceAlert() {
        const origin = document.getElementById('fpOriginInput').value.trim().toUpperCase();
        const destination = document.getElementById('fpDestinationInput').value.trim().toUpperCase();
        const date = document.getElementById('fpDateInput').value;
        const maxPrice = document.getElementById('fpAlertMaxPriceInput').value;
        if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || !date || !maxPrice) {
            alert('Preenche origem, destino, data e preço-alvo antes de criar o alerta.');
            return;
        }
        try {
            const res = await fetch('/api/price-alerts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: APP.token, origin, destination, date, maxPrice })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            document.getElementById('fpAlertMaxPriceInput').value = '';
            loadPriceAlerts();
        } catch (err) {
            alert('⚠️ ' + err.message);
        }
    }
    async function loadPriceAlerts() {
        const list = document.getElementById('fpAlertsList');
        try {
            const res = await fetch('/api/price-alerts?token=' + encodeURIComponent(APP.token));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.alerts.length) { list.innerHTML = ''; return; }
            list.innerHTML = '<div style="color:var(--text-secondary);padding:4px 0;">🔔 Os teus alertas:</div>' + data.alerts.map(a => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <span>${escapeHtml(a.origin)} → ${escapeHtml(a.destination)} · ${escapeHtml(a.date)} · abaixo de ${a.maxPrice} €</span>
                    <button class="btn-small" onclick='deletePriceAlert(${JSON.stringify(a.id)})'>🗑️</button>
                </div>`).join('');
        } catch (err) {
            list.innerHTML = '';
        }
    }
    async function deletePriceAlert(id) {
        try {
            await fetch('/api/price-alerts/' + encodeURIComponent(id) + '?token=' + encodeURIComponent(APP.token), { method: 'DELETE' });
            loadPriceAlerts();
        } catch (err) { /* silencioso — a lista só não atualiza já */ }
    }

    async function loadFlightStats() {
        const box = document.getElementById('fpStatsBox');
        box.innerHTML = '<p style="color:var(--text-secondary);padding:4px 0;">A carregar...</p>';
        try {
            const res = await fetch('/api/travel-stats?token=' + encodeURIComponent(APP.token));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.totalSearches) { box.innerHTML = '<p style="color:var(--text-secondary);padding:4px 0;">Ainda não pesquisaste nenhum voo.</p>'; return; }
            const cheapest = data.cheapestFound;
            box.innerHTML = `
                <div style="padding:4px 0;">🔎 Total de pesquisas: <strong>${data.totalSearches}</strong></div>
                ${cheapest ? `<div style="padding:4px 0;">💰 Preço mais baixo encontrado: <strong>${cheapest.origin} → ${cheapest.destination}</strong> a ${cheapest.cheapestPrice} ${escapeHtml(cheapest.currency || '')}</div>` : ''}
                ${data.mostSearchedRoute ? `<div style="padding:4px 0;">⭐ Rota mais pesquisada: <strong>${escapeHtml(data.mostSearchedRoute.route)}</strong> (${data.mostSearchedRoute.count}x)</div>` : ''}
                ${data.totalDistanceKm > 0 ? `<div style="padding:4px 0;">📏 Distância pesquisada: <strong>~${data.totalDistanceKm} km</strong> (${data.earthCircumferencePercent}% da volta ao mundo)</div>` : ''}
                ${data.totalCo2Kg > 0 ? `<div style="padding:4px 0;">🌱 CO₂ estimado dos voos pesquisados: <strong>~${data.totalCo2Kg} kg</strong></div>` : ''}
                <div style="padding-top:6px;font-size:11px;color:var(--text-secondary);">Baseado nas tuas pesquisas de voos (Ignav) — não sabemos quais viagens fizeste mesmo. Distância/CO₂ só contam pesquisas feitas a partir de agora.</div>
            `;
        } catch (err) {
            box.innerHTML = `<p style="color:#e74c3c;padding:4px 0;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }

    // ==================== COMANDO POR VOZ (Web Speech API) ====================
    // Reconhecimento de voz nativo do browser (sem chave, sem custos, mas só
    // funciona em browsers com suporte — ex.: Chrome/Edge; não no Firefox).
    const CITY_NAME_TO_IATA = {
        'lisboa': 'LIS', 'lisbon': 'LIS',
        'porto': 'OPO',
        'faro': 'FAO',
        'valência': 'VLC', 'valencia': 'VLC',
        'madrid': 'MAD',
        'barcelona': 'BCN',
        'londres': 'LHR', 'london': 'LHR',
        'paris': 'CDG',
        'roma': 'FCO', 'rome': 'FCO',
        'milão': 'MXP', 'milao': 'MXP', 'milan': 'MXP',
        'amesterdão': 'AMS', 'amesterdao': 'AMS', 'amsterdam': 'AMS',
        'bruxelas': 'BRU', 'brussels': 'BRU',
        'berlim': 'BER', 'berlin': 'BER',
        'munique': 'MUC', 'munich': 'MUC',
        'zurique': 'ZRH', 'zurich': 'ZRH',
        'viena': 'VIE', 'vienna': 'VIE',
        'atenas': 'ATH', 'athens': 'ATH',
        'dublin': 'DUB',
        'são tomé': 'TMS', 'sao tome': 'TMS'
    };
    function findCityInText(text) {
        const t = text.toLowerCase();
        for (const [name, code] of Object.entries(CITY_NAME_TO_IATA)) {
            if (t.includes(name)) return { code, name: name.charAt(0).toUpperCase() + name.slice(1) };
        }
        return null;
    }
    function parseDateFromText(text) {
        const t = text.toLowerCase();
        const now = new Date();
        const fmt = (d) => d.toISOString().slice(0, 10);
        if (t.includes('depois de amanhã') || t.includes('depois de amanha')) {
            const d = new Date(now); d.setDate(d.getDate() + 2); return fmt(d);
        }
        if (t.includes('amanhã') || t.includes('amanha')) {
            const d = new Date(now); d.setDate(d.getDate() + 1); return fmt(d);
        }
        if (t.includes('hoje')) return fmt(now);
        const weekdayIndex = { domingo: 0, segunda: 1, 'terça': 2, terca: 2, quarta: 3, quinta: 4, sexta: 5, 'sábado': 6, sabado: 6 };
        for (const [wd, target] of Object.entries(weekdayIndex)) {
            if (t.includes(wd)) {
                const d = new Date(now);
                let diff = (target - d.getDay() + 7) % 7;
                if (diff === 0) diff = 7; // "próxima X" é a seguir, não hoje
                d.setDate(d.getDate() + diff);
                return fmt(d);
            }
        }
        const dayMatch = t.match(/dia\s+(\d{1,2})/);
        if (dayMatch) {
            const day = parseInt(dayMatch[1], 10);
            let d = new Date(now.getFullYear(), now.getMonth(), day);
            if (d < now) d = new Date(now.getFullYear(), now.getMonth() + 1, day);
            return fmt(d);
        }
        return null;
    }
    function applyVoiceCommand(transcript) {
        const statusEl = document.getElementById('fpVoiceStatus');
        statusEl.textContent = `Ouvi: "${transcript}"`;
        const city = findCityInText(transcript);
        const date = parseDateFromText(transcript);
        if (!city) { statusEl.textContent += ' — não percebi o destino, escolhe manualmente.'; return; }
        if (!document.getElementById('fpOriginInput').value.trim()) document.getElementById('fpOriginInput').value = 'LIS';
        document.getElementById('fpDestinationInput').value = city.code;
        if (date) document.getElementById('fpDateInput').value = date;
        statusEl.textContent += ` → ${city.name} (${city.code})${date ? ', ' + date : ''}. A pesquisar...`;
        searchFlightPriceOffers();
    }
    function startVoiceFlightCommand() {
        const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
        const statusEl = document.getElementById('fpVoiceStatus');
        if (!SpeechRecognitionCtor) { statusEl.textContent = '⚠️ O teu browser não suporta comandos por voz.'; return; }
        const recognition = new SpeechRecognitionCtor();
        recognition.lang = 'pt-PT';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        statusEl.textContent = '🎤 A ouvir...';
        recognition.onresult = (event) => applyVoiceCommand(event.results[0][0].transcript);
        recognition.onerror = (event) => { statusEl.textContent = '⚠️ Erro no reconhecimento de voz: ' + event.error; };
        recognition.start();
    }

    function loadRailStations() {
        document.getElementById('transportStatus').textContent = 'A carregar estações...';
        Promise.all([
            fetch('/api/transport/metro-stations').then(r => r.json()).catch(() => []),
            fetch('/api/transport/train-stations').then(r => r.json()).catch(() => [])
        ]).then(([metro, train]) => {
            TRANSPORT.layers.rail.clearLayers();
            (Array.isArray(metro) ? metro : []).forEach(s => {
                L.circleMarker([s.lat, s.lon], { radius: 6, color: '#6c5ce7', fillColor: '#6c5ce7', fillOpacity: 0.9, weight: 1 })
                    .bindPopup(`🚇 <strong>${s.name}</strong> (Metro de Lisboa)`)
                    .addTo(TRANSPORT.layers.rail);
            });
            (Array.isArray(train) ? train : []).forEach(s => {
                L.circleMarker([s.lat, s.lon], { radius: 6, color: '#e17055', fillColor: '#e17055', fillOpacity: 0.9, weight: 1 })
                    .bindPopup(`🚆 <strong>${s.name}</strong> (Estação de comboio)`)
                    .addTo(TRANSPORT.layers.rail);
            });
            document.getElementById('transportStatus').textContent = `Estações de metro e comboio (localização) · Sem posição ao vivo dos comboios — ver cp.pt / metrolisboa.pt`;
        });
    }

    // ==================== COMBOIOS DA CP EM TRÂNSITO (posição ESTIMADA pelo horário) ====================
    // A CP não publica posição ao vivo (ver acima). Isto NÃO é GPS real — é uma
    // estimativa por interpolação entre as duas paragens do horário GTFS que
    // envolvem a hora atual, assumindo que a viagem decorre exatamente conforme
    // planeado (sem atrasos). Por isso o popup de cada comboio deixa isso bem claro.
    let railEstimatedInterval = null;
    let railEstimatedTrainsCache = [];
    let railSelectedTripId = null;
    function toggleEstimatedTrainPositions() {
        const on = document.getElementById('railEstimatedToggle').checked;
        if (railEstimatedInterval) { clearInterval(railEstimatedInterval); railEstimatedInterval = null; }
        TRANSPORT.layers.trainsEstimated.clearLayers();
        railSelectedTripId = null;
        document.getElementById('railTrainDetail').style.display = 'none';
        if (on) {
            TRANSPORT.layers.trainsEstimated.addTo(TRANSPORT.map);
            loadEstimatedTrainPositions();
            railEstimatedInterval = setInterval(loadEstimatedTrainPositions, 30000);
        } else {
            TRANSPORT.map.removeLayer(TRANSPORT.layers.trainsEstimated);
            document.getElementById('railEstimatedStatus').textContent = '';
        }
    }
    function selectEstimatedTrain(tripId) {
        railSelectedTripId = tripId;
        renderEstimatedTrainMarkers();
        renderRailTrainDetail();
    }
    function deselectEstimatedTrain() {
        railSelectedTripId = null;
        document.getElementById('railTrainDetail').style.display = 'none';
        renderEstimatedTrainMarkers();
    }
    // Só desenha a linha da rota + marcadores por paragem do comboio SELECIONADO
    // (clicar num 🚂) — com vários comboios em trânsito ao mesmo tempo, mostrar
    // a rota de todos de uma vez ficava confuso no mapa.
    function renderEstimatedTrainMarkers() {
        TRANSPORT.layers.trainsEstimated.clearLayers();
        railEstimatedTrainsCache.forEach(t => {
            const statusText = t.dwelling ? `Parado em ${escapeHtml(t.fromStop)}` : `Entre ${escapeHtml(t.fromStop)} e ${escapeHtml(t.toStop)} (chega em ~${t.etaMin} min)`;
            if (t.tripId === railSelectedTripId && t.routeStops && t.routeStops.length > 1) {
                L.polyline(t.routeStops.map(s => [s.lat, s.lon]), { color: '#f39c12', weight: 2, opacity: 0.6, dashArray: '4,6' })
                    .addTo(TRANSPORT.layers.trainsEstimated);
                t.routeStops.forEach((s, i) => {
                    const isOrigem = i === 0;
                    const isDestino = i === t.routeStops.length - 1;
                    const cor = isOrigem ? '#27ae60' : (isDestino ? '#e74c3c' : '#f39c12');
                    const papel = isOrigem ? '🟢 Origem' : (isDestino ? '🔴 Destino' : '🔸 Paragem');
                    const hora = isOrigem ? s.departure : (isDestino ? s.arrival : (s.arrival || s.departure));
                    L.circleMarker([s.lat, s.lon], { radius: isOrigem || isDestino ? 5 : 3, color: cor, fillColor: cor, fillOpacity: 0.85, weight: 1 })
                        .bindPopup(`<strong>${escapeHtml(s.name)}</strong><br>${papel}${hora ? ' · ' + escapeHtml(hora.slice(0, 5)) : ''}`)
                        .addTo(TRANSPORT.layers.trainsEstimated);
                });
                // Margem de incerteza: não há forma honesta de saber o atraso real, por
                // isso, em vez de um ponto exato, mostramos também onde o comboio podia
                // estar se estivesse atrasado até t.uncertaintyMin minutos — sempre mais
                // atrás na rota (nunca à frente do horário). Só desenhada se for
                // suficientemente diferente do ponto "a horas", para não poluir o mapa
                // quando a diferença é insignificante (ex.: viagem mesmo a começar).
                if (typeof t.uncertainLat === 'number' && haversineMeters(t.lat, t.lon, t.uncertainLat, t.uncertainLon) > 30) {
                    L.polyline([[t.lat, t.lon], [t.uncertainLat, t.uncertainLon]], { color: '#e74c3c', weight: 5, opacity: 0.3 })
                        .bindPopup(`⚠️ Margem de incerteza: se houver atraso (não é possível saber quanto), o comboio pode ainda estar algures neste troço — até ${t.uncertaintyMin} min mais atrás do que o ponto "a horas".`)
                        .addTo(TRANSPORT.layers.trainsEstimated);
                }
            }
            const icon = L.divIcon({ className: '', html: '<div style="font-size:20px;filter:drop-shadow(0 0 3px rgba(0,0,0,0.6));">🚂</div>', iconSize: [20, 20], iconAnchor: [10, 10] });
            L.marker([t.lat, t.lon], { icon })
                .bindPopup(`🚆 <strong>${escapeHtml(t.routeName || 'Comboio')}</strong>${t.operator ? ' (' + escapeHtml(t.operator) + ')' : ''}${t.headsign ? ' → ' + escapeHtml(t.headsign) : ''}<br>${statusText}<br><em style="font-size:11px;">📍 Posição estimada pelo horário — não é GPS ao vivo, pode não corresponder à posição real em caso de atraso.</em><br><a href="#" onclick="selectEstimatedTrain('${t.tripId}');return false;">🔎 Ver detalhes deste comboio</a>`)
                .addTo(TRANSPORT.layers.trainsEstimated);
        });
    }
    function renderRailTrainDetail() {
        const box = document.getElementById('railTrainDetail');
        const t = railEstimatedTrainsCache.find(x => x.tripId === railSelectedTripId);
        if (!t) { box.style.display = 'none'; return; }
        box.style.display = 'flex';
        document.getElementById('railTrainDetailTitle').textContent = `🚆 ${t.routeName || 'Comboio'}${t.operator ? ' (' + t.operator + ')' : ''}${t.headsign ? ' → ' + t.headsign : ''}`;
        const margem = typeof t.uncertaintyMin === 'number' ? ` · pode estar até ${t.uncertaintyMin} min mais atrás se houver atraso (linha vermelha no mapa)` : '';
        document.getElementById('railTrainDetailStatus').textContent = (t.dwelling
            ? `Parado em ${t.fromStop}`
            : `Entre ${t.fromStop} e ${t.toStop} (chega em ~${t.etaMin} min) — estimado, não é GPS ao vivo`) + margem;
        const stops = t.routeStops || [];
        // A paragem "atual" é a de onde o comboio já partiu (fromStop) — tudo antes
        // dela já passou, tudo a partir da próxima ainda está para vir.
        const fromIndex = stops.findIndex(s => s.name === t.fromStop);
        document.getElementById('railTrainDetailStops').innerHTML = stops.map((s, i) => {
            const hora = i === 0 ? s.departure : (i === stops.length - 1 ? s.arrival : (s.arrival || s.departure));
            const passou = fromIndex >= 0 && i < fromIndex;
            const atual = i === fromIndex;
            const estilo = passou ? 'color:var(--text-secondary);text-decoration:line-through;' : (atual ? 'font-weight:600;' : '');
            const marca = atual ? '🚂 ' : (passou ? '✅ ' : '');
            return `<div style="${estilo}">${marca}${escapeHtml(s.name)}${hora ? ' · ' + escapeHtml(hora.slice(0, 5)) : ''}</div>`;
        }).join('');
    }
    function loadEstimatedTrainPositions() {
        fetch('/api/trains/positions-estimated').then(r => r.json()).then(data => {
            railEstimatedTrainsCache = data.trains || [];
            if (railSelectedTripId && !railEstimatedTrainsCache.some(t => t.tripId === railSelectedTripId)) {
                // O comboio selecionado já não está em trânsito (chegou ao destino) — fecha os detalhes.
                deselectEstimatedTrain();
            }
            renderEstimatedTrainMarkers();
            renderRailTrainDetail();
            document.getElementById('railEstimatedStatus').textContent = railEstimatedTrainsCache.length
                ? `${railEstimatedTrainsCache.length} comboio(s) em trânsito (estimado) — atualizado agora`
                : 'Nenhum comboio em trânsito agora (fora do horário de serviço).';
        }).catch(err => {
            document.getElementById('railEstimatedStatus').textContent = '⚠️ Não foi possível calcular as posições estimadas: ' + err.message;
        });
    }

    // ==================== HORÁRIOS DO METRO DE LISBOA (via GTFS) ====================
    let metroLisboaSearchTimer = null;
    function debounceMetroLisboaStationSearch() {
        clearTimeout(metroLisboaSearchTimer);
        metroLisboaSearchTimer = setTimeout(runMetroLisboaStationSearch, 300);
    }
    async function runMetroLisboaStationSearch() {
        const q = document.getElementById('metroLisboaSearchInput').value.trim();
        const box = document.getElementById('metroLisboaSearchResults');
        if (!q) { box.innerHTML = ''; return; }
        box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">A procurar...</p>';
        try {
            const res = await fetch('/api/transport/metro-lisboa/stops?q=' + encodeURIComponent(q));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.length) { box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">Nenhuma estação encontrada.</p>'; return; }
            box.innerHTML = data.map(s => `
                <div style="padding:6px 4px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onclick='openMetroLisboaDeparturesModal(${JSON.stringify(s.id)}, ${JSON.stringify(s.name)})'>
                    🚇 ${escapeHtml(s.name)}
                </div>`).join('');
        } catch (err) {
            box.innerHTML = `<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }
    async function openMetroLisboaDeparturesModal(stationId, stationName) {
        document.getElementById('metroLisboaDeparturesTitle').textContent = `🚇 Próximas partidas — ${stationName}`;
        const list = document.getElementById('metroLisboaDeparturesList');
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">A carregar...</p>';
        document.getElementById('modalMetroLisboaDepartures').classList.add('active');
        try {
            const res = await fetch('/api/transport/metro-lisboa/departures?stationId=' + encodeURIComponent(stationId));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.departures.length) { list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">Sem mais partidas hoje.</p>'; return; }
            list.innerHTML = data.departures.map(d => `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div><strong>${escapeHtml((d.time || '').slice(0, 5))}</strong>${d.routeName ? ' · ' + escapeHtml(d.routeName) : ''}</div>
                    <div style="color:var(--text-secondary);font-size:12px;text-align:right;">${escapeHtml(d.headsign || '')}</div>
                </div>`).join('');
        } catch (err) {
            list.innerHTML = `<p style="color:var(--text-secondary);text-align:center;padding:20px;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }

    // ==================== HORÁRIOS DE COMBOIO (CP, via GTFS) ====================
    // Separado dos marcadores do mapa acima (que só mostram localização, e só da área
    // de Lisboa) — isto pesquisa por nome em TODAS as estações da CP a nível nacional
    // e mostra as próximas partidas reais, com base nos horários abertos da CP
    // (ver README para a limitação de já não haver posição ao vivo, só horário previsto).
    let railSearchTimer = null;
    function debounceRailStationSearch() {
        clearTimeout(railSearchTimer);
        railSearchTimer = setTimeout(runRailStationSearch, 300);
    }
    async function runRailStationSearch() {
        const q = document.getElementById('railSearchInput').value.trim();
        const box = document.getElementById('railSearchResults');
        if (!q) { box.innerHTML = ''; return; }
        box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">A procurar...</p>';
        try {
            const res = await fetch('/api/trains/stations?q=' + encodeURIComponent(q));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.length) { box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">Nenhuma estação encontrada.</p>'; return; }
            box.innerHTML = data.map(s => `
                <div style="padding:6px 4px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onclick='openTrainDeparturesModal(${JSON.stringify(s.id)}, ${JSON.stringify(s.name)}, ${JSON.stringify(s.type || "cp")})'>
                    🚆 ${escapeHtml(s.name)}${s.operatorName ? ` <span style="color:var(--text-secondary);font-size:11px;">(${escapeHtml(s.operatorName)})</span>` : ''}
                </div>`).join('');
        } catch (err) {
            box.innerHTML = `<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }
    async function openTrainDeparturesModal(stationId, stationName, type) {
        document.getElementById('trainDeparturesTitle').textContent = `🚆 Próximas partidas — ${stationName}`;
        const list = document.getElementById('trainDeparturesList');
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">A carregar...</p>';
        document.getElementById('modalTrainDepartures').classList.add('active');
        try {
            const res = await fetch('/api/trains/departures?stationId=' + encodeURIComponent(stationId) + '&type=' + encodeURIComponent(type || 'cp'));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.departures.length) { list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">Sem mais partidas hoje.</p>'; return; }
            list.innerHTML = data.departures.map(d => `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div><strong>${escapeHtml((d.time || '').slice(0, 5))}</strong>${d.routeName ? ' · ' + escapeHtml(d.routeName) : ''}</div>
                    <div style="color:var(--text-secondary);font-size:12px;text-align:right;">${escapeHtml(d.headsign || '')}</div>
                </div>`).join('');
        } catch (err) {
            list.innerHTML = `<p style="color:var(--text-secondary);text-align:center;padding:20px;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }

    // ==================== HORÁRIOS DE AUTOCARRO (GUIMABUS, via GTFS) ====================
    let guimaraesSearchTimer = null;
    function debounceGuimaraesStopSearch() {
        clearTimeout(guimaraesSearchTimer);
        guimaraesSearchTimer = setTimeout(runGuimaraesStopSearch, 300);
    }
    async function runGuimaraesStopSearch() {
        const q = document.getElementById('guimaraesSearchInput').value.trim();
        const box = document.getElementById('guimaraesSearchResults');
        if (!q) { box.innerHTML = ''; return; }
        box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">A procurar...</p>';
        try {
            const res = await fetch('/api/transport/guimaraes/stops?q=' + encodeURIComponent(q));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.length) { box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">Nenhuma paragem encontrada.</p>'; return; }
            box.innerHTML = data.map(s => `
                <div style="padding:6px 4px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onclick='openGuimaraesDeparturesModal(${JSON.stringify(s.id)}, ${JSON.stringify(s.name)})'>
                    🚌 ${escapeHtml(s.name)}
                </div>`).join('');
        } catch (err) {
            box.innerHTML = `<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }
    async function openGuimaraesDeparturesModal(stopId, stopName) {
        document.getElementById('guimaraesDeparturesTitle').textContent = `🚌 Próximas partidas — ${stopName}`;
        const list = document.getElementById('guimaraesDeparturesList');
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">A carregar...</p>';
        document.getElementById('modalGuimaraesDepartures').classList.add('active');
        try {
            const res = await fetch('/api/transport/guimaraes/departures?stationId=' + encodeURIComponent(stopId));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.departures.length) { list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">Sem mais partidas hoje.</p>'; return; }
            list.innerHTML = data.departures.map(d => `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div><strong>${escapeHtml((d.time || '').slice(0, 5))}</strong>${d.routeName ? ' · ' + escapeHtml(d.routeName) : ''}</div>
                    <div style="color:var(--text-secondary);font-size:12px;text-align:right;">${escapeHtml(d.headsign || '')}</div>
                </div>`).join('');
        } catch (err) {
            list.innerHTML = `<p style="color:var(--text-secondary);text-align:center;padding:20px;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }

    // ==================== MADRID (EMT — autocarros, via GTFS da CRTM) ====================
    let madridBusSearchTimer = null;
    function debounceMadridBusStopSearch() {
        clearTimeout(madridBusSearchTimer);
        madridBusSearchTimer = setTimeout(runMadridBusStopSearch, 300);
    }
    async function runMadridBusStopSearch() {
        const q = document.getElementById('madridBusSearchInput').value.trim();
        const box = document.getElementById('madridBusSearchResults');
        if (!q) { box.innerHTML = ''; return; }
        box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">A procurar...</p>';
        try {
            const res = await fetch('/api/transport/madrid/bus-stops?q=' + encodeURIComponent(q));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.length) { box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">Nenhuma paragem encontrada.</p>'; return; }
            box.innerHTML = data.map(s => `
                <div style="padding:6px 4px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onclick='openMadridBusDeparturesModal(${JSON.stringify(s.id)}, ${JSON.stringify(s.name)})'>
                    🚌 ${escapeHtml(s.name)}
                </div>`).join('');
        } catch (err) {
            box.innerHTML = `<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }
    // Reaproveita o mesmo modal genérico de "próximas partidas" já usado para Guimarães
    // (só título e lista, sem nada específico de Guimarães).
    async function openMadridBusDeparturesModal(stopId, stopName) {
        document.getElementById('guimaraesDeparturesTitle').textContent = `🚌 Próximas partidas — ${stopName}`;
        const list = document.getElementById('guimaraesDeparturesList');
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">A carregar...</p>';
        document.getElementById('modalGuimaraesDepartures').classList.add('active');
        try {
            const res = await fetch('/api/transport/madrid/bus-departures?stationId=' + encodeURIComponent(stopId));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.departures.length) { list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">Sem mais partidas hoje.</p>'; return; }
            list.innerHTML = data.departures.map(d => `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div><strong>${escapeHtml((d.time || '').slice(0, 5))}</strong>${d.routeName ? ' · ' + escapeHtml(d.routeName) : ''}</div>
                    <div style="color:var(--text-secondary);font-size:12px;text-align:right;">${escapeHtml(d.headsign || '')}</div>
                </div>`).join('');
        } catch (err) {
            list.innerHTML = `<p style="color:var(--text-secondary);text-align:center;padding:20px;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }

    // ==================== MADRID (Metro/Cercanías/Metro Ligero, via GTFS da CRTM) ====================
    function switchRailCountry(country) {
        document.querySelectorAll('.rail-country-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.country === country));
        document.getElementById('railPortugalContent').style.display = country === 'pt' ? 'flex' : 'none';
        document.getElementById('railMadridContent').style.display = country === 'madrid' ? 'flex' : 'none';
        document.getElementById('railValenciaContent').style.display = country === 'valencia' ? 'flex' : 'none';
        document.getElementById('railRenfeContent').style.display = country === 'renfe' ? 'flex' : 'none';
        document.getElementById('railFranceContent').style.display = country === 'france' ? 'flex' : 'none';
    }
    let railMadridSearchTimer = null;
    function debounceMadridRailStationSearch() {
        clearTimeout(railMadridSearchTimer);
        railMadridSearchTimer = setTimeout(runMadridRailStationSearch, 300);
    }
    async function runMadridRailStationSearch() {
        const q = document.getElementById('railMadridSearchInput').value.trim();
        const box = document.getElementById('railMadridSearchResults');
        if (!q) { box.innerHTML = ''; return; }
        box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">A procurar...</p>';
        try {
            const res = await fetch('/api/transport/madrid/rail-stops?q=' + encodeURIComponent(q));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.length) { box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">Nenhuma estação encontrada.</p>'; return; }
            box.innerHTML = data.map(s => `
                <div style="padding:6px 4px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onclick='openMadridRailDeparturesModal(${JSON.stringify(s.id)}, ${JSON.stringify(s.name)}, ${JSON.stringify(s.type)})'>
                    🚆 ${escapeHtml(s.name)} <span style="color:var(--text-secondary);font-size:11px;">(${escapeHtml(s.operatorName)})</span>
                </div>`).join('');
        } catch (err) {
            box.innerHTML = `<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }
    // Reaproveita o mesmo modal genérico de partidas já usado para a CP/Fertagus.
    async function openMadridRailDeparturesModal(stationId, stationName, type) {
        document.getElementById('trainDeparturesTitle').textContent = `🚆 Próximas partidas — ${stationName}`;
        const list = document.getElementById('trainDeparturesList');
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">A carregar...</p>';
        document.getElementById('modalTrainDepartures').classList.add('active');
        try {
            const res = await fetch('/api/transport/madrid/rail-departures?stationId=' + encodeURIComponent(stationId) + '&type=' + encodeURIComponent(type));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.departures.length) { list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">Sem mais partidas hoje.</p>'; return; }
            list.innerHTML = data.departures.map(d => `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div><strong>${escapeHtml((d.time || '').slice(0, 5))}</strong>${d.routeName ? ' · ' + escapeHtml(d.routeName) : ''}</div>
                    <div style="color:var(--text-secondary);font-size:12px;text-align:right;">${escapeHtml(d.headsign || '')}</div>
                </div>`).join('');
        } catch (err) {
            list.innerHTML = `<p style="color:var(--text-secondary);text-align:center;padding:20px;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }

    // ==================== VALÊNCIA (EMT — autocarros, via GTFS aberto) ====================
    let valenciaBusSearchTimer = null;
    function debounceValenciaBusStopSearch() {
        clearTimeout(valenciaBusSearchTimer);
        valenciaBusSearchTimer = setTimeout(runValenciaBusStopSearch, 300);
    }
    async function runValenciaBusStopSearch() {
        const q = document.getElementById('valenciaBusSearchInput').value.trim();
        const box = document.getElementById('valenciaBusSearchResults');
        if (!q) { box.innerHTML = ''; return; }
        box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">A procurar...</p>';
        try {
            const res = await fetch('/api/transport/valencia/bus-stops?q=' + encodeURIComponent(q));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.length) { box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">Nenhuma paragem encontrada.</p>'; return; }
            box.innerHTML = data.map(s => `
                <div style="padding:6px 4px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onclick='openValenciaBusDeparturesModal(${JSON.stringify(s.id)}, ${JSON.stringify(s.name)})'>
                    🚌 ${escapeHtml(s.name)}
                </div>`).join('');
        } catch (err) {
            box.innerHTML = `<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }
    // Reaproveita o mesmo modal genérico de "próximas partidas" já usado para Guimarães/Madrid.
    async function openValenciaBusDeparturesModal(stopId, stopName) {
        document.getElementById('guimaraesDeparturesTitle').textContent = `🚌 Próximas partidas — ${stopName}`;
        const list = document.getElementById('guimaraesDeparturesList');
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">A carregar...</p>';
        document.getElementById('modalGuimaraesDepartures').classList.add('active');
        try {
            const res = await fetch('/api/transport/valencia/bus-departures?stationId=' + encodeURIComponent(stopId));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.departures.length) { list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">Sem mais partidas hoje.</p>'; return; }
            list.innerHTML = data.departures.map(d => `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div><strong>${escapeHtml((d.time || '').slice(0, 5))}</strong>${d.routeName ? ' · ' + escapeHtml(d.routeName) : ''}</div>
                    <div style="color:var(--text-secondary);font-size:12px;text-align:right;">${escapeHtml(d.headsign || '')}</div>
                </div>`).join('');
        } catch (err) {
            list.innerHTML = `<p style="color:var(--text-secondary);text-align:center;padding:20px;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }

    // ==================== VALÊNCIA (Metrovalencia — metro/tram, via GTFS da FGV) ====================
    let railValenciaSearchTimer = null;
    function debounceValenciaRailStationSearch() {
        clearTimeout(railValenciaSearchTimer);
        railValenciaSearchTimer = setTimeout(runValenciaRailStationSearch, 300);
    }
    async function runValenciaRailStationSearch() {
        const q = document.getElementById('railValenciaSearchInput').value.trim();
        const box = document.getElementById('railValenciaSearchResults');
        if (!q) { box.innerHTML = ''; return; }
        box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">A procurar...</p>';
        try {
            const res = await fetch('/api/transport/valencia/rail-stops?q=' + encodeURIComponent(q));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.length) { box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">Nenhuma estação encontrada.</p>'; return; }
            box.innerHTML = data.map(s => `
                <div style="padding:6px 4px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onclick='openValenciaRailDeparturesModal(${JSON.stringify(s.id)}, ${JSON.stringify(s.name)})'>
                    🚆 ${escapeHtml(s.name)}
                </div>`).join('');
        } catch (err) {
            box.innerHTML = `<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }
    // Reaproveita o mesmo modal genérico de partidas já usado para a CP/Fertagus/Madrid.
    async function openValenciaRailDeparturesModal(stationId, stationName) {
        document.getElementById('trainDeparturesTitle').textContent = `🚆 Próximas partidas — ${stationName}`;
        const list = document.getElementById('trainDeparturesList');
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">A carregar...</p>';
        document.getElementById('modalTrainDepartures').classList.add('active');
        try {
            const res = await fetch('/api/transport/valencia/rail-departures?stationId=' + encodeURIComponent(stationId));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.departures.length) { list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">Sem mais partidas hoje.</p>'; return; }
            list.innerHTML = data.departures.map(d => `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div><strong>${escapeHtml((d.time || '').slice(0, 5))}</strong>${d.routeName ? ' · ' + escapeHtml(d.routeName) : ''}</div>
                    <div style="color:var(--text-secondary);font-size:12px;text-align:right;">${escapeHtml(d.headsign || '')}</div>
                </div>`).join('');
        } catch (err) {
            list.innerHTML = `<p style="color:var(--text-secondary);text-align:center;padding:20px;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }

    // ==================== RENFE (nacional — Cercanías/Rodalies + AVE/Larga Distância) ====================
    let railRenfeSearchTimer = null;
    function debounceRenfeRailStationSearch() {
        clearTimeout(railRenfeSearchTimer);
        railRenfeSearchTimer = setTimeout(runRenfeRailStationSearch, 300);
    }
    async function runRenfeRailStationSearch() {
        const q = document.getElementById('railRenfeSearchInput').value.trim();
        const box = document.getElementById('railRenfeSearchResults');
        if (!q) { box.innerHTML = ''; return; }
        box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">A procurar...</p>';
        try {
            const res = await fetch('/api/transport/renfe/rail-stops?q=' + encodeURIComponent(q));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.length) { box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">Nenhuma estação encontrada.</p>'; return; }
            box.innerHTML = data.map(s => `
                <div style="padding:6px 4px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onclick='openRenfeRailDeparturesModal(${JSON.stringify(s.id)}, ${JSON.stringify(s.name)}, ${JSON.stringify(s.type)})'>
                    🚆 ${escapeHtml(s.name)} <span style="color:var(--text-secondary);font-size:11px;">(${escapeHtml(s.operatorName)})</span>
                </div>`).join('');
        } catch (err) {
            box.innerHTML = `<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }
    // Reaproveita o mesmo modal genérico de partidas já usado para a CP/Fertagus/Madrid/Valência.
    async function openRenfeRailDeparturesModal(stationId, stationName, type) {
        document.getElementById('trainDeparturesTitle').textContent = `🚆 Próximas partidas — ${stationName}`;
        const list = document.getElementById('trainDeparturesList');
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">A carregar...</p>';
        document.getElementById('modalTrainDepartures').classList.add('active');
        try {
            const res = await fetch('/api/transport/renfe/rail-departures?stationId=' + encodeURIComponent(stationId) + '&type=' + encodeURIComponent(type));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.departures.length) { list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">Sem mais partidas hoje.</p>'; return; }
            list.innerHTML = data.departures.map(d => `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div><strong>${escapeHtml((d.time || '').slice(0, 5))}</strong>${d.routeName ? ' · ' + escapeHtml(d.routeName) : ''}</div>
                    <div style="color:var(--text-secondary);font-size:12px;text-align:right;">${escapeHtml(d.headsign || '')}</div>
                </div>`).join('');
        } catch (err) {
            list.innerHTML = `<p style="color:var(--text-secondary);text-align:center;padding:20px;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }

    // ==================== FRANÇA (SNCF Transilien — Paris/Île-de-França) ====================
    let railFranceSearchTimer = null;
    function debounceFranceRailStationSearch() {
        clearTimeout(railFranceSearchTimer);
        railFranceSearchTimer = setTimeout(runFranceRailStationSearch, 300);
    }
    async function runFranceRailStationSearch() {
        const q = document.getElementById('railFranceSearchInput').value.trim();
        const box = document.getElementById('railFranceSearchResults');
        if (!q) { box.innerHTML = ''; return; }
        box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">A procurar...</p>';
        try {
            const res = await fetch('/api/transport/france/rail-stops?q=' + encodeURIComponent(q));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.length) { box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">Nenhuma estação encontrada.</p>'; return; }
            box.innerHTML = data.map(s => `
                <div style="padding:6px 4px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onclick='openFranceRailDeparturesModal(${JSON.stringify(s.id)}, ${JSON.stringify(s.name)})'>
                    🚆 ${escapeHtml(s.name)}
                </div>`).join('');
        } catch (err) {
            box.innerHTML = `<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }
    // Reaproveita o mesmo modal genérico de partidas já usado para a CP/Fertagus/Madrid/Valência/Renfe.
    async function openFranceRailDeparturesModal(stationId, stationName) {
        document.getElementById('trainDeparturesTitle').textContent = `🚆 Próximas partidas — ${stationName}`;
        const list = document.getElementById('trainDeparturesList');
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">A carregar...</p>';
        document.getElementById('modalTrainDepartures').classList.add('active');
        try {
            const res = await fetch('/api/transport/france/rail-departures?stationId=' + encodeURIComponent(stationId));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.departures.length) { list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">Sem mais partidas hoje.</p>'; return; }
            list.innerHTML = data.departures.map(d => `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div><strong>${escapeHtml((d.time || '').slice(0, 5))}</strong>${d.routeName ? ' · ' + escapeHtml(d.routeName) : ''}</div>
                    <div style="color:var(--text-secondary);font-size:12px;text-align:right;">${escapeHtml(d.headsign || '')}</div>
                </div>`).join('');
        } catch (err) {
            list.innerHTML = `<p style="color:var(--text-secondary);text-align:center;padding:20px;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }

    // ==================== PORTO — METRO DO PORTO (GTFS) + STCP (tempo real) ====================
    let portoSearchTimer = null;
    function debouncePortoStopSearch() {
        clearTimeout(portoSearchTimer);
        portoSearchTimer = setTimeout(runPortoStopSearch, 300);
    }
    async function runPortoStopSearch() {
        const q = document.getElementById('portoSearchInput').value.trim();
        const box = document.getElementById('portoSearchResults');
        if (!q) { box.innerHTML = ''; return; }
        box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">A procurar...</p>';
        try {
            const res = await fetch('/api/transport/porto/stops?q=' + encodeURIComponent(q));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.length) { box.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">Nenhuma paragem/estação encontrada.</p>'; return; }
            box.innerHTML = data.map(s => `
                <div style="padding:6px 4px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);" onclick='openPortoDeparturesModal(${JSON.stringify(s.id)}, ${JSON.stringify(s.name)}, ${JSON.stringify(s.type)})'>
                    ${s.type === 'metro' ? '🚇' : '🚌'} ${escapeHtml(s.name)}
                </div>`).join('');
        } catch (err) {
            box.innerHTML = `<p style="color:var(--text-secondary);font-size:12px;padding:6px 0;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }
    async function openPortoDeparturesModal(stopId, stopName, type) {
        document.getElementById('portoDeparturesTitle').textContent = `${type === 'metro' ? '🚇' : '🚌'} Próximas partidas — ${stopName}`;
        const list = document.getElementById('portoDeparturesList');
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">A carregar...</p>';
        document.getElementById('modalPortoDepartures').classList.add('active');
        try {
            const res = await fetch('/api/transport/porto/departures?type=' + encodeURIComponent(type) + '&stationId=' + encodeURIComponent(stopId));
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            if (!data.departures.length) { list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">Sem mais partidas.</p>'; return; }
            list.innerHTML = data.departures.map(d => `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div><strong>${escapeHtml(d.display || '')}</strong>${d.routeName ? ' · ' + escapeHtml(d.routeName) : ''}</div>
                    <div style="color:var(--text-secondary);font-size:12px;text-align:right;">${escapeHtml(d.headsign || '')}</div>
                </div>`).join('');
        } catch (err) {
            list.innerHTML = `<p style="color:var(--text-secondary);text-align:center;padding:20px;">⚠️ ${escapeHtml(err.message)}</p>`;
        }
    }

    // ==================== LEGENDAS AO VIVO TRADUZIDAS NA CHAMADA ====================
    // Usa a Web Speech API do navegador (reconhecimento de fala) — funciona bem no
    // Chrome/Android; no Safari/iPhone o suporte é limitado ou inexistente, por isso
    // avisamos em vez de falhar silenciosamente. O texto reconhecido é enviado ao
    // outro lado da chamada, e CADA lado traduz para o SEU próprio idioma escolhido
    // no tradutor (🌐 no cabeçalho) — não é preciso combinar o idioma com ninguém.
    const CAPTIONS = { active: false, recognition: null };

    function toggleLiveCaptions() {
        if (CAPTIONS.active) { stopLiveCaptions(); return; }
        const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognitionAPI) {
            return alert('Legendas ao vivo não são suportadas neste navegador. Funcionam bem no Chrome (Android/computador); no iPhone o Safari ainda não suporta isto.');
        }
        if (!document.getElementById('callScreen').classList.contains('active')) return alert('Isto só funciona durante uma chamada.');
        CAPTIONS.recognition = new SpeechRecognitionAPI();
        CAPTIONS.recognition.continuous = true;
        CAPTIONS.recognition.interimResults = false;
        CAPTIONS.recognition.lang = 'pt-PT';
        CAPTIONS.recognition.onresult = (e) => {
            const text = e.results[e.results.length - 1][0].transcript;
            if (text?.trim()) {
                socket.emit('call_caption', { roomId: APP.currentChatId, text });
                showCaption('Você: ' + text);
            }
        };
        CAPTIONS.recognition.onerror = (e) => { if (e.error !== 'no-speech') console.warn('Erro no reconhecimento de fala:', e.error); };
        CAPTIONS.recognition.onend = () => { if (CAPTIONS.active) CAPTIONS.recognition.start(); }; // reinicia sozinho (a API para automaticamente de vez em quando)
        CAPTIONS.recognition.start();
        CAPTIONS.active = true;
        document.getElementById('captionBtn').style.background = 'var(--green)';
        document.getElementById('captionOverlay').style.display = 'block';
    }

    function stopLiveCaptions() {
        CAPTIONS.active = false;
        if (CAPTIONS.recognition) { CAPTIONS.recognition.onend = null; CAPTIONS.recognition.stop(); CAPTIONS.recognition = null; }
        document.getElementById('captionBtn').style.background = '';
        document.getElementById('captionOverlay').style.display = 'none';
    }

    function showCaption(text) {
        const overlay = document.getElementById('captionOverlay');
        overlay.style.display = 'block';
        overlay.textContent = text;
    }

    // Legenda recebida do outro lado da chamada — traduz para o MEU idioma escolhido
    socket.on('call_caption_received', (data) => {
        const targetLang = APP.translatorLang || 'pt';
        fetch(`/api/translate?text=${encodeURIComponent(data.text)}&target=${encodeURIComponent(targetLang)}`)
            .then(r => r.json())
            .then(res => showCaption(`${data.name}: ${res.translated || data.text}`))
            .catch(() => showCaption(`${data.name}: ${data.text}`));
    });

    // ==================== RESUMO DE CONVERSA POR IA ====================
    function summarizeChat() {
        if (!APP.currentChatId) return alert('Abra uma conversa primeiro!');
        const msgs = (APP.messages[APP.currentChatId] || []).filter(m => !m.deleted && !m.fileData);
        if (msgs.length === 0) return alert('Ainda não há mensagens de texto para resumir.');
        document.getElementById('modalSummary').classList.add('active');
        document.getElementById('summaryContent').textContent = 'A gerar resumo...';
        const transcript = msgs.slice(-60).map(m => `${m.type === 'sent' ? 'Você' : m.sender}: ${m.text}`).join('\n');
        fetch('/api/gemini-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token || '' },
            body: JSON.stringify({
                history: [{ role: 'user', text: 'Resume a conversa a seguir em português, de forma breve (5-8 linhas no máximo), destacando decisões, pedidos ou combinações importantes. Não inventes nada que não esteja na conversa.\n\n' + transcript }]
            })
        })
            .then(r => r.json().then(data => ({ ok: r.ok, data })))
            .then(({ ok, data }) => {
                document.getElementById('summaryContent').textContent = ok ? (data.reply || 'Não foi possível gerar o resumo.') : ('⚠️ ' + (data.error || 'O Gemini não está disponível agora.'));
            })
            .catch(() => { document.getElementById('summaryContent').textContent = '⚠️ Não foi possível ligar ao servidor do Gemini.'; });
    }

    // ==================== GESTÃO DE GRUPOS (cargos, silenciar, remover) ====================
    function openManageGroupModal() {
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat || chat.type !== 'group') return;
        const myPhone = APP.user.phone;
        const isAdmin = chat.admins?.includes(myPhone);
        if (!isAdmin) return alert('Só administradores do grupo podem geri-lo.');
        document.getElementById('groupDailySummaryToggle').checked = !!chat.dailySummaryEnabled;
        const list = document.getElementById('manageGroupList');
        // Grupos privados só têm mesmo os membros reais como candidatos a gerir — podem
        // incluir gente que entrou por convite e não é contacto de quem administra, por
        // isso usam a lista de nomes que o servidor já manda (ver memberNames). Grupos
        // abertos continuam a usar a lista de contactos, exatamente como sempre foi.
        const roster = chat.private
            ? (chat.memberNames || []).filter(m => m.phone !== myPhone)
            : APP.onlineContacts.filter(c => c.phone !== myPhone).map(c => ({ phone: c.phone, name: c.name }));
        list.innerHTML = roster.map(c => {
            const role = chat.admins?.includes(c.phone) ? 'admin' : (chat.moderators?.includes(c.phone) ? 'moderator' : 'member');
            const isMuted = chat.mutedPhones?.includes(c.phone);
            return `
            <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
                <div style="flex:1;">
                    <div style="color:var(--text-primary);font-size:14px;">${escapeHtml(c.name)} ${role === 'admin' ? '👑' : (role === 'moderator' ? '🛡️' : '')}</div>
                    <div style="font-size:11px;color:#8696a0;">${isMuted ? 'Silenciado' : role}</div>
                </div>
                <select onchange="setGroupRole('${c.phone}', this.value)" style="background:var(--bg-tertiary);color:#fff;border:none;border-radius:6px;padding:4px;font-size:11px;">
                    <option value="member" ${role === 'member' ? 'selected' : ''}>Membro</option>
                    <option value="moderator" ${role === 'moderator' ? 'selected' : ''}>Moderador</option>
                    <option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
                <button class="btn-small" onclick="toggleGroupMute('${c.phone}', ${!isMuted})" title="Silenciar/reativar">${isMuted ? '🔊' : '🔇'}</button>
                <button class="btn-small btn-danger" onclick="kickFromGroup('${c.phone}', '${c.name.replace(/'/g, '')}')" title="Remover do grupo">🚫</button>
            </div>`;
        }).join('') || `<p style="color:#8696a0;">${chat.private ? 'Ainda sem outros membros.' : 'Sem outros utilizadores cadastrados.'}</p>`;
        document.getElementById('deleteGroupBtn').style.display = chat.createdByPhone === myPhone ? 'inline-flex' : 'none';
        renderGroupInviteBox(chat);
        document.getElementById('modalManageGroup').classList.add('active');
    }

    // ==================== CONVITE PARA GRUPO PRIVADO (link/QR) ====================
    // Só existe para grupos "privados" (ver checkbox ao criar) — os grupos abertos
    // continuam sem precisar de convite nenhum, como sempre foi.
    function renderGroupInviteBox(chat) {
        const box = document.getElementById('groupInviteBox');
        if (!chat.private) { box.style.display = 'none'; box.innerHTML = ''; return; }
        box.style.display = 'block';
        box.innerHTML = `
            <div style="font-weight:600;font-size:13px;margin-top:14px;">🔗 Convite (grupo privado)</div>
            <p style="color:var(--text-secondary);font-size:12px;margin:4px 0 8px;">Quem abrir este link ou ler este QR entra automaticamente no grupo.</p>
            <div id="groupInviteContent"><p style="color:var(--text-secondary);font-size:12px;">A carregar…</p></div>
        `;
        fetchGroupInvite(chat.id, false);
    }
    async function fetchGroupInvite(groupId, regenerate) {
        const content = document.getElementById('groupInviteContent');
        try {
            const res = await fetch('/api/group-invite/get', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token },
                body: JSON.stringify({ token: APP.token, groupId, regenerate, origin: location.origin })
            });
            const data = await res.json();
            if (!res.ok) {
                content.innerHTML = `<p style="color:var(--text-secondary);font-size:12px;">${escapeHtml(data.error || 'Ainda sem link de convite.')}</p>` +
                    `<button class="btn-small" style="margin-top:6px;" onclick="fetchGroupInvite('${groupId}', true)">🔗 Gerar link de convite</button>`;
                return;
            }
            APP.lastGroupInviteUrl = data.inviteUrl;
            content.innerHTML = `
                <div style="display:flex;gap:6px;">
                    <input type="text" readonly value="${escapeHtml(data.inviteUrl)}" style="flex:1;font-size:11px;" onclick="this.select()">
                    <button class="btn-small" onclick="copyGroupInviteLink()">📋 Copiar</button>
                </div>
                <img src="${data.qrDataUrl}" style="width:150px;height:150px;margin-top:8px;border-radius:8px;" alt="QR de convite do grupo">
                <button class="btn-small" style="margin-top:8px;display:block;" onclick="fetchGroupInvite('${groupId}', true)">🔄 Gerar novo link (invalida o anterior)</button>
            `;
        } catch (e) {
            content.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;">⚠️ Não foi possível ligar ao servidor.</p>';
        }
    }
    function copyGroupInviteLink() {
        if (!APP.lastGroupInviteUrl) return;
        navigator.clipboard?.writeText(APP.lastGroupInviteUrl).then(
            () => alert('✅ Link copiado!'),
            () => alert('⚠️ Não foi possível copiar — seleciona o texto manualmente.')
        );
    }
    // Chamado quando este aparelho abriu um link de convite (?joinGroup=...) — troca o
    // token pela entrada real no grupo, tal como o pareamento de dispositivo troca o seu
    // próprio token por uma sessão (ver redeemDevicePairing).
    async function redeemGroupInvite(inviteToken) {
        try {
            const res = await fetch('/api/group-invite/redeem', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token },
                body: JSON.stringify({ token: APP.token, inviteToken })
            });
            const data = await res.json();
            if (!res.ok) { alert('⚠️ ' + (data.error || 'Não foi possível entrar neste grupo.')); return; }
            // O 'groups_update' com o grupo novo chega a seguir (o servidor já nos
            // acrescentou como membro) — dá-lhe um instante antes de abrir a conversa.
            setTimeout(() => {
                if (APP.chats.some(c => c.id === data.groupId)) openChat(data.groupId);
            }, 700);
        } catch (e) {
            alert('⚠️ Não foi possível ligar ao servidor para entrar neste grupo.');
        }
    }

    function deleteCurrentGroup() {
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat || chat.type !== 'group') return;
        if (chat.createdByPhone !== APP.user.phone) return alert('Só quem criou o grupo pode apagá-lo.');
        if (!confirm(`Apagar o grupo "${chat.name}" para sempre? Isto também apaga todas as mensagens. Não é possível desfazer.`)) return;
        socket.emit('group_delete', { groupId: chat.id });
        closeModal('modalManageGroup');
    }
    function toggleGroupDailySummary(enabled) {
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat || chat.type !== 'group') return;
        socket.emit('group_set_daily_summary', { groupId: chat.id, enabled });
    }

    socket.on('group_deleted', (data) => {
        if (APP.currentChatId === data.groupId) closeChat();
        delete APP.messages[data.groupId];
    });

    function setGroupRole(targetPhone, role) {
        socket.emit('group_set_role', { groupId: APP.currentChatId, targetPhone, role });
    }
    function toggleGroupMute(targetPhone, muted) {
        socket.emit('group_mute', { groupId: APP.currentChatId, targetPhone, muted });
    }
    function kickFromGroup(targetPhone, name) {
        if (!confirm(`Remover ${name} do grupo?`)) return;
        socket.emit('group_kick', { groupId: APP.currentChatId, targetPhone });
    }

    // ==================== SALA DE REALIDADE VIRTUAL (avatares 3D em tempo real) ====================
    // Usa Three.js (gratuito, via CDN) — não é VR de headset (Oculus/Quest), é um
    // espaço 3D partilhado onde cada pessoa controla um avatar e vê os avatares dos
    // outros membros do grupo a moverem-se em tempo real, tipo uma "sala de encontro".
    const VR = {
        active: false, roomId: null, scene: null, camera: null, renderer: null,
        avatars: {}, // socketId (ou 'me') -> { group, targetPos, targetRotY, label }
        myPos: { x: 0, z: 0 }, myRotY: 0,
        keys: {}, joystick: { active: false, x: 0, y: 0, touchId: null },
        animFrame: null, lastSent: 0
    };

    function colorFromPhone(phone) {
        let hash = 0;
        for (let i = 0; i < (phone || '').length; i++) hash = (hash * 31 + phone.charCodeAt(i)) & 0xffffff;
        return hash | 0x333333; // evita cores demasiado escuras
    }

    function makeNameSprite(name) {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.roundRect ? ctx.roundRect(0, 12, 256, 40, 12) : ctx.fillRect(0, 12, 256, 40);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 28px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(name.substring(0, 16), 128, 40);
        const texture = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
        sprite.scale.set(2, 0.5, 1);
        sprite.position.y = 2.3;
        return sprite;
    }

    function makeAvatarMesh(name, phone) {
        const group = new THREE.Group();
        const color = colorFromPhone(phone || name);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 1.1, 12), new THREE.MeshStandardMaterial({ color }));
        body.position.y = 1;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), new THREE.MeshStandardMaterial({ color: 0xffe0bd }));
        head.position.y = 1.75;
        group.add(body, head, makeNameSprite(name));
        return group;
    }

    function openVrRoom() {
        if (!APP.currentChatId) return;
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat || chat.type !== 'group') return alert('A sala virtual está disponível para grupos.');
        if (typeof THREE === 'undefined') return alert('Não foi possível carregar o motor 3D (Three.js). Verifica a tua ligação à internet.');
        VR.roomId = APP.currentChatId;
        document.getElementById('vrRoomTitle').textContent = '🕶️ Sala Virtual · ' + chat.name;
        document.getElementById('vrRoomScreen').classList.add('active');
        initVrScene();
        VR.active = true;
        socket.emit('join_vr_room', { roomId: VR.roomId });
        vrAnimate();
    }

    function closeVrRoom() {
        VR.active = false;
        if (VR.animFrame) cancelAnimationFrame(VR.animFrame);
        if (VR.roomId) socket.emit('leave_vr_room', { roomId: VR.roomId });
        document.getElementById('vrRoomScreen').classList.remove('active');
        const wrap = document.getElementById('vrCanvasWrap');
        if (VR.renderer) { VR.renderer.dispose(); if (VR.renderer.domElement.parentElement) VR.renderer.domElement.remove(); }
        VR.scene = null; VR.camera = null; VR.renderer = null; VR.avatars = {}; VR.roomId = null;
    }

    function initVrScene() {
        const wrap = document.getElementById('vrCanvasWrap');
        const width = wrap.clientWidth, height = wrap.clientHeight;

        VR.scene = new THREE.Scene();
        VR.scene.background = new THREE.Color(0x0d1117);
        VR.scene.fog = new THREE.Fog(0x0d1117, 8, 30);

        VR.camera = new THREE.PerspectiveCamera(65, width / height, 0.1, 100);

        VR.renderer = new THREE.WebGLRenderer({ antialias: true });
        VR.renderer.setSize(width, height);
        VR.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        wrap.insertBefore(VR.renderer.domElement, wrap.firstChild);

        VR.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(5, 10, 5);
        VR.scene.add(dirLight);

        // Chão com grelha, para dar noção de espaço/movimento
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x1c2733 }));
        floor.rotation.x = -Math.PI / 2;
        VR.scene.add(floor);
        VR.scene.add(new THREE.GridHelper(40, 40, 0x334455, 0x223344));

        // Paredes simples, só para dar sensação de "sala"
        const wallMat = new THREE.MeshStandardMaterial({ color: 0x202c33, transparent: true, opacity: 0.6 });
        [[0, -20, 0], [0, 20, 0], [-20, 0, Math.PI / 2], [20, 0, Math.PI / 2]].forEach(([x, z, rot]) => {
            const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 6), wallMat);
            wall.position.set(x, 3, z);
            wall.rotation.y = rot;
            VR.scene.add(wall);
        });

        VR.myPos = { x: 0, z: 5 };
        VR.myRotY = Math.PI;
        VR.avatars['me'] = { group: makeAvatarMesh(APP.user.name, APP.user.phone) };
        VR.scene.add(VR.avatars['me'].group);

        window.addEventListener('resize', onVrResize);
        setupVrControls();
    }

    function onVrResize() {
        if (!VR.renderer || !VR.camera) return;
        const wrap = document.getElementById('vrCanvasWrap');
        VR.camera.aspect = wrap.clientWidth / wrap.clientHeight;
        VR.camera.updateProjectionMatrix();
        VR.renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    }

    function setupVrControls() {
        document.onkeydown = document.onkeydown || null;
        window.addEventListener('keydown', (e) => { if (VR.active) VR.keys[e.key.toLowerCase()] = true; });
        window.addEventListener('keyup', (e) => { if (VR.active) VR.keys[e.key.toLowerCase()] = false; });

        // Joystick virtual (arrastar com o dedo) — estilo "tanque": cima/baixo anda,
        // esquerda/direita roda, para funcionar bem em telemóvel sem precisar de mais controlos.
        const zone = document.getElementById('vrJoystickZone');
        const stick = document.getElementById('vrJoystickStick');
        function moveStick(dx, dy) {
            const max = 35;
            const dist = Math.min(Math.hypot(dx, dy), max);
            const angle = Math.atan2(dy, dx);
            const sx = Math.cos(angle) * dist, sy = Math.sin(angle) * dist;
            stick.style.left = (35 + sx) + 'px';
            stick.style.top = (35 + sy) + 'px';
            VR.joystick.x = sx / max;
            VR.joystick.y = sy / max;
        }
        zone.addEventListener('touchstart', (e) => { VR.joystick.active = true; VR.joystick.touchId = e.changedTouches[0].identifier; }, { passive: true });
        zone.addEventListener('touchmove', (e) => {
            const t = [...e.changedTouches].find(t => t.identifier === VR.joystick.touchId);
            if (!t) return;
            const rect = zone.getBoundingClientRect();
            moveStick(t.clientX - (rect.left + rect.width / 2), t.clientY - (rect.top + rect.height / 2));
        }, { passive: true });
        ['touchend', 'touchcancel'].forEach(ev => zone.addEventListener(ev, () => {
            VR.joystick.active = false; VR.joystick.x = 0; VR.joystick.y = 0;
            stick.style.left = '35px'; stick.style.top = '35px';
        }));
    }

    function vrAnimate() {
        if (!VR.active || !VR.renderer) return;
        VR.animFrame = requestAnimationFrame(vrAnimate);

        const turnSpeed = 0.045, moveSpeed = 0.09;
        let turn = 0, forward = 0;
        if (VR.keys['a'] || VR.keys['arrowleft']) turn += 1;
        if (VR.keys['d'] || VR.keys['arrowright']) turn -= 1;
        if (VR.keys['w'] || VR.keys['arrowup']) forward += 1;
        if (VR.keys['s'] || VR.keys['arrowdown']) forward -= 1;
        turn -= VR.joystick.x; // joystick esquerda/direita roda
        forward -= VR.joystick.y; // joystick cima/baixo anda (y negativo = cima)

        if (turn) VR.myRotY += turn * turnSpeed;
        if (forward) {
            VR.myPos.x += Math.sin(VR.myRotY) * forward * moveSpeed;
            VR.myPos.z += Math.cos(VR.myRotY) * forward * moveSpeed;
            VR.myPos.x = Math.max(-19, Math.min(19, VR.myPos.x));
            VR.myPos.z = Math.max(-19, Math.min(19, VR.myPos.z));
        }

        const me = VR.avatars['me'];
        if (me) {
            me.group.position.set(VR.myPos.x, 0, VR.myPos.z);
            me.group.rotation.y = VR.myRotY;
        }

        // Câmara em 3ª pessoa, atrás do avatar
        const camDist = 5, camHeight = 3.2;
        const targetCamX = VR.myPos.x - Math.sin(VR.myRotY) * camDist;
        const targetCamZ = VR.myPos.z - Math.cos(VR.myRotY) * camDist;
        VR.camera.position.lerp(new THREE.Vector3(targetCamX, camHeight, targetCamZ), 0.15);
        VR.camera.lookAt(VR.myPos.x, 1.2, VR.myPos.z);

        // Suaviza a posição dos avatares dos outros (interpolação simples)
        Object.entries(VR.avatars).forEach(([key, a]) => {
            if (key === 'me' || !a.targetPos) return;
            a.group.position.x += (a.targetPos.x - a.group.position.x) * 0.2;
            a.group.position.z += (a.targetPos.z - a.group.position.z) * 0.2;
            a.group.rotation.y += (a.targetRotY - a.group.rotation.y) * 0.2;
        });

        // Envia a minha posição no máximo a cada 100ms (não sobrecarregar a rede)
        const now = Date.now();
        if (now - VR.lastSent > 100 && (turn || forward)) {
            VR.lastSent = now;
            socket.emit('vr_position', { roomId: VR.roomId, x: VR.myPos.x, y: 0, z: VR.myPos.z, rotY: VR.myRotY });
        }

        VR.renderer.render(VR.scene, VR.camera);
    }

    socket.on('vr_existing_peers', (data) => {
        (data.peers || []).forEach(p => {
            if (p.socketId === socket.id || VR.avatars[p.socketId]) return;
            const group = makeAvatarMesh(p.name, p.phone);
            group.position.set(0, 0, 0);
            VR.avatars[p.socketId] = { group, targetPos: { x: 0, z: 0 }, targetRotY: 0 };
            if (VR.scene) VR.scene.add(group);
        });
    });

    socket.on('vr_peer_joined', (p) => {
        if (!VR.active || p.socketId === socket.id || VR.avatars[p.socketId]) return;
        const group = makeAvatarMesh(p.name, p.phone);
        group.position.set(0, 0, 0);
        VR.avatars[p.socketId] = { group, targetPos: { x: 0, z: 0 }, targetRotY: 0 };
        VR.scene.add(group);
    });

    socket.on('vr_position_received', (data) => {
        const a = VR.avatars[data.socketId];
        if (!a) return;
        a.targetPos = { x: data.x, z: data.z };
        a.targetRotY = data.rotY;
    });

    socket.on('vr_peer_left', (data) => {
        const a = VR.avatars[data.socketId];
        if (a && VR.scene) { VR.scene.remove(a.group); delete VR.avatars[data.socketId]; }
    });

    function closeChat() {
        APP.currentChatId = null;
        document.getElementById('chatArea').classList.remove('active');
        document.getElementById('sidebar').classList.remove('chat-open');
        renderChatList();
    }

    // ==================== LOCALIZAÇÃO EM TEMPO REAL (GPS + mapa + trajeto) ====================
    // Usa a Geolocation API (GPS do satélite) do navegador — funciona em qualquer
    // dispositivo (Android, iPhone, computador), desde que o usuário autorize o
    // acesso à localização e o site esteja em HTTPS (obrigatório em iOS/Android
    // fora do localhost). O mapa usa Leaflet + OpenStreetMap, gratuito e sem chave.
    const LOCATION = {
        map: null,
        markers: {},   // phone -> L.marker
        trails: {},    // phone -> [ {lat,lng} ] usado para desenhar o trajeto (polyline)
        polylines: {}, // phone -> L.polyline
        watchId: null,
        sharing: false,
        lastPoint: null, // { lat, lng, t } do próprio usuário, para calcular velocidade/meio de transporte
        myPoint: null, // { lat, lng, speedKmh } — usado para calcular o "a caminho" (ETA)
        otherPoints: {}, // phone -> { lat, lng, speedKmh, name } de quem partilha localização contigo
        shareExpiresAt: null, // quando a partilha atual pára sozinha (ver aviso de segurança abaixo)
        shareExpiryTimer: null,
        shareBannerTicker: null
    };

    function haversineMeters(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const toRad = (d) => d * Math.PI / 180;
        const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // Estima o meio de transporte pela velocidade (km/h) — heurística simples,
    // não é um sensor de atividade real, mas dá uma boa ideia.
    function inferTransportMode(speedKmh) {
        if (speedKmh == null || isNaN(speedKmh)) return '📍';
        if (speedKmh < 1.5) return '⏸️ Parado';
        if (speedKmh < 7) return '🚶 A pé';
        if (speedKmh < 25) return '🚴 Bicicleta / trânsito';
        if (speedKmh < 130) return '🚗 Veículo';
        return '✈️ Alta velocidade';
    }

    function openLocationScreen() {
        if (!APP.currentChatId) return alert('Abra uma conversa primeiro!');
        if (!navigator.geolocation) return alert('Este navegador não suporta geolocalização.');
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        document.getElementById('locationTitle').textContent = '📍 Localização · ' + (chat?.name || '');
        document.getElementById('locationScreen').classList.add('active');
        if (!LOCATION.map) {
            LOCATION.map = L.map('liveMap').setView([38.72, -9.14], 13); // Lisboa como ponto inicial padrão
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19
            }).addTo(LOCATION.map);
        }
        setTimeout(() => LOCATION.map.invalidateSize(), 200);
        updateShareLocationBtn();
    }

    function closeLocationScreen() {
        document.getElementById('locationScreen').classList.remove('active');
        if (LOCATION.sharing) toggleShareLocation(); // para de partilhar ao sair, para poupar bateria
    }

    function updateShareLocationBtn() {
        const btn = document.getElementById('shareLocationBtn');
        btn.textContent = LOCATION.sharing ? '⏹️ Parar de partilhar' : '📡 Partilhar minha localização';
        btn.classList.toggle('btn-danger', LOCATION.sharing);
    }

    // ==================== ATIVIDADES (estilo Strava) ====================
    const ACTIVITY = {
        map: null,
        tracking: false,
        watchId: null,
        route: [], // [{lat,lng}]
        polyline: null,
        startTime: null,
        distanceMeters: 0,
        timerInterval: null,
        lastKudosGiven: new Set()
    };

    function openActivitiesScreen() {
        document.getElementById('activitiesScreen').classList.add('active');
        if (!ACTIVITY.map) {
            ACTIVITY.map = L.map('activityMap').setView([38.72, -9.14], 14);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(ACTIVITY.map);
        }
        setTimeout(() => ACTIVITY.map.invalidateSize(), 200);
        switchActivitiesTab('record');
    }

    function closeActivitiesScreen() {
        document.getElementById('activitiesScreen').classList.remove('active');
    }

    function switchActivitiesTab(tab) {
        document.querySelectorAll('.activities-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
        document.getElementById('activitiesRecordTab').style.display = tab === 'record' ? 'flex' : 'none';
        document.getElementById('activitiesFeedTab').style.display = tab === 'feed' ? 'block' : 'none';
        if (tab === 'record') setTimeout(() => ACTIVITY.map?.invalidateSize(), 150);
        else loadActivitiesFeed();
    }

    function formatDuration(seconds) {
        const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
        return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function toggleActivityRecording() {
        if (ACTIVITY.tracking) return stopActivityRecording();
        if (!navigator.geolocation) return alert('Este dispositivo não tem GPS/geolocalização disponível.');
        ACTIVITY.tracking = true;
        ACTIVITY.route = [];
        ACTIVITY.distanceMeters = 0;
        ACTIVITY.startTime = Date.now();
        document.getElementById('activityStartBtn').textContent = '⏹️ Terminar';
        document.getElementById('activityStatsBar').style.display = 'block';
        document.getElementById('activityTypeSelect').disabled = true;
        if (ACTIVITY.polyline) { ACTIVITY.map.removeLayer(ACTIVITY.polyline); ACTIVITY.polyline = null; }

        ACTIVITY.timerInterval = setInterval(updateActivityStats, 1000);
        ACTIVITY.watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const { latitude: lat, longitude: lng } = pos.coords;
                if (ACTIVITY.route.length > 0) {
                    const last = ACTIVITY.route[ACTIVITY.route.length - 1];
                    ACTIVITY.distanceMeters += haversineMeters(last.lat, last.lng, lat, lng);
                }
                ACTIVITY.route.push({ lat, lng });
                if (!ACTIVITY.polyline) {
                    ACTIVITY.polyline = L.polyline([[lat, lng]], { color: getAccentHex(), weight: 5 }).addTo(ACTIVITY.map);
                } else {
                    ACTIVITY.polyline.addLatLng([lat, lng]);
                }
                ACTIVITY.map.panTo([lat, lng]);
                updateActivityStats();
            },
            (err) => alert('Erro no GPS: ' + err.message),
            { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
        );
    }

    function updateActivityStats() {
        const km = ACTIVITY.distanceMeters / 1000;
        const seconds = (Date.now() - ACTIVITY.startTime) / 1000;
        document.getElementById('actStatDistance').textContent = km.toFixed(2) + ' km';
        document.getElementById('actStatTime').textContent = formatDuration(seconds);
        const type = document.getElementById('activityTypeSelect').value;
        if (km > 0.05) {
            if (type === 'bicicleta') {
                const kmh = km / (seconds / 3600);
                document.getElementById('actStatPace').textContent = kmh.toFixed(1) + ' km/h';
            } else {
                const paceMinPerKm = (seconds / 60) / km;
                const min = Math.floor(paceMinPerKm), sec = Math.round((paceMinPerKm - min) * 60);
                document.getElementById('actStatPace').textContent = `${min}:${String(sec).padStart(2, '0')} /km`;
            }
        }
    }

    function stopActivityRecording() {
        ACTIVITY.tracking = false;
        if (ACTIVITY.watchId != null) navigator.geolocation.clearWatch(ACTIVITY.watchId);
        clearInterval(ACTIVITY.timerInterval);
        document.getElementById('activityStartBtn').style.display = 'none';
        document.getElementById('activitySaveBtn').style.display = 'block';
        if (ACTIVITY.distanceMeters < 20) {
            alert('A atividade é demasiado curta para guardar (menos de 20 metros percorridos).');
            resetActivityRecordingUI();
        }
    }

    function saveActivity() {
        const seconds = (Date.now() - ACTIVITY.startTime) / 1000;
        const avgSpeedKmh = (ACTIVITY.distanceMeters / 1000) / (seconds / 3600);
        socket.emit('activity_save', {
            type: document.getElementById('activityTypeSelect').value,
            startTime: new Date(ACTIVITY.startTime).toISOString(),
            distanceMeters: Math.round(ACTIVITY.distanceMeters),
            durationSeconds: Math.round(seconds),
            avgSpeedKmh: Math.round(avgSpeedKmh * 10) / 10,
            route: ACTIVITY.route
        });
    }

    socket.on('activity_saved', () => {
        alert('✅ Atividade guardada! Já podes vê-la no separador Feed.');
        resetActivityRecordingUI();
        switchActivitiesTab('feed');
    });

    function resetActivityRecordingUI() {
        document.getElementById('activityStartBtn').textContent = '▶️ Começar';
        document.getElementById('activityStartBtn').style.display = 'block';
        document.getElementById('activitySaveBtn').style.display = 'none';
        document.getElementById('activityStatsBar').style.display = 'none';
        document.getElementById('activityTypeSelect').disabled = false;
        if (ACTIVITY.polyline) { ACTIVITY.map.removeLayer(ACTIVITY.polyline); ACTIVITY.polyline = null; }
        ACTIVITY.route = [];
        ACTIVITY.distanceMeters = 0;
    }

    const ACTIVITY_ICONS = { corrida: '🏃', caminhada: '🚶', bicicleta: '🚴' };
    let currentActivitiesFeed = [];

    function loadActivitiesFeed() {
        document.getElementById('activitiesFeedTab').innerHTML = '<p style="color:#8696a0;text-align:center;padding:20px;">A carregar...</p>';
        socket.emit('activities_feed_request');
    }

    socket.on('activities_feed', (feed) => {
        currentActivitiesFeed = feed || [];
        renderActivitiesFeed();
    });

    socket.on('activity_kudos_updated', (data) => {
        const act = currentActivitiesFeed.find(a => a.id === data.activityId);
        if (act) { act.kudos = data.kudos; renderActivitiesFeed(); }
    });

    function renderActivitiesFeed() {
        const box = document.getElementById('activitiesFeedTab');
        if (!currentActivitiesFeed.length) {
            box.innerHTML = '<p style="color:#8696a0;text-align:center;padding:20px;">Ainda não há atividades — as tuas e as dos teus contactos aparecem aqui. Regista a primeira no separador "Registar"! 🏃</p>';
            return;
        }
        box.innerHTML = currentActivitiesFeed.map(a => {
            const km = (a.distanceMeters / 1000).toFixed(2);
            const gaveKudos = (a.kudos || []).includes(APP.user.phone);
            const dateStr = new Date(a.startTime).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
            const isMine = a.phone === APP.user.phone;
            return `
            <div class="activity-card">
                <strong>${ACTIVITY_ICONS[a.type] || '🏃'} ${isMine ? 'Você' : a.name}</strong>
                <span style="color:#8696a0;font-size:12px;"> · ${dateStr}</span>
                <div style="display:flex;justify-content:space-around;margin:10px 0;text-align:center;">
                    <div><div style="font-weight:600;">${km} km</div><div style="font-size:11px;color:#8696a0;">Distância</div></div>
                    <div><div style="font-weight:600;">${formatDuration(a.durationSeconds)}</div><div style="font-size:11px;color:#8696a0;">Tempo</div></div>
                    <div><div style="font-weight:600;">${a.avgSpeedKmh} km/h</div><div style="font-size:11px;color:#8696a0;">Vel. média</div></div>
                </div>
                <div style="display:flex;gap:10px;">
                    <button class="btn-small kudos-btn ${gaveKudos ? 'given' : ''}" onclick="toggleActivityKudos('${a.id}')">👏 ${(a.kudos || []).length}</button>
                    ${a.route?.length > 1 ? `<button class="btn-small" onclick='showActivityRoute(${JSON.stringify(a.route)})'>🗺️ Ver rota</button>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    function toggleActivityKudos(activityId) {
        socket.emit('activity_kudos', { activityId });
    }

    function showActivityRoute(route) {
        if (!route || route.length < 2) return;
        switchActivitiesTab('record');
        setTimeout(() => {
            if (ACTIVITY.polyline) ACTIVITY.map.removeLayer(ACTIVITY.polyline);
            const latlngs = route.map(p => [p.lat, p.lng]);
            ACTIVITY.polyline = L.polyline(latlngs, { color: '#6c5ce7', weight: 5 }).addTo(ACTIVITY.map);
            ACTIVITY.map.fitBounds(ACTIVITY.polyline.getBounds(), { padding: [30, 30] });
        }, 250);
    }

    // Partilhar localização em tempo real tem um risco real de ser usado de
    // forma perigosa (alguém a ser seguida sem saber, ou esquecer-se de que
    // ficou ligado) — por isso, ao contrário de só "ligar/desligar": (1) exige
    // escolher sempre um tempo limite, nunca fica indefinidamente ligado; (2)
    // mostra um aviso bem visível em toda a app enquanto durar, com um botão
    // para parar já, para nunca se partilhar sem se aperceber disso.
    function toggleShareLocation() {
        if (LOCATION.sharing) {
            stopShareLocation();
            return;
        }
        document.getElementById('modalLocationShareDuration').classList.add('active');
    }
    function startShareLocationWithDuration(minutes) {
        closeModal('modalLocationShareDuration');
        LOCATION.watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const { latitude: lat, longitude: lng, speed } = pos.coords;
                const now = Date.now();
                let speedKmh = speed != null && !isNaN(speed) ? speed * 3.6 : null;
                if (speedKmh == null && LOCATION.lastPoint) {
                    // Nem todo dispositivo fornece "speed" — calcula pela distância/tempo entre pontos
                    const meters = haversineMeters(LOCATION.lastPoint.lat, LOCATION.lastPoint.lng, lat, lng);
                    const seconds = (now - LOCATION.lastPoint.t) / 1000;
                    if (seconds > 0) speedKmh = (meters / seconds) * 3.6;
                }
                LOCATION.lastPoint = { lat, lng, t: now };
                socket.emit('location_update', {
                    roomId: APP.currentChatId,
                    lat, lng, speedKmh,
                    name: APP.user.name, phone: APP.user.phone
                });
                plotLocation(APP.user.phone, APP.user.name, lat, lng, speedKmh, true);
            },
            (err) => {
                alert('Não foi possível obter a localização: ' + err.message + ' (verifique se autorizou o GPS)');
                stopShareLocation();
            },
            { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
        );
        LOCATION.sharing = true;
        LOCATION.shareExpiresAt = Date.now() + minutes * 60 * 1000;
        clearTimeout(LOCATION.shareExpiryTimer);
        LOCATION.shareExpiryTimer = setTimeout(() => {
            stopShareLocation();
            alert('A tua partilha de localização terminou (tempo limite atingido).');
        }, minutes * 60 * 1000);
        clearInterval(LOCATION.shareBannerTicker);
        LOCATION.shareBannerTicker = setInterval(updateLocationSharingBanner, 30000);
        updateShareLocationBtn();
        updateLocationSharingBanner();
    }
    function stopShareLocation() {
        if (LOCATION.watchId != null) navigator.geolocation.clearWatch(LOCATION.watchId);
        LOCATION.watchId = null;
        LOCATION.sharing = false;
        LOCATION.lastPoint = null;
        LOCATION.myPoint = null;
        LOCATION.shareExpiresAt = null;
        clearTimeout(LOCATION.shareExpiryTimer);
        clearInterval(LOCATION.shareBannerTicker);
        updateETA();
        socket.emit('location_stop', { roomId: APP.currentChatId });
        updateShareLocationBtn();
        updateLocationSharingBanner();
    }
    function stopShareLocationFromBanner() {
        if (LOCATION.sharing) stopShareLocation();
    }
    // Aviso sempre visível (na barra lateral, não só dentro do ecrã de
    // localização) enquanto a partilha está ativa — mesmo que a pessoa mude
    // de conversa ou feche o ecrã do mapa sem parar explicitamente.
    function updateLocationSharingBanner() {
        const banner = document.getElementById('locationSharingBanner');
        if (!LOCATION.sharing || !LOCATION.shareExpiresAt) { banner.style.display = 'none'; return; }
        const endTime = new Date(LOCATION.shareExpiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        document.getElementById('locationSharingText').textContent = `📍 A partilhar a tua localização · termina às ${endTime}`;
        banner.style.display = 'flex';
    }

    // ==================== AMIGOS POR PERTO ====================
    // Radar opt-in de proximidade: mostra só CONTACTOS já existentes que
    // TAMBÉM tenham isto ativado, e só a distância aproximada — nunca a
    // localização exata de outra pessoa (o servidor é que calcula a
    // distância e nunca manda coordenadas de terceiros para o cliente, ver
    // socket 'nearby_request' no server.js). Continua o próprio dono da
    // localização quem decide ligar/desligar, tal como a partilha por tempo
    // limitado acima — nunca fica ativo por defeito.
    const NEARBY = { active: false, watchId: null, refreshInterval: null };
    function openNearbyFriendsModal() {
        document.getElementById('nearbyToggle').checked = NEARBY.active;
        renderNearbyFriendsList([]);
        if (NEARBY.active) socket.emit('nearby_request');
        document.getElementById('modalNearbyFriends').classList.add('active');
    }
    function toggleNearbyFriends(enabled) {
        if (enabled) startNearbySharing(); else stopNearbySharing();
    }
    function startNearbySharing() {
        if (!navigator.geolocation) { alert('Este navegador não suporta geolocalização.'); document.getElementById('nearbyToggle').checked = false; return; }
        NEARBY.watchId = navigator.geolocation.watchPosition(
            (pos) => {
                socket.emit('nearby_update', { lat: pos.coords.latitude, lng: pos.coords.longitude });
                socket.emit('nearby_request');
            },
            (err) => {
                alert('Não foi possível obter a localização: ' + err.message + ' (verifica se autorizaste o GPS)');
                stopNearbySharing();
            },
            { enableHighAccuracy: true, maximumAge: 60000, timeout: 15000 }
        );
        NEARBY.active = true;
        clearInterval(NEARBY.refreshInterval);
        NEARBY.refreshInterval = setInterval(() => socket.emit('nearby_request'), 30000);
    }
    function stopNearbySharing() {
        if (NEARBY.watchId != null) navigator.geolocation.clearWatch(NEARBY.watchId);
        NEARBY.watchId = null;
        NEARBY.active = false;
        clearInterval(NEARBY.refreshInterval);
        socket.emit('nearby_stop');
        document.getElementById('nearbyToggle').checked = false;
        renderNearbyFriendsList([]);
    }
    socket.on('nearby_result', (data) => renderNearbyFriendsList(data?.friends || []));
    // Arredonda a distância (a 50 m abaixo de 1 km) — evita parecer uma
    // posição precisa a mais, é só para dar uma ideia de "quão perto".
    function formatNearbyDistance(meters) {
        if (meters < 1000) return (Math.max(50, Math.round(meters / 50) * 50)) + ' m';
        return (meters / 1000).toFixed(1) + ' km';
    }
    function renderNearbyFriendsList(friends) {
        const el = document.getElementById('nearbyFriendsList');
        if (!NEARBY.active) { el.innerHTML = '<p style="color:#8696a0;text-align:center;padding:16px;font-size:13px;">Ativa para veres que amigos estão por perto agora.</p>'; return; }
        if (!friends.length) { el.innerHTML = '<p style="color:#8696a0;text-align:center;padding:16px;font-size:13px;">Nenhum amigo por perto neste momento.</p>'; return; }
        el.innerHTML = friends.map(f => `
            <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.06);border-radius:8px;padding:8px 10px;font-size:13px;">
                <span>${escapeHtml(f.name)}</span>
                <span style="opacity:0.8;">📍 ${formatNearbyDistance(f.distanceMeters)}</span>
            </div>`).join('');
    }

    // Desenha/atualiza o marcador e o trajeto (polyline) de uma pessoa no mapa
    function plotLocation(phone, name, lat, lng, speedKmh, isMe) {
        if (!LOCATION.map) return;
        if (!LOCATION.trails[phone]) LOCATION.trails[phone] = [];
        LOCATION.trails[phone].push([lat, lng]);
        if (LOCATION.trails[phone].length > 300) LOCATION.trails[phone].shift(); // limita o histórico do trajeto

        const label = (isMe ? 'Você' : name).charAt(0).toUpperCase();
        const modeText = inferTransportMode(speedKmh);
        const popupText = `<strong>${isMe ? 'Você' : name}</strong><br>${modeText}${speedKmh != null ? ' · ' + speedKmh.toFixed(1) + ' km/h' : ''}`;

        if (!LOCATION.markers[phone]) {
            const icon = L.divIcon({ className: 'user-location-icon', html: label, iconSize: [34, 34] });
            LOCATION.markers[phone] = L.marker([lat, lng], { icon }).addTo(LOCATION.map).bindPopup(popupText);
            LOCATION.polylines[phone] = L.polyline(LOCATION.trails[phone], { color: isMe ? '#25d366' : '#6c5ce7', weight: 4, opacity: 0.7 }).addTo(LOCATION.map);
        } else {
            LOCATION.markers[phone].setLatLng([lat, lng]).setPopupContent(popupText);
            LOCATION.polylines[phone].setLatLngs(LOCATION.trails[phone]);
        }
        LOCATION.map.panTo([lat, lng], { animate: true });
        if (isMe) LOCATION.myPoint = { lat, lng, speedKmh };
        else LOCATION.otherPoints[phone] = { lat, lng, speedKmh, name };
        updateETA();
    }

    // "A caminho": calcula quanto tempo falta para chegares junto de quem está a
    // partilhar localização contigo, usando a distância real e a tua velocidade
    // atual (se estiveres parado, usa uma velocidade média a pé como estimativa).
    function updateETA() {
        const box = document.getElementById('etaBox');
        if (!box) return;
        if (!LOCATION.myPoint || Object.keys(LOCATION.otherPoints).length === 0) { box.style.display = 'none'; return; }
        const lines = Object.values(LOCATION.otherPoints).map(p => {
            const meters = haversineMeters(LOCATION.myPoint.lat, LOCATION.myPoint.lng, p.lat, p.lng);
            const km = meters / 1000;
            const speed = LOCATION.myPoint.speedKmh > 2 ? LOCATION.myPoint.speedKmh : 5; // 5 km/h = estimativa a pé, se estiveres parado
            const minutes = Math.round((km / speed) * 60);
            return `📍 ${p.name}: ${km < 1 ? Math.round(meters) + 'm' : km.toFixed(1) + 'km'} · chegas em ~${minutes < 1 ? '<1' : minutes} min`;
        });
        box.textContent = lines.join(' · ');
        box.style.display = 'block';
    }

    function removeLocationMarker(phone) {
        if (LOCATION.markers[phone]) { LOCATION.map.removeLayer(LOCATION.markers[phone]); delete LOCATION.markers[phone]; }
        if (LOCATION.polylines[phone]) { LOCATION.map.removeLayer(LOCATION.polylines[phone]); delete LOCATION.polylines[phone]; }
        delete LOCATION.trails[phone];
        delete LOCATION.otherPoints[phone];
        updateETA();
    }

    socket.on('location_update_received', (data) => {
        if (!data || data.phone === APP.user?.phone) return; // ignora eco da própria localização
        plotLocation(data.phone, data.name, data.lat, data.lng, data.speedKmh, false);
    });
    socket.on('location_stop_received', (data) => {
        if (!data?.phone) return;
        removeLocationMarker(data.phone);
    });

    // ==================== TRADUTOR ====================
    // Mais de 6 dos idiomas mais falados do mundo. Cada código é o
    // parâmetro "target" aceito pelo endpoint /api/translate do servidor.
    const TRANSLATE_LANGUAGES = [
        { code: 'pt', label: '🇧🇷 Português' },
        { code: 'en', label: '🇺🇸 Inglês' },
        { code: 'es', label: '🇪🇸 Espanhol' },
        { code: 'zh-CN', label: '🇨🇳 Chinês (Mandarim)' },
        { code: 'hi', label: '🇮🇳 Hindi' },
        { code: 'ar', label: '🇸🇦 Árabe' },
        { code: 'fr', label: '🇫🇷 Francês' },
        { code: 'ru', label: '🇷🇺 Russo' },
        { code: 'de', label: '🇩🇪 Alemão' },
        { code: 'ja', label: '🇯🇵 Japonês' },
        { code: 'it', label: '🇮🇹 Italiano' },
    ];

    function openTranslatorModal() {
        const list = document.getElementById('translatorLangList');
        list.innerHTML = TRANSLATE_LANGUAGES.map(l => `
            <button class="btn-small ${APP.translatorLang === l.code ? 'btn-accept' : ''}" style="text-align:left;justify-content:flex-start;" onclick="selectTranslatorLang('${l.code}')">${l.label}${APP.translatorLang === l.code ? ' ✓' : ''}</button>
        `).join('');
        populateQuickTranslateSelect();
        document.getElementById('modalTranslator').classList.add('active');
    }

    function selectTranslatorLang(code) {
        APP.translatorLang = code;
        localStorage.setItem('translatorLang', code);
        openTranslatorModal(); // re-renderiza para marcar o selecionado
    }

    // ---- Tradutor rápido (extra dentro do mesmo modal): qualquer idioma dos
    // dois lados da lista — não depende da língua escolhida para as mensagens.
    function populateQuickTranslateSelect() {
        const from = document.getElementById('quickTransFrom');
        const to = document.getElementById('quickTransTo');
        if (!from.children.length) {
            from.innerHTML = TRANSLATE_LANGUAGES.map(l => `<option value="${l.code}">${l.label}</option>`).join('');
            from.value = 'pt';
        }
        if (!to.children.length) {
            to.innerHTML = TRANSLATE_LANGUAGES.map(l => `<option value="${l.code}">${l.label}</option>`).join('');
            to.value = (APP.translatorLang && APP.translatorLang !== 'pt') ? APP.translatorLang : 'en';
        }
    }
    let quickTransTimer = null;
    function debounceQuickTranslate() {
        clearTimeout(quickTransTimer);
        quickTransTimer = setTimeout(quickTranslate, 500);
    }
    async function quickTranslate() {
        const text = document.getElementById('quickTransInput').value.trim();
        const output = document.getElementById('quickTransOutput');
        if (!text) { output.textContent = ''; return; }
        const target = document.getElementById('quickTransTo').value;
        output.textContent = 'A traduzir...';
        try {
            const res = await fetch(`/api/translate?text=${encodeURIComponent(text)}&target=${encodeURIComponent(target)}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Falha');
            output.textContent = data.translated || '';
        } catch (e) {
            output.textContent = '⚠️ Não foi possível traduzir agora.';
        }
    }
    function swapQuickTranslate() {
        const fromSel = document.getElementById('quickTransFrom');
        const toSel = document.getElementById('quickTransTo');
        const input = document.getElementById('quickTransInput');
        const output = document.getElementById('quickTransOutput');
        // Ambos os lados têm a mesma lista de idiomas agora, por isso troca-se
        // sempre os dois por completo (já não há um lado limitado a PT/EN).
        const fromVal = fromSel.value;
        fromSel.value = toSel.value;
        toSel.value = fromVal;
        const currentOutput = output.textContent;
        input.value = (currentOutput === 'A traduzir...' || currentOutput.startsWith('⚠️')) ? '' : currentOutput;
        quickTranslate();
    }

    // Gravar um áudio e traduzir o que foi dito — reutiliza a mesma
    // transcrição em tempo real (Web Speech API) já usada nas mensagens de
    // voz do chat, só que aqui o texto reconhecido vai direto para o campo de
    // origem do tradutor rápido em vez de virar uma mensagem de áudio.
    const SPEECH_RECOGNITION_LOCALES = {
        pt: 'pt-PT', en: 'en-US', es: 'es-ES', 'zh-CN': 'zh-CN', hi: 'hi-IN',
        ar: 'ar-SA', fr: 'fr-FR', ru: 'ru-RU', de: 'de-DE', ja: 'ja-JP', it: 'it-IT'
    };
    let quickTransRecognition = null;
    function toggleQuickTransVoice() {
        if (quickTransRecognition) { quickTransRecognition.stop(); return; }
        const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognitionAPI) {
            alert('O teu navegador não suporta reconhecimento de voz (funciona no Chrome/Android; limitado no Safari/iPhone).');
            return;
        }
        const btn = document.getElementById('quickTransVoiceBtn');
        const input = document.getElementById('quickTransInput');
        try {
            quickTransRecognition = new SpeechRecognitionAPI();
            quickTransRecognition.continuous = true;
            quickTransRecognition.interimResults = false;
            quickTransRecognition.lang = SPEECH_RECOGNITION_LOCALES[document.getElementById('quickTransFrom').value] || 'pt-PT';
            let transcript = '';
            quickTransRecognition.onresult = (e) => {
                for (let i = e.resultIndex; i < e.results.length; i++) {
                    if (e.results[i].isFinal) transcript += e.results[i][0].transcript + ' ';
                }
                input.value = transcript.trim();
            };
            quickTransRecognition.onerror = () => {};
            quickTransRecognition.onend = () => {
                quickTransRecognition = null;
                btn.textContent = '🎤 Gravar áudio';
                btn.style.color = '';
                if (input.value.trim()) quickTranslate();
            };
            quickTransRecognition.start();
            btn.textContent = '🔴 A ouvir... (toca para parar)';
            btn.style.color = '#ef4444';
        } catch (e) {
            quickTransRecognition = null;
            alert('Não foi possível iniciar o reconhecimento de voz.');
        }
    }
    function copyQuickTransOutput(btnEl) {
        const text = document.getElementById('quickTransOutput').textContent;
        if (!text || text === 'A traduzir...') return;
        navigator.clipboard.writeText(text).then(() => {
            const original = btnEl.textContent;
            btnEl.textContent = '✅ Copiado!';
            setTimeout(() => { btnEl.textContent = original; }, 1500);
        }).catch(() => alert('Não foi possível copiar. Seleciona o texto manualmente.'));
    }

    async function translateMsg(msgId, btnEl) {
        const msgs = APP.messages[APP.currentChatId];
        if (!msgs) return;
        const msg = msgs.find(m => m.id === msgId);
        if (!msg) return;

        if (!APP.translatorLang) {
            openTranslatorModal();
            return;
        }

        // Se já traduzido para o idioma atual, apenas alterna mostrar/ocultar
        const container = document.getElementById('trans_' + msgId);
        if (msg.translatedLang === APP.translatorLang && msg.translatedText) {
            if (container) {
                container.style.display = container.style.display === 'none' ? 'block' : 'none';
            }
            return;
        }

        btnEl.textContent = '⏳';
        try {
            const res = await fetch(`/api/translate?text=${encodeURIComponent(msg.text)}&target=${encodeURIComponent(APP.translatorLang)}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Falha na tradução');
            msg.translatedText = data.translated;
            msg.translatedLang = APP.translatorLang;
            renderMessages();
        } catch (err) {
            btnEl.textContent = '🌐';
            alert('Não foi possível traduzir: ' + err.message);
        }
    }

    // ==================== IA NAS CONVERSAS ====================
    // 📝 Transcrever (mensagens de voz) e 💡 Sugerir respostas. Só correm quando
    // a pessoa carrega no botão: as conversas são encriptadas de ponta a ponta,
    // e estes pedidos mandam o áudio / as últimas mensagens ao Gemini (Google).
    function findMessageById(id) {
        for (const chatId of Object.keys(APP.messages || {})) {
            const m = (APP.messages[chatId] || []).find(x => x.id === id);
            if (m) return m;
        }
        return null;
    }
    async function transcribeAudioMessage(msgId, btn) {
        const msg = findMessageById(msgId);
        if (!msg || !msg.fileData) return;
        if (btn) { btn.disabled = true; btn.textContent = '⏳ A transcrever…'; }
        try {
            const res = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token || '' }, body: JSON.stringify({ fileData: msg.fileData, fileType: msg.fileType }) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Não foi possível transcrever.');
            msg.transcript = data.text;
            renderMessages();
        } catch (err) {
            if (btn) { btn.disabled = false; btn.textContent = '📝 Transcrever'; }
            alert('⚠️ ' + err.message);
        }
    }
    function smartReplyLastMessage() {
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat || chat.type === 'ai') return null;
        const msgs = (APP.messages[APP.currentChatId] || []).filter(m => !m.deleted && !m.system);
        const last = msgs[msgs.length - 1];
        if (!last || last.type !== 'received' || !(last.text || '').trim() || last.poll) return null;
        return { last, msgs };
    }
    function updateSmartRepliesBar() {
        const bar = document.getElementById('smartRepliesBar');
        if (!bar) return;
        const info = smartReplyLastMessage();
        if (!info || APP.smartRepliesDisabled) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
        APP.smartReplyCache = APP.smartReplyCache || {};
        const cached = APP.smartReplyCache[info.last.id];
        if (cached === 'hidden') { bar.style.display = 'none'; bar.innerHTML = ''; return; }
        const chip = (label, onclick, extra = '') => `<button class="btn-small smart-reply-chip" onclick="${onclick}" style="display:inline-block;margin-right:6px;border-radius:16px;padding:5px 12px;font-size:13px;${extra}">${label}</button>`;
        if (Array.isArray(cached)) {
            bar.innerHTML = cached.map((r, i) => chip(escapeHtml(r), `useSmartReply(${i})`)).join('') + chip('✕', 'hideSmartReplies()', 'opacity:.7;');
        } else if (cached === 'loading') {
            bar.innerHTML = chip('⏳ A pensar…', '', 'opacity:.8;');
        } else {
            bar.innerHTML = chip('💡 Sugerir respostas', 'requestSmartReplies()');
        }
        bar.style.display = 'block';
    }
    async function requestSmartReplies() {
        const info = smartReplyLastMessage();
        if (!info) return;
        const id = info.last.id;
        APP.smartReplyCache[id] = 'loading';
        updateSmartRepliesBar();
        try {
            const messages = info.msgs.slice(-8).map(m => ({ from: m.type === 'sent' ? 'me' : 'them', text: m.text || '' })).filter(m => m.text);
            const res = await fetch('/api/smart-replies', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token || '' }, body: JSON.stringify({ messages, lang: APP.uiLang }) });
            const data = await res.json().catch(() => ({}));
            if (res.status === 501) APP.smartRepliesDisabled = true; // Gemini não configurado neste servidor
            if (!res.ok) throw new Error(data.error || 'Não foi possível sugerir respostas.');
            APP.smartReplyCache[id] = data.replies;
        } catch (err) {
            delete APP.smartReplyCache[id];
            alert('⚠️ ' + err.message);
        }
        updateSmartRepliesBar();
    }
    function useSmartReply(i) {
        const info = smartReplyLastMessage();
        const replies = info && APP.smartReplyCache?.[info.last.id];
        if (!Array.isArray(replies) || !replies[i]) return;
        const input = document.getElementById('messageInput');
        input.value = replies[i];
        input.focus();
        hideSmartReplies();
    }
    function hideSmartReplies() {
        const info = smartReplyLastMessage();
        if (info) APP.smartReplyCache[info.last.id] = 'hidden';
        const bar = document.getElementById('smartRepliesBar');
        if (bar) { bar.style.display = 'none'; bar.innerHTML = ''; }
    }

    function renderMessages() {
        const msgDiv = document.getElementById('chatMessages');
        renderTopicChipsBar();
        if (!APP.currentChatId || !APP.messages[APP.currentChatId]) {
            msgDiv.innerHTML = '<p style="color:#8696a0;text-align:center;padding:40px;">Nenhuma mensagem ainda. Diga olá! 👋</p>';
            return;
        }
        const activeTopic = APP.activeTopic[APP.currentChatId] || null;
        const msgs = activeTopic ? APP.messages[APP.currentChatId].filter(m => m.topic === activeTopic) : APP.messages[APP.currentChatId];
        if (activeTopic && !msgs.length) {
            msgDiv.innerHTML = `<p style="color:#8696a0;text-align:center;padding:40px;">Ainda não há mensagens no tópico "${escapeHtml(activeTopic)}".</p>`;
            return;
        }
        const replyCounts = {};
        msgs.forEach(m => { if (m.replyTo?.id) replyCounts[m.replyTo.id] = (replyCounts[m.replyTo.id] || 0) + 1; });
        let html = '', lastDate = '';
        msgs.forEach(msg => {
            const msgDate = msg.time?.split(' ')[0] || '';
            if (msgDate && msgDate !== lastDate) {
                html += `<div class="date-divider"><span>${msgDate || 'Hoje'}</span></div>`;
                lastDate = msgDate;
            }
            const isSent = msg.type === 'sent';
            const currentChat = APP.chats.find(c => c.id === APP.currentChatId);
            const showSender = !isSent && currentChat && (currentChat.type === 'group' || currentChat.type === 'ai');
            const replyHtml = msg.replyTo ? `<div class="reply-quote"><strong>${escapeHtml(msg.replyTo.sender)}</strong><br>${escapeHtml((msg.replyTo.text || '').substring(0, 80))}</div>` : '';
            const threadCount = replyCounts[msg.id] || 0;
            const threadHtml = threadCount ? `<div style="font-size:11px;color:var(--blue);cursor:pointer;margin-top:2px;" onclick="openThread('${msg.id}')">🧵 ${threadCount} resposta${threadCount > 1 ? 's' : ''}</div>` : '';
            const isPinned = (APP.pinnedByChatId[APP.currentChatId] || []).some(p => p.messageId === msg.id);
            const pinnedLabel = isPinned ? '<div style="font-size:10px;opacity:0.7;margin-bottom:2px;">📌 Fixada</div>' : '';
            const topicLabel = (msg.topic && !activeTopic) ? `<div style="font-size:10px;opacity:0.7;margin-bottom:2px;">🗂️ ${escapeHtml(msg.topic)}</div>` : '';
            const forwardedLabel = msg.forwarded ? '<div style="font-size:10px;opacity:0.7;margin-bottom:2px;">↪️ Encaminhada</div>' : '';
            // Enquetes, jogos, despesas, listas de compras e fotos "ver uma vez" não fazem
            // sentido encaminhados (têm estado próprio, ou já desapareceram) — só conteúdo
            // "estático" (texto, foto/vídeo/áudio/documento normal) pode ser encaminhado.
            const canForward = !msg.deleted && !msg.poll && !msg.game && !msg.expense && !msg.shoppingList && !msg.viewOnce;
            const reactionsHtml = msg.reactions && Object.keys(msg.reactions).length ? `<div class="reaction-badges">${Object.entries(msg.reactions).map(([emoji, who]) => `<span class="reaction-badge">${emoji} ${who.length}</span>`).join('')}</div>` : '';
            const tick = isSent ? (msg.pending ? `<span class="msg-status" style="opacity:0.7;" title="Sem ligação — à espera para enviar">🕓</span>` : `<span class="msg-status" style="color:${msg.read ? '#53bdeb' : 'inherit'};">${msg.read ? '✓✓' : '✓'}</span>`) : '';
            const canEdit = isSent && !msg.deleted && !msg.fileData && !msg.encrypted;
            const editedLabel = msg.edited ? '<span style="opacity:0.6;font-size:10px;"> (editada)</span>' : '';
            const linkPreviewUrl = (!msg.deleted && !msg.poll && !msg.game && !msg.expense && !msg.shoppingList && !msg.fileData) ? extractFirstUrl(msg.text) : null;
            if (linkPreviewUrl) maybeFetchLinkPreview(msg, linkPreviewUrl);
            html += `
            <div class="message ${isSent ? 'sent' : 'received'}" data-msg-id="${msg.id}">
                ${showSender ? `<div class="sender-name">${escapeHtml(msg.sender)}</div>` : ''}
                ${pinnedLabel}
                ${topicLabel}
                ${forwardedLabel}
                ${replyHtml}
                ${msg.deleted ? `<em style="opacity:0.6;">🚫 Mensagem apagada</em>` : (msg.sosAlert ? renderSosAlertMessage(msg) : (msg.poll ? renderPoll(msg) : (msg.game ? (msg.game.type === 'checkers' ? renderCheckers(msg) : (msg.game.type === 'uno' ? renderUno(msg) : (msg.game.type === 'chess' ? renderChess(msg) : (msg.game.type === 'hangman' ? renderHangman(msg) : renderGame(msg))))) : (msg.expense ? renderExpense(msg) : (msg.shoppingList ? renderSharedShoppingList(msg) : ((msg.fileData || msg.viewOnce) ? renderAttachment(msg, isSent) : renderMessageBody(msg, APP.currentChatId)))))))}${editedLabel}
                <div id="trans_${msg.id}" style="display:${msg.translatedText ? 'block' : 'none'};margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.15);font-style:italic;color:#cfd6d9;">${msg.translatedText || ''}</div>
                ${linkPreviewUrl ? `<div id="linkpreview_${msg.id}">${renderLinkPreviewCard(msg.linkPreview)}</div>` : ''}
                ${reactionsHtml}
                ${threadHtml}
                <div class="time">
                    ${!msg.deleted ? `
                    <button onclick="replyToMessage('${msg.id}')" title="Responder" style="background:none;border:none;cursor:pointer;font-size:11px;padding:0 3px;vertical-align:middle;">↩️</button>
                    ${canForward ? `<button onclick="openForwardMessageModal('${msg.id}')" title="Encaminhar" style="background:none;border:none;cursor:pointer;font-size:11px;padding:0 3px;vertical-align:middle;">↪️</button>` : ''}
                    <button onclick="toggleReactionPicker('${msg.id}', this)" title="Reagir" style="background:none;border:none;cursor:pointer;font-size:11px;padding:0 3px;vertical-align:middle;">😀</button>
                    <button onclick="translateMsg('${msg.id}', this)" title="Traduzir" style="background:none;border:none;cursor:pointer;font-size:11px;padding:0 3px;vertical-align:middle;">🌐</button>
                    <button onclick="${isPinned ? `unpinMessage('${msg.id}')` : `pinMessage('${msg.id}')`}" title="${isPinned ? 'Desafixar' : 'Fixar'}" style="background:none;border:none;cursor:pointer;font-size:11px;padding:0 3px;vertical-align:middle;">📌</button>
                    ${canEdit ? `<button onclick="editMessage('${msg.id}')" title="Editar" style="background:none;border:none;cursor:pointer;font-size:11px;padding:0 3px;vertical-align:middle;">✏️</button>` : ''}
                    ${isSent ? `<button onclick="deleteMessage('${msg.id}')" title="Apagar" style="background:none;border:none;cursor:pointer;font-size:11px;padding:0 3px;vertical-align:middle;">🗑️</button>` : ''}
                    ` : ''}
                    ${msg.time?.split(' ')[1] || msg.time} ${tick}
                </div>
            </div>`;
        });
        msgDiv.innerHTML = html;
        msgDiv.scrollTop = msgDiv.scrollHeight;
        renderCallChatMessages();
        updateSmartRepliesBar();
    }

    // ==================== CANAIS/TÓPICOS DENTRO DE UM GRUPO ====================
    // Sub-conversas por assunto dentro do mesmo grupo, sem criar uma sala nova
    // a sério — é só uma etiqueta (msg.topic) nas mensagens em si, derivada
    // do histórico já carregado (tal como a galeria de mídia ou as
    // estatísticas), por isso não precisa de nada novo no servidor. Ver
    // README para o porquê de não ser uma sala/conversa à parte.
    function getChatTopics(chatId) {
        const topics = new Set();
        (APP.messages[chatId] || []).forEach(m => { if (m.topic && !m.deleted) topics.add(m.topic); });
        return [...topics];
    }
    function renderTopicChipsBar() {
        const bar = document.getElementById('topicChipsBar');
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat || chat.type !== 'group') { bar.style.display = 'none'; return; }
        const topics = getChatTopics(APP.currentChatId);
        const active = APP.activeTopic[APP.currentChatId] || null;
        bar.style.display = 'flex';
        const chipStyle = (isActive) => `display:inline-block;padding:5px 12px;border-radius:14px;font-size:12px;cursor:pointer;margin-right:6px;white-space:nowrap;${isActive ? 'background:var(--green);color:#fff;' : 'background:var(--bg-secondary);color:var(--text-primary);'}`;
        bar.innerHTML = `
            <span onclick="selectTopic(null)" style="${chipStyle(!active)}">🗂️ Tudo</span>
            ${topics.map(t => `<span onclick="selectTopic('${encodeURIComponent(t)}')" style="${chipStyle(active === t)}">${escapeHtml(t)}</span>`).join('')}
            <span onclick="promptNewTopic()" style="${chipStyle(false)}">➕ Novo tópico</span>
        `;
    }
    function selectTopic(topicEncoded) {
        if (!APP.currentChatId) return;
        APP.activeTopic[APP.currentChatId] = topicEncoded ? decodeURIComponent(topicEncoded) : null;
        renderMessages();
    }
    function promptNewTopic() {
        if (!APP.currentChatId) return;
        const name = prompt('Nome do novo tópico (ex.: Logística, Fotos, Ideias):');
        if (!name || !name.trim()) return;
        APP.activeTopic[APP.currentChatId] = name.trim().substring(0, 40);
        renderMessages();
    }

    // Espelho simplificado do chat, mostrado ao lado durante a videochamada
    function renderCallChatMessages() {
        const panel = document.getElementById('callChatMessages');
        if (!panel) return;
        const msgs = APP.messages[APP.currentChatId] || [];
        panel.innerHTML = msgs.map(msg => `
            <div class="message ${msg.type === 'sent' ? 'sent' : 'received'}">
                ${msg.type !== 'sent' ? `<div class="sender-name">${escapeHtml(msg.sender || '')}</div>` : ''}
                ${(msg.fileData || msg.viewOnce) ? renderAttachment(msg, msg.type === 'sent') : escapeHtml(msg.text || '')}
                <div class="time">${msg.time?.split(' ')[1] || msg.time || ''}</div>
            </div>`).join('') || '<p style="color:#8696a0;text-align:center;padding:20px;">Nenhuma mensagem ainda</p>';
        panel.scrollTop = panel.scrollHeight;
    }

    // ==================== FOTOS, DOCUMENTOS E MENSAGENS DE VOZ ====================
    const MAX_ATTACHMENT_MB = 10;

    function handleFileAttach(input) {
        const file = input.files[0];
        input.value = ''; // permite escolher o mesmo ficheiro outra vez depois
        if (!file || !APP.currentChatId) return;
        if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
            return alert(`Este ficheiro tem ${(file.size / 1024 / 1024).toFixed(1)}MB — o limite é ${MAX_ATTACHMENT_MB}MB.`);
        }
        const reader = new FileReader();
        reader.onload = () => {
            // Fotos passam por uma pré-visualização com a opção "ver uma vez"; os
            // outros tipos de ficheiro seguem direto, como já era antes.
            if (file.type.startsWith('image/')) openAttachmentPreview(reader.result, file.name, file.type);
            else sendAttachmentMessage(reader.result, file.name, file.type);
        };
        reader.onerror = () => alert('Não foi possível ler o ficheiro.');
        reader.readAsDataURL(file);
    }

    // ==================== FOTOS "VER UMA VEZ" ====================
    function openAttachmentPreview(dataUrl, fileName, fileType) {
        APP.pendingAttachment = { dataUrl, fileName, fileType };
        document.getElementById('viewOncePreviewImg').src = dataUrl;
        document.getElementById('viewOnceCheckbox').checked = false;
        document.getElementById('modalAttachmentPreview').classList.add('active');
    }
    function cancelAttachmentPreview() {
        APP.pendingAttachment = null;
        closeModal('modalAttachmentPreview');
    }
    function confirmSendAttachment() {
        const pending = APP.pendingAttachment;
        if (!pending) return;
        const viewOnce = document.getElementById('viewOnceCheckbox').checked;
        APP.pendingAttachment = null;
        closeModal('modalAttachmentPreview');
        sendAttachmentMessage(pending.dataUrl, pending.fileName, pending.fileType, null, viewOnce);
    }

    // ==================== EDITOR DE FOTO ANTES DE ENVIAR ====================
    // Tudo feito no browser, em cima da imagem já escolhida (APP.pendingAttachment) — ao
    // gravar, só substitui o dataUrl pendente; o resto do fluxo de envio (pré-visualização,
    // "ver uma vez", upload) continua exatamente igual, uma foto editada não se distingue
    // de uma não editada a partir daí. Nomes com o prefixo "photoEditor"/"PHOTO_EDITOR" de
    // propósito, para não colidir com o quadro branco partilhado (outro <canvas> já existente).
    const PHOTO_EDITOR = {
        canvas: null, ctx: null, tool: null, originalDataUrl: null, selectedEmoji: null,
        history: [], drawing: false, lastX: 0, lastY: 0, cropStart: null, cropRect: null, cropSnapshot: null,
        eventsInitialized: false
    };
    // 'target' deixa o editor ser reaproveitado por qualquer sítio que precise de editar uma
    // imagem antes de a usar (anexo de conversa, foto de um estado, o que aparecer a seguir) —
    // só precisa de dizer de onde vem a imagem e o que fazer com o resultado ao gravar. Omitido,
    // mantém o comportamento original (editar o anexo pendente de uma conversa).
    let PE_TARGET = null;
    function openPhotoEditor(target) {
        if (!target) {
            const pending = APP.pendingAttachment;
            if (!pending) return;
            target = {
                dataUrl: pending.dataUrl,
                onSave: (dataUrl) => {
                    APP.pendingAttachment.dataUrl = dataUrl;
                    APP.pendingAttachment.fileType = 'image/png';
                    document.getElementById('viewOncePreviewImg').src = dataUrl;
                }
            };
        }
        PE_TARGET = target;
        PHOTO_EDITOR.originalDataUrl = target.dataUrl;
        PHOTO_EDITOR.history = [];
        PHOTO_EDITOR.cropRect = null;
        PE_TAINTED_WARNED = false;
        setPhotoEditorTool(null);
        cancelPhotoEditorTextInput(); // segurança: garante que não fica um campo de texto órfão aberto de uma sessão anterior
        document.getElementById('modalPhotoEditor').classList.add('active');
        loadImageIntoPhotoEditor(target.dataUrl);
        if (!PHOTO_EDITOR.eventsInitialized) { initPhotoEditorCanvasEvents(); PHOTO_EDITOR.eventsInitialized = true; }
    }
    // Bug real reportado: pedir crossOrigin='anonymous' sempre (para poder ler/gravar o
    // canvas com uma imagem já num URL remoto, ex. Cloudinary) faz o carregamento falhar por
    // completo — canvas preto, sem imagem nenhuma — quando esse servidor não envia os
    // cabeçalhos de CORS certos, em vez de só impedir ler os pixels mais tarde. Agora tenta
    // primeiro SEM crossOrigin (mostra a imagem em quase todos os casos, incluindo Cloudinary
    // sem CORS); só falha mesmo mais tarde, ao tentar gravar/cortar, e nessa altura mostra um
    // aviso claro em vez de rebentar (ver savePhotoEdit/applyPhotoEditorCrop/pushPhotoEditorHistory).
    // Também nunca deixa o canvas com um tamanho enorme de uma sessão anterior enquanto uma
    // imagem nova ainda não carregou (ou falha a carregar) — era por isso que o ecrã parecia
    // "preso": ficava um retângulo preto gigante a esconder os botões Cancelar/Guardar.
    function loadImageIntoPhotoEditor(dataUrl) {
        const canvas = document.getElementById('photoEditorCanvas');
        canvas.width = 300;
        canvas.height = 300;
        PHOTO_EDITOR.canvas = canvas;
        PHOTO_EDITOR.ctx = canvas.getContext('2d');
        PHOTO_EDITOR.ctx.clearRect(0, 0, canvas.width, canvas.height);
        const img = new Image();
        let settled = false;
        const giveUp = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            alert('⚠️ Não foi possível carregar esta imagem para editar. Tenta escolher a foto de novo.');
            closeModal('modalPhotoEditor');
        };
        const timeoutId = setTimeout(giveUp, 12000); // nunca fica à espera para sempre de uma rede lenta/presa
        img.onerror = giveUp;
        img.onload = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            // Limita o tamanho de trabalho para não travar com fotos enormes de telemóvel
            const maxDim = 900;
            const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            PHOTO_EDITOR.ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = dataUrl;
    }
    function setPhotoEditorTool(tool) {
        PHOTO_EDITOR.tool = tool;
        PHOTO_EDITOR.selectedEmoji = null;
        PHOTO_EDITOR.cropRect = null;
        ['Crop', 'Draw', 'Text', 'Emoji'].forEach(t => document.getElementById('peTool' + t).classList.remove('btn-accept'));
        if (tool) document.getElementById('peTool' + tool.charAt(0).toUpperCase() + tool.slice(1)).classList.add('btn-accept');
        document.getElementById('peDrawOptions').style.display = tool === 'draw' ? 'flex' : 'none';
        document.getElementById('peEmojiOptions').style.display = tool === 'emoji' ? 'flex' : 'none';
        document.getElementById('peCropOptions').style.display = tool === 'crop' ? 'block' : 'none';
    }
    function selectPhotoEditorEmoji(emoji) { PHOTO_EDITOR.selectedEmoji = emoji; }
    // Campo de texto de verdade em cima da imagem (position:fixed, no ponto onde se tocou) em
    // vez de prompt() — dá para reler/corrigir o que se escreveu antes de confirmar (Enter) ou
    // desistir (Escape/tocar fora), sem o aspeto de caixa de diálogo do sistema.
    let PE_TEXT_PENDING_POS = null;
    function showPhotoEditorTextInput(canvasPos, clientX, clientY) {
        PE_TEXT_PENDING_POS = canvasPos;
        const input = document.getElementById('peTextOverlayInput');
        input.value = '';
        input.style.left = clientX + 'px';
        input.style.top = clientY + 'px';
        input.style.display = 'block';
        input.focus();
    }
    function commitPhotoEditorTextInput() {
        const input = document.getElementById('peTextOverlayInput');
        const text = input.value.trim();
        input.style.display = 'none';
        if (text && PE_TEXT_PENDING_POS) {
            pushPhotoEditorHistory();
            PHOTO_EDITOR.ctx.fillStyle = document.getElementById('peColor').value;
            PHOTO_EDITOR.ctx.font = '28px sans-serif';
            PHOTO_EDITOR.ctx.fillText(text, PE_TEXT_PENDING_POS.x, PE_TEXT_PENDING_POS.y);
        }
        PE_TEXT_PENDING_POS = null;
    }
    function cancelPhotoEditorTextInput() {
        document.getElementById('peTextOverlayInput').style.display = 'none';
        PE_TEXT_PENDING_POS = null;
    }
    // Se a imagem veio de um URL remoto sem CORS (ver loadImageIntoPhotoEditor), o canvas
    // carrega e mostra-se na mesma, mas fica "contaminado": desenhar/escrever continua a
    // funcionar (só WRITE), só ler os pixels de volta (toDataURL/getImageData — cortar,
    // desfazer, gravar) é que falha. Este aviso só aparece uma vez por sessão do editor,
    // para não repetir o mesmo alerta a cada traço de desenho.
    let PE_TAINTED_WARNED = false;
    function photoEditorTaintedError() {
        if (PE_TAINTED_WARNED) return;
        PE_TAINTED_WARNED = true;
        alert('⚠️ Esta foto está guardada num servidor que não permite editá-la aqui (cortar/desfazer/gravar) — mas continuas a poder vê-la. Escolhe/tira a foto de novo (em vez de reaproveitar uma já enviada) para conseguires editá-la.');
    }
    // Guarda um "antes" (como imagem, não só pixels) para o desfazer conseguir repor também
    // as dimensões do canvas — importante depois de um corte, que muda o tamanho da tela.
    function pushPhotoEditorHistory() {
        try {
            PHOTO_EDITOR.history.push(PHOTO_EDITOR.canvas.toDataURL());
            if (PHOTO_EDITOR.history.length > 20) PHOTO_EDITOR.history.shift();
        } catch (err) {
            photoEditorTaintedError();
        }
    }
    function undoPhotoEdit() {
        if (!PHOTO_EDITOR.history.length) return;
        const prev = PHOTO_EDITOR.history.pop();
        const img = new Image();
        img.onload = () => {
            PHOTO_EDITOR.canvas.width = img.width;
            PHOTO_EDITOR.canvas.height = img.height;
            PHOTO_EDITOR.ctx.drawImage(img, 0, 0);
        };
        img.src = prev;
    }
    function resetPhotoEdit() {
        PHOTO_EDITOR.history = [];
        loadImageIntoPhotoEditor(PHOTO_EDITOR.originalDataUrl);
    }
    // Converte a posição do rato/toque (em pixels do ecrã) para pixels reais do canvas —
    // preciso porque o canvas é mostrado redimensionado (max-width:100%) mas os desenhos
    // têm de acertar nos pixels verdadeiros da imagem, não nos do ecrã.
    function photoEditorCanvasPos(e) {
        const canvas = PHOTO_EDITOR.canvas;
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (canvas.width / rect.width),
            y: (e.clientY - rect.top) * (canvas.height / rect.height)
        };
    }
    function initPhotoEditorCanvasEvents() {
        const canvas = document.getElementById('photoEditorCanvas');
        canvas.addEventListener('pointerdown', (e) => {
            if (!PHOTO_EDITOR.tool) return;
            e.preventDefault(); // sem isto, o foco que a ferramenta "texto" dá ao campo de texto era imediatamente roubado de volta pelo comportamento por omissão do toque/clique no canvas
            const pos = photoEditorCanvasPos(e);
            if (PHOTO_EDITOR.tool === 'draw') {
                pushPhotoEditorHistory();
                PHOTO_EDITOR.drawing = true;
                PHOTO_EDITOR.lastX = pos.x;
                PHOTO_EDITOR.lastY = pos.y;
            } else if (PHOTO_EDITOR.tool === 'crop') {
                try {
                    PHOTO_EDITOR.cropSnapshot = PHOTO_EDITOR.ctx.getImageData(0, 0, PHOTO_EDITOR.canvas.width, PHOTO_EDITOR.canvas.height);
                    PHOTO_EDITOR.cropStart = pos;
                } catch (err) {
                    photoEditorTaintedError();
                }
            } else if (PHOTO_EDITOR.tool === 'text') {
                showPhotoEditorTextInput(pos, e.clientX, e.clientY);
            } else if (PHOTO_EDITOR.tool === 'emoji' && PHOTO_EDITOR.selectedEmoji) {
                pushPhotoEditorHistory();
                PHOTO_EDITOR.ctx.font = '48px sans-serif';
                PHOTO_EDITOR.ctx.fillText(PHOTO_EDITOR.selectedEmoji, pos.x, pos.y);
            }
        });
        canvas.addEventListener('pointermove', (e) => {
            const pos = photoEditorCanvasPos(e);
            if (PHOTO_EDITOR.tool === 'draw' && PHOTO_EDITOR.drawing) {
                const ctx = PHOTO_EDITOR.ctx;
                ctx.strokeStyle = document.getElementById('peColor').value;
                ctx.lineWidth = document.getElementById('peBrushSize').value;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(PHOTO_EDITOR.lastX, PHOTO_EDITOR.lastY);
                ctx.lineTo(pos.x, pos.y);
                ctx.stroke();
                PHOTO_EDITOR.lastX = pos.x;
                PHOTO_EDITOR.lastY = pos.y;
            } else if (PHOTO_EDITOR.tool === 'crop' && PHOTO_EDITOR.cropStart) {
                // Repõe a imagem limpa (sem o retângulo de seleção anterior) e desenha-o
                // de novo na posição atual — nunca "suja" o canvas de forma permanente.
                PHOTO_EDITOR.ctx.putImageData(PHOTO_EDITOR.cropSnapshot, 0, 0);
                PHOTO_EDITOR.ctx.strokeStyle = '#00ff00';
                PHOTO_EDITOR.ctx.lineWidth = 2;
                PHOTO_EDITOR.ctx.strokeRect(PHOTO_EDITOR.cropStart.x, PHOTO_EDITOR.cropStart.y, pos.x - PHOTO_EDITOR.cropStart.x, pos.y - PHOTO_EDITOR.cropStart.y);
            }
        });
        canvas.addEventListener('pointerup', (e) => {
            if (PHOTO_EDITOR.tool === 'draw') PHOTO_EDITOR.drawing = false;
            if (PHOTO_EDITOR.tool === 'crop' && PHOTO_EDITOR.cropStart) {
                const pos = photoEditorCanvasPos(e);
                const x = Math.min(PHOTO_EDITOR.cropStart.x, pos.x), y = Math.min(PHOTO_EDITOR.cropStart.y, pos.y);
                const w = Math.abs(pos.x - PHOTO_EDITOR.cropStart.x), h = Math.abs(pos.y - PHOTO_EDITOR.cropStart.y);
                PHOTO_EDITOR.ctx.putImageData(PHOTO_EDITOR.cropSnapshot, 0, 0); // tira o retângulo da vista, só fica guardado em cropRect
                PHOTO_EDITOR.cropRect = { x, y, w, h };
                PHOTO_EDITOR.cropStart = null;
            }
        });
    }
    function applyPhotoEditorCrop() {
        const rect = PHOTO_EDITOR.cropRect;
        if (!rect || rect.w < 5 || rect.h < 5) return alert('Arrasta na imagem para escolher a área a cortar primeiro.');
        try {
            pushPhotoEditorHistory();
            const imgData = PHOTO_EDITOR.ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
            PHOTO_EDITOR.canvas.width = rect.w;
            PHOTO_EDITOR.canvas.height = rect.h;
            PHOTO_EDITOR.ctx.putImageData(imgData, 0, 0);
            PHOTO_EDITOR.cropRect = null;
        } catch (err) {
            photoEditorTaintedError();
        }
    }
    function savePhotoEdit() {
        // De propósito NÃO fecha o modal se isto falhar — "Cancelar" continua sempre
        // disponível para sair, mesmo quando esta foto não pode ser gravada editada.
        try {
            const dataUrl = PHOTO_EDITOR.canvas.toDataURL('image/png');
            if (PE_TARGET?.onSave) PE_TARGET.onSave(dataUrl);
            closeModal('modalPhotoEditor');
        } catch (err) {
            photoEditorTaintedError();
        }
    }

    // Só quem recebe é que perde o acesso à foto depois de a abrir uma vez — quem
    // envia mantém sempre o seu próprio ficheiro (é a foto que a própria pessoa
    // tirou/escolheu, não faz sentido escondê-la de quem a enviou).
    function openViewOnceImage(msgId) {
        const msg = (APP.messages[APP.currentChatId] || []).find(m => m.id === msgId);
        if (!msg || !msg.fileData || msg.viewOnceOpened) return;
        openImageFullscreen(msgId);
        msg.viewOnceOpened = true;
        msg.fileData = null;
        renderMessages();
        socket.emit('view_once_opened', { chatId: APP.currentChatId, messageId: msgId });
    }
    socket.on('view_once_opened_received', (data) => {
        const msgs = APP.messages[data.chatId];
        if (!msgs) return;
        const msg = msgs.find(m => m.id === data.messageId);
        if (msg) { msg.viewOnceOpened = true; msg.fileData = null; }
        if (APP.currentChatId === data.chatId) renderMessages();
    });

    // ==================== PESQUISA DENTRO DE ANEXOS (PDF/texto) ====================
    // O pdf.js só é carregado quando é mesmo preciso (mesmo padrão do jsPDF da lista de
    // compras) — não pesa no carregamento normal da app para quem nunca envia um PDF.
    let PDFJS_LOAD_PROMISE = null;
    function ensurePdfJsLoaded() {
        if (window.pdfjsLib) return Promise.resolve();
        if (PDFJS_LOAD_PROMISE) return PDFJS_LOAD_PROMISE;
        PDFJS_LOAD_PROMISE = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
            script.onload = () => {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
                resolve();
            };
            script.onerror = () => { PDFJS_LOAD_PROMISE = null; reject(new Error('Não foi possível carregar o leitor de PDF.')); };
            document.head.appendChild(script);
        });
        return PDFJS_LOAD_PROMISE;
    }
    const MAX_ATTACHMENT_TEXT_CHARS = 20000; // chega para pesquisar sem guardar o documento inteiro dentro da mensagem
    // Extrai o texto de PDFs e ficheiros .txt para dar para pesquisar o CONTEÚDO do
    // anexo na pesquisa global, não só o nome do ficheiro. Word/.docx ainda não têm
    // suporte (precisava de outra biblioteca só para isso) — fica só o nome pesquisável,
    // como já era antes desta funcionalidade.
    async function extractAttachmentText(dataUrl, fileName, fileType) {
        try {
            const isPdf = fileType === 'application/pdf' || /\.pdf$/i.test(fileName || '');
            const isTxt = fileType === 'text/plain' || /\.txt$/i.test(fileName || '');
            if (!isPdf && !isTxt) return null;
            const base64 = (dataUrl.split(',')[1] || '');
            if (isTxt) {
                return decodeURIComponent(escape(atob(base64))).slice(0, MAX_ATTACHMENT_TEXT_CHARS);
            }
            await ensurePdfJsLoaded();
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
            let text = '';
            for (let p = 1; p <= Math.min(pdf.numPages, 30); p++) { // limite de páginas para não travar em PDFs enormes
                const page = await pdf.getPage(p);
                const content = await page.getTextContent();
                text += content.items.map(it => it.str).join(' ') + '\n';
                if (text.length > MAX_ATTACHMENT_TEXT_CHARS) break;
            }
            return text.trim().slice(0, MAX_ATTACHMENT_TEXT_CHARS) || null;
        } catch (e) {
            console.warn('Não foi possível extrair texto do anexo para pesquisa:', e.message);
            return null;
        }
    }

    async function sendAttachmentMessage(dataUrl, fileName, fileType, transcript, viewOnce) {
        const now = new Date();
        const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const msgId = 'm' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const isImage = (fileType || '').startsWith('image/');
        const isAudio = (fileType || '').startsWith('audio/');
        const text = viewOnce ? '👁️ Foto (ver uma vez)' : (isImage ? '📷 Foto' : (isAudio ? '🎤 Mensagem de voz' : `📎 ${fileName}`));
        const attachmentText = viewOnce ? null : await extractAttachmentText(dataUrl, fileName, fileType);
        // Mostra já localmente com o ficheiro original — não espera pelo upload para dar feedback instantâneo
        const payload = { id: msgId, sender: 'Você', text, time, type: 'sent', read: false, fileData: dataUrl, fileName, fileType, transcript: transcript || null, viewOnce: !!viewOnce, attachmentText };
        if (!APP.messages[APP.currentChatId]) APP.messages[APP.currentChatId] = [];
        APP.messages[APP.currentChatId].push(payload);
        renderMessages();
        renderChatList();
        const chat = APP.chats.find(c => c.id === APP.currentChatId);

        // Tenta enviar para armazenamento externo (Cloudinary) para não sobrecarregar
        // a base de dados com base64 — se não estiver configurado, usa o método antigo.
        let outgoingFileData = dataUrl;
        try {
            const res = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token || '' }, body: JSON.stringify({ fileData: dataUrl }) });
            const data = await res.json();
            if (data.success && data.url) outgoingFileData = data.url;
        } catch (e) {
            // sem internet momentânea ou erro qualquer — segue com o base64 mesmo, não bloqueia o envio
        }

        if (chat?.type === 'ai') {
            // Para a IA analisar, o URL público do Cloudinary é sempre preferível ao
            // base64 (mais leve no pedido); se não houver Cloudinary configurado,
            // o base64 em si também funciona como image_url no formato OpenAI/inline_data do Gemini.
            payload.fileData = outgoingFileData;
            askGeminiAssistant(APP.currentChatId);
            return;
        }

        socket.emit('send_message', {
            id: msgId, chatId: APP.currentChatId, sender: APP.user.name, senderPhone: APP.user.phone,
            toPhone: chat.type === 'user' ? chat.phone : undefined,
            text, time, fileData: outgoingFileData, fileName, fileType, transcript: transcript || null, viewOnce: !!viewOnce, attachmentText
        });
    }

    // ---- Assistente Gemini (Google) — aceita texto, fotos, vídeos e documentos ----
    function messageToGeminiHistory(m) {
        const entry = { role: m.type === 'sent' ? 'user' : 'model' };
        if (m.fileData) {
            entry.fileData = m.fileData;
            entry.fileType = m.fileType || 'application/octet-stream';
            entry.text = (m.transcript ? `[Transcrição do áudio]: "${m.transcript}"` : '') || (m.text && !['📷 Foto', '🎥 Vídeo', '🎤 Mensagem de voz'].includes(m.text) ? m.text : '');
        } else {
            entry.text = m.text;
        }
        return entry;
    }
    function askGeminiAssistant(chatId) {
        document.getElementById('chatSubtitle').textContent = chatId === APP.currentChatId ? 'Gemini (Google) · digitando...' : document.getElementById('chatSubtitle').textContent;
        const history = APP.messages[chatId].slice(-12).map(messageToGeminiHistory).filter(h => h.text || h.fileData);
        fetch('/api/gemini-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token || '' },
            body: JSON.stringify({ history })
        })
            .then(r => r.json().then(data => ({ ok: r.ok, data })))
            .then(({ ok, data }) => {
                const replyText = ok ? (data.reply || 'Não consegui responder agora.') : ('⚠️ ' + (data.error || 'O Gemini não está disponível agora.'));
                APP.messages[chatId].push({ id: 'm' + Date.now() + 1, sender: 'Gemini', text: replyText, time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), type: 'received' });
                if (APP.currentChatId === chatId) { renderMessages(); document.getElementById('chatSubtitle').textContent = 'Gemini (Google) · respondendo instantaneamente'; }
                renderChatList();
            })
            .catch(() => {
                APP.messages[chatId].push({ id: 'm' + Date.now() + 1, sender: 'Gemini', text: '⚠️ Não foi possível ligar ao servidor do Gemini. Tente novamente.', time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), type: 'received' });
                if (APP.currentChatId === chatId) { renderMessages(); document.getElementById('chatSubtitle').textContent = 'Gemini (Google) · respondendo instantaneamente'; }
                renderChatList();
            });
    }

    // Cicla a velocidade de reprodução de uma mensagem de voz (1x → 1.5x → 2x → 0.75x)
    function cycleAudioSpeed(audioId, btn) {
        const audio = document.getElementById(audioId);
        if (!audio) return;
        const speeds = [1, 1.5, 2, 0.75];
        const idx = (speeds.indexOf(audio.playbackRate) + 1) % speeds.length;
        audio.playbackRate = speeds[idx];
        btn.textContent = speeds[idx] + 'x';
    }

    function renderAttachment(msg, isSent) {
        const type = msg.fileType || '';
        if (msg.viewOnce && !isSent) {
            // Quem recebe só vê a foto quando toca, e só uma vez — depois disso o
            // próprio servidor já apagou o ficheiro (ver 'view_once_opened').
            if (msg.viewOnceOpened || !msg.fileData) {
                return `<div style="opacity:0.6;font-style:italic;padding:8px 0;">👁️ Foto vista</div>`;
            }
            return `<div onclick="openViewOnceImage('${msg.id}')" style="cursor:pointer;background:rgba(0,0,0,0.15);border-radius:8px;padding:16px;margin-top:4px;text-align:center;">👁️ Toca para ver<br><span style="font-size:11px;opacity:0.75;">Desaparece depois de aberta</span></div>`;
        }
        if (!msg.fileData) return '';
        if (type.startsWith('image/')) {
            const viewOnceBadge = msg.viewOnce ? `<div style="font-size:11px;opacity:0.75;margin-top:2px;">👁️ Ver uma vez${msg.viewOnceOpened ? ' · vista' : ''}</div>` : '';
            return `<img src="${msg.fileData}" style="max-width:100%;border-radius:8px;margin-top:4px;cursor:pointer;" onclick="openImageFullscreen('${msg.id}')">${viewOnceBadge}`;
        }
        if (type.startsWith('video/')) {
            return `<video controls src="${msg.fileData}" style="max-width:100%;border-radius:8px;margin-top:4px;"></video>`;
        }
        if (type.startsWith('audio/')) {
            const transcriptHtml = msg.transcript
                ? `<div class="msg-transcript" style="font-size:11px;opacity:0.75;font-style:italic;margin-top:3px;max-width:220px;">📝 "${escapeHtml(msg.transcript)}"</div>`
                : `<button class="transcribe-btn" onclick="transcribeAudioMessage('${msg.id}', this)" title="Transcrever com IA" style="background:var(--bg-tertiary);border:none;border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;color:inherit;margin-top:4px;">📝 Transcrever</button>`;
            return `<div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
                <audio controls id="audio_${msg.id}" src="${msg.fileData}" style="max-width:200px;"></audio>
                <button onclick="cycleAudioSpeed('audio_${msg.id}', this)" title="Velocidade de reprodução" style="background:var(--bg-tertiary);border:none;border-radius:6px;padding:3px 7px;font-size:11px;cursor:pointer;color:inherit;flex:0 0 auto;">1x</button>
            </div>${transcriptHtml}`;
        }
        return `<a href="${msg.fileData}" download="${msg.fileName || 'ficheiro'}" style="display:flex;align-items:center;gap:6px;background:rgba(0,0,0,0.15);padding:8px;border-radius:8px;margin-top:4px;color:inherit;text-decoration:none;">📄 <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${msg.fileName || 'ficheiro'}</span></a>`;
    }

    // ==================== PRÉ-VISUALIZAÇÃO DE LINKS ====================
    // Mostra um cartão com título/imagem/descrição para o primeiro URL de uma
    // mensagem, tal como WhatsApp/Telegram — pedido ao /api/link-preview (o
    // servidor é que vai buscar a página, nunca o navegador de quem lê a
    // mensagem, para não revelar quem viu o link nem passar por CORS).
    const URL_REGEX = /(https?:\/\/[^\s<]+)/i;
    function extractFirstUrl(text) {
        const m = (text || '').match(URL_REGEX);
        return m ? m[1].replace(/[),.;!?]+$/, '') : null; // tira pontuação a seguir ao link, comum numa frase
    }
    function renderLinkPreviewCard(preview) {
        if (!preview || preview === 'pending' || preview === 'none' || (!preview.title && !preview.image && !preview.description)) return '';
        return `<a href="${preview.url}" target="_blank" rel="noopener noreferrer" style="display:flex;gap:8px;margin-top:6px;background:rgba(0,0,0,0.15);border-radius:8px;overflow:hidden;text-decoration:none;color:inherit;max-width:280px;">
            ${preview.image ? `<img src="${preview.image}" style="width:70px;height:70px;object-fit:cover;flex:0 0 auto;">` : ''}
            <div style="padding:6px 8px;overflow:hidden;min-width:0;">
                <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(preview.title || preview.url)}</div>
                ${preview.description ? `<div style="font-size:11px;opacity:0.75;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(preview.description)}</div>` : ''}
            </div>
        </a>`;
    }
    async function maybeFetchLinkPreview(msg, url) {
        if (msg.linkPreview) return; // já pedido (mesmo sem resultado — 'none' evita tentar de novo a cada render)
        msg.linkPreview = 'pending';
        try {
            const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
            const data = await res.json();
            msg.linkPreview = (res.ok && (data.title || data.image || data.description)) ? data : 'none';
        } catch (e) {
            msg.linkPreview = 'none';
        }
        const container = document.getElementById(`linkpreview_${msg.id}`);
        if (container) container.innerHTML = renderLinkPreviewCard(msg.linkPreview);
    }

    // ==================== GIFS E STICKERS (Giphy) ====================
    // Ao contrário de fotos/vídeos enviados do telemóvel, um GIF/sticker já
    // está hospedado para sempre no CDN da Giphy — por isso a mensagem só
    // guarda esse URL diretamente (fileData), sem passar pelo /api/upload
    // (que é só para converter os ficheiros que a própria pessoa envia).
    let GIF_MODE = 'gifs';
    let GIF_RESULTS = [];
    let gifSearchTimer = null;
    function openGifPickerModal() {
        document.getElementById('modalGifPicker').classList.add('active');
        document.getElementById('gifSearchInput').value = '';
        switchGifTab('gifs');
    }
    function switchGifTab(mode) {
        GIF_MODE = mode;
        document.getElementById('gifTabGifs').classList.toggle('btn-accept', mode === 'gifs');
        document.getElementById('gifTabStickers').classList.toggle('btn-accept', mode === 'stickers');
        loadGifs(document.getElementById('gifSearchInput').value.trim());
    }
    function debounceGifSearch() {
        clearTimeout(gifSearchTimer);
        gifSearchTimer = setTimeout(() => loadGifs(document.getElementById('gifSearchInput').value.trim()), 400);
    }
    async function loadGifs(query) {
        const grid = document.getElementById('gifResultsGrid');
        grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-secondary);">A carregar...</p>';
        try {
            const res = await fetch(`/api/gifs/search?q=${encodeURIComponent(query)}&type=${GIF_MODE}`, { headers: { 'x-auth-token': APP.token || '' } });
            const data = await res.json();
            if (res.status === 401) {
                grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-secondary);padding:20px;">⚠️ Sessão expirada — volta a entrar na app.</p>';
                return;
            }
            if (!data.configured) {
                grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-secondary);padding:20px;">GIFs/Stickers não configurados neste servidor (falta a chave da Giphy — ver README).</p>';
                return;
            }
            GIF_RESULTS = data.results || [];
            if (!GIF_RESULTS.length) {
                grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-secondary);padding:20px;">Nada encontrado.</p>';
                return;
            }
            grid.innerHTML = GIF_RESULTS.map((g, i) => `<img src="${g.preview}" loading="lazy" style="width:100%;border-radius:6px;cursor:pointer;aspect-ratio:1;object-fit:cover;background:var(--bg-tertiary);" onclick="sendGifMessage(${i})" title="${escapeHtml(g.title)}">`).join('');
        } catch (e) {
            grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-secondary);padding:20px;">⚠️ Não foi possível pesquisar agora.</p>';
        }
    }
    function sendGifMessage(index) {
        const gif = GIF_RESULTS[index];
        if (!gif || !APP.currentChatId) return;
        closeModal('modalGifPicker');
        const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const msgId = 'm' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const label = GIF_MODE === 'stickers' ? '✨ Sticker' : '🎬 GIF';
        if (!APP.messages[APP.currentChatId]) APP.messages[APP.currentChatId] = [];
        APP.messages[APP.currentChatId].push({ id: msgId, sender: 'Você', text: label, time, type: 'sent', read: false, fileData: gif.full, fileName: 'gif.gif', fileType: 'image/gif' });
        renderMessages();
        renderChatList();
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat) return;
        if (chat.type === 'ai') {
            askGeminiAssistant(APP.currentChatId);
            return;
        }
        socket.emit('send_message', {
            id: msgId, chatId: APP.currentChatId, sender: APP.user.name, senderPhone: APP.user.phone,
            toPhone: chat.type === 'user' ? chat.phone : undefined,
            text: label, time, fileData: gif.full, fileName: 'gif.gif', fileType: 'image/gif'
        });
    }

    // ==================== GERADOR DE IMAGENS POR IA (Pollinations.ai) ====================
    // Tal como os GIFs, a imagem gerada já fica hospedada num URL (da
    // Pollinations) — a mensagem guarda-o diretamente, sem passar pelo
    // Cloudinary/base64 usado para ficheiros enviados do telemóvel.
    let IMAGE_GEN_URL = null;
    function openImageGenModal() {
        document.getElementById('imageGenPrompt').value = '';
        document.getElementById('imageGenResult').innerHTML = '';
        IMAGE_GEN_URL = null;
        document.getElementById('modalImageGen').classList.add('active');
    }
    async function generateImage() {
        const prompt = document.getElementById('imageGenPrompt').value.trim();
        const result = document.getElementById('imageGenResult');
        if (!prompt) return alert('Escreve uma descrição primeiro!');
        result.innerHTML = '<p style="text-align:center;color:var(--text-secondary);">🪄 A gerar... (pode demorar uns segundos)</p>';
        try {
            const res = await fetch(`/api/generate-image?prompt=${encodeURIComponent(prompt)}`);
            const data = await res.json();
            if (!res.ok || !data.url) throw new Error(data.error || 'Falha ao gerar imagem.');
            IMAGE_GEN_URL = data.url;
            result.innerHTML = `
                <img src="${data.url}" style="width:100%;border-radius:8px;">
                <div class="modal-actions" style="margin-top:8px;">
                    <button class="btn-small" onclick="generateImage()">🔄 Gerar outra</button>
                    <button class="btn-small btn-accept" onclick="sendGeneratedImage()">📨 Enviar</button>
                </div>`;
        } catch (e) {
            result.innerHTML = '<p style="text-align:center;color:var(--text-secondary);">⚠️ Não foi possível gerar a imagem agora.</p>';
        }
    }
    function sendGeneratedImage() {
        if (!IMAGE_GEN_URL || !APP.currentChatId) return;
        closeModal('modalImageGen');
        const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const msgId = 'm' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const label = '🪄 Imagem gerada por IA';
        const url = IMAGE_GEN_URL;
        if (!APP.messages[APP.currentChatId]) APP.messages[APP.currentChatId] = [];
        APP.messages[APP.currentChatId].push({ id: msgId, sender: 'Você', text: label, time, type: 'sent', read: false, fileData: url, fileName: 'ia.png', fileType: 'image/png' });
        renderMessages();
        renderChatList();
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat) return;
        if (chat.type === 'ai') {
            askGeminiAssistant(APP.currentChatId);
            return;
        }
        socket.emit('send_message', {
            id: msgId, chatId: APP.currentChatId, sender: APP.user.name, senderPhone: APP.user.phone,
            toPhone: chat.type === 'user' ? chat.phone : undefined,
            text: label, time, fileData: url, fileName: 'ia.png', fileType: 'image/png'
        });
    }

    function openImageFullscreen(msgId) {
        const msg = (APP.messages[APP.currentChatId] || []).find(m => m.id === msgId);
        if (!msg || !msg.fileData) return;
        const win = window.open();
        if (win) win.document.write(`<title>Foto</title><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh;"><img src="${msg.fileData}" style="max-width:100%;max-height:100%;"></body>`);
    }

    // ==================== GALERIA DE MÍDIA DA CONVERSA ====================
    // Junta todas as fotos/vídeos já trocados nesta conversa num só sítio —
    // nunca inclui mensagens "ver uma vez" (mesmo antes de abertas), porque
    // mostrá-las numa galeria para reler quando se quiser contraria o próprio
    // propósito dessa funcionalidade (só se veem uma vez, nunca mais).
    const MEDIA_GALLERY = { items: [], index: 0 };
    function openMediaGalleryModal() {
        if (!APP.currentChatId) return;
        const msgs = APP.messages[APP.currentChatId] || [];
        MEDIA_GALLERY.items = msgs.filter((m) => !m.deleted && !m.viewOnce && m.fileData && m.fileType && (m.fileType.startsWith('image/') || m.fileType.startsWith('video/')));
        const grid = document.getElementById('mediaGalleryGrid');
        grid.innerHTML = MEDIA_GALLERY.items.length ? MEDIA_GALLERY.items.map((m, i) => {
            const isVideo = m.fileType.startsWith('video/');
            return `<div onclick="openMediaGalleryViewer(${i})" style="cursor:pointer;aspect-ratio:1;overflow:hidden;border-radius:6px;position:relative;background:#000;">
                ${isVideo
                    ? `<video src="${m.fileData}" style="width:100%;height:100%;object-fit:cover;"></video><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:24px;text-shadow:0 0 6px rgba(0,0,0,0.8);">▶️</div>`
                    : `<img src="${m.fileData}" style="width:100%;height:100%;object-fit:cover;">`}
            </div>`;
        }).join('') : '<p style="grid-column:1/-1;color:#8696a0;text-align:center;padding:20px;">Ainda não há fotos ou vídeos nesta conversa.</p>';
        document.getElementById('modalMediaGallery').classList.add('active');
    }
    function openMediaGalleryViewer(index) {
        MEDIA_GALLERY.index = index;
        renderMediaGalleryViewer();
        document.getElementById('modalMediaGalleryViewer').classList.add('active');
    }
    function renderMediaGalleryViewer() {
        const msg = MEDIA_GALLERY.items[MEDIA_GALLERY.index];
        if (!msg) return;
        const isVideo = msg.fileType.startsWith('video/');
        document.getElementById('mediaGalleryViewerContent').innerHTML = isVideo
            ? `<video src="${msg.fileData}" controls autoplay style="max-width:100%;max-height:75vh;"></video>`
            : `<img src="${msg.fileData}" style="max-width:100%;max-height:75vh;">`;
    }
    function navigateMediaGallery(delta) {
        const newIndex = MEDIA_GALLERY.index + delta;
        if (newIndex < 0 || newIndex >= MEDIA_GALLERY.items.length) return;
        MEDIA_GALLERY.index = newIndex;
        renderMediaGalleryViewer();
    }

    // ==================== CALENDÁRIO PARTILHADO DE GRUPO ====================
    // Só existe para grupos (ver groupCalendarBtn em openChat()) — qualquer
    // membro pode adicionar um evento; no dia marcado, o servidor posta
    // sozinho um lembrete como mensagem normal na conversa (ver server.js).
    const GROUP_CALENDAR = { items: [] };
    function openGroupCalendarModal() {
        if (!APP.currentChatId) return;
        socket.emit('group_event_get', { roomId: APP.currentChatId });
        renderGroupCalendarGoogleSyncBox();
        document.getElementById('modalGroupCalendar').classList.add('active');
    }
    // Sincronização com o Google Calendar (ver server.js, secção "GOOGLE
    // CALENDAR") — à parte por grupo, cada pessoa decide para os grupos que
    // quiser, nunca automático para toda a gente.
    function renderGroupCalendarGoogleSyncBox() {
        const box = document.getElementById('groupCalendarGoogleSyncBox');
        if (!box || !APP.currentChatId) return;
        if (!APP.user.googleCalendarConnected) {
            box.innerHTML = `<span style="color:var(--text-secondary);">📆 Liga o Google Calendar no teu perfil para sincronizar este grupo.</span>`;
            return;
        }
        const isSynced = (APP.user.googleCalendarSyncedRooms || []).includes(APP.currentChatId);
        box.innerHTML = `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="groupCalendarSyncCheck" ${isSynced ? 'checked' : ''} onchange="toggleGroupCalendarGoogleSync(this.checked)">
            Sincronizar este grupo com o meu Google Calendar
        </label>`;
    }
    function toggleGroupCalendarGoogleSync(enabled) {
        if (!APP.currentChatId) return;
        socket.emit('google_calendar_sync_room', { roomId: APP.currentChatId, enabled });
    }
    socket.on('google_calendar_sync_updated', (data) => {
        if (!data || data.roomId !== APP.currentChatId) return;
        if (data.error) { alert('⚠️ ' + data.error); renderGroupCalendarGoogleSyncBox(); return; }
        const rooms = new Set(APP.user.googleCalendarSyncedRooms || []);
        if (data.enabled) rooms.add(data.roomId); else rooms.delete(data.roomId);
        APP.user.googleCalendarSyncedRooms = [...rooms];
        localStorage.setItem('authUser', JSON.stringify(APP.user));
        renderGroupCalendarGoogleSyncBox();
        socket.emit('group_event_get', { roomId: APP.currentChatId }); // eventos existentes podem ter ganho um novo link ao Google (sincronização inicial)
    });

    // ==================== SLACK (ligar o canal deste grupo) ====================
    function openSlackLinkModal() {
        if (!APP.currentChatId) return;
        renderSlackLinkStatusBox();
        document.getElementById('modalSlackLink').classList.add('active');
    }
    function renderSlackLinkStatusBox() {
        const box = document.getElementById('slackLinkStatusBox');
        if (!box || !APP.currentChatId) return;
        if (!APP.user.slackConnected) {
            box.innerHTML = `<span style="color:var(--text-secondary);">💬 Liga o Slack no teu perfil para poderes ligar um canal a este grupo.</span>`;
            return;
        }
        const linkedChannelId = (APP.user.slackLinkedRooms || {})[APP.currentChatId];
        if (linkedChannelId) {
            box.innerHTML = `<p style="margin:0 0 8px;">✅ Ligado ao canal <code>${escapeHtml(linkedChannelId)}</code> do workspace "${escapeHtml(APP.user.slackTeamName || '')}".</p>
                <button class="btn-small btn-danger" onclick="unlinkSlackChannel()">Desligar canal</button>`;
        } else {
            box.innerHTML = `<label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px;">ID do canal do Slack</label>
                <div style="display:flex;gap:6px;">
                    <input type="text" id="slackChannelIdInput" placeholder="ex.: C0123ABC456" style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid var(--bg-tertiary);background:var(--bg-primary);color:var(--text-primary);">
                    <button class="btn-small btn-accept" onclick="submitSlackLinkChannel()">Ligar</button>
                </div>
                <p style="color:#8696a0;font-size:11px;margin-top:6px;">Encontras o ID em "Ver detalhes do canal" no Slack. O bot da app tem de já ter sido convidado para lá (<code>/invite</code> no canal).</p>`;
        }
    }
    function submitSlackLinkChannel() {
        const channelId = document.getElementById('slackChannelIdInput').value.trim();
        if (!channelId) return alert('Escreve o ID do canal do Slack.');
        socket.emit('slack_link_channel', { roomId: APP.currentChatId, channelId });
    }
    function unlinkSlackChannel() {
        if (!confirm('Desligar este canal do Slack deste grupo?')) return;
        socket.emit('slack_unlink_channel', { roomId: APP.currentChatId });
    }
    socket.on('slack_link_updated', (data) => {
        if (!data || data.roomId !== APP.currentChatId) return;
        if (data.error) { alert('⚠️ ' + data.error); renderSlackLinkStatusBox(); return; }
        const rooms = { ...(APP.user.slackLinkedRooms || {}) };
        if (data.channelId) rooms[data.roomId] = data.channelId; else delete rooms[data.roomId];
        APP.user.slackLinkedRooms = rooms;
        localStorage.setItem('authUser', JSON.stringify(APP.user));
        renderSlackLinkStatusBox();
    });
    function renderGroupCalendarList() {
        const box = document.getElementById('groupCalendarList');
        if (!GROUP_CALENDAR.items.length) {
            box.innerHTML = '<p class="member-count">Ainda não há nenhum evento marcado.</p>';
            return;
        }
        const todayStr = new Date().toISOString().slice(0, 10);
        box.innerHTML = GROUP_CALENDAR.items.map((ev) => {
            const isPast = ev.date < todayStr;
            const canDelete = ev.createdByPhone === APP.user.phone || (APP.chats.find(c => c.id === APP.currentChatId)?.admins || []).includes(APP.user.phone);
            return `<div style="background:var(--bg-secondary);border-radius:8px;padding:10px 12px;opacity:${isPast ? '0.6' : '1'};">
                <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;">
                    <div>
                        <div style="font-weight:600;">${ev.date === todayStr ? '📅 ' : ''}${escapeHtml(ev.title)}</div>
                        <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${formatGroupEventDate(ev.date)}${ev.description ? ' · ' + escapeHtml(ev.description) : ''}</div>
                        <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">Criado por ${escapeHtml(ev.createdBy)}</div>
                    </div>
                    ${canDelete ? `<button class="btn-small btn-danger" onclick="deleteGroupEvent('${ev.id}')" style="padding:4px 8px;">🗑️</button>` : ''}
                </div>
            </div>`;
        }).join('');
    }
    function formatGroupEventDate(dateStr) {
        const [y, m, d] = dateStr.split('-');
        return `${d}/${m}/${y}`;
    }
    socket.on('group_event_list', (data) => {
        if (data?.roomId !== APP.currentChatId) return;
        GROUP_CALENDAR.items = data.items || [];
        renderGroupCalendarList();
    });
    socket.on('group_event_updated', (data) => {
        if (data?.roomId !== APP.currentChatId) return;
        GROUP_CALENDAR.items = data.items || [];
        if (document.getElementById('modalGroupCalendar')?.classList.contains('active')) renderGroupCalendarList();
    });
    function openAddGroupEventModal() {
        closeModal('modalGroupCalendar');
        document.getElementById('groupEventTitleInput').value = '';
        document.getElementById('groupEventDateInput').value = '';
        document.getElementById('groupEventDescriptionInput').value = '';
        document.getElementById('modalAddGroupEvent').classList.add('active');
    }
    function submitGroupEvent() {
        const title = document.getElementById('groupEventTitleInput').value.trim();
        const date = document.getElementById('groupEventDateInput').value;
        if (!title) return alert('Escreve um título para o evento.');
        if (!date) return alert('Escolhe uma data.');
        const description = document.getElementById('groupEventDescriptionInput').value.trim();
        socket.emit('group_event_add', { roomId: APP.currentChatId, title, date, description });
        closeModal('modalAddGroupEvent');
        document.getElementById('modalGroupCalendar').classList.add('active');
    }
    function deleteGroupEvent(eventId) {
        if (!confirm('Apagar este evento do calendário do grupo?')) return;
        socket.emit('group_event_delete', { roomId: APP.currentChatId, eventId });
    }

    // ==================== NOTAS COLABORATIVAS ====================
    // Sem CRDT/operational-transform — "quem escreveu por último ganha" (ver
    // comentário em server.js). O único cuidado do lado do cliente é nunca
    // sobrescrever o textarea enquanto a PRÓPRIA pessoa o tem focado (senão
    // o cursor saltava a meio de uma frase); atualizações que chegam
    // enquanto está a escrever ficam pendentes e só se aplicam quando sair
    // do campo (blur) ou reabrir o modal.
    const COLLAB_NOTE = { roomId: null, debounceTimer: null, pendingRemote: null };
    function openCollabNoteModal() {
        if (!APP.currentChatId) return;
        COLLAB_NOTE.roomId = APP.currentChatId;
        COLLAB_NOTE.pendingRemote = null;
        document.getElementById('collabNoteTextarea').value = '';
        document.getElementById('collabNoteStatus').textContent = 'A carregar...';
        socket.emit('collab_note_get', { roomId: APP.currentChatId });
        document.getElementById('modalCollabNote').classList.add('active');
    }
    function applyCollabNoteData(data) {
        const textarea = document.getElementById('collabNoteTextarea');
        const statusEl = document.getElementById('collabNoteStatus');
        if (document.activeElement === textarea) {
            // A pessoa está mesmo agora a escrever — não lhe saltamos o cursor;
            // guardamos para aplicar assim que sair do campo.
            COLLAB_NOTE.pendingRemote = data;
            return;
        }
        textarea.value = data.text || '';
        statusEl.textContent = data.updatedByName ? `Última edição por ${data.updatedByName}` : '';
    }
    socket.on('collab_note_data', (data) => {
        if (data?.roomId !== COLLAB_NOTE.roomId) return;
        applyCollabNoteData(data);
    });
    function handleCollabNoteInput() {
        clearTimeout(COLLAB_NOTE.debounceTimer);
        COLLAB_NOTE.debounceTimer = setTimeout(() => {
            socket.emit('collab_note_update', { roomId: COLLAB_NOTE.roomId, text: document.getElementById('collabNoteTextarea').value });
        }, 500);
    }
    document.getElementById('collabNoteTextarea').addEventListener('blur', () => {
        if (COLLAB_NOTE.pendingRemote) { applyCollabNoteData(COLLAB_NOTE.pendingRemote); COLLAB_NOTE.pendingRemote = null; }
    });

    // Gravação de mensagens de voz (MediaRecorder) — funciona em qualquer navegador
    // moderno, incluindo iPhone (Safari 14.3+).
    let voiceRecorder = null, voiceChunks = [], voiceStream = null, voiceStartTime = 0, voiceTimerInterval = null;

    function toggleVoiceRecording() {
        if (voiceRecorder && voiceRecorder.state === 'recording') { stopVoiceRecording(true); return; }
        if (!APP.currentChatId) return alert('Abra uma conversa primeiro!');
        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            voiceStream = stream;
            voiceChunks = [];
            voiceRecorder = new MediaRecorder(stream);
            voiceRecorder.ondataavailable = (e) => { if (e.data.size > 0) voiceChunks.push(e.data); };

            // Transcrição em paralelo (Web Speech API) — assim a assistente de IA
            // consegue "ler" o que foi dito na mensagem de voz. Só funciona em
            // navegadores com suporte (Chrome/Android; limitado no Safari/iPhone);
            // sem suporte, a mensagem de voz continua a funcionar normalmente, só
            // sem transcrição.
            let voiceTranscript = '';
            const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
            let voiceRecognition = null;
            if (SpeechRecognitionAPI) {
                try {
                    voiceRecognition = new SpeechRecognitionAPI();
                    voiceRecognition.continuous = true;
                    voiceRecognition.interimResults = false;
                    voiceRecognition.lang = navigator.language || 'pt-PT';
                    voiceRecognition.onresult = (e) => {
                        for (let i = e.resultIndex; i < e.results.length; i++) {
                            if (e.results[i].isFinal) voiceTranscript += e.results[i][0].transcript + ' ';
                        }
                    };
                    voiceRecognition.onerror = () => {}; // ignora silenciosamente — a gravação em si não depende disto
                    voiceRecognition.start();
                } catch (e) { voiceRecognition = null; }
            }

            voiceRecorder.onstop = () => {
                voiceStream.getTracks().forEach(t => t.stop());
                if (voiceRecognition) { try { voiceRecognition.stop(); } catch (e) {} }
                clearInterval(voiceTimerInterval);
                const btn = document.getElementById('voiceRecordBtn');
                btn.textContent = '🎤';
                btn.style.color = '';
                if (window.applyModernIcons) window.applyModernIcons(); // volta a pôr o ícone do microfone (js/icons.js)
                if (voiceChunks.length === 0) return;
                const blob = new Blob(voiceChunks, { type: voiceRecorder.mimeType || 'audio/webm' });
                if (blob.size > MAX_ATTACHMENT_MB * 1024 * 1024) return alert('Áudio muito longo (acima de ' + MAX_ATTACHMENT_MB + 'MB).');
                const reader = new FileReader();
                reader.onload = () => sendAttachmentMessage(reader.result, 'audio.webm', blob.type, voiceTranscript.trim());
                reader.readAsDataURL(blob);
            };
            voiceRecorder.start();
            voiceStartTime = Date.now();
            const btn = document.getElementById('voiceRecordBtn');
            btn.style.color = '#ef4444';
            voiceTimerInterval = setInterval(() => {
                const secs = Math.floor((Date.now() - voiceStartTime) / 1000);
                btn.textContent = '🔴' + secs + 's';
                if (secs >= 240) stopVoiceRecording(true); // limite de 4 minutos por mensagem
            }, 500);
        }).catch(err => alert('Não foi possível aceder ao microfone: ' + err.message));
    }

    function stopVoiceRecording(send) {
        if (voiceRecorder && voiceRecorder.state === 'recording') {
            if (!send) voiceChunks = []; // cancelar (não usado na UI atual, mas disponível)
            voiceRecorder.stop();
        }
    }

    async function sendMessage(inputId) {
        const input = document.getElementById(inputId || 'messageInput');
        const text = input.value.trim();
        if (!text || !APP.currentChatId) return;
        const now = new Date();
        const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const msgId = 'm' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const replyTo = APP.replyingTo ? { id: APP.replyingTo.id, sender: APP.replyingTo.sender, text: APP.replyingTo.text } : null;
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        const chatId = APP.currentChatId;
        const topic = (chat?.type === 'group') ? (APP.activeTopic[chatId] || null) : null;
        const isOffline = chat && chat.type !== 'ai' && !socket.connected;
        if (!APP.messages[chatId]) APP.messages[chatId] = [];
        APP.messages[chatId].push({ id: msgId, sender: 'Você', text, time, type: 'sent', replyTo, read: false, topic, pending: isOffline });
        input.value = '';
        cancelReply();
        hideMentionAutocomplete();
        renderMessages();
        renderChatList();

        if (!chat) return;

        if (chat.type === 'ai') {
            askGeminiAssistant(chatId);
        } else {
            let outgoing = { id: msgId, chatId, sender: APP.user.name, senderPhone: APP.user.phone, toPhone: chat.type === 'user' ? chat.phone : undefined, text, time, replyTo, topic };
            if (chat.type === 'group') {
                const mentions = extractMentionedPhones(text, chatId);
                if (mentions.length) outgoing.mentions = mentions;
            }
            if (chat.type === 'user' && chat.publicKey && E2EE.publicJwk) {
                await e2eeReadyPromise;
                const enc = await encryptFor(chat.phone, chat.publicKey, text);
                if (enc) outgoing = { ...outgoing, text: '🔒 Mensagem encriptada', encrypted: true, iv: enc.iv, data: enc.data };
            }
            // Sem ligação, a mensagem fica na fila (ver "Modo offline com fila de
            // mensagens") em vez de se perder ou de socket.emit falhar em silêncio.
            if (isOffline) {
                queueOfflineMessage({ msgId, chatId, outgoing, previewText: text, time, replyTo, topic });
            } else {
                socket.emit('send_message', outgoing);
            }
        }
    }

    // Recebe o histórico salvo no servidor quando entra numa sala (persiste entre recarregamentos de página)
    socket.on('room_history', async (data) => {
        if (!data || !data.chatId || !Array.isArray(data.messages) || data.messages.length === 0) return;
        if (!APP.messages[data.chatId]) APP.messages[data.chatId] = [];
        const chat = APP.chats.find(c => c.id === data.chatId);
        if (data.messages.some(m => m.encrypted)) await e2eeReadyPromise;
        const historyEntries = await Promise.all(data.messages.map(async (m, i) => {
            let text = m.text;
            if (m.encrypted && chat?.type === 'user') {
                const decrypted = await decryptFrom(chat.phone, chat.publicKey, m.iv, m.data);
                text = decrypted != null ? decrypted : '🔒 Não foi possível desencriptar (dispositivo diferente)';
            }
            return {
                id: m.id || ('h' + i + '_' + (m.time || '')),
                sender: m.sender || 'Contato',
                text,
                time: m.time || '',
                type: m.senderPhone === APP.user?.phone || m.sender === APP.user?.name ? 'sent' : 'received',
                replyTo: m.replyTo || null,
                reactions: m.reactions || null,
                deleted: !!m.deleted,
                edited: !!m.edited,
                fileData: m.fileData || null,
                fileName: m.fileName || null,
                fileType: m.fileType || null,
                transcript: m.transcript || null,
                poll: m.poll || null,
                game: m.game || null,
                expense: m.expense || null,
                shoppingList: m.shoppingList || null,
                viewOnce: !!m.viewOnce,
                viewOnceOpened: !!m.viewOnceOpened,
                topic: m.topic || null,
                sosAlert: !!m.sosAlert,
                sosLat: typeof m.sosLat === 'number' ? m.sosLat : null,
                sosLng: typeof m.sosLng === 'number' ? m.sosLng : null
            };
        }));
        // O servidor manda sempre o histórico COMPLETO desta sala (não só
        // mensagens novas) sempre que entramos nela — e isso acontece não só
        // ao abrir a conversa, mas também sempre que o socket reconecta (rede
        // a cair, telemóvel em segundo plano, etc.), o que é frequente. Juntar
        // (concat) ao que já lá estava duplicava a conversa toda — mensagens,
        // fotos, enquetes e jogos — a cada reconexão. Substituir em vez de
        // juntar é o correto, já que isto É a verdade completa do servidor.
        APP.messages[data.chatId] = historyEntries;
        appendPendingOfflineMessages(data.chatId);
        if (APP.currentChatId === data.chatId) renderMessages();
        renderChatList();
    });

    socket.on('receive_message', async (data) => {
        if (!data || !data.chatId) return;
        if (!APP.messages[data.chatId]) APP.messages[data.chatId] = [];
        let text = data.text;
        const chat = APP.chats.find(c => c.id === data.chatId);
        let decryptFailed = false;
        if (data.encrypted && chat?.type === 'user') {
            await e2eeReadyPromise;
            const decrypted = await decryptFrom(chat.phone, chat.publicKey, data.iv, data.data);
            if (decrypted == null) { text = '🔒 Não foi possível desencriptar (dispositivo diferente)'; decryptFailed = true; }
            else text = decrypted;
        }
        // Tradução automática: só quando ligada nesta conversa, e só para texto
        // a sério recebido (não para o aviso de falha de desencriptação nem
        // para mensagens que são só um ficheiro/foto sem legenda).
        let translatedText = null, translatedLang = null;
        if (!decryptFailed && !data.fileData && APP.autoTranslateChats.has(data.chatId)) {
            const auto = await autoTranslateIfNeeded(text);
            if (auto) { translatedText = auto.text; translatedLang = auto.lang; }
        }
        APP.messages[data.chatId].push({
            id: data.id || ('m' + Date.now()),
            sender: data.sender || 'Contato',
            text,
            translatedText, translatedLang,
            time: data.time || new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            // Normalmente quem envia já adicionou a própria mensagem de forma
            // otimista e nunca recebe o próprio 'receive_message' de volta (o
            // servidor usa socket.to(), que exclui quem enviou) — mas o UNO é
            // criado inteiramente no servidor (por causa da mão de cartas
            // escondida) e chega também a quem começou o jogo, por isso aqui
            // é preciso distinguir para não aparecer como se fosse da outra pessoa.
            type: (data.senderPhone && data.senderPhone === APP.user.phone) ? 'sent' : 'received',
            replyTo: data.replyTo || null,
            fileData: data.fileData || null,
            fileName: data.fileName || null,
            fileType: data.fileType || null,
            transcript: data.transcript || null,
            poll: data.poll || null,
            game: data.game || null,
            expense: data.expense || null,
            shoppingList: data.shoppingList || null,
            viewOnce: !!data.viewOnce,
            viewOnceOpened: !!data.viewOnceOpened,
            topic: data.topic || null,
            sosAlert: !!data.sosAlert,
            sosLat: typeof data.sosLat === 'number' ? data.sosLat : null,
            sosLng: typeof data.sosLng === 'number' ? data.sosLng : null
        });
        if (APP.currentChatId === data.chatId) { renderMessages(); socket.emit('message_read', { chatId: data.chatId }); }
        renderChatList();
    });

    // "a escrever..." — mostra por 3s no subtítulo da conversa aberta
    let typingTimeout = null;
    socket.on('typing_received', (data) => {
        if (data.roomId !== APP.currentChatId) return;
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (chat?.type === 'ai') return;
        document.getElementById('chatSubtitle').textContent = `${data.name || 'Alguém'} está a escrever...`;
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            document.getElementById('chatSubtitle').textContent = chat?.type === 'group' ? `Grupo · ${chat.memberCount} membros` : (chat?.online ? 'Online' : 'Offline');
        }, 3000);
    });

    let ownTypingTimeout = null;
    function notifyTyping() {
        if (!APP.currentChatId) return;
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (chat?.type === 'ai') return;
        clearTimeout(ownTypingTimeout);
        ownTypingTimeout = setTimeout(() => socket.emit('typing', { roomId: APP.currentChatId }), 200);
    }

    // ==================== MENÇÕES (@nome) EM GRUPOS ====================
    // A lista de quem pode ser mencionado vem dos contactos já sincronizados
    // (APP.chats do tipo 'user', que reflete todos os utilizadores cadastrados
    // — os grupos aqui são abertos a todos, ver README), não de quem já
    // escreveu no grupo, para funcionar mesmo num grupo ainda sem mensagens.
    const MENTION_STATE = { startIndex: -1 };
    function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function hideMentionAutocomplete() {
        const box = document.getElementById('mentionAutocomplete');
        box.style.display = 'none';
        box.innerHTML = ''; // evita clicar num item invisível deixado de uma sugestão anterior
    }
    function updateMentionAutocomplete() {
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat || chat.type !== 'group') { hideMentionAutocomplete(); return; }
        const input = document.getElementById('messageInput');
        const cursor = input.selectionStart;
        const textBeforeCursor = input.value.slice(0, cursor);
        const match = textBeforeCursor.match(/(?:^|\s)@([^\s@]*)$/);
        if (!match) { hideMentionAutocomplete(); return; }
        const fragment = match[1].toLowerCase();
        // Compara com cada palavra do nome (não só o início do nome completo),
        // já que nomes portugueses costumam ter 2+ palavras (ex.: "João Silva")
        // e é comum querer mencionar pelo último nome também.
        const candidates = APP.chats.filter(c => c.type === 'user' && c.phone !== APP.user.phone && c.name.toLowerCase().split(/\s+/).some(word => word.startsWith(fragment))).slice(0, 6);
        if (!candidates.length) { hideMentionAutocomplete(); return; }
        const box = document.getElementById('mentionAutocomplete');
        MENTION_STATE.startIndex = textBeforeCursor.lastIndexOf('@');
        box.innerHTML = candidates.map(c => `<div onclick="applyMention('${c.phone}')" onmouseover="this.style.background='var(--bg-tertiary)'" onmouseout="this.style.background=''" style="padding:8px 10px;cursor:pointer;font-size:13px;">${escapeHtml(c.name)}</div>`).join('');
        box.style.display = 'block';
    }
    function applyMention(phone) {
        const contact = APP.chats.find(c => c.type === 'user' && c.phone === phone);
        if (!contact) return;
        const input = document.getElementById('messageInput');
        const before = input.value.slice(0, MENTION_STATE.startIndex);
        const after = input.value.slice(input.selectionStart);
        const insert = `@${contact.name} `;
        input.value = before + insert + after;
        hideMentionAutocomplete();
        input.focus();
        const newPos = (before + insert).length;
        input.setSelectionRange(newPos, newPos);
    }
    // Chamado ao enviar: extrai quem foi @mencionado a partir do texto (nomes
    // mais compridos primeiro, para "@Ana Maria" não ficar só "@Ana"), para o
    // servidor poder notificar especificamente essas pessoas.
    function extractMentionedPhones(text, chatId) {
        const chat = APP.chats.find(c => c.id === chatId);
        if (!chat || chat.type !== 'group') return [];
        const candidates = APP.chats.filter(c => c.type === 'user' && c.name && c.phone !== APP.user.phone).sort((a, b) => b.name.length - a.name.length);
        const phones = new Set();
        candidates.forEach(c => {
            const re = new RegExp('@' + escapeRegex(c.name) + '(?![A-Za-zÀ-ÿ0-9_])');
            if (re.test(text)) phones.add(c.phone);
        });
        return [...phones];
    }
    // Realça "@Nome" nas mensagens de grupo já mostradas (com destaque próprio
    // quando és tu o mencionado). Opera sempre sobre texto já escapado (ver
    // renderMessageBody) para não abrir espaço a HTML injetado numa mensagem.
    function highlightMentions(escapedText, chatId) {
        const chat = APP.chats.find(c => c.id === chatId);
        if (!chat || chat.type !== 'group') return escapedText;
        // APP.chats (contactos) exclui sempre a própria conta (não faz sentido
        // "conversar contigo próprio"), mas para RECONHECER menções precisamos
        // de incluir o próprio utilizador também — senão nunca reconhecerias
        // que foste tu quem foi mencionado ao veres a mensagem.
        const candidates = APP.chats.filter(c => c.type === 'user' && c.name)
            .concat(APP.user ? [{ name: APP.user.name, phone: APP.user.phone }] : [])
            .sort((a, b) => b.name.length - a.name.length);
        if (!candidates.length) return escapedText;
        const byEscapedName = {};
        candidates.forEach(c => { byEscapedName[escapeHtml(c.name)] = c; });
        const pattern = new RegExp('@(' + Object.keys(byEscapedName).map(escapeRegex).join('|') + ')(?![A-Za-zÀ-ÿ0-9_])', 'g');
        return escapedText.replace(pattern, (match, nameMatched) => {
            const contact = byEscapedName[nameMatched];
            const isMe = contact && contact.phone === APP.user.phone;
            const style = isMe
                ? 'background:rgba(255,193,7,0.35);font-weight:700;border-radius:4px;padding:0 3px;'
                : 'color:var(--blue);font-weight:600;';
            return `<span style="${style}">${match}</span>`;
        });
    }
    // ==================== FORMATAÇÃO DE TEXTO (*negrito*, _itálico_, `código`) ====================
    // Parser leve, sem suporte a formatação encadeada/aninhada — opera sempre
    // sobre texto já escapado (escapeHtml), nunca sobre o texto em bruto, para
    // não abrir de novo o espaço para HTML injetado numa mensagem.
    function formatMessageText(escapedText) {
        // Trechos de código primeiro, e guardados à parte num marcador — assim
        // um *asterisco* ou _underscore_ dentro de `código` não vira negrito/
        // itálico por engano.
        const codeParts = [];
        let text = escapedText.replace(//g, ''); // não deixa o próprio marcador ser forjado por quem escreve
        text = text.replace(/`([^`\n]+)`/g, (match, code) => {
            codeParts.push(`<code style="background:rgba(0,0,0,0.25);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:0.9em;">${code}</code>`);
            return `${codeParts.length - 1}`;
        });
        text = text.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
        text = text.replace(/_([^_\n]+)_/g, '<em>$1</em>');
        text = text.replace(/(\d+)/g, (match, idx) => codeParts[Number(idx)]);
        return text;
    }
    function renderMessageBody(msg, chatId) {
        const escaped = escapeHtml(msg.text || '');
        const formatted = formatMessageText(escaped);
        return highlightMentions(formatted, chatId);
    }

    socket.on('message_deleted_received', (data) => {
        const msgs = APP.messages[data.chatId];
        if (!msgs) return;
        const msg = msgs.find(m => m.id === data.messageId);
        if (msg) { msg.text = 'Mensagem apagada'; msg.deleted = true; }
        if (APP.currentChatId === data.chatId) renderMessages();
    });

    socket.on('reaction_received', (data) => {
        const msgs = APP.messages[data.chatId];
        if (!msgs) return;
        const msg = msgs.find(m => m.id === data.messageId);
        if (msg) {
            if (!msg.reactions) msg.reactions = {};
            if (!msg.reactions[data.emoji]) msg.reactions[data.emoji] = [];
            if (!msg.reactions[data.emoji].includes(data.who)) msg.reactions[data.emoji].push(data.who);
        }
        if (APP.currentChatId === data.chatId) renderMessages();
    });

    // Confirmação de leitura — marca as MINHAS mensagens enviadas como lidas (✓✓ azul)
    socket.on('message_read_received', (data) => {
        const msgs = APP.messages[data.chatId];
        if (!msgs) return;
        msgs.forEach(m => { if (m.type === 'sent') m.read = true; });
        if (APP.currentChatId === data.chatId) renderMessages();
    });

    // ==================== RESPONDER / APAGAR / REAGIR ====================
    function replyToMessage(msgId) {
        const msg = (APP.messages[APP.currentChatId] || []).find(m => m.id === msgId);
        if (!msg || msg.deleted) return;
        APP.replyingTo = { id: msg.id, sender: msg.type === 'sent' ? 'Você' : msg.sender, text: msg.text };
        const bar = document.getElementById('replyPreviewBar');
        bar.style.display = 'flex';
        bar.querySelector('.reply-preview-text').textContent = `${APP.replyingTo.sender}: ${APP.replyingTo.text}`;
        document.getElementById('messageInput').focus();
    }

    function cancelReply() {
        APP.replyingTo = null;
        const bar = document.getElementById('replyPreviewBar');
        if (bar) bar.style.display = 'none';
    }

    function deleteMessage(msgId) {
        if (!confirm('Apagar esta mensagem para todos?')) return;
        const msg = (APP.messages[APP.currentChatId] || []).find(m => m.id === msgId);
        if (!msg) return;
        msg.text = 'Mensagem apagada';
        msg.deleted = true;
        renderMessages();
        socket.emit('delete_message', { chatId: APP.currentChatId, messageId: msgId });
    }

    // Editar uma mensagem já enviada — só texto simples (sem anexo, sem estar
    // cifrada ponta-a-ponta, ver explicação no servidor)
    function editMessage(msgId) {
        const msg = (APP.messages[APP.currentChatId] || []).find(m => m.id === msgId);
        if (!msg) return;
        const newText = prompt('Editar mensagem:', msg.text);
        if (newText == null) return; // cancelou
        const trimmed = newText.trim();
        if (!trimmed || trimmed === msg.text) return;
        msg.text = trimmed;
        msg.edited = true;
        renderMessages();
        socket.emit('edit_message', { chatId: APP.currentChatId, messageId: msgId, newText: trimmed });
    }

    socket.on('message_edited_received', (data) => {
        const msgs = APP.messages[data.chatId];
        if (!msgs) return;
        const msg = msgs.find(m => m.id === data.messageId);
        if (msg) { msg.text = data.newText; msg.edited = true; }
        if (APP.currentChatId === data.chatId) renderMessages();
    });

    const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
    function toggleReactionPicker(msgId, btnEl) {
        document.querySelectorAll('.reaction-picker').forEach(el => el.remove());
        const picker = document.createElement('div');
        picker.className = 'reaction-picker';
        picker.innerHTML = QUICK_REACTIONS.map(e => `<span onclick="reactToMessage('${msgId}','${e}')">${e}</span>`).join('');
        btnEl.parentElement.appendChild(picker);
        setTimeout(() => document.addEventListener('click', function closeOnce(e) {
            if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', closeOnce); }
        }), 10);
    }

    function reactToMessage(msgId, emoji) {
        document.querySelectorAll('.reaction-picker').forEach(el => el.remove());
        const msg = (APP.messages[APP.currentChatId] || []).find(m => m.id === msgId);
        if (!msg) return;
        if (!msg.reactions) msg.reactions = {};
        if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
        if (!msg.reactions[emoji].includes(APP.user.phone)) msg.reactions[emoji].push(APP.user.phone);
        renderMessages();
        socket.emit('react_message', { chatId: APP.currentChatId, messageId: msgId, emoji });
    }

    function openCreateGroupModal() {
        document.getElementById('modalCreateGroup').classList.add('active');
        document.getElementById('groupName').value = '';
        document.getElementById('groupPrivateInput').checked = false;
        updateCreateGroupInfoText();
    }
    function updateCreateGroupInfoText() {
        const isPrivate = document.getElementById('groupPrivateInput').checked;
        document.getElementById('createGroupInfoText').innerHTML = isPrivate
            ? 'ℹ️ Este grupo fica <strong>fechado</strong> — só entra quem tu convidares (link ou QR gerado depois, em "Gerir grupo").'
            : 'ℹ️ Este grupo aparecerá automaticamente para <strong>todos os utilizadores cadastrados</strong> — não é preciso convidar ninguém.';
    }

    function createGroup() {
        const name = document.getElementById('groupName').value.trim();
        if (!name) return alert('Digite o nome do grupo!');
        const isPrivate = document.getElementById('groupPrivateInput').checked;
        socket.emit('create_group', { name, private: isPrivate });
        closeModal('modalCreateGroup');
        // A lista de conversas é atualizada assim que o servidor confirmar via 'groups_update'
        // (chega para todos os usuários cadastrados, não só para quem criou — exceto grupos
        // privados, que só chegam a quem já é membro).
    }

    // ==================== COMUNIDADES ====================
    // Uma comunidade junta vários grupos já existentes debaixo de um mesmo
    // nome e ganha automaticamente um canal de anúncios (📢, aparece na lista
    // de conversas como um grupo normal) onde só os administradores da
    // comunidade podem publicar — a restrição é aplicada pelo servidor (ver
    // 'send_message' em server.js), aqui só mostramos a interface.
    function openCommunitiesScreen() {
        document.getElementById('modalCommunities').classList.add('active');
        renderCommunitiesList();
    }
    function renderCommunitiesList() {
        const box = document.getElementById('communitiesListBox');
        if (!APP.communitiesList.length) {
            box.innerHTML = '<p class="member-count">Ainda não existe nenhuma comunidade. Cria a primeira!</p>';
            return;
        }
        box.innerHTML = APP.communitiesList.map(c => {
            const isAdmin = (c.admins || []).includes(APP.user.phone);
            return `
                <div style="border:1px solid var(--border-color);border-radius:10px;padding:10px;">
                    <div style="font-weight:600;">🌐 ${escapeHtml(c.name)}</div>
                    ${c.description ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${escapeHtml(c.description)}</div>` : ''}
                    <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">${(c.groupIds || []).length} grupo(s) ligado(s)</div>
                    <div style="display:flex;gap:6px;margin-top:8px;">
                        <button class="btn-small" onclick="closeModal('modalCommunities');openChat('${c.announcementGroupId}')">📢 Ver anúncios</button>
                        ${isAdmin ? `<button class="btn-small" onclick="openManageCommunityModal('${c.id}')">⚙️ Gerir</button>` : ''}
                    </div>
                </div>`;
        }).join('');
    }
    function openCreateCommunityModal() {
        document.getElementById('communityNameInput').value = '';
        document.getElementById('communityDescriptionInput').value = '';
        document.getElementById('modalCreateCommunity').classList.add('active');
    }
    function createCommunity() {
        const name = document.getElementById('communityNameInput').value.trim();
        if (!name) return alert('Digite o nome da comunidade!');
        const description = document.getElementById('communityDescriptionInput').value.trim();
        socket.emit('create_community', { name, description });
        closeModal('modalCreateCommunity');
    }
    function openManageCommunityModal(communityId) {
        APP.currentManagedCommunityId = communityId;
        document.getElementById('modalManageCommunity').classList.add('active');
        renderManageCommunityModal();
    }
    function renderManageCommunityModal() {
        const community = APP.communitiesList.find(c => c.id === APP.currentManagedCommunityId);
        if (!community) { closeModal('modalManageCommunity'); return; }
        const isAdmin = (community.admins || []).includes(APP.user.phone);
        document.getElementById('manageCommunityTitle').textContent = '🌐 Gerir · ' + community.name;
        document.getElementById('manageCommunityDescription').textContent = community.description || '';

        const groupsBox = document.getElementById('manageCommunityGroupsBox');
        groupsBox.innerHTML = (community.groupIds || []).map(gId => {
            const g = APP.groupsList.find(x => x.id === gId);
            const label = g ? (g.announcementsOnly ? '📢 ' + g.name + ' (canal de anúncios)' : '👥 ' + g.name) : gId;
            const canRemove = isAdmin && gId !== community.announcementGroupId;
            return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">
                <span>${escapeHtml(label)}</span>
                ${canRemove ? `<button class="btn-small btn-danger" onclick="removeGroupFromCommunity('${gId}')">Desligar</button>` : ''}
            </div>`;
        }).join('') || '<p class="member-count">Nenhum grupo ligado.</p>';

        const addGroupBox = document.getElementById('manageCommunityAddGroupBox');
        const addGroupSelect = document.getElementById('manageCommunityAddGroupSelect');
        if (isAdmin) {
            addGroupBox.style.display = 'flex';
            const linkable = APP.groupsList.filter(g => !g.announcementsOnly && !g.communityId && (g.admins || []).includes(APP.user.phone));
            addGroupSelect.innerHTML = linkable.length
                ? linkable.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('')
                : '<option value="">Sem grupos teus disponíveis para ligar</option>';
        } else {
            addGroupBox.style.display = 'none';
        }

        // Um admin da comunidade pode muito bem ser alguém que nunca foi
        // adicionado aos MEUS contactos diretamente (só se cruzaram por um
        // grupo/comunidade em comum) — por isso o nome não vem de
        // 'nameForPhone' (que só conhece contactos diretos), mas do mesmo
        // pedido ao servidor já usado para resolver nomes no "Acertar contas".
        const adminsBox = document.getElementById('manageCommunityAdminsBox');
        const admins = community.admins || [];
        adminsBox.innerHTML = admins.map(phone => `<div data-admin-phone="${phone}" style="display:flex;justify-content:space-between;align-items:center;font-size:13px;"><span>A carregar…</span></div>`).join('');
        const renderedCommunityId = community.id;
        Promise.all(admins.map(phone => resolveParticipantPublicInfo(phone))).then((infos) => {
            if (APP.currentManagedCommunityId !== renderedCommunityId) return; // saiu deste modal entretanto
            adminsBox.innerHTML = admins.map((phone, i) => {
                const displayName = infos[i]?.name || phone;
                const canDemote = isAdmin && phone !== community.createdByPhone && phone !== APP.user.phone;
                return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">
                    <span>${escapeHtml(displayName)}${phone === community.createdByPhone ? ' (criador)' : ''}</span>
                    ${canDemote ? `<button class="btn-small btn-danger" onclick="communitySetRole('${phone}','member')">Remover admin</button>` : ''}
                </div>`;
            }).join('');
        });

        document.getElementById('deleteCommunityBtn').style.display = (community.createdByPhone === APP.user.phone) ? 'inline-block' : 'none';
    }
    function addGroupToCommunity() {
        const groupId = document.getElementById('manageCommunityAddGroupSelect').value;
        if (!groupId) return;
        socket.emit('community_add_group', { communityId: APP.currentManagedCommunityId, groupId });
    }
    function removeGroupFromCommunity(groupId) {
        if (!confirm('Desligar este grupo da comunidade?')) return;
        socket.emit('community_remove_group', { communityId: APP.currentManagedCommunityId, groupId });
    }
    function communitySetRole(targetPhone, role) {
        socket.emit('community_set_role', { communityId: APP.currentManagedCommunityId, targetPhone, role });
    }
    function deleteCommunityConfirm() {
        const community = APP.communitiesList.find(c => c.id === APP.currentManagedCommunityId);
        if (!community) return;
        if (!confirm(`Apagar a comunidade "${community.name}"? Os grupos ligados continuam a existir, mas o canal de anúncios é apagado. Esta ação não pode ser desfeita.`)) return;
        socket.emit('community_delete', { communityId: APP.currentManagedCommunityId });
        closeModal('modalManageCommunity');
        closeModal('modalCommunities');
    }

    // ==================== SOS/EMERGÊNCIA ====================
    // Só contactos REAIS (APP.chats do tipo 'user') podem ser escolhidos como
    // "de confiança" — o servidor valida isto de novo do seu lado (ver
    // 'set_trusted_contacts'), isto aqui é só para a lista aparecer certa.
    function openSosModal() {
        const box = document.getElementById('sosTrustedContactsBox');
        const contacts = APP.chats.filter(c => c.type === 'user');
        const trusted = new Set(APP.trustedContacts || []);
        box.innerHTML = contacts.length ? contacts.map(c => `
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;">
                <input type="checkbox" class="sos-trusted-checkbox" value="${c.phone}" ${trusted.has(c.phone) ? 'checked' : ''}>
                ${escapeHtml(c.name)}
            </label>`).join('') : '<p class="member-count">Ainda não tens nenhum contacto para escolher.</p>';
        document.getElementById('sosStatus').textContent = '';
        document.getElementById('modalSos').classList.add('active');
    }
    function saveTrustedContacts() {
        const phones = [...document.querySelectorAll('.sos-trusted-checkbox:checked')].map(el => el.value);
        if (phones.length > 10) return alert('Escolhe no máximo 10 contactos de confiança.');
        socket.emit('set_trusted_contacts', { phones });
    }
    socket.on('trusted_contacts_updated', (list) => {
        APP.trustedContacts = list || [];
        const statusEl = document.getElementById('sosStatus');
        if (document.getElementById('modalSos')?.classList.contains('active') && statusEl) {
            statusEl.style.color = 'var(--green)';
            statusEl.textContent = `✅ ${APP.trustedContacts.length} contacto(s) de confiança guardado(s).`;
        }
    });
    function triggerSosAlert() {
        if (!(APP.trustedContacts || []).length) {
            return alert('Escolhe pelo menos um "contacto de confiança" e guarda antes de enviar um alerta de SOS.');
        }
        if (!confirm('Enviar um alerta de SOS agora? Isto avisa já os teus contactos de confiança com a tua localização.')) return;
        const statusEl = document.getElementById('sosStatus');
        statusEl.style.color = 'inherit';
        statusEl.textContent = '📍 A obter a tua localização...';
        const send = (lat, lng) => {
            statusEl.textContent = '🚨 A enviar o alerta...';
            socket.emit('sos_alert', { lat, lng });
        };
        if (!navigator.geolocation) { send(null, null); return; }
        navigator.geolocation.getCurrentPosition(
            (pos) => send(pos.coords.latitude, pos.coords.longitude),
            () => send(null, null), // sem localização, envia o alerta na mesma
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
    }
    socket.on('sos_alert_result', (data) => {
        const statusEl = document.getElementById('sosStatus');
        if (!statusEl) return;
        if (data?.success) {
            statusEl.style.color = 'var(--green)';
            statusEl.textContent = `✅ Alerta enviado a ${data.sentTo} contacto(s) de confiança.`;
        } else {
            statusEl.style.color = '#e74c3c';
            statusEl.textContent = '⚠️ Não foi possível enviar — configura pelo menos um contacto de confiança primeiro.';
        }
    });
    // Chega mesmo que quem recebe nunca tenha aberto essa conversa antes
    // (ver deliverToPhone no servidor) — por isso mostra-se logo um aviso
    // visível no ecrã, independente da conversa que estiver aberta.
    function showSosAlertBanner(data) {
        const bannerId = 'sosBanner_' + Date.now();
        const el = document.createElement('div');
        el.id = bannerId;
        el.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#c0392b;color:#fff;z-index:10000;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;box-shadow:0 2px 10px rgba(0,0,0,0.4);';
        const mapsBtn = (data.lat != null && data.lng != null) ? `<a href="https://www.google.com/maps?q=${data.lat},${data.lng}" target="_blank" rel="noopener noreferrer" style="color:#fff;background:rgba(255,255,255,0.2);padding:6px 10px;border-radius:6px;text-decoration:none;font-size:13px;">🗺️ Ver no mapa</a>` : '';
        el.innerHTML = `
            <span style="font-weight:700;">🚨 ${escapeHtml(data.fromName || 'Alguém')} enviou um alerta de emergência!</span>
            <div style="display:flex;gap:8px;align-items:center;">
                ${mapsBtn}
                <button onclick="document.getElementById('${bannerId}').remove()" style="background:rgba(255,255,255,0.2);color:#fff;border:none;padding:6px 10px;border-radius:6px;cursor:pointer;">Fechar</button>
            </div>`;
        document.body.appendChild(el);
    }
    socket.on('sos_alert_received', (data) => { showSosAlertBanner(data); });
    function renderSosAlertMessage(msg) {
        const mapsLink = (msg.sosLat != null && msg.sosLng != null)
            ? `<a href="https://www.google.com/maps?q=${msg.sosLat},${msg.sosLng}" target="_blank" rel="noopener noreferrer" style="color:#fff;text-decoration:underline;">🗺️ Ver localização no mapa</a>`
            : '<span style="opacity:0.85;">📍 Localização não disponível</span>';
        return `<div style="background:#c0392b;color:#fff;border-radius:8px;padding:10px 12px;">
            <div style="font-weight:700;">🚨 Alerta de emergência</div>
            <div style="margin-top:4px;font-size:13px;">${escapeHtml(msg.sender || 'Alguém')} pode precisar de ajuda.</div>
            <div style="margin-top:6px;">${mapsLink}</div>
        </div>`;
    }

    // ==================== ENQUETES EM GRUPO ====================
    function openCreatePollModal() {
        document.getElementById('pollQuestionInput').value = '';
        document.getElementById('pollQuestionInput').placeholder = 'Pergunta da enquete...';
        document.getElementById('pollOptionsInputs').innerHTML = `
            <input type="text" class="poll-option-input" placeholder="Opção 1">
            <input type="text" class="poll-option-input" placeholder="Opção 2">`;
        document.getElementById('pollExpirySelect').value = '0';
        document.getElementById('pollHideResultsInput').checked = false;
        document.getElementById('modalCreatePoll').classList.add('active');
    }
    // Atalho de "RSVP": um evento é só uma enquete normal com as opções já
    // prontas (Vou/Não vou/Talvez) — reaproveita 100% da estrutura de
    // enquetes já existente (mesmos dados, mesmo render, mesmo voto).
    function openCreateRsvpModal() {
        document.getElementById('pollQuestionInput').value = '';
        document.getElementById('pollQuestionInput').placeholder = 'Nome do evento (ex.: Festa de sábado às 22h)';
        document.getElementById('pollOptionsInputs').innerHTML = `
            <input type="text" class="poll-option-input" value="✅ Vou">
            <input type="text" class="poll-option-input" value="❌ Não vou">
            <input type="text" class="poll-option-input" value="🤔 Talvez">`;
        document.getElementById('pollExpirySelect').value = '0';
        document.getElementById('pollHideResultsInput').checked = false;
        document.getElementById('modalCreatePoll').classList.add('active');
    }
    function addPollOptionInput() {
        const container = document.getElementById('pollOptionsInputs');
        const count = container.querySelectorAll('.poll-option-input').length;
        if (count >= 8) return alert('Máximo de 8 opções.');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'poll-option-input';
        input.placeholder = 'Opção ' + (count + 1);
        container.appendChild(input);
    }
    function sendPoll() {
        const question = document.getElementById('pollQuestionInput').value.trim();
        const options = [...document.querySelectorAll('.poll-option-input')]
            .map(el => el.value.trim())
            .filter(Boolean);
        if (!question) return alert('Escreve a pergunta da enquete.');
        if (options.length < 2) return alert('Adiciona pelo menos 2 opções.');
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat || chat.type !== 'group') return;
        const msgId = 'm' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const expiryMs = parseInt(document.getElementById('pollExpirySelect').value) || 0;
        const hideUntilVoted = document.getElementById('pollHideResultsInput').checked;
        // 'resultsHiddenForViewer' aqui é só para a exibição otimista imediata de quem
        // acabou de criar a enquete (ainda sem ter votado) — o servidor recalcula este
        // campo sempre que reenvia a enquete (ver sanitizePollForViewer), por isso não há
        // como ficar preso neste estado depois de a pessoa votar.
        const poll = { question, options: options.map(text => ({ text, votes: [] })), expiresAt: expiryMs ? Date.now() + expiryMs : null, hideUntilVoted, resultsHiddenForViewer: hideUntilVoted };
        if (!APP.messages[APP.currentChatId]) APP.messages[APP.currentChatId] = [];
        APP.messages[APP.currentChatId].push({ id: msgId, sender: 'Você', text: '', time, type: 'sent', poll, read: false });
        renderMessages();
        renderChatList();
        closeModal('modalCreatePoll');
        socket.emit('send_message', { id: msgId, chatId: APP.currentChatId, sender: APP.user.name, senderPhone: APP.user.phone, text: '', time, poll });
    }
    function formatPollExpiry(ts) {
        const diffMs = ts - Date.now();
        if (diffMs <= 0) return 'agora';
        const mins = Math.round(diffMs / 60000);
        if (mins < 60) return `em ${mins} min`;
        const hours = Math.round(mins / 60);
        if (hours < 48) return `em ${hours}h`;
        return `em ${Math.round(hours / 24)} dias`;
    }
    function renderPoll(msg) {
        const poll = msg.poll;
        const isExpired = !!(poll.expiresAt && Date.now() > poll.expiresAt);
        const totalVotes = poll.options.reduce((sum, o) => sum + o.votes.length, 0);
        const myVoteIndex = poll.options.findIndex(o => o.votes.includes(APP.user.phone));
        // Quando a enquete tem "esconder resultados até votar" e ainda não votámos, o
        // servidor já nem sequer envia os votos reais (ver sanitizePollForViewer) — aqui
        // só se decide como apresentar isso, a segurança da coisa é toda do lado do servidor.
        const resultsHidden = !!poll.resultsHiddenForViewer;
        const optionsHtml = poll.options.map((opt, i) => {
            const pct = totalVotes ? Math.round((opt.votes.length / totalVotes) * 100) : 0;
            const isMine = i === myVoteIndex;
            const barWidth = resultsHidden ? 0 : pct;
            const resultLabel = resultsHidden ? '' : `<span style="flex-shrink:0;">${pct}% (${opt.votes.length})</span>`;
            return `
                <div ${isExpired ? '' : `onclick="votePoll('${msg.id}', ${i})"`} style="cursor:${isExpired ? 'default' : 'pointer'};opacity:${isExpired ? 0.7 : 1};margin:6px 0;padding:8px 10px;border-radius:8px;background:${isMine ? 'rgba(37,211,102,0.3)' : 'rgba(255,255,255,0.08)'};border:1px solid ${isMine ? 'var(--green)' : 'transparent'};position:relative;overflow:hidden;">
                    <div style="position:absolute;left:0;top:0;bottom:0;width:${barWidth}%;background:rgba(255,255,255,0.1);z-index:0;"></div>
                    <div style="position:relative;z-index:1;display:flex;justify-content:space-between;gap:8px;">
                        <span>${isMine ? '✓ ' : ''}${escapeHtml(opt.text)}</span>
                        ${resultLabel}
                    </div>
                </div>`;
        }).join('');
        const expiryLine = poll.expiresAt
            ? (isExpired ? '<div style="font-size:10px;color:#e74c3c;margin-top:4px;">🔒 Votação encerrada</div>' : `<div style="font-size:10px;opacity:0.7;margin-top:4px;">⏳ Encerra ${formatPollExpiry(poll.expiresAt)}</div>`)
            : '';
        const totalVotesLine = resultsHidden
            ? '<div style="font-size:11px;opacity:0.7;margin-top:4px;">🙈 Os resultados aparecem depois de votares</div>'
            : `<div style="font-size:11px;opacity:0.7;margin-top:4px;">${totalVotes} voto${totalVotes !== 1 ? 's' : ''}</div>`;
        return `<div style="min-width:200px;">
            <div style="font-weight:600;margin-bottom:6px;">📊 ${escapeHtml(poll.question)}</div>
            ${optionsHtml}
            ${totalVotesLine}
            ${expiryLine}
        </div>`;
    }
    function votePoll(messageId, optionIndex) {
        if (!APP.currentChatId) return;
        const msg = (APP.messages[APP.currentChatId] || []).find(m => m.id === messageId);
        if (msg?.poll?.expiresAt && Date.now() > msg.poll.expiresAt) return;
        socket.emit('vote_poll', { chatId: APP.currentChatId, messageId, optionIndex });
    }
    // Reavalia periodicamente as enquetes com prazo (a contagem/estado "encerrada"
    // não muda sozinha na tela sem isto, já que só re-renderiza quando chega
    // mensagem nova ou um voto).
    setInterval(() => {
        const msgs = APP.messages[APP.currentChatId] || [];
        if (msgs.some(m => m.poll?.expiresAt)) renderMessages();
    }, 30000);
    socket.on('poll_updated', (data) => {
        if (!data?.chatId || !data?.messageId) return;
        const msgs = APP.messages[data.chatId];
        const msg = msgs?.find(m => m.id === data.messageId);
        if (!msg) return;
        msg.poll = data.poll;
        if (APP.currentChatId === data.chatId) renderMessages();
    });

    // ==================== DESPESAS DE VIAGEM (divisão simples entre quem participou na conversa) ====================
    // Os grupos aqui são "abertos" (todos os utilizadores cadastrados veem-nos, sem lista fixa de
    // membros), por isso os "participantes" de uma despesa são derivados dos nomes de quem já enviou
    // mensagens nesta conversa — são identificados por NOME, não por telefone (limitação assumida).
    function getChatParticipantNames(chatId) {
        // O próprio nome (não o literal "Você") tem de ser o valor guardado —
        // isto viaja dentro do objeto expense/despesa fixa para a OUTRA pessoa
        // (send_message manda o expense tal como está, ao contrário do campo
        // "sender" de topo, que já troca "Você" pelo nome real antes de enviar).
        // Guardar "Você" aqui fazia a outra pessoa ver "Pago por Você" (parecendo
        // que ela mesma tinha pago) e partia qualquer código que precise de
        // identificar quem é quem pelo nome (ex.: acertar contas por Pix/MB WAY).
        const names = new Set(APP.user ? [APP.user.name] : []);
        const msgs = APP.messages[chatId] || [];
        msgs.forEach(m => { if (m.sender && m.sender !== 'Você') names.add(m.sender); });
        return [...names];
    }
    // Só para apresentação (nunca guardar isto) — mostra "Você" quando o nome
    // é o do próprio utilizador, tal como o resto da app já faz com as
    // mensagens; qualquer outro nome aparece tal como é.
    function participantDisplayLabel(name) {
        return (APP.user && name === APP.user.name) ? 'Você' : name;
    }
    function getChatExpenses(chatId) {
        return (APP.messages[chatId] || []).filter(m => m.expense).map(m => m.expense);
    }
    // ==================== GRÁFICO DE DESPESAS AO LONGO DO TEMPO ====================
    // Agrupa as despesas (avulsas + fixas recorrentes) por mês, usando o
    // "createdAt" (data real, ver submitExpense/servidor) — despesas antigas
    // criadas antes desta funcionalidade não têm essa data e ficam de fora do
    // gráfico (não há como saber quando foram criadas, só a hora do dia).
    function computeExpensesOverTime(chatId) {
        const byMonth = {};
        getChatExpenses(chatId).forEach(exp => {
            if (!exp.createdAt) return;
            const d = new Date(exp.createdAt);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            byMonth[key] = (byMonth[key] || 0) + exp.amountEUR;
        });
        return Object.keys(byMonth).sort().slice(-12).map(key => ({ key, total: byMonth[key] }));
    }
    function openExpensesChartModal() {
        if (!APP.currentChatId) return;
        const data = computeExpensesOverTime(APP.currentChatId);
        const container = document.getElementById('expensesChartBars');
        if (!data.length) {
            container.innerHTML = '<p style="color:#8696a0;text-align:center;padding:20px;">Ainda não há despesas com data suficiente para mostrar um gráfico (só entram despesas criadas depois desta funcionalidade existir).</p>';
        } else {
            const maxVal = Math.max(1, ...data.map(d => d.total));
            container.innerHTML = data.map(d => {
                const heightPct = Math.max(4, Math.round((d.total / maxVal) * 100));
                const [y, m] = d.key.split('-');
                const label = new Date(y, m - 1, 1).toLocaleDateString('pt-PT', { month: 'short', year: '2-digit' });
                return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;flex:0 0 44px;height:180px;">
                    <div style="font-size:10px;opacity:0.8;margin-bottom:3px;">${d.total.toFixed(0)}€</div>
                    <div style="width:70%;background:var(--green);border-radius:4px 4px 0 0;height:${heightPct}%;"></div>
                    <div style="font-size:10px;opacity:0.7;margin-top:4px;white-space:nowrap;">${label}</div>
                </div>`;
            }).join('');
        }
        closeModal('modalExpenses');
        document.getElementById('modalExpensesChart').classList.add('active');
    }
    function openExpensesModal() {
        if (!APP.currentChatId) return;
        renderExpensesModal();
        document.getElementById('modalExpenses').classList.add('active');
    }
    function renderExpensesModal() {
        const expenses = getChatExpenses(APP.currentChatId);
        const balances = {};
        expenses.forEach(exp => {
            const share = exp.amountEUR / exp.participants.length;
            balances[exp.paidBy] = (balances[exp.paidBy] || 0) + exp.amountEUR;
            exp.participants.forEach(p => { balances[p] = (balances[p] || 0) - share; });
        });
        const balancesHtml = Object.keys(balances).length ? Object.entries(balances).map(([name, val]) => {
            const rounded = Math.round(val * 100) / 100;
            const color = rounded > 0.01 ? 'var(--green)' : (rounded < -0.01 ? '#e74c3c' : 'inherit');
            const label = rounded > 0.01 ? `deve receber ${rounded.toFixed(2)}€` : (rounded < -0.01 ? `deve ${Math.abs(rounded).toFixed(2)}€` : 'em dia');
            return `<div style="display:flex;justify-content:space-between;padding:4px 0;"><span>${escapeHtml(participantDisplayLabel(name))}</span><span style="color:${color};font-weight:600;">${label}</span></div>`;
        }).join('') : '<div style="opacity:0.7;font-size:13px;">Ainda sem despesas registadas.</div>';
        document.getElementById('expensesBalancesBox').innerHTML = `<div style="background:rgba(255,255,255,0.06);border-radius:8px;padding:8px 10px;">${balancesHtml}</div>`;
        renderSettleUpBox(balances);
        const listHtml = expenses.length ? expenses.slice().reverse().map(exp => `
            <div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:8px 10px;font-size:13px;">
                <div style="font-weight:600;">${escapeHtml(exp.description)} — ${exp.amount.toLocaleString('pt-PT', { maximumFractionDigits: 2 })} ${escapeHtml(exp.currency)}</div>
                <div style="opacity:0.75;">Pago por ${escapeHtml(participantDisplayLabel(exp.paidBy))} · dividido por ${exp.participants.length} pessoa${exp.participants.length !== 1 ? 's' : ''}</div>
            </div>`).join('') : '';
        document.getElementById('expensesList').innerHTML = listHtml;
    }
    // Reaproveita os mesmos dados/cálculos de renderExpensesModal() (lista de
    // despesas, saldos e "como acertar contas"), só que num PDF para
    // guardar/partilhar fora da app — mesmo gerador (jsPDF, carregado sob
    // demanda) já usado para a conversa e a lista de compras.
    async function exportExpensesToPdf() {
        if (!APP.currentChatId) return;
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        const expenses = getChatExpenses(APP.currentChatId);
        const balances = {};
        expenses.forEach(exp => {
            const share = exp.amountEUR / exp.participants.length;
            balances[exp.paidBy] = (balances[exp.paidBy] || 0) + exp.amountEUR;
            exp.participants.forEach(p => { balances[p] = (balances[p] || 0) - share; });
        });
        const transfers = simplifyDebts(balances);
        try {
            await loadJsPdfScript();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            const marginX = 14;
            const maxWidth = doc.internal.pageSize.getWidth() - marginX * 2;
            let y = 18;
            const ensureSpace = (needed = 8) => { if (y > 297 - needed) { doc.addPage(); y = 20; } };
            doc.setFontSize(16);
            doc.text(`Despesas: ${chat?.name || 'Conversa'}`, marginX, y);
            y += 7;
            doc.setFontSize(9);
            doc.setTextColor(120);
            doc.text(`Exportado em ${new Date().toLocaleString('pt-BR')}`, marginX, y);
            doc.setTextColor(0);
            y += 10;

            doc.setFontSize(13);
            doc.text('Saldos', marginX, y);
            y += 7;
            doc.setFontSize(11);
            if (!Object.keys(balances).length) {
                doc.text('Ainda sem despesas registadas.', marginX, y);
                y += 7;
            } else {
                Object.entries(balances).forEach(([name, val]) => {
                    const rounded = Math.round(val * 100) / 100;
                    const label = rounded > 0.01 ? `deve receber ${rounded.toFixed(2)}€` : (rounded < -0.01 ? `deve ${Math.abs(rounded).toFixed(2)}€` : 'em dia');
                    ensureSpace();
                    doc.text(`${participantDisplayLabel(name)}: ${label}`, marginX, y);
                    y += 7;
                });
            }
            y += 4;

            if (transfers.length) {
                ensureSpace(14);
                doc.setFontSize(13);
                doc.text('Como acertar contas', marginX, y);
                y += 7;
                doc.setFontSize(11);
                transfers.forEach(t => {
                    ensureSpace();
                    doc.text(`${participantDisplayLabel(t.from)} → ${participantDisplayLabel(t.to)}: ${t.amountEUR.toFixed(2)}€`, marginX, y);
                    y += 7;
                });
                y += 4;
            }

            ensureSpace(14);
            doc.setFontSize(13);
            doc.text('Despesas', marginX, y);
            y += 7;
            doc.setFontSize(11);
            if (!expenses.length) {
                doc.text('(Nenhuma despesa nesta conversa.)', marginX, y);
            } else {
                expenses.forEach((exp) => {
                    const line1 = `${exp.description} — ${exp.amount.toLocaleString('pt-PT', { maximumFractionDigits: 2 })} ${exp.currency}`;
                    const line2 = `Pago por ${participantDisplayLabel(exp.paidBy)} · dividido por ${exp.participants.length} pessoa${exp.participants.length !== 1 ? 's' : ''}`;
                    [...doc.splitTextToSize(line1, maxWidth), ...doc.splitTextToSize(line2, maxWidth)].forEach((line) => {
                        ensureSpace();
                        doc.text(line, marginX, y);
                        y += 6;
                    });
                    y += 2;
                });
            }
            doc.save(`despesas_${(chat?.name || 'chat').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
        } catch (err) {
            alert('⚠️ Não foi possível gerar o PDF agora: ' + err.message);
        }
    }
    // ==================== ACERTAR CONTAS (MB WAY / Pix) ====================
    // Reaproveita os saldos já calculados em renderExpensesModal() (quem deve/tem
    // a receber) e simplifica-os no menor número de transferências possível
    // (algoritmo guloso: o maior credor recebe do maior devedor até um dos dois
    // ficar a zero, repete) — evita mostrar "A deve a B" e "B deve a A" ao mesmo
    // tempo quando um simples "A paga a C" já resolve tudo.
    function simplifyDebts(balances) {
        const creditors = [], debtors = [];
        Object.entries(balances).forEach(([name, val]) => {
            const rounded = Math.round(val * 100) / 100;
            if (rounded > 0.01) creditors.push({ name, amount: rounded });
            else if (rounded < -0.01) debtors.push({ name, amount: -rounded });
        });
        creditors.sort((a, b) => b.amount - a.amount);
        debtors.sort((a, b) => b.amount - a.amount);
        const transfers = [];
        let i = 0, j = 0;
        while (i < debtors.length && j < creditors.length) {
            const pay = Math.min(debtors[i].amount, creditors[j].amount);
            if (pay > 0.01) transfers.push({ from: debtors[i].name, to: creditors[j].name, amountEUR: Math.round(pay * 100) / 100 });
            debtors[i].amount -= pay;
            creditors[j].amount -= pay;
            if (debtors[i].amount <= 0.01) i++;
            if (creditors[j].amount <= 0.01) j++;
        }
        return transfers;
    }
    function renderSettleUpBox(balances) {
        const transfers = simplifyDebts(balances);
        const box = document.getElementById('settleUpBox');
        if (!transfers.length) { box.innerHTML = ''; return; }
        box.innerHTML = `<div style="background:rgba(255,255,255,0.06);border-radius:8px;padding:8px 10px;">
            <div style="font-weight:600;font-size:12px;margin-bottom:6px;">💳 Como acertar contas</div>
            ${transfers.map(t => `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0;font-size:13px;">
                    <span>${escapeHtml(participantDisplayLabel(t.from))} → ${escapeHtml(participantDisplayLabel(t.to))}: <strong>${t.amountEUR.toFixed(2)}€</strong></span>
                    <button class="btn-small" onclick='openSettleUpPay(${JSON.stringify(t.to)}, ${t.amountEUR}, ${JSON.stringify(t.from)})' style="padding:4px 8px;">Ver</button>
                </div>`).join('')}
        </div>`;
    }
    // Descobre o telefone de quem participa numa despesa a partir só do nome
    // (grupos aqui não têm lista fixa de membros — ver "Dividir despesas de
    // viagem"): se for a própria pessoa ou o outro lado de uma conversa
    // 1-para-1 já sabemos o telefone sem perguntar a ninguém; num grupo,
    // procura-se uma mensagem já enviada por alguém com esse nome (toda a
    // mensagem carrega senderPhone) e usa-se o telefone de lá.
    function resolveParticipantPhone(name) {
        if (APP.user && name === APP.user.name) return APP.user.phone;
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (chat && chat.type === 'user' && chat.name === name) return chat.phone;
        const msgs = APP.messages[APP.currentChatId] || [];
        const found = [...msgs].reverse().find(m => m.sender === name && m.senderPhone);
        return found ? found.senderPhone : null;
    }
    function resolveParticipantPublicInfo(phone) {
        return new Promise((resolve) => {
            if (APP.user && phone === APP.user.phone) return resolve({ name: APP.user.name, phone, pixKey: APP.user.pixKey || null });
            const cached = (APP.onlineContacts || []).find(c => c.phone === phone);
            if (cached) return resolve(cached);
            const onResult = (data) => {
                if (data.phone !== phone) return;
                socket.off('public_info_by_phone_result', onResult);
                resolve(data.found ? data.user : null);
            };
            socket.on('public_info_by_phone_result', onResult);
            socket.emit('get_public_info_by_phone', { phone });
            setTimeout(() => { socket.off('public_info_by_phone_result', onResult); resolve(null); }, 5000);
        });
    }
    // ==================== CÓDIGO PIX ("copia e cola" / BR Code) ====================
    // Implementação do formato EMV QRCPS usado pelo Pix (especificação pública
    // do Banco Central) — TLV (tag-length-value) terminado num CRC16/CCITT-FALSE
    // (poly 0x1021, init 0xFFFF). Gera-se aqui mesmo no cliente porque é puro
    // cálculo determinístico, sem precisar de nenhuma API externa nem credenciais.
    function pixCrc16(str) {
        let crc = 0xFFFF;
        for (let i = 0; i < str.length; i++) {
            crc ^= (str.charCodeAt(i) << 8);
            for (let j = 0; j < 8; j++) {
                crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
            }
        }
        return crc & 0xFFFF;
    }
    function pixTlv(id, value) {
        return id + String(value.length).padStart(2, '0') + value;
    }
    function pixSanitize(s, maxLen) {
        // NFD decompõe acentos em letra + marca separada (ex.: "ã" -> "a" + til);
        // o replace seguinte já elimina essa marca (não é A-Za-z0-9/espaço), por
        // isso não precisa de mais nenhum passo específico para diacríticos.
        return (s || '').normalize('NFD').replace(/[^A-Za-z0-9 ]/g, '').slice(0, maxLen);
    }
    function buildPixPayload({ pixKey, amountBRL, description, merchantName, merchantCity }) {
        const gui = pixTlv('00', 'br.gov.bcb.pix');
        const key = pixTlv('01', pixKey);
        const desc = description ? pixTlv('02', pixSanitize(description, 60)) : '';
        const merchantAccountInfo = pixTlv('26', gui + key + desc);
        const mcc = pixTlv('52', '0000');
        const currency = pixTlv('53', '986'); // BRL
        const amountField = amountBRL != null ? pixTlv('54', amountBRL.toFixed(2)) : '';
        const country = pixTlv('58', 'BR');
        const name = pixTlv('59', (pixSanitize(merchantName, 25) || 'NA').toUpperCase());
        const city = pixTlv('60', (pixSanitize(merchantCity, 15) || 'BRASIL').toUpperCase());
        const txid = pixTlv('62', pixTlv('05', '***'));
        const withoutCrc = pixTlv('00', '01') + merchantAccountInfo + mcc + currency + amountField + country + name + city + txid + '6304';
        return withoutCrc + pixCrc16(withoutCrc).toString(16).toUpperCase().padStart(4, '0');
    }
    function copyToClipboardWithFeedback(text, btn) {
        navigator.clipboard.writeText(text).then(() => {
            if (!btn) return;
            const original = btn.textContent;
            btn.textContent = '✅ Copiado!';
            setTimeout(() => { btn.textContent = original; }, 1500);
        }).catch(() => alert('Não foi possível copiar — copia manualmente.'));
    }
    async function openSettleUpPay(toName, amountEUR, fromName) {
        const fromLabel = participantDisplayLabel(fromName), toLabel = participantDisplayLabel(toName);
        document.getElementById('settleUpPayTitle').textContent = `💳 ${fromLabel} → ${toLabel}`;
        const content = document.getElementById('settleUpPayContent');
        content.innerHTML = '<p style="color:var(--text-secondary);">A procurar dados de pagamento...</p>';
        closeModal('modalExpenses');
        document.getElementById('modalSettleUpPay').classList.add('active');
        const phone = resolveParticipantPhone(toName);
        if (!phone) {
            content.innerHTML = `<p>Não foi possível encontrar o telefone de ${escapeHtml(toLabel)} nesta conversa. Pede-lhe o número ou a chave Pix diretamente.</p>`;
            return;
        }
        const info = await resolveParticipantPublicInfo(phone);
        const parts = [];
        parts.push(`<p style="margin-bottom:10px;"><strong>${escapeHtml(fromLabel)}</strong> deve pagar <strong>${amountEUR.toFixed(2)}€</strong> a <strong>${escapeHtml(toLabel)}</strong>.</p>`);
        // MB WAY: paga-se por número de telefone, valor em EUR — sem chave/link
        // universal público para MB WAY (ao contrário do Pix), por isso mostra-se
        // só o número + valor para introduzir manualmente na app do MB WAY.
        parts.push(`<div style="background:rgba(255,255,255,0.06);border-radius:8px;padding:10px;margin-bottom:10px;">
            <div style="font-weight:600;margin-bottom:4px;">💙 MB WAY</div>
            <div style="font-size:13px;">Envia <strong>${amountEUR.toFixed(2)}€</strong> para o número <strong>${escapeHtml(phone)}</strong> na app MB WAY.</div>
            <button class="btn-small" style="margin-top:6px;" onclick='copyToClipboardWithFeedback(${JSON.stringify(phone)}, this)'>📋 Copiar número</button>
        </div>`);
        if (info && info.pixKey) {
            const rate = (CURRENCY.rates && CURRENCY.rates.BRL) || null;
            const amountBRL = rate ? amountEUR * rate : null;
            const payload = buildPixPayload({ pixKey: info.pixKey, amountBRL, description: 'Acerto de contas', merchantName: toName, merchantCity: 'BRASIL' });
            parts.push(`<div style="background:rgba(255,255,255,0.06);border-radius:8px;padding:10px;">
                <div style="font-weight:600;margin-bottom:4px;">💠 Pix</div>
                <div style="font-size:13px;">${amountBRL != null ? `Equivale a aproximadamente <strong>R$ ${amountBRL.toFixed(2)}</strong>. ` : ''}Copia o código abaixo e cola na app do teu banco (Pix Copia e Cola).</div>
                <textarea readonly style="width:100%;margin-top:6px;font-size:11px;padding:6px;border-radius:6px;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--bg-tertiary);" rows="3">${escapeHtml(payload)}</textarea>
                <button class="btn-small" style="margin-top:6px;" onclick='copyToClipboardWithFeedback(${JSON.stringify(payload)}, this)'>📋 Copiar código Pix</button>
            </div>`);
        } else {
            parts.push(`<div style="font-size:12px;color:var(--text-secondary);">${escapeHtml(toLabel)} ainda não configurou uma chave Pix no perfil.</div>`);
        }
        content.innerHTML = parts.join('');
    }
    function populateExpenseCurrencySelect(selId = 'expenseCurrency') {
        const sel = document.getElementById(selId);
        if (CURRENCY.rates) {
            const codes = Object.keys(CURRENCY.rates);
            const sorted = [...codes].sort((a, b) => {
                const pa = CURRENCY_PRIORITY.indexOf(a), pb = CURRENCY_PRIORITY.indexOf(b);
                if (pa !== -1 || pb !== -1) return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
                return a.localeCompare(b);
            });
            sel.innerHTML = sorted.map(code => {
                const info = CURRENCY_INFO[code];
                const label = info ? `${info.flag} ${code} — ${info.name}` : code;
                return `<option value="${code}">${escapeHtml(label)}</option>`;
            }).join('');
            if (codes.includes('EUR')) sel.value = 'EUR';
        } else {
            sel.innerHTML = '<option value="EUR">🇪🇺 EUR — Euro</option>';
        }
    }
    async function openAddExpenseForm() {
        if (!APP.currentChatId) return;
        document.getElementById('expenseDescription').value = '';
        document.getElementById('expenseAmount').value = '';
        document.getElementById('expenseReceiptStatus').textContent = '';
        if (!CURRENCY.loaded) await loadCurrencyRates();
        populateExpenseCurrencySelect();
        const names = getChatParticipantNames(APP.currentChatId);
        const paidBySel = document.getElementById('expensePaidBy');
        paidBySel.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(participantDisplayLabel(n))}</option>`).join('');
        document.getElementById('expenseParticipants').innerHTML = names.map((n, i) => `
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;">
                <input type="checkbox" class="expense-participant-checkbox" value="${escapeHtml(n)}" checked>
                ${escapeHtml(participantDisplayLabel(n))}
            </label>`).join('');
        closeModal('modalExpenses');
        document.getElementById('modalAddExpense').classList.add('active');
    }
    function submitExpense() {
        const description = document.getElementById('expenseDescription').value.trim();
        const amount = parseFloat(document.getElementById('expenseAmount').value);
        const currency = document.getElementById('expenseCurrency').value;
        const paidBy = document.getElementById('expensePaidBy').value;
        const participants = [...document.querySelectorAll('.expense-participant-checkbox:checked')].map(el => el.value);
        if (!description) return alert('Escreve uma descrição para a despesa.');
        if (!amount || amount <= 0) return alert('Indica um valor válido.');
        if (!participants.length) return alert('Seleciona pelo menos uma pessoa para dividir.');
        const rate = CURRENCY.rates ? CURRENCY.rates[currency] : null;
        const amountEUR = rate ? amount / rate : amount;
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat) return;
        const msgId = 'm' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const expense = { description, amount, currency, amountEUR, paidBy, participants, createdAt: Date.now() };
        if (!APP.messages[APP.currentChatId]) APP.messages[APP.currentChatId] = [];
        APP.messages[APP.currentChatId].push({ id: msgId, sender: 'Você', text: '', time, type: 'sent', expense, read: false });
        renderMessages();
        renderChatList();
        closeModal('modalAddExpense');
        socket.emit('send_message', { id: msgId, chatId: APP.currentChatId, sender: APP.user.name, senderPhone: APP.user.phone, text: '', time, expense });
    }
    function renderExpense(msg) {
        const exp = msg.expense;
        return `<div style="min-width:200px;cursor:pointer;" onclick="openExpensesModal()">
            <div style="font-weight:600;margin-bottom:4px;">💰 ${escapeHtml(exp.description)}</div>
            <div style="font-size:15px;">${exp.amount.toLocaleString('pt-PT', { maximumFractionDigits: 2 })} ${escapeHtml(exp.currency)}</div>
            <div style="font-size:11px;opacity:0.7;margin-top:4px;">Pago por ${escapeHtml(participantDisplayLabel(exp.paidBy))} · dividido por ${exp.participants.length} pessoa${exp.participants.length !== 1 ? 's' : ''}</div>
        </div>`;
    }

    // ==================== DESPESAS FIXAS MENSAIS (RECORRENTES) ====================
    // "Modelos" por conversa que o servidor lança sozinho todos os meses (ver
    // README) — este bloco só trata da parte de gerir/mostrar os modelos; a
    // despesa lançada automaticamente chega como uma mensagem normal com
    // msg.expense, tal como uma despesa avulsa criada por uma pessoa.
    const RECURRING_EXPENSES = {}; // chatId -> lista de modelos
    socket.on('recurring_expenses_list', (data) => {
        if (!data?.chatId) return;
        RECURRING_EXPENSES[data.chatId] = data.list || [];
        if (APP.currentChatId === data.chatId && document.getElementById('modalRecurringExpenses').classList.contains('active')) renderRecurringExpensesModal();
    });
    function openRecurringExpensesModal() {
        if (!APP.currentChatId) return;
        closeModal('modalExpenses');
        renderRecurringExpensesModal();
        document.getElementById('modalRecurringExpenses').classList.add('active');
    }
    function renderRecurringExpensesModal() {
        const list = RECURRING_EXPENSES[APP.currentChatId] || [];
        document.getElementById('recurringExpensesList').innerHTML = list.length ? list.map(tpl => `
            <div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:8px 10px;font-size:13px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
                <div>
                    <div style="font-weight:600;">${escapeHtml(tpl.description)} — ${tpl.amount.toLocaleString('pt-PT', { maximumFractionDigits: 2 })} ${escapeHtml(tpl.currency)}</div>
                    <div style="opacity:0.75;">Todo dia ${tpl.dayOfMonth} · pago por ${escapeHtml(participantDisplayLabel(tpl.paidBy))} · dividido por ${tpl.participants.length} pessoa${tpl.participants.length !== 1 ? 's' : ''}</div>
                </div>
                <button onclick="deleteRecurringExpense('${tpl.id}')" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:14px;">🗑️</button>
            </div>`).join('') : '<p style="color:#8696a0;text-align:center;padding:20px;">Ainda não há despesas fixas nesta conversa.</p>';
    }
    async function openAddRecurringExpenseForm() {
        if (!APP.currentChatId) return;
        document.getElementById('recurringExpenseDescription').value = '';
        document.getElementById('recurringExpenseAmount').value = '';
        if (!CURRENCY.loaded) await loadCurrencyRates();
        populateExpenseCurrencySelect('recurringExpenseCurrency');
        const daySel = document.getElementById('recurringExpenseDayOfMonth');
        daySel.innerHTML = Array.from({ length: 31 }, (_, i) => i + 1).map(d => `<option value="${d}">${d}</option>`).join('');
        const names = getChatParticipantNames(APP.currentChatId);
        const paidBySel = document.getElementById('recurringExpensePaidBy');
        paidBySel.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(participantDisplayLabel(n))}</option>`).join('');
        document.getElementById('recurringExpenseParticipants').innerHTML = names.map(n => `
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;">
                <input type="checkbox" class="recurring-expense-participant-checkbox" value="${escapeHtml(n)}" checked>
                ${escapeHtml(participantDisplayLabel(n))}
            </label>`).join('');
        closeModal('modalRecurringExpenses');
        document.getElementById('modalAddRecurringExpense').classList.add('active');
    }
    function submitRecurringExpense() {
        const description = document.getElementById('recurringExpenseDescription').value.trim();
        const amount = parseFloat(document.getElementById('recurringExpenseAmount').value);
        const currency = document.getElementById('recurringExpenseCurrency').value;
        const dayOfMonth = parseInt(document.getElementById('recurringExpenseDayOfMonth').value);
        const paidBy = document.getElementById('recurringExpensePaidBy').value;
        const participants = [...document.querySelectorAll('.recurring-expense-participant-checkbox:checked')].map(el => el.value);
        if (!description) return alert('Escreve uma descrição para a despesa fixa.');
        if (!amount || amount <= 0) return alert('Indica um valor válido.');
        if (!participants.length) return alert('Seleciona pelo menos uma pessoa para dividir.');
        socket.emit('add_recurring_expense', { chatId: APP.currentChatId, description, amount, currency, paidBy, participants, dayOfMonth });
        closeModal('modalAddRecurringExpense');
        openRecurringExpensesModal();
    }
    function deleteRecurringExpense(id) {
        if (!APP.currentChatId) return;
        socket.emit('delete_recurring_expense', { chatId: APP.currentChatId, id });
    }

    // Leitura opcional de um recibo por foto: extrai um valor plausível para
    // pré-preencher o campo "Valor" (nunca envia nada sozinho — a pessoa
    // continua a poder editar/corrigir antes de guardar a despesa). Carrega o
    // Tesseract.js só quando esta funcionalidade é mesmo usada (é uma
    // biblioteca pesada, não vale a pena no carregamento normal da app).
    let TESSERACT_LOAD_PROMISE = null;
    function loadTesseractScript() {
        if (window.Tesseract) return Promise.resolve();
        if (TESSERACT_LOAD_PROMISE) return TESSERACT_LOAD_PROMISE;
        TESSERACT_LOAD_PROMISE = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
            script.onload = () => resolve();
            script.onerror = () => { TESSERACT_LOAD_PROMISE = null; reject(new Error('Não foi possível carregar o leitor de recibos.')); };
            document.head.appendChild(script);
        });
        return TESSERACT_LOAD_PROMISE;
    }
    // Normaliza um número como "12,50" / "12.50" / "1.234,56" / "1,234.56" para
    // um float — o separador decimal é sempre o ÚLTIMO símbolo (vírgula/ponto)
    // do token, já que a regex só apanha números com exatamente 2 casas finais.
    function normalizeAmountToken(raw) {
        const decimalIndex = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('.'));
        const intPart = raw.slice(0, decimalIndex).replace(/[.,]/g, '');
        const decPart = raw.slice(decimalIndex + 1);
        const value = parseFloat(intPart + '.' + decPart);
        return isFinite(value) ? value : null;
    }
    // Prefere o maior valor numa linha com uma palavra-chave de "total"; sem
    // isso, o maior valor encontrado em todo o texto (o total costuma ser o
    // maior número de um recibo, maior do que qualquer item individual).
    function extractReceiptAmount(text) {
        const amountRe = /(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})(?!\d)/g;
        const totalKeywords = /total|montante|valor a pagar|amount due|grand total/i;
        let totalCandidates = [], allCandidates = [];
        (text || '').split(/\r?\n/).forEach((line) => {
            [...line.matchAll(amountRe)].forEach((m) => {
                const value = normalizeAmountToken(m[1]);
                if (value == null) return;
                allCandidates.push(value);
                if (totalKeywords.test(line)) totalCandidates.push(value);
            });
        });
        if (totalCandidates.length) return Math.max(...totalCandidates);
        if (allCandidates.length) return Math.max(...allCandidates);
        return null;
    }
    async function handleExpenseReceiptSelected(input) {
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        const statusEl = document.getElementById('expenseReceiptStatus');
        statusEl.style.color = 'var(--text-secondary)';
        statusEl.textContent = 'A carregar o leitor de recibos...';
        try {
            await loadTesseractScript();
            statusEl.textContent = 'A ler o recibo (pode demorar alguns segundos)...';
            const { data: { text } } = await Tesseract.recognize(file, 'eng');
            const amount = extractReceiptAmount(text);
            if (amount != null) {
                document.getElementById('expenseAmount').value = amount.toFixed(2);
                statusEl.style.color = 'var(--green)';
                statusEl.textContent = `✅ Valor detetado: ${amount.toFixed(2)} — confirma antes de guardar.`;
            } else {
                statusEl.style.color = 'var(--red)';
                statusEl.textContent = '⚠️ Não consegui identificar o valor no recibo — preenche manualmente.';
            }
        } catch (err) {
            statusEl.style.color = 'var(--red)';
            statusEl.textContent = '⚠️ Não foi possível ler o recibo agora — preenche manualmente.';
        }
    }

    // ==================== JOGOS (numa conversa 1-para-1) ====================
    // Quem é X e quem é O é fixo em qualquer jogo: X é sempre quem começou,
    // O é sempre a outra pessoa da conversa (numa DM só há duas pessoas, não
    // é preciso perguntar "queres jogar?" antes — o jogo já aparece pronto).
    function openGameChooserModal() {
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat || (chat.type !== 'user' && chat.type !== 'group')) return;
        // Galo e Damas continuam a ser sempre 2 jogadores fixos (X = quem começou,
        // O = o adversário escolhido) — num grupo, escolhe-se o adversário com um
        // seletor (ver openOpponentPickerModal), tal como já acontecia no UNO.
        document.getElementById('modalGameChooser').classList.add('active');
    }
    function nameForPhone(phone) {
        if (phone === APP.user.phone) return 'Você';
        return APP.chats.find(c => c.phone === phone)?.name || 'Alguém';
    }
    function openOpponentPickerModal(gameType) {
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat) return;
        closeModal('modalGameChooser');
        OPPONENT_PICKER.gameType = gameType;
        const contacts = APP.chats.filter(c => c.type === 'user');
        const pickerTitles = { checkers: '♟️ Escolher adversário (Damas)', tictactoe: '🎯 Escolher adversário (Jogo do Galo)', chess: '♞ Escolher adversário (Xadrez)', hangman: '🔤 Escolher com quem jogar (Forca)' };
        document.getElementById('opponentPickerTitle').textContent = pickerTitles[gameType] || 'Escolher adversário';
        const list = document.getElementById('opponentPickerList');
        list.innerHTML = contacts.length ? contacts.map(c => `
            <div class="chat-item" style="cursor:pointer;" onclick="confirmStartGameWithOpponent('${c.phone}')">
                <div class="chat-item-avatar avatar-user">${escapeHtml((c.name || '?')[0].toUpperCase())}</div>
                <div class="chat-item-info"><h4>${escapeHtml(c.name)}</h4></div>
            </div>`).join('') : '<p style="color:#8696a0;text-align:center;">Nenhum contacto disponível para desafiar.</p>';
        document.getElementById('modalOpponentPicker').classList.add('active');
    }
    const OPPONENT_PICKER = { gameType: null };
    function confirmStartGameWithOpponent(opponentPhone) {
        closeModal('modalOpponentPicker');
        if (OPPONENT_PICKER.gameType === 'checkers') {
            startNewGameMessage({ type: 'checkers', board: initCheckersBoard(), players: [APP.user.phone, opponentPhone], turn: 'X', winner: null });
        } else if (OPPONENT_PICKER.gameType === 'tictactoe') {
            startNewGameMessage({ type: 'tictactoe', board: Array(9).fill(null), players: [APP.user.phone, opponentPhone], turn: 'X', winner: null });
        } else if (OPPONENT_PICKER.gameType === 'chess') {
            startNewGameMessage({ type: 'chess', board: initChessBoard(), players: [APP.user.phone, opponentPhone], turn: 'X', winner: null });
        } else if (OPPONENT_PICKER.gameType === 'hangman') {
            socket.emit('start_hangman', { chatId: APP.currentChatId, players: [APP.user.phone, opponentPhone] });
        }
    }
    function startNewGameMessage(game) {
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        const msgId = 'm' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        if (!APP.messages[APP.currentChatId]) APP.messages[APP.currentChatId] = [];
        APP.messages[APP.currentChatId].push({ id: msgId, sender: 'Você', text: '', time, type: 'sent', game, read: false });
        renderMessages();
        renderChatList();
        closeModal('modalGameChooser');
        socket.emit('send_message', { id: msgId, chatId: APP.currentChatId, sender: APP.user.name, senderPhone: APP.user.phone, toPhone: chat.phone, text: '', time, game });
    }
    function startTicTacToe() {
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat || (chat.type !== 'user' && chat.type !== 'group')) return;
        if (chat.type === 'group') { openOpponentPickerModal('tictactoe'); return; }
        startNewGameMessage({ type: 'tictactoe', board: Array(9).fill(null), players: [APP.user.phone, chat.phone], turn: 'X', winner: null });
    }
    function startHangman() {
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat || (chat.type !== 'user' && chat.type !== 'group')) return;
        closeModal('modalGameChooser');
        if (chat.type === 'group') { openOpponentPickerModal('hangman'); return; }
        socket.emit('start_hangman', { chatId: APP.currentChatId, players: [APP.user.phone, chat.phone] });
    }
    function renderGame(msg) {
        const game = msg.game;
        const myMark = game.players[0] === APP.user.phone ? 'X' : (game.players[1] === APP.user.phone ? 'O' : null);
        const turnName = nameForPhone(game.turn === 'X' ? game.players[0] : game.players[1]);
        let statusLine;
        if (game.winner === 'draw') statusLine = '🤝 Empate!';
        else if (game.winner) {
            const winnerName = nameForPhone(game.winner === 'X' ? game.players[0] : game.players[1]);
            statusLine = (game.winner === myMark ? '🎉 Ganhaste!' : `😅 ${escapeHtml(winnerName)} ganhou!`);
        }
        else if (myMark === null) statusLine = `Vez de ${escapeHtml(turnName)} (só a ver)`;
        else statusLine = (game.turn === myMark ? 'A tua vez' : `Vez de ${escapeHtml(turnName)}`) + ` (és ${myMark})`;
        const cellsHtml = game.board.map((cell, i) => {
            const clickable = !game.winner && cell === null && game.turn === myMark;
            return `<div data-cell="${i}" onclick="${clickable ? `moveGame('${msg.id}', ${i})` : ''}" style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;background:rgba(255,255,255,0.08);border-radius:6px;cursor:${clickable ? 'pointer' : 'default'};">${cell || ''}</div>`;
        }).join('');
        return `<div style="min-width:130px;">
            <div style="font-size:12px;margin-bottom:6px;">${statusLine}</div>
            <div style="display:grid;grid-template-columns:repeat(3,36px);gap:4px;">${cellsHtml}</div>
        </div>`;
    }
    function moveGame(messageId, cell) {
        if (!APP.currentChatId) return;
        socket.emit('move_game', { chatId: APP.currentChatId, messageId, cell });
    }
    socket.on('game_updated', (data) => {
        if (!data?.chatId || !data?.messageId) return;
        const msgs = APP.messages[data.chatId];
        const msg = msgs?.find(m => m.id === data.messageId);
        if (!msg) return;
        msg.game = data.game;
        if (APP.currentChatId === data.chatId) renderMessages();
    });

    // ==================== DAMAS ====================
    // Versão simplificada das regras clássicas: a captura é opcional (não é
    // obrigatório saltar mesmo que possas) e cada turno só permite um
    // movimento, mesmo que uma captura pudesse encadear noutra — em troca de
    // regras mais simples, evita todo o código de "sequências de captura
    // obrigatórias" que tornaria isto bem mais complexo para um jogo dentro
    // de uma mensagem de chat.
    function initCheckersBoard() {
        const board = Array(64).fill(null);
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 8; col++) {
                if ((row + col) % 2 === 1) board[row * 8 + col] = { owner: 0, king: false };
            }
        }
        for (let row = 5; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                if ((row + col) % 2 === 1) board[row * 8 + col] = { owner: 1, king: false };
            }
        }
        return board;
    }
    function startCheckers() {
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat || (chat.type !== 'user' && chat.type !== 'group')) return;
        if (chat.type === 'group') { openOpponentPickerModal('checkers'); return; }
        startNewGameMessage({ type: 'checkers', board: initCheckersBoard(), players: [APP.user.phone, chat.phone], turn: 'X', winner: null });
    }

    // ==================== XADREZ ====================
    // Versão simplificada (ver comentário em server.js, 'move_chess'): sem
    // deteção de xeque/xeque-mate, sem roque, sem "en passant" — o jogo
    // termina quando um rei é mesmo capturado. Mesma convenção de "linha 0 =
    // topo" já usada nas damas, com X (dono 0) nas linhas 0-1 e O (dono 1)
    // nas linhas 6-7.
    function initChessBoard() {
        const board = Array(64).fill(null);
        const backRank = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
        backRank.forEach((type, col) => {
            board[col] = { type, owner: 0 };
            board[8 + col] = { type: 'p', owner: 0 };
            board[48 + col] = { type: 'p', owner: 1 };
            board[56 + col] = { type, owner: 1 };
        });
        return board;
    }
    function startChess() {
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat || (chat.type !== 'user' && chat.type !== 'group')) return;
        if (chat.type === 'group') { openOpponentPickerModal('chess'); return; }
        startNewGameMessage({ type: 'chess', board: initChessBoard(), players: [APP.user.phone, chat.phone], turn: 'X', winner: null });
    }
    const CHESS_UNICODE = {
        0: { p: '♙', r: '♖', n: '♘', b: '♗', q: '♕', k: '♔' },
        1: { p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚' }
    };
    const CHESS_SELECTED = { messageId: null, cell: null };
    function renderChess(msg) {
        const game = msg.game;
        const myMark = game.players[0] === APP.user.phone ? 'X' : (game.players[1] === APP.user.phone ? 'O' : null);
        const myOwner = myMark === 'X' ? 0 : 1;
        const turnName = nameForPhone(game.turn === 'X' ? game.players[0] : game.players[1]);
        let statusLine;
        if (game.winner) {
            const winnerName = nameForPhone(game.winner === 'X' ? game.players[0] : game.players[1]);
            statusLine = (game.winner === myMark ? '🎉 Ganhaste! (capturaste o rei)' : `😅 ${escapeHtml(winnerName)} ganhou!`);
        }
        else if (myMark === null) statusLine = `Vez de ${escapeHtml(turnName)} (só a ver)`;
        else statusLine = (game.turn === myMark ? 'A tua vez' : `Vez de ${escapeHtml(turnName)}`) + ` (és ${myMark === 'X' ? '♙ brancas' : '♟ pretas'})`;
        const selectedCell = CHESS_SELECTED.messageId === msg.id ? CHESS_SELECTED.cell : null;
        const myTurn = !game.winner && game.turn === myMark;
        const cellsHtml = game.board.map((piece, i) => {
            const row = Math.floor(i / 8), col = i % 8;
            const dark = (row + col) % 2 === 1;
            const isSelected = selectedCell === i;
            const isLastMove = game.lastMove && (game.lastMove.from === i || game.lastMove.to === i);
            const content = piece ? (CHESS_UNICODE[piece.owner][piece.type] || '') : '';
            // Qualquer casa é clicável na tua vez (tal como nas damas) — inclui
            // casas com peças INIMIGAS, que são precisamente o destino de uma
            // captura; clickChessCell() já trata bem cada caso (só permite
            // SELECIONAR uma peça própria, mas o DESTINO de um movimento já
            // escolhido pode ser qualquer casa, cabendo ao servidor validar).
            const clickable = myTurn;
            const bg = isSelected ? 'rgba(255,235,59,0.5)' : (isLastMove ? 'rgba(76,175,80,0.45)' : (dark ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.08)'));
            return `<div data-cell="${i}" onclick="${clickable ? `clickChessCell('${msg.id}', ${i})` : ''}" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:18px;background:${bg};cursor:${clickable ? 'pointer' : 'default'};">${content}</div>`;
        }).join('');
        return `<div style="min-width:230px;">
            <div style="font-size:12px;margin-bottom:6px;">${statusLine}</div>
            <div style="display:grid;grid-template-columns:repeat(8,28px);gap:1px;">${cellsHtml}</div>
            <div style="font-size:10px;opacity:0.7;margin-top:4px;">Versão simplificada — sem xeque-mate, roque ou "en passant"; ganha-se ao capturar o rei.</div>
        </div>`;
    }
    function clickChessCell(messageId, cell) {
        if (CHESS_SELECTED.messageId !== messageId) { CHESS_SELECTED.messageId = messageId; CHESS_SELECTED.cell = null; }
        const msg = APP.messages[APP.currentChatId]?.find(m => m.id === messageId);
        if (!msg?.game) return;
        const myMark = msg.game.players[0] === APP.user.phone ? 'X' : 'O';
        const myOwner = myMark === 'X' ? 0 : 1;
        const piece = msg.game.board[cell];
        if (CHESS_SELECTED.cell === null) {
            if (piece && piece.owner === myOwner) { CHESS_SELECTED.cell = cell; renderMessages(); }
        } else if (CHESS_SELECTED.cell === cell) {
            CHESS_SELECTED.cell = null;
            renderMessages();
        } else {
            const from = CHESS_SELECTED.cell;
            CHESS_SELECTED.cell = null;
            socket.emit('move_chess', { chatId: APP.currentChatId, messageId, from, to: cell });
        }
    }

    // ==================== FORCA ====================
    // Cooperativa: as duas pessoas da conversa tentam adivinhar juntas a
    // mesma palavra secreta (escolhida pelo SERVIDOR — nunca chega ao
    // cliente em claro antes do fim do jogo, ver sanitizeHangmanGame em
    // server.js) sugerindo letras à vez de qualquer uma delas.
    const HANGMAN_STAGES = ['🙂', '😕', '😟', '😧', '😨', '😰', '💀']; // 0 a 6 erros
    function renderHangman(msg) {
        const game = msg.game;
        const isPlayer = game.players.includes(APP.user.phone);
        let statusLine;
        if (game.winner === 'won') statusLine = '🎉 Acertaram a palavra!';
        else if (game.winner === 'lost') statusLine = `😵 Não foi desta vez — a palavra era "${escapeHtml(game.revealedWord || '')}".`;
        else statusLine = isPlayer ? 'Sugere uma letra' : 'A ver o jogo';
        const spacedWord = (game.maskedWord || '').split('').join(' ');
        const guessedHtml = (game.guessedLetters || []).length ? `<div style="font-size:11px;opacity:0.75;margin-top:4px;">Já tentaram: ${escapeHtml(game.guessedLetters.join(', '))}</div>` : '';
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const canGuess = isPlayer && !game.winner;
        const keyboardHtml = canGuess ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:8px;max-width:230px;">${alphabet.split('').map((l) => {
            const used = (game.guessedLetters || []).includes(l);
            return `<button ${used ? 'disabled' : `onclick="guessHangmanLetter('${msg.id}','${l}')"`} style="width:22px;height:22px;font-size:11px;padding:0;border-radius:4px;border:none;cursor:${used ? 'default' : 'pointer'};background:${used ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.18)'};color:inherit;opacity:${used ? '0.35' : '1'};">${l}</button>`;
        }).join('')}</div>` : '';
        return `<div style="min-width:230px;">
            <div style="font-size:24px;text-align:center;">${HANGMAN_STAGES[Math.min(game.wrongGuesses, 6)]}</div>
            <div style="font-size:12px;margin:6px 0;">${statusLine}</div>
            <div style="font-size:20px;letter-spacing:4px;font-family:monospace;text-align:center;">${escapeHtml(spacedWord)}</div>
            <div style="font-size:11px;opacity:0.7;text-align:center;margin-top:2px;">${game.wrongGuesses}/${game.maxWrong} erros</div>
            ${guessedHtml}
            ${keyboardHtml}
        </div>`;
    }
    function guessHangmanLetter(messageId, letter) {
        socket.emit('hangman_guess', { chatId: APP.currentChatId, messageId, letter });
    }

    // Estado só local (não sincronizado) de qual peça está selecionada
    // enquanto se escolhe o destino — um jogo de damas precisa de 2 cliques
    // por jogada (escolher a peça, depois o destino), ao contrário do galo.
    const CHECKERS_SELECTED = { messageId: null, cell: null };
    function renderCheckers(msg) {
        const game = msg.game;
        const myMark = game.players[0] === APP.user.phone ? 'X' : (game.players[1] === APP.user.phone ? 'O' : null);
        const myOwner = myMark === 'X' ? 0 : 1;
        const turnName = nameForPhone(game.turn === 'X' ? game.players[0] : game.players[1]);
        let statusLine;
        if (game.winner) {
            const winnerName = nameForPhone(game.winner === 'X' ? game.players[0] : game.players[1]);
            statusLine = (game.winner === myMark ? '🎉 Ganhaste!' : `😅 ${escapeHtml(winnerName)} ganhou!`);
        }
        else if (myMark === null) statusLine = `Vez de ${escapeHtml(turnName)} (só a ver)`;
        else statusLine = (game.turn === myMark ? 'A tua vez' : `Vez de ${escapeHtml(turnName)}`) + ` (és ${myMark === 'X' ? '🔴' : '⚪'})`;
        const selectedCell = CHECKERS_SELECTED.messageId === msg.id ? CHECKERS_SELECTED.cell : null;
        const myTurn = !game.winner && game.turn === myMark;
        const cellsHtml = game.board.map((piece, i) => {
            const row = Math.floor(i / 8), col = i % 8;
            const dark = (row + col) % 2 === 1;
            const isSelected = selectedCell === i;
            // Realça de onde e para onde foi a última jogada, para os dois lados
            // verem facilmente o que o outro acabou de fazer (peças iguais entre
            // si, sem isto era fácil perder o fio à jogada).
            const isLastMove = game.lastMove && (game.lastMove.from === i || game.lastMove.to === i);
            let content = '';
            if (piece) content = piece.owner === 0 ? (piece.king ? '🔴👑' : '🔴') : (piece.king ? '⚪👑' : '⚪');
            const clickable = dark && myTurn;
            const bg = dark ? (isSelected ? 'rgba(255,235,59,0.5)' : (isLastMove ? 'rgba(76,175,80,0.45)' : 'rgba(0,0,0,0.35)')) : 'rgba(255,255,255,0.06)';
            return `<div data-cell="${i}" onclick="${clickable ? `clickCheckersCell('${msg.id}', ${i})` : ''}" style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;background:${bg};cursor:${clickable ? 'pointer' : 'default'};">${content}</div>`;
        }).join('');
        return `<div style="min-width:220px;">
            <div style="font-size:12px;margin-bottom:6px;">${statusLine}</div>
            <div style="display:grid;grid-template-columns:repeat(8,26px);gap:1px;">${cellsHtml}</div>
            <div style="font-size:10px;opacity:0.7;margin-top:4px;">🔴 = quem começou · ⚪ = outra pessoa${game.lastMove ? ' · <span style="color:#4caf50;">verde</span> = última jogada' : ''}</div>
        </div>`;
    }
    function clickCheckersCell(messageId, cell) {
        if (CHECKERS_SELECTED.messageId !== messageId) { CHECKERS_SELECTED.messageId = messageId; CHECKERS_SELECTED.cell = null; }
        const msg = APP.messages[APP.currentChatId]?.find(m => m.id === messageId);
        if (!msg?.game) return;
        const myMark = msg.game.players[0] === APP.user.phone ? 'X' : 'O';
        const myOwner = myMark === 'X' ? 0 : 1;
        const piece = msg.game.board[cell];
        if (CHECKERS_SELECTED.cell === null) {
            if (piece && piece.owner === myOwner) { CHECKERS_SELECTED.cell = cell; renderMessages(); }
        } else if (CHECKERS_SELECTED.cell === cell) {
            CHECKERS_SELECTED.cell = null;
            renderMessages();
        } else {
            const from = CHECKERS_SELECTED.cell;
            CHECKERS_SELECTED.cell = null;
            socket.emit('move_checkers', { chatId: APP.currentChatId, messageId, from, to: cell });
        }
    }

    // ==================== UNO ====================
    // Único jogo desta app que funciona tanto em conversas 1-para-1 como em
    // grupos (com um seletor de participantes), e o único em que o servidor
    // gera o estado inicial (o baralho e a distribuição de cartas), já que a
    // mão de cada jogador tem de ficar escondida da outra pessoa — ao
    // contrário do galo/damas, onde o tabuleiro é sempre público aos dois.
    let UNO_PENDING_WILD = null;
    function startUno() {
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (!chat || (chat.type !== 'user' && chat.type !== 'group')) return;
        closeModal('modalGameChooser');
        if (chat.type === 'user') {
            socket.emit('start_uno', { chatId: APP.currentChatId, players: [APP.user.phone, chat.phone] });
        } else {
            openUnoGroupPickerModal();
        }
    }
    function openUnoGroupPickerModal() {
        const contacts = APP.chats.filter(c => c.type === 'user');
        const picker = document.getElementById('unoGroupMemberPicker');
        picker.innerHTML = contacts.length ? contacts.map(c => `
            <label style="display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;">
                <input type="checkbox" value="${c.phone}">
                <span>${escapeHtml(c.name)}</span>
            </label>`).join('') : '<p style="color:#8696a0;text-align:center;">Nenhum contacto disponível</p>';
        document.getElementById('modalUnoGroupPicker').classList.add('active');
    }
    function confirmStartUnoGroup() {
        const selected = [...document.querySelectorAll('#unoGroupMemberPicker input:checked')].map(i => i.value);
        if (selected.length < 1) return alert('Escolhe pelo menos mais 1 jogador!');
        if (selected.length > 5) return alert('Máximo 6 jogadores no total!');
        closeModal('modalUnoGroupPicker');
        socket.emit('start_uno', { chatId: APP.currentChatId, players: [APP.user.phone, ...selected] });
    }
    const UNO_COLOR_HEX = { red: '#e53935', yellow: '#fdd835', green: '#43a047', blue: '#1e88e5', wild: '#3a3a3a' };
    function unoCardText(card) {
        if (card.value === 'skip') return '🚫';
        if (card.value === 'reverse') return '🔄';
        if (card.value === 'draw2') return '+2';
        if (card.value === 'wild') return '🌈';
        if (card.value === 'wild4') return '+4';
        return card.value;
    }
    function renderUnoCard(card, onclick) {
        const bg = UNO_COLOR_HEX[card.color] || '#555';
        const textColor = card.color === 'yellow' ? '#000' : '#fff';
        return `<div ${onclick ? `onclick="${onclick}"` : ''} style="width:32px;height:46px;border-radius:6px;background:${bg};color:${textColor};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;border:2px solid rgba(255,255,255,0.25);cursor:${onclick ? 'pointer' : 'default'};flex:0 0 auto;">${unoCardText(card)}</div>`;
    }
    function unoCardPlayableClient(card, topCard, currentColor) {
        if (card.color === 'wild') return true;
        return card.color === currentColor || card.value === topCard.value;
    }
    function unoNameFor(phone) {
        if (phone === APP.user.phone) return 'Tu';
        return APP.chats.find(c => c.phone === phone)?.name || phone.slice(-4);
    }
    function renderUno(msg) {
        const game = msg.game;
        const isPlayer = game.players.includes(APP.user.phone);
        const myTurn = isPlayer && !game.winner && game.players[game.turnIndex] === APP.user.phone;
        let statusLine;
        if (game.winner) statusLine = (game.winner === APP.user.phone ? '🎉 Ganhaste!' : `😅 ${escapeHtml(unoNameFor(game.winner))} ganhou!`);
        else statusLine = (isPlayer ? (myTurn ? 'A tua vez' : `Vez de ${escapeHtml(unoNameFor(game.players[game.turnIndex]))}`) : `Vez de ${escapeHtml(unoNameFor(game.players[game.turnIndex]))} (só a ver)`);
        const others = game.players.filter(p => p !== APP.user.phone).map(p => `${escapeHtml(unoNameFor(p))}: ${game.handCounts[p]}🎴`).join(' · ');
        const colorDot = { red: '🔴', yellow: '🟡', green: '🟢', blue: '🔵' }[game.currentColor] || '';
        const handHtml = (isPlayer && game.myHand) ? `<div style="display:flex;gap:4px;overflow-x:auto;margin-top:8px;padding-bottom:4px;">${game.myHand.map((card, i) => {
            const playable = myTurn && unoCardPlayableClient(card, game.discardTop, game.currentColor);
            return renderUnoCard(card, playable ? `playUnoCard('${msg.id}', ${i})` : '');
        }).join('')}</div>` : '';
        const drawBtn = myTurn ? `<button class="btn-small" onclick="drawUnoCard('${msg.id}')" style="margin-top:6px;font-size:11px;padding:6px 10px;">🎴 Comprar carta</button>` : '';
        return `<div style="min-width:210px;">
            <div style="font-size:12px;margin-bottom:6px;">${statusLine}</div>
            <div style="font-size:11px;opacity:0.75;margin-bottom:6px;">${others}</div>
            <div style="display:flex;align-items:center;gap:8px;">${renderUnoCard(game.discardTop)}<span style="font-size:16px;">${colorDot}</span><span style="font-size:10px;opacity:0.7;">monte: ${game.drawCount}🎴</span></div>
            ${handHtml}
            ${drawBtn}
            <div style="font-size:10px;opacity:0.6;margin-top:4px;">${escapeHtml(game.lastAction || '')}</div>
        </div>`;
    }
    function playUnoCard(messageId, cardIndex) {
        const msg = APP.messages[APP.currentChatId]?.find(m => m.id === messageId);
        const card = msg?.game?.myHand?.[cardIndex];
        if (!card) return;
        if (card.color === 'wild') {
            UNO_PENDING_WILD = { messageId, cardIndex };
            document.getElementById('modalUnoColor').classList.add('active');
            return;
        }
        socket.emit('play_uno_card', { chatId: APP.currentChatId, messageId, cardIndex });
    }
    function chooseUnoColor(color) {
        closeModal('modalUnoColor');
        if (!UNO_PENDING_WILD) return;
        socket.emit('play_uno_card', { chatId: APP.currentChatId, messageId: UNO_PENDING_WILD.messageId, cardIndex: UNO_PENDING_WILD.cardIndex, chosenColor: color });
        UNO_PENDING_WILD = null;
    }
    function drawUnoCard(messageId) {
        socket.emit('draw_uno_card', { chatId: APP.currentChatId, messageId });
    }
    socket.on('uno_updated', (data) => {
        if (!data?.chatId || !data?.messageId) return;
        const msg = APP.messages[data.chatId]?.find(m => m.id === data.messageId);
        if (!msg) return;
        const myHand = msg.game?.myHand;
        msg.game = { ...data.game, myHand };
        if (APP.currentChatId === data.chatId) renderMessages();
    });
    socket.on('uno_hand_update', (data) => {
        if (!data?.chatId || !data?.messageId) return;
        const msg = APP.messages[data.chatId]?.find(m => m.id === data.messageId);
        if (!msg) return;
        if (!msg.game) return;
        msg.game.myHand = data.hand;
        if (APP.currentChatId === data.chatId) renderMessages();
    });

    function openNewCallModal() {
        updateCallContactList();
        document.getElementById('modalNewCall').classList.add('active');
    }

    function updateCallContactList() {
        const container = document.getElementById('callContactList');
        container.innerHTML = APP.chats.filter(c => c.type !== 'ai').map(chat => `
            <div class="chat-item" style="cursor:pointer;" onclick="startCallWith('${chat.id}','video');closeModal('modalNewCall');">
                <div class="chat-item-avatar ${chat.type==='group'?'avatar-group':'avatar-user'}">${chat.avatar||escapeHtml(chat.name.charAt(0))}</div>
                <div class="chat-item-info">
                    <h4>${escapeHtml(chat.name)}</h4>
                    <p>${chat.type==='group'? 'Grupo · '+chat.memberCount+' membros':'Contato'}</p>
                </div>
            </div>`).join('') || '<p style="color:#8696a0;text-align:center;">Nenhum contato disponível</p>';
    }

    function startCallWith(chatId, type) {
        if (APP.currentChatId !== chatId) openChat(chatId);
        setTimeout(() => startCall(type), 300);
    }

    function unlockCallMedia() {
        const mainVideo = document.getElementById('mainVideo');
        mainVideo.muted = false;
        mainVideo.play().catch(err => console.warn('Ainda bloqueado:', err.message));
        document.getElementById('callUnlockOverlay').style.display = 'none';
        // Aproveita este toque (gesto real do usuário) para também "acordar" o
        // Web Audio API no iOS, necessário para o vídeo/música compartilhados.
        if (APP._musicMix?.ctx?.state === 'suspended') APP._musicMix.ctx.resume().catch(() => {});
        if (APP.videoShare.audioCtx?.state === 'suspended') APP.videoShare.audioCtx.resume().catch(() => {});
    }

    async function createPeerConnection() {
        const iceServers = await getIceServers();
        peerConnection = new RTCPeerConnection(iceServers);
        peerConnection.onicecandidate = (e) => {
            if (e.candidate) {
                socket.emit('ice_candidate', { targetRoomId: APP.currentChatId, targetPhone: callPeerPhone, candidate: e.candidate });
            }
        };
        peerConnection.ontrack = (e) => {
            if (callRingTimeout) { clearTimeout(callRingTimeout); callRingTimeout = null; }
            APP._callWasConnected = true;
            const mainVideo = document.getElementById('mainVideo');
            mainVideo.srcObject = e.streams[0];
            mainVideo.style.display = 'block';
            mainVideo.muted = false; // reforça — já foi desligado no início, mas confirma outra vez com o stream real anexado
            document.getElementById('callStatus').textContent = 'Conectado ✅';
            startCallTimer();
            startCallQualityMonitor();
            // No iPhone/Safari, o navegador bloqueia por padrão o autoplay de
            // áudio/vídeo com som quando não é resultado direto de um toque do
            // usuário (o que é o caso aqui, pois isto ocorre depois da negociação
            // WebRTC, não no clique do botão). Sem isto, a chamada conecta mas
            // fica muda e com o vídeo preto — parecendo que "não funciona".
            const playPromise = mainVideo.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {
                    document.getElementById('callUnlockOverlay').style.display = 'flex';
                });
            }
            // Segunda verificação de segurança: alguns navegadores resolvem a
            // promessa de play() com sucesso mas mantêm o som a 0 por bloqueios
            // internos que não geram erro nenhum — confirma passado 1s e, se
            // continuar mudo ou em pausa, mostra a mesma dica para tocar no ecrã.
            setTimeout(() => {
                if (APP.callActive && (mainVideo.paused || mainVideo.muted)) {
                    document.getElementById('callUnlockOverlay').style.display = 'flex';
                }
            }, 1000);
            watchForFrozenRemoteVideo();
        };
        // Deteta quando a ligação "conecta" na sinalização mas depois cai (ex: TURN
        // sobrecarregado) — sem isto, o ecrã ficava preso em "Conectado" para sempre
        // mesmo sem áudio/vídeo a fluir de verdade. Tenta recuperar sozinho primeiro.
        peerConnection.oniceconnectionstatechange = () => {
            if (!peerConnection) return;
            const state = peerConnection.iceConnectionState;
            const statusEl = document.getElementById('callStatus');
            if (state === 'disconnected') {
                if (statusEl) statusEl.textContent = '⚠️ Ligação instável — a tentar recuperar...';
                // "disconnected" dizia "a tentar recuperar..." mas nunca tentava nada
                // de verdade — ficava preso nesse texto para sempre em quedas de rede
                // que o navegador demora muito (ou nunca chega) a classificar como
                // "failed". Dá alguns segundos para recuperar sozinho (é comum e
                // normal, ex.: mudança breve de rede) antes de forçar uma renegociação.
                if (disconnectRecoveryTimer1to1) clearTimeout(disconnectRecoveryTimer1to1);
                const pcAtSchedule = peerConnection;
                disconnectRecoveryTimer1to1 = setTimeout(() => {
                    if (peerConnection === pcAtSchedule && peerConnection.iceConnectionState === 'disconnected') {
                        attemptIceRestart1to1();
                    }
                }, 5000);
            } else if (state === 'failed') {
                if (disconnectRecoveryTimer1to1) { clearTimeout(disconnectRecoveryTimer1to1); disconnectRecoveryTimer1to1 = null; }
                if (statusEl) statusEl.textContent = '🔄 A tentar reconectar...';
                attemptIceRestart1to1();
            } else if (state === 'connected') {
                if (disconnectRecoveryTimer1to1) { clearTimeout(disconnectRecoveryTimer1to1); disconnectRecoveryTimer1to1 = null; }
                if (statusEl && statusEl.textContent !== 'Conectado ✅') statusEl.textContent = 'Conectado ✅';
            }
        };
        return peerConnection;
    }

    // "pc.restartIce()" sozinho NÃO faz nada de útil: só marca internamente que
    // uma nova oferta precisa de ICE novo e dispara um evento "negotiationneeded"
    // — sem ninguém a ouvir esse evento e a mandar essa nova oferta pela
    // sinalização (Socket.IO), o restart nunca chega a acontecer de verdade. Isto
    // explicava chamadas presas em "Conectado"/"A tentar reconectar..." para
    // sempre depois de um problema breve de rede, sem nunca recuperar de facto —
    // e explicava melhor ainda porque é sempre o mesmo lado (quem LIGA) a ficar
    // sem imagem: só o lado que criou a oferta original tenta renegociar aqui,
    // para evitar os dois lados criarem uma nova oferta ao mesmo tempo (glare).
    let iceRestartInFlight1to1 = false;
    let iceRestartAttempts1to1 = 0;
    let disconnectRecoveryTimer1to1 = null;
    async function attemptIceRestart1to1() {
        if (!peerConnection || iceRestartInFlight1to1 || APP.callDirection !== 'outgoing') return;
        if (iceRestartAttempts1to1 >= 3) {
            document.getElementById('callStatus').textContent = '❌ Não foi possível recuperar a ligação';
            return;
        }
        iceRestartInFlight1to1 = true;
        iceRestartAttempts1to1++;
        try {
            const offer = await peerConnection.createOffer({ iceRestart: true });
            await peerConnection.setLocalDescription(offer);
            socket.emit('renegotiate_offer', { targetRoomId: APP.currentChatId, targetPhone: callPeerPhone, offer: peerConnection.localDescription });
        } catch (err) {
            console.warn('Falha ao tentar reiniciar a ligação:', err.message);
        } finally {
            iceRestartInFlight1to1 = false;
        }
    }
    socket.on('renegotiate_offer_received', async (data) => {
        if (!peerConnection) return;
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            flushPendingIce(peerConnection);
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('renegotiate_answer', { targetRoomId: APP.currentChatId, targetPhone: callPeerPhone, answer: peerConnection.localDescription });
        } catch (err) { console.warn('Falha ao responder à renegociação da chamada:', err.message); }
    });
    socket.on('renegotiate_answer_received', async (data) => {
        if (!peerConnection) return;
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            flushPendingIce(peerConnection);
            iceRestartAttempts1to1 = 0; // recuperou — a próxima falha volta a ter direito às 3 tentativas
        } catch (err) { console.warn('Resposta de renegociação ignorada:', err.message); }
    });

    // Segunda rede de segurança: mesmo quando o ICE "diz" que está tudo bem
    // (nunca passa por 'disconnected'/'failed'), o vídeo remoto pode ficar
    // preso a zero frames — o sintoma real de "não consigo ver a outra
    // pessoa" mesmo com a chamada "Conectada". Confirma outra vez alguns
    // segundos depois de conectar e, se continuar sem imagem nenhuma, tenta
    // a mesma renegociação (força um pedido de keyframe novo, na prática).
    function watchForFrozenRemoteVideo() {
        setTimeout(() => {
            if (!APP.callActive || !peerConnection || APP.callType !== 'video') return;
            const mainVideo = document.getElementById('mainVideo');
            const track = mainVideo.srcObject?.getVideoTracks?.()[0];
            if (track && track.readyState === 'live' && mainVideo.videoWidth === 0) {
                attemptIceRestart1to1();
            }
        }, 6000);
    }

    // "Permission denied" (NotAllowedError) é sempre uma permissão bloqueada no
    // próprio navegador/aparelho — o site não tem forma de contornar isso por
    // código, só de explicar exatamente onde ir desbloquear. NotFoundError e
    // NotReadableError são situações diferentes (sem câmara, ou já ocupada por
    // outra app) que mereciam outra explicação, não a mesma dica de permissões.
    function describeMediaError(err) {
        const ua = navigator.userAgent || '';
        const isIphone = /iPhone|iPad|iPod/.test(ua);
        const isAndroid = /Android/.test(ua);
        if (err.name === 'NotAllowedError' || /Permission denied/i.test(err.message || '')) {
            if (isIphone) return '\n\nNo iPhone: Ajustes → Safari → Câmara/Microfone → Permitir, e confirma que o site é aberto com https://.';
            if (isAndroid) return '\n\nNo Chrome do Android: toca no 🔒 (ou "i") ao lado do endereço → Permissões → Câmara e Microfone → Permitir, e recarrega a página. Se continuar bloqueado, confirma também em Definições do telemóvel → Apps → Chrome → Permissões, que a Câmara e o Microfone estão ativados para o Chrome.';
            return '\n\nVerifica as permissões de câmara/microfone deste site nas definições do navegador.';
        }
        if (err.name === 'NotFoundError') return '\n\nNão foi encontrada nenhuma câmara/microfone neste aparelho.';
        if (err.name === 'NotReadableError') return '\n\nA câmara/microfone já está a ser usada por outra aplicação ou separador — fecha-a e tenta de novo.';
        return '';
    }
    function startCall(type) {
        if (!APP.currentChatId) return alert('Abra uma conversa primeiro!');
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (chat?.type === 'ai') return alert('Não é possível ligar para a IA. Use o chat de texto!');
        if (chat?.type === 'group') return joinGroupCall(type); // grupos usam a chamada em malha (ver mais abaixo)
        APP.callType = type;
        APP.callActive = true;
        APP.callDirection = 'outgoing';
        APP._callWasConnected = false;
        pendingIceCandidates = [];
        iceRestartAttempts1to1 = 0;
        callPeerPhone = chat?.phone || null;
        document.getElementById('callTitle').textContent = chat?.name || 'Chamada';
        document.getElementById('callStatus').textContent = type === 'video' ? 'Chamando...' : 'Chamada de voz...';
        document.getElementById('callScreen').classList.add('active');
        document.getElementById('groupCallGrid').style.display = 'none';
        const mainVideo = document.getElementById('mainVideo');
        const pipVideo = document.getElementById('pipVideo');
        mainVideo.style.display = 'block';
        mainVideo.srcObject = null;
        // Desliga o mudo já aqui, mesmo antes de existir stream — isto associa o
        // elemento de vídeo ao toque genuíno do utilizador o mais cedo possível.
        // Sem isto, quem RECEBE a chamada (ao tocar em "Aceitar") tinha muito mais
        // hipótese de o navegador bloquear o som por engano do que quem liga —
        // era a causa mais provável do "som só funciona quando é X que liga".
        mainVideo.muted = false;
        mainVideo.play().catch(() => {}); // tentativa silenciosa — sem stream ainda, é normal falhar
        if (APP.sharedStream) { APP.sharedStream.getTracks().forEach(t => t.stop()); APP.sharedStream = null; }
        const constraints = { audio: true, video: type === 'video' ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } : false };
        navigator.mediaDevices.getUserMedia(constraints).then(async stream => {
            APP.callStream = stream;
            pipVideo.srcObject = stream;
            document.getElementById('callPip').style.display = type === 'video' ? 'block' : 'none';
            document.getElementById('callFilterBtn').style.display = type === 'video' ? 'flex' : 'none';
            const pc = await createPeerConnection();
            stream.getTracks().forEach(track => pc.addTrack(track, stream));
            pc.createOffer().then(offer => pc.setLocalDescription(offer)).then(() => {
                socket.emit('call_user', {
                    targetRoomId: APP.currentChatId,
                    targetPhone: callPeerPhone,
                    callerPhone: APP.user.phone,
                    callerName: APP.user.name,
                    callType: type,
                    offer: pc.localDescription
                });
                if (callRingTimeout) clearTimeout(callRingTimeout);
                callRingTimeout = setTimeout(() => {
                    if (APP.callActive && document.getElementById('callStatus').textContent !== 'Conectado ✅') {
                        document.getElementById('callStatus').textContent = 'Sem resposta';
                        socket.emit('end_call', { targetRoomId: APP.currentChatId, targetPhone: callPeerPhone });
                        setTimeout(() => endCall(true), 1200);
                    }
                }, 35000);
            });
        }).catch(err => {
            alert('Erro ao acessar câmera/microfone: ' + err.message + describeMediaError(err));
            document.getElementById('callStatus').textContent = 'Falha na conexão';
            APP.callActive = false;
        });
    }

    // Chamada 1-para-1 recebida: mostra um ecrã real com Aceitar/Recusar em vez de
    // usar confirm() — assim, o pedido de câmara/microfone parte diretamente de um
    // toque genuíno do usuário no botão "Aceitar", o que evita bloqueios de
    // permissão em navegadores mais rígidos (Safari/iPhone).
    socket.on('incoming_call', (data) => {
        incomingCallData = data;
        document.getElementById('incomingCallerName').textContent = data.callerName;
        document.getElementById('incomingCallType').textContent = data.callType === 'video' ? '📹 Videochamada a chegar...' : '📞 Chamada de voz a chegar...';
        document.getElementById('modalIncomingCall').classList.add('active');
        startRingtone();
    });

    // Som de toque de chamada a chegar — igual para voz e vídeo (mas o tom
    // varia por conta, ver ringFrequencyForUser), sintetizado com a Web Audio
    // API (dois "beeps" a repetir, como um toque clássico de telefone) em vez
    // de um ficheiro de áudio, para não depender de nenhum recurso externo.
    // Continua a tocar até a pessoa aceitar, recusar, ou quem ligou desistir
    // — e pode ser silenciado sem recusar a chamada.
    //
    // O AudioContext é criado UMA VEZ e reaproveitado (nunca fechado) — criar
    // um novo a cada chamada tinha um problema real: um AudioContext novo
    // nasce sempre "suspended" nos navegadores mais restritos (sobretudo em
    // telemóvel), e só um toque genuíno do utilizador o desbloqueia. Um
    // contexto criado ao ligar não tinha esse toque por perto e ficava mudo;
    // reaproveitar o mesmo contexto, desbloqueado assim que a pessoa mexe
    // pela primeira vez na app (ver unlockRingtoneAudio), resolve isso.
    let ringtoneCtx = null;
    let ringtoneTimer = null;
    let ringtoneMuted = false;
    function getRingtoneCtx() {
        if (!ringtoneCtx) {
            try { ringtoneCtx = new (window.AudioContext || window.webkitAudioContext)(); }
            catch (e) { console.warn('Web Audio API não disponível:', e.message); return null; }
        }
        return ringtoneCtx;
    }
    function unlockRingtoneAudio() {
        const ctx = getRingtoneCtx();
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    }
    ['click', 'touchstart', 'keydown'].forEach(evt => document.addEventListener(evt, unlockRingtoneAudio, { once: true, passive: true }));

    // Cada conta tem um tom ligeiramente diferente (derivado do próprio
    // telefone de quem RECEBE a chamada), assim dá para reconhecer de ouvido
    // em que aparelho se está sem olhar para o ecrã, mesmo sem escolher nada.
    function ringFrequencyForUser() {
        const phone = APP.user?.phone || '';
        let hash = 0;
        for (let i = 0; i < phone.length; i++) hash = (hash * 31 + phone.charCodeAt(i)) >>> 0;
        const tones = [780, 880, 950, 1040, 1120];
        return tones[hash % tones.length];
    }
    function playRingtoneBeeps(ctx, startTime, freq) {
        [0, 0.35].forEach(offset => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0, startTime + offset);
            gain.gain.linearRampToValueAtTime(0.25, startTime + offset + 0.02);
            gain.gain.setValueAtTime(0.25, startTime + offset + 0.28);
            gain.gain.linearRampToValueAtTime(0, startTime + offset + 0.32);
            osc.connect(gain).connect(ctx.destination);
            osc.start(startTime + offset);
            osc.stop(startTime + offset + 0.35);
        });
    }
    function startRingtone() {
        stopRingtone();
        ringtoneMuted = false;
        updateRingtoneMuteBtn();
        const ctx = getRingtoneCtx();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const freq = ringFrequencyForUser();
        const ring = () => { if (!ringtoneMuted) playRingtoneBeeps(ctx, ctx.currentTime, freq); };
        ring();
        ringtoneTimer = setInterval(ring, 2000);
    }
    function stopRingtone() {
        if (ringtoneTimer) { clearInterval(ringtoneTimer); ringtoneTimer = null; }
    }
    function toggleRingtoneMute() {
        ringtoneMuted = !ringtoneMuted;
        updateRingtoneMuteBtn();
    }
    function updateRingtoneMuteBtn() {
        const btn = document.getElementById('ringtoneMuteBtn');
        if (btn) btn.textContent = ringtoneMuted ? '🔇 Toque silenciado' : '🔊 Silenciar toque';
    }

    // Esta conta tem outro dispositivo ligado (até 2 em simultâneo) e a chamada
    // já foi atendida ou recusada lá — para de tocar aqui também, e não deixa
    // esta tela tentar responder à mesma chamada (o que criaria uma segunda
    // resposta inválida do lado de quem ligou, e este aparelho ficava preso
    // para sempre em "Conectando...", nunca chegando a ligar de verdade).
    socket.on('call_taken_elsewhere', () => {
        if (incomingCallData) {
            stopRingtone();
            document.getElementById('modalIncomingCall').classList.remove('active');
            incomingCallData = null;
        }
    });

    // A pessoa para quem ligaste está offline / sem nenhum dispositivo ligado
    // neste momento — antes disto a chamada ficava "Chamando..." para sempre.
    socket.on('call_unavailable', () => {
        if (callRingTimeout) { clearTimeout(callRingTimeout); callRingTimeout = null; }
        if (APP.callActive) {
            document.getElementById('callStatus').textContent = 'Utilizador indisponível';
            logCallEvent('missed');
            setTimeout(() => endCall(true), 1200);
        }
    });

    function declineIncomingCall() {
        stopRingtone();
        if (incomingCallData) {
            socket.emit('end_call', { targetRoomId: incomingCallData.targetRoomId, targetPhone: incomingCallData.callerPhone });
            socket.emit('call_log_entry', { peerPhone: incomingCallData.callerPhone, peerName: incomingCallData.callerName, type: incomingCallData.callType, direction: 'incoming', status: 'declined', durationSec: 0 });
        }
        document.getElementById('modalIncomingCall').classList.remove('active');
        incomingCallData = null;
    }

    async function acceptIncomingCall() {
        stopRingtone();
        const data = incomingCallData;
        document.getElementById('modalIncomingCall').classList.remove('active');
        if (!data) return;
        incomingCallData = null;
        APP.currentChatId = data.targetRoomId;
        APP.callType = data.callType;
        APP.callActive = true;
        APP.callDirection = 'incoming';
        APP._callWasConnected = false;
        pendingIceCandidates = [];
        callPeerPhone = data.callerPhone || null;
        document.getElementById('callTitle').textContent = data.callerName;
        document.getElementById('callStatus').textContent = 'Conectando...';
        document.getElementById('callScreen').classList.add('active');
        document.getElementById('groupCallGrid').style.display = 'none';
        const mainVideo = document.getElementById('mainVideo');
        mainVideo.style.display = 'block';
        // Mesma lógica do lado de quem liga: desliga o mudo e tenta reproduzir já
        // aqui, ainda dentro do toque em "Aceitar" — antes de qualquer "await" —
        // para o navegador associar isto ao gesto genuíno do utilizador o mais
        // cedo possível (quem atende é normalmente quem mais sofre bloqueios de
        // som automáticos, por a ligação demorar mais awaits a estabelecer-se).
        mainVideo.muted = false;
        mainVideo.play().catch(() => {});
        const constraints = { audio: true, video: data.callType === 'video' ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } : false };
        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            APP.callStream = stream;
            document.getElementById('pipVideo').srcObject = stream;
            document.getElementById('callPip').style.display = data.callType === 'video' ? 'block' : 'none';
            document.getElementById('callFilterBtn').style.display = data.callType === 'video' ? 'flex' : 'none';
            const pc = await createPeerConnection();
            stream.getTracks().forEach(track => pc.addTrack(track, stream));
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            flushPendingIce(pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('answer_call', { targetRoomId: data.targetRoomId, targetPhone: data.callerPhone, answer: pc.localDescription });
        } catch (err) {
            alert('Erro ao aceder à câmara/microfone: ' + err.message + describeMediaError(err));
            endCall();
        }
    }

    function flushPendingIce(pc) {
        pendingIceCandidates.forEach(c => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
        pendingIceCandidates = [];
    }

    socket.on('call_answered', async (data) => {
        if (callRingTimeout) { clearTimeout(callRingTimeout); callRingTimeout = null; }
        // 'call_taken_elsewhere' já evita isto no caso normal (a pessoa tem 2
        // aparelhos e um deles respondeu depois do outro), mas o estado da
        // ligação só aceita UMA resposta — uma segunda (ex.: por mensagens
        // fora de ordem na rede) rejeitava com uma exceção não tratada.
        if (peerConnection && peerConnection.signalingState !== 'stable') {
            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
                flushPendingIce(peerConnection);
            } catch (err) {
                console.warn('Resposta de chamada ignorada (ligação já estava noutro estado):', err.message);
            }
        }
    });

    // Candidatos ICE que chegassem antes de existir peerConnection (ou antes da
    // "remote description" estar definida) eram simplesmente perdidos — essa era
    // a causa mais provável de a chamada ligar de um lado só (muito comum em
    // redes móveis/4G, incluindo iPhone), por isso agora ficam em fila.
    socket.on('ice_candidate_received', async (data) => {
        if (!data.candidate) return;
        if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
            try { await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) { console.warn(e); }
        } else {
            pendingIceCandidates.push(data.candidate);
        }
    });

    socket.on('call_ended', () => {
        if (incomingCallData) {
            socket.emit('call_log_entry', { peerPhone: incomingCallData.callerPhone, peerName: incomingCallData.callerName, type: incomingCallData.callType, direction: 'incoming', status: 'missed', durationSec: 0 });
            document.getElementById('modalIncomingCall').classList.remove('active');
            incomingCallData = null;
        }
        endCall(true); // encerrado pelo outro lado — não reenviar 'end_call' de volta
    });

    // ==================== CHAMADAS EM GRUPO (malha: cada participante liga a todos os outros) ====================
    // Funciona bem até ~6-8 participantes com câmara ligada (cada pessoa envia/recebe
    // vídeo de todas as outras diretamente, sem servidor central de vídeo). Com mais
    // gente que isso, o ideal a prazo é um servidor SFU — fica fora do alcance gratuito.
    const GROUP_CALL = { active: false, peers: {}, pendingIce: {}, names: {}, isOfferer: {}, disconnectTimers: {}, isHost: false, raisedHands: {} };

    function startAudioRoom() {
        if (!APP.currentChatId) return alert('Abra um grupo primeiro!');
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (chat?.type !== 'group') return alert('Salas de áudio ao vivo estão disponíveis apenas para grupos!');
        APP.audioRoomMode = true;
        joinGroupCall('voice');
    }
    function joinGroupCall(type) {
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        APP.callType = type;
        APP.callActive = true;
        GROUP_CALL.active = true;
        GROUP_CALL.peers = {};
        GROUP_CALL.pendingIce = {};
        GROUP_CALL.names = {};
        GROUP_CALL.isOfferer = {};
        GROUP_CALL.isHost = false;
        GROUP_CALL.raisedHands = {};
        GROUP_CALL.approvedSpeakers = {};
        Object.values(GROUP_CALL.disconnectTimers).forEach(clearTimeout);
        GROUP_CALL.disconnectTimers = {};
        document.getElementById('callTitle').textContent = (APP.audioRoomMode ? '🎙️ Sala de áudio · ' : '🎥 ') + (chat?.name || 'Grupo');
        document.getElementById('callStatus').textContent = 'A entrar na chamada em grupo...';
        document.getElementById('callScreen').classList.add('active');
        document.getElementById('mainVideo').style.display = 'none';
        document.getElementById('callPip').style.display = 'none';
        document.getElementById('audioRoomControls').style.display = APP.audioRoomMode ? 'block' : 'none';
        document.getElementById('audioRoomRaisedHandsList').innerHTML = '';
        document.getElementById('callMuteBtn').style.display = 'flex'; // repõe para chamadas normais / até saber se é anfitrião
        document.getElementById('callFilterBtn').style.display = type === 'video' ? 'flex' : 'none';
        const grid = document.getElementById('groupCallGrid');
        grid.style.display = 'flex';
        grid.innerHTML = '';
        const constraints = { audio: true, video: type === 'video' ? { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: 'user' } : false };
        navigator.mediaDevices.getUserMedia(constraints).then(stream => {
            APP.callStream = stream;
            addGridTile('me', 'Você', stream, true);
            socket.emit('join_call', { roomId: APP.currentChatId, callType: type });
            document.getElementById('callStatus').textContent = 'Conectado ✅';
            startCallTimer();
            startCallQualityMonitor();
        }).catch(err => {
            alert('Erro ao aceder à câmara/microfone: ' + err.message + describeMediaError(err));
            endCall();
        });
    }

    function addGridTile(key, name, stream, muted) {
        let tile = document.getElementById('tile_' + key);
        if (!tile) {
            tile = document.createElement('div');
            tile.className = 'grid-tile';
            tile.id = 'tile_' + key;
            tile.innerHTML = `<video autoplay playsinline webkit-playsinline ${muted ? 'muted' : ''}></video><span class="grid-tile-label">${name}</span>`;
            document.getElementById('groupCallGrid').appendChild(tile);
        }
        const video = tile.querySelector('video');
        video.srcObject = stream;
        const p = video.play();
        if (p !== undefined) p.catch(() => { document.getElementById('callUnlockOverlay').style.display = 'flex'; });
    }

    function removeGridTile(key) {
        const tile = document.getElementById('tile_' + key);
        if (tile) tile.remove();
    }

    // Mesma rede de segurança do 1-para-1: o ICE pode "dizer" que está tudo bem
    // e mesmo assim o vídeo remoto ficar preso a zero frames. Só quem foi
    // ofertante original desta ligação tenta renegociar (evita glare).
    function watchForFrozenGroupTile(remoteSocketId) {
        setTimeout(() => {
            if (!GROUP_CALL.active || !GROUP_CALL.peers[remoteSocketId]) return;
            const tile = document.getElementById('tile_' + remoteSocketId);
            const video = tile?.querySelector('video');
            if (video && video.srcObject?.getVideoTracks?.()[0]?.readyState === 'live' && video.videoWidth === 0 && GROUP_CALL.isOfferer[remoteSocketId]) {
                attemptIceRestartGroup(remoteSocketId);
            }
        }, 6000);
    }

    async function createGroupPeerConnection(remoteSocketId, remoteName) {
        const iceServers = await getIceServers();
        const pc = new RTCPeerConnection(iceServers);
        GROUP_CALL.peers[remoteSocketId] = pc;
        GROUP_CALL.names[remoteSocketId] = remoteName;
        GROUP_CALL.pendingIce[remoteSocketId] = [];
        pc.onicecandidate = (e) => {
            if (e.candidate) socket.emit('call_ice', { roomId: APP.currentChatId, toSocketId: remoteSocketId, candidate: e.candidate });
        };
        pc.ontrack = (e) => {
            addGridTile(remoteSocketId, remoteName, e.streams[0], false);
            watchForFrozenGroupTile(remoteSocketId);
        };
        pc.oniceconnectionstatechange = () => {
            // Igual ao problema já corrigido nas chamadas 1-para-1: "pc.restartIce()"
            // sozinho não faz nada sem um novo offer/answer trocado pela sinalização.
            // Só quem foi o ofertante ORIGINAL desta ligação (ver GROUP_CALL.isOfferer)
            // tenta renegociar, para os dois lados não criarem ofertas ao mesmo tempo.
            const state = pc.iceConnectionState;
            if (state === 'disconnected') {
                // Tal como no 1-para-1: "disconnected" pode ficar preso durante muito
                // tempo (ou nunca virar "failed") sem nunca tentar recuperar de
                // verdade — dá alguns segundos (é normal recuperar sozinho) antes de
                // forçar uma renegociação.
                if (GROUP_CALL.disconnectTimers[remoteSocketId]) clearTimeout(GROUP_CALL.disconnectTimers[remoteSocketId]);
                GROUP_CALL.disconnectTimers[remoteSocketId] = setTimeout(() => {
                    const currentPc = GROUP_CALL.peers[remoteSocketId];
                    if (currentPc === pc && currentPc.iceConnectionState === 'disconnected' && GROUP_CALL.isOfferer[remoteSocketId]) {
                        attemptIceRestartGroup(remoteSocketId);
                    }
                }, 5000);
            } else if (state === 'failed') {
                if (GROUP_CALL.disconnectTimers[remoteSocketId]) { clearTimeout(GROUP_CALL.disconnectTimers[remoteSocketId]); delete GROUP_CALL.disconnectTimers[remoteSocketId]; }
                if (GROUP_CALL.isOfferer[remoteSocketId]) attemptIceRestartGroup(remoteSocketId);
            } else if (state === 'connected') {
                if (GROUP_CALL.disconnectTimers[remoteSocketId]) { clearTimeout(GROUP_CALL.disconnectTimers[remoteSocketId]); delete GROUP_CALL.disconnectTimers[remoteSocketId]; }
            }
        };
        if (APP.callStream) APP.callStream.getTracks().forEach(track => pc.addTrack(track, APP.callStream));
        // Se entrar alguém a meio de uma partilha de vídeo/música já em curso,
        // troca já as faixas dele pelo conteúdo partilhado em vez da câmara/
        // microfone normais — sem isto, quem entrava depois via sempre a
        // câmara de quem partilha, nunca o vídeo/música partilhados.
        if (APP.videoShare.active && APP.videoShare.stream) {
            // Reaproveita a MESMA stream já capturada quando a partilha começou
            // (ver playSharedVideo/getSharedVideoStream) em vez de tentar
            // capturar de novo — no Safari a captura é feita via canvas, e criar
            // um segundo loop de desenho por cada pessoa que entra a meio seria
            // desperdício (e a stream original já serve perfeitamente a todos).
            const videoTrack = APP.videoShare.stream.getVideoTracks()[0];
            if (videoTrack) { const s = pc.getSenders().find(s => s.track && s.track.kind === 'video'); if (s) s.replaceTrack(videoTrack); }
        }
        if (APP.musicShare.active && APP._musicMix?.dest) {
            const mixedTrack = APP._musicMix.dest.stream.getAudioTracks()[0];
            if (mixedTrack) { const s = pc.getSenders().find(s => s.track && s.track.kind === 'audio'); if (s) s.replaceTrack(mixedTrack); }
        }
        // Se entrar alguém a meio de um filtro de vídeo já ativo, já lhe chega
        // filtrado desde o primeiro frame (mesma ideia da partilha de vídeo acima).
        if (LIVE_FILTER.id !== 'none' && LIVE_FILTER.filteredTrack) {
            const s = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (s) s.replaceTrack(LIVE_FILTER.filteredTrack);
        }
        return pc;
    }

    // Quem entra numa chamada já em curso recebe a lista de quem já está lá, e é ele
    // quem inicia a ligação (oferta) com cada um deles.
    socket.on('existing_call_participants', (data) => {
        if (APP.audioRoomMode) {
            // Quem chega a uma sala vazia é o anfitrião (fala já, sem pedir); quem
            // entra numa sala já em curso começa "ouvinte" (silenciado) — só fala
            // depois de o anfitrião aprovar um pedido (ver raiseHandToSpeak).
            GROUP_CALL.isHost = (data.participants || []).length === 0;
            if (!GROUP_CALL.isHost && APP.callStream) {
                APP.callStream.getAudioTracks().forEach((t) => { t.enabled = false; });
                APP.isMuted = true;
            }
            updateAudioRoomButtonsVisibility();
        }
        (data.participants || []).forEach(async (p) => {
            const pc = await createGroupPeerConnection(p.socketId, p.name);
            GROUP_CALL.isOfferer[p.socketId] = true;
            pc.createOffer().then(offer => pc.setLocalDescription(offer)).then(() => {
                socket.emit('call_offer', { roomId: APP.currentChatId, toSocketId: p.socketId, offer: pc.localDescription });
            });
        });
    });

    // ==================== SALA DE ÁUDIO AO VIVO — "levantar a mão" ====================
    function updateAudioRoomButtonsVisibility() {
        if (!APP.audioRoomMode) return;
        const amMuted = !!APP.isMuted;
        document.getElementById('audioRoomRaiseHandBtn').style.display = (!GROUP_CALL.isHost && amMuted) ? 'inline-block' : 'none';
        document.getElementById('audioRoomSelfMuteBtn').style.display = (!GROUP_CALL.isHost && !amMuted) ? 'inline-block' : 'none';
        // Quem é só "ouvinte" (ainda não aprovado) não usa o botão de silenciar
        // normal — falar/não falar passa a depender só do pedido aprovado pelo
        // anfitrião, senão a moderação da sala era só decorativa.
        document.getElementById('callMuteBtn').style.display = GROUP_CALL.isHost ? 'flex' : 'none';
    }
    function raiseHandToSpeak() {
        socket.emit('audio_room_raise_hand', { roomId: APP.currentChatId });
        const btn = document.getElementById('audioRoomRaiseHandBtn');
        btn.disabled = true;
        btn.textContent = '🖐️ Pedido enviado...';
    }
    function selfMuteAgain() {
        if (APP.callStream) APP.callStream.getAudioTracks().forEach((t) => { t.enabled = false; });
        APP.isMuted = true;
        updateAudioRoomButtonsVisibility();
        const btn = document.getElementById('audioRoomRaiseHandBtn');
        btn.disabled = false;
        btn.textContent = '🖐️ Pedir para falar';
    }
    function renderRaisedHandsList() {
        const box = document.getElementById('audioRoomRaisedHandsList');
        const pending = Object.entries(GROUP_CALL.raisedHands).map(([socketId, name]) => `
            <div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg-secondary);padding:6px 10px;border-radius:8px;">
                <span>🖐️ ${escapeHtml(name)}</span>
                <div style="display:flex;gap:6px;">
                    <button class="btn-small btn-accept" onclick="grantSpeak('${socketId}')" style="padding:3px 8px;">✅ Aprovar</button>
                    <button class="btn-small btn-danger" onclick="denyHand('${socketId}')" style="padding:3px 8px;">❌</button>
                </div>
            </div>`);
        const speaking = Object.entries(GROUP_CALL.approvedSpeakers || {}).map(([socketId, name]) => `
            <div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg-secondary);padding:6px 10px;border-radius:8px;">
                <span>🎙️ ${escapeHtml(name)}</span>
                <button class="btn-small btn-danger" onclick="revokeSpeak('${socketId}')" style="padding:3px 8px;">🔇 Silenciar</button>
            </div>`);
        box.innerHTML = [...pending, ...speaking].join('');
    }
    socket.on('audio_room_hand_raised', (data) => {
        if (!GROUP_CALL.isHost || data.roomId !== APP.currentChatId) return;
        GROUP_CALL.raisedHands[data.socketId] = data.name;
        renderRaisedHandsList();
    });
    function grantSpeak(targetSocketId) {
        if (!GROUP_CALL.approvedSpeakers) GROUP_CALL.approvedSpeakers = {};
        GROUP_CALL.approvedSpeakers[targetSocketId] = GROUP_CALL.raisedHands[targetSocketId] || GROUP_CALL.names[targetSocketId] || 'Alguém';
        delete GROUP_CALL.raisedHands[targetSocketId];
        socket.emit('audio_room_grant_speak', { roomId: APP.currentChatId, targetSocketId });
        renderRaisedHandsList();
    }
    function denyHand(targetSocketId) {
        delete GROUP_CALL.raisedHands[targetSocketId];
        renderRaisedHandsList();
    }
    function revokeSpeak(targetSocketId) {
        socket.emit('audio_room_revoke_speak', { roomId: APP.currentChatId, targetSocketId });
        if (GROUP_CALL.approvedSpeakers) delete GROUP_CALL.approvedSpeakers[targetSocketId];
        renderRaisedHandsList();
    }
    socket.on('audio_room_speak_granted', () => {
        if (APP.callStream) APP.callStream.getAudioTracks().forEach((t) => { t.enabled = true; });
        APP.isMuted = false;
        updateAudioRoomButtonsVisibility();
    });
    socket.on('audio_room_speak_revoked', () => { selfMuteAgain(); });
    // O servidor promove automaticamente o participante mais antigo quando o
    // anfitrião original sai a meio da chamada (ver leaveCall em server.js) —
    // sem isto, quem ficasse "ouvinte" nunca mais teria a quem pedir para falar.
    socket.on('audio_room_you_are_host', (data) => {
        if (data.roomId !== APP.currentChatId || !APP.audioRoomMode) return;
        GROUP_CALL.isHost = true;
        updateAudioRoomButtonsVisibility();
    });

    // Tal como em attemptIceRestart1to1: "pc.restartIce()" não faz nada por si
    // só, é preciso criar e enviar mesmo um novo offer com iceRestart. Reaproveita
    // o mesmo evento "call_offer" já existente — do outro lado, "call_offer_received"
    // já trata bem receber um offer novo para uma ligação que já existe.
    const iceRestartInFlightGroup = {};
    async function attemptIceRestartGroup(remoteSocketId) {
        const pc = GROUP_CALL.peers[remoteSocketId];
        if (!pc || iceRestartInFlightGroup[remoteSocketId]) return;
        iceRestartInFlightGroup[remoteSocketId] = true;
        try {
            const offer = await pc.createOffer({ iceRestart: true });
            await pc.setLocalDescription(offer);
            socket.emit('call_offer', { roomId: APP.currentChatId, toSocketId: remoteSocketId, offer: pc.localDescription });
        } catch (err) {
            console.warn('Falha ao tentar reiniciar a ligação de grupo:', err.message);
        } finally {
            iceRestartInFlightGroup[remoteSocketId] = false;
        }
    }

    socket.on('peer_joined_call', (data) => {
        GROUP_CALL.names[data.socketId] = data.name; // guarda o nome já, caso a oferta chegue depois
    });

    // Alguém que já está na chamada, mas ainda não está no grupo, vê este aviso e pode entrar
    socket.on('group_call_started', (data) => {
        if (data.roomId !== APP.currentChatId || GROUP_CALL.active) return;
        if (confirm(`🎥 ${data.starterName} iniciou uma chamada em grupo. Entrar?`)) joinGroupCall(data.callType);
    });

    socket.on('call_offer_received', async (data) => {
        if (!GROUP_CALL.active) return;
        let pc = GROUP_CALL.peers[data.fromSocketId];
        if (!pc) {
            pc = await createGroupPeerConnection(data.fromSocketId, data.fromName);
            GROUP_CALL.isOfferer[data.fromSocketId] = false;
        }
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        (GROUP_CALL.pendingIce[data.fromSocketId] || []).forEach(c => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
        GROUP_CALL.pendingIce[data.fromSocketId] = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('call_answer', { roomId: APP.currentChatId, toSocketId: data.fromSocketId, answer: pc.localDescription });
    });

    socket.on('call_answer_received', async (data) => {
        const pc = GROUP_CALL.peers[data.fromSocketId];
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        (GROUP_CALL.pendingIce[data.fromSocketId] || []).forEach(c => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
        GROUP_CALL.pendingIce[data.fromSocketId] = [];
    });

    socket.on('call_ice_received', async (data) => {
        const pc = GROUP_CALL.peers[data.fromSocketId];
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
            try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) { console.warn(e); }
        } else {
            if (!GROUP_CALL.pendingIce[data.fromSocketId]) GROUP_CALL.pendingIce[data.fromSocketId] = [];
            GROUP_CALL.pendingIce[data.fromSocketId].push(data.candidate);
        }
    });

    socket.on('peer_left_call', (data) => {
        const pc = GROUP_CALL.peers[data.socketId];
        if (pc) { pc.close(); delete GROUP_CALL.peers[data.socketId]; }
        delete GROUP_CALL.pendingIce[data.socketId];
        if (GROUP_CALL.disconnectTimers[data.socketId]) { clearTimeout(GROUP_CALL.disconnectTimers[data.socketId]); delete GROUP_CALL.disconnectTimers[data.socketId]; }
        removeGridTile(data.socketId);
    });

    function leaveGroupCall() {
        if (!GROUP_CALL.active) return;
        Object.values(GROUP_CALL.peers).forEach(pc => pc.close());
        GROUP_CALL.peers = {};
        GROUP_CALL.pendingIce = {};
        GROUP_CALL.names = {};
        Object.values(GROUP_CALL.disconnectTimers).forEach(clearTimeout);
        GROUP_CALL.disconnectTimers = {};
        GROUP_CALL.active = false;
        socket.emit('leave_call', { roomId: APP.currentChatId });
        document.getElementById('groupCallGrid').innerHTML = '';
        document.getElementById('groupCallGrid').style.display = 'none';
    }

    function startConference() {
        if (!APP.currentChatId) return alert('Abra um grupo primeiro!');
        const chat = APP.chats.find(c => c.id === APP.currentChatId);
        if (chat?.type !== 'group') return alert('Conferências estão disponíveis apenas para grupos!');
        startCall('video');
    }

    function toggleMute() {
        if (APP.callStream) {
            APP.isMuted = !APP.isMuted;
            APP.callStream.getAudioTracks().forEach(track => track.enabled = !APP.isMuted);
        }
    }

    function toggleSpeaker() { APP.isSpeakerOn = !APP.isSpeakerOn; }

    function toggleCamera() {
        if (APP.callStream) {
            APP.isCameraOn = !APP.isCameraOn;
            APP.callStream.getVideoTracks().forEach(track => track.enabled = APP.isCameraOn);
        }
    }

    // ==================== TIRAR SELF NA CHAMADA ====================
    const SELFIE_FILTERS = [
        { name: 'Normal', id: 'none', css: 'none' },
        { name: 'P&B', id: 'bw', css: 'grayscale(1) contrast(1.1)' },
        { name: 'Sépia', id: 'sepia', css: 'sepia(0.8) contrast(1.05)' },
        { name: 'Vívido', id: 'vivid', css: 'saturate(1.6) contrast(1.1)' },
        { name: 'Frio', id: 'cool', css: 'saturate(1.1) hue-rotate(15deg) brightness(1.05) contrast(1.05)' },
        { name: 'Quente', id: 'warm', css: 'saturate(1.2) hue-rotate(-10deg) brightness(1.05)' },
        { name: 'Suave', id: 'soft', css: 'brightness(1.08) contrast(0.9) saturate(1.05) blur(0.5px)' },
        { name: 'Vintage', id: 'vintage', css: 'sepia(0.35) contrast(1.1) saturate(1.3) brightness(0.95)' },
        { name: 'Negativo', id: 'invert', css: 'invert(1)' }
    ];
    const SELFIE_FRAMES = [
        { name: 'Quadrado', id: 'square', ratio: 1 },
        { name: 'Retrato', id: 'portrait', ratio: 3 / 4 },
        { name: 'Paisagem', id: 'landscape', ratio: 16 / 9 },
        { name: 'Original', id: 'auto', ratio: null }
    ];
    // Fundos decorativos do self — não recortam a pessoa (isso precisaria de
    // um modelo de IA a correr no telemóvel), é só uma "moldura" atrás do
    // vídeo inteiro, que passa a aparecer completo (sem recortar as pontas)
    // quando um fundo está escolhido.
    const SELFIE_BACKGROUNDS = [
        { name: 'Nenhum', id: 'none' },
        { name: 'Branco', id: 'white', color: '#ffffff' },
        { name: 'Preto', id: 'black', color: '#000000' },
        { name: 'Roxo', id: 'purple', gradient: ['#6c5ce7', '#a29bfe'] },
        { name: 'Azul', id: 'blue', gradient: ['#4285F4', '#9b72cb'] },
        { name: 'Pôr do sol', id: 'sunset', gradient: ['#f093fb', '#f5576c'] }
    ];
    const SELFIE = { active: false, raf: null, filter: 'none', frame: 'auto', background: 'none', captured: null };

    function openSelfieCam() {
        if (!APP.callStream || !APP.callStream.getVideoTracks().length) return alert('A câmara da chamada ainda não está pronta.');
        SELFIE.active = true;
        SELFIE.filter = 'none';
        SELFIE.frame = 'auto';
        SELFIE.background = 'none';
        SELFIE.captured = null;
        document.getElementById('selfieCamOverlay').classList.add('active');
        document.getElementById('selfieCanvas').style.display = 'block';
        document.getElementById('selfieResultImg').style.display = 'none';
        document.getElementById('selfieShutterBtn').style.display = 'block';
        document.getElementById('selfieResultActions').style.display = 'none';
        renderSelfieFilters();
        renderSelfieFrames();
        renderSelfieBackgrounds();
        startSelfiePreview();
    }

    function closeSelfieCam() {
        SELFIE.active = false;
        if (SELFIE.raf) cancelAnimationFrame(SELFIE.raf);
        document.getElementById('selfieCamOverlay').classList.remove('active');
    }

    function startSelfiePreview() {
        const canvas = document.getElementById('selfieCanvas');
        const ctx = canvas.getContext('2d');
        // Nas chamadas 1-para-1 o teu próprio vídeo está no #pipVideo; nas
        // chamadas em grupo (grelha em malha) está no tile "tile_me" — sem
        // esta distinção, o self ficava sempre a tentar ler o #pipVideo
        // vazio durante uma chamada em grupo e não mostrava nada.
        const video = GROUP_CALL.active ? document.querySelector('#tile_me video') : document.getElementById('pipVideo');
        if (!video) { if (SELFIE.active) SELFIE.raf = requestAnimationFrame(startSelfiePreview); return; }
        function draw() {
            if (!SELFIE.active || SELFIE.captured) return;
            const vw = video.videoWidth, vh = video.videoHeight;
            if (vw && vh) {
                const filterCss = SELFIE_FILTERS.find(f => f.id === SELFIE.filter)?.css || 'none';
                const frameDef = SELFIE_FRAMES.find(f => f.id === SELFIE.frame) || SELFIE_FRAMES[3];
                const ratio = frameDef.ratio || (vw / vh);
                canvas.width = 640;
                canvas.height = Math.round(640 / ratio);
                const bg = SELFIE_BACKGROUNDS.find(b => b.id === SELFIE.background) || SELFIE_BACKGROUNDS[0];
                let sw, sh, sx, sy, dw, dh, dx, dy;
                if (bg.id === 'none') {
                    // Sem fundo: o vídeo preenche o quadro todo (recorta as pontas), como sempre foi.
                    sw = vw; sh = vh; sx = 0; sy = 0;
                    if (vw / vh > ratio) { sw = vh * ratio; sx = (vw - sw) / 2; }
                    else { sh = vw / ratio; sy = (vh - sh) / 2; }
                    dx = 0; dy = 0; dw = canvas.width; dh = canvas.height;
                } else {
                    // Com fundo: mostra o vídeo inteiro (sem recortar), centrado, e o
                    // fundo escolhido preenche o espaço à volta que sobra — não é um
                    // recorte real da pessoa, é só uma "moldura" atrás do vídeo inteiro.
                    sw = vw; sh = vh; sx = 0; sy = 0;
                    const scale = Math.min(canvas.width / vw, canvas.height / vh);
                    dw = vw * scale; dh = vh * scale;
                    dx = (canvas.width - dw) / 2; dy = (canvas.height - dh) / 2;
                }
                ctx.save();
                if (bg.id !== 'none') {
                    if (bg.gradient) {
                        const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
                        bg.gradient.forEach((color, i) => g.addColorStop(i / (bg.gradient.length - 1), color));
                        ctx.fillStyle = g;
                    } else {
                        ctx.fillStyle = bg.color;
                    }
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
                ctx.filter = filterCss;
                ctx.translate(canvas.width, 0);
                ctx.scale(-1, 1); // espelha, como numa câmera frontal normal
                ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh); // dx é centrado, por isso fica igual espelhado ou não
                ctx.restore();
            }
            SELFIE.raf = requestAnimationFrame(draw);
        }
        draw();
    }

    function setSelfieFilter(id) { SELFIE.filter = id; renderSelfieFilters(); }
    function setSelfieFrame(id) { SELFIE.frame = id; renderSelfieFrames(); }
    function setSelfieBackground(id) { SELFIE.background = id; renderSelfieBackgrounds(); }

    function renderSelfieFilters() {
        document.getElementById('selfieFilterRow').innerHTML = SELFIE_FILTERS.map(f =>
            `<button class="selfie-chip ${f.id === SELFIE.filter ? 'active' : ''}" onclick="setSelfieFilter('${f.id}')">${f.name}</button>`
        ).join('');
    }
    function renderSelfieFrames() {
        document.getElementById('selfieFrameRow').innerHTML = SELFIE_FRAMES.map(f =>
            `<button class="selfie-chip ${f.id === SELFIE.frame ? 'active' : ''}" onclick="setSelfieFrame('${f.id}')">${f.name}</button>`
        ).join('');
    }
    function renderSelfieBackgrounds() {
        document.getElementById('selfieBackgroundRow').innerHTML = SELFIE_BACKGROUNDS.map(b =>
            `<button class="selfie-chip ${b.id === SELFIE.background ? 'active' : ''}" onclick="setSelfieBackground('${b.id}')">${b.name}</button>`
        ).join('');
    }

    function captureSelfie() {
        const canvas = document.getElementById('selfieCanvas');
        if (!canvas.width) return;
        SELFIE.captured = canvas.toDataURL('image/jpeg', 0.9);
        if (SELFIE.raf) cancelAnimationFrame(SELFIE.raf);
        const img = document.getElementById('selfieResultImg');
        img.src = SELFIE.captured;
        img.style.display = 'block';
        canvas.style.display = 'none';
        document.getElementById('selfieShutterBtn').style.display = 'none';
        document.getElementById('selfieResultActions').style.display = 'flex';
    }

    function retakeSelfie() {
        SELFIE.captured = null;
        document.getElementById('selfieResultImg').style.display = 'none';
        document.getElementById('selfieCanvas').style.display = 'block';
        document.getElementById('selfieShutterBtn').style.display = 'block';
        document.getElementById('selfieResultActions').style.display = 'none';
        startSelfiePreview();
    }

    function sendSelfie() {
        if (!SELFIE.captured) return;
        if (!APP.currentChatId) { alert('Não foi possível identificar a conversa da chamada.'); return; }
        sendAttachmentMessage(SELFIE.captured, 'self.jpg', 'image/jpeg');
        closeSelfieCam();
    }

    function downloadSelfie() {
        if (!SELFIE.captured) return;
        const a = document.createElement('a');
        a.href = SELFIE.captured;
        a.download = 'self-' + Date.now() + '.jpg';
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    function startCallTimer() {
        if (APP.callTimerInterval) return; // já rodando, evita duplicar
        APP.callStartTime = Date.now();
        const timerEl = document.getElementById('callTimer');
        timerEl.style.display = 'block';
        timerEl.textContent = '00:00';
        APP.callTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - APP.callStartTime) / 1000);
            const h = Math.floor(elapsed / 3600);
            const m = Math.floor((elapsed % 3600) / 60);
            const s = elapsed % 60;
            const pad = (n) => String(n).padStart(2, '0');
            timerEl.textContent = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
        }, 1000);
    }

    function stopCallTimer() {
        clearInterval(APP.callTimerInterval);
        APP.callTimerInterval = null;
        APP.callStartTime = null;
        const timerEl = document.getElementById('callTimer');
        timerEl.style.display = 'none';
        timerEl.textContent = '00:00';
    }

    // ==================== INDICADOR DE QUALIDADE DO SINAL ====================
    // Lê as estatísticas reais da ligação WebRTC (getStats) a cada poucos
    // segundos — perda de pacotes e round-trip-time — e mostra um resumo
    // simples (🟢/🟡/🔴), tanto em chamadas 1-para-1 como de grupo (usa a
    // pior ligação de todas, para avisar do participante com pior sinal).
    let callQualityInterval = null;
    async function sampleConnectionQuality(pc) {
        if (!pc) return null;
        try {
            const stats = await pc.getStats();
            let rttMs = null, lost = 0, received = 0;
            stats.forEach((report) => {
                if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime != null) {
                    rttMs = report.currentRoundTripTime * 1000;
                }
                if (report.type === 'inbound-rtp' && !report.isRemote) {
                    lost += report.packetsLost || 0;
                    received += report.packetsReceived || 0;
                }
            });
            const lossRatio = received > 0 ? lost / (lost + received) : 0;
            return { rttMs, lossRatio, received };
        } catch (e) { return null; }
    }
    function classifyQuality(samples) {
        const valid = samples.filter(Boolean);
        if (!valid.length) return null;
        // "received === 0 em todas as ligações" não é "0% de perda" (sinal bom) —
        // é o oposto: NADA está a chegar. Sem esta distinção, uma chamada com
        // relay TURN a falhar silenciosamente (ICE diz "connected" mas nenhum
        // pacote real chega) mostrava "🟢 Sinal bom" enquanto a chamada estava
        // completamente muda/preta dos dois lados — o indicador dizia o oposto
        // do que se passava. Ver watchForSilentMedia1to1, que usa o mesmo sinal
        // para tentar recuperar a ligação a sério.
        if (valid.every((s) => s.received === 0 && s.lossRatio === 0)) return { icon: '⚠️', label: 'Sem sinal' };
        const worst = valid.reduce((a, b) => {
            const scoreA = (a.rttMs || 0) + a.lossRatio * 1000;
            const scoreB = (b.rttMs || 0) + b.lossRatio * 1000;
            return scoreB > scoreA ? b : a;
        });
        if (worst.lossRatio > 0.08 || (worst.rttMs && worst.rttMs > 400)) return { icon: '🔴', label: 'Sinal fraco' };
        if (worst.lossRatio > 0.02 || (worst.rttMs && worst.rttMs > 200)) return { icon: '🟡', label: 'Sinal instável' };
        return { icon: '🟢', label: 'Sinal bom' };
    }
    // Quantas amostras seguidas (a cada 4s) já não receberam NENHUM pacote no
    // 1-para-1 — passa a ser motivo de recuperação ativa depois de confirmado
    // por 2 amostras seguidas (~8s), para não disparar por causa dos primeiros
    // instantes normais a seguir a "Conectado" (ainda sem estatísticas).
    let silentStreak1to1 = 0;
    function startCallQualityMonitor() {
        if (callQualityInterval) return;
        silentStreak1to1 = 0;
        const el = document.getElementById('callQuality');
        el.style.display = 'block';
        callQualityInterval = setInterval(async () => {
            const pcs = [];
            if (peerConnection) pcs.push(peerConnection);
            if (GROUP_CALL.active) pcs.push(...Object.values(GROUP_CALL.peers));
            if (!pcs.length) return;
            const samples = await Promise.all(pcs.map(sampleConnectionQuality));
            const result = classifyQuality(samples);
            if (result) el.textContent = `${result.icon} ${result.label}`;
            // Recuperação ativa só faz sentido para 1-para-1 (grupo tem uma
            // ligação por participante — não dá para saber qual delas está muda
            // só por este resumo agregado).
            if (!peerConnection || GROUP_CALL.active) { silentStreak1to1 = 0; return; }
            const my1to1Sample = samples[0];
            if (my1to1Sample && my1to1Sample.received === 0 && my1to1Sample.lossRatio === 0) {
                silentStreak1to1++;
            } else {
                silentStreak1to1 = 0;
            }
            if (silentStreak1to1 === 2) {
                // Confirmado: "Conectado" mas nenhum pacote real chegou em ~8s —
                // o relay TURN provavelmente falhou depois da negociação inicial
                // (o caso mais comum: serviço TURN público gratuito sobrecarregado).
                // Só quem LIGOU tenta recuperar (mesma regra anti-glare do resto
                // do ficheiro) — quem recebeu só vê o aviso, à espera dessa tentativa.
                // Volta a 0 para poder detetar e tentar de novo se esta tentativa
                // não resolver (attemptIceRestart1to1 já limita a 3 no total).
                silentStreak1to1 = 0;
                const statusEl = document.getElementById('callStatus');
                if (statusEl) statusEl.textContent = '🔇 Sem áudio/vídeo — a tentar recuperar...';
                if (APP.callDirection === 'outgoing') attemptIceRestart1to1();
            }
        }, 4000);
    }
    function stopCallQualityMonitor() {
        clearInterval(callQualityInterval);
        callQualityInterval = null;
        const el = document.getElementById('callQuality');
        el.style.display = 'none';
        el.textContent = '📶 A avaliar sinal...';
    }

    // remoteInitiated=true quando chega via socket 'call_ended' (o outro lado encerrou) —
    // nesse caso NÃO reenviamos 'end_call', senão os dois lados ficam ecoando o evento um
    // para o outro para sempre e a sala fica "presa", impedindo novas chamadas depois.
    function endCall(remoteInitiated) {
        // Para sempre o toque primeiro, mesmo que a chamada nunca tenha chegado a
        // ficar "ativa" — uma chamada só a tocar (ainda não aceite) não marca
        // APP.callActive, e sem isto, se quem ligou desistisse antes de a pessoa
        // atender, o modal fechava mas o toque ficava a repetir para sempre.
        stopRingtone();
        if (!APP.callActive) return; // já foi encerrada — ignora chamadas duplicadas do evento
        APP.callActive = false;
        if (callRingTimeout) { clearTimeout(callRingTimeout); callRingTimeout = null; }
        // Só emite 'end_call' em chamadas 1-para-1 — em chamada de GRUPO isto
        // desligava toda a gente quando só uma pessoa saía (leaveGroupCall trata
        // disso à parte, logo abaixo).
        if (!remoteInitiated && !GROUP_CALL.active && APP.currentChatId) {
            socket.emit('end_call', { targetRoomId: APP.currentChatId, targetPhone: callPeerPhone });
        }
        if (!GROUP_CALL.active && APP.callDirection) {
            logCallEvent(APP._callWasConnected ? 'answered' : 'missed');
        }
        APP._callWasConnected = false;
        callPeerPhone = null;
        if (disconnectRecoveryTimer1to1) { clearTimeout(disconnectRecoveryTimer1to1); disconnectRecoveryTimer1to1 = null; }
        if (peerConnection) { peerConnection.close(); peerConnection = null; }
        pendingIceCandidates = [];
        if (GROUP_CALL.active) leaveGroupCall();
        if (CAPTIONS.active) stopLiveCaptions();
        if (APP.sharedStream) { APP.sharedStream.getTracks().forEach(t => t.stop()); APP.sharedStream = null; }
        if (APP.callStream) { APP.callStream.getTracks().forEach(track => track.stop()); APP.callStream = null; }
        stopVideoShare();
        stopMusicShareOnly();
        stopCallTimer();
        stopCallQualityMonitor();
        document.getElementById('callScreen').classList.remove('active');
        document.getElementById('callChatPanel').classList.remove('active');
        document.getElementById('callUnlockOverlay').style.display = 'none';
        document.getElementById('modalIncomingCall').classList.remove('active');
        incomingCallData = null;
        stopRingtone();
        const mainVideo = document.getElementById('mainVideo');
        mainVideo.srcObject = null;
        mainVideo.src = '';
        mainVideo.style.display = 'block';
        document.getElementById('pipVideo').srcObject = null;
        document.getElementById('callPip').style.display = 'none';
        APP.callType = null;
        closeWhiteboard();
        closeSelfieCam();
        APP.audioRoomMode = false;
        GROUP_CALL.isHost = false;
        GROUP_CALL.raisedHands = {};
        GROUP_CALL.approvedSpeakers = {};
        document.getElementById('audioRoomControls').style.display = 'none';
        document.getElementById('audioRoomRaisedHandsList').innerHTML = '';
        stopLiveVideoFilterProcessing();
        document.getElementById('callFilterBtn').style.display = 'none';
        document.getElementById('callLiveFilterRow').style.display = 'none';
    }

    // ==================== CHAT AO LADO DA CHAMADA + EMOJIS ====================
    function toggleCallChat() {
        const panel = document.getElementById('callChatPanel');
        panel.classList.toggle('active');
        if (panel.classList.contains('active')) {
            renderCallChatMessages();
            setTimeout(() => document.getElementById('callMessageInput').focus(), 250);
        } else {
            document.getElementById('emojiPicker').classList.remove('active');
        }
    }

    let emojiTargetInputId = 'messageInput';
    function toggleEmojiPicker(inputId) {
        emojiTargetInputId = inputId || (document.getElementById('callChatPanel').classList.contains('active') ? 'callMessageInput' : 'messageInput');
        const pickerId = emojiTargetInputId === 'callMessageInput' ? 'emojiPicker' : 'emojiPickerMain';
        const picker = document.getElementById(pickerId);
        if (!picker.dataset.built) {
            picker.dataset.built = '1';
            const categories = ['Recentes', ...Object.keys(EMOJI_LIBRARY)];
            picker.innerHTML = `
                <div class="emoji-picker-tabs">${categories.map(cat => `<button data-category="${cat}" onclick="renderEmojiPickerCategory('${pickerId}','${cat}')" title="${cat}">${EMOJI_CATEGORY_ICONS[cat]}</button>`).join('')}</div>
                <div class="emoji-picker-grid" id="${pickerId}Grid"></div>
            `;
            renderEmojiPickerCategory(pickerId, getRecentEmojis().length ? 'Recentes' : 'Sorrisos');
        }
        picker.classList.toggle('active');
    }
    function getRecentEmojis() {
        try { return JSON.parse(localStorage.getItem('recentEmojis') || '[]'); } catch (e) { return []; }
    }
    function addRecentEmoji(emoji) {
        const recent = getRecentEmojis().filter(e => e !== emoji);
        recent.unshift(emoji);
        localStorage.setItem('recentEmojis', JSON.stringify(recent.slice(0, 24)));
    }
    function renderEmojiPickerCategory(pickerId, category) {
        const picker = document.getElementById(pickerId);
        picker.querySelectorAll('.emoji-picker-tabs button').forEach(btn => btn.classList.toggle('active', btn.dataset.category === category));
        const list = category === 'Recentes' ? getRecentEmojis() : EMOJI_LIBRARY[category];
        document.getElementById(pickerId + 'Grid').innerHTML = (list && list.length)
            ? list.map(e => `<span onclick="insertEmoji('${e}')">${e}</span>`).join('')
            : '<p style="width:100%;color:#8696a0;font-size:11px;text-align:center;padding:12px 4px;">Ainda sem emojis recentes.</p>';
    }

    function insertEmoji(emoji) {
        const input = document.getElementById(emojiTargetInputId);
        if (input) { input.value += emoji; input.focus(); }
        addRecentEmoji(emoji);
    }

    function toggleMusicPlayer() {
        document.getElementById('musicPlayer').classList.toggle('active');
    }

    function closeMusicPlayer() {
        stopMusic();
        document.getElementById('musicPlayer').classList.remove('active');
    }

    function loadMusicFromUrl() {
        const url = document.getElementById('musicUrlInput').value.trim();
        if (url) {
            APP.musicAudio.src = url;
            playMusicWithFallback();
            if (APP.musicShare.active) applyMusicShareMix(); // trocou de música com o compartilhamento ligado: remistura
        }
    }

    function loadMusicFile(input) {
        const file = input.files[0];
        if (file) {
            const url = URL.createObjectURL(file);
            APP.musicAudio.src = url;
            playMusicWithFallback();
            if (APP.musicShare.active) applyMusicShareMix();
        }
    }

    function playMusicWithFallback() {
        const fallbackBtn = document.getElementById('musicPlayFallback');
        const playPromise = APP.musicAudio.play();
        if (playPromise !== undefined) {
            playPromise
                .then(() => { if (fallbackBtn) fallbackBtn.style.display = 'none'; })
                .catch((err) => {
                    // Autoplay bloqueado pelo navegador (política padrão de autoplay).
                    // Mostra um botão para o usuário confirmar a reprodução com um toque/clique.
                    console.warn('Autoplay de áudio bloqueado:', err.message);
                    if (fallbackBtn) fallbackBtn.style.display = 'inline-flex';
                });
        }
    }

    function retryPlayMusic() {
        APP.musicAudio.play()
            .then(() => { document.getElementById('musicPlayFallback').style.display = 'none'; })
            .catch((err) => alert('Ainda não foi possível reproduzir: ' + err.message));
    }

    function stopMusic() {
        APP.musicAudio.pause();
        APP.musicAudio.src = '';
        const fallbackBtn = document.getElementById('musicPlayFallback');
        if (fallbackBtn) fallbackBtn.style.display = 'none';
        if (APP.musicShare.active) stopMusicShareOnly();
    }

    // ==================== MÚSICA COMPARTILHADA NA CHAMADA ====================
    // Mesma técnica do vídeo compartilhado: mistura o áudio da música de fundo
    // com o microfone (Web Audio API) e substitui a faixa de áudio enviada na
    // chamada, para que a outra pessoa também ouça a música que já está a tocar.
    // IMPORTANTE: createMediaElementSource só pode ser chamado UMA VEZ por elemento
    // <audio> durante toda a vida da página — por isso mantemos um único AudioContext
    // "vivo" (APP._musicMix) e só ligamos/desligamos o microfone nele a cada toggle,
    // em vez de recriar tudo (o que quebraria ao ligar/desligar mais de uma vez).
    function getMusicMix() {
        if (!APP._musicMix) {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const source = ctx.createMediaElementSource(APP.musicAudio);
            const dest = ctx.createMediaStreamDestination();
            source.connect(dest);
            source.connect(ctx.destination); // quem partilha continua a ouvir localmente
            APP._musicMix = { ctx, source, dest, micSource: null };
        }
        return APP._musicMix;
    }

    // Ajuda a partilhar vídeo/música tanto em chamadas 1-para-1 (uma só
    // 'peerConnection') como em chamadas de grupo (uma RTCPeerConnection por
    // cada outro participante, em GROUP_CALL.peers) — devolve o "sender" de
    // cada ligação ativa, para trocar a faixa transmitida em todas de uma vez.
    function getActiveSenders(kind) {
        const senders = [];
        if (peerConnection) {
            const s = peerConnection.getSenders().find(s => s.track && s.track.kind === kind);
            if (s) senders.push(s);
        }
        if (GROUP_CALL.active) {
            Object.values(GROUP_CALL.peers).forEach(pc => {
                const s = pc.getSenders().find(s => s.track && s.track.kind === kind);
                if (s) senders.push(s);
            });
        }
        return senders;
    }
    function isInAnyCall() { return !!peerConnection || GROUP_CALL.active; }

    // ==================== FILTROS DE VÍDEO AO VIVO ====================
    // Reaproveita a mesma lista de filtros CSS do "tirar self" (SELFIE_FILTERS)
    // — a diferença é que aqui cada frame do vídeo da CHAMADA é desenhado num
    // <canvas> escondido com esse filtro aplicado (ctx.filter aceita a mesma
    // sintaxe CSS), e a faixa capturada desse canvas substitui a faixa
    // enviada (getActiveSenders, o mesmo mecanismo já usado por "Compartilhar
    // vídeo/tela") — por isso o filtro aparece também a quem está do outro
    // lado, não é só um efeito visual local.
    const LIVE_FILTER = { id: 'none', canvas: null, ctx: null, rafId: null, filteredTrack: null };
    function toggleLiveFilterRow() {
        const row = document.getElementById('callLiveFilterRow');
        if (row.style.display === 'flex') { row.style.display = 'none'; return; }
        row.innerHTML = SELFIE_FILTERS.map(f => `<span class="selfie-chip ${LIVE_FILTER.id === f.id ? 'active' : ''}" onclick="setLiveVideoFilter('${f.id}')">${f.name}</span>`).join('');
        row.style.display = 'flex';
    }
    function startLiveVideoFilterProcessing() {
        if (LIVE_FILTER.canvas) return; // já em curso
        const sourceVideo = document.getElementById('pipVideo'); // já mostra APP.callStream (a câmara local)
        const canvas = document.createElement('canvas');
        canvas.width = 480;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        LIVE_FILTER.canvas = canvas;
        LIVE_FILTER.ctx = ctx;
        LIVE_FILTER.filteredTrack = canvas.captureStream(24).getVideoTracks()[0];
        const draw = () => {
            if (!LIVE_FILTER.canvas) return; // parado entretanto (stopLiveVideoFilterProcessing)
            if (sourceVideo.videoWidth) {
                ctx.filter = SELFIE_FILTERS.find(f => f.id === LIVE_FILTER.id)?.css || 'none';
                ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
            }
            LIVE_FILTER.rafId = requestAnimationFrame(draw);
        };
        draw();
    }
    function stopLiveVideoFilterProcessing() {
        if (LIVE_FILTER.rafId) cancelAnimationFrame(LIVE_FILTER.rafId);
        LIVE_FILTER.rafId = null;
        LIVE_FILTER.canvas = null;
        LIVE_FILTER.ctx = null;
        LIVE_FILTER.filteredTrack = null;
        LIVE_FILTER.id = 'none';
        document.getElementById('pipVideo').style.filter = 'none';
    }
    function setLiveVideoFilter(filterId) {
        LIVE_FILTER.id = filterId;
        document.getElementById('pipVideo').style.filter = SELFIE_FILTERS.find(f => f.id === filterId)?.css || 'none'; // pré-visualização local instantânea
        toggleLiveFilterRow(); // fecha a tira de filtros depois de escolher
        if (filterId === 'none') {
            if (APP.callStream) {
                const rawTrack = APP.callStream.getVideoTracks()[0];
                if (rawTrack) getActiveSenders('video').forEach(sender => sender.replaceTrack(rawTrack));
            }
            stopLiveVideoFilterProcessing();
            return;
        }
        startLiveVideoFilterProcessing();
        if (LIVE_FILTER.filteredTrack) getActiveSenders('video').forEach(sender => sender.replaceTrack(LIVE_FILTER.filteredTrack));
    }

    function toggleMusicShare() {
        if (!document.getElementById('callScreen').classList.contains('active')) {
            return alert('Isto só funciona durante uma chamada — inicie uma chamada primeiro.');
        }
        if (!APP.musicAudio.src) return alert('Toque uma música primeiro (URL ou arquivo) antes de partilhar.');
        if (APP.musicShare.active) stopMusicShareOnly();
        else applyMusicShareMix();
    }

    function applyMusicShareMix() {
        if (!isInAnyCall() || !APP.callStream) return;
        try {
            const mix = getMusicMix();
            if (mix.micSource) { try { mix.micSource.disconnect(); } catch (e) {} }
            const micTrack = APP.callStream.getAudioTracks()[0];
            if (micTrack) {
                const micStream = new MediaStream([micTrack]);
                mix.micSource = mix.ctx.createMediaStreamSource(micStream);
                mix.micSource.connect(mix.dest);
            }
            const mixedTrack = mix.dest.stream.getAudioTracks()[0];
            if (mixedTrack) getActiveSenders('audio').forEach(sender => sender.replaceTrack(mixedTrack));

            APP.musicShare.active = true;
            const btn = document.getElementById('musicShareBtn');
            if (btn) { btn.classList.add('btn-accept'); btn.title = 'As outras pessoas na chamada já estão a ouvir esta música — toque para parar de partilhar'; }
        } catch (err) {
            alert('Não foi possível partilhar a música na chamada: ' + err.message);
        }
    }

    function stopMusicShareOnly() {
        const mix = APP._musicMix;
        if (mix && mix.micSource) { try { mix.micSource.disconnect(); } catch (e) {} mix.micSource = null; }
        // Restaura o áudio original (só microfone) na chamada
        if (isInAnyCall() && APP.callStream) {
            const camMic = APP.callStream.getAudioTracks()[0];
            if (camMic) getActiveSenders('audio').forEach(sender => sender.replaceTrack(camMic));
        }
        APP.musicShare.active = false;
        const btn = document.getElementById('musicShareBtn');
        if (btn) { btn.classList.remove('btn-accept'); btn.title = 'Deixar as outras pessoas na chamada ouvir esta música'; }
    }

    function shareVideo() {
        if (!isInAnyCall()) return alert('Inicie uma chamada primeiro!');
        document.getElementById('modalShareVideo').classList.add('active');
    }

    function shareVideoFromInput() {
        const url = document.getElementById('videoUrlInput').value.trim();
        const fileInput = document.getElementById('videoFileInput');
        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const videoUrl = URL.createObjectURL(file);
            playSharedVideo(videoUrl);
        } else if (url) {
            playSharedVideo(url);
        } else {
            alert('Forneça uma URL ou selecione um arquivo.');
            return;
        }
        closeModal('modalShareVideo');
    }

    function loadVideoFile(input) { /* placeholder, mantido por compatibilidade */ }

    // Toca um vídeo (arquivo local ou URL direta de mp4/webm) e TRANSMITE de
    // verdade pela chamada: capturamos o próprio elemento <video> com
    // captureStream() e substituímos as faixas de vídeo/áudio que estão
    // sendo enviadas pela peerConnection (mesma técnica já usada em
    // shareScreen). Assim o outro lado recebe o vídeo ao vivo, sincronizado,
    // e pausar/continuar/ajustar volume aqui reflete para quem está assistindo.
    // Observação: URLs de YouTube não funcionam com essa técnica (o YouTube
    // não expõe o elemento <video> para captura); funciona com arquivos
    // locais ou links diretos para .mp4/.webm/.ogg.
    // IMPORTANTE (mesma regra da música, ver getMusicMix acima):
    // createMediaElementSource só pode ser chamado UMA VEZ por elemento <video>
    // durante toda a vida da página. Sem isto, a primeira partilha de vídeo
    // funcionava, mas a segunda (de qualquer um dos lados, mesmo depois do
    // vídeo anterior ter terminado) dava sempre erro — cada pessoa só
    // conseguia partilhar um vídeo uma única vez por sessão.
    function getVideoShareAudioGraph(videoEl) {
        if (!APP._videoShareAudio) {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const source = ctx.createMediaElementSource(videoEl);
            APP._videoShareAudio = { ctx, source };
        }
        return APP._videoShareAudio;
    }

    // O Safari (incluindo iOS) não implementa HTMLMediaElement.captureStream()
    // em NENHUMA versão — mas implementa canvas.captureStream(), esse sim. A
    // diferença é importante: um <canvas> é um elemento que a própria página
    // desenha e controla, não é "o ecrã do telemóvel" (isso sim é impossível
    // de capturar no Safari iOS — a Apple não implementa getDisplayMedia() lá,
    // por política de segurança, e não há forma de contornar isso via código).
    // Aqui só precisamos de transmitir um vídeo que JÁ está a tocar dentro da
    // nossa própria página, por isso dá para desenhar cada frame do <video>
    // num <canvas> escondido, a um ritmo fixo, e capturar esse canvas em vez
    // do vídeo diretamente — funciona em qualquer navegador que tenha um dos
    // dois, incluindo o Safari/iPhone.
    function getSharedVideoStream(videoEl) {
        if (videoEl.captureStream) return { stream: videoEl.captureStream(), stop: () => {} };
        if (videoEl.mozCaptureStream) return { stream: videoEl.mozCaptureStream(), stop: () => {} };
        const canvas = document.createElement('canvas');
        if (!canvas.captureStream) return null; // navegador sem nenhum dos dois — caso raríssimo
        canvas.width = videoEl.videoWidth || 640;
        canvas.height = videoEl.videoHeight || 360;
        const ctx2d = canvas.getContext('2d');
        let rafId = null;
        const draw = () => {
            if (videoEl.videoWidth && (canvas.width !== videoEl.videoWidth || canvas.height !== videoEl.videoHeight)) {
                canvas.width = videoEl.videoWidth;
                canvas.height = videoEl.videoHeight;
            }
            try { ctx2d.drawImage(videoEl, 0, 0, canvas.width, canvas.height); } catch (e) { /* frame ainda não pronto, ignora */ }
            rafId = requestAnimationFrame(draw);
        };
        draw();
        return { stream: canvas.captureStream(30), stop: () => { if (rafId) cancelAnimationFrame(rafId); } };
    }

    function playSharedVideo(src) {
        if (!isInAnyCall()) return alert('Inicie uma chamada primeiro!');
        if (APP.sharedStream) { APP.sharedStream.getTracks().forEach(t => t.stop()); APP.sharedStream = null; document.getElementById('callPip').style.display = 'none'; }

        const preview = document.getElementById('sharedVideoPreview');
        preview.src = src;
        preview.loop = false;
        preview.muted = false; // o áudio real vai pelo Web Audio graph abaixo

        preview.onloadedmetadata = () => {
            try {
                // Guarda as faixas originais da câmera/microfone para restaurar depois
                if (APP.callStream) {
                    APP.videoShare.camVideoTrack = APP.callStream.getVideoTracks()[0] || null;
                    APP.videoShare.camAudioTrack = APP.callStream.getAudioTracks()[0] || null;
                }

                // Roteia o áudio do vídeo por um GainNode para que o slider de
                // volume realmente altere o que é transmitido (captureStream
                // sozinho ignora o volume do elemento). Reutiliza sempre o mesmo
                // AudioContext/source do elemento (ver getVideoShareAudioGraph) —
                // só a ligação gainNode/dest é recriada a cada partilha.
                const { ctx: audioCtx, source } = getVideoShareAudioGraph(preview);
                try { source.disconnect(); } catch (e) { /* nada ligado ainda, ignora */ }
                const gainNode = audioCtx.createGain();
                const dest = audioCtx.createMediaStreamDestination();
                source.connect(gainNode);
                gainNode.connect(dest);
                gainNode.connect(audioCtx.destination); // para quem compartilha também ouvir localmente
                APP.videoShare.audioCtx = audioCtx;
                APP.videoShare.gainNode = gainNode;

                const captured = getSharedVideoStream(preview);
                if (!captured) return alert('Este navegador não suporta transmitir vídeo em tempo real desta forma.');
                const capturedStream = captured.stream;
                APP.videoShare.stopCapture = captured.stop;
                APP.videoShare.stream = capturedStream;
                const videoTrack = capturedStream.getVideoTracks()[0];
                const audioTrack = dest.stream.getAudioTracks()[0];

                // Troca a faixa em TODAS as ligações ativas — funciona tanto numa
                // chamada 1-para-1 como numa chamada de grupo (uma ligação por
                // cada pessoa), para todos verem/ouvirem o vídeo partilhado.
                if (videoTrack) getActiveSenders('video').forEach(sender => sender.replaceTrack(videoTrack));
                if (audioTrack) getActiveSenders('audio').forEach(sender => sender.replaceTrack(audioTrack));
                // Numa chamada de grupo, atualiza também o teu próprio quadrado na
                // grelha para mostrares o vídeo partilhado (antes mostrava sempre
                // a tua câmara, mesmo estando a partilhar outra coisa).
                if (GROUP_CALL.active && videoTrack) {
                    const meTile = document.getElementById('tile_me');
                    if (meTile) meTile.querySelector('video').srcObject = capturedStream;
                }

                APP.videoShare.active = true;
                APP.videoShare.videoEl = preview;
                document.getElementById('videoSharePanel').style.display = 'flex';
                document.getElementById('vspPlayBtn').textContent = '⏸️';
                document.getElementById('vspVolume').value = 100;
                document.getElementById('callStatus').textContent = '🎬 Compartilhando vídeo em tempo real';

                preview.play().catch(err => {
                    console.warn('Autoplay do vídeo compartilhado bloqueado:', err.message);
                    alert('Toque em ▶️ no painel do vídeo para iniciar (o navegador bloqueou a reprodução automática).');
                });

                preview.onended = () => stopVideoShare();
            } catch (err) {
                alert('Erro ao transmitir o vídeo: ' + err.message);
            }
        };
    }

    function toggleSharedVideoPlay() {
        const preview = APP.videoShare.videoEl;
        if (!preview) return;
        const btn = document.getElementById('vspPlayBtn');
        if (preview.paused) {
            preview.play();
            btn.textContent = '⏸️';
            document.getElementById('callStatus').textContent = '🎬 Compartilhando vídeo em tempo real';
        } else {
            preview.pause();
            btn.textContent = '▶️';
            document.getElementById('callStatus').textContent = '⏸️ Vídeo pausado para todos';
        }
    }

    function setSharedVideoVolume(value) {
        if (APP.videoShare.gainNode) APP.videoShare.gainNode.gain.value = value / 100;
    }

    function stopVideoShare() {
        const vs = APP.videoShare;
        if (!vs.active) return;
        if (vs.videoEl) { vs.videoEl.pause(); vs.videoEl.src = ''; vs.videoEl.onended = null; }
        // No Safari (sem captureStream do vídeo, ver getSharedVideoStream), isto
        // para o loop de requestAnimationFrame que desenhava os frames no canvas
        // escondido — sem isto, ficava a desenhar para sempre em segundo plano.
        if (vs.stopCapture) { vs.stopCapture(); vs.stopCapture = null; }
        vs.stream = null;
        // Nunca fechar o AudioContext aqui — é o mesmo, guardado em
        // APP._videoShareAudio, reutilizado em todas as partilhas seguintes
        // (ver getVideoShareAudioGraph). Só desliga o "gain" desta partilha.
        if (vs.gainNode) { try { vs.gainNode.disconnect(); } catch (e) {} }
        // Restaura a câmera/microfone originais em todas as ligações ativas
        // (1-para-1 ou, numa chamada de grupo, em cada uma das ligações)
        if (vs.camVideoTrack) getActiveSenders('video').forEach(sender => sender.replaceTrack(vs.camVideoTrack));
        if (vs.camAudioTrack) getActiveSenders('audio').forEach(sender => sender.replaceTrack(vs.camAudioTrack));
        if (GROUP_CALL.active && APP.callStream) {
            const meTile = document.getElementById('tile_me');
            if (meTile) meTile.querySelector('video').srcObject = APP.callStream;
        }
        vs.active = false;
        vs.videoEl = null;
        vs.audioCtx = null;
        vs.gainNode = null;
        vs.camVideoTrack = null;
        vs.camAudioTrack = null;
        const panel = document.getElementById('videoSharePanel');
        panel.style.display = 'none';
        panel.classList.remove('minimized');
        APP.videoShare.minimized = false;
        document.getElementById('vspMinBtn').textContent = '🔽';
        if (document.getElementById('callScreen').classList.contains('active')) {
            document.getElementById('callStatus').textContent = 'Conectado ✅';
        }
    }

    function toggleMinimizeVideoShare() {
        const panel = document.getElementById('videoSharePanel');
        APP.videoShare.minimized = !APP.videoShare.minimized;
        panel.classList.toggle('minimized', APP.videoShare.minimized);
        document.getElementById('vspMinBtn').textContent = APP.videoShare.minimized ? '🔼' : '🔽';
    }

    // Arrastar o painel do vídeo compartilhado pela sua barra de título
    (function enableVideoSharePanelDrag() {
        const panel = document.getElementById('videoSharePanel');
        const handle = document.getElementById('vspDragHandle');
        let dragging = false, offsetX = 0, offsetY = 0;
        function startDrag(clientX, clientY) {
            dragging = true;
            const rect = panel.getBoundingClientRect();
            const containerRect = document.getElementById('callVideoContainer').getBoundingClientRect();
            offsetX = clientX - rect.left;
            offsetY = clientY - rect.top;
            panel.style.left = (rect.left - containerRect.left) + 'px';
            panel.style.top = (rect.top - containerRect.top) + 'px';
            panel.style.right = 'auto';
        }
        function moveDrag(clientX, clientY) {
            if (!dragging) return;
            const containerRect = document.getElementById('callVideoContainer').getBoundingClientRect();
            let x = clientX - containerRect.left - offsetX;
            let y = clientY - containerRect.top - offsetY;
            x = Math.max(0, Math.min(x, containerRect.width - 40));
            y = Math.max(0, Math.min(y, containerRect.height - 30));
            panel.style.left = x + 'px';
            panel.style.top = y + 'px';
        }
        handle.addEventListener('mousedown', (e) => startDrag(e.clientX, e.clientY));
        document.addEventListener('mousemove', (e) => moveDrag(e.clientX, e.clientY));
        document.addEventListener('mouseup', () => dragging = false);
        handle.addEventListener('touchstart', (e) => { const t = e.touches[0]; startDrag(t.clientX, t.clientY); }, { passive: true });
        document.addEventListener('touchmove', (e) => { if (dragging) { const t = e.touches[0]; moveDrag(t.clientX, t.clientY); } }, { passive: true });
        document.addEventListener('touchend', () => dragging = false);
    })();

    function shareScreen() {
        if (!document.getElementById('callScreen').classList.contains('active')) return alert('Inicie uma chamada primeiro!');
        if (!navigator.mediaDevices.getDisplayMedia) {
            return alert('Compartilhamento de tela não é suportado neste navegador/dispositivo. Essa função funciona apenas em computadores — a maioria dos navegadores móveis (Android/iOS) não permite capturar a tela via navegador.');
        }
        if (APP.videoShare.active) stopVideoShare();
        // audio:true pede também o áudio do sistema/aba — o navegador só entrega isso se o
        // usuário marcar "Compartilhar áudio" na caixa de seleção nativa (mais comum de
        // funcionar no Chrome desktop ao compartilhar uma aba específica).
        navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).then(stream => {
            if (APP.sharedStream) APP.sharedStream.getTracks().forEach(t => t.stop());
            APP.sharedStream = stream;
            if (peerConnection) {
                const videoSender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                if (videoSender) videoSender.replaceTrack(stream.getVideoTracks()[0]);
                const screenAudioTrack = stream.getAudioTracks()[0];
                if (screenAudioTrack) {
                    const audioSender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
                    if (audioSender) audioSender.replaceTrack(screenAudioTrack);
                } else {
                    console.warn('O navegador não forneceu áudio do sistema — o outro lado ouvirá só o microfone.');
                }
            }
            const pipVideo = document.getElementById('pipVideo');
            if (APP.callStream) { pipVideo.srcObject = APP.callStream; document.getElementById('callPip').style.display = 'block'; }
            document.getElementById('callStatus').textContent = '🖥️ Compartilhando tela';
            stream.getVideoTracks()[0].onended = () => {
                if (peerConnection && APP.callStream) {
                    const videoSender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                    const camTrack = APP.callStream.getVideoTracks()[0];
                    if (videoSender && camTrack) videoSender.replaceTrack(camTrack);
                    const audioSender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
                    const micTrack = APP.callStream.getAudioTracks()[0];
                    if (audioSender && micTrack) audioSender.replaceTrack(micTrack);
                }
                document.getElementById('callPip').style.display = 'none';
                document.getElementById('callStatus').textContent = 'Conectado ✅';
            };
        }).catch(err => alert('Erro ao compartilhar tela: ' + err.message));
    }

    // ==================== QUADRO BRANCO SINCRONIZADO ====================
    // Cada traço é enviado pelo socket como coordenadas NORMALIZADAS (0 a 1),
    // assim funciona igual mesmo que o canvas tenha tamanho diferente nos dois lados.
    function drawSegment(x0, y0, x1, y1, color, size) {
        const ctx = APP.whiteboard.ctx;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = color;
        ctx.lineWidth = size;
        ctx.lineCap = 'round';
        ctx.stroke();
    }

    function emitWhiteboardSegment(x0, y0, x1, y1, color, size) {
        if (!APP.currentChatId) return;
        const canvas = APP.whiteboard.canvas;
        socket.emit('whiteboard_draw', {
            roomId: APP.currentChatId,
            x0: x0 / canvas.width, y0: y0 / canvas.height,
            x1: x1 / canvas.width, y1: y1 / canvas.height,
            color, size
        });
    }

    socket.on('whiteboard_draw_received', (data) => {
        const canvas = APP.whiteboard.canvas;
        drawSegment(data.x0 * canvas.width, data.y0 * canvas.height, data.x1 * canvas.width, data.y1 * canvas.height, data.color, data.size);
    });
    socket.on('whiteboard_clear_received', () => {
        APP.whiteboard.ctx.clearRect(0, 0, APP.whiteboard.canvas.width, APP.whiteboard.canvas.height);
    });
    // Ao abrir o quadro (openWhiteboard, abaixo) pedimos o histórico já
    // desenhado nesta sala — assim quem entra a meio de uma chamada, principalmente
    // em grupo com várias pessoas, vê o mesmo quadro que os outros, não um em branco.
    socket.on('whiteboard_state', (data) => {
        if (data.roomId !== APP.currentChatId) return;
        const canvas = APP.whiteboard.canvas;
        (data.segments || []).forEach(seg => {
            drawSegment(seg.x0 * canvas.width, seg.y0 * canvas.height, seg.x1 * canvas.width, seg.y1 * canvas.height, seg.color, seg.size);
        });
    });

    // Converte a posição do rato/dedo (em pixels do ecrã) para a posição
    // correspondente na resolução interna do canvas — sem isto, o traço
    // desenhado ficava desalinhado sempre que o quadro era exibido menor
    // que 600x400 (o que acontece em quase todos os telemóveis).
    function whiteboardEventPos(clientX, clientY) {
        const canvas = APP.whiteboard.canvas;
        const rect = canvas.getBoundingClientRect();
        return {
            x: (clientX - rect.left) * (canvas.width / rect.width),
            y: (clientY - rect.top) * (canvas.height / rect.height)
        };
    }

    function initWhiteboard() {
        const canvas = APP.whiteboard.canvas;
        canvas.addEventListener('mousedown', startDraw);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDraw);
        canvas.addEventListener('mouseleave', stopDraw);
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const pos = whiteboardEventPos(touch.clientX, touch.clientY);
            APP.whiteboard.lastX = pos.x;
            APP.whiteboard.lastY = pos.y;
            APP.whiteboard.drawing = true;
        });
        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (!APP.whiteboard.drawing) return;
            const touch = e.touches[0];
            const pos = whiteboardEventPos(touch.clientX, touch.clientY);
            const color = document.getElementById('drawColor').value;
            const size = document.getElementById('drawSize').value;
            drawSegment(APP.whiteboard.lastX, APP.whiteboard.lastY, pos.x, pos.y, color, size);
            emitWhiteboardSegment(APP.whiteboard.lastX, APP.whiteboard.lastY, pos.x, pos.y, color, size);
            APP.whiteboard.lastX = pos.x;
            APP.whiteboard.lastY = pos.y;
        });
        canvas.addEventListener('touchend', () => APP.whiteboard.drawing = false);
    }

    function startDraw(e) {
        APP.whiteboard.drawing = true;
        const pos = whiteboardEventPos(e.clientX, e.clientY);
        APP.whiteboard.lastX = pos.x;
        APP.whiteboard.lastY = pos.y;
    }

    function draw(e) {
        if (!APP.whiteboard.drawing) return;
        const pos = whiteboardEventPos(e.clientX, e.clientY);
        const color = document.getElementById('drawColor').value;
        const size = document.getElementById('drawSize').value;
        drawSegment(APP.whiteboard.lastX, APP.whiteboard.lastY, pos.x, pos.y, color, size);
        emitWhiteboardSegment(APP.whiteboard.lastX, APP.whiteboard.lastY, pos.x, pos.y, color, size);
        APP.whiteboard.lastX = pos.x;
        APP.whiteboard.lastY = pos.y;
    }

    function stopDraw() { APP.whiteboard.drawing = false; }
    function openWhiteboard() {
        document.getElementById('whiteboardContainer').classList.add('active');
        if (APP.currentChatId) {
            APP.whiteboard.ctx.clearRect(0, 0, APP.whiteboard.canvas.width, APP.whiteboard.canvas.height);
            socket.emit('whiteboard_get_state', { roomId: APP.currentChatId });
        }
    }
    function closeWhiteboard() { document.getElementById('whiteboardContainer').classList.remove('active'); }
    function clearWhiteboard() {
        APP.whiteboard.ctx.clearRect(0, 0, APP.whiteboard.canvas.width, APP.whiteboard.canvas.height);
        if (APP.currentChatId) socket.emit('whiteboard_clear', { roomId: APP.currentChatId });
    }

    function closeModal(modalId) { document.getElementById(modalId).classList.remove('active'); }
    function openMoreFeaturesModal() { document.getElementById('modalMoreFeatures').classList.add('active'); }
    function openMediaFeaturesModal() { document.getElementById('modalMediaFeatures').classList.add('active'); }
    function openContactsFeaturesModal() { document.getElementById('modalContactsFeatures').classList.add('active'); }
    function openChatMoreModal() { document.getElementById('modalChatMore').classList.add('active'); }
    document.addEventListener('click', function(e) { if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('active'); });
    document.addEventListener('click', function(e) {
        const box = document.getElementById('mentionAutocomplete');
        if (box && box.style.display !== 'none' && e.target.id !== 'messageInput' && !box.contains(e.target)) hideMentionAutocomplete();
    });
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            if (document.getElementById('callScreen').classList.contains('active')) endCall();
            else if (APP.currentChatId) closeChat();
            document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
        }
    });

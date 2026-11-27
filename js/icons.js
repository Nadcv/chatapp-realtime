// Ícones modernos (SVG de linha, estilo iOS) em vez dos emojis dos botões principais.
// Desenhos baseados no conjunto Lucide (lucide.dev, licença ISC).
// applyModernIcons() troca SÓ o emoji de cada botão pelo SVG: o title, o
// onclick, os badges e o texto dos menus ficam iguais. O emoji original fica
// guardado num <span class="ui-icon-fallback"> escondido (leitores de ecrã e
// testes continuam a encontrá-lo).
(function () {
    const P = (d) => d.map(x => x.startsWith('<') ? x : `<path d="${x}"/>`).join('');
    const ICONS = {
        globe: P(['<circle cx="12" cy="12" r="10"/>', 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', 'M2 12h20']),
        music: P(['M9 18V5l12-2v13', '<circle cx="6" cy="18" r="3"/>', '<circle cx="18" cy="16" r="3"/>']),
        settings: P(['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z', '<circle cx="12" cy="12" r="3"/>']),
        more: P(['<circle cx="12" cy="12" r="1.2"/>', '<circle cx="19" cy="12" r="1.2"/>', '<circle cx="5" cy="12" r="1.2"/>']),
        clapper: P(['M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z', 'm6.2 5.3 3.1 3.9', 'm12.4 3.4 3.1 4', 'M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z']),
        users: P(['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', '<circle cx="9" cy="7" r="4"/>', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75']),
        status: P(['<circle cx="12" cy="12" r="10" stroke-dasharray="4 2.3"/>', '<circle cx="12" cy="12" r="4"/>']),
        contrast: P(['<circle cx="12" cy="12" r="10"/>', 'M12 18a6 6 0 0 0 0-12v12z']),
        palette: P(['M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z', '<circle cx="13.5" cy="6.5" r="1"/>', '<circle cx="17.5" cy="10.5" r="1"/>', '<circle cx="6.5" cy="12.5" r="1"/>', '<circle cx="8.5" cy="7.5" r="1"/>']),
        logout: P(['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9']),
        phone: P(['M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z']),
        video: P(['m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5', '<rect x="2" y="6" width="14" height="12" rx="2"/>']),
        back: P(['m12 19-7-7 7-7', 'M19 12H5']),
        smile: P(['<circle cx="12" cy="12" r="10"/>', 'M8 14s1.5 2 4 2 4-2 4-2', 'M9 9h.01', 'M15 9h.01']),
        gif: P(['<rect x="2" y="5" width="20" height="14" rx="3"/>', 'M10 10H8a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h2v-2', 'M13 10v4', 'M16 14v-4h2.5', 'M16 12h2']),
        wand: P(['m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72', 'm14 7 3 3', 'M5 6v4', 'M19 14v4', 'M10 2v2', 'M7 8H3', 'M21 16h-4', 'M11 3H9']),
        clip: P(['m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48']),
        chart: P(['M3 3v18h18', 'M18 17V9', 'M13 17V5', 'M8 17v-3']),
        calendarCheck: P(['<rect x="3" y="4" width="18" height="18" rx="2"/>', 'M16 2v4', 'M8 2v4', 'M3 10h18', 'm9 16 2 2 4-4']),
        gamepad: P(['M6 11h4', 'M8 9v4', 'M15 12h.01', 'M18 10h.01', 'M17.32 5H6.68a4 4 0 0 0-3.978 3.59C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258A4 4 0 0 0 17.32 5z']),
        mic: P(['M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v3']),
        send: P(['M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z', 'm21.854 2.147-10.94 10.939']),
        heart: P(['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z']),
        comment: P(['M7.9 20A9 9 0 1 0 4 16.1L2 22Z']),
        trash: P(['M3 6h18', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2']),
        flag: P(['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7']),
        plus: P(['M5 12h14', 'M12 5v14']),
        x: P(['M18 6 6 18', 'm6 6 12 12']),
        search: P(['<circle cx="11" cy="11" r="8"/>', 'm21 21-4.3-4.3']),
        feed: P(['M18 22H4a2 2 0 0 1-2-2V6', 'm22 13-1.296-1.296a2.41 2.41 0 0 0-3.408 0L11 18', '<circle cx="12" cy="8" r="2"/>', '<rect x="6" y="2" width="16" height="16" rx="2"/>']),
        calculator: P(['<rect x="4" y="2" width="16" height="20" rx="2"/>', 'M8 6h8', 'M16 14v4', 'M16 10h.01', 'M12 10h.01', 'M8 10h.01', 'M12 14h.01', 'M8 14h.01', 'M12 18h.01', 'M8 18h.01']),
        banknote: P(['<rect x="2" y="6" width="20" height="12" rx="2"/>', '<circle cx="12" cy="12" r="2"/>', 'M6 12h.01M18 12h.01']),
        compass: P(['<circle cx="12" cy="12" r="10"/>', 'm16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z']),
        flame: P(['M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z']),
        rocket: P(['M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z', 'm12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z', 'M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0', 'M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5']),
        bus: P(['M8 6v6', 'M15 6v6', 'M2 12h19.6', 'M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3', '<circle cx="7" cy="18" r="2"/>', 'M9 18h5', '<circle cx="16" cy="18" r="2"/>']),
        map: P(['M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z', 'M15 5.764v15', 'M9 3.236v15']),
        pin: P(['M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0', '<circle cx="12" cy="10" r="3"/>']),
        ticket: P(['M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z', 'M13 5v2', 'M13 17v2', 'M13 11v2']),
        cart: P(['<circle cx="8" cy="21" r="1"/>', '<circle cx="19" cy="21" r="1"/>', 'M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12']),
        bell: P(['M10.268 21a2 2 0 0 0 3.464 0', 'M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326']),
        car: P(['M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2', '<circle cx="7" cy="17" r="2"/>', 'M9 17h6', '<circle cx="17" cy="17" r="2"/>']),
        cloudSun: P(['M12 2v2', 'm4.93 4.93 1.41 1.41', 'M20 12h2', 'm19.07 4.93-1.41 1.41', 'M15.947 12.65a4 4 0 0 0-5.925-4.128', 'M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z']),
        activity: P(['M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2']),
        dice: P(['<rect x="3" y="3" width="18" height="18" rx="2"/>', 'M16 8h.01', 'M8 8h.01', 'M8 16h.01', 'M16 16h.01', 'M12 12h.01']),
        lock: P(['<rect x="3" y="11" width="18" height="11" rx="2"/>', 'M7 11V7a5 5 0 0 1 10 0v4']),
        smartphone: P(['<rect x="5" y="2" width="14" height="20" rx="2"/>', 'M12 18h.01']),
        siren: P(['M7 18v-6a5 5 0 1 1 10 0v6', 'M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z', 'M21 12h1', 'M18.5 4.5 18 5', 'M2 12h1', 'M12 2v1', 'm4.929 4.929.707.707', 'M12 12v6']),
        book: P(['M12 7v14', 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z']),
        tv: P(['<rect x="2" y="7" width="20" height="15" rx="2"/>', 'm17 2-5 5-5-5']),
        film: P(['<rect x="2" y="2" width="20" height="20" rx="2.18"/>', 'M7 2v20', 'M17 2v20', 'M2 12h20', 'M2 7h5', 'M2 17h5', 'M17 17h5', 'M17 7h5']),
        newspaper: P(['M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2', 'M18 14h-8', 'M15 18h-5', 'M10 6h8v4h-8V6Z']),
        headphones: P(['M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3']),
        laugh: P(['<circle cx="12" cy="12" r="10"/>', 'M18 13a6 6 0 0 1-6 5 6 6 0 0 1-6-5h12Z', 'M9 9h.01', 'M15 9h.01']),
        userPlus: P(['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', '<circle cx="9" cy="7" r="4"/>', 'M19 8v6', 'M22 11h-6']),
        megaphone: P(['m3 11 18-5v12L3 14v-3z', 'M11.6 16.8a3 3 0 1 1-5.8-1.6']),
        phoneCall: P(['M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z', 'M14.05 2a9 9 0 0 1 8 7.94', 'M14.05 6A5 5 0 0 1 18 10']),
        mail: P(['<rect x="2" y="4" width="20" height="16" rx="2"/>', 'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7']),
        history: P(['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M12 7v5l4 2']),
        archive: P(['<rect x="2" y="3" width="20" height="5" rx="1"/>', 'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8', 'M10 12h4']),
        ban: P(['<circle cx="12" cy="12" r="10"/>', 'm4.9 4.9 14.2 14.2']),
        sparkles: P(['M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z', 'M20 3v4', 'M22 5h-4']),
        shield: P(['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z', 'm9 12 2 2 4-4']),
        image: P(['<rect x="3" y="3" width="18" height="18" rx="2"/>', '<circle cx="9" cy="9" r="2"/>', 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'])
    };
    function svg(name, size) {
        const body = ICONS[name];
        if (!body) return '';
        return `<svg class="ui-icon" width="${size || 20}" height="${size || 20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    }
    window.uiIcon = svg;

    // Botões simples (só um emoji lá dentro): seletor -> ícone.
    const PLAIN = [
        ['button[onclick="openTranslatorModal()"]', 'globe'], ['button[onclick="toggleMusicPlayer()"]', 'music'],
        ['#adminBtn', 'settings'], ['button.btn-icon[onclick="openMoreFeaturesModal()"]', 'more'], ['#mediaBtn', 'clapper'],
        ['button.btn-icon[onclick="openContactsFeaturesModal()"]', 'users'], ['button.btn-icon[onclick="openStatusScreen()"]', 'status'],
        ['button.btn-icon[onclick="toggleTheme()"]', 'contrast'], ['button.btn-icon[onclick="openCustomizeModal()"]', 'palette'],
        ['button.btn-icon[onclick="logout()"]', 'logout'], ['#feedBtn', 'feed'],
        ['button.btn-icon[onclick="startCall(\'voice\')"]', 'phone'], ['button.btn-icon[onclick="startCall(\'video\')"]', 'video'],
        ['button.btn-icon[onclick="openChatMoreModal()"]', 'more'], ['button.btn-back[onclick="closeChat()"]', 'back'],
        ['.chat-input-area button.btn-icon[onclick^="toggleEmojiPicker"]', 'smile'], ['.chat-input-area button[onclick="openGifPickerModal()"]', 'gif'],
        ['.chat-input-area button[onclick="openImageGenModal()"]', 'wand'], ['#pollBtn', 'chart'], ['#rsvpBtn', 'calendarCheck'], ['#gamesBtn', 'gamepad']
    ];
    // Botões dos menus (emoji + <span>nome</span>): função chamada -> ícone num azulejo colorido.
    const MENU = {
        openCalcScreen: ['calculator', '#64748b'], openCurrencyScreen: ['banknote', '#16a34a'], openNavScreen: ['compass', '#2563eb'],
        openFiresScreen: ['flame', '#ea580c'], openSpaceScreen: ['rocket', '#4f46e5'], openTransportScreen: ['bus', '#0891b2'],
        openTourismScreen: ['map', '#0d9488'], openMapSearchScreen: ['pin', '#dc2626'], openEventsScreen: ['ticket', '#c026d3'],
        openShoppingScreen: ['cart', '#d97706'], openRemindersScreen: ['bell', '#e11d48'], openDriveListenScreen: ['car', '#475569'],
        openWeatherScreen: ['cloudSun', '#0ea5e9'], openActivitiesScreen: ['activity', '#22c55e'], openRouletteScreen: ['dice', '#a855f7'],
        openPinSetupModal: ['lock', '#334155'], openDevicesModal: ['smartphone', '#6366f1'], openSosModal: ['siren', '#ef4444'],
        openLibraryScreen: ['book', '#b45309'], openTvScreen: ['tv', '#1d4ed8'], openWatchScreen: ['film', '#be123c'],
        openNewsScreen: ['newspaper', '#0f766e'], openJamendoScreen: ['headphones', '#7c3aed'], openFunnyFeedScreen: ['laugh', '#f59e0b'],
        openCreateGroupModal: ['userPlus', '#2563eb'], openCommunitiesScreen: ['globe', '#0d9488'], openBroadcastScreen: ['megaphone', '#ea580c'],
        openNewCallModal: ['phoneCall', '#16a34a'], openSearchUserModal: ['search', '#475569'], inviteFriends: ['mail', '#7c3aed'],
        openCallLogScreen: ['history', '#0891b2'], openArchivedScreen: ['archive', '#64748b'], openBlockedUsersModal: ['ban', '#dc2626'],
        openNearbyFriendsModal: ['pin', '#db2777'], startTour: ['compass', '#7c5cff'], openRailSafetyScreen: ['shield', '#dc2626'], openFeedScreen: ['feed', '#7c5cff']
    };
    function keepFallback(btn, emojiText) {
        const fb = document.createElement('span');
        fb.className = 'ui-icon-fallback';
        fb.textContent = emojiText;
        return fb;
    }
    function applyModernIcons() {
        PLAIN.forEach(([sel, name]) => {
            document.querySelectorAll(sel).forEach(btn => {
                if (btn.querySelector('.ui-icon')) return; // já tem ícone (ou voltou a ter emoji depois de gravar um áudio: troca outra vez)
                const textNode = [...btn.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
                if (!textNode) return;
                const emoji = textNode.textContent.trim();
                const wrap = document.createElement('span');
                wrap.className = 'ui-icon-wrap';
                wrap.innerHTML = svg(name, 20);
                btn.replaceChild(wrap, textNode);
                btn.insertBefore(keepFallback(btn, emoji), wrap.nextSibling);
                if (!btn.getAttribute('aria-label') && btn.title) btn.setAttribute('aria-label', btn.title);
                btn.dataset.modernIcon = name;
            });
        });
        document.querySelectorAll('#modalMoreFeatures button, #modalMediaFeatures button, #modalContactsFeatures button').forEach(btn => {
            if (btn.dataset.modernIcon) return;
            const onclick = btn.getAttribute('onclick') || '';
            const fn = Object.keys(MENU).find(f => onclick.includes(f + '('));
            if (!fn) return;
            const textNode = [...btn.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
            if (!textNode) return;
            const [name, color] = MENU[fn];
            const emoji = textNode.textContent.trim();
            const tile = document.createElement('span');
            tile.className = 'ui-icon-tile';
            tile.style.setProperty('--tile', color);
            tile.innerHTML = svg(name, 22);
            btn.replaceChild(tile, textNode);
            btn.insertBefore(keepFallback(btn, emoji), tile.nextSibling);
            btn.dataset.modernIcon = name;
        });
    }
    window.applyModernIcons = applyModernIcons;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyModernIcons);
    else applyModernIcons();
})();

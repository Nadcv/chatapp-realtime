// Service Worker do ChatApp — instalação como app (PWA) + notificações push.
const CACHE_NAME = 'chatapp-shell-v2';
const SHELL_FILES = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Estratégia simples: tenta a rede primeiro (para não mostrar dados/mensagens
// desatualizados), e só usa a cache como reserva se estiveres offline.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// ==================== NOTIFICAÇÕES PUSH ====================
self.addEventListener('push', (event) => {
  let payload = { title: 'ChatApp', body: 'Tens uma mensagem nova.' };
  try { payload = event.data ? event.data.json() : payload; } catch (e) { /* usa o padrão acima */ }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'ChatApp', {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { chatId: payload.chatId || null },
      tag: payload.chatId || undefined // agrupa notificações da mesma conversa
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      if (clientsArr.length > 0) return clientsArr[0].focus();
      return self.clients.openWindow('/');
    })
  );
});

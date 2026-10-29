// Service worker: recebe os avisos (Web Push) e abre a plataforma no ponto certo ao clicar.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titulo: e.data && e.data.text() }; }
  e.waitUntil((async () => {
    // mensagem de Conversas com a plataforma aberta e na frente: o próprio app já tocou o som — não duplica o aviso
    if (String(d.tag || '').startsWith('chat-')) {
      const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (abas.some(c => c.visibilityState === 'visible' && c.focused)) return;
    }
    // mensagens da mesma conversa substituem o aviso anterior (como no WhatsApp)
    const tag = String(d.tag || '').startsWith('chat-') && d.link ? 'chat-' + d.link : d.tag;
    return self.registration.showNotification(d.titulo || 'IPLAMM · Fluxo de Caixa', {
      body: d.corpo || '', tag, renotify: !!tag && tag.startsWith('chat-'), icon: 'assets/icon-192.png', badge: 'assets/icon-192.png',
      data: { link: d.link || '' }, requireInteraction: /URGENTE/.test(d.titulo || ''),
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const alvo = new URL('./' + (e.notification.data?.link || ''), self.registration.scope).href;
  e.waitUntil((async () => {
    const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of abas) if (c.url.startsWith(self.registration.scope)) { await c.focus(); return c.navigate ? c.navigate(alvo) : null; }
    return self.clients.openWindow(alvo);
  })());
});

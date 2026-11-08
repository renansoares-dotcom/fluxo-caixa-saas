// Service worker: recebe os avisos (Web Push) e abre a plataforma no ponto certo ao clicar.
// Modo sem internet (melhoria 1.5): os arquivos da plataforma (página, scripts, estilos, ícones) ficam guardados no aparelho.
// Com sinal, sempre vem a versão nova do servidor (e a cópia é atualizada); sem sinal, abre a última cópia.
// Os dados (Supabase) não passam por aqui: o js/lib/offline.js guarda as leituras das telas de chão de fábrica.
const CACHE = 'iplamm-app-v1';
const BASE = ['./', 'index.html', 'manifest.webmanifest', 'assets/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('iplamm-app-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin) return;          // Supabase e outros sites: direto
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const resp = await fetch(r);
      if (resp.ok && resp.type === 'basic') c.put(r.mode === 'navigate' ? 'index.html' : r, resp.clone()).catch(() => {});
      return resp;
    } catch (err) {
      // sem sinal: a página abre pelo index guardado; scripts com ?v= diferente casam pelo caminho
      const hit = r.mode === 'navigate' ? await c.match('index.html') : (await c.match(r)) || (await c.match(r, { ignoreSearch: true }));
      if (hit) return hit;
      throw err;
    }
  })());
});

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
      data: { link: d.link || '' }, requireInteraction: !!d.urgente || /URGENTE/.test(d.titulo || ''), vibrate: d.urgente ? [300, 120, 300, 120, 300] : undefined,
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

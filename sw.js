/* Gestão Barber IA — service worker.
   Permite instalar o app na tela de início. Sempre busca a versão mais nova na
   internet; a cópia guardada só é usada quando o celular está sem conexão.
   Dados (Supabase) nunca passam por aqui. */
const CACHE = 'gbia-v97';
const SHELL = ['./', 'index.html', 'css/styles.css', 'js/vendor/supabase.js', 'js/config.js', 'js/icons.js', 'js/data.js', 'js/updates.js', 'js/cloud.js', 'js/app.js', 'assets/logo.jpg', 'assets/icon-192.png', 'assets/logo-salao.jpg', 'assets/icon-salao-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(r => r || caches.match('index.html')))
  );
});

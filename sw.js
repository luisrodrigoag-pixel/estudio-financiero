/* Estudio financiero · service worker (sólo la versión de GitHub Pages)
   Red primero para la navegación y el HTML, con respaldo en caché sin conexión;
   caché primero para íconos y fuentes. build3.py sustituye VERSION por un hash del
   index y del manifiesto, así que cada build instala una caché nueva y borra las viejas. */
'use strict';
const VERSION = '48882b48b431';
const PREFIX = 'estudio-financiero-';
const CACHE = PREFIX + VERSION;
const SCOPE = self.registration.scope;
const SCOPE_PATH = new URL(SCOPE).pathname;
const INDEX = new URL('index.html', SCOPE).href;
const SHELL = [INDEX, 'manifest.webmanifest', 'apple-touch-icon.png', 'icono-512.png', 'icono-512-maskable.png'].map(p => new URL(p, SCOPE).href);
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const NET_WAIT = 6000;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async url => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res.ok && !res.redirected) await cache.put(url, res);
      } catch (e) { /* sin red: la navegación la guardará después */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const old = (await caches.keys()).filter(n => n.indexOf(PREFIX) === 0 && n !== CACHE);
    for (const name of old) {
      // Las fuentes no cambian con cada build: pasan a la caché nueva antes de borrar la vieja.
      try {
        const c = await caches.open(name);
        for (const req of await c.keys()) {
          if (FONT_HOSTS.indexOf(new URL(req.url).hostname) < 0 || await cache.match(req)) continue;
          const res = await c.match(req);
          if (res) await cache.put(req, res);
        }
      } catch (e) { /* se vuelven a descargar cuando haya red */ }
      await caches.delete(name);
    }
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (e) { /* opcional */ } }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'version' && event.source) event.source.postMessage({ version: VERSION, cache: CACHE });
});

const isIndex = url => url.pathname === SCOPE_PATH || url.pathname === SCOPE_PATH + 'index.html';

function offline() {
  return new Response('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión</title>' +
    '<p style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;padding:24px;max-width:36em">Sin conexión. El Estudio financiero se guardará en este dispositivo la próxima vez que lo abras con internet.</p></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function networkFirst(event, req, url) {
  const cache = await caches.open(CACHE);
  const key = isIndex(url) ? INDEX : url.href;
  const net = (async () => {
    let res = null;
    if (req.mode === 'navigate' && event.preloadResponse) { try { res = await event.preloadResponse; } catch (e) { res = null; } }
    if (!res) res = await fetch(req);
    if (res.ok && res.type === 'basic' && !res.redirected) event.waitUntil(cache.put(key, res.clone()).catch(() => {}));
    return res;
  })();
  event.waitUntil(net.catch(() => null));
  const cached = (await cache.match(key, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match(INDEX) : null);
  if (!cached) { try { return await net; } catch (e) { return offline(); } }
  // Con copia guardada, la red tiene unos segundos para responder; si no, se usa la copia.
  return new Promise(resolve => {
    let done = false;
    const end = r => { if (!done) { done = true; clearTimeout(t); resolve(r); } };
    const t = setTimeout(() => end(cached), NET_WAIT);
    net.then(res => end(res.ok || res.type === 'opaqueredirect' ? res : cached), () => end(cached));
  });
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.href.indexOf(SCOPE) === 0 &&
      (req.mode === 'navigate' || isIndex(url) || /\.html$/.test(url.pathname))) {
    event.respondWith(networkFirst(event, req, url));
  } else if (FONT_HOSTS.indexOf(url.hostname) >= 0 ||
      (url.origin === self.location.origin && url.href.indexOf(SCOPE) === 0 && /\.(png|ico|svg|webp|jpe?g|woff2?|webmanifest)$/.test(url.pathname))) {
    event.respondWith(cacheFirst(req));
  }
});

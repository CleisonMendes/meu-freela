/* Meu Freela PWA: cache somente de recursos estáticos versionados.
 * Nunca guarde HTML autenticado, APIs, Supabase, requisições POST ou dados financeiros.
 */
const CACHE_NAME = "meu-freela-static-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("meu-freela-") && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navegações sempre procuram uma página atual. Offline: aviso, sem dados privados.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(OFFLINE_URL)) || Response.error();
    }));
    return;
  }

  // Cache limitado a arquivos imutáveis de build do Vite (nomes com hash).
  // Não cacheia /auth, /api, /functions, HTML ou dados dinâmicos.
  const isBuildAsset = /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.(js|css|woff2?|png|svg|webp)$/.test(url.pathname);
  if (!isBuildAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});

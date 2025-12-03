

const CACHE_NAME = 'letter-loom-cache-v3';
const BASE_PATH = self.location.pathname.replace(/\/[^/]*$/, '/');
const VERSION_JS = BASE_PATH + 'src/version.js';


self.addEventListener('install', event => {
  // No se hace pre-cache de una lista, se cachea bajo demanda en fetch
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Siempre tratar de obtener version.js online primero
  if (url.pathname === VERSION_JS || url.href === self.location.origin + VERSION_JS) {
    event.respondWith(
      fetch(event.request)
        .then(async response => {
          // Solo se puede consumir el body una vez, así que leemos el texto y creamos un nuevo Response
          const onlineText = await response.text();
          const newResponse = new Response(onlineText, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(event.request);
          if (cached) {
            const cachedText = await cached.text();
            if (onlineText !== cachedText) {
              await cache.put(event.request, newResponse.clone());
              // Notifica a los clientes para recargar
              self.clients.matchAll().then(clients => {
                clients.forEach(client => client.postMessage({ type: 'refresh' }));
              });
            }
          } else {
            await cache.put(event.request, newResponse.clone());
          }
          return newResponse;
        })
        .catch(async () => {
          // Si falla online, usa la cache
          const cache = await caches.open(CACHE_NAME);
          return cache.match(event.request);
        })
    );
    return;
  }

  // Cache first para todo lo local (mismo origen y bajo BASE_PATH), excepto version.js
  if (
    url.origin === self.location.origin &&
    url.pathname.startsWith(BASE_PATH) &&
    url.pathname !== VERSION_JS
  ) {
    event.respondWith(
      caches.match(event.request).then(response => {
        return (
          response || fetch(event.request).then(fetchRes => {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, fetchRes.clone());
            });
            return fetchRes;
          })
        );
      })
    );
    return;
  }

  // Para otros requests (APIs externas, analytics, etc), no cachear
});
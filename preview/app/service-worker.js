const CACHE_NAME = "letter-loom-cache-v1";
const BASE_PATH = self.location.pathname.replace(/\/[^/]*$/, "/");
const VERSION_JS = `${BASE_PATH}src/core/version.js`;
const LOG_CHANNEL_NAME = "app-logs";
const logChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(LOG_CHANNEL_NAME) : null;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  logSw("info", "Service worker installed");
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
  logSw("info", "Service worker activated");
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname === VERSION_JS || url.href === self.location.origin + VERSION_JS) {
    logSw("debug", "Intercepting version.js request");
    event.respondWith(handleVersionRequest(event.request));
    return;
  }

  if (
    url.origin === self.location.origin &&
    url.pathname.startsWith(BASE_PATH) &&
    url.pathname !== VERSION_JS
  ) {
    event.respondWith(cacheFirst(event.request));
    return;
  }
});

async function handleVersionRequest(request) {
  try {
    const response = await fetch(request);
    const text = await response.clone().text();
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const cachedText = cached ? await cached.text() : null;
    if (text !== cachedText) {
      await cache.put(request, response.clone());
      notifyClients({ type: "refresh" });
      logSw("info", "version.js changed, notified clients");
    }
    return response;
  } catch (err) {
    const cache = await caches.open(CACHE_NAME);
    const fallback = await cache.match(request);
    if (fallback) return fallback;
    logSw("error", "version.js fetch failed and no cache", err);
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    logSw("debug", "Serving from cache", { url: request.url });
    return cached;
  }
  const response = await fetch(request);
  cache.put(request, response.clone());
  logSw("debug", "Cached new response", { url: request.url });
  return response;
}

function notifyClients(message) {
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => client.postMessage(message));
  });
}

function logSw(level, message, context) {
  const entry = {
    type: "log-entry",
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    time: Date.now(),
    level,
    message,
    context: context || null,
    source: "sw",
  };
  if (logChannel) {
    logChannel.postMessage(entry);
  }
  const consoleMethod = level === "error" ? "error" : level === "warn" ? "warn" : "log";
  console[consoleMethod](`[SW][${level.toUpperCase()}] ${message}`, context || "");
}

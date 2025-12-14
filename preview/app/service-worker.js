const CACHE_PREFIX = "letter-loom-cache";
let cacheVersion = "v0";
let CACHE_NAME = `${CACHE_PREFIX}-${cacheVersion}`;
const BASE_PATH = self.location.pathname.replace(/\/[^/]*$/, "/");
const VERSION_JS = `${BASE_PATH}src/core/version.js`;
const DEV_BYPASS_CACHE = true; // set to false when you want caching during local dev
const IS_LOCAL = self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";
const LOG_CHANNEL_NAME = "app-logs";
const logChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(LOG_CHANNEL_NAME) : null;
const cacheReady = resolveCacheVersion();

self.addEventListener("install", (event) => {
  event.waitUntil(
    cacheReady
      .catch(() => {})
      .finally(() => {
        self.skipWaiting();
        logSw("info", `Service worker installed (cache ${CACHE_NAME})`);
      })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    cacheReady
      .catch(() => {})
      .then(() =>
        caches.keys().then((keys) =>
          Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
      )
      .then(() => notifyClients({ type: "refresh" }))
  );
  self.clients.claim();
  logSw("info", `Service worker activated (cache ${CACHE_NAME})`);
});

self.addEventListener("fetch", (event) => {
  if (IS_LOCAL && DEV_BYPASS_CACHE) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

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
    const response = await fetch(request, { cache: "no-store" });
    const text = await response.clone().text();
    const cache = await caches.open(CACHE_NAME);
    const cacheKey = new Request(VERSION_JS);
    const cached = await cache.match(cacheKey);
    const cachedText = cached ? await cached.text() : null;
    if (cachedText === null) {
      await cache.put(cacheKey, response.clone());
      logSw("debug", "version.js cached for the first time");
    } else if (text !== cachedText) {
      await cache.put(cacheKey, response.clone());
      notifyClients({ type: "refresh" });
      logSw("info", "version.js changed, notified clients");
    } else {
      logSw("debug", "version.js unchanged");
    }
    return response;
  } catch (err) {
    const cache = await caches.open(CACHE_NAME);
    const fallback = await cache.match(new Request(VERSION_JS));
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
  const response = await fetch(request, { cache: "no-store" });
  if (response.ok && response.status === 200) {
    cache.put(request, response.clone());
    logSw("debug", "Cached new response", { url: request.url });
  } else {
    logSw("warn", "Skipping cache put (non-200 response)", {
      url: request.url,
      status: response.status,
    });
  }
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

async function resolveCacheVersion() {
  try {
    const res = await fetch(VERSION_JS, { cache: "no-store" });
    const text = await res.text();
    const match = text.match(/APP_VERSION\s*=\s*"([^"]+)"/);
    if (match && match[1]) {
      cacheVersion = match[1];
      CACHE_NAME = `${CACHE_PREFIX}-${cacheVersion}`;
      logSw("debug", `Cache version resolved: ${CACHE_NAME}`);
    }
  } catch (err) {
    logSw("warn", "Could not resolve cache version from version.js; using default", err);
  }
}

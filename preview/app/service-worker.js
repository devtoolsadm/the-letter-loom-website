const CACHE_PREFIX = "letter-loom-cache";
const APP_VERSION = "v0.0.102";
let cacheVersion = APP_VERSION;
let CACHE_NAME = `${CACHE_PREFIX}-${cacheVersion}`;
const BASE_PATH = self.location.pathname.replace(/\/[^/]*$/, "/");
const VERSION_JS = `${BASE_PATH}src/core/version.js`;
const DEV_BYPASS_CACHE = true; // set to true only for bypass during local dev
const IS_LOCAL = self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";
const LOG_CHANNEL_NAME = "app-logs";
const SW_DEBUG = false;
const logChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(LOG_CHANNEL_NAME) : null;
const cacheReady = resolveCacheVersion();
const PRECACHE_ASSETS = [
  `${BASE_PATH}`,
  `${BASE_PATH}assets/img/1x1-transparent.png`,  
  `${BASE_PATH}index.html`,
  `${BASE_PATH}manifest.json`,
  `${BASE_PATH}manifest-en.json`,
  `${BASE_PATH}manifest-es.json`,
  `${BASE_PATH}src/ui/shell/main.js`,
  `${BASE_PATH}src/ui/shell/modal.js`,
  `${BASE_PATH}src/styles/shell.css`,
  `${BASE_PATH}src/styles/modal.css`,
  `${BASE_PATH}src/i18n/texts.js`,
  `${BASE_PATH}src/core/version.js`,
  `${BASE_PATH}assets/img/background.png`,
  `${BASE_PATH}assets/img/logo-letters.png`,
  `${BASE_PATH}assets/img/rotate-device-icon.png`,
  `${BASE_PATH}assets/img/empty-video.mp4`,
  `${BASE_PATH}assets/img/audioOn.svg`,
  `${BASE_PATH}assets/img/audioOff.svg`,
  `${BASE_PATH}assets/img/musicOn.svg`,
  `${BASE_PATH}assets/img/musicOff.svg`,
  `${BASE_PATH}assets/img/button.svg`,
  `${BASE_PATH}assets/img/settings.svg`,
  `${BASE_PATH}assets/img/exit.svg`,
  `${BASE_PATH}assets/img/help.svg`,
  `${BASE_PATH}assets/img/previous.svg`,
  `${BASE_PATH}assets/img/shop.svg`,
  `${BASE_PATH}assets/img/languages.png`,
  `${BASE_PATH}assets/img/record.svg`,
  `${BASE_PATH}assets/img/winner.svg`,
  `${BASE_PATH}assets/img/winner-button.svg`,
  `${BASE_PATH}assets/img/leader.svg`,
  `${BASE_PATH}assets/img/rules.svg`,
  `${BASE_PATH}assets/img/instagram.svg`,
  `${BASE_PATH}assets/img/tiktok.svg`,
  `${BASE_PATH}assets/img/www.svg`,
  `${BASE_PATH}assets/img/email.svg`,
  `${BASE_PATH}assets/img/icon-192.png`,
  `${BASE_PATH}assets/img/icon-512.png`,
  `${BASE_PATH}assets/img/icon-192-preview.png`,
  `${BASE_PATH}assets/img/icon-512-preview.png`,
  `${BASE_PATH}assets/ui-pack/Icons/SVG/Icon_Small_Blank_Arrow.svg`,
  `${BASE_PATH}assets/ui-pack/Icons/SVG/Icon_Small_Blank_Pause.svg`,
  `${BASE_PATH}assets/ui-pack/Icons/SVG/Icon_Small_Blank_Return.svg`,
  `${BASE_PATH}assets/ui-pack/Icons/SVG/Icon_Small_Blank_Check.svg`,
  `${BASE_PATH}assets/ui-pack/Icons/SVG/Icon_Small_Blank_Audio.svg`,
  `${BASE_PATH}assets/ui-pack/Icons/SVG/Icon_Small_Blank_Music.svg`,
  `${BASE_PATH}assets/ui-pack/Icons/SVG/Icon_Small_Blank_AudioOff.svg`,
  `${BASE_PATH}assets/ui-pack/Icons/SVG/Icon_Small_Blank_MusicOff.svg`,
  `${BASE_PATH}assets/ui-pack/Icons/SVG/Icon_Small_Blank_X.svg`,
  `${BASE_PATH}assets/sounds/intro.wav`,
  `${BASE_PATH}assets/sounds/click.mp3`,
  `${BASE_PATH}assets/sounds/clock-melody.mp3`,
  `${BASE_PATH}assets/sounds/tick.mp3`,
  `${BASE_PATH}assets/sounds/time.mp3`,
  `${BASE_PATH}assets/sounds/open.mp3`,
  `${BASE_PATH}assets/sounds/success.mp3`,
  `${BASE_PATH}assets/sounds/fail.mp3`,
  `${BASE_PATH}assets/js/pwa-install.bundle.js`,
  `${BASE_PATH}assets/doc/manual.pdf`,
  `${BASE_PATH}assets/fonts/Bangers-Regular.woff2`,
  `${BASE_PATH}assets/fonts/Fredoka-Regular.woff2`,
  `${BASE_PATH}assets/fonts/Fredoka-SemiBold.woff2`,
  `${BASE_PATH}assets/fonts/Fredoka-Bold.woff2`,
  `${BASE_PATH}assets/fonts/Montserrat-Black.woff2`,
];
const CRITICAL_ASSETS = [
  `${BASE_PATH}index.html`,
  `${BASE_PATH}src/ui/shell/main.js`,
  `${BASE_PATH}src/styles/shell.css`,
  `${BASE_PATH}src/ui/shell/modal.js`,
  `${BASE_PATH}src/styles/modal.css`,
  `${BASE_PATH}src/i18n/texts.js`,
];

async function precacheAssets(cache, { skipVersion = false } = {}) {
  const assets = skipVersion
    ? PRECACHE_ASSETS.filter((url) => url !== VERSION_JS)
    : PRECACHE_ASSETS;
  await Promise.allSettled(
    assets.map(async (url) => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
          logSw("warn", "Precache skipped (non-200 response)", {
            url,
            status: response.status,
          });
          return;
        }
        await cache.put(url, response.clone());
      } catch (err) {
        logSw("warn", "Precache failed", { url, err });
      }
    })
  );
}

async function rotateCacheVersion(newVersion, versionResponse) {
  const previousCache = CACHE_NAME;
  const previousVersion = cacheVersion;
  const nextCacheName = `${CACHE_PREFIX}-${newVersion}`;
  const cache = await caches.open(nextCacheName);
  await cache.put(new Request(VERSION_JS), versionResponse.clone());
  await precacheAssets(cache, { skipVersion: true });

  const ready = await hasCriticalAssets(cache);
  if (!ready) {
    cacheVersion = previousVersion;
    CACHE_NAME = previousCache;
    logSw("warn", `Cache rotation aborted; critical assets missing in ${nextCacheName}`);
    return;
  }

  cacheVersion = newVersion;
  CACHE_NAME = nextCacheName;
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
  logSw("info", `Cache rotated from ${previousCache} to ${CACHE_NAME}`);
}

if (IS_LOCAL && DEV_BYPASS_CACHE) {
  logSw("info", "Development mode: cache bypass enabled");
}
logSw("info", `Service worker starting (isLocal: ${IS_LOCAL}, hostname: ${self.location.hostname}, base path: ${BASE_PATH})`);

self.addEventListener("install", (event) => {
  event.waitUntil(
    cacheReady
      .catch(() => {})
      .then(async () => {
        if (IS_LOCAL && DEV_BYPASS_CACHE) return;
        const cache = await caches.open(CACHE_NAME);
        await precacheAssets(cache);
      })
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
        caches.keys().then((keys) => {
          if (!keys.includes(CACHE_NAME)) return;
          return Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
        })
      )
      .then(() => notifyClients({ type: "refresh" }))
  );
  self.clients.claim();
  logSw("info", `Service worker activated (cache ${CACHE_NAME})`);
});

self.addEventListener("message", (event) => {
  if (event?.data?.type === "get-sw-version") {
    const payload = { type: "sw-version", version: APP_VERSION, cache: CACHE_NAME };
    if (event.source && typeof event.source.postMessage === "function") {
      event.source.postMessage(payload);
    } else {
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => client.postMessage(payload));
      });
    }
  }
  if (event?.data?.type === "skip-waiting") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (IS_LOCAL && DEV_BYPASS_CACHE) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  const url = new URL(event.request.url);

  // App shell fallback for navigations
  if (event.request.mode === "navigate" || event.request.destination === "document") {
    event.respondWith(
      (async () => {
        await cacheReady.catch(() => {});
        const cached = await matchAppShell();
        if (cached) return cached;
        try {
          const resp = await fetch(event.request);
          return resp;
        } catch (err) {
          return cached || Response.error();
        }
      })()
    );
    return;
  }

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
  await cacheReady.catch(() => {});
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = new Request(VERSION_JS);
  const cached = await cache.match(cacheKey);
  const isOffline =
    typeof self.navigator !== "undefined" && self.navigator.onLine === false;
  if (isOffline && cached) {
    logSw("info", "version.js served from cache (offline)");
    return cached;
  }
  try {
    const response = await fetch(request, { cache: "no-store" });
    const text = await response.clone().text();
    const cachedText = cached ? await cached.clone().text() : null;
    const match = text.match(/APP_VERSION\\s*=\\s*\"([^\"]+)\"/);
    const newVersion = match && match[1] ? match[1] : null;
    if (cachedText === null) {
      if (newVersion && newVersion !== cacheVersion) {
        await rotateCacheVersion(newVersion, response.clone());
        logSw("info", "version.js cached and cache rotated");
      } else {
        await cache.put(cacheKey, response.clone());
        logSw("debug", "version.js cached for the first time");
      }
    } else if (text !== cachedText) {
      if (newVersion && newVersion !== cacheVersion) {
        await rotateCacheVersion(newVersion, response.clone());
      } else {
        await cache.put(cacheKey, response.clone());
      }
      notifyClients({ type: "refresh" });
      if (newVersion && newVersion !== cacheVersion) {
        logSw("info", `version.js changed (${newVersion}); cache rotated and clients notified`);
      } else if (!newVersion) {
        logSw("warn", "version.js changed but no APP_VERSION found; cache not rotated");
      } else {
        logSw("info", "version.js changed, notified clients");
      }
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
  await cacheReady.catch(() => {});
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    logSw("debug", "Serving from cache", { url: request.url });
    return cached;
  }
  try {
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
  } catch (err) {
    logSw("warn", "Network fetch failed, no cache available", { url: request.url, err });
    if (cached) return cached;
    throw err;
  }
}

async function hasCriticalAssets(cache) {
  for (const url of CRITICAL_ASSETS) {
    const hit = await cache.match(url);
    if (!hit) return false;
  }
  return true;
}

async function matchAppShell() {
  const candidates = [`${BASE_PATH}index.html`, `${BASE_PATH}`];
  try {
    const cache = await caches.open(CACHE_NAME);
    for (const url of candidates) {
      const hit = await cache.match(url, { ignoreSearch: true });
      if (hit) return hit;
    }
  } catch {}
  try {
    const keys = await caches.keys();
    for (const key of keys) {
      if (key === CACHE_NAME) continue;
      const cache = await caches.open(key);
      for (const url of candidates) {
        const hit = await cache.match(url, { ignoreSearch: true });
        if (hit) return hit;
      }
    }
  } catch {}
  return null;
}

function notifyClients(message) {
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => client.postMessage(message));
  });
}

function logSw(level, message, context) {
  if (level === "debug" && !SW_DEBUG) return;
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
    const keys = await caches.keys();
    const candidates = keys.filter((key) => key.startsWith(`${CACHE_PREFIX}-`));
    if (!candidates.length) return;
    for (const key of candidates) {
      const cache = await caches.open(key);
      const cached = await cache.match(new Request(VERSION_JS));
      if (!cached) continue;
      const text = await cached.text();
      const match = text.match(/APP_VERSION\s*=\s*"([^"]+)"/);
      if (match && match[1]) {
        cacheVersion = match[1];
        CACHE_NAME = `${CACHE_PREFIX}-${cacheVersion}`;
        logSw("debug", `Cache version resolved from cache: ${CACHE_NAME}`);
        return;
      }
      CACHE_NAME = key;
      logSw("debug", `Cache version resolved from cache key: ${CACHE_NAME}`);
      return;
    }
  } catch (err) {
    logSw("warn", "Could not resolve cache version from cache; using default", err);
  }
}

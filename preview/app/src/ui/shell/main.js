import { TEXTS, resolveShellLanguage } from "../../i18n/texts.js";
import {
  initWakeLockManager,
  requestLock,
  releaseLock,
} from "../../core/wakeLockManager.js";
import { APP_VERSION } from "../../core/version.js";
import { logger, onLog, getLogs } from "../../core/logger.js";

const urlParams = new URLSearchParams(window.location.search);
const fromPWA = urlParams.get("fromPWA") === "1";
const fromInstall = urlParams.get("fromInstall") === "1";
const shellLanguage = resolveShellLanguage();
const shellTexts = TEXTS[shellLanguage];
let installButtonEl = null;

document.title = shellTexts.prototypeTitle;

function applyPrototypeTexts() {
  const year = new Date().getFullYear();
  const mappings = [
    ["gameHeader", "prototypeTitle"],
    ["prototype-title", "prototypeTitle"],
    ["prototype-subtitle", "prototypeHeroSubtitle"],
  ];
  mappings.forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = shellTexts[key];
  });

  const description = document.getElementById("prototype-description");
  if (description) {
    description.innerHTML = shellTexts.prototypeHeroDescription;
  }
  const orientationMessage = document.getElementById("orientation-message");
  if (orientationMessage) {
    orientationMessage.innerHTML = shellTexts.prototypeOrientationMessage;
  }
  const wakeBtn = document.getElementById("wakeLockBtn");
  if (wakeBtn) {
    wakeBtn.textContent = shellTexts.prototypeEnableWakeLock;
  }
  const footer = document.getElementById("gameFooter");
  if (footer) {
    footer.textContent = shellTexts.prototypeFooter.replace("{year}", year);
  }
  const videoFallback = document.getElementById("video-fallback-text");
  if (videoFallback) {
    videoFallback.textContent = shellTexts.prototypeVideoFallback;
  }
  const loremShort = document.getElementById("lorem-normal");
  if (loremShort) loremShort.textContent = shellTexts.prototypeLoremShort;
  const loremLong = document.getElementById("lorem-huge");
  if (loremLong) loremLong.textContent = shellTexts.prototypeLoremLong;
  const toggleLorem = document.getElementById("toggleLoremHugeBtn");
  if (toggleLorem) toggleLorem.textContent = shellTexts.prototypeToggleLorem;
  const toggleHeaderBtn = document.getElementById("toggleHeaderBtn");
  if (toggleHeaderBtn)
    toggleHeaderBtn.textContent = shellTexts.prototypeToggleHeader;
  const toggleFooterBtn = document.getElementById("toggleFooterBtn");
  if (toggleFooterBtn)
    toggleFooterBtn.textContent = shellTexts.prototypeToggleFooter;
}

function preventMobileZoom() {
  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (event) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 350) {
        event.preventDefault();
      }
      lastTouchEnd = now;
    },
    { passive: false }
  );
  ["gesturestart", "gesturechange", "gestureend"].forEach((evt) =>
    document.addEventListener(evt, (e) => e.preventDefault())
  );
}

function setupWakeLock() {
  const videoEl = document.getElementById("videoWakeLockWorkaround");
  const statusEl = document.getElementById("wakeLockStatus");
  const wakeBtn = document.getElementById("wakeLockBtn");
  if (!wakeBtn) return;
  let active = false;
  initWakeLockManager({
    videoEl,
    statusEl,
    messages: {
      activeStandard: shellTexts.wakeLockStatusActiveStandard,
      released: shellTexts.wakeLockStatusReleased,
      activeFallback: shellTexts.wakeLockStatusActiveFallback,
      fallbackFailed: shellTexts.wakeLockStatusFallbackFailed,
      inactive: shellTexts.wakeLockStatusInactive,
    },
  });
  wakeBtn.addEventListener("click", async () => {
    if (!active) {
      await requestLock();
      wakeBtn.textContent = shellTexts.prototypeDisableWakeLock;
      active = true;
      logger.info("Wake lock requested");
    } else {
      await releaseLock();
      wakeBtn.textContent = shellTexts.prototypeEnableWakeLock;
      active = false;
      logger.info("Wake lock released");
    }
  });
}

function setupToggles() {
  const loremBtn = document.getElementById("toggleLoremHugeBtn");
  const loremBlock = document.getElementById("lorem-huge");
  if (loremBtn && loremBlock) {
    loremBtn.addEventListener("click", () => {
      loremBlock.style.display = loremBlock.style.display === "none" ? "" : "none";
    });
  }
  const headerBtn = document.getElementById("toggleHeaderBtn");
  const header = document.getElementById("gameHeader");
  if (headerBtn && header) {
    headerBtn.addEventListener("click", () => {
      header.style.display = header.style.display === "none" ? "" : "none";
    });
  }
  const footerBtn = document.getElementById("toggleFooterBtn");
  const footer = document.getElementById("gameFooter");
  if (footerBtn && footer) {
    footerBtn.addEventListener("click", () => {
      footer.style.display = footer.style.display === "none" ? "" : "none";
    });
  }
}

function isDesktop() {
  return !/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Tablet|Mobile/i.test(
    navigator.userAgent
  );
}

function getGameDimensions() {
  const root = getComputedStyle(document.documentElement);
  return {
    width: parseFloat(root.getPropertyValue("--game-width")),
    height: parseFloat(root.getPropertyValue("--game-height")),
  };
}

function getViewportZoom() {
  if (
    window.visualViewport &&
    typeof window.visualViewport.scale === "number"
  ) {
    return window.visualViewport.scale;
  }
  const { width, height } = getGameDimensions();
  return Math.min(window.innerWidth / width, window.innerHeight / height);
}

function updateScreenInfo() {
  const info = document.getElementById("screen-info");
  if (!info) return;
  const { width, height } = getGameDimensions();
  const zoom = getViewportZoom();
  info.innerHTML = [
    `${shellTexts.prototypeInstalledLabel}: ${isStandaloneApp()}`,
    `${shellTexts.prototypeDisplayModeLabel}: ${getDisplayMode()}`,
    `${shellTexts.prototypeFromPWALabel}: ${fromPWA}`,
    `${shellTexts.prototypeGameLabel}: ${width}x${height}px`,
    `${shellTexts.prototypeDeviceLabel}: ${window.innerWidth}x${window.innerHeight}px`,
    `${shellTexts.prototypeZoomLabel}: ${zoom.toFixed(2)}x`,
  ].join("<br>");
}

function isStandaloneApp() {
  const mode = getDisplayMode();
  return mode === "fullscreen" || mode === "standalone" || window.navigator.standalone === true;
}

function getDisplayMode() {
  if (window.matchMedia) {
    if (window.matchMedia("(display-mode: fullscreen)").matches) return "fullscreen";
    if (window.matchMedia("(display-mode: standalone)").matches) return "standalone";
  }
  return "browser";
}

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function checkOrientationOverlay() {
  updateScreenInfo();
  const overlay = document.getElementById("orientation-overlay");
  const overlayRoot = document.getElementById("orientation-root");
  const gameRoot = document.getElementById("game-root");
  if (!overlay || !overlayRoot || !gameRoot) return;
  const isLandscape = window.innerWidth > window.innerHeight;
  if (isLandscape && !isDesktop()) {
    overlay.classList.add("active");
    overlayRoot.style.display = "flex";
    gameRoot.style.display = "none";
  } else {
    overlay.classList.remove("active");
    overlayRoot.style.display = "none";
    gameRoot.style.display = "flex";
  }
}

function scaleGame() {
  const gameRoot = document.getElementById("game-root");
  const overlayRoot = document.getElementById("orientation-root");
  if (!gameRoot || !overlayRoot) return;
  const { width, height } = getGameDimensions();
  const { innerWidth: w, innerHeight: h } = window;
  const scale = Math.min(w / width, h / height);
  gameRoot.style.transform = `scale(${scale})`;
  gameRoot.style.left = `${(w - width * scale) / 2}px`;
  gameRoot.style.top = `${(h - height * scale) / 2}px`;

  const overlayWidth = height;
  const overlayHeight = width;
  const scaleOverlay = Math.min(w / overlayWidth, h / overlayHeight);
  overlayRoot.style.transform = `scale(${scaleOverlay})`;
  overlayRoot.style.left = `${(w - overlayWidth * scaleOverlay) / 2}px`;
  overlayRoot.style.top = `${(h - overlayHeight * scaleOverlay) / 2}px`;

  checkOrientationOverlay();
}

function bootstrapShell() {
  logger.info(`App version ${APP_VERSION}`);
  applyPrototypeTexts();
  preventMobileZoom();
  fetchVersionFile();
  setupWakeLock();
  setupToggles();
  setupDebugPanel();
  setupInstallFlow();
  scaleGame();
  window.addEventListener("resize", scaleGame);
  window.addEventListener("orientationchange", scaleGame);
  registerServiceWorker();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrapShell);
} else {
  bootstrapShell();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register("service-worker.js")
    .then(() => logger.info("Service worker registered"))
    .catch((err) => logger.error("Service worker registration failed", err));
}

function setupDebugPanel() {
  const container = document.createElement("div");
  container.className = "debug-container";

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "debug-toggle";
  toggleBtn.textContent = isPreviewEnv() ? `Logs · ${APP_VERSION}` : "Logs";

  const panel = document.createElement("div");
  panel.className = "debug-panel hidden";
  const title = document.createElement("h3");
  title.textContent = "Debug Log";
  const list = document.createElement("div");
  panel.appendChild(title);
  panel.appendChild(list);

  container.appendChild(toggleBtn);
  container.appendChild(panel);
  document.body.appendChild(container);

  toggleBtn.addEventListener("click", () => {
    panel.classList.toggle("hidden");
  });

  function render() {
    const entries = getLogs();
    list.innerHTML = "";
    entries.forEach((entry) => {
      const item = document.createElement("div");
      item.className = "debug-log-entry";
      item.innerHTML = `<div><strong>[${entry.level.toUpperCase()}]</strong> ${entry.message}</div>
        <div class="meta">${new Date(entry.time).toLocaleTimeString()} · ${entry.source.toUpperCase()}</div>`;
      list.appendChild(item);
    });
    list.scrollTop = list.scrollHeight;
  }

  render();
  onLog(() => render());
  updateDebugScale(container);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => updateDebugScale(container));
  }
  window.addEventListener("resize", () => updateDebugScale(container));
}

function fetchVersionFile() {
  fetch("src/core/version.js", { cache: "no-store" }).catch((err) =>
    logger.warn("Version file fetch failed", err)
  );
}

function isPreviewEnv() {
  return window.location.pathname.startsWith("/preview");
}

function updateDebugScale(container) {
  const vpScale =
    (window.visualViewport && window.visualViewport.scale) ||
    (window.devicePixelRatio ? 1 / window.devicePixelRatio : 1);
  const effective = vpScale && vpScale !== 1 ? vpScale : 1;
  container.style.transform = `scale(${1 / effective})`;
}

function setupInstallFlow() {
  if (isStandaloneApp() || fromPWA) return;
  const panel = document.querySelector(".demo-panel");
  if (!panel) return;

  const pwaEl = document.querySelector("pwa-install") || document.createElement("pwa-install");
  pwaEl.setAttribute("manifest-url", "manifest.json");
  pwaEl.setAttribute("lang", shellLanguage);
  if (!pwaEl.isConnected) document.body.appendChild(pwaEl);

  const installBtn = document.createElement("button");
  installBtn.type = "button";
  installBtn.className = "demo-btn";
  installBtn.textContent = shellTexts.installButtonText;
  installBtn.addEventListener("click", () => triggerPwaInstall(pwaEl));
  panel.insertBefore(installBtn, panel.firstChild);
  installButtonEl = installBtn;
  updateInstallButtonVisibility();

  window.addEventListener("appinstalled", () => updateInstallButtonVisibility());
  window.matchMedia &&
    window.matchMedia("(display-mode: standalone)").addEventListener("change", updateInstallButtonVisibility);

  if (fromInstall) {
    logger.info("fromInstall detected; opening pwa-install dialog");
    triggerPwaInstall(pwaEl, true);
  }
}

function triggerPwaInstall(pwaEl, force = false) {
  if (!pwaEl) {
    logger.warn("pwa-install element not ready");
    return;
  }
  const promptFn =
    typeof pwaEl.openPrompt === "function"
      ? pwaEl.openPrompt
      : typeof pwaEl.prompt === "function"
      ? pwaEl.prompt
      : typeof pwaEl.showDialog === "function"
      ? pwaEl.showDialog
      : null;
  if (!promptFn) {
    logger.warn("pwa-install prompt not available");
    return;
  }
  try {
    const result =
      promptFn === pwaEl.showDialog ? promptFn.call(pwaEl, true) : promptFn.call(pwaEl);
    if (result && typeof result.then === "function") {
      result
        .then((outcome) => logger.info(`Install choice: ${outcome}`))
        .catch((err) => logger.warn("Install prompt failed", err));
    }
  } catch (err) {
    logger.warn("Install prompt failed", err);
  }
}

function updateInstallButtonVisibility() {
  if (!installButtonEl) return;
  const hidden = isStandaloneApp() || fromPWA;
  installButtonEl.style.display = hidden ? "none" : "";
}

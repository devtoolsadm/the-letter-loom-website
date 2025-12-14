import {
  TEXTS,
  getShellLanguage,
  setShellLanguage,
  onShellLanguageChange,
  getAvailableLanguages,
} from "../../i18n/texts.js";
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

let shellLanguage = getShellLanguage();
let shellTexts = TEXTS[shellLanguage];
let installButtonEl = null;
let pwaInstallEl = null;
let wakeLockActive = false;
let unsubscribeLanguage = null;
let currentScreen = "splash";
let soundOn = true;
let splashLoaderInterval = null;
let splashLoaderComplete = false;
let splashLoaderProgress = 0;
let hasScaledOnce = false;
let installedAppDetected = false;

document.title = "Letter Loom";

function renderShellTexts() {
  const year = new Date().getFullYear();
  setText("appTitle", shellTexts.appTitle);
  setText("gameFooter", shellTexts.footer?.replace("{year}", year) || `© ${year} Letter Loom`);

  setText("splashTitle", shellTexts.splashTitle);
  setText("splashSubtitle", shellTexts.splashSubtitle);
  setText("splashContinueBtn", shellTexts.splashContinue);
  setText("resumeMatchBtn", shellTexts.splashResume);
  setText("installAppBtn", shellTexts.installButtonText);
  setText("splashHelpBtn", shellTexts.splashHelp);
  setText("splashLoaderLabel", shellTexts.splashLoadingLabel || "Cargando...");

  setText("setupTitle", shellTexts.setupTitle);
  setText("setupSubtitle", shellTexts.setupSubtitle);
  setText("playersTitle", shellTexts.playersTitle);
  setText("addPlayerBtn", shellTexts.addPlayer);
  setText("timersTitle", shellTexts.timersTitle);
  setText("strategyTimerLabel", shellTexts.strategyTimerLabel);
  setText("creationTimerLabel", shellTexts.creationTimerLabel);
  setText("startGameBtn", shellTexts.startGame);

  setText("liveTitle", shellTexts.liveTitle);
  setText("phaseTitle", shellTexts.phaseTitle);
  setText("strategyPhaseLabel", shellTexts.strategyPhaseLabel);
  setText("creationPhaseLabel", shellTexts.creationPhaseLabel);
  setText("startStrategyBtn", shellTexts.startStrategy);
  setText("startCreationBtn", shellTexts.startCreation);
  setText("goToScoringBtn", shellTexts.goToScoring);

  setText("scoringTitle", shellTexts.scoringTitle);
  setText("scoringNote", shellTexts.scoringNote);
  setText("saveBazaBtn", shellTexts.saveBaza);
  setText("editHistoryBtn", shellTexts.editHistory);

  setText("historyTitle", shellTexts.historyTitle);
  setText("backToLiveBtn", shellTexts.backToLive);

  updateInstallCopy();
  renderLanguageSelector();
  updateSoundToggle();
  updateLanguageButton();
  updateInstallButtonVisibility();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el && typeof value === "string") {
    el.textContent = value;
  }
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
  if (window.visualViewport && typeof window.visualViewport.scale === "number") {
    return window.visualViewport.scale;
  }
  const { width, height } = getGameDimensions();
  return Math.min(window.innerWidth / width, window.innerHeight / height);
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

function switchLanguage(nextLang) {
  if (!TEXTS[nextLang] || nextLang === shellLanguage) return;
  shellLanguage = setShellLanguage(nextLang);
}

function renderLanguageSelector() {
  const select = document.getElementById("languageSelect");
  if (!select) return;
  select.innerHTML = "";
  getAvailableLanguages().forEach((code) => {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = getLanguageName(code);
    select.appendChild(option);
  });
  select.value = shellLanguage;
  buildLanguageDropdown(select);
}

function setupLanguageSelector() {
  const select = document.getElementById("languageSelect");
  const btn = document.getElementById("languageButton");
  const control = document.getElementById("langControl");
  const dropdown = document.getElementById("languageDropdown");
  if (!select || !btn || !control || !dropdown) return;
  renderLanguageSelector();
  select.addEventListener("change", (evt) => {
    const targetLang = evt.target.value;
    switchLanguage(targetLang);
    closeLanguageDropdown();
  });

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleLanguageDropdown();
  });

  dropdown.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", (e) => {
    if (!control.contains(e.target)) {
      closeLanguageDropdown();
    }
  });
}

function buildLanguageDropdown(select) {
  const dropdown = document.getElementById("languageDropdown");
  if (!dropdown || !select) return;
  dropdown.innerHTML = "";
  Array.from(select.options).forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = opt.textContent;
    btn.dataset.value = opt.value;
    btn.className = opt.value === shellLanguage ? "active" : "";
    btn.addEventListener("click", () => {
      switchLanguage(opt.value);
      closeLanguageDropdown();
    });
    dropdown.appendChild(btn);
  });
}

function toggleLanguageDropdown(force) {
  const control = document.getElementById("langControl");
  const dropdown = document.getElementById("languageDropdown");
  const btn = document.getElementById("languageButton");
  if (!control || !dropdown || !btn) return;
  const shouldOpen =
    typeof force === "boolean" ? force : !control.classList.contains("open");
  control.classList.toggle("open", shouldOpen);
  dropdown.hidden = !shouldOpen;
  btn.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

function closeLanguageDropdown() {
  toggleLanguageDropdown(false);
}

function getLanguageName(code) {
  return (TEXTS[code] && TEXTS[code].languageName) || code.toUpperCase();
}

function checkOrientationOverlay() {
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
  const maxScale = 1; //0.99;
  const scale = Math.min(w / width, h / height, maxScale);
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
  if (!hasScaledOnce) {
    hasScaledOnce = true;
    document.body.classList.add("shell-ready");
  }
}

function setupNavigation() {
  const map = [
    ["splashContinueBtn", () => showScreen("setup")],
    ["resumeMatchBtn", () => showScreen("setup")],
    ["splashHelpBtn", () => showScreen("history")],
    ["startGameBtn", () => showScreen("live")],
    ["goToScoringBtn", () => showScreen("scoring")],
    ["saveBazaBtn", () => showScreen("live")],
    ["editHistoryBtn", () => showScreen("history")],
    ["backToLiveBtn", () => showScreen("live")],
  ];
  map.forEach(([id, handler]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", handler);
  });

  const addPlayerBtn = document.getElementById("addPlayerBtn");
  if (addPlayerBtn) {
    addPlayerBtn.addEventListener("click", () => {
      const list = document.getElementById("playerList");
      if (!list) return;
      const item = document.createElement("li");
      const count = list.children.length + 1;
      item.textContent = `${shellTexts.playerLabel || "Player"} ${count}`;
      list.appendChild(item);
    });
  }

  const soundBtn = document.getElementById("soundToggleBtn");
  if (soundBtn) {
    soundBtn.addEventListener("click", () => {
      soundOn = !soundOn;
      updateSoundToggle();
    });
  }
}

function showScreen(name) {
  currentScreen = name;
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("active", el.id === `screen-${name}`);
  });
  if (name === "live") {
    ensureWakeLock(true);
  } else {
    ensureWakeLock(false);
  }
}

function updateSoundToggle() {
  const btn = document.getElementById("soundToggleBtn");
  if (!btn) return;
  btn.dataset.state = soundOn ? "on" : "off";
  btn.setAttribute("aria-label", soundOn ? shellTexts.soundOn : shellTexts.soundOff);
  btn.textContent = "";
}

function updateLanguageButton() {
  const code = document.getElementById("languageCode");
  if (code) code.textContent = (shellLanguage || "en").toUpperCase();
}

async function ensureWakeLock(shouldLock) {
  if (shouldLock && !wakeLockActive) {
    await requestLock();
    wakeLockActive = true;
  }
  if (!shouldLock && wakeLockActive) {
    await releaseLock();
    wakeLockActive = false;
  }
}

function setupDebugRevealGesture(container) {
  const targets = [document.querySelector(".brand-mark"), document.getElementById("appTitle")].filter(
    Boolean
  );
  if (!targets.length) return;
  let taps = [];
  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    container.style.display = "block";
  };
  const handler = () => {
    const now = Date.now();
    taps = taps.filter((t) => now - t <= 10000);
    taps.push(now);
    if (taps.length >= 5) {
      reveal();
      targets.forEach((el) => el.removeEventListener("click", handler));
    }
  };
  targets.forEach((el) => el.addEventListener("click", handler));
}

function startSplashLoader() {
  if (splashLoaderComplete) return;
  document.body.classList.add("splash-loading");
  const loadingBlock = document.getElementById("splashLoadingBlock");
  const mainBlock = document.getElementById("splashMainContent");
  const bar = document.getElementById("splashLoaderProgress");
  const percent = document.getElementById("splashLoaderPercent");
  if (loadingBlock) loadingBlock.classList.remove("hidden");
  if (mainBlock) mainBlock.classList.add("hidden");

  const updateProgress = (value) => {
    splashLoaderProgress = Math.min(100, Math.max(splashLoaderProgress, value));
    if (bar) bar.style.width = `${splashLoaderProgress}%`;
    if (percent) percent.textContent = `${Math.round(splashLoaderProgress)}%`;
  };

  const tasks = loadSplashAssets();
  const total = tasks.length || 1;
  const minDuration = 2000;
  const start = Date.now();
  let completed = 0;

  const handleComplete = () => {
    completed += 1;
    const next = 5 + (completed / total) * 90;
    updateProgress(next);
  };

  updateProgress(5);
  tasks.forEach((task) =>
    task
      .catch((err) => logger.warn("Splash asset load failed", err))
      .finally(() => handleComplete())
  );

  const finish = () => {
    if (splashLoaderComplete) return;
    splashLoaderComplete = true;
    splashLoaderInterval = null;
    updateProgress(100);
    window.setTimeout(() => {
      document.body.classList.remove("splash-loading");
      document.body.classList.add("splash-ready");
      if (loadingBlock) loadingBlock.classList.add("hidden");
      if (mainBlock) mainBlock.classList.remove("hidden");
    }, 200);
  };

  Promise.allSettled(tasks).finally(() => {
    const elapsed = Date.now() - start;
    const remaining = Math.max(0, minDuration - elapsed);
    window.setTimeout(finish, remaining);
  });
}

function loadSplashAssets() {
  const assets = [
    loadImage("assets/icon-512.png"),
    loadImage("assets/rotate-device-icon.png"),
    fetchWithWarn("manifest.json"),
    fetchWithWarn("src/core/version.js"),
  ];
  return assets;
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

function fetchWithWarn(url) {
  return fetch(url, { cache: "no-store" }).catch((err) => {
    logger.warn(`Splash fetch failed for ${url}`, err);
  });
}

function bootstrapShell() {
  logger.info(`App version ${APP_VERSION}`);
  renderShellTexts();
  setupLanguageSelector();
  setupNavigation();
  if (!unsubscribeLanguage) {
    unsubscribeLanguage = onShellLanguageChange(handleLanguageChange);
    window.addEventListener("beforeunload", () => {
      if (unsubscribeLanguage) unsubscribeLanguage();
      unsubscribeLanguage = null;
    });
  }
  preventMobileZoom();
  fetchVersionFile();
  setupWakeLock();
  setupDebugPanel();
  setupInstallFlow();
  setupServiceWorkerMessaging();
  showScreen("splash");
  startSplashLoader();
  detectInstalledApp().finally(() => updateInstallButtonVisibility());
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
    .then(() => {
      logger.info("Service worker registered");
    })
    .catch((err) => logger.error("Service worker registration failed", err));
}

function setupServiceWorkerMessaging() {
  if (!("serviceWorker" in navigator)) return;
  let reloaded = false;
  const triggerReload = () => {
    if (reloaded) return;
    reloaded = true;
    logger.info("Service worker requested refresh; reloading");
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data && event.data.type === "refresh") {
      triggerReload();
    }
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    triggerReload();
  });
}

function handleLanguageChange(lang) {
  if (!TEXTS[lang]) return;
  shellLanguage = lang;
  shellTexts = TEXTS[shellLanguage];
  renderShellTexts();
}

function setupDebugPanel() {
  const container = document.createElement("div");
  container.className = "debug-container";

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "debug-toggle";
  toggleBtn.textContent = "Logs";

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

  container.style.display = "none";

  toggleBtn.addEventListener("click", () => {
    panel.classList.toggle("hidden");
  });

  setupDebugRevealGesture(container);

  function render() {
    const entries = getLogs();
    list.innerHTML = "";
    entries.forEach((entry) => {
      const item = document.createElement("div");
      item.className = "debug-log-entry";
      item.innerHTML = `<div><strong>[${entry.level.toUpperCase()}]</strong> ${entry.message}</div>
        <div class="meta">${new Date(entry.time).toLocaleTimeString()} - ${entry.source.toUpperCase()}</div>`;
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
  pwaInstallReady
    .then(() => {
      const panel = document.getElementById("screen-splash");
      if (!panel) return;

      const pwaEl = document.querySelector("pwa-install") || document.createElement("pwa-install");
      pwaEl.setAttribute("manifest-url", "manifest.json");
      pwaEl.setAttribute("lang", shellLanguage);
      pwaEl.manualChrome = true;
      pwaEl.manualApple = true;
      const isIOSChrome = isIOS() && /CriOS/i.test(navigator.userAgent);
      if (isIOSChrome) {
        pwaEl.disableChrome = true;
        pwaEl.manualChrome = true;
        pwaEl.disableFallback = false;
      }

      if (!pwaEl.isConnected) document.body.appendChild(pwaEl);

      const installBtn = document.getElementById("installAppBtn");
      if (installBtn) {
        installBtn.addEventListener("click", () => triggerPwaInstall(pwaEl, true));
        installButtonEl = installBtn;
      }
      pwaInstallEl = pwaEl;
      updateInstallCopy();
      updateInstallButtonVisibility();

      window.addEventListener("appinstalled", () => updateInstallButtonVisibility());
      window.matchMedia &&
        window
          .matchMedia("(display-mode: standalone)")
          .addEventListener("change", updateInstallButtonVisibility);

      if (fromInstall) {
        logger.info("fromInstall detected; opening pwa-install dialog");
        triggerPwaInstall(pwaEl, true);
      }
    })
    .catch((err) => logger.warn("pwa-install script not ready", err));
}

async function triggerPwaInstall(pwaEl, force = false) {
  try {
    const element = await waitForPwaInstallElement(pwaEl);
    if (!element) return;

    const promptFn =
      typeof element.openPrompt === "function"
        ? element.openPrompt
        : typeof element.prompt === "function"
        ? element.prompt
        : typeof element.showDialog === "function"
        ? element.showDialog
        : null;

    if (!promptFn) {
      logger.warn("pwa-install prompt not available");
      return;
    }

    const result =
      force && promptFn === element.showDialog
        ? promptFn.call(element, true)
        : promptFn.call(element);

    if (result && typeof result.then === "function") {
      result
        .then((outcome) => logger.info(`Install choice: ${outcome}`))
        .catch((err) => logger.warn("Install prompt failed", err));
    } else if (force && promptFn === element.showDialog) {
      ensureInstallDialogVisible(element);
    }
  } catch (err) {
    logger.warn("Install prompt failed", err);
  }
}

async function waitForPwaInstallElement(pwaEl) {
  if (!pwaEl) {
    logger.warn("pwa-install element not ready");
    return null;
  }
  try {
    if (window.customElements && typeof window.customElements.whenDefined === "function") {
      await window.customElements.whenDefined("pwa-install");
    }
  } catch (err) {
    logger.warn("pwa-install custom element not defined yet", err);
  }
  if (!pwaEl.isConnected) {
    document.body.appendChild(pwaEl);
  }
  const updateReady = pwaEl.updateComplete;
  if (updateReady && typeof updateReady.then === "function") {
    try {
      await updateReady;
    } catch (err) {
      logger.warn("pwa-install update did not complete cleanly", err);
    }
  }
  return pwaEl;
}

function ensureInstallDialogVisible(pwaEl) {
  requestAnimationFrame(() => {
    const dialog =
      pwaEl.shadowRoot && pwaEl.shadowRoot.querySelector("#pwa-install-element");
    const available = dialog && dialog.classList.contains("available");
    if (!available && typeof pwaEl.showDialog === "function") {
      try {
        pwaEl.showDialog(true);
      } catch (err) {
        logger.warn("Secondary attempt to open install dialog failed", err);
      }
    }
  });
}

function updateInstallButtonVisibility() {
  const btn = installButtonEl || document.getElementById("installAppBtn");
  if (!btn) return;
  const hidden = !fromInstall && (isStandaloneApp() || fromPWA || installedAppDetected);
  btn.style.display = hidden ? "none" : "";
}

function updateInstallCopy() {
  if (installButtonEl) {
    installButtonEl.textContent = shellTexts.installButtonText;
  }
  const pwaEl = pwaInstallEl || document.querySelector("pwa-install");
  if (pwaEl) {
    pwaEl.setAttribute("lang", shellLanguage);
    if (shellTexts.installPromptTitle) {
      pwaEl.setAttribute("install-title", shellTexts.installPromptTitle);
    }
    if (shellTexts.installPromptDescription) {
      pwaEl.setAttribute("install-description", shellTexts.installPromptDescription);
    }
  }
}

async function detectInstalledApp() {
  if (installedAppDetected) return true;
  if (isStandaloneApp()) {
    installedAppDetected = true;
    return true;
  }
  if (navigator.getInstalledRelatedApps) {
    try {
      const manifestUrl = new URL("manifest.json", window.location.href).toString();
      const related = await navigator.getInstalledRelatedApps();
      const match = related.some(
        (app) =>
          app.manifestUrl === manifestUrl ||
          (app.manifestUrl && app.manifestUrl.endsWith("/manifest.json"))
      );
      if (match) {
        installedAppDetected = true;
        return true;
      }
    } catch (err) {
      logger.warn("getInstalledRelatedApps failed", err);
    }
  }
  return installedAppDetected;
}

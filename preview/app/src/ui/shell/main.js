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

const LANGUAGE_NAMES = {
  es: "Spanish",
  en: "English",
};

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
  updateWakeLockButtonLabel();
  renderLanguageSelector();
  updateSoundToggle();
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
  const wakeBtn = document.getElementById("wakeLockBtn");
  if (!wakeBtn) return;
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
    if (!wakeLockActive) {
      await requestLock();
      wakeLockActive = true;
      updateWakeLockButtonLabel();
      logger.info("Wake lock requested");
    } else {
      await releaseLock();
      wakeLockActive = false;
      updateWakeLockButtonLabel();
      logger.info("Wake lock released");
    }
  });
}

function updateWakeLockButtonLabel() {
  const wakeBtn = document.getElementById("wakeLockBtn");
  if (!wakeBtn) return;
  wakeBtn.textContent = wakeLockActive
    ? shellTexts.prototypeDisableWakeLock || "Allow sleep"
    : shellTexts.prototypeEnableWakeLock || "Keep awake";
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
    option.textContent = LANGUAGE_NAMES[code] || code;
    select.appendChild(option);
  });
  select.value = shellLanguage;
}

function setupLanguageSelector() {
  const select = document.getElementById("languageSelect");
  if (!select) return;
  renderLanguageSelector();
  select.addEventListener("change", (evt) => {
    const targetLang = evt.target.value;
    switchLanguage(targetLang);
  });
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
}

function updateSoundToggle() {
  const btn = document.getElementById("soundToggleBtn");
  if (!btn) return;
  btn.textContent = soundOn ? shellTexts.soundOn : shellTexts.soundOff;
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
  pwaInstallReady
    .then(() => {
      const panel = document.getElementById("screen-splash");
      if (!panel) return;

      const pwaEl = document.querySelector("pwa-install") || document.createElement("pwa-install");
      pwaEl.setAttribute("manifest-url", "manifest.json");
      pwaEl.setAttribute("lang", shellLanguage);
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
      force && promptFn === pwaEl.showDialog ? promptFn.call(pwaEl, true) : promptFn.call(pwaEl);
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

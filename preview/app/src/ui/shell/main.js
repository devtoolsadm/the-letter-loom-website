import {
  TEXTS,
  getShellLanguage,
  setShellLanguage,
  onShellLanguageChange,
  getAvailableLanguages,
} from "../../i18n/texts.js";
import { openModal, closeModal, closeTopModal } from "./modal.js";
import {
  initWakeLockManager,
  requestLock,
  releaseLock,
} from "../../core/wakeLockManager.js";
import { loadState, updateState } from "../../core/stateStore.js";
import { APP_VERSION } from "../../core/version.js";
import { logger, onLog, getLogs } from "../../core/logger.js";

const urlParams = new URLSearchParams(window.location.search);
const fromPWA = urlParams.get("fromPWA") === "1";
const fromInstall = urlParams.get("fromInstall") === "1";

const appState = loadState();

let shellLanguage = getShellLanguage();
let shellTexts = TEXTS[shellLanguage];
let installButtonEl = null;
let pwaInstallEl = null;
let wakeLockActive = false;
let unsubscribeLanguage = null;
let currentScreen = "splash";
let soundOn = appState.settings.sound ?? true;
let musicOn = appState.settings.music ?? true;
let soundVolume = appState.settings.soundVolume ?? 50;
let musicVolume = appState.settings.musicVolume ?? 50;
let settingsSnapshot = null;
let tempSettings = {
  sound: soundOn,
  music: musicOn,
  soundVolume,
  musicVolume,
  language: shellLanguage,
};
let splashLoaderInterval = null;
let splashLoaderComplete = false;
let splashLoaderProgress = 0;
let hasScaledOnce = false;
let installedAppDetected = false;
let introAudio = null;
let clickAudio = null;
let audioReady = false;
let audioCtx = null;
let musicGain = null;
let soundGain = null;
let musicSource = null;
let clickSource = null;
let wakeLockTimer = null;
const WAKE_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
function playClickSfx() {
  if (!soundOn || !clickAudio) return;
  // If routed through Web Audio, use the shared element with gain; otherwise clone
  if (audioCtx && soundGain && clickSource) {
    soundGain.gain.value = soundVolume / 100;
    try {
      clickAudio.currentTime = 0;
    } catch (e) {}
    clickAudio.play().catch(() => {});
    return;
  }
  const instance = clickAudio.cloneNode();
  instance.volume = (soundVolume / 100) * clickAudio.volume;
  instance.play().catch(() => {});
}
// 1x1 transparent GIF to avoid broken-image icons before real sources are assigned
const PLACEHOLDER_IMG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg==";

document.title = shellTexts.appTitle;;

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
  setText("settingsTitle", shellTexts.settingsTitle);
  setText("settingsSoundLabel", shellTexts.settingsSound);
  setText("settingsMusicLabel", shellTexts.settingsMusic);
  setText("settingsLanguageLabel", shellTexts.settingsLanguage);
  setText("settingsSaveBtn", shellTexts.save);
  setText("supportTitle", shellTexts.supportTitle);
  setText("supportBody", shellTexts.supportBody);
  setText("supportCtaBtn", shellTexts.supportCta);
  
  updateInstallCopy();
  renderLanguageSelector();
  renderSettingsLanguageSelector();
  updateManifestLink();
  updateSoundToggle();
  updateSettingsControls();
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

function preventRightClick() {
  document.addEventListener("contextmenu", (e) => e.preventDefault());
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
  if (!select) return;
  renderLanguageSelector();
  select.addEventListener("change", (evt) => {
    const targetLang = evt.target.value;
    switchLanguage(targetLang);
  });
}

function renderSettingsLanguageSelector() {
  const dropdown = document.getElementById("settingsLanguageDropdown");
  const codeEl = document.getElementById("settingsLanguageCode");
  if (!dropdown || !codeEl) return;
  dropdown.innerHTML = "";
  const current = tempSettings.language || shellLanguage;
  getAvailableLanguages().forEach((code) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = getLanguageName(code);
    btn.dataset.value = code;
    if (code === current) btn.classList.add("active");
    btn.addEventListener("click", () => {
      tempSettings.language = code;
      applyLiveSettings(tempSettings, { persist: false });
      closeSettingsLanguageDropdown();
    });
    dropdown.appendChild(btn);
  });
  codeEl.textContent = getLanguageName(current);
}

function buildLanguageDropdown(select) {
  // Header dropdown removed; settings dropdown is built separately.
}

function toggleLanguageDropdown(force) {
  // Header dropdown removed
}

function closeLanguageDropdown() {
  toggleLanguageDropdown(false);
}

function toggleSettingsLanguageDropdown(force) {
  const control = document.getElementById("settingsLangControl");
  const dropdown = document.getElementById("settingsLanguageDropdown");
  const btn = document.getElementById("settingsLanguageButton");
  if (!control || !dropdown || !btn) return;
  const shouldOpen =
    typeof force === "boolean" ? force : !control.classList.contains("open");
  control.classList.toggle("open", shouldOpen);
  dropdown.hidden = !shouldOpen;
  btn.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

function closeSettingsLanguageDropdown() {
  toggleSettingsLanguageDropdown(false);
}

function getLanguageName(code) {
  return (TEXTS[code] && TEXTS[code].languageName) || code.toUpperCase();
}

function checkOrientationOverlay() {
  const overlay = document.getElementById("orientation-overlay");
  const overlayRoot = document.getElementById("orientation-root");
  const gameRoot = document.getElementById("game-root");
  const msg = document.getElementById("orientation-message");
  if (!overlay || !overlayRoot || !gameRoot) return;
  const isLandscape = window.innerWidth > window.innerHeight;
  if (isLandscape && !isDesktop()) {
    overlay.classList.add("active");
    overlayRoot.style.display = "flex";
    gameRoot.style.display = "none";
    if (msg) {
      msg.textContent = shellTexts.orientationMessage;
    }
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
  const w = window.innerWidth;
  const h = window.innerHeight;
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
      updateState({ settings: { sound: soundOn } });
      updateSoundToggle();
      updateSettingsControls();
    });
  }

  document.querySelectorAll("[data-modal-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modalId = btn.dataset.modalOpen;
      if (!modalId) return;
      const closable = btn.dataset.modalClosable !== "0";
      if (modalId === "settings") {
        openSettingsModal();
      } else {
        openModal(modalId, { closable });
      }
    });
  });

  document.querySelectorAll("[data-modal-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modalId = btn.dataset.modalClose;
      if (modalId) closeModal(modalId, { reason: "close" });
    });
  });

  document.querySelectorAll("[data-modal-close-top]").forEach((btn) => {
    btn.addEventListener("click", () => closeTopModal());
  });

  const settingsSoundSlider = document.getElementById("settingsSoundSlider");
  const settingsSoundIcon = document.getElementById("settingsSoundIcon");
  if (settingsSoundSlider) {
    settingsSoundSlider.addEventListener("input", (e) => {
      tempSettings.soundVolume = clampVolume(e.target.value);
      tempSettings.sound = tempSettings.soundVolume > 0;
      applyLiveSettings(tempSettings, { persist: false });
    });
  }
  if (settingsSoundIcon) {
    settingsSoundIcon.addEventListener("click", () => {
      playClickSfx();
      toggleVolumeIcon("sound");
    });
  }

  const settingsMusicSlider = document.getElementById("settingsMusicSlider");
  const settingsMusicIcon = document.getElementById("settingsMusicIcon");
  if (settingsMusicSlider) {
    settingsMusicSlider.addEventListener("input", (e) => {
      tempSettings.musicVolume = clampVolume(e.target.value);
      tempSettings.music = tempSettings.musicVolume > 0;
      applyLiveSettings(tempSettings, { persist: false });
    });
  }
  if (settingsMusicIcon) {
    settingsMusicIcon.addEventListener("click", () => {
      playClickSfx();
      toggleVolumeIcon("music");
    });
  }

  const settingsLanguageIcon = document.getElementById("settingsLanguageIcon");
  if (settingsLanguageIcon) {
    settingsLanguageIcon.addEventListener("click", () => {
      playClickSfx();
      cycleLanguage();
    });
  }
  const settingsLangBtn = document.getElementById("settingsLanguageButton");
  const settingsLangControl = document.getElementById("settingsLangControl");
  if (settingsLangBtn && settingsLangControl) {
    settingsLangBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      playClickSfx();
      toggleSettingsLanguageDropdown();
    });
    document.addEventListener("click", (e) => {
      if (!settingsLangControl.contains(e.target)) {
        closeSettingsLanguageDropdown();
      }
    });
  }

  const settingsSave = document.getElementById("settingsSaveBtn");
  if (settingsSave) {
    settingsSave.addEventListener("click", () => {
      applySettingsFromTemp();
      closeModal("settings", { reason: "action", action: "apply" });
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

function updateSettingsControls(source = {}) {
  const soundValue = source.sound ?? soundOn;
  const musicValue = source.music ?? musicOn;
  const soundVol = clampVolume(source.soundVolume ?? soundVolume);
  const musicVol = clampVolume(source.musicVolume ?? musicVolume);
  const langValue = source.language ?? shellLanguage;

  const soundSlider = document.getElementById("settingsSoundSlider");
  const soundValueLabel = document.getElementById("settingsSoundValue");
  if (soundSlider) {
    soundSlider.value = soundVol;
  }
  if (soundValueLabel) soundValueLabel.textContent = `${soundVol}%`;
  const soundIcon = document.getElementById("settingsSoundIcon");
  if (soundIcon) {
    soundIcon.classList.toggle("off", !soundValue || soundVol === 0);
  }

  const musicSlider = document.getElementById("settingsMusicSlider");
  const musicValueLabel = document.getElementById("settingsMusicValue");
  if (musicSlider) {
    musicSlider.value = musicVol;
  }
  if (musicValueLabel) musicValueLabel.textContent = `${musicVol}%`;
  const musicIcon = document.getElementById("settingsMusicIcon");
  if (musicIcon) {
    musicIcon.classList.toggle("off", !musicValue || musicVol === 0);
  }

  const langCode = document.getElementById("settingsLanguageCode");
  if (langCode) {
    langCode.textContent = getLanguageName(langValue);
  }
}

function openSettingsModal() {
  settingsSnapshot = getCurrentSettingsState();
  tempSettings = {
    sound: soundOn || soundVolume > 0,
    music: musicOn || musicVolume > 0,
    soundVolume,
    musicVolume,
    language: shellLanguage,
  };
  renderSettingsLanguageSelector();
  updateSettingsControls(tempSettings);
  openModal("settings", { closable: true });
}

function applySettingsFromTemp() {
  const nextLang = tempSettings.language || shellLanguage;
  const langChanged = nextLang !== shellLanguage;

  soundVolume = clampVolume(tempSettings.soundVolume);
  musicVolume = clampVolume(tempSettings.musicVolume);
  soundOn = soundVolume > 0 && tempSettings.sound !== false;
  musicOn = musicVolume > 0 && tempSettings.music !== false;

  applyLiveSettings(
    {
      sound: soundOn,
      music: musicOn,
      soundVolume,
      musicVolume,
      language: nextLang,
    },
    { persist: true }
  );
  settingsSnapshot = getCurrentSettingsState();
}

function applyLiveSettings(settings, { persist = false } = {}) {
  const nextSoundVol = clampVolume(settings.soundVolume ?? soundVolume);
  const nextMusicVol = clampVolume(settings.musicVolume ?? musicVolume);
  const nextSound = settings.sound ?? soundOn;
  const nextMusic = settings.music ?? musicOn;
  const nextLang = settings.language || shellLanguage;

  soundVolume = nextSoundVol;
  musicVolume = nextMusicVol;
  soundOn = nextSoundVol > 0 && nextSound !== false;
  musicOn = nextMusicVol > 0 && nextMusic !== false;

  if (persist) {
    updateState({
      settings: {
        sound: soundOn,
        music: musicOn,
        soundVolume,
        musicVolume,
        language: nextLang,
      },
    });
  }

  updateSoundToggle();
  updateAudioVolumes();
  if (!musicOn && introAudio) {
    introAudio.pause();
  } else if (musicOn) {
    attemptPlayIntro();
  }

  if (persist) {
    setShellLanguage(nextLang);
  } else if (TEXTS[nextLang]) {
    shellLanguage = nextLang;
    shellTexts = TEXTS[nextLang];
    renderShellTexts();
  }

  updateSettingsControls({
    sound: soundOn,
    music: musicOn,
    soundVolume,
    musicVolume,
    language: shellLanguage,
  });
}

function cycleLanguage() {
  const langs = getAvailableLanguages();
  if (!langs.length) return;
  const current = tempSettings.language || shellLanguage;
  const idx = langs.indexOf(current);
  const next = langs[(idx + 1) % langs.length];
  tempSettings.language = next;
  applyLiveSettings(tempSettings, { persist: false });
}

function getCurrentSettingsState() {
  return {
    sound: soundOn,
    music: musicOn,
    soundVolume,
    musicVolume,
    language: shellLanguage,
  };
}

function revertSettingsSnapshot() {
  if (settingsSnapshot) {
    applyLiveSettings(settingsSnapshot, { persist: false });
    tempSettings = { ...settingsSnapshot };
    settingsSnapshot = null;
  }
}

function handleModalClosed(evt) {
  const detail = evt.detail || {};
  if (detail.id === "settings") {
    if (detail.action === "apply") {
      settingsSnapshot = getCurrentSettingsState();
    } else {
      revertSettingsSnapshot();
    }
  }
}

function updateLanguageButton() {
  // Header language button removed; settings button shows language.
}

async function ensureWakeLock(shouldLock) {
  if (shouldLock) {
    const locked = await requestLock();
    wakeLockActive = locked;
    if (locked) {
      resetWakeLockTimer();
    }
  } else {
    await releaseLock();
    wakeLockActive = false;
    if (wakeLockTimer) {
      clearTimeout(wakeLockTimer);
      wakeLockTimer = null;
    }
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

function setupLogoLongPressForDebug(logoEl) {
  if (!logoEl) return;
  let pressTimer = null;
  const reveal = () => {
    if (window.__revealDebugPanel) {
      window.__revealDebugPanel();
    }
  };
  const start = () => {
    clear();
    pressTimer = window.setTimeout(reveal, 3000);
  };
  const clear = () => {
    if (pressTimer) {
      window.clearTimeout(pressTimer);
      pressTimer = null;
    }
  };
  ["pointerdown", "touchstart", "mousedown"].forEach((evt) => {
    logoEl.addEventListener(evt, start, { passive: true });
  });
  ["pointerup", "pointerleave", "touchend", "touchcancel", "mouseup"].forEach((evt) => {
    logoEl.addEventListener(evt, clear, { passive: true });
  });
}

function setupWakeLockActivityTracking() {
  const activityHandler = () => {
    ensureWakeLock(true);
  };
  ["pointerdown", "keydown", "touchstart"].forEach((evt) => {
    document.addEventListener(evt, activityHandler, true);
  });
}

function startSplashLoader() {
  if (splashLoaderComplete) return;
  document.body.classList.add("splash-loading");
  const loadingBlock = document.getElementById("splashLoadingBlock");
  const mainBlock = document.getElementById("splashMainContent");
  const bar = document.getElementById("splashLoaderProgress");
  const percent = document.getElementById("splashLoaderPercent");
  const logoEl = document.getElementById("splashLogo");
  if (loadingBlock) loadingBlock.classList.remove("hidden");
  if (mainBlock) mainBlock.classList.add("hidden");
  if (logoEl) setupLogoLongPressForDebug(logoEl);

  const updateProgress = (value) => {
    splashLoaderProgress = Math.min(100, Math.max(splashLoaderProgress, value));
    if (bar) bar.style.width = `${splashLoaderProgress}%`;
    if (percent) percent.textContent = `${Math.round(splashLoaderProgress)}%`;
  };

  const assets = loadSplashAssets();
  const total = assets.total || 1;
  const minDuration = 3000;
  const start = Date.now();
  let completed = 0;

  const handleComplete = () => {
    completed += 1;
    const next = 5 + (completed / total) * 90; // keep a headroom for the final 100%
    updateProgress(next);
  };

  const bump = () => handleComplete();

  updateProgress(5);

  const logoPhase = assets.logoLoader
    ? assets.logoLoader().catch((err) => logger.warn("Logo load failed", err)).finally(bump)
    : Promise.resolve();

  const backgroundPhase = logoPhase.then(() =>
    assets.backgroundLoader
      ? assets.backgroundLoader()
          .catch((err) => logger.warn("Background load failed", err))
          .finally(bump)
      : Promise.resolve()
  );

  const allPhases = backgroundPhase.then(() => {
    const restPromises = (assets.restLoaders || []).map((loader) =>
      loader()
        .catch((err) => logger.warn("Splash asset load failed", err))
        .finally(bump)
    );
    return Promise.allSettled(restPromises);
  });

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
      if (logoEl) logoEl.classList.add("logo-animated");
    }, 200);
  };

  allPhases.finally(() => {
    const elapsed = Date.now() - start;
    const remaining = Math.max(0, minDuration - elapsed);
    window.setTimeout(finish, remaining);
  });
}

function setupAudio() {
  if (audioReady) return;
  audioReady = true;

  const ensureAudioContext = () => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      musicGain = audioCtx.createGain();
      soundGain = audioCtx.createGain();
      const musicLevel = (musicVolume / 100) * 0.7;
      const soundLevel = soundVolume / 100;
      musicGain.gain.value = musicLevel;
      soundGain.gain.value = soundLevel;
      musicGain.connect(audioCtx.destination);
      soundGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
  };

  introAudio = new Audio("assets/sounds/intro.wav");
  introAudio.loop = true;
  introAudio.volume = 1;

  clickAudio = new Audio("assets/sounds/click.mp3");
  clickAudio.volume = 1;

  const unlock = () => {
    ensureAudioContext();
    if (!musicSource && audioCtx) {
      musicSource = audioCtx.createMediaElementSource(introAudio);
      musicSource.connect(musicGain);
    }
    if (!clickSource && audioCtx) {
      clickSource = audioCtx.createMediaElementSource(clickAudio);
      clickSource.connect(soundGain);
    }
    updateAudioVolumes();
    attemptPlayIntro();
    if (clickAudio) {
      clickAudio.play().catch(() => {});
      clickAudio.pause();
      clickAudio.currentTime = 0;
    }
    document.removeEventListener("pointerdown", unlock, true);
  };
  document.addEventListener("pointerdown", unlock, true);

  document.addEventListener(
    "click",
    (evt) => {
      const btn = evt.target.closest("button,input[type='range']");
      if (!btn) return;
      ensureAudioContext();
      playClickSfx();
    },
    true
  );

  attemptPlayIntro();
  updateAudioVolumes();
}

function attemptPlayIntro() {
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  if (!introAudio || !musicOn) return;
  introAudio.play().catch(() => {});
}

function updateAudioVolumes() {
  const musicLevel = (musicVolume / 100) * 0.7;
  const soundLevel = soundVolume / 100;
  if (musicGain) musicGain.gain.value = musicLevel;
  if (soundGain) soundGain.gain.value = soundLevel;
  // fallback for platforms without Web Audio volume control
  if (introAudio) {
    introAudio.volume = musicLevel;
  }
  if (clickAudio) {
    clickAudio.volume = soundLevel;
  }
}

function resetWakeLockTimer() {
  if (wakeLockTimer) {
    clearTimeout(wakeLockTimer);
  }
  wakeLockTimer = setTimeout(() => {
    ensureWakeLock(false);
  }, WAKE_LOCK_TIMEOUT_MS);
}

function clampVolume(val) {
  const num = Number(val);
  if (Number.isNaN(num)) return 0;
  return Math.min(100, Math.max(0, Math.round(num)));
}

function toggleVolumeIcon(kind) {
  if (kind === "sound") {
    tempSettings.soundVolume = tempSettings.soundVolume === 0 ? 100 : 0;
    tempSettings.sound = tempSettings.soundVolume > 0;
    applyLiveSettings(tempSettings, { persist: false });
    return;
  }
  if (kind === "music") {
    tempSettings.musicVolume = tempSettings.musicVolume === 0 ? 100 : 0;
    tempSettings.music = tempSettings.musicVolume > 0;
    applyLiveSettings(tempSettings, { persist: false });
  }
}

// Loader strategy:
// - Only resources that appear on the splash itself (logo, background, header icons, main CTA skin)
//   are preloaded here so the percentage reflects real downloads.
// - Avoid wiring assets directly in app/index.html; if needed, put a data-src (or similar) on the tag
//   and assign it here once loaded to keep everything behind the loader and prevent broken images.
// - The rest of the app can rely on normal browser caching when those screens are shown later.
function loadSplashAssets() {
  const logoEl = document.getElementById("splashLogo");
  const logoSrc = (logoEl && logoEl.getAttribute("data-src")) || "assets/img/logo-letters.png";
  const backgroundSrc =
    document.documentElement.getAttribute("data-bg-image") ||
    document.body.getAttribute("data-bg-image");
  const { entries: dataEntries, bySrc } = buildDataSrcEntries();

  const logoNodes = logoEl ? [logoEl] : bySrc.get(logoSrc) || [];
  logoNodes.forEach((node) => {
    if (!node.getAttribute("src")) {
      node.setAttribute("src", PLACEHOLDER_IMG);
    }
  });
  const restData = dataEntries.filter((entry) => entry.src !== logoSrc);

  const logoLoader = () =>
    loadImage(logoSrc).then(() => {
      assignSrcToNodes(logoNodes, logoSrc);
    });

  const backgroundLoader = backgroundSrc
    ? () =>
        loadImage(backgroundSrc).then(() => {
          applyBodyBackground(backgroundSrc);
        })
    : null;

  const explicitRest = [
    "assets/img/rotate-device-icon.png",
    "assets/img/audioOn.svg",
    "assets/img/audioOff.svg",
    "assets/img/musicOn.svg",
    "assets/img/musicOff.svg",
    "assets/img/button.svg",
    "assets/img/settings.svg",
    "assets/img/exit.svg",
    "assets/img/help.svg",
  ];

  const restLoaders = [...restData.map((entry) => entry.loader)];
  const seen = new Set(restData.map((entry) => entry.src));
  explicitRest.forEach((src) => {
    if (src === logoSrc || src === backgroundSrc) return;
    if (seen.has(src)) return;
    seen.add(src);
    restLoaders.push(() => loadImage(src));
  });

  return {
    logoLoader,
    backgroundLoader,
    restLoaders,
    total: 1 + (backgroundLoader ? 1 : 0) + restLoaders.length,
  };
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

function applyBodyBackground(url) {
  const targets = [document.documentElement, document.body].filter(Boolean);
  const desktop = isDesktop();
  targets.forEach((el) => {
    if (desktop) {
      el.style.background = `url("${url}") center top repeat fixed`;
      el.style.backgroundSize = "520px auto";
    } else {
      el.style.background = `url("${url}") center / cover no-repeat fixed`;
      el.style.backgroundSize = "cover";
    }
    const root = getComputedStyle(document.documentElement);    
    el.style.backgroundColor = root.getPropertyValue("--sky");
  });
}

function buildDataSrcEntries() {
  const nodes = Array.from(document.querySelectorAll("[data-src]"));
  const bySrc = new Map();
  const entries = nodes
    .map((node) => {
      const src = node.getAttribute("data-src");
      if (!src) return null;
      if (node.tagName.toLowerCase() === "img" && !node.getAttribute("src")) {
        node.setAttribute("src", PLACEHOLDER_IMG);
      }
      bySrc.set(src, [...(bySrc.get(src) || []), node]);
      return {
        src,
        loader: () =>
          preloadAsset(src, node)
            .then(() => assignSrcToNodes([node], src))
            .catch(() => {}),
      };
    })
    .filter(Boolean);
  return { entries, bySrc };
}

function getManifestHref() {
  const lang = (shellLanguage || "en").toLowerCase();
  const href = `manifest-${lang}.json`;
  const manifestLink = document.querySelector('link[rel="manifest"]');
  if (manifestLink) {
    manifestLink.setAttribute("href", href);
  } else {
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = href;
    document.head.appendChild(link);
  }
  return href;
}

function updateManifestLink() {
  const href = getManifestHref();
  const pwaEl = pwaInstallEl || document.querySelector("pwa-install");
  if (pwaEl) {
    pwaEl.setAttribute("manifest-url", href);
  }
}

function preloadAsset(src, node) {
  const tag = (node?.tagName || "").toLowerCase();
  if (tag === "video" || tag === "audio" || tag === "source") {
    // Let the browser/service worker reuse cache if available.
    return fetch(src).catch(() => {});
  }
  return loadImage(src);
}

function assignSrcToNodes(nodes, src) {
  nodes.forEach((node) => {
    if ("src" in node) {
      node.src = src;
    } else if (node.tagName.toLowerCase() === "use") {
      node.setAttribute("xlink:href", src);
      node.setAttribute("href", src);
    }
    node.removeAttribute("data-src");
  });
}

function bootstrapShell() {
  logger.info(`App version ${APP_VERSION}`);
  setupAudio();
  renderShellTexts();
  setupLanguageSelector();
  setupNavigation();
  setupWakeLockActivityTracking();
  document.addEventListener("modal:closed", handleModalClosed);
    if (!unsubscribeLanguage) {
    unsubscribeLanguage = onShellLanguageChange(handleLanguageChange);
    window.addEventListener("beforeunload", () => {
      if (unsubscribeLanguage) unsubscribeLanguage();
      unsubscribeLanguage = null;
    });
  }
  preventRightClick();
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
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scaleGame);
    window.visualViewport.addEventListener("scroll", scaleGame);
  }
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
  updateManifestLink();
  updateSettingsControls();
}

function setupDebugPanel() {
  const container = document.createElement("div");
  container.className = "debug-container";
  container.id = "debug-container";

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

  const reveal = () => {
    container.style.display = "block";
  };

  toggleBtn.addEventListener("click", () => {
    panel.classList.toggle("hidden");
  });

  setupDebugRevealGesture(container);
  window.__revealDebugPanel = reveal;

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
      pwaEl.setAttribute("manifest-url", getManifestHref());
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
    if (shellTexts.appDescription) {
      pwaEl.setAttribute("description", shellTexts.appDescription);
    }
    if (shellTexts.appTitle) {
      pwaEl.setAttribute("name", shellTexts.appTitle);
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
      const manifestUrl = new URL(getManifestHref(), window.location.href).toString();
      const related = await navigator.getInstalledRelatedApps();
      const match = related.some(
        (app) =>
          app.manifestUrl === manifestUrl ||
          (app.manifestUrl && app.manifestUrl.endsWith(`/${getManifestHref()}`))
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

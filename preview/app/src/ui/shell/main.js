import { IS_LOCAL, IS_PREVIEW, IS_PROD } from "../../lib/env.js";
import { getSession, getAccessToken, requestOtp, verifyOtp, onAuthStateChange, signOut, getStoredEmail, saveStoredEmail, checkFirstSignup, saveOnboarding, updateProfile, getProfile } from "../../lib/auth.js";
import { WORKER_BASE, TURNSTILE_SITE_KEY } from "../../lib/config.js";
import {
  TEXTS,
  BULLET_CHAR,
  getShellLanguage,
  setShellLanguage,
  onShellLanguageChange,
  getAvailableLanguages,
  validateTexts,
} from "../../i18n/texts.js";
import {
  DEFAULT_STRATEGY_SECONDS,
  DEFAULT_CREATION_SECONDS,
  DEFAULT_ROUNDS_TARGET,
  DEFAULT_POINTS_TARGET,
  MIN_PHASE_SECONDS,
  MAX_PHASE_SECONDS,
  DEFAULT_PLAYER_COUNT,
  MIN_PLAYERS,
  MAX_PLAYERS,
  PLAYER_NAME_MAX,
  MIN_ROUND_SCORE,
  MAX_ROUND_SCORE,
  MATCH_MODE_ROUNDS,
  MATCH_MODE_POINTS,
  PLAYER_COLORS,
  PLAYER_COLORS_PASTEL,
  CREATION_TIMEUP_AUTO_ACTION_MS,
  ROUND_KEYPAD_AUTO_ZERO_ON_NAV,
  SIMULATE_MATCH_ON_START,
  SIMULATED_MATCH_STATE,
  SIMULATE_RECORDS_ON_START,
  SIMULATED_RECORDS,
  SIMULATE_NAMES_ON_START,
  SIMULATED_KNOWN_NAMES,
  SIMULATED_MATCH_SEEDS,
  buildSimulatedMatchState,
  RECORD_MIN_POINTS,
  RECORD_AVG_PENALTY_THRESHOLD,
  RECORD_AVG_PENALTY_DECAY,
  RECORD_AVG_PENALTY_MAX,
  WAKE_LOCK_TIMEOUT_MS,
  WAKE_LOCK_SUCCESS_DEBOUNCE_MS,
} from "../../core/constants.js";
import { matchController, validateWordRemote } from "../../core/matchController.js";
import { openModal, closeModal, closeTopModal, closeAllModals } from "./modal.js";
import {
  initWakeLockManager,
  requestLock,
  releaseLock,
  isWakeLockActive,
} from "../../core/wakeLockManager.js";
import { loadState, updateState, clearState } from "../../core/stateStore.js";
import { APP_VERSION } from "../../core/version.js";
import { parseHexColor, toHex, getDealerPalette, darkenHexColor } from "../utils.js";
import { renderActionCardGrid } from "../components/actionCard.js";
import { logger, onLog, getLogs } from "../../core/logger.js";
import { capture, flush, initAnon, initAuth, resetIdentity, identify } from "../../lib/analytics.js";
import {
  loadActiveMatch,
  saveActiveMatch,
  clearActiveMatch,
  upsertArchiveMatch,
  normalizeMatchForResume,
  isResumeEligible,
  loadArchive,
  saveArchive,
  matchHasRecord,
  loadRecords,
} from "../../core/matchStorage.js";
import {
  initTraining,
  cleanupTraining,
  setupTrainingDebugToggle,
  startTrainingMatch,
  confirmExitTrainingMatch,
  finishTrainingTimer,
  renderTrainingMatch,
  renderTrainingSetup,
  requestTrainingHints,
  handleDealRandomBoard,
  handleDealRandomHand,
} from "../match/training.js";
import { getTrainingMatch } from "../../core/trainingMatch.js";
import {
  initScoreboard,
  validateScores,
  openRoundEndScreen,
  openScoreboard,
  closeScoreboard,
  renderMatch,
  renderMatchFromState,
  applyScoreboardChanges,
  resetScoreboardDraft,
  handleRoundEndContinue,
  openRecordsFromWinners,
  openRecordScoreboard,
  renderScoreboardScreen,
  renderRoundEndScreen,
  renderRecordsScreen,
  closeRecords,
  setRecordsTab,
  applySimulatedRecords,
  normalizePlayerName,
  setupActionOverlayListeners,
  renderMatchFromStateInner,
  stopMatchTimer,
  clearMatchWordFor,
  clearStatusValidationFor,
  getValidationSections,
  createValidationSection,
  startMatchPhase,
  buildMatchPrefs,
  buildTempPlayers,
  buildActiveMatchSnapshot,
  persistActiveMatchSnapshot,
  restoreActiveMatchIfEligible,
  maybePromptRestoreStaleMatch,
  getRestoredMatchActive,
  cloneValidationRules,
  updateRestoreButtonVisibility,
  resetMatchState,
  setupMatchControllerEvents,
  setupMatchEventListeners,
  renderMatchTexts,
} from "../match/scoreboard.js";

const urlParams = new URLSearchParams(window.location.search);
const fromPWA = urlParams.get("fromPWA") === "1";
const fromInstall = urlParams.get("fromInstall") === "1";
const MANUAL_URL = "assets/doc/manual.pdf";
const HELP_QUICK_URL = null;
const HELP_VIDEO_URL = null;
const HELP_INSTAGRAM_URL = "https://www.instagram.com/the.letter.loom";
const HELP_TIKTOK_URL = "https://www.tiktok.com/@the.letter.loom";
const HELP_EMAIL = "info@theletterloom.com";
const HELP_WEB_URL = IS_LOCAL ? window.location.origin : IS_PREVIEW ? "https://theletterloom.com/preview" : "https://theletterloom.com";

const appState = loadState();


const BASE_GAME_WIDTH =
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--game-width")) || 360;
const BASE_GAME_HEIGHT =
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--game-height")) || 640;
const AUTO_CONTINUE_ROUND_END = true;
const DISABLE_SCREEN_TRANSITIONS_IN_LOCAL = true;

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
let _settingsOpenedOnline = true
let _settingsLangOnOpen = null
let _accountOpenedOnline = true
let _cachedNickname = null
let _cachedEmail = null
let _cachedOptIn = false
let _isSigningOut = false
let splashLoaderInterval = null;
let splashLoaderComplete = false;
let splashLoaderProgress = 0;
let hasScaledOnce = false;
let installedAppDetected = false;
let persistentStorageChecked = false;
let persistentStorageGranted = false;
let debugPanelTitleEl = null;
let debugFilterLabelEl = null;
let debugFilterSelectEl = null;
let creationTimeupTimer = null;
let creationTimeupCancelled = false;
let introAudio = null;
let matchConfigCustomizeOpen = false;
let clickAudio = null;
let clockAudio = null;
let tickAudio = null;
let timeAudio = null;
let modalOpenAudio = null;
let successAudio = null;
let failAudio = null;
let audioReady = false;
let clockLowTimeMode = false;
let audioCtx = null;
let musicGain = null;
let soundGain = null;
let musicSource = null;
let clickSource = null;
let clockSource = null;
let tickSource = null;
let timeSource = null;
let modalOpenSource = null;
let successSource = null;
let failSource = null;
let sfxBuffers = null;
let sfxBuffersLoading = false;
let clockBuffer = null;
let clockBufferLoading = false;
let introBuffer = null;
let introBufferLoading = false;
let introSource = null;
let pausedByVisibility = false;
let audioSuspendedByVisibility = false;
let pendingClockStart = false;
let pendingAudioResume = false;
let pendingAudioResumeHandler = null;
let wakeLockTimer = null;
let wakeLockRequestInFlight = false;
let lastWakeLockSuccessAt = 0;
let winnersModalOpen = false;
let suppressWinnersPrompt = false;
let lastWinnersIds = [];
let simulatedStartActive = false;
const TIMEUP_VIBRATION_MS = 400;
const LOW_TIME_THRESHOLD = 10;

// Match config controls (temporary until starting the match)
let tempMatchPrefs = buildMatchPrefs(appState.gamePreferences);
let tempMatchPlayers = buildTempPlayers(
  tempMatchPrefs.playersCount ?? DEFAULT_PLAYER_COUNT,
  appState.gamePreferences?.players || appState.matchState?.players || []
);
let quickGuideReturnScreen = "help";
let pausedBeforeGuide = null;
let pausedBeforeScoreboard = null;



let pausedBeforeConfirm = null;
let confirmCallback = null;
let confirmCancelCallback = null;
let lastLowTimeTick = 0;
let validationRules = appState.settings.validationRules ?? null; // persisted rules
let tempValidationRules = null; // temp during settings (init later)
let rulesEditContext = "live"; // "live" | "temp"
let preserveMatchConfigOnExit = false;

tempValidationRules = cloneValidationRules(validationRules);

const WORD_CANDIDATES_KEY = "letterloom_word_candidates";

function applyScreenTransitionMode() {
  document.body?.classList.toggle(
    "screen-transitions-disabled",
    DISABLE_SCREEN_TRANSITIONS_IN_LOCAL && IS_LOCAL
  );
}


  function initValidationSections() {
    createValidationSection("roundEndValidationMount", "match");
    createValidationSection("roundEndKeypadValidationMount", "round-keypad");
    createValidationSection("helpValidationMount", "help");
  }




function playClickSfx() {
  if (!soundOn) return;
  if (playSfxBuffer("click")) return;
  loadSfxBuffers();
}
let lastClickFeedbackAt = 0;
function playClickFeedback() {
  const now = Date.now();
  if (now - lastClickFeedbackAt < 80) return;
  lastClickFeedbackAt = now;
  playClickSfx();
  triggerHapticFeedback(0);
}
// 1x1 transparent GIF to avoid broken-image icons before real sources are assigned
const PLACEHOLDER_IMG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg==";

document.title = shellTexts.appTitle;

function clearI18nVars(el) {
  Object.keys(el.dataset).forEach((key) => {
    if (key.startsWith("i18nVar")) {
      delete el.dataset[key];
    }
  });
}

function applyI18nToNode(el) {
  const key = el?.dataset?.i18n;
  if (!key) return;
  const template = shellTexts[key];
  if (typeof template !== "string") return;
  let text = template;
  Object.keys(el.dataset).forEach((dataKey) => {
    if (!dataKey.startsWith("i18nVar")) return;
    const raw = dataKey.slice("i18nVar".length);
    if (!raw) return;
    const varName = raw.charAt(0).toLowerCase() + raw.slice(1);
    const value = el.dataset[dataKey];
    text = text.split(`{${varName}}`).join(value);
  });
  const attr = el.dataset.i18nAttr || "text";
  if (attr === "text") {
    el.textContent = text;
  } else {
    el.setAttribute(attr, text);
  }
}

function applyI18n(root = document) {
  if (!root) return;
  if (root.dataset?.i18n) {
    applyI18nToNode(root);
  }
  root.querySelectorAll("[data-i18n]").forEach((el) => applyI18nToNode(el));
}

function updateBodyLanguageClass(lang) {
  const body = document.body;
  if (!body) return;
  const prefix = "lang-";
  [...body.classList].forEach((cls) => {
    if (cls.startsWith(prefix)) body.classList.remove(cls);
  });
  if (lang) {
    body.classList.add(`${prefix}${String(lang).toLowerCase()}`);
  }
}

function setI18n(el, key, { attr = "text", vars = null } = {}) {
  if (!el) return;
  el.dataset.i18n = key;
  if (attr && attr !== "text") {
    el.dataset.i18nAttr = attr;
  } else {
    delete el.dataset.i18nAttr;
  }
  clearI18nVars(el);
  if (vars) {
    Object.entries(vars).forEach(([name, value]) => {
      const suffix = `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
      el.dataset[`i18nVar${suffix}`] = `${value}`;
    });
  }
  applyI18nToNode(el);
}

function setI18nById(id, key, options) {
  setI18n(document.getElementById(id), key, options);
}

function renderShellTexts() {
  const year = new Date().getFullYear();
  document.title = shellTexts.appTitle;
  setI18nById("appTitle", "appTitle");
  setI18nById("gameFooter", "footer", { vars: { year } });

  setI18nById("splashTitle", "splashTitle");
  setI18nById("splashSubtitle", "splashSubtitle");
  setI18nById("splashContinueBtn", "splashContinue");
  setI18nById("splashTrainBtn", "splashTrain");
  setI18nById("resumeMatchBtn", "splashResume");
  setI18nById("trainingSetupTitle", "trainingSetupTitle");
  setI18nById("trainingRulesBtnText", "trainingRulesBtn");
  setI18nById("trainingStartHint", "trainingComingSoon");
  const galleryRow = document.getElementById("trainingGalleryRow");
  if (galleryRow) galleryRow.classList.remove("hidden");
  document.querySelectorAll("#screen-training-setup [data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key && shellTexts[key]) el.textContent = shellTexts[key];
  });
  setI18nById("installAppBtn", "installButtonText");
  setI18nById("installRequiredTitle", "installRequiredTitle");
  setI18nById("installRequiredDescription", "installRequiredDescription");
  setI18nById("splashHelpBtn", "splashHelp");
  setI18nById("splashLoaderLabel", "splashLoadingLabel");
  setI18nById("helpTitle", "helpTitle");
  setI18nById("helpQuickBtn", "helpQuickGuide");
  setI18nById("helpVideoBtn", "helpVideo");
  setI18nById("helpManualBtn", "helpManual");
  setI18nById("helpInstagramBtn", "helpInstagram", { attr: "aria-label" });
  setI18nById("helpTiktokBtn", "helpTiktok", { attr: "aria-label" });
  setI18nById("helpEmailBtn", "helpEmail", { attr: "aria-label" });
  setI18nById("helpWebBtn", "helpWeb", { attr: "aria-label" });
  setI18nById("helpInstagramShort", "helpInstagramShort");
  setI18nById("helpTiktokShort", "helpTiktokShort");
  setI18nById("helpEmailShort", "helpEmailShort");
  setI18nById("helpWebShort", "helpWebShort");
  setI18nById("helpFooter", "helpFooter", { vars: { year, version: APP_VERSION } });
  setI18nById("quickGuideTitle", "quickGuideTitle");
  setI18nById("quickGuideIndexTitle", "quickGuideIndexTitle");
  setI18nById("quickGuideIndexIntro", "quickGuideIndexIntro");
  setI18nById("quickGuideManualNote", "quickGuideManualNote");
  setI18nById("quickGuideManualBtn", "quickGuideManualBtn");
  setI18nById("quickGuideManualLink", "quickGuideManualLink");
  renderQuickGuide();
  renderMatchTexts(setI18nById, setI18n);

  updateInstallCopy();
  updateDebugFilterLabels();
  renderLanguageSelector();
  renderSettingsLanguageSelector();
  updateManifestLink();
  updateSoundToggle();
  updateSettingsControls();
  updateLanguageButton();
  updateInstallButtonVisibility();
}

function updateDebugFilterLabels() {
  if (debugPanelTitleEl) {
    debugPanelTitleEl.textContent = shellTexts.debugLogTitle || "Debug Log";
  }
  if (debugFilterLabelEl) {
    debugFilterLabelEl.textContent = shellTexts.debugLogFilterLabel || "Filtro";
  }
  if (debugFilterSelectEl) {
    const options = debugFilterSelectEl.options;
    const labels = [
      shellTexts.debugLogFilterDebug || "Debug",
      shellTexts.debugLogFilterInfo || "Info",
      shellTexts.debugLogFilterWarn || "Warn",
      shellTexts.debugLogFilterError || "Error",
    ];
    for (let i = 0; i < options.length && i < labels.length; i += 1) {
      options[i].textContent = labels[i];
    }
  }
}

function openConfirm({
  title,
  body,
  acceptText,
  cancelText,
  onConfirm,
  onCancel,
  hideCancel = false,
  titleVars = null,
  bodyVars = null,
}) {
  const titleKey = title || "confirmTitle";
  const bodyKey = body || "";
  const acceptKey = acceptText || "confirmAccept";
  const cancelKey = cancelText || "cancel";
  setI18n(document.getElementById("confirmTitle"), titleKey, { vars: titleVars });
  if (bodyKey) {
    setI18n(document.getElementById("confirmBody"), bodyKey, { vars: bodyVars });
  } else {
    const bodyEl = document.getElementById("confirmBody");
    if (bodyEl) {
      bodyEl.textContent = "";
      delete bodyEl.dataset.i18n;
      delete bodyEl.dataset.i18nAttr;
      clearI18nVars(bodyEl);
    }
  }
  setI18nById("confirmAcceptBtn", acceptKey);
  setI18nById("confirmCancelBtn", cancelKey);
  const cancelBtn = document.getElementById("confirmCancelBtn");
  if (cancelBtn) {
    cancelBtn.classList.toggle("hidden", !!hideCancel);
    cancelBtn.disabled = !!hideCancel;
    cancelBtn.setAttribute("aria-hidden", hideCancel ? "true" : "false");
  }
  playModalOpenSound();
  pausedBeforeConfirm = null;
  const stForConfirm = matchController.getState();
  if (stForConfirm?.phase === "strategy-run") {
    pausedBeforeConfirm = "strategy";
    matchController.pause();
    stopClockLoop(false);
  } else if (stForConfirm?.phase === "creation-run") {
    pausedBeforeConfirm = "creation";
    matchController.pause();
    stopClockLoop(false);
  }
  confirmCallback = typeof onConfirm === "function" ? onConfirm : null;
  confirmCancelCallback = typeof onCancel === "function" ? onCancel : null;
  playModalOpenSound();
  openModal("confirm", { closable: true });
}

function handleConfirmAccept() {
  if (confirmCallback) {
    try {
      confirmCallback();
    } catch (e) {
      logger.warn("Confirm callback failed", e);
    }
  }
  confirmCallback = null;
  confirmCancelCallback = null;
  pausedBeforeConfirm = null;
  closeModal("confirm", { reason: "action" });
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
      const target = event.target;
      const isInteractive =
        target instanceof Element &&
        target.closest(
          "button, input, textarea, select, a, [role='button'], [data-keypad]"
        );
      const now = Date.now();
      if (!isInteractive && now - lastTouchEnd <= 350) {
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
    showDebug: false,
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

function isAppInstalled() {
  return isStandaloneApp() || fromPWA;
}

function applyInstallGate() {
  const installed = isAppInstalled();
  const continueBtn = document.getElementById("splashContinueBtn");
  const trainBtn = document.getElementById("splashTrainBtn");
  const resumeBtn = document.getElementById("resumeMatchBtn");
  const actions = document.querySelector(".splash-actions");
  const required = document.getElementById("installRequired");
  if (continueBtn) continueBtn.classList.toggle("hidden", !installed);
  if (trainBtn) trainBtn.classList.toggle("hidden", !installed);
  if (resumeBtn && !installed) resumeBtn.classList.add("hidden");
  if (required) required.classList.toggle("hidden", installed);
  if (actions) {
    actions.classList.toggle("install-gate-only-settings", !installed);
    Array.from(actions.children).forEach((btn) => {
      if (installed) {
        btn.classList.remove("hidden");
      } else if (btn.id !== "settingsBtn") {
        btn.classList.add("hidden");
      } else {
        btn.classList.remove("hidden");
      }
    });
  }
}

function getDisplayMode() {
  if (window.matchMedia) {
    if (window.matchMedia("(display-mode: fullscreen)").matches) return "fullscreen";
    if (window.matchMedia("(display-mode: standalone)").matches) return "standalone";
  }
  return "browser";
}

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || 
        (navigator.userAgent.includes('Mac') && 'ontouchend' in document);
}

function isLocalHost() {
  return IS_LOCAL
}

function isOfflineStandaloneIOS() {
  return isIOS() && isStandaloneApp() && navigator.onLine === false;
}

function createDownload() {
  if (isIOS() || isStandaloneApp() || !('download' in document.createElement('a'))) {
    return (link, filename) => downloadWithBlob(link, filename);
  } else {
    return (link, filename) => downloadWithAnchor(link, filename);
  }
}

function getFilenameFromLink(link) {
  try { 
    const url = new URL(link, window.location.href);
    const path = url.pathname;
    const lastSegment = path.substring(path.lastIndexOf('/') + 1);
    return lastSegment || '';
  } catch {
    return '';
  }
}


function downloadWithAnchor(link, filename) {
  const a = document.createElement('a');
  a.href = link;
  // If filename is provided, use it; otherwise, extract from link
  if (typeof filename === 'string' && filename.length > 0) {
    a.download = filename;
  } else {
    a.download = getFilenameFromLink(link);
  }
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function downloadWithBlob(link, filename) {
  fetch(link)
    .then(response => response.blob())
    .then(blob => {
      const fileURL = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = fileURL;
      // If filename is provided, use it; otherwise, extract from link
      if (typeof filename === 'string' && filename.length > 0) {
        a.download = filename;
      } else {
        a.download = getFilenameFromLink(link);
      }
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(fileURL);
    })
    .catch(error => console.error('Download error (with blob):', error));
}

function switchLanguage(nextLang) {
  if (!TEXTS[nextLang] || nextLang === shellLanguage) return;
  setShellLanguage(nextLang);
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
  return TEXTS[code]?.languageName;
}

function checkOrientationOverlay() {
  const overlay = document.getElementById("orientation-overlay");
  const overlayRoot = document.getElementById("orientation-root");
  const gameRoot = document.getElementById("game-root");
  const msg = document.getElementById("orientation-message");
  if (!overlay || !overlayRoot || !gameRoot) return;
  const isLandscape = window.innerWidth > window.innerHeight;
  const allowLandscape = currentScreen === "scoreboard";
  if (isLandscape && !isDesktop() && !allowLandscape) {
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
  const isLandscape = window.innerWidth > window.innerHeight;
  const allowLandscape = currentScreen === "scoreboard" && !isDesktop();
  const rootStyle = document.documentElement.style;
  if (allowLandscape && isLandscape) {
    rootStyle.setProperty("--game-width", `${BASE_GAME_HEIGHT}px`);
    rootStyle.setProperty("--game-height", `${BASE_GAME_WIDTH}px`);
  } else {
    rootStyle.setProperty("--game-width", `${BASE_GAME_WIDTH}px`);
    rootStyle.setProperty("--game-height", `${BASE_GAME_HEIGHT}px`);
  }
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
    ["splashContinueBtn", () => {
      const prompted = maybePromptRestoreStaleMatch({
        onDecline: () => showScreen("match"),
      });
      if (!prompted) showScreen("match");
    }],
    ["splashTrainBtn", () => {
      playClickFeedback();
      showScreen("training-setup");
    }],
    ["trainingBackBtn", () => showScreen("splash")],
    ["trainingSettingsBtn", () => openSettingsModal()],
    ["trainingCardWords",     () => startTrainingMatch("words")],
    ["trainingCardTimeTrial", () => startTrainingMatch("timeTrial")],
    ["trainingCardEasy",      () => startTrainingMatch("easy")],
    ["trainingCardNormal",    () => startTrainingMatch("normal")],
    ["trainingCardHard",      () => startTrainingMatch("hard")],
    ["trainingRulesBtn",   () => openTrainingRulesNotice()],
    ["trainingGalleryBtn", () => openQuickGuide("strategy-cards-all")],
    ["trainingMatchBackBtn",     () => confirmExitTrainingMatch()],
    ["trainingMatchExitBtn",     () => confirmExitTrainingMatch()],
    ["trainingMatchSettingsBtn", () => openSettingsModal()],
    ["trainingMatchHelpBtn",     () => openQuickGuide(getQuickGuideSectionForPhase(getTrainingMatch()?.phase))],
    ["trainingTimerDoneBtn",     () => finishTrainingTimer()],
    ["trainingValidateBtn",      () => finishTrainingTimer()],
    ["trainingHintBtn",          () => requestTrainingHints()],
    ["trainingDealRandomBoardBtn", () => handleDealRandomBoard()],
    ["trainingDealRandomHandBtn",  () => handleDealRandomHand()],
    ["resumeMatchBtn", () => showScreen("match")],
    ["splashHelpBtn", () => showScreen("help")],
    ["helpBtn", () => showScreen("help")],
    ["helpBackBtn", () => showScreen("splash")],
    ["helpQuickBtn", () => openQuickGuide()],
    ["helpVideoBtn", () => openHelpVideo()],
    ["helpManualBtn", () => openManual()],
    ["helpSettingsBtn", () => openSettingsModal()],
    ["quickGuideBackBtn", () => closeQuickGuide()],
    ["quickGuideSettingsBtn", () => openSettingsModal()],
    ["quickGuideManualBtn", () => openManual()],
    ["quickGuideManualLink", () => openManual()],
    ["helpInstagramBtn", () => openSocialLink("instagram")],
    ["helpTiktokBtn", () => openSocialLink("tiktok")],
    ["helpEmailBtn", () => openSocialLink("email")],
    ["helpWebBtn", () => openSocialLink("web")],
    ["supportCtaBtn", () => {
      playClickFeedback();
      const hash = shellLanguage === "es" ? "#comprar" : "#buy";
      window.open(`${HELP_WEB_URL}/landing/${hash}`, "_blank", "noopener");
    }],
    ["confirmAcceptBtn", () => handleConfirmAccept()],
    ["confirmCancelBtn", () => handleConfirmCancel()],
  ];
  map.forEach(([id, handler]) => {
    const el = document.getElementById(id);
    if (el)
      el.addEventListener("click", () => {
        playClickFeedback();
        handler();
      });
  });

  initTraining({
    showScreen,
    playClickFeedback,
    openConfirm,
    playClockLoop,
    stopClockLoop,
    setI18nById,
    triggerTimeUpEffects,
    playLowTimeTick,
  });
  initScoreboard({
    showScreen,
    playClickFeedback,
    openConfirm,
    setI18nById,
    setI18n,
    scaleGame,
    triggerHapticFeedback,
    stopClockLoop,
    playClockLoop,
    clockLowTimeMode: { get value() { return clockLowTimeMode; }, set value(v) { clockLowTimeMode = v; } },
    playValidationResultSound,
    stopIntroAudio: () => { if (introAudio) { introAudio.pause(); introAudio.currentTime = 0; } },
    renderMatch: () => renderMatchFromStateInner(matchController.getState()),
    currentScreen: () => currentScreen,
    pausedBeforeScoreboard: { get value() { return pausedBeforeScoreboard; }, set value(v) { pausedBeforeScoreboard = v; } },
    winnersModalOpen: { get value() { return winnersModalOpen; }, set value(v) { winnersModalOpen = v; } },
    suppressWinnersPrompt: { get value() { return suppressWinnersPrompt; }, set value(v) { suppressWinnersPrompt = v; } },
    lastWinnersIds: { get value() { return lastWinnersIds; }, set value(v) { lastWinnersIds = v; } },
    matchConfigCustomizeOpen: { get value() { return matchConfigCustomizeOpen; }, set value(v) { matchConfigCustomizeOpen = v; } },
    tempMatchPrefs: { get value() { return tempMatchPrefs; }, set value(v) { tempMatchPrefs = v; } },
    tempMatchPlayers: { get value() { return tempMatchPlayers; }, set value(v) { tempMatchPlayers = v; } },
    cachedNickname: { get value() { return _cachedNickname; } },
    scheduleCreationTimeupAutoAdvance,
    clearCreationTimeupAutoAdvance,
    playModalOpenSound,
    validationRules: { get value() { return validationRules; }, set value(v) { validationRules = v; } },
    tempValidationRules: { get value() { return tempValidationRules; }, set value(v) { tempValidationRules = v; } },
    rulesEditContext: { get value() { return rulesEditContext; }, set value(v) { rulesEditContext = v; } },
    triggerTimeUpEffects,
    playLowTimeTick,
    openSettingsModal,
    openQuickGuide,
    openManual,
    getQuickGuideSectionForPhase,
  });
  setupMatchEventListeners();
  setupTrainingDebugToggle();

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
      playClickFeedback();
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
      playClickFeedback();
      toggleVolumeIcon("music");
    });
  }

  const settingsLanguageIcon = document.getElementById("settingsLanguageIcon");
  if (settingsLanguageIcon) {
    settingsLanguageIcon.addEventListener("click", () => {
      playClickFeedback();
      cycleLanguage();
    });
  }
  const settingsLangBtn = document.getElementById("settingsLanguageButton");
  const settingsLangControl = document.getElementById("settingsLangControl");
  if (settingsLangBtn && settingsLangControl) {
    settingsLangBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      playClickFeedback();
      toggleSettingsLanguageDropdown();
    });
    document.addEventListener("click", (e) => {
      if (!settingsLangControl.contains(e.target)) {
        closeSettingsLanguageDropdown();
      }
    });
  }

  document.getElementById("settingsCloseBtn")?.addEventListener("click", _handleSettingsClose);
  document.getElementById("settingsDiscardBtn")?.addEventListener("click", _discardSettingsChanges);
  document.getElementById("settingsAccountRow")?.addEventListener("click", _openAccountModal);
  document.getElementById("accountBackBtn")?.addEventListener("click", _handleAccountBack);
  document.getElementById("accountLogoutBtn")?.addEventListener("click", _handleLogout);
  document.getElementById("accountDiscardBtn")?.addEventListener("click", _discardAccountChanges);
  document.getElementById("optInConfirmSkipBtn")?.addEventListener("click", _handleOptInConfirmSkip);
  document.getElementById("optInConfirmActivateBtn")?.addEventListener("click", _handleOptInConfirmActivate);
  document.getElementById("logoutConfirmCancelBtn")?.addEventListener("click", () => closeModal('logout-confirm', { reason: 'close' }));
  document.getElementById("logoutConfirmOkBtn")?.addEventListener("click", _doLogout);
  _setupAccountOptInConfirm();

}

function openManual() {
  playClickFeedback();
  const triggerDownload = createDownload();
  triggerDownload(MANUAL_URL, "LetterLoom_Manual.pdf");
}

function getQuickGuideSections() {
  const sections = Array.isArray(shellTexts.quickGuideSections)
    ? shellTexts.quickGuideSections
    : [];
  return sections.filter((section) => section && section.id);
}

function getQuickGuideSectionForPhase(phase) {
  if (!phase) return "intro";
  if (phase === "dealing") return "round-setup";
  if (phase.startsWith("strategy")) return "strategy";
  if (phase.startsWith("creation") || phase === "done") {
    if (phase === "creation-timeup" || phase === "done") return "scoring";
    return "creation";
  }
  return "intro";
}

function highlightQuickGuideSection(sectionEl) {
  if (!sectionEl) return;
  sectionEl.classList.remove("is-highlighted");
  void sectionEl.offsetWidth;
  sectionEl.classList.add("is-highlighted");
  window.setTimeout(() => sectionEl.classList.remove("is-highlighted"), 1200);
}

function getScrollTopForSection(scrollEl, sectionEl) {
  let top = 0;
  let node = sectionEl;
  while (node && node !== scrollEl) {
    top += node.offsetTop || 0;
    node = node.offsetParent;
  }
  return Math.max(0, top);
}

function scrollQuickGuideTo(targetId, { behavior = "smooth" } = {}) {
  const scrollEl = document.getElementById("quickGuideScroll");
  if (!scrollEl) return;
  if (!targetId || targetId === "index") {
    scrollEl.scrollTo({ top: 0, behavior });
    return;
  }
  const sectionEl = document.getElementById(`quickGuideSection-${targetId}`);
  if (!sectionEl) return;
  const top = getScrollTopForSection(scrollEl, sectionEl);
  scrollEl.scrollTo({ top, behavior });
  highlightQuickGuideSection(sectionEl);
}

function renderQuickGuideRichText(targetEl, text) {
  if (!text) return;
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;
  while ((match = linkRegex.exec(text))) {
    const [full, label, href] = match;
    const before = text.slice(lastIndex, match.index);
    if (before) targetEl.appendChild(document.createTextNode(before));
    const linkBtn = document.createElement("button");
    linkBtn.type = "button";
    linkBtn.className = "quick-guide-inline-link";
    linkBtn.textContent = label;
    linkBtn.addEventListener("click", () => {
      playClickFeedback();
      if (href.startsWith("#")) {
        scrollQuickGuideTo(href.slice(1));
      } else if (href.startsWith("action:buy")) {
        const buyBtn = document.getElementById("buyBtn");
        if (buyBtn) {
          buyBtn.click();
        } else {
          openModal("support");
        }
      }
    });
    targetEl.appendChild(linkBtn);
    lastIndex = match.index + full.length;
  }
  const after = text.slice(lastIndex);
  if (after) targetEl.appendChild(document.createTextNode(after));
  if (lastIndex === 0) targetEl.textContent = text;
}

// renderQuickGuideActionCardGrid → renderActionCardGrid in ui/components/actionCard.js

function getQuickGuideGameLanguage() {
  const sourceScreen = currentScreen === "quick-guide" ? quickGuideReturnScreen : currentScreen;
  if (sourceScreen === "training") {
    return loadState().training?.active?.language || shellLanguage;
  }
  const st = matchController.getState();
  if (sourceScreen === "match" || sourceScreen === "round-end" || sourceScreen === "scoreboard") {
    return st?.language || shellLanguage;
  }
  return shellLanguage;
}

function renderQuickGuide() {
  const indexList = document.getElementById("quickGuideIndexList");
  const sectionsWrap = document.getElementById("quickGuideSections");
  if (!indexList || !sectionsWrap) return;
  const sections = getQuickGuideSections();
  indexList.innerHTML = "";
  sectionsWrap.innerHTML = "";

  sections.forEach((section) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quick-guide-index-item";
    btn.textContent = section.title || "";
    btn.addEventListener("click", () => {
      playClickFeedback();
      scrollQuickGuideTo(section.id);
    });
    indexList.appendChild(btn);
  });

  sections.forEach((section) => {
    const sectionEl = document.createElement("section");
    sectionEl.className = "quick-guide-section match-section";
    sectionEl.id = `quickGuideSection-${section.id}`;
    sectionEl.dataset.quickGuideSection = section.id;

    const titleEl = document.createElement("div");
    titleEl.className = "quick-guide-section-title";
    titleEl.textContent = section.title || "";
    sectionEl.appendChild(titleEl);

    if (Array.isArray(section.body)) {
      section.body.forEach((text) => {
        if (!text) return;
        const p = document.createElement("p");
        p.className = "quick-guide-text";
        renderQuickGuideRichText(p, text);
        sectionEl.appendChild(p);
      });
    }

    let skipBullets = false;
    if (Array.isArray(section.images) && section.images.length) {
      const imagesWrap = document.createElement("div");
      imagesWrap.className = "quick-guide-images";
      const captionsFromBullets =
        Array.isArray(section.imageCaptions) && section.imageCaptions.length
          ? section.imageCaptions
          : Array.isArray(section.bullets)
            ? section.bullets
            : [];
      if (captionsFromBullets.length && captionsFromBullets === section.bullets) {
        skipBullets = true;
      }
      section.images.forEach((img, index) => {
        if (!img?.src) return;
        const figure = document.createElement("figure");
        figure.className = "quick-guide-image-card";
        const imageEl = document.createElement("img");
        imageEl.className = "quick-guide-image";
        imageEl.src = img.src;
        imageEl.alt = img.alt || "";
        imageEl.loading = "lazy";
        figure.appendChild(imageEl);
        const captionText = captionsFromBullets[index];
        if (captionText) {
          const caption = document.createElement("figcaption");
          caption.className = "quick-guide-image-caption";
          renderQuickGuideRichText(caption, captionText);
          figure.appendChild(caption);
        }
        imagesWrap.appendChild(figure);
      });
      if (imagesWrap.children.length) sectionEl.appendChild(imagesWrap);
    }

    if (!skipBullets && Array.isArray(section.bullets) && section.bullets.length) {
      const ul = document.createElement("ul");
      ul.className = "quick-guide-list";
      section.bullets.forEach((item) => {
        if (!item) return;
        const li = document.createElement("li");
        renderQuickGuideRichText(li, item);
        ul.appendChild(li);
      });
      sectionEl.appendChild(ul);
    }

    if (Array.isArray(section.afterBullets)) {
      section.afterBullets.forEach((text) => {
        if (!text) return;
        const p = document.createElement("p");
        p.className = "quick-guide-text";
        renderQuickGuideRichText(p, text);
        sectionEl.appendChild(p);
      });
    }

    if (section.id === "strategy-cards-all") {
      sectionEl.appendChild(renderActionCardGrid({ language: getQuickGuideGameLanguage() }));
    }

    if (Array.isArray(section.faq) && section.faq.length) {
      const faqWrap = document.createElement("div");
      faqWrap.className = "quick-guide-faq";
      section.faq.forEach((item) => {
        if (!item || !item.q) return;
        const faqItem = document.createElement("div");
        faqItem.className = "quick-guide-faq-item";
        const q = document.createElement("div");
        q.className = "quick-guide-faq-q";
        q.textContent = item.q;
        const a = document.createElement("div");
        a.className = "quick-guide-faq-a";
        a.textContent = item.a || "";
        faqItem.appendChild(q);
        faqItem.appendChild(a);
        faqWrap.appendChild(faqItem);
      });
      sectionEl.appendChild(faqWrap);
    }

    const indexBtn = document.createElement("button");
    indexBtn.type = "button";
    indexBtn.className = "quick-guide-index-btn";
    indexBtn.textContent = shellTexts.quickGuideIndexButton || "Index";
    indexBtn.addEventListener("click", () => {
      playClickFeedback();
      scrollQuickGuideTo("index");
    });
    sectionEl.appendChild(indexBtn);

    sectionsWrap.appendChild(sectionEl);
  });
}

function openQuickGuide(sectionId = "index") {
  playClickFeedback();
  quickGuideReturnScreen = currentScreen || "help";
  const validIds = new Set(getQuickGuideSections().map((section) => section.id));
  const targetId = validIds.has(sectionId) ? sectionId : "index";
  const st = matchController.getState();
  pausedBeforeGuide = null;
  if (st?.phase === "strategy-run") {
    pausedBeforeGuide = "strategy";
    matchController.pause();
    stopClockLoop(false);
  } else if (st?.phase === "creation-run") {
    pausedBeforeGuide = "creation";
    matchController.pause();
    stopClockLoop(false);
  }
  clearMatchWordFor("help", false);
  clearStatusValidationFor("help");
  showScreen("quick-guide");
  renderQuickGuide();
  requestAnimationFrame(() => {
    scrollQuickGuideTo(targetId, { behavior: "auto" });
  });
  scaleGame();
}

function closeQuickGuide() {
  showScreen(quickGuideReturnScreen || "help");
  scaleGame();
  const resumePhase = pausedBeforeGuide;
  pausedBeforeGuide = null;
  if (resumePhase) {
    const st = matchController.getState();
    if (resumePhase === "strategy" && st?.phase === "strategy-paused") {
      startMatchPhase("strategy");
    } else if (resumePhase === "creation" && st?.phase === "creation-paused") {
      startMatchPhase("creation");
    }
  }
}

function openHelpVideo() {
  playClickFeedback();
  if (HELP_VIDEO_URL) {
    window.open(HELP_VIDEO_URL, "_blank", "noopener");
  } else {
  logger.debug("Help video not available yet");
  }
}

function openSocialLink(kind) {
  playClickFeedback();
  if (kind === "instagram" && HELP_INSTAGRAM_URL) {
    window.open(HELP_INSTAGRAM_URL, "_blank", "noopener");
    return;
  }
  if (kind === "tiktok" && HELP_TIKTOK_URL) {
    window.open(HELP_TIKTOK_URL, "_blank", "noopener");
    return;
  }
  if (kind === "email" && HELP_EMAIL) {
    window.location.href = `mailto:${HELP_EMAIL}`;
    return;
  }
  if (kind === "web" && HELP_WEB_URL) {
    window.open(HELP_WEB_URL, "_blank", "noopener");
    return;
  }
  logger.debug("Help link not available");
}

function initMatch() {
  if (SIMULATE_MATCH_ON_START && isLocalHost()) {
    applySimulatedMatch();
  }
  if (SIMULATE_RECORDS_ON_START && isLocalHost()) {
    applySimulatedRecords();
  }
  if (SIMULATE_NAMES_ON_START && isLocalHost()) {
    applySimulatedKnownNames();
  }
  if (restoreActiveMatchIfEligible()) {
    showScreen("match");
  }
  const snap = matchController.getState();
  if (!snap) return;
  renderMatchFromState(snap);
}


function applySimulatedMatch() {
  if (window.__simulatedMatchApplied) return false;
  if (!SIMULATED_MATCH_STATE || !SIMULATED_MATCH_STATE.players) return false;
  window.__simulatedMatchApplied = true;

  const normalized = normalizeMatchForResume(SIMULATED_MATCH_STATE);
  const snapshot = buildActiveMatchSnapshot(normalized, { status: "active" });
  if (snapshot) {
    snapshot.lastSavedAt = normalized.updatedAt || snapshot.lastSavedAt;
    saveActiveMatch(snapshot);
  }
  return true;
}





function openTrainingRulesNotice() {
  playClickFeedback();
  openConfirm({
    title: "trainingRulesNoticeTitle",
    body: "trainingRulesNoticeBody",
    acceptText: "ok",
    hideCancel: true,
  });
}







function handleConfirmCancel() {
  const st = matchController.getState();
  if (pausedBeforeConfirm === "strategy" && st?.phase === "strategy-paused") {
    startMatchPhase("strategy");
  } else if (pausedBeforeConfirm === "creation" && st?.phase === "creation-paused") {
    startMatchPhase("creation");
  }
  pausedBeforeConfirm = null;
  if (confirmCancelCallback) {
    try {
      confirmCancelCallback();
    } catch (e) {
      logger.warn("Confirm cancel callback failed", e);
    }
  }
  confirmCancelCallback = null;
  closeModal("confirm", { reason: "cancel" });
}


function showScreen(name) {
  applyScreenTransitionMode();
  if (name !== "training") {
    cleanupTraining(name !== "match");
  }
  currentScreen = name;
  if (name !== "match") {
    matchConfigCustomizeOpen = false;
  }
  if (name !== "match") {
    clearCreationTimeupAutoAdvance(true);
  }
  const targetId = `screen-${name}`;
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("active", el.id === targetId);
  });
  if (name !== "round-end") {
    const keypad = document.getElementById("roundEndKeypad");
    if (keypad) {
      keypad.classList.add("hidden");
      keypad.setAttribute("aria-hidden", "true");
    }
  }
  if (name !== "scoreboard") {
    const keypad = document.getElementById("scoreboardKeypad");
    if (keypad) {
      keypad.classList.add("hidden");
      keypad.setAttribute("aria-hidden", "true");
    }
  }
  const activeScreen = document.getElementById(targetId);
  if (activeScreen) {
    activeScreen.scrollTop = 0;
    activeScreen.scrollLeft = 0;
    activeScreen.querySelectorAll("*").forEach((el) => {
      if (el.scrollTop) el.scrollTop = 0;
      if (el.scrollLeft) el.scrollLeft = 0;
    });
  }
  if (name === "match") {
    renderMatch();
  } else if (name === "training-setup") {
    renderTrainingSetup();
  } else if (name === "training") {
    renderTrainingMatch();
  } else if (name === "round-end") {
    renderRoundEndScreen();
  } else if (name === "scoreboard") {
    renderScoreboardScreen(matchController.getState());
  } else if (name === "quick-guide") {
    renderQuickGuide();
  } else if (name === "records") {
    renderRecordsScreen();
  } else {
    if (name === "splash") {
      if (!preserveMatchConfigOnExit) {
        resetMatchState();
      }
      preserveMatchConfigOnExit = false;
    }
    stopMatchTimer();
    stopClockLoop(true);
  }
  checkOrientationOverlay();
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
  _settingsOpenedOnline = navigator.onLine
  _settingsLangOnOpen = shellLanguage
  tempSettings = {
    sound: soundOn || soundVolume > 0,
    music: musicOn || musicVolume > 0,
    soundVolume,
    musicVolume,
    language: shellLanguage,
  };
  renderSettingsLanguageSelector();
  updateSettingsControls(tempSettings);
  _renderSettingsAccountRow();
  _hideSettingsSaveFeedback();
  playModalOpenSound();
  openModal("settings", { closable: false });
}

function _renderSettingsAccountRow() {
  const row = document.getElementById('settingsAccountRow')
  const emailEl = document.getElementById('settingsAccountEmail')
  if (!row) return
  if (!_cachedEmail) { row.classList.add('hidden'); return }
  if (emailEl) emailEl.textContent = _cachedEmail
  row.classList.remove('hidden')
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
    updateBodyLanguageClass(shellLanguage);
    renderShellTexts();
    applyI18n(document);
    const st = matchController.getState();
    if (st) {
      renderMatchFromState(st);
      renderScoreboardScreen(st);
    }
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

function _hideSettingsSaveFeedback() {
  document.getElementById('settingsSaveFeedback')?.classList.add('hidden')
}

function _showSettingsSaveFeedback() {
  const wrap = document.getElementById('settingsSaveFeedback')
  const errEl = document.getElementById('settingsSaveError')
  const discardBtn = document.getElementById('settingsDiscardBtn')
  if (errEl) errEl.textContent = shellTexts.settingsSaveError ?? 'Error al guardar el idioma'
  if (discardBtn) discardBtn.textContent = shellTexts.accountDiscard ?? 'Salir sin guardar'
  wrap?.classList.remove('hidden')
}

function _discardSettingsChanges() {
  _hideSettingsSaveFeedback()
  closeModal('settings', { reason: 'discard' })
}

async function _handleSettingsClose() {
  _hideSettingsSaveFeedback()
  updateState({ settings: { sound: soundOn, music: musicOn, soundVolume, musicVolume } })
  const nextLang = shellLanguage
  if (nextLang === _settingsLangOnOpen) {
    closeModal('settings', { reason: 'close' })
    return
  }
  setShellLanguage(nextLang)
  if (!_settingsOpenedOnline) {
    closeModal('settings', { reason: 'close' })
    return
  }
  if (!navigator.onLine) {
    _showSettingsSaveFeedback()
    return
  }
  try {
    const { error } = await updateProfile({ language: nextLang })
    if (!error) {
      closeModal('settings', { reason: 'close' })
    } else {
      _showSettingsSaveFeedback()
    }
  } catch {
    _showSettingsSaveFeedback()
  }
}

function handleModalClosed(evt) {
  const detail = evt.detail || {};
  if (detail.id === "confirm") {
    if (detail.reason !== "action") {
      handleConfirmCancel();
    }
  } else if (detail.id === "validation-rules") {
    rulesEditContext = "live";
  } else if (detail.id === "validation-result") {
    clearMatchWordFor("match");
    clearMatchWordFor("splash");
  }
}

function updateLanguageButton() {
  // Header language button removed; settings button shows language.
}

async function ensureWakeLock(shouldLock) {
  if (shouldLock) {
    if (wakeLockRequestInFlight) return wakeLockActive || isWakeLockActive();
    wakeLockRequestInFlight = true;
    try {
      const locked = await requestLock();
      wakeLockActive = locked;
      if (locked) {
        resetWakeLockTimer();
        lastWakeLockSuccessAt = Date.now();
      }
      return locked;
    } finally {
      wakeLockRequestInFlight = false;
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
  const activityHandler = async (evt) => {
    if (evt && evt.isTrusted === false) return;
    const now = Date.now();
    const active = wakeLockActive || isWakeLockActive();
    resetWakeLockTimer();
    const shouldDebounce =
      !isIOS() && active && now - lastWakeLockSuccessAt < WAKE_LOCK_SUCCESS_DEBOUNCE_MS;
    if (shouldDebounce) {
      return;
    }
    await ensureWakeLock(true);
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
  const minDuration = (isStandaloneApp() || fromPWA) ? 1 : 3000;
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
      applyInstallGate();
      const logoWrap = document.querySelector(".splash-logo-wrap");
      if (logoWrap) logoWrap.classList.add("logo-animated");
      if (logoEl) logoEl.classList.add("logo-animated");
    }, 200);
  };

  allPhases.finally(() => {
    const elapsed = Date.now() - start;
    const remaining = Math.max(0, minDuration - elapsed);
    window.setTimeout(finish, remaining);
  });
}

function ensureAudioContextAvailable() {
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
}

function setupAudio() {
  if (audioReady) return;
  audioReady = true;

  const unlock = () => {
    ensureAudioContextAvailable();
    loadSfxBuffers();
    loadClockBuffer();
    loadIntroBuffer();
    updateAudioVolumes();
    attemptPlayIntro();
    if (pendingAudioResume) {
      pendingAudioResume = false;
      resumeMusicForState();
    }
    document.removeEventListener("pointerdown", unlock, true);
  };
  document.addEventListener("pointerdown", unlock, true);

  document.addEventListener(
    "click",
    (evt) => {
      const btn = evt.target.closest("button,input[type='range']");
      if (!btn) return;
      ensureAudioContextAvailable();
      loadSfxBuffers();
      playClickFeedback();
      if (pendingAudioResume) {
        pendingAudioResume = false;
        resumeMusicForState();
      }
    },
    true
  );

  if (!pendingAudioResumeHandler) {
    pendingAudioResumeHandler = () => {
      if (!pendingAudioResume) return;
      pendingAudioResume = false;
      ensureAudioContextAvailable();
      loadSfxBuffers();
      loadClockBuffer();
      loadIntroBuffer();
      resumeMusicForState();
    };
    document.addEventListener("pointerdown", pendingAudioResumeHandler, true);
  }

  attemptPlayIntro();
  updateAudioVolumes();
}

function loadSfxBuffers() {
  if (!audioCtx || sfxBuffersLoading || sfxBuffers) return;
  sfxBuffersLoading = true;
  const files = {
    click: "assets/sounds/click.mp3",
    tick: "assets/sounds/tick.mp3",
    time: "assets/sounds/time.mp3",
    modal: "assets/sounds/open.mp3",
    success: "assets/sounds/success.mp3",
    fail: "assets/sounds/fail.mp3",
  };
  const entries = Object.entries(files);
  Promise.all(
    entries.map(async ([key, url]) => {
      const res = await fetch(url);
      const data = await res.arrayBuffer();
      const buffer = await audioCtx.decodeAudioData(data);
      return [key, buffer];
    })
  )
    .then((pairs) => {
      sfxBuffers = {};
      pairs.forEach(([key, buffer]) => {
        sfxBuffers[key] = buffer;
      });
    })
    .catch(() => {})
    .finally(() => {
      sfxBuffersLoading = false;
    });
}

function loadClockBuffer() {
  if (!audioCtx || clockBufferLoading || clockBuffer) return;
  clockBufferLoading = true;
  fetch("assets/sounds/clock-melody.mp3")
    .then((res) => res.arrayBuffer())
    .then((data) => audioCtx.decodeAudioData(data))
    .then((buffer) => {
      clockBuffer = buffer;
      if (pendingClockStart) {
        pendingClockStart = false;
        const st = matchController.getState();
        const phase = st?.phase || "";
        if (currentScreen === "match" && phase.endsWith("-run") && !clockLowTimeMode) {
          playClockLoop();
        }
      }
    })
    .catch(() => {})
    .finally(() => {
      clockBufferLoading = false;
    });
}

function loadIntroBuffer() {
  if (!audioCtx || introBufferLoading || introBuffer) return;
  introBufferLoading = true;
  fetch("assets/sounds/intro.wav")
    .then((res) => res.arrayBuffer())
    .then((data) => audioCtx.decodeAudioData(data))
    .then((buffer) => {
      introBuffer = buffer;
      startIntroLoop();
    })
    .catch(() => {})
    .finally(() => {
      introBufferLoading = false;
    });
}

function startIntroLoop() {
  if (!audioCtx || !musicOn || !introBuffer || currentScreen === "match" || currentScreen === "auth") return;
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  if (introSource) {
    try {
      introSource.stop(0);
    } catch (e) {}
  }
  introSource = audioCtx.createBufferSource();
  introSource.buffer = introBuffer;
  introSource.loop = true;
  introSource.connect(musicGain);
  try {
    introSource.start(0);
  } catch (e) {}
}

function stopIntroLoop() {
  if (!introSource) return;
  try {
    introSource.stop(0);
  } catch (e) {}
  try {
    introSource.disconnect();
  } catch (e) {}
  introSource = null;
}

function playSfxBuffer(name) {
  if (!soundOn || !audioCtx || !soundGain || !sfxBuffers || !sfxBuffers[name]) return false;
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  const source = audioCtx.createBufferSource();
  source.buffer = sfxBuffers[name];
  const gain = audioCtx.createGain();
  gain.gain.value = soundVolume / 100;
  source.connect(gain);
  gain.connect(soundGain);
  try {
    source.start(0);
    return true;
  } catch {
    return false;
  }
}

function attemptPlayIntro() {
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  if (!musicOn) return;
  if (introBuffer) {
    startIntroLoop();
    return;
  }
  loadIntroBuffer();
}

function updateAudioVolumes() {
  const musicLevel = (musicVolume / 100) * 0.7;
  const soundLevel = soundVolume / 100;
  if (musicGain) musicGain.gain.value = musicLevel;
  if (soundGain) soundGain.gain.value = soundLevel;
}

function playClockLoop() {
  if (!musicOn) return;
  stopIntroLoop();
  if (introAudio) {
    introAudio.pause();
  }
  if (audioCtx) {
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    if (!clockBuffer) {
      loadClockBuffer();
      pendingClockStart = true;
      return;
    }
    if (clockSource) {
      try {
        clockSource.stop(0);
      } catch (e) {}
    }
    clockSource = audioCtx.createBufferSource();
    clockSource.buffer = clockBuffer;
    clockSource.loop = true;
    clockSource.connect(musicGain);
    try {
      clockSource.start(0);
    } catch (e) {}
  }
}

function stopClockLoop(allowIntro = true) {
  pendingClockStart = false;
  if (clockSource) {
    try {
      clockSource.stop(0);
    } catch (e) {}
    try {
      clockSource.disconnect();
    } catch (e) {}
    clockSource = null;
  }
  if (clockAudio) {
    clockAudio.pause();
    clockAudio.currentTime = 0;
  }
  if (musicOn && allowIntro && currentScreen !== "match") {
    attemptPlayIntro();
  }
}

function stopAllMusic() {
  stopClockLoop(false);
  stopIntroLoop();
  if (introAudio) {
    try {
      introAudio.pause();
      introAudio.currentTime = 0;
    } catch (e) {}
  }
}

function closeAudioForBackground() {
  if (audioCtx && audioCtx.state !== "closed") {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
  musicGain = null;
  soundGain = null;
  musicSource = null;
  clockSource = null;
  sfxBuffers = null;
  sfxBuffersLoading = false;
  clockBuffer = null;
  clockBufferLoading = false;
  pendingClockStart = false;
  introBuffer = null;
  introBufferLoading = false;
  audioSuspendedByVisibility = true;
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    } catch (e) {}
  }
}

function reopenAudioAfterBackground() {
  if (!audioSuspendedByVisibility) return;
  ensureAudioContextAvailable();
  loadSfxBuffers();
  loadClockBuffer();
  loadIntroBuffer();
  audioSuspendedByVisibility = false;
}

function resumeMusicForState() {
  if (!audioReady || !musicOn) return;
  reopenAudioAfterBackground();
  const st = matchController.getState();
  const phase = st?.phase || "";
  const isRun = phase.endsWith("-run");
  if (currentScreen === "match" && isRun) {
    clockLowTimeMode = st?.remaining <= LOW_TIME_THRESHOLD;
    if (!clockLowTimeMode) {
      playClockLoop();
    }
    return;
  }
  if (currentScreen !== "match" && currentScreen !== "auth") {
    attemptPlayIntro();
  }
}

function playLowTimeTick(force = false) {
  if (!soundOn) return;
  const now = Date.now();
  if (!force && now - lastLowTimeTick < 900) return;
  lastLowTimeTick = now;
  if (playSfxBuffer("tick")) return;
  loadSfxBuffers();
}


const VIBRATION_PATTERNS = [
  20,
  [20, 15, 20],
  [30, 20, 30, 20, 30],
  [60, 40, 60, 40, 120],
];

function triggerHapticFallback() {
  try {
    const wrapper = document.createElement("div");
    const id = `haptic-${Math.random().toString(36).slice(2)}`;
    wrapper.innerHTML = `<input type="checkbox" id="${id}" switch /><label for="${id}"></label>`;
    wrapper.setAttribute(
      "style",
      "display:none !important;opacity:0 !important;visibility:hidden !important;"
    );
    document.body.appendChild(wrapper);
    const label = wrapper.querySelector("label");
    if (label) {
      label.click();
      setTimeout(() => {
        wrapper.remove();
      }, 0);
    } else {
      const input = wrapper.querySelector("input");
      if (input) input.click();
      setTimeout(() => wrapper.remove(), 0);
    }
    return true;
  } catch (e) {
    return false;
  }
}


function triggerHapticFeedback(patternOrIndex = 0) {
  try {
    let finalPattern = VIBRATION_PATTERNS[0];
    if (Array.isArray(patternOrIndex)) {
      finalPattern = patternOrIndex;
    } else if (typeof patternOrIndex === "number") {
      if (
        Number.isInteger(patternOrIndex) &&
        patternOrIndex >= 0 &&
        patternOrIndex < VIBRATION_PATTERNS.length
      ) {
        finalPattern = VIBRATION_PATTERNS[patternOrIndex];
      } else {
        finalPattern = patternOrIndex;
      }
    }
    if (navigator.vibrate) {
      navigator.vibrate(finalPattern);
      return true;
    }
    return triggerHapticFallback();
  } catch (e) {
    return triggerHapticFallback();
  }
}

function triggerTimeUpEffects(kind) {
  if (soundOn) {
    if (!playSfxBuffer("time")) {
      loadSfxBuffers();
      playLowTimeTick(true);
    }
  }
  triggerHapticFeedback(TIMEUP_VIBRATION_MS);
  stopClockLoop(false);
}

function clearCreationTimeupAutoAdvance(resetCancelled = false) {
  if (creationTimeupTimer) {
    window.clearTimeout(creationTimeupTimer);
    creationTimeupTimer = null;
  }
  if (resetCancelled) creationTimeupCancelled = false;
}

function scheduleCreationTimeupAutoAdvance() {
  if (creationTimeupTimer || creationTimeupCancelled) return;
  creationTimeupTimer = window.setTimeout(() => {
    creationTimeupTimer = null;
    const st = matchController.getState();
    if (!st || st.phase !== "creation-timeup" || currentScreen !== "match") return;
    creationTimeupCancelled = false;
    openRoundEndScreen();
  }, CREATION_TIMEUP_AUTO_ACTION_MS);
}

function handleCreationTimeupInteraction() {
  if (!creationTimeupTimer) return;
  const st = matchController.getState();
  if (!st || st.phase !== "creation-timeup" || currentScreen !== "match") return;
  clearCreationTimeupAutoAdvance();
  creationTimeupCancelled = true;
}

function setupCreationTimeupInteractionTracking() {
  ["pointerdown", "touchstart", "mousedown", "keydown"].forEach((evt) => {
    document.addEventListener(evt, handleCreationTimeupInteraction, true);
  });
}

function playModalOpenSound() {
  if (!soundOn) return;
  if (playSfxBuffer("modal")) return;
  loadSfxBuffers();
}

function playValidationResultSound(ok = true) {
  if (!soundOn) return;
  const key = ok ? "success" : "fail";
  if (playSfxBuffer(key)) return;
  loadSfxBuffers();
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
    "assets/img/previous.svg",
    "assets/img/share.svg",
    "assets/img/share-ios.svg",
    "assets/img/share-android.svg",
  ];

  const soundAssets = [
    "assets/sounds/intro.wav",
    "assets/sounds/click.mp3",
    "assets/sounds/clock-melody.mp3",
    "assets/sounds/tick.mp3",
    "assets/sounds/time.mp3",
    "assets/sounds/open.mp3",
    "assets/sounds/success.mp3",
    "assets/sounds/fail.mp3",
  ];

  const restLoaders = [...restData.map((entry) => entry.loader)];
  const seen = new Set(restData.map((entry) => entry.src));
  explicitRest.forEach((src) => {
    if (src === logoSrc || src === backgroundSrc) return;
    if (seen.has(src)) return;
    seen.add(src);
    restLoaders.push(() => loadImage(src));
  });
  soundAssets.forEach((src) => {
    if (seen.has(src)) return;
    seen.add(src);
    restLoaders.push(() => preloadAsset(src).catch(() => {}));
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
      el.classList.add("bg-pan");
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
  if (isOfflineStandaloneIOS()) return Promise.resolve();
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

  async function bootstrapShell() {
    logger.info(`App version ${APP_VERSION}`);
    const bgSrc = document.documentElement.getAttribute("data-bg-image");
    if (bgSrc) applyBodyBackground(bgSrc);
    initAnon(WORKER_BASE)
    onAuthStateChange((session) => {
      if (!session && !_isSigningOut) _doLogout()
    })
    requestServiceWorkerVersion();
    const textErrors = validateTexts(TEXTS);
  if (textErrors.length) {
    const msg = `Translation validation failed:\n${textErrors.join("\n")}`;
    logger.error(msg);
    throw new Error(msg);
  }
    updateBodyLanguageClass(shellLanguage);
    setupAudio();
    setupMatchControllerEvents();
    matchController.setValidator((word, customRules) =>
    validateWordRemote({
      word,
      language: matchController.getState()?.language || shellLanguage,
      customRules,
    })
  );
    initValidationSections();
    renderShellTexts();
    updatePreviewBadge();
  setupNavigation();
  setupLanguageSelector();
  initMatch();
  setupActionOverlayListeners();
  setupWakeLockActivityTracking();
  setupCreationTimeupInteractionTracking();
  document.addEventListener("modal:closed", handleModalClosed);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      persistActiveMatchSnapshot(matchController.getState());
      flush()
    }
  });
  window.addEventListener("online", () => flush());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      const st = matchController.getState();
      if (currentScreen === "match" && st?.phase?.endsWith("-run")) {
        pausedByVisibility = true;
        matchController.pause();
      }
      stopAllMusic();
      closeAudioForBackground();
    } else {
      if (pausedByVisibility) {
        pausedByVisibility = false;
        matchController.resume();
      }
      pendingAudioResume = true;
    }
  });
  window.addEventListener("pagehide", () => {
    persistActiveMatchSnapshot(matchController.getState());
    const st = matchController.getState();
    if (currentScreen === "match" && st?.phase?.endsWith("-run")) {
      pausedByVisibility = true;
      matchController.pause();
    }
    stopAllMusic();
    closeAudioForBackground();
  });
  window.addEventListener("blur", () => {
    const st = matchController.getState();
    if (currentScreen === "match" && st?.phase?.endsWith("-run")) {
      pausedByVisibility = true;
      matchController.pause();
    }
    stopAllMusic();
    closeAudioForBackground();
  });
  window.addEventListener("focus", () => {
    if (pausedByVisibility) {
      pausedByVisibility = false;
      matchController.resume();
    }
    pendingAudioResume = true;
  });
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
  requestPersistentStorage();
  setupServiceWorkerMessaging();
  scaleGame();
  window.addEventListener("resize", scaleGame);
  window.addEventListener("orientationchange", scaleGame);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scaleGame);
    window.visualViewport.addEventListener("scroll", scaleGame);
  }
  registerServiceWorker();

  setupAuthScreen();
  if (fromInstall) {
    capture('app_opened', { has_session: false })
    flush()
    _proceedToApp();
    return;
  }
  const session = await getSession().catch(() => null);
  const sessionAgeDays = session
    ? Math.round((Date.now() - new Date(session.user.last_sign_in_at).getTime()) / 864e5)
    : null
  capture('app_opened', { has_session: !!session, session_age_days: sessionAgeDays })
  flush()
  if (session) {
    try {
      const { isFirstSignup } = await checkFirstSignup()
      if (isFirstSignup) {
        _cachedEmail = session.user.email ?? null
        _showAuthEmailStep('fresh', null)
        showScreen("auth")
        _showOnboardingIfNeeded(true, _proceedToApp)
      } else {
        _cachedEmail = session.user.email ?? null
        const { profile } = await getProfile().catch(() => ({ profile: null }))
        _cachedNickname = profile?.nickname ?? null
        _cachedOptIn = profile?.email_opt_in ?? false
        if (profile?.language) setShellLanguage(profile.language)
        initAuth(getAccessToken)
        _proceedToApp()
      }
    } catch {
      try { await signOut() } catch {}
      _cachedNickname = null
      _cachedEmail = null
      _showAuthEmailStep('fresh', getStoredEmail())
      showScreen("auth")
    }
  } else {
    const savedEmail = getStoredEmail();
    const pendingOtpEmail = _getValidPendingOtpEmail();
    if (!navigator.onLine && savedEmail) {
      _proceedToApp();
    } else if (pendingOtpEmail) {
      // PWA was discarded while user was waiting for the OTP code — restore the code step.
      _pendingEmail = pendingOtpEmail;
      _showAuthEmailStep(savedEmail ? 'expired' : 'fresh', pendingOtpEmail);
      showScreen("auth");
      _showAuthCodeStep(pendingOtpEmail);
    } else {
      _showAuthEmailStep(savedEmail ? 'expired' : 'fresh', savedEmail);
      showScreen("auth");
    }
  }
}

function _proceedToApp() {
  showScreen(simulatedStartActive || getRestoredMatchActive() ? "match" : "splash");
  startSplashLoader();
  detectInstalledApp().finally(() => updateInstallButtonVisibility());
  if (audioReady) resumeMusicForState();
}

// ── Auth screen ───────────────────────────────────────────────

let _turnstileWidgetId = null
let _turnstileResolve = null
let _turnstileReject = null
let _pendingEmail = null
let _authMode = 'fresh' // 'fresh' | 'expired'

function _loadTurnstile() {
  if (document.getElementById('turnstile-script')) return
  const url = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
  const s = document.createElement('script')
  s.id = 'turnstile-script'
  s.async = true
  s.defer = true
  try {
    s.src = url
  } catch {
    try {
      const policy = window.trustedTypes?.createPolicy?.('turnstile-loader', { createScriptURL: (u) => u })
      if (policy) s.src = policy.createScriptURL(url)
    } catch {}
  }
  document.head.appendChild(s)
}

function setupAuthScreen() {
  _loadTurnstile()
  const authForm        = document.getElementById('authForm')
  const resendBtn       = document.getElementById('authResendBtn')
  const notYouBtn       = document.getElementById('authNotYouBtn')
  const changeEmailBtn  = document.getElementById('authChangeEmailBtn')

  _setAuthText()
  renderLangToggle("authLangToggle")

  authForm?.addEventListener('submit', _handleAuthSubmit)
  resendBtn?.addEventListener('click', _handleAuthResend)
  notYouBtn?.addEventListener('click', _handleNotYou)
  changeEmailBtn?.addEventListener('click', _handleChangeEmail)

  document.getElementById('onboardingBtn')?.addEventListener('click', _handleOnboardingSave)
  document.getElementById('onboardingSkipBtn')?.addEventListener('click', _handleOnboardingCancel)
  document.getElementById('profileCancelYesBtn')?.addEventListener('click', _handleProfileCancelConfirm)
  document.getElementById('profileCancelNoBtn')?.addEventListener('click', () => closeModal('profile-cancel', { reason: 'close' }))
  document.getElementById('onboardingInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') _handleOnboardingSave()
  })

  // Auto-verify when the 6-digit OTP is fully entered — saves a tap. We
  // strip anything non-numeric so paste-from-clipboard works too. Skipped if
  // the verify button is disabled (already verifying / no pending email).
  const codeInput = document.getElementById('authCodeInput')
  codeInput?.addEventListener('input', () => {
    const cleaned = (codeInput.value || '').replace(/\D/g, '').slice(0, 6)
    if (cleaned !== codeInput.value) codeInput.value = cleaned
    if (cleaned.length !== 6) return
    const verifyBtn = document.getElementById('authVerifyBtn')
    if (verifyBtn?.disabled) return
    _handleAuthVerify()
  })
}

function _handleAuthSubmit(event) {
  event?.preventDefault()
  if (!document.getElementById('authProfileStep')?.classList.contains('hidden')) {
    _handleOnboardingSave()
    return
  }
  const codeStepVisible = !document.getElementById('authCodeStep')?.classList.contains('hidden')
  if (codeStepVisible) {
    _handleAuthVerify()
  } else {
    _handleAuthContinue()
  }
}

function _setAuthText() {
  const t = shellTexts
  const subtitle = _authMode === 'expired' ? (t.authSubtitleExpired ?? '') : (t.authSubtitleFresh ?? '')
  document.getElementById('authSubtitle')?.replaceChildren(document.createTextNode(subtitle))
  document.getElementById('authBadge')?.replaceChildren(document.createTextNode(t.authBadgeExpired ?? ''))
  document.getElementById('authNotYouBtn')?.replaceChildren(document.createTextNode(t.authNotYou ?? ''))
  document.getElementById('authEmailInput')?.setAttribute('placeholder', t.authEmailPlaceholder ?? '')
  document.getElementById('authContinueBtn')?.replaceChildren(document.createTextNode(t.authContinueBtn ?? ''))
  document.getElementById('authCodeInput')?.setAttribute('placeholder', t.authCodePlaceholder ?? '')
  document.getElementById('authVerifyBtn')?.replaceChildren(document.createTextNode(t.authVerifyBtn ?? ''))
  document.getElementById('authResendBtn')?.replaceChildren(document.createTextNode(t.authResendBtn ?? ''))
  const changeEmailEl = document.getElementById('authChangeEmailBtn')
  if (changeEmailEl) {
    const arrowSpan = document.createElement('span')
    arrowSpan.className = 'auth-arrow'
    arrowSpan.setAttribute('aria-hidden', 'true')
    arrowSpan.textContent = '🠄'
    const labelSpan = document.createElement('span')
    labelSpan.className = 'auth-text'
    labelSpan.textContent = t.authChangeEmail ?? 'Change email'
    changeEmailEl.replaceChildren(arrowSpan, labelSpan)
    changeEmailEl.setAttribute('aria-label', t.authChangeEmail ?? 'Change email')
  }
  const legalEl = document.getElementById('authLegal')
  if (legalEl && t.authLegalText) {
    const base = `${HELP_WEB_URL}/landing/?lang=${shellLanguage}`
    const privacyAnchor = t.authLegalPrivacyAnchor ?? 'privacidad'
    const legalAnchor = t.authLegalNoticeAnchor ?? 'aviso-legal'
    const privacy = `<a href="${base}#${privacyAnchor}" target="_blank" rel="noopener">${t.authLegalPrivacy ?? ''}</a>`
    const legal = `<a href="${base}#${legalAnchor}" target="_blank" rel="noopener">${t.authLegalNotice ?? ''}</a>`
    legalEl.innerHTML = t.authLegalText.replace('{privacy}', privacy).replace('{legal}', legal)
  }
}

function _showAuthEmailStep(mode, prefillEmail = null) {
  _authMode = mode
  _setAuthText()
  const badge    = document.getElementById('authBadge')
  const notYou   = document.getElementById('authNotYouBtn')
  const emailEl  = document.getElementById('authEmailInput')
  const isExpired = mode === 'expired'
  badge?.classList.toggle('hidden', !isExpired)
  notYou?.classList.toggle('hidden', !isExpired)
  if (isExpired && prefillEmail) {
    if (emailEl) emailEl.value = prefillEmail
  } else {
    if (emailEl) emailEl.value = ''
    document.getElementById('authEmailError')?.classList.add('hidden')
    const codeInput = document.getElementById('authCodeInput')
    if (codeInput) codeInput.value = ''
    document.getElementById('authCodeError')?.classList.add('hidden')
    document.getElementById('authCodeStep')?.classList.add('hidden')
    document.getElementById('authEmailStep')?.classList.remove('hidden')
    document.getElementById('authProfileStep')?.classList.add('hidden')
    _pendingEmail = null
  }
}

function _handleNotYou() {
  const emailEl = document.getElementById('authEmailInput')
  if (emailEl) emailEl.value = ''
  document.getElementById('authEmailError')?.classList.add('hidden')
  _showAuthEmailStep('fresh')
  document.getElementById('authEmailInput')?.focus()
}

function _handleChangeEmail() {
  _pendingEmail = null
  _clearPendingOtpEmail()
  const codeInput = document.getElementById('authCodeInput')
  if (codeInput) codeInput.value = ''
  document.getElementById('authCodeError')?.classList.add('hidden')
  document.getElementById('authCodeStep')?.classList.add('hidden')
  document.getElementById('authEmailStep')?.classList.remove('hidden')
  const emailInput = document.getElementById('authEmailInput')
  emailInput?.focus()
  emailInput?.select()
}

function _getTurnstileToken() {
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      _turnstileResolve = null
      _turnstileReject = null
      reject(new Error('turnstile_timeout'))
    }, 15000)

    _turnstileResolve = (token) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      _turnstileResolve = null
      _turnstileReject = null
      resolve(token)
    }
    _turnstileReject = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      _turnstileResolve = null
      _turnstileReject = null
      reject(new Error('turnstile_error_' + code))
    }

    const run = () => {
      if (!window.turnstile) { setTimeout(run, 100); return }
      if (_turnstileWidgetId === null) {
        _turnstileWidgetId = window.turnstile.render('#authTurnstile', {
          sitekey: TURNSTILE_SITE_KEY,
          size: 'invisible',
          callback: (t) => _turnstileResolve?.(t),
          'error-callback': (c) => _turnstileReject?.(c),
        })
      } else {
        window.turnstile.reset(_turnstileWidgetId)
      }
    }
    run()
  })
}

async function _handleAuthContinue() {
  const t = shellTexts
  const emailInput  = document.getElementById('authEmailInput')
  const continueBtn = document.getElementById('authContinueBtn')
  const errorEl     = document.getElementById('authEmailError')

  const email = emailInput?.value?.trim()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (errorEl) errorEl.textContent = shellTexts.authErrorInvalidEmail ?? 'Correo no válido'
    errorEl?.classList.remove('hidden')
    emailInput?.focus()
    return
  }

  if (!navigator.onLine) {
    if (errorEl) errorEl.textContent = shellTexts.authErrorNetwork ?? 'Sin conexión'
    errorEl?.classList.remove('hidden')
    return
  }

  errorEl?.classList.add('hidden')
  continueBtn.textContent = t.authSending ?? '...'
  continueBtn.disabled = true

  try {
    const token = await _getTurnstileToken()
    const { error } = await requestOtp(email, token, shellLanguage)
    if (error) throw error
    _pendingEmail = email
    capture(_authMode === 'fresh' ? 'signup_email_submitted' : 'login_email_submitted', { language: shellLanguage })
    _showAuthCodeStep(email)
  } catch (err) {
    let msg = !navigator.onLine
      ? (t.authErrorNetwork ?? 'Sin conexión')
      : (t.authErrorGeneric ?? 'Error')
    if (IS_LOCAL && err?.message?.includes('turnstile_error_600010') && /iphone|ipad|ipod/i.test(navigator.userAgent)) {
      msg = '⚠️ Dev: Turnstile falla simulando iOS. Desactiva la simulación, autentícate, y luego vuelve a activar iOS.'
    }
    errorEl.textContent = msg
    errorEl.classList.remove('hidden')
  } finally {
    continueBtn.textContent = t.authContinueBtn ?? 'Continuar'
    continueBtn.disabled = false
  }
}

async function _handleAuthVerify() {
  const t = shellTexts
  const codeInput = document.getElementById('authCodeInput')
  const verifyBtn = document.getElementById('authVerifyBtn')
  const errorEl   = document.getElementById('authCodeError')

  const code = codeInput?.value?.trim()
  if (!code || !_pendingEmail) return

  errorEl?.classList.add('hidden')
  verifyBtn.textContent = t.authVerifying ?? '...'
  verifyBtn.disabled = true

  try {
    const { session, error } = await verifyOtp(_pendingEmail, code)
    if (error || !session) throw error ?? new Error('no_session')
    _clearPendingOtpEmail()
    saveStoredEmail(_pendingEmail)
    _cachedEmail = _pendingEmail
    const { isFirstSignup } = await checkFirstSignup().catch(() => ({ isFirstSignup: false }))
    if (!isFirstSignup) {
      const { profile } = await getProfile().catch(() => ({ profile: null }))
      _cachedNickname = profile?.nickname ?? null
      _cachedOptIn = profile?.email_opt_in ?? false
      if (profile?.language) setShellLanguage(profile.language)
      initAuth(getAccessToken)
      identify()
      capture('login_completed', { language: shellLanguage })
      flush()
    }
    _showOnboardingIfNeeded(isFirstSignup, _proceedToApp)
  } catch {
    errorEl.textContent = t.authErrorInvalidCode ?? 'Código incorrecto'
    errorEl.classList.remove('hidden')
    verifyBtn.textContent = t.authVerifyBtn ?? 'Verificar'
    verifyBtn.disabled = false
  }
}

async function _handleAuthResend() {
  _pendingEmail && _handleAuthContinue()
}

// ── Profile step (primer alta) ────────────────────────────────

function _renderOnboardingTexts() {
  const t = shellTexts
  const input  = document.getElementById('onboardingInput')
  const btn    = document.getElementById('onboardingBtn')
  const cancel = document.getElementById('onboardingSkipBtn')
  const optIn  = document.getElementById('onboardingOptIn')
  const optLbl = document.getElementById('onboardingOptInLabel')
  document.getElementById('authProfileSubtitle')?.replaceChildren(document.createTextNode(t.onboardingSubtitle ?? ''))
  if (input) {
    input.setAttribute('placeholder', t.onboardingPlaceholder ?? '')
    input.setAttribute('aria-label', t.onboardingPlaceholder ?? 'Nombre')
    input.value = ''
  }
  if (optIn) optIn.checked = false
  if (optLbl) optLbl.textContent = t.onboardingOptIn ?? ''
  if (btn) { btn.disabled = false; btn.textContent = t.onboardingBtn ?? 'Guardar'; btn.setAttribute('aria-label', t.onboardingBtn ?? '') }
  if (cancel) {
    const x = document.createElement('span'); x.className = 'auth-arrow'; x.setAttribute('aria-hidden', 'true'); x.textContent = '✕'
    const lbl = document.createElement('span'); lbl.className = 'auth-text'; lbl.textContent = t.onboardingCancel ?? 'Cancelar'
    cancel.replaceChildren(x, lbl)
    cancel.setAttribute('aria-label', t.onboardingCancel ?? 'Cancelar')
  }
  document.getElementById('onboardingError')?.classList.add('hidden')
}

function _showOnboardingIfNeeded(isFirstSignup, onDone) {
  if (isFirstSignup) {
    _renderOnboardingTexts()
    document.getElementById('authEmailStep')?.classList.add('hidden')
    document.getElementById('authCodeStep')?.classList.add('hidden')
    document.getElementById('authProfileStep')?.classList.remove('hidden')
    setTimeout(() => document.getElementById('onboardingInput')?.focus(), 80)
    return
  }
  onDone()
}

async function _handleOnboardingSave() {
  const t       = shellTexts
  const input   = document.getElementById('onboardingInput')
  const errorEl = document.getElementById('onboardingError')
  const optIn   = document.getElementById('onboardingOptIn')
  const nickname = input?.value?.trim().toUpperCase()
  if (!nickname) {
    if (errorEl) errorEl.textContent = t.onboardingError ?? 'Escribe un nombre para continuar'
    errorEl?.classList.remove('hidden')
    input?.focus()
    return
  }
  errorEl?.classList.add('hidden')
  if (!optIn?.checked) {
    _showOptInConfirmModal(
      () => _doOnboardingSave(),
      () => { if (optIn) optIn.checked = true; _doOnboardingSave() }
    )
    return
  }
  await _doOnboardingSave()
}

async function _doOnboardingSave() {
  const input  = document.getElementById('onboardingInput')
  const btn    = document.getElementById('onboardingBtn')
  const nickname = input?.value?.trim().toUpperCase()
  if (!nickname) return
  if (btn) { btn.disabled = true; btn.textContent = '...' }
  const emailOptIn = document.getElementById('onboardingOptIn')?.checked ?? false
  try { await saveOnboarding({ nickname, emailOptIn, language: shellLanguage }) } catch {}
  _cachedNickname = nickname
  _cachedOptIn = emailOptIn
  initAuth(getAccessToken)
  identify()
  capture('signup_completed', { language: shellLanguage, email_opt_in: emailOptIn })
  flush()
  _proceedToApp()
}

function _renderCancelConfirmTexts() {
  const t = shellTexts
  document.getElementById('profileCancelTitle')?.replaceChildren(document.createTextNode(t.onboardingCancelTitle ?? ''))
  document.getElementById('profileCancelMsg')?.replaceChildren(document.createTextNode(t.onboardingCancelMsg ?? ''))
  document.getElementById('profileCancelYesBtn')?.replaceChildren(document.createTextNode(t.onboardingCancelYes ?? ''))
  document.getElementById('profileCancelNoBtn')?.replaceChildren(document.createTextNode(t.onboardingCancelNo ?? ''))
}

async function _handleAccountBack() {
  if (!_accountOpenedOnline) {
    closeModal('cuenta', { reason: 'close' })
    return
  }
  const saved = await _saveAccountOnExit()
  if (saved) closeModal('cuenta', { reason: 'close' })
}

function _openAccountModal() {
  _accountOpenedOnline = navigator.onLine
  const input      = document.getElementById('accountNicknameInput')
  const optIn      = document.getElementById('accountOptIn')
  const emailEl    = document.getElementById('accountFooterEmail')
  const discard    = document.getElementById('accountDiscardBtn')
  const offlineMsg = document.getElementById('accountOfflineMsg')
  if (input) input.value = _cachedNickname ?? ''
  if (optIn) optIn.checked = _cachedOptIn ?? false
  if (emailEl) emailEl.textContent = _cachedEmail ?? ''
  if (discard) discard.textContent = shellTexts.accountDiscard ?? 'Salir sin guardar'
  _hideAccountSaveFeedback()
  if (!_accountOpenedOnline) {
    if (input) { input.disabled = true; input.readOnly = true }
    if (optIn) optIn.disabled = true
    if (offlineMsg) { offlineMsg.textContent = shellTexts.accountOffline ?? 'Sin conexión — solo lectura'; offlineMsg.classList.remove('hidden') }
  } else {
    if (input) { input.disabled = false; input.readOnly = false }
    if (optIn) optIn.disabled = false
    offlineMsg?.classList.add('hidden')
  }
  closeModal('settings', { reason: 'navigate' })
  openModal('cuenta', { closable: false, onClose: (detail) => {
    if (detail.reason !== 'logout') openSettingsModal()
  }})
}

function _hideAccountSaveFeedback() {
  document.getElementById('accountSaveFeedback')?.classList.add('hidden')
  document.getElementById('accountNicknameError')?.classList.add('hidden')
}

function _showAccountSaveFeedback() {
  const wrap = document.getElementById('accountSaveFeedback')
  const errEl = document.getElementById('accountSaveError')
  const discard = document.getElementById('accountDiscardBtn')
  if (errEl) errEl.textContent = shellTexts.accountSaveError ?? 'Error al guardar'
  if (discard) discard.textContent = shellTexts.accountDiscard ?? 'Salir sin guardar'
  wrap?.classList.remove('hidden')
}

function _discardAccountChanges() {
  _hideAccountSaveFeedback()
  closeModal('cuenta', { reason: 'discard' })
}

async function _saveAccountOnExit() {
  const input      = document.getElementById('accountNicknameInput')
  const optIn      = document.getElementById('accountOptIn')
  const errNick    = document.getElementById('accountNicknameError')
  const nickname   = input?.value?.trim().toUpperCase() || null
  const emailOptIn = optIn?.checked ?? false
  const prevOptIn = _cachedOptIn
  if (!nickname) {
    if (errNick) { errNick.textContent = shellTexts.accountNicknameRequired ?? 'El nombre no puede estar vacío.'; errNick.classList.remove('hidden') }
    input?.focus()
    return false
  }
  errNick?.classList.add('hidden')
  try {
    if (IS_LOCAL && nickname.endsWith('1')) {
      throw new Error('Simulated network error (dev: nickname ends in 1)')
    }
    const { error } = await updateProfile({ nickname, emailOptIn })
    if (!error) {
      _cachedNickname = nickname
      _cachedOptIn = emailOptIn
      if (emailOptIn !== prevOptIn) {
        capture('email_opt_in_changed', { value: emailOptIn })
        flush()
      }
      _renderSettingsAccountRow()
      _hideAccountSaveFeedback()
      return true
    }
    _showAccountSaveFeedback()
    return false
  } catch {
    _showAccountSaveFeedback()
    return false
  }
}

function _setupAccountOptInConfirm() {
  document.getElementById('accountOptIn')?.addEventListener('change', (e) => {
    if (!e.target.checked) {
      _showOptInConfirmModal(
        () => {},
        () => { e.target.checked = true }
      )
    }
  })
}

let _optInOnSkip = null
let _optInOnActivate = null

function _showOptInConfirmModal(onSkip, onActivate) {
  const t = shellTexts
  const title = document.getElementById('optInConfirmTitle')
  const body = document.getElementById('optInConfirmBody')
  const skipBtn = document.getElementById('optInConfirmSkipBtn')
  const activateBtn = document.getElementById('optInConfirmActivateBtn')
  if (title) title.textContent = t.optInConfirmTitle ?? 'Consentimiento'
  if (body) body.textContent = t.optInConfirmMsg ?? ''
  if (skipBtn) skipBtn.textContent = t.optInConfirmSkip ?? 'No'
  if (activateBtn) activateBtn.textContent = t.optInConfirmActivate ?? 'Sí'
  _optInOnSkip = onSkip
  _optInOnActivate = onActivate
  openModal('optin-confirm', { closable: true })
}

function _handleOptInConfirmSkip() {
  const cb = _optInOnSkip
  _optInOnSkip = null; _optInOnActivate = null
  closeModal('optin-confirm', { reason: 'action', action: 'skip' })
  cb?.()
}

function _handleOptInConfirmActivate() {
  const cb = _optInOnActivate
  _optInOnSkip = null; _optInOnActivate = null
  closeModal('optin-confirm', { reason: 'action', action: 'activate' })
  cb?.()
}

function _handleLogout() {
  const t = shellTexts
  const title = document.getElementById('logoutConfirmTitle')
  const body = document.getElementById('logoutConfirmBody')
  const cancelBtn = document.getElementById('logoutConfirmCancelBtn')
  const okBtn = document.getElementById('logoutConfirmOkBtn')
  if (title) title.textContent = t.logoutConfirmTitle ?? 'Cerrar sesión'
  if (body) body.textContent = t.logoutConfirmMsg ?? '¿Seguro que quieres cerrar sesión?'
  if (cancelBtn) cancelBtn.textContent = t.logoutConfirmCancel ?? 'Cancelar'
  if (okBtn) okBtn.textContent = t.logoutConfirmOk ?? 'Sí'
  openModal('logout-confirm', { closable: true })
}

async function _doLogout() {
  closeModal('logout-confirm', { reason: 'action' })
  closeAllModals({ reason: 'logout' })
  _isSigningOut = true
  try { await signOut() } catch {}
  _isSigningOut = false
  resetIdentity()
  _cachedNickname = null
  _cachedEmail = null
  _cachedOptIn = false
  _pendingEmail = null
  _clearPendingOtpEmail()
  clearState()
  localStorage.removeItem(WORD_CANDIDATES_KEY)
  localStorage.removeItem('letterloom_match_records')
  _showAuthEmailStep('fresh', null)
  showScreen('auth')
}

function _handleOnboardingCancel() {
  _renderCancelConfirmTexts()
  openModal('profile-cancel', { closable: true })
}

async function _handleProfileCancelConfirm() {
  closeModal('profile-cancel', { reason: 'action' })
  try { await signOut() } catch {}
  document.getElementById('authProfileStep')?.classList.add('hidden')
  document.getElementById('authCodeStep')?.classList.add('hidden')
  document.getElementById('authEmailStep')?.classList.remove('hidden')
  _showAuthEmailStep('fresh', getStoredEmail())
  document.getElementById('authEmailInput')?.focus()
}

const PENDING_OTP_EMAIL_KEY = 'll_pending_otp_email'
const PENDING_OTP_TS_KEY   = 'll_pending_otp_ts'
const PENDING_OTP_TTL_MS   = 15 * 60 * 1000  // 15 min

function _showAuthCodeStep(email) {
  const t = shellTexts
  // Persist so the code step survives a PWA background-discard + restart.
  try {
    sessionStorage.setItem(PENDING_OTP_EMAIL_KEY, email)
    sessionStorage.setItem(PENDING_OTP_TS_KEY, String(Date.now()))
  } catch {}
  document.getElementById('authEmailStep')?.classList.add('hidden')
  const codeStep = document.getElementById('authCodeStep')
  codeStep?.classList.remove('hidden')
  const hint = document.getElementById('authCodeHint')
  if (hint) hint.textContent = `${t.authCodeHint ?? 'Código enviado a'} ${email}`
  const verifyBtn = document.getElementById('authVerifyBtn')
  if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.textContent = t.authVerifyBtn ?? 'Verificar' }
  document.getElementById('authCodeInput')?.value && (document.getElementById('authCodeInput').value = '')
  document.getElementById('authCodeError')?.classList.add('hidden')
  document.getElementById('authCodeInput')?.focus()
}

function _clearPendingOtpEmail() {
  try {
    sessionStorage.removeItem(PENDING_OTP_EMAIL_KEY)
    sessionStorage.removeItem(PENDING_OTP_TS_KEY)
  } catch {}
}

function _getValidPendingOtpEmail() {
  try {
    const email = sessionStorage.getItem(PENDING_OTP_EMAIL_KEY)
    const ts = parseInt(sessionStorage.getItem(PENDING_OTP_TS_KEY) || '0', 10)
    if (!email || !ts) return null
    if (Date.now() - ts > PENDING_OTP_TTL_MS) { _clearPendingOtpEmail(); return null }
    return email
  } catch { return null }
}

function renderInstallHints() {
  const descEl = document.getElementById("installRequiredDescription");
  if (!descEl) return;
  const lines = descEl.textContent.split("\n").filter(Boolean);
  if (lines.length < 2) return;
  descEl.innerHTML = lines.map(l =>
    `<span class="install-hint-line">${l}</span>`
  ).join("");
}

function renderLangToggle(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.classList.remove("hidden");
  container.innerHTML = "";
  getAvailableLanguages().forEach((code) => {
    const btn = document.createElement("button");
    btn.className = "install-lang-btn" + (code === shellLanguage ? " active" : "");
    btn.textContent = code.toUpperCase();
    btn.type = "button";
    btn.addEventListener("click", () => switchLanguage(code));
    container.appendChild(btn);
  });
}

function renderInstallLangToggle() {
  renderLangToggle("installLangToggle");
}

function bootstrapInstallMode() {
  updateBodyLanguageClass(shellLanguage);
  renderShellTexts();
  applyI18n(document);

  if (!unsubscribeLanguage) {
    unsubscribeLanguage = onShellLanguageChange((lang) => {
      if (!TEXTS[lang]) return;
      shellLanguage = lang;
      shellTexts = TEXTS[shellLanguage];
      updateBodyLanguageClass(shellLanguage);
      renderShellTexts();
      applyI18n(document);
      renderInstallHints();
      renderInstallLangToggle();
    });
    window.addEventListener("beforeunload", () => {
      if (unsubscribeLanguage) unsubscribeLanguage();
      unsubscribeLanguage = null;
    });
  }

  // Show splash immediately — skip loading screen
  showScreen("splash");
  document.body.classList.add("splash-ready");
  const loadingBlock = document.getElementById("splashLoadingBlock");
  const mainBlock = document.getElementById("splashMainContent");
  const logoEl = document.getElementById("splashLogo");
  const logoWrap = document.querySelector(".splash-logo-wrap");
  if (loadingBlock) loadingBlock.classList.add("hidden");
  if (mainBlock) mainBlock.classList.remove("hidden");
  if (logoEl) logoEl.classList.add("logo-animated");
  if (logoWrap) logoWrap.classList.add("logo-animated");

  const splashAssets = loadSplashAssets();
  if (splashAssets.logoLoader) splashAssets.logoLoader().catch(() => {});
  if (splashAssets.backgroundLoader) splashAssets.backgroundLoader().catch(() => {});

  // Only show install button + help message; hide play/train/resume/actions
  document.getElementById("splashContinueBtn")?.classList.add("hidden");
  document.getElementById("splashTrainBtn")?.classList.add("hidden");
  document.getElementById("resumeMatchBtn")?.classList.add("hidden");
  document.getElementById("installRequired")?.classList.remove("hidden");
  const actions = document.querySelector(".splash-actions");
  if (actions) actions.classList.add("hidden");

  renderInstallHints();
  renderInstallLangToggle();
  setupInstallFlow();
  preventMobileZoom();
  registerServiceWorker();
  scaleGame();
  window.addEventListener("resize", scaleGame);
  window.addEventListener("orientationchange", scaleGame);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scaleGame);
    window.visualViewport.addEventListener("scroll", scaleGame);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", isAppInstalled() ? bootstrapShell : bootstrapInstallMode);
} else {
  (isAppInstalled() ? bootstrapShell : bootstrapInstallMode)();
}

let swReloading = false;
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (swReloading) return;
    swReloading = true;
    window.location.reload();
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register("service-worker.js", { updateViaCache: "none" })
    .then((registration) => {
      logger.debug("Service worker registered");
      if (navigator.onLine === true) {
        registration.update().catch(() => {});
      }
      if (registration.waiting) {
        registration.waiting.postMessage({ type: "skip-waiting" });
      }
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            const waiting = registration.waiting || installing;
            if (waiting) {
              waiting.postMessage({ type: "skip-waiting" });
            }
          }
        });
      });
      // Periodic update check (every 5 min) + on visibility (when user
      // re-focuses the app after switching apps or unlocking the phone).
      setInterval(() => registration.update().catch(() => {}), 5 * 60 * 1000);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) registration.update().catch(() => {});
      });
    })
    .catch((err) => logger.error("Service worker registration failed", err));
}

function updatePreviewBadge() {
  const badge = document.getElementById("previewLogoBadge");
  if (!badge) return;
  const shouldShow = IS_PREVIEW || IS_LOCAL;
  badge.classList.toggle("hidden", !shouldShow);
  badge.textContent = IS_LOCAL && !IS_PREVIEW ? "LOCAL" : "PREVIEW";
  badge.classList.remove("is-active");
  void badge.offsetWidth;
  if (shouldShow) badge.classList.add("is-active");
}


function applySimulatedKnownNames() {
  if (window.__simulatedNamesApplied) return false;
  if (!Array.isArray(SIMULATED_KNOWN_NAMES) || !SIMULATED_KNOWN_NAMES.length) {
    return false;
  }
  window.__simulatedNamesApplied = true;
  const state = loadState();
  const existing = Array.isArray(state.settings?.knownPlayerNames)
    ? state.settings.knownPlayerNames
    : [];
  const merged = [];
  const seen = new Set();
  [...existing, ...SIMULATED_KNOWN_NAMES].forEach((raw) => {
    const name = String(raw || "").trim();
    if (!name) return;
    const norm = normalizePlayerName(name);
    if (seen.has(norm)) return;
    seen.add(norm);
    merged.push(name);
  });
  updateState({ settings: { knownPlayerNames: merged } });
  return true;
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
    if (!event.data) return;
    if (event.data.type === "refresh") {
      triggerReload();
      return;
    }
    if (event.data.type === "sw-version") {
      const ver = event.data.version || "unknown";
      const cache = event.data.cache || "";
      logger.info(`Service worker version ${ver}${cache ? ` (${cache})` : ""}`);
    }
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    triggerReload();
  });
}

function requestServiceWorkerVersion() {
  if (!("serviceWorker" in navigator)) return;
  const send = (ctrl) => {
    if (!ctrl || typeof ctrl.postMessage !== "function") return;
    ctrl.postMessage({ type: "get-sw-version" });
  };
  if (navigator.serviceWorker.controller) {
    send(navigator.serviceWorker.controller);
    return;
  }
  navigator.serviceWorker.ready.then((reg) => send(reg.active)).catch(() => {});
}

function handleLanguageChange(lang) {
  if (!TEXTS[lang]) return;
  shellLanguage = lang;
  shellTexts = TEXTS[shellLanguage];
  updateBodyLanguageClass(shellLanguage);
  renderShellTexts();
  applyI18n(document);
  _showAuthEmailStep(_authMode, document.getElementById('authEmailInput')?.value || null);
  if (!document.getElementById('authProfileStep')?.classList.contains('hidden')) _renderOnboardingTexts()
  renderLangToggle("authLangToggle");
  const st = matchController.getState();
  if (st) renderMatchFromState(st);
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
  title.textContent = shellTexts.debugLogTitle || "Debug Log";
  const filterRow = document.createElement("div");
  filterRow.className = "debug-filter-row";
  const filterLabel = document.createElement("span");
  filterLabel.textContent = "Filtro";
  const filterSelect = document.createElement("select");
  filterSelect.className = "debug-filter-select";
  ["debug", "info", "warn", "error"].forEach((value) => {
    const opt = document.createElement("option");
    opt.value = value;
    filterSelect.appendChild(opt);
  });
  const storedFilter = localStorage.getItem("debugLogFilter");
  if (storedFilter && ["debug", "info", "warn", "error"].includes(storedFilter)) {
    filterSelect.value = storedFilter;
  } else {
    filterSelect.value = "info";
  }
  filterSelect.addEventListener("change", () => {
    localStorage.setItem("debugLogFilter", filterSelect.value);
    render();
  });
  filterRow.append(filterLabel, filterSelect);
  const list = document.createElement("div");
  panel.appendChild(title);
  panel.appendChild(filterRow);
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
    const allEntries = getLogs();
    const rank = { debug: 0, info: 1, warn: 2, error: 3 };
    const filter = filterSelect.value || "info";
    const minRank = rank[filter] ?? rank.info;
    const entries = allEntries.filter((entry) => (rank[entry.level] ?? 0) >= minRank);
    list.innerHTML = "";
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "debug-log-empty";
      empty.textContent = shellTexts.debugLogEmpty || "Sin entradas";
      list.appendChild(empty);
      return;
    }
    entries.forEach((entry) => {
      const item = document.createElement("div");
      item.className = `debug-log-entry ${entry.level || ""}`;
      const ctx =
        entry.context && entry.context.length
          ? `<div class="ctx">${entry.context
              .map((c) => {
                if (typeof c === "string") return c;
                try {
                  return JSON.stringify(c);
                } catch (err) {
                  return String(c);
                }
              })
              .join(" | ")}</div>`
          : "";
      item.innerHTML = `<div class="debug-log-msg"><strong>[${entry.level.toUpperCase()}]</strong> ${entry.message}</div>
        ${ctx}
        <div class="meta"><span>${new Date(entry.time).toLocaleTimeString()}</span><span>${entry.source.toUpperCase()}</span></div>`;
      list.appendChild(item);
    });
    list.scrollTop = list.scrollHeight;
  }

  debugPanelTitleEl = title;
  debugFilterLabelEl = filterLabel;
  debugFilterSelectEl = filterSelect;
  updateDebugFilterLabels();
  render();
  onLog(() => render());
  updateDebugScale(container);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => updateDebugScale(container));
  }
  window.addEventListener("resize", () => updateDebugScale(container));
}

function fetchVersionFile() {
  if (isOfflineStandaloneIOS()) return;
  const doFetch = () =>
    fetch("src/core/version.js", { cache: "no-store" }).catch((err) =>
      logger.warn("Version file fetch failed", err)
    );
  if ("serviceWorker" in navigator) {
    if (navigator.serviceWorker.controller) {
      doFetch();
      return;
    }
    navigator.serviceWorker.ready.then(doFetch).catch(doFetch);
    return;
  }
  doFetch();
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

      if (!pwaEl.isConnected) {
        document.body.appendChild(pwaEl);
      } else if (pwaEl.parentElement !== document.body) {
        document.body.appendChild(pwaEl);
      }

      const installBtn = document.getElementById("installAppBtn");
      if (installBtn) {
        installBtn.addEventListener("click", () => triggerPwaInstall(pwaEl, true));
        installButtonEl = installBtn;
      }
      pwaInstallEl = pwaEl;
      updateInstallCopy();
      updateInstallButtonVisibility();

      window.addEventListener("appinstalled", () => {
        updateInstallButtonVisibility();
        applyInstallGate();
      });
      window.matchMedia &&
        window
          .matchMedia("(display-mode: standalone)")
          .addEventListener("change", () => {
            updateInstallButtonVisibility();
            applyInstallGate();
          });

      if (fromInstall) {
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
        .then((outcome) => logger.debug(`Install choice: ${outcome}`))
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
  } else if (pwaEl.parentElement !== document.body) {
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

async function requestPersistentStorage() {
  if (persistentStorageChecked) return;
  persistentStorageChecked = true;
  if (!(isStandaloneApp() || fromPWA)) return;
  const storage = navigator.storage;
  if (!storage || typeof storage.persist !== "function") return;
  try {
    const granted = await storage.persist();
    if (granted) {
      persistentStorageGranted = true;
      logger.debug("Persistent storage granted");
    } else {
      logger.warn("Persistent storage denied");
    }
  } catch (err) {
    logger.warn("Persistent storage request failed", err);
  }
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

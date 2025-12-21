import { loadState, updateState } from "../core/stateStore.js";

export const TEXTS = {
  es: {
    languageName: "Español",
    appTitle: "The Letter Loom ES",
    appShortName: "Letter Loom",
    appDescription: "El juego de cartas más divertido de todos los tiempos!",
    splashTitle: "Empezar partida",
    splashSubtitle: "Controla los cronos y la puntuación del juego de cartas.",
    splashContinue: "Continuar",
    splashResume: "Reanudar partida guardada",
    splashHelp: "Ver instrucciones",
    splashLoadingLabel: "Cargando...",
    setupTitle: "Configurar partida",
    setupSubtitle: "Ajusta jugadores, tiempos y modo de juego.",
    playersTitle: "Jugadores",
    playerLabel: "Jugador",
    addPlayer: "Añadir jugador",
    timersTitle: "Cronómetros",
    strategyTimerLabel: "Estrategia (segundos)",
    creationTimerLabel: "Creación (segundos)",
    startGame: "Comenzar partida",
    liveTitle: "Partida en curso",
    phaseTitle: "Fases y cronos",
    strategyPhaseLabel: "Fase de estrategia",
    creationPhaseLabel: "Fase de creación",
    startStrategy: "Iniciar estrategia",
    startCreation: "Iniciar creación",
    goToScoring: "Ir a puntuación",
    scoringTitle: "Puntuación de la baza",
    scoringNote: "Introduce la palabra y los puntos de cada jugador.",
    saveBaza: "Guardar baza",
    editHistory: "Editar historial",
    historyTitle: "Histórico y correcciones",
    backToLive: "Volver a partida",
    soundOn: "Sonido activado",
    soundOff: "Sonido silenciado",
    apply: "Aceptar",
    cancel: "Cancelar",
    save: "Guardar",
    ok: "OK",
    settingsTitle: "Ajustes",
    settingsSound: "Sonido",
    settingsMusic: "Música",
    settingsLanguage: "Idioma",
    footer: "© {year} The Letter Loom",
    installPromptTitle: "Instalar Letter Loom",
    installPromptDescription:
      "Instala el juego para acceder más rápido y jugar a pantalla completa incluso sin conexión.",
    installButtonText: "Instalar ahora",
    installCancelText: "Ahora no",
    prototypeEnableWakeLock: "Mantener pantalla activa",
    prototypeDisableWakeLock: "Permitir bloqueo automático",
    wakeLockStatusActiveStandard: "Pantalla activa (API estándar).",
    wakeLockStatusReleased: "Pantalla puede bloquearse (liberado por el sistema).",
    wakeLockStatusActiveFallback: "Pantalla activa (vídeo de respaldo).",
    wakeLockStatusFallbackFailed: "No se pudo mantener la pantalla activa (vídeo).",
    wakeLockStatusInactive: "Pantalla puede bloquearse.",
    orientationMessage: "Pon tu dispositivo en VERTICAL para jugar",
    prototypeVideoFallback: "Tu navegador no soporta el elemento de video.",
  },
  en: {
    languageName: "English",
    appTitle: "The Letter Loom",
    appShortName: "Letter Loom",
    appDescription: "The most fun card game of all time!",
    splashTitle: "Start a match",
    splashSubtitle: "Run timers and scoring for the card game.",
    splashContinue: "Continue",
    splashResume: "Resume saved match",
    splashHelp: "View instructions",
    splashLoadingLabel: "Loading...",
    setupTitle: "Set up the game",
    setupSubtitle: "Configure players, timers, and mode.",
    playersTitle: "Players",
    playerLabel: "Player",
    addPlayer: "Add player",
    timersTitle: "Timers",
    strategyTimerLabel: "Strategy (seconds)",
    creationTimerLabel: "Creation (seconds)",
    startGame: "Start game",
    liveTitle: "Live game",
    phaseTitle: "Phases & timers",
    strategyPhaseLabel: "Strategy phase",
    creationPhaseLabel: "Creation phase",
    startStrategy: "Start strategy",
    startCreation: "Start creation",
    goToScoring: "Go to scoring",
    scoringTitle: "Baza scoring",
    scoringNote: "Enter each player's word and points.",
    saveBaza: "Save baza",
    editHistory: "Edit history",
    historyTitle: "History & corrections",
    backToLive: "Back to game",
    soundOn: "Sound on",
    soundOff: "Sound muted",
    apply: "Apply",
    cancel: "Cancel",
    save: "Save",
    ok: "OK",
    settingsTitle: "Settings",
    settingsSound: "Sound",
    settingsMusic: "Music",
    settingsLanguage: "Language",
    footer: "© {year} The Letter Loom",
    installPromptTitle: "Install Letter Loom",
    installPromptDescription:
      "Add the game for quick access and full-screen play, even offline.",
    installButtonText: "Install now",
    installCancelText: "Not now",
    prototypeEnableWakeLock: "Keep screen on",
    prototypeDisableWakeLock: "Allow screen to sleep",
    wakeLockStatusActiveStandard: "Screen on (standard API).",
    wakeLockStatusReleased: "Screen may sleep (released by system).",
    wakeLockStatusActiveFallback: "Screen on (video fallback).",
    wakeLockStatusFallbackFailed: "Could not keep screen on (video error).",
    wakeLockStatusInactive: "Screen may sleep.",
    orientationMessage: "Put your device in PORTRAIT to play",
    prototypeVideoFallback: "Your browser does not support the video element.",
  },
};

const LANGUAGE_EVENT = "letterloom:languagechange";
let currentLanguage = resolveShellLanguage();
let languageEventTarget = null;

function getEventTarget() {
  if (languageEventTarget) return languageEventTarget;
  if (typeof window !== "undefined" && window instanceof EventTarget) {
    languageEventTarget = window;
  } else {
    languageEventTarget = new EventTarget();
  }
  return languageEventTarget;
}

function normalizeLanguage(lang) {
  if (!lang || typeof lang !== "string") return null;
  const cleaned = lang.trim().toLowerCase();
  if (TEXTS[cleaned]) return cleaned;
  const short = cleaned.split("-")[0];
  if (TEXTS[short]) return short;
  return null;
}

export function getDefaultLanguage() {
  const candidates = [];
  if (typeof navigator !== "undefined") {
    if (Array.isArray(navigator.languages)) {
      candidates.push(...navigator.languages);
    }
    if (navigator.language) {
      candidates.push(navigator.language);
    }
  }
  const normalized = candidates.map((lang) => normalizeLanguage(lang)).find(Boolean);
  return normalized || "es";
}

export function resolveShellLanguage() {
  try {
    const { settings } = loadState();
    const normalized = normalizeLanguage(settings.language);
    if (normalized) return normalized;
  } catch {
    // ignore storage errors
  }
  return getDefaultLanguage();
}

export function getShellLanguage() {
  return currentLanguage;
}

export function setShellLanguage(lang, { silent = false } = {}) {
  const normalized = normalizeLanguage(lang);
  if (!normalized) return currentLanguage;
  if (normalized === currentLanguage && !silent) return currentLanguage;
  currentLanguage = normalized;
  updateState({ settings: { language: currentLanguage } });
  if (!silent) {
    const target = getEventTarget();
    target.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: { lang: currentLanguage } }));
  }
  return currentLanguage;
}

export function onShellLanguageChange(callback) {
  const target = getEventTarget();
  const handler = (event) => callback(event.detail.lang);
  target.addEventListener(LANGUAGE_EVENT, handler);
  return () => target.removeEventListener(LANGUAGE_EVENT, handler);
}

export function getAvailableLanguages() {
  return Object.keys(TEXTS);
}

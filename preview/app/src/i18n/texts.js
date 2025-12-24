import { loadState, updateState } from "../core/stateStore.js";

export const TEXTS = {
  es: {
    languageName: "Espanol",
    appTitle: "The Letter Loom",
    appShortName: "Letter Loom",
    appDescription: "El juego de cartas mas divertido de todos los tiempos!",
    splashTitle: "Empezar partida",
    splashSubtitle: "Controla los cronos y la puntuacion del juego de cartas.",
    splashContinue: "Jugar!",
    splashResume: "Reanudar partida guardada",
    splashHelp: "Ver instrucciones",
    splashLoadingLabel: "Cargando...",
    setupTitle: "Configurar partida",
    setupSubtitle: "Ajusta jugadores, tiempos y modo de juego.",
    playersTitle: "Jugadores",
    playerLabel: "Jugador",
    addPlayer: "Anadir jugador",
    timersTitle: "Cronometros",
    strategyTimerLabel: "Estrategia (segundos)",
    creationTimerLabel: "Creacion (segundos)",
    startGame: "Comenzar partida",
    liveTitle: "Partida en curso",
    phaseTitle: "Fases y cronos",
    strategyPhaseLabel: "Fase de estrategia",
    creationPhaseLabel: "Fase de creacion",
    startStrategy: "Iniciar estrategia",
    startCreation: "Iniciar creacion",
    goToScoring: "Ir a puntuacion",
    scoringTitle: "Puntuacion de la baza",
    scoringNote: "Introduce la palabra y los puntos de cada jugador.",
    saveBaza: "Guardar baza",
    editHistory: "Editar historial",
    historyTitle: "Historico y correcciones",
    backToLive: "Volver a partida",
    soundOn: "Sonido activado",
    soundOff: "Sonido silenciado",
    apply: "Aceptar",
    cancel: "Cancelar",
    save: "Guardar",
    ok: "OK",
    settingsTitle: "Ajustes",
    settingsSound: "Sonido",
    settingsMusic: "Musica",
    settingsLanguage: "Idioma",
    footer: "© {year} The Letter Loom",
    installPromptTitle: "Instalar Letter Loom",
    installPromptDescription:
      "Instala el juego para acceder mas rapido y jugar a pantalla completa incluso sin conexion.",
    installButtonText: "Instalar",
    installCancelText: "Ahora no",
    prototypeEnableWakeLock: "Mantener pantalla activa",
    prototypeDisableWakeLock: "Permitir bloqueo automatico",
    wakeLockStatusActiveStandard: "Pantalla activa (API estandar).",
    wakeLockStatusReleased: "Pantalla puede bloquearse (liberado por el sistema).",
    wakeLockStatusActiveFallback: "Pantalla activa (video de respaldo).",
    wakeLockStatusFallbackFailed: "No se pudo mantener la pantalla activa (video).",
    wakeLockStatusInactive: "Pantalla puede bloquearse.",
    orientationmassage: "Pon tu dispositivo en VERTICAL para jugar",
    prototypeVideoFallback: "Tu navegador no soporta el elemento de video.",
  },
  en: {
    languageName: "English",
    appTitle: "The Letter Loom",
    appShortName: "Letter Loom",
    appDescription: "The most fun card game of all time!",
    splashTitle: "Start a match",
    splashSubtitle: "Run timers and scoring for the card game.",
    splashContinue: "Play!",
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
    phaseTitle: "Phases and timers",
    strategyPhaseLabel: "Strategy phase",
    creationPhaseLabel: "Creation phase",
    startStrategy: "Start strategy",
    startCreation: "Start creation",
    goToScoring: "Go to scoring",
    scoringTitle: "Baza scoring",
    scoringNote: "Enter each player's word and points.",
    saveBaza: "Save baza",
    editHistory: "Edit history",
    historyTitle: "History and corrections",
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
    installButtonText: "Install",
    installCancelText: "Not now",
    prototypeEnableWakeLock: "Keep screen on",
    prototypeDisableWakeLock: "Allow screen to sleep",
    wakeLockStatusActiveStandard: "Screen on (standard API).",
    wakeLockStatusReleased: "Screen may sleep (released by system).",
    wakeLockStatusActiveFallback: "Screen on (video fallback).",
    wakeLockStatusFallbackFailed: "Could not keep screen on (video error).",
    wakeLockStatusInactive: "Screen may sleep.",
    orientationmassage: "Put your device in PORTRAIT to play",
    prototypeVideoFallback: "Your browser does not support the video element.",
  },
};

const languageListeners = new Set();

export function getAvailableLanguages() {
  return Object.keys(TEXTS);
}

export function getShellLanguage() {
  const state = loadState();
  const saved = state.settings?.language;
  const nav = (navigator.language || "").slice(0, 2).toLowerCase();
  if (saved && TEXTS[saved]) return saved;
  if (TEXTS[nav]) return nav;
  return "en";
}

export function setShellLanguage(lang) {
  if (!TEXTS[lang]) return;
  updateState({ settings: { language: lang } });
  languageListeners.forEach((fn) => {
    try {
      fn(lang);
    } catch (e) {}
  });
}

export function onShellLanguageChange(callback) {
  if (typeof callback === "function") {
    languageListeners.add(callback);
    return () => languageListeners.delete(callback);
  }
  return () => {};
}

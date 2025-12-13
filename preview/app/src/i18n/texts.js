export const TEXTS = {
  es: {
    prototypeTitle: "Letter Loom Prototype",
    prototypeHeroSubtitle: "Prototipo",
    prototypeHeroDescription:
      "Esta área se escala y se centra automáticamente.<br />Prueba en diferentes móviles y orientaciones.",
    prototypeOrientationMessage: "Gira tu dispositivo a <b>VERTICAL</b> para jugar",
    prototypeEnableWakeLock: "Mantener pantalla activa",
    prototypeDisableWakeLock: "Permitir bloqueo automático",
    prototypeToggleLorem: "Alternar Lorem",
    prototypeToggleHeader: "Mostrar/ocultar header",
    prototypeToggleFooter: "Mostrar/ocultar footer",
    languageToggleToEnglish: "Cambiar a inglés",
    languageToggleToSpanish: "Cambiar a español",
    prototypeLoremShort: "Lorem ipsum corto para comprobar el escalado.",
    prototypeLoremLong:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque varius lorem at mi pretium, sed dignissim sapien imperdiet. Donec eu orci vitae massa consequat fringilla. Sed aliquam, turpis ut accumsan finibus, neque sem malesuada elit, non tristique ex nulla eu velit. Etiam vitae consequat erat. Integer sit amet hendrerit mauris. Nulla facilisi. Cras porta augue at orci convallis posuere.",
    prototypeFooter: "© {year} Letter Loom",
    prototypeVideoFallback: "Tu navegador no soporta el elemento de video.",
    prototypeInstalledLabel: "Instalado",
    prototypeDisplayModeLabel: "Modo",
    prototypeFromPWALabel: "Parámetro fromPWA",
    prototypeGameLabel: "Juego",
    prototypeDeviceLabel: "Dispositivo",
    prototypeZoomLabel: "Zoom",
    installPromptTitle: "Instalar Letter Loom",
    installPromptDescription:
      "Instala el juego para acceder más rápidamente y poder jugar a pantalla completa y sin conexión o consumir datos de internet.",
    installButtonText: "Instalar ahora",
    installCancelText: "Ahora no",
    wakeLockStatusActiveStandard: "Pantalla activa (API estándar).",
    wakeLockStatusReleased: "Pantalla puede bloquearse (liberado por el sistema).",
    wakeLockStatusActiveFallback: "Pantalla activa (vídeo de respaldo).",
    wakeLockStatusFallbackFailed: "No se pudo mantener la pantalla activa (vídeo).",
    wakeLockStatusInactive: "Pantalla puede bloquearse.",
  },
  en: {
    prototypeTitle: "Letter Loom Prototype",
    prototypeHeroSubtitle: "Prototype",
    prototypeHeroDescription:
      "This area scales and centers itself automatically.<br />Try it on different phones and orientations.",
    prototypeOrientationMessage: "Rotate your device to <b>PORTRAIT</b> to play",
    prototypeEnableWakeLock: "Keep screen on",
    prototypeDisableWakeLock: "Allow screen to sleep",
    prototypeToggleLorem: "Toggle Lorem",
    prototypeToggleHeader: "Show/Hide header",
    prototypeToggleFooter: "Show/Hide footer",
    languageToggleToEnglish: "Switch to English",
    languageToggleToSpanish: "Switch to Spanish",
    prototypeLoremShort: "Short lorem ipsum to check scaling.",
    prototypeLoremLong:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque varius lorem at mi pretium, sed dignissim sapien imperdiet. Donec eu orci vitae massa consequat fringilla. Sed aliquam, turpis ut accumsan finibus, neque sem malesuada elit, non tristique ex nulla eu velit. Etiam vitae consequat erat. Integer sit amet hendrerit mauris. Nulla facilisi. Cras porta augue at orci convallis posuere.",
    prototypeFooter: "© {year} Letter Loom",
    prototypeVideoFallback: "Your browser does not support the video element.",
    prototypeInstalledLabel: "Installed",
    prototypeDisplayModeLabel: "Display mode",
    prototypeFromPWALabel: "fromPWA flag",
    prototypeGameLabel: "Game",
    prototypeDeviceLabel: "Device",
    prototypeZoomLabel: "Zoom",
    installPromptTitle: "Install Letter Loom",
    installPromptDescription:
      "Add the game to your home screen for faster access and to play in full-screen mode and offline or without using mobile data.",
    installButtonText: "Install now",
    installCancelText: "Not now",
    wakeLockStatusActiveStandard: "Screen on (standard API).",
    wakeLockStatusReleased: "Screen may sleep (released by system).",
    wakeLockStatusActiveFallback: "Screen on (video fallback).",
    wakeLockStatusFallbackFailed: "Could not keep screen on (video error).",
    wakeLockStatusInactive: "Screen may sleep.",
  },
};

const LANGUAGE_STORAGE_KEY = "letterloom_lang";
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
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    const normalized = normalizeLanguage(stored);
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
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, currentLanguage);
  } catch {
    // ignore storage errors
  }
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

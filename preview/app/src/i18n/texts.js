export const TEXTS = {
  es: {
    prototypeTitle: "Letter Loom Prototype",
    prototypeHeroSubtitle: "Prototipo escalado",
    prototypeHeroDescription:
      "Este área se escala y se centra automáticamente.<br />Prueba en diferentes móviles y orientaciones.",
    prototypeOrientationMessage: "Gira tu dispositivo a <b>VERTICAL</b> para jugar",
    prototypeEnableWakeLock: "Mantener pantalla activa",
    prototypeDisableWakeLock: "Permitir bloqueo automático",
    prototypeToggleLorem: "Alternar Lorem",
    prototypeToggleHeader: "Mostrar/ocultar header",
    prototypeToggleFooter: "Mostrar/ocultar footer",
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
    installPromptDescription: "Añade el juego a tu pantalla de inicio para jugar sin conexión y en modo pantalla completa.",
    installButtonText: "Instalar ahora",
    installCancelText: "Ahora no",
    iosInstructionsHeader: "Añadir a pantalla de inicio",
    iosInstructionsSubheader: "Abre el menú de compartir y pulsa 'Añadir a pantalla de inicio'",
    wakeLockStatusActiveStandard: "Pantalla activa (API estándar).",
    wakeLockStatusReleased: "Pantalla puede bloquearse (liberado por el sistema).",
    wakeLockStatusActiveFallback: "Pantalla activa (vídeo de respaldo).",
    wakeLockStatusFallbackFailed: "No se pudo mantener la pantalla activa (vídeo).",
    wakeLockStatusInactive: "Pantalla puede bloquearse."
  },
  en: {
    prototypeTitle: "Letter Loom Prototype",
    prototypeHeroSubtitle: "Scaled prototype",
    prototypeHeroDescription:
      "This area scales and centers itself automatically.<br />Try it on different phones and orientations.",
    prototypeOrientationMessage: "Rotate your device to <b>PORTRAIT</b> to play",
    prototypeEnableWakeLock: "Keep screen on",
    prototypeDisableWakeLock: "Allow screen to sleep",
    prototypeToggleLorem: "Toggle Lorem",
    prototypeToggleHeader: "Show/Hide header",
    prototypeToggleFooter: "Show/Hide footer",
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
    installPromptDescription: "Add the game to your home screen for offline play and full-screen mode.",
    installButtonText: "Install now",
    installCancelText: "Not now",
    iosInstructionsHeader: "Add to Home Screen",
    iosInstructionsSubheader: "Open the share menu and tap 'Add to Home Screen'",
    wakeLockStatusActiveStandard: "Screen on (standard API).",
    wakeLockStatusReleased: "Screen may sleep (released by system).",
    wakeLockStatusActiveFallback: "Screen on (video fallback).",
    wakeLockStatusFallbackFailed: "Could not keep screen on (video error).",
    wakeLockStatusInactive: "Screen may sleep."
  }
};

export function getDefaultLanguage() {
  return "es";
}

export function resolveShellLanguage() {
  try {
    const stored = localStorage.getItem("letterloom_lang");
    if (stored && TEXTS[stored]) {
      return stored;
    }
  } catch {
    // ignore storage errors
  }
  return getDefaultLanguage();
}

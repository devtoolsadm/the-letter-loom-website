const LANDING_TEXTS = {
  en: {
    tagline: "Wordplay for every table.",
    heroEyebrow: "The cooperative word game",
    heroTitle: "Letter Loom",
    heroSubtitle: "Build words together, keep the momentum, and bring everyone to the same table.",
    ctaSupport: "Support on Kickstarter",
    ctaPlay: "Play online",
    heroCardTitle: "Everything you need to play",
    heroPoint1: "Play online without installing.",
    heroPoint2: "Install the PWA for offline nights.",
    heroPoint3: "Share the QR so friends install fast.",
    appEyebrow: "Support app",
    appTitle: "Play, install, share",
    appSubtitle: "Choose how you want to start: jump in online, install here, or send the QR to another device.",
    appCardPlayTitle: "Play online",
    appCardPlayCopy: "Open the game in your browser. No install required.",
    appCardPlayCta: "Open game",
    appCardInstallTitle: "Install on this device",
    appCardInstallCopy: "Add Letter Loom to your home screen in one tap.",
    appCardInstallCta: "Install now",
    appCardQrTitle: "Install on another device",
    appCardQrCopy: "Scan the QR with any phone to install there.",
    appCardQrHint: "Replace with your production domain.",
    helpEyebrow: "Help",
    helpTitle: "Learn the game fast",
    helpQuickTitle: "Quick guide",
    helpQuickCopy: "Start playing in minutes with a condensed overview.",
    helpQuickCta: "Open quick guide",
    helpManualTitle: "Full manual",
    helpManualCopy: "All rules, variants, and scoring in one place.",
    helpManualCta: "Download manual (soon)",
    helpVideoTitle: "Video walkthrough",
    helpVideoCopy: "Watch a short explainer to learn the flow.",
    helpVideoCta: "Watch video (soon)",
    socialEyebrow: "Connect",
    socialTitle: "Follow the journey",
    socialInstagram: "Sneak peeks and community highlights.",
    socialTikTok: "Short clips with tips and plays.",
    contactTitle: "Contact",
    contactCopy: "hello@letterloom.game",
    footerTag: "Built for every game night.",
  },
  es: {
    tagline: "Palabras para todas las mesas.",
    heroEyebrow: "El juego cooperativo de palabras",
    heroTitle: "Letter Loom",
    heroSubtitle: "Construid palabras juntos, mantened el ritmo y traed a todos a la misma mesa.",
    ctaSupport: "Apóyanos en Kickstarter",
    ctaPlay: "Jugar online",
    heroCardTitle: "Todo lo que necesitas para jugar",
    heroPoint1: "Juega online sin instalar.",
    heroPoint2: "Instala la PWA para jugar sin conexión.",
    heroPoint3: "Comparte el QR para que otros instalen rápido.",
    appEyebrow: "App de apoyo",
    appTitle: "Juega, instala, comparte",
    appSubtitle: "Elige cómo empezar: juega online, instala aquí o envía el QR a otro dispositivo.",
    appCardPlayTitle: "Jugar online",
    appCardPlayCopy: "Abre el juego en tu navegador. No hace falta instalar.",
    appCardPlayCta: "Abrir juego",
    appCardInstallTitle: "Instalar en este dispositivo",
    appCardInstallCopy: "Añade Letter Loom a tu pantalla de inicio con un toque.",
    appCardInstallCta: "Instalar ahora",
    appCardQrTitle: "Instalar en otro dispositivo",
    appCardQrCopy: "Escanea el QR con cualquier móvil para instalar allí.",
    appCardQrHint: "Sustituye con tu dominio de producción.",
    helpEyebrow: "Ayuda",
    helpTitle: "Aprende el juego rápido",
    helpQuickTitle: "Guía rápida",
    helpQuickCopy: "Empieza a jugar en minutos con un resumen condensado.",
    helpQuickCta: "Abrir guía rápida",
    helpManualTitle: "Manual completo",
    helpManualCopy: "Todas las reglas, variantes y puntuación en un solo lugar.",
    helpManualCta: "Descargar manual (pronto)",
    helpVideoTitle: "Vídeo explicativo",
    helpVideoCopy: "Mira un corto para aprender el flujo.",
    helpVideoCta: "Ver vídeo (pronto)",
    socialEyebrow: "Conecta",
    socialTitle: "Sigue el viaje",
    socialInstagram: "Avances y momentos de la comunidad.",
    socialTikTok: "Clips cortos con trucos y jugadas.",
    contactTitle: "Contacto",
    contactCopy: "hello@letterloom.game",
    footerTag: "Creado para cada noche de juego.",
  },
};

const STORAGE_KEY = "letterloom_landing_lang";

function normalizeLang(lang) {
  if (!lang) return null;
  const clean = lang.toLowerCase();
  if (LANDING_TEXTS[clean]) return clean;
  const short = clean.split("-")[0];
  if (LANDING_TEXTS[short]) return short;
  return null;
}

function detectLanguage() {
  const fromStorage = normalizeLang(localStorage.getItem(STORAGE_KEY));
  if (fromStorage) return fromStorage;
  const candidates = [
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language,
  ];
  const detected = candidates.map(normalizeLang).find(Boolean);
  return detected || "en";
}

let currentLang = detectLanguage();

function setLanguage(lang) {
  const normalized = normalizeLang(lang);
  if (!normalized || normalized === currentLang) return;
  currentLang = normalized;
  localStorage.setItem(STORAGE_KEY, currentLang);
  render();
}

function populateLangSelect() {
  const select = document.getElementById("langSelect");
  if (!select) return;
  select.innerHTML = "";
  Object.keys(LANDING_TEXTS).forEach((code) => {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = code === "en" ? "English" : code === "es" ? "Español" : code;
    select.appendChild(opt);
  });
  select.value = currentLang;
  select.addEventListener("change", (e) => setLanguage(e.target.value));
}

function renderTextNodes() {
  const dict = LANDING_TEXTS[currentLang];
  document.documentElement.lang = currentLang;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.getAttribute("data-i18n");
    if (dict[key]) node.textContent = dict[key];
  });
}

function renderYear() {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
}

function render() {
  renderTextNodes();
  renderYear();
}

document.addEventListener("DOMContentLoaded", () => {
  populateLangSelect();
  render();
});

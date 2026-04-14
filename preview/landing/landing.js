const LANDING_TEXTS = {
  es: {
    pageTitle: "Letter Loom",
    metaDescription: "Letter Loom, el juego de letras que te dejará sin palabras.",
    slogan: "El juego de letras que te dejará sin palabras",
    buyCta: "Comprar",
    howCta: "Cómo se juega",
    buyGameCta: "Comprar el juego",
    emailLabel: "Email",
  },
  en: {
    pageTitle: "Letter Loom",
    metaDescription: "Letter Loom, the letter game that will leave you speechless.",
    slogan: "The letter game that will leave you speechless",
    buyCta: "Buy now",
    howCta: "How to play",
    buyGameCta: "Buy the game",
    emailLabel: "Email",
  },
};

const STORAGE_KEY = "letterloom_landing_lang";
const SLIDE_INTERVAL_MS = 4500;
const MAX_PARALLAX_X = 10;
const MAX_PARALLAX_Y = 8;

function normalizeLang(lang) {
  if (!lang) return null;
  const clean = String(lang).toLowerCase();
  if (LANDING_TEXTS[clean]) return clean;
  const short = clean.split("-")[0];
  return LANDING_TEXTS[short] ? short : null;
}

function detectLanguage() {
  try {
    const stored = normalizeLang(localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
  } catch (err) {
    console.warn("Language storage unavailable", err);
  }

  const candidates = [
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language,
  ];
  return candidates.map(normalizeLang).find(Boolean) || "es";
}

let currentLang = detectLanguage();
let activeSlide = 0;
let slideTimer = null;

function populateLangSelect() {
  const select = document.getElementById("langSelect");
  if (!select) return;

  select.innerHTML = "";
  Object.keys(LANDING_TEXTS).forEach((lang) => {
    const option = document.createElement("option");
    option.value = lang;
    option.textContent = lang === "es" ? "ES" : "EN";
    select.appendChild(option);
  });

  select.value = currentLang;
  select.addEventListener("change", (event) => {
    setLanguage(event.target.value);
  });
}

function renderTextNodes() {
  const dict = LANDING_TEXTS[currentLang];
  document.documentElement.lang = currentLang;
  document.title = dict.pageTitle;

  const metaDescription = document.querySelector('meta[name="description"]');
  if (metaDescription) {
    metaDescription.setAttribute("content", dict.metaDescription);
  }

  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.getAttribute("data-i18n");
    if (key && dict[key]) {
      node.textContent = dict[key];
    }
  });
}

function setLanguage(lang) {
  const normalized = normalizeLang(lang);
  if (!normalized || normalized === currentLang) return;

  currentLang = normalized;
  try {
    localStorage.setItem(STORAGE_KEY, currentLang);
  } catch (err) {
    console.warn("Language storage unavailable", err);
  }
  renderTextNodes();
}

function setSlide(index) {
  const slides = Array.from(document.querySelectorAll(".hero-slide"));
  const dots = Array.from(document.querySelectorAll(".hero-dot"));
  if (!slides.length) return;

  const normalized = ((index % slides.length) + slides.length) % slides.length;
  activeSlide = normalized;

  slides.forEach((slide, slideIndex) => {
    slide.classList.toggle("is-active", slideIndex === normalized);
  });
  dots.forEach((dot, dotIndex) => {
    dot.classList.toggle("is-active", dotIndex === normalized);
    dot.setAttribute("aria-pressed", dotIndex === normalized ? "true" : "false");
  });
}

function startCarousel() {
  const dots = Array.from(document.querySelectorAll(".hero-dot"));
  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      const target = Number(dot.getAttribute("data-slide-target"));
      setSlide(target);
      resetCarousel();
    });
  });

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  slideTimer = window.setInterval(() => {
    setSlide(activeSlide + 1);
  }, SLIDE_INTERVAL_MS);
}

function resetCarousel() {
  if (!slideTimer) return;
  window.clearInterval(slideTimer);
  slideTimer = window.setInterval(() => {
    setSlide(activeSlide + 1);
  }, SLIDE_INTERVAL_MS);
}

function initParallax() {
  const stage = document.getElementById("stage");
  const depthRoot = document.getElementById("heroDepth");
  if (!stage || !depthRoot) return;

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (prefersReducedMotion.matches) {
    document.body.classList.add("reduced-motion");
    return;
  }

  const layered = Array.from(document.querySelectorAll("[data-depth]"));
  const setTransforms = (ratioX, ratioY) => {
    layered.forEach((node) => {
      const depth = Number(node.getAttribute("data-depth")) || 0;
      const moveX = (ratioX * depth * MAX_PARALLAX_X) / 20;
      const moveY = (ratioY * depth * MAX_PARALLAX_Y) / 20;
      node.style.setProperty("--tx", `${moveX.toFixed(2)}px`);
      node.style.setProperty("--ty", `${moveY.toFixed(2)}px`);
    });

    depthRoot.style.transform = `rotateX(${(-ratioY * 2.2).toFixed(2)}deg) rotateY(${(
      ratioX * 2.8
    ).toFixed(2)}deg)`;
  };

  stage.addEventListener("pointermove", (event) => {
    const rect = stage.getBoundingClientRect();
    const ratioX = (event.clientX - rect.left) / rect.width - 0.5;
    const ratioY = (event.clientY - rect.top) / rect.height - 0.5;
    setTransforms(ratioX, ratioY);
  });

  stage.addEventListener("pointerleave", () => {
    setTransforms(0, 0);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  populateLangSelect();
  renderTextNodes();
  setSlide(0);
  startCarousel();
  initParallax();
});

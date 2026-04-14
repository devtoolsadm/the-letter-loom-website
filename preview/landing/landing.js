const LANDING_TEXTS = {
  es: {
    pageTitle: "Letter Loom",
    metaDescription: "Letter Loom, el juego de letras que te dejará sin palabras.",
    slogan: "El juego de letras que te dejará sin palabras",
    buyCta: "Comprar",
    howCta: "Cómo se juega",
    buyGameCta: "Comprar el juego",
    emailLabel: "Email",
    legalPrivacy: "Privacidad",
    legalCookies: "Cookies",
    legalNotice: "Aviso legal",
    legalDrawerClose: "Cerrar",
  },
  en: {
    pageTitle: "Letter Loom",
    metaDescription: "Letter Loom, the letter game that will leave you speechless.",
    slogan: "The letter game that will leave you speechless",
    buyCta: "Buy now",
    howCta: "How to play",
    buyGameCta: "Buy the game",
    emailLabel: "Email",
    legalPrivacy: "Privacy",
    legalCookies: "Cookies",
    legalNotice: "Legal notice",
    legalDrawerClose: "Close",
  },
};

const LEGAL_CONTENT = {
  es: {
    privacy: {
      title: "Política de privacidad",
      body: [
        "Esta landing de Letter Loom tiene carácter informativo y promocional. En esta fase no se realiza venta directa del juego desde esta página.",
        "El responsable de esta web es su titular como persona física. Si contactas por correo o por redes sociales, los datos que facilites se utilizarán únicamente para responderte o gestionar tu interés en el proyecto.",
        "No se cederán datos a terceros salvo obligación legal o cuando el propio contacto se produzca a través de plataformas externas como Instagram, TikTok, X o servicios de correo, que tienen sus propias políticas.",
        "Puedes ejercer tus derechos de acceso, rectificación o supresión escribiendo a <strong>info@theletterloom.com</strong>."
      ],
    },
    cookies: {
      title: "Política de cookies",
      body: [
        "Esta página no está orientada actualmente a la venta ni al perfilado comercial de usuarios.",
        "En la versión actual se pretende limitar el uso de cookies a las estrictamente técnicas o necesarias para el funcionamiento básico del sitio. Si más adelante se incorporan analítica, medición o servicios de terceros que requieran consentimiento, esta política se actualizará.",
        "Las plataformas externas enlazadas desde esta landing, como redes sociales o futuras páginas de reserva, pueden aplicar sus propias cookies cuando navegues fuera de este sitio."
      ],
    },
    legal: {
      title: "Aviso legal",
      body: [
        "Esta web es una landing informativa de <strong>Letter Loom</strong>, un proyecto actualmente en fase de difusión y validación de interés.",
        "El contenido mostrado tiene carácter promocional y puede cambiar durante el desarrollo del juego, su campaña o su futura comercialización.",
        "Para cualquier consulta relacionada con la web o el proyecto puedes escribir a <strong>info@theletterloom.com</strong>.",
        "Si el proyecto evoluciona a una actividad comercial formal, esta información legal se ampliará con los datos identificativos y regulatorios que correspondan."
      ],
    },
  },
  en: {
    privacy: {
      title: "Privacy policy",
      body: [
        "This Letter Loom landing page is informational and promotional. At this stage, the game is not sold directly through this website.",
        "The website is currently managed by its owner as an individual. If you contact us by email or through social media, the data you provide will only be used to reply or manage your interest in the project.",
        "No personal data will be shared with third parties unless required by law or when the contact itself takes place through external platforms such as Instagram, TikTok, X or email services, which have their own policies.",
        "You can request access, correction or deletion of your data by writing to <strong>info@theletterloom.com</strong>."
      ],
    },
    cookies: {
      title: "Cookies policy",
      body: [
        "This page is not currently focused on direct sales or commercial user profiling.",
        "At this stage, cookies are intended to be limited to strictly technical or necessary ones for the basic operation of the site. If analytics, tracking or third-party services requiring consent are added later, this policy will be updated.",
        "External platforms linked from this landing page, such as social media or future reservation pages, may apply their own cookies once you leave this site."
      ],
    },
    legal: {
      title: "Legal notice",
      body: [
        "This website is an informational landing page for <strong>Letter Loom</strong>, a project currently in its promotion and interest-validation phase.",
        "The content displayed is promotional in nature and may change as the game, its campaign or its future commercialization evolves.",
        "For any questions about the website or the project, you can write to <strong>info@theletterloom.com</strong>.",
        "If the project later becomes a formal commercial activity, this legal information will be expanded with the applicable identification and regulatory details."
      ],
    },
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
let openLegalKey = null;

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

  renderLegalLinks();
  renderLegalDrawer();
}

function renderLegalLinks() {
  const dict = LANDING_TEXTS[currentLang];
  document.querySelectorAll("[data-legal-open]").forEach((button) => {
    const key = button.getAttribute("data-legal-open");
    if (key === "privacy") button.textContent = dict.legalPrivacy;
    if (key === "cookies") button.textContent = dict.legalCookies;
    if (key === "legal") button.textContent = dict.legalNotice;
  });

  const closeButton = document.querySelector(".legal-close");
  if (closeButton) {
    closeButton.setAttribute("aria-label", dict.legalDrawerClose);
  }

  const yearNode = document.getElementById("legalYear");
  if (yearNode) {
    yearNode.textContent = String(new Date().getFullYear());
  }
}

function renderLegalDrawer() {
  const drawer = document.getElementById("legalDrawer");
  const title = document.getElementById("legalDrawerTitle");
  const body = document.getElementById("legalDrawerBody");
  if (!drawer || !title || !body) return;

  if (!openLegalKey) {
    drawer.hidden = true;
    drawer.setAttribute("aria-hidden", "true");
    return;
  }

  const section = LEGAL_CONTENT[currentLang]?.[openLegalKey];
  if (!section) return;

  title.textContent = section.title;
  body.innerHTML = section.body.map((paragraph) => `<p>${paragraph}</p>`).join("");
  drawer.hidden = false;
  drawer.setAttribute("aria-hidden", "false");
}

function openLegalDrawer(key) {
  openLegalKey = key;
  renderLegalDrawer();
}

function closeLegalDrawer() {
  openLegalKey = null;
  renderLegalDrawer();
}

function initLegalDrawer() {
  document.querySelectorAll("[data-legal-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.getAttribute("data-legal-open");
      if (!key) return;
      if (openLegalKey === key) {
        closeLegalDrawer();
        return;
      }
      openLegalDrawer(key);
    });
  });

  document.querySelectorAll("[data-legal-close]").forEach((node) => {
    node.addEventListener("click", closeLegalDrawer);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeLegalDrawer();
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
  initLegalDrawer();
  setSlide(0);
  startCarousel();
  initParallax();
});

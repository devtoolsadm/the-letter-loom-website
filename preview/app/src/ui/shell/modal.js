// Modal controller with stack, payloads and close events
const modalStack = [];
const LETTER_COLORS = [
  "var(--modal-stitch-red)",
  "var(--modal-stitch-green)",
  "var(--modal-stitch-blue)",
  "var(--modal-stitch-yellow)",
  "var(--modal-stitch-orange)",
];

function lockScroll(lock) {
  document.body.classList.toggle("modal-open", lock);
}

function getViewportSize() {
  const vv = window.visualViewport;
  return {
    w: vv?.width || window.innerWidth,
    h: vv?.height || window.innerHeight,
  };
}

function getGameLogicalSize() {
  const rootStyles = getComputedStyle(document.documentElement);
  const width = parseFloat(rootStyles.getPropertyValue("--game-width")) || 360;
  const height = parseFloat(rootStyles.getPropertyValue("--game-height")) || 640;
  return { width, height };
}

function applyModalScale(overlay) {
  const frame = overlay?.querySelector(".frame-panel");
  const canvas = overlay?.querySelector(".modal-canvas");
  if (!frame) return;
  frame.style.transform = "";
  if (canvas) canvas.style.maxHeight = "";

  const { w, h } = getViewportSize();
  const { width: gameW, height: gameH } = getGameLogicalSize();
  const rootStyles = getComputedStyle(document.documentElement);
  const modalMaxVar = parseFloat(rootStyles.getPropertyValue("--modal-max-width")) || 340;

  const margin = 24;
  const widthLimit = Math.max(
    200,
    Math.min(
      modalMaxVar,
      gameW - margin * 2
    )
  );
  const heightLimit = Math.max(
    220,
    Math.min(gameH - margin * 2)
  );

  frame.style.width = "";
  frame.style.maxWidth = `${widthLimit}px`;
  frame.style.maxHeight = `${heightLimit}px`;

  if (canvas) {
    const headerAllowance = 170; // ribbon + close + padding
    const canvasMax = Math.max(140, heightLimit - headerAllowance);
    canvas.style.maxHeight = `${canvasMax}px`;
    canvas.style.overflowY = "auto";
  }
}

function rescaleTopModal() {
  if (!modalStack.length) return;
  const top = modalStack[modalStack.length - 1];
  applyModalScale(top.overlay);
}

function dispatchClose(entry, reason, extra = {}) {
  const detail = {
    id: entry.id,
    reason,
    action: extra.action,
    payload: { ...(entry.payload || {}), ...(extra.payload || {}) },
  };
  document.dispatchEvent(new CustomEvent("modal:closed", { detail }));
  if (typeof entry.onClose === "function") {
    entry.onClose(detail);
  }
}

export function openModal(id, { closable = true, payload = null, onClose = null } = {}) {
  const overlay = document.querySelector(`.modal-overlay[data-modal="${id}"]`);
  if (!overlay) return;
  overlay.classList.add("open");
  overlay.dataset.closable = closable ? "1" : "0";
  modalStack.push({ id, overlay, closable, payload, onClose });
  lockScroll(true);
  const letters = overlay.querySelector(".modal-letters");
  if (letters) generateLetters(letters);
  applyModalScale(overlay);
}

export function closeModal(id, { reason = "close", action = null, payload = null } = {}) {
  const idx = modalStack.findIndex((m) => m.id === id);
  if (idx === -1) return;
  const entry = modalStack[idx];
  entry.overlay.classList.remove("open");
  modalStack.splice(idx, 1);
  dispatchClose(entry, action ? "action" : reason, { action, payload });
  if (!modalStack.length) {
    lockScroll(false);
  }
}

export function closeTopModal() {
  if (!modalStack.length) return;
  const top = modalStack[modalStack.length - 1];
  if (top.overlay.dataset.closable !== "0") {
    closeModal(top.id, { reason: "close" });
  }
}

function handleOverlayClick(e) {
  const overlay = e.currentTarget;
  const id = overlay.dataset.modal;
  if (overlay.dataset.closable === "0") return;
  if (e.target.classList.contains("modal-close") || e.target === overlay) {
    closeModal(id, { reason: "close" });
  }
}

function handleEsc(e) {
  if (e.key === "Escape") {
    closeTopModal();
  }
}

function generateLetters(container) {
  if (!container) return;
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  container.innerHTML = "";
  const rect = container.getBoundingClientRect();
  const width = rect.width || 220;
  const height = rect.height || 260;
  const placed = [];
  const maxLetters = 14 + Math.floor(Math.random() * 4); // 14-17 letters
  let attempts = 0;

  while (placed.length < maxLetters && attempts < maxLetters * 8) {
    attempts += 1;
    const size = Math.floor(Math.random() * 22) + 44; // 44-65px
    const x = Math.random() * (width - size) + size * 0.5;
    const y = Math.random() * (height - size) + size * 0.5;
    const angle = Math.floor(Math.random() * 360);

    const overlaps = placed.some((p) => {
      const dx = p.x - x;
      const dy = p.y - y;
      const minDist = (p.size + size) * 0.55;
      return Math.sqrt(dx * dx + dy * dy) < minDist;
    });
    if (overlaps) continue;

    const span = document.createElement("span");
    span.textContent = letters[Math.floor(Math.random() * letters.length)];
    span.style.color = LETTER_COLORS[Math.floor(Math.random() * LETTER_COLORS.length)];
    span.style.fontSize = `${size}px`;
    span.style.left = `${(x / width) * 100}%`;
    span.style.top = `${(y / height) * 100}%`;
    span.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
    container.appendChild(span);
    placed.push({ x, y, size });
  }
}

function populateModalLetters() {
  document.querySelectorAll(".modal-letters").forEach((container) => {
    generateLetters(container);
  });
}

export function initModals() {
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", handleOverlayClick);
  });
  document.addEventListener("keydown", handleEsc);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", rescaleTopModal);
  } else {
    window.addEventListener("resize", rescaleTopModal);
  }
  populateModalLetters();
}

// Auto-init if included standalone
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => initModals());
  window.ModalManager = { openModal, closeModal, closeTopModal };
}

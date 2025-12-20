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
  populateModalLetters();
}

// Auto-init if included standalone
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => initModals());
  window.ModalManager = { openModal, closeModal, closeTopModal };
}

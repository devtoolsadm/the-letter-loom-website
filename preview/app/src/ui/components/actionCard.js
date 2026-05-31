import { ACTION_CARDS } from "../../core/constants.js";
import { TEXTS, getShellLanguage } from "../../i18n/texts.js";

// Single source of truth for action card icon + description.
// svg: path to SVG in assets/img/actions/ (drop in new SVGs to replace emoji).
// icon: emoji fallback shown when no SVG exists yet.
// desc: canonical description — used in focus panel AND quick guide.
export const ACTION_CARD_META = {
  boost_total:   { svg: null, icon: "⬆️",  desc: "Suma 6 puntos extra en esta ronda." },
  extra_card:    { svg: null, icon: "🃏",  desc: "Roba una vocal o consonante de los mazos de letras." },
  wildcard:      { svg: null, icon: "🌟",  desc: "Úsalo como vocal o consonante y suma 6 puntos extra." },
  shield_total:  { svg: null, icon: "🛡️", desc: "Ningún ataque te afectará en esta baza, sean directos contra ti o contra todos." },
  change_cards:  { svg: null, icon: "🔄",  desc: "Cambia las letras que quieras." },
  use_vowel:     { svg: null, icon: "🅰️", desc: "Todos deben usar la vocal del Tablero Central que elijas." },
  use_consonant: { svg: null, icon: "🅱️",  desc: "Todos deben usar la consonante del Tablero Central que elijas." },
  use_letter:    { svg: null, icon: "🆎",  desc: "Todos deben usar la vocal o consonante del Tablero Central que elijas." },
  two_to_center: { svg: null, icon: "🎯",  desc: "Roba una carta a cada jugador y coloca 2 en el Tablero Central." },
  out_one:       { svg: null, icon: "💥",  desc: "Roba una carta a cada jugador y ponlas en el mazo." },
  great_heist:   { svg: null, icon: "🦹",  desc: "Roba una carta a cada jugador." },
  steal_letter:  { svg: null, icon: "✂️", desc: "Roba una letra a otro jugador." },
  renew_board:   { svg: null, icon: "♻️", desc: "Quita las 5 letras y pon 5 nuevas." },
  swap_all:      { svg: null, icon: "🔀",  desc: "Cambia tus letras con las de otro jugador." },
  swap_one:      { svg: null, icon: "↔️", desc: "Cambia una letra tuya por otra de otro jugador." },
  solo_mia:      { svg: null, icon: "🔒",  desc: "Roba una letra del Tablero Central; solo tú puedes usarla." },
  one_for_all:   { svg: null, icon: "🤝",  desc: "Pon una letra de otro jugador en el Tablero Central." },
  philologist:   { svg: null, icon: "📖",  desc: "Obliga a un jugador a formar una palabra con tilde." },
  brain_squeeze: { svg: null, icon: "🧠",  desc: "Obliga a un jugador a formar una palabra de al menos tres sílabas." },
  explosion:     { svg: null, icon: "💣",  desc: "Resta 4 puntos a un jugador en esta baza." },
  discard_one:   { svg: null, icon: "🗑️", desc: "Un jugador debe dejar una letra en el mazo." },
  in_english:    { svg: null, icon: "🇬🇧",  desc: "Si formas la palabra en inglés, sumas 10 puntos extra." },
};

export function actionIcon(actionId) {
  return ACTION_CARD_META[actionId]?.icon ?? "🎴";
}

export function actionDesc(actionId) {
  return ACTION_CARD_META[actionId]?.desc ?? "";
}

export function actionLabel(actionId) {
  const lang = getShellLanguage();
  const texts = TEXTS[lang] || TEXTS.es;
  return texts[`actName_${actionId}`] || actionId.replace(/_/g, " ");
}

export function humanActionName(actionId) {
  return actionLabel(actionId).toUpperCase();
}

export function makeActionIconEl(actionId, className = "tcard-action-icon") {
  const meta = ACTION_CARD_META[actionId];
  if (meta?.svg) {
    const img = document.createElement("img");
    img.src = meta.svg;
    img.alt = "";
    img.className = className;
    img.style.cssText = "width:1em;height:1em;object-fit:contain;";
    return img;
  }
  const span = document.createElement("span");
  span.className = className;
  span.textContent = meta?.icon ?? "🎴";
  return span;
}

export function renderActionCard(card, opts = {}) {
  const el = document.createElement("div");
  if (!card) {
    el.className = "tcard is-action is-empty";
    const q = document.createElement("span");
    q.className = "tcard-letter";
    q.textContent = "?";
    el.appendChild(q);
    return el;
  }
  if (card.id) el.dataset.cardId = card.id;
  if (opts.faceDown) {
    el.className = "tcard is-face-down back-action";
    const img = document.createElement("img");
    img.src = "assets/img/action.svg";
    img.alt = "";
    img.className = "tcard-action-back-icon";
    el.appendChild(img);
    return el;
  }
  el.className = "tcard is-action";
  if (opts.selectable) el.classList.add("is-selectable");
  if (opts.selected)   el.classList.add("is-selected");
  if (opts.focused)    el.classList.add("is-focused");
  if (opts.dimmed)     el.classList.add("is-dimmed");
  el.appendChild(makeActionIconEl(card.actionId, "tcard-action-icon"));
  if (opts.onClick) {
    el.addEventListener("click", opts.onClick);
  }
  return el;
}

export function renderActionCardGrid() {
  const grid = document.createElement("div");
  grid.className = "quick-guide-action-grid";
  const groupOrder = { self: 0, all: 1, one: 2 };
  const sorted = ACTION_CARDS
    .slice()
    .sort((a, b) => (groupOrder[a.target] ?? 9) - (groupOrder[b.target] ?? 9));
  sorted.forEach((def) => {
    const item = document.createElement("div");
    item.className = "quick-guide-action-item";

    const cardEl = renderActionCard({ actionId: def.id }, { selectable: false });
    cardEl.style.cssText = "pointer-events:none;flex-shrink:0;";
    item.appendChild(cardEl);

    const nameEl = document.createElement("div");
    nameEl.className = "quick-guide-action-item-name";
    nameEl.textContent = actionLabel(def.id);
    item.appendChild(nameEl);

    const descEl = document.createElement("div");
    descEl.className = "quick-guide-action-item-desc";
    descEl.textContent = actionDesc(def.id);
    item.appendChild(descEl);

    grid.appendChild(item);
  });
  return grid;
}

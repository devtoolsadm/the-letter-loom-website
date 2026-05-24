export function renderLetterCard(card, opts = {}) {
  const el = document.createElement("div");
  if (!card) {
    el.className = "tcard is-empty";
    const l = document.createElement("span");
    l.className = "tcard-letter";
    l.textContent = "?";
    el.appendChild(l);
    return el;
  }
  if (opts.faceDown) {
    el.className = "tcard is-face-down " + (card.kind === "vowel" ? "back-vowel" : "back-consonant");
    el.textContent = card.kind === "vowel" ? "V" : "C";
    return el;
  }
  if (card.isWildcard) {
    el.className = "tcard is-wildcard";
    const kind = card.isActionWildcard ? "action" : card.kind;
    el.dataset.kind = kind;
    const letter = document.createElement("span");
    letter.className = "tcard-letter";
    letter.textContent = card.letter && card.letter !== "*" ? card.letter : "★";
    const star = document.createElement("span");
    star.className = "tcard-wildcard-star";
    star.textContent = "★";
    const value = document.createElement("span");
    value.className = "tcard-value";
    value.textContent = card.isActionWildcard ? "+6" : "0";
    el.append(letter, star, value);
    if (kind === "vowel" || kind === "consonant") {
      const tag = document.createElement("span");
      tag.className = "tcard-kind-tag";
      tag.textContent = kind === "vowel" ? "V" : "C";
      el.appendChild(tag);
    }
    return el;
  }
  el.className = "tcard";
  el.dataset.color = card.color || "none";
  const letter = document.createElement("span");
  letter.className = "tcard-letter";
  letter.textContent = card.letter;
  if (card.tildeValue != null) {
    const tildeBadge = document.createElement("span");
    tildeBadge.className = "tcard-value-tilde";
    tildeBadge.textContent = String(card.tildeValue);
    const baseBadge = document.createElement("span");
    baseBadge.className = "tcard-value-base";
    baseBadge.textContent = String(card.value);
    el.append(letter, tildeBadge, baseBadge);
  } else {
    const value = document.createElement("span");
    value.className = "tcard-value";
    value.textContent = String(card.value ?? 0);
    el.append(letter, value);
  }
  return el;
}

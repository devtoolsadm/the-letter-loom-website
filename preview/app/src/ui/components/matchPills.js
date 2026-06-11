import { getDealerPalette, darkenHexColor } from "../utils.js";

export function renderMatchPills(root, opts) {
  if (!root) return;
  const {
    players = [],
    dealerId = null,
    activeId = null,
    shielded = [],
    hands = {},
    scoreModifiers = {},
    pillClass = "training-score-pill",
    dealerLabel = "Reparte",
  } = opts;

  root.innerHTML = "";

  const maxScore = players.reduce((m, p) => Math.max(m, p.score ?? 0), 0);
  const hasNonZeroScore = maxScore > 0;

  for (const p of players) {
    const hand = hands[p.id];
    const letters = hand && hand !== "<hidden>" ? (hand.letters ?? []).filter(Boolean) : [];
    const hasShield = shielded.includes(p.id);
    const isDealer = p.id === dealerId;
    const isActive = p.id === activeId;
    const isLeader = hasNonZeroScore && (p.score ?? 0) === maxScore;

    const pill = document.createElement("div");
    let cls = pillClass + (p.isGhost ? "" : " is-user");
    if (hasShield) cls += " has-shield";
    if (isDealer) cls += " is-dealer";
    if (isActive) cls += " is-active";
    if (isLeader) cls += " is-leader";
    pill.className = cls;

    // Apply player color as CSS vars so the pill reflects identity
    if (p.color) {
      const palette = getDealerPalette(p.color);
      pill.style.setProperty("--pill-bg", p.color);
      pill.style.setProperty("--pill-border", darkenHexColor(p.color, 0.72));
      pill.style.setProperty("--pill-text", palette.text);
    }
    pill.dataset.playerId = p.id;

    const name = document.createElement("span");
    name.className = pillClass + "-name";
    name.textContent = p.name;

    const value = document.createElement("span");
    value.className = pillClass + "-value";
    value.textContent = String(p.score ?? 0);

    const dots = document.createElement("div");
    dots.className = pillClass + "-cards";
    const dotCount = Math.max(letters.length, 1);
    for (let i = 0; i < dotCount; i++) {
      const dot = document.createElement("span");
      if (i < letters.length) {
        const card = letters[i];
        dot.className = card.isActionWildcard
          ? "is-action-wildcard"
          : card.kind === "vowel"
            ? "is-vowel"
            : "is-consonant";
      }
      dots.appendChild(dot);
    }

    if (isLeader) {
      const crownIcon = document.createElement("span");
      crownIcon.setAttribute("aria-hidden", "true");
      crownIcon.className = "pill-badge-crown";
      pill.appendChild(crownIcon);
    }
    if (hasShield) {
      const shieldIcon = document.createElement("img");
      shieldIcon.src = "assets/img/shield.svg";
      shieldIcon.alt = "";
      shieldIcon.className = "pill-badge pill-badge-shield";
      pill.appendChild(shieldIcon);
    }
    if (isDealer) {
      const dealerChip = document.createElement("span");
      dealerChip.className = "pill-badge-dealer";
      dealerChip.textContent = dealerLabel;
      pill.appendChild(dealerChip);
    }

    const mod = scoreModifiers[p.id] ?? 0;
    if (mod !== 0) {
      const modBadge = document.createElement("span");
      modBadge.className = "pill-badge pill-badge-mod " + (mod > 0 ? "is-positive" : "is-negative");
      modBadge.textContent = (mod > 0 ? "+" : "") + mod;
      pill.appendChild(modBadge);
    }

    pill.append(name, value, dots);
    root.appendChild(pill);
  }
}

/**
 * Renders player score pills into a container element.
 *
 * @param {HTMLElement} root - Container to populate (cleared on each call)
 * @param {object} opts
 * @param {Array}  opts.players        - Array of player objects { id, name, score, isGhost }
 * @param {string} [opts.dealerId]     - Player id of the current dealer
 * @param {string} [opts.activeId]     - Player id to highlight as acting
 * @param {Array}  [opts.shielded]     - Array of player ids that are shielded
 * @param {object} [opts.hands]        - Map of playerId → hand { letters: [...] } or "<hidden>"
 * @param {object} [opts.scoreModifiers] - Map of playerId → numeric modifier
 * @param {string} [opts.pillClass]    - Base CSS class for the pill (default: "training-score-pill")
 */
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
  } = opts;

  root.innerHTML = "";

  for (const p of players) {
    const hand = hands[p.id];
    const letters = hand && hand !== "<hidden>" ? (hand.letters ?? []).filter(Boolean) : [];
    const hasShield = shielded.includes(p.id);
    const isDealer = p.id === dealerId;
    const isActive = p.id === activeId;

    const pill = document.createElement("div");
    let cls = pillClass + (p.isGhost ? "" : " is-user");
    if (hasShield) cls += " has-shield";
    if (isDealer) cls += " is-dealer";
    if (isActive) cls += " is-active";
    pill.className = cls;
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

    if (isActive) {
      const turnIcon = document.createElement("img");
      turnIcon.src = "assets/img/turn.svg";
      turnIcon.alt = "";
      turnIcon.className = "pill-badge pill-badge-turn";
      pill.appendChild(turnIcon);
    }
    if (hasShield) {
      const shieldIcon = document.createElement("img");
      shieldIcon.src = "assets/img/shield.svg";
      shieldIcon.alt = "";
      shieldIcon.className = "pill-badge pill-badge-shield";
      pill.appendChild(shieldIcon);
    }
    if (isDealer) {
      const dealIcon = document.createElement("img");
      dealIcon.src = "assets/img/actions/gallery.svg";
      dealIcon.alt = "";
      dealIcon.className = "pill-badge pill-badge-deal";
      pill.appendChild(dealIcon);
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

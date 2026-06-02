/**
 * ui/match/scoreBreakdown.js — Renders the per-baza score breakdown as a
 * row of small chips (letter values, action-wildcard bonus, modifier total,
 * x2 multiplier) followed by the final total. Pure UI helper, no DOM side
 * effects beyond returning the constructed element.
 *
 * Shared by training and the future online match — both screens want the
 * same visual breakdown after a player finishes their word.
 */

export function renderScoreBreakdown(parts, total) {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const wrap = document.createElement("div");
  wrap.className = "training-result-breakdown";
  const chips = document.createElement("div");
  chips.className = "training-result-breakdown-chips";
  for (const p of parts) {
    const chip = document.createElement("span");
    chip.className = "training-result-breakdown-chip";
    let label, value;
    if (p.kind === "letter") {
      label = (p.letter || "").toUpperCase();
      value = `+${p.delta}`;
      chip.classList.add("is-letter");
    } else if (p.kind === "wildcard-bonus") {
      label = "★";
      value = "+6";
      chip.classList.add("is-wildcard");
    } else if (p.kind === "modifier") {
      label = p.delta > 0 ? "BONUS" : "PENAL";
      value = (p.delta > 0 ? "+" : "") + p.delta;
      chip.classList.add(p.delta > 0 ? "is-positive" : "is-negative");
    } else if (p.kind === "double") {
      label = p.reason === "color" ? "×2 COLOR" : "×2 TODO";
      value = `+${p.delta}`;
      chip.classList.add("is-double");
    }
    const labelEl = document.createElement("span");
    labelEl.className = "training-result-breakdown-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.className = "training-result-breakdown-value";
    valueEl.textContent = value;
    chip.append(labelEl, valueEl);
    chips.appendChild(chip);
  }
  wrap.appendChild(chips);
  const totalEl = document.createElement("div");
  totalEl.className = "training-result-breakdown-total";
  totalEl.textContent = `= ${total}`;
  wrap.appendChild(totalEl);
  return wrap;
}

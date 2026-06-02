/**
 * ui/match/actionFX.js — All the in-match action animations:
 *  - pop-in: card drawn from a deck
 *  - pop-out: card sent to deck/discard
 *  - fly-card: card travels from one location to another
 *  - fade-shuffle: batch movement (renew_board, swap_all, ...)
 *  - score chip: floats a +N / -N over a player's pill
 *  - forced-rule pulse: highlights the central-board card a use_* aimed at
 *
 * Implementation pattern: applyActionWithFX(applyFn, log)
 *   1. Capture rects of all visible cards (keyed by card.id) BEFORE apply.
 *   2. Run applyFn → state mutated, returns stateAfter.
 *   3. Diff before↔after → schedule pop-in / pulse classes (consumed by
 *      the host render) and queue post-render tasks (pop-out / fly /
 *      fade-out ghosts, score chips) to fire AFTER the next render.
 *   4. Host renders. fxFlushPostRender() (call at end of render) launches
 *      the floating ghost animations using the AFTER rects.
 *
 * Shared between training and the future online match. Host injects the
 * pieces it owns via `configureActionFX()`.
 */

import { renderLetterCard } from "../components/letterCard.js";
import { renderActionCard } from "../components/actionCard.js";
import { showActionToast } from "./actionToast.js";
import { TIMING } from "./timing.js";

// ─── Host-injected config ──────────────────────────────────────────────────

let _getState = () => null;
let _render = () => {};
let _pillSelector = (pid) => `.training-score-pill[data-player-id="${pid}"]`;
let _cardSelector = ".tcard[data-card-id]";
let _scoreChipClass = "training-score-chip";

export function configureActionFX(opts = {}) {
  if (typeof opts.getState === "function") _getState = opts.getState;
  if (typeof opts.render === "function") _render = opts.render;
  if (typeof opts.pillSelector === "function") _pillSelector = opts.pillSelector;
  if (opts.cardSelector) _cardSelector = opts.cardSelector;
  if (opts.scoreChipClass) _scoreChipClass = opts.scoreChipClass;
}

// ─── Pending-classes registry (consumed by host's render) ─────────────────

const fxPopIn = new Set();           // card IDs to pop-in on next render
const fxPulse = new Set();           // card IDs to pulse on next render
const fxFadeIn = new Map();          // card ID → animation-delay (ms) for fade-in
const fxPostRender = [];             // queue of { type, ... } executed after render

export function fxConsumePopIn(id)  { if (id && fxPopIn.has(id))  { fxPopIn.delete(id);  return true; } return false; }
export function fxConsumePulse(id)  { if (id && fxPulse.has(id))  { fxPulse.delete(id);  return true; } return false; }
export function fxConsumeFadeIn(id) {
  if (id && fxFadeIn.has(id)) {
    const delay = fxFadeIn.get(id);
    fxFadeIn.delete(id);
    return delay ?? 0;
  }
  return null;
}

// ─── Rect capture & state indexing ─────────────────────────────────────────

export function fxCaptureCardRects(state) {
  const rects = new Map();
  // Real DOM cards (user hand, board, user action cards).
  document.querySelectorAll(_cardSelector).forEach((el) => {
    const id = el.dataset.cardId;
    if (id) rects.set(id, el.getBoundingClientRect());
  });
  // Ghost hand cards aren't rendered as .tcard — they live as colored dots
  // inside the ghost's player pill. For fly-card src/dst purposes we use
  // the pill's rect as a synthetic source so the user sees something flying
  // out of (or into) the right pill.
  if (state) {
    for (const [pid, hand] of Object.entries(state.hands ?? {})) {
      if (!hand || hand === "<hidden>") continue;
      const player = (state.players ?? []).find((p) => p.id === pid);
      if (!player?.isGhost) continue;
      const pill = document.querySelector(_pillSelector(pid));
      if (!pill) continue;
      const pr = pill.getBoundingClientRect();
      const ghostRect = {
        left: pr.left + pr.width * 0.15,
        top: pr.top + pr.height * 0.55,
        width: Math.max(28, pr.width * 0.35),
        height: Math.max(28, pr.height * 0.35),
        right: pr.right,
        bottom: pr.bottom,
      };
      for (const c of hand.letters ?? []) {
        if (c?.id && !rects.has(c.id)) rects.set(c.id, ghostRect);
      }
    }
  }
  return rects;
}

// Index every visible card across state by location key.
function fxIndexCards(state) {
  const out = new Map(); // cardId → { card, locKey }
  for (const c of state.centralBoard ?? []) {
    if (c?.id) out.set(c.id, { card: c, locKey: "board" });
  }
  for (const [pid, hand] of Object.entries(state.hands ?? {})) {
    if (!hand || hand === "<hidden>") continue;
    for (const c of hand.letters ?? []) {
      if (c?.id) out.set(c.id, { card: c, locKey: `hand:${pid}` });
    }
    for (const c of hand.actions ?? []) {
      if (c?.id) out.set(c.id, { card: c, locKey: `actions:${pid}` });
    }
  }
  return out;
}

// ─── Scheduling animations from a state diff ──────────────────────────────

const FX_BATCH_ATTACKS = new Set(["swap_all", "great_heist", "out_one", "change_cards", "renew_board"]);

function fxScheduleForAction(stateBefore, stateAfter, log, rectsBefore) {
  if (!log || !stateBefore || !stateAfter) return;
  const actionId = log.actionId;
  const beforeIdx = fxIndexCards(stateBefore);
  const afterIdx  = fxIndexCards(stateAfter);
  const isBatch = FX_BATCH_ATTACKS.has(actionId);
  // Per-card stagger so a batch movement (renew_board, swap_all, ...) reads
  // as a sequence instead of all cards animating in unison.
  const FADE_STAGGER_MS = 80;
  let fadeOutCount = 0;
  let fadeInCount = 0;

  // Removed / moved (cards in before but not in after, or moved location).
  for (const [id, beforeLoc] of beforeIdx) {
    const afterLoc = afterIdx.get(id);
    const rect = rectsBefore.get(id);
    if (!afterLoc) {
      // Card disappeared (sent to a deck/discard).
      if (rect) {
        if (isBatch) {
          fxPostRender.push({ type: "fade-out", rect, card: beforeLoc.card, delayMs: fadeOutCount * FADE_STAGGER_MS });
          fadeOutCount += 1;
        } else {
          fxPostRender.push({ type: "pop-out", rect, card: beforeLoc.card });
        }
      }
    } else if (afterLoc.locKey !== beforeLoc.locKey) {
      // Card moved to a different container.
      if (isBatch) {
        if (rect) {
          fxPostRender.push({ type: "fade-out", rect, card: beforeLoc.card, delayMs: fadeOutCount * FADE_STAGGER_MS });
          fadeOutCount += 1;
        }
        fxFadeIn.set(id, fadeInCount * FADE_STAGGER_MS);
        fadeInCount += 1;
      } else if (rect) {
        fxPostRender.push({ type: "fly", srcRect: rect, cardId: id, card: afterLoc.card });
      }
    }
  }

  // New cards (didn't exist before).
  for (const [id, afterLoc] of afterIdx) {
    if (beforeIdx.has(id)) continue;
    if (isBatch) {
      fxFadeIn.set(id, fadeInCount * FADE_STAGGER_MS);
      fadeInCount += 1;
    } else {
      fxPopIn.add(id);
    }
  }

  // Score chip when scoreModifiers changed for any player. The +6 from
  // "wildcard" is only conceptually earned when the user actually USES the
  // wildcard inside their word — getting the card itself doesn't justify a
  // chip yet, so we skip it here (the chip will surface during scoring).
  if (actionId !== "wildcard") {
    const beforeMods = stateBefore.scoreModifiers ?? {};
    const afterMods = stateAfter.scoreModifiers ?? {};
    for (const pid of new Set([...Object.keys(beforeMods), ...Object.keys(afterMods)])) {
      const delta = (afterMods[pid] ?? 0) - (beforeMods[pid] ?? 0);
      if (delta !== 0) {
        fxPostRender.push({ type: "score-chip", playerId: pid, delta });
      }
    }
  }

  // Forced-rule pulse on the targeted board card (use_letter / vowel /
  // consonant). For philologist/brain_squeeze nothing on the board itself
  // pulses — those land on a player instead, so we queue a pill-shake.
  if (["use_vowel", "use_consonant", "use_letter"].includes(actionId)) {
    const cardId = log.payload?.cardId;
    if (cardId) fxPulse.add(cardId);
  }
  if (["philologist", "brain_squeeze"].includes(actionId) && log.targetId) {
    fxPostRender.push({ type: "pill-shake", playerId: log.targetId });
  }
}

// ─── Post-render flush ────────────────────────────────────────────────────

export function fxFlushPostRender() {
  if (fxPostRender.length === 0) return;
  const queue = fxPostRender.splice(0);
  const rectsAfter = fxCaptureCardRects(_getState());
  for (const item of queue) {
    if (item.type === "pop-out") fxRenderPopOutGhost(item.rect, item.card);
    else if (item.type === "fade-out") fxRenderFadeOutGhost(item.rect, item.card, item.delayMs ?? 0);
    else if (item.type === "fly") {
      const dst = rectsAfter.get(item.cardId);
      if (dst) fxRenderFlyGhost(item.srcRect, dst, item.card, item.cardId);
    } else if (item.type === "score-chip") fxShowScoreChip(item.playerId, item.delta);
    else if (item.type === "pill-shake") fxShakePill(item.playerId);
  }
}

function fxShakePill(playerId) {
  if (!playerId) return;
  const pill = document.querySelector(_pillSelector(playerId));
  if (!pill) return;
  pill.classList.remove("is-under-attack");
  void pill.offsetWidth; // force reflow to restart animation
  pill.classList.add("is-under-attack");
  setTimeout(() => pill.classList.remove("is-under-attack"), TIMING.pillShake);
}

// ─── Floating ghost renderers ─────────────────────────────────────────────

function fxCreateGhostCardEl(card) {
  // Pick the right renderer based on card type.
  const isAction = card?.type === "action" || (card?.actionId && !card?.kind);
  return isAction ? renderActionCard(card, { faceDown: false }) : renderLetterCard(card);
}

function fxPositionGhost(el, rect) {
  Object.assign(el.style, {
    position: "fixed",
    left: rect.left + "px",
    top: rect.top + "px",
    width: rect.width + "px",
    height: rect.height + "px",
    margin: "0",
    pointerEvents: "none",
    zIndex: "9999",
  });
}

function fxRenderPopOutGhost(rect, card) {
  const el = fxCreateGhostCardEl(card);
  fxPositionGhost(el, rect);
  el.classList.add("is-pop-out");
  document.body.appendChild(el);
  el.addEventListener("animationend", () => el.remove(), { once: true });
}

function fxRenderFadeOutGhost(rect, card, delayMs = 0) {
  const el = fxCreateGhostCardEl(card);
  fxPositionGhost(el, rect);
  el.style.setProperty("--shuffle-rot", (Math.random() < 0.5 ? -14 : 14) + "deg");
  if (delayMs > 0) el.style.animationDelay = `${delayMs}ms`;
  el.classList.add("is-fade-out");
  document.body.appendChild(el);
  el.addEventListener("animationend", () => el.remove(), { once: true });
}

function fxRenderFlyGhost(srcRect, dstRect, card, cardId) {
  const el = fxCreateGhostCardEl(card);
  fxPositionGhost(el, srcRect);
  el.classList.add("is-flying");
  document.body.appendChild(el);
  // Briefly hide the real destination card so the ghost is the only one
  // visible while it travels.
  const realDst = cardId ? document.querySelector(`.tcard[data-card-id="${cardId}"]`) : null;
  if (realDst) realDst.style.visibility = "hidden";
  // Force layout to pick up the inline starting position.
  void el.offsetWidth;
  const dx = dstRect.left - srcRect.left;
  const dy = dstRect.top - srcRect.top;
  const dsx = dstRect.width / Math.max(1, srcRect.width);
  const dsy = dstRect.height / Math.max(1, srcRect.height);
  el.style.transform = `translate(${dx}px, ${dy}px) scale(${dsx}, ${dsy})`;
  el.addEventListener("transitionend", () => {
    el.remove();
    if (realDst) realDst.style.visibility = "";
  }, { once: true });
}

function fxShowScoreChip(playerId, delta) {
  if (!playerId || !delta) return;
  const pill = document.querySelector(_pillSelector(playerId));
  if (!pill) return;
  const chip = document.createElement("div");
  chip.className = `${_scoreChipClass} ${delta > 0 ? "is-positive" : "is-negative"}`;
  chip.textContent = (delta > 0 ? "+" : "") + delta;
  pill.appendChild(chip);
  setTimeout(() => chip.remove(), 1500);
}

// ─── Public entry points ──────────────────────────────────────────────────

let _fxLastMoves = null;
export function applyActionWithFX(applyFn, log) {
  const stateBefore = _getState();
  const rectsBefore = fxCaptureCardRects(stateBefore);
  const stateAfter = applyFn();
  if (stateBefore && stateAfter) {
    fxScheduleForAction(stateBefore, stateAfter, log, rectsBefore);
    _fxLastMoves = computeCardMoves(stateBefore, stateAfter);
  } else {
    _fxLastMoves = null;
  }
  return stateAfter;
}
export function consumeLastFxMoves() {
  const m = _fxLastMoves;
  _fxLastMoves = null;
  return m;
}

// Read-pause between the moment the actor's bubble/banner appears and the
// moment the actual card movement animations start. The user reads first,
// then sees the effect — the action stops feeling like a single chaotic
// frame. Skipped (0 ms) for the user's own actions (you already know what
// you played, no need to read it).
export const ACTION_READ_DELAY_MS = TIMING.actionRead.delay;
export function playActionWithReadDelay(applyFn, log, finalize) {
  const stateBefore = _getState();
  const userId = stateBefore?.players?.[0]?.id;
  const isOwnAction = log?.playerId === userId;
  // Bubble + banner first — both are set up by showActionToast.
  showActionToast(stateBefore, log);
  const runEffect = () => {
    const s = applyActionWithFX(applyFn, log);
    finalize(s);
  };
  if (isOwnAction) {
    runEffect();
    return;
  }
  // Render once with state UNCHANGED so the bubble attaches to the actor's
  // pill while the user reads. Then run the effect after the read pause.
  _render();
  setTimeout(runEffect, ACTION_READ_DELAY_MS);
}

// Diff card locations between two states. Returns an array of
// { cardId, letter, kind, from, to } entries where `from`/`to` are friendly
// labels ("Op1", "Rafa", "tablero", "mazo/descarte").
export function computeCardMoves(stateBefore, stateAfter) {
  const moves = [];
  const labelOf = (locKey, st) => {
    if (locKey === "board") return "tablero";
    if (locKey?.startsWith("hand:") || locKey?.startsWith("actions:")) {
      const pid = locKey.split(":")[1];
      const p = (st.players ?? []).find((x) => x.id === pid);
      return p?.name || pid;
    }
    return "mazo/descarte";
  };
  const beforeIdx = fxIndexCards(stateBefore);
  const afterIdx = fxIndexCards(stateAfter);
  for (const [id, beforeLoc] of beforeIdx) {
    const afterLoc = afterIdx.get(id);
    if (!afterLoc) {
      moves.push({
        cardId: id,
        letter: beforeLoc.card?.letter ?? "?",
        kind: beforeLoc.card?.kind ?? null,
        fromKey: beforeLoc.locKey,
        toKey: null,
        from: labelOf(beforeLoc.locKey, stateBefore),
        to: "mazo/descarte",
      });
    } else if (afterLoc.locKey !== beforeLoc.locKey) {
      moves.push({
        cardId: id,
        letter: afterLoc.card?.letter ?? "?",
        kind: afterLoc.card?.kind ?? null,
        fromKey: beforeLoc.locKey,
        toKey: afterLoc.locKey,
        from: labelOf(beforeLoc.locKey, stateBefore),
        to: labelOf(afterLoc.locKey, stateAfter),
      });
    }
  }
  for (const [id, afterLoc] of afterIdx) {
    if (beforeIdx.has(id)) continue;
    moves.push({
      cardId: id,
      letter: afterLoc.card?.letter ?? "?",
      kind: afterLoc.card?.kind ?? null,
      fromKey: null,
      toKey: afterLoc.locKey,
      from: "mazo/descarte",
      to: labelOf(afterLoc.locKey, stateAfter),
    });
  }
  return moves;
}

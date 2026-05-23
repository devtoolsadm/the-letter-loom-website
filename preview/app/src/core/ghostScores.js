// Score generator for simulated opponents ("ghosts") in training mode.
// Pure functions. Uses Math.random() unless an injected RNG is provided.

import { GHOST_SCORE_LEVELS, GHOST_DEFAULT_LEVEL } from "./constants.js";

// Box-Muller transform → standard normal sample
function gaussian(rng = Math.random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Round to nearest even integer (game scores are always even).
function roundToEven(n) {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r + (r >= 0 ? 1 : -1);
}

// Generate a single ghost trick score for the requested difficulty level.
// Honors GHOST_SCORE_LEVELS configuration (mean, stdDev, invalidRate).
// Returns 0 for the invalid-word path (manual rule).
export function generateGhostScore(level = GHOST_DEFAULT_LEVEL, rng = Math.random) {
  const cfg = GHOST_SCORE_LEVELS[level] ?? GHOST_SCORE_LEVELS[GHOST_DEFAULT_LEVEL];
  if (rng() < cfg.invalidRate) return 0;
  const raw = cfg.mean + gaussian(rng) * cfg.stdDev;
  // Clamp to a reasonable range (matches MIN_ROUND_SCORE..40)
  const clamped = Math.max(0, Math.min(40, raw));
  return roundToEven(clamped);
}

// Generate scores for an arbitrary number of ghosts in one trick.
export function generateGhostScores(count, level = GHOST_DEFAULT_LEVEL, rng = Math.random) {
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(generateGhostScore(level, rng));
  return out;
}

// Pick a random target player id different from the source.
export function pickRandomTarget(playerIds, sourceId, rng = Math.random) {
  const candidates = playerIds.filter((id) => id !== sourceId);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

// Pick a random board letter id (used by board-modifier ghost actions).
export function pickRandomBoardCardId(boardCards, rng = Math.random) {
  if (!boardCards || boardCards.length === 0) return null;
  return boardCards[Math.floor(rng() * boardCards.length)].id;
}

// Pick which of a ghost's two actions to play. For the MVP: random.
// Returns the index (0 or 1).
export function pickGhostActionIndex(actionsInHand, rng = Math.random) {
  if (!actionsInHand || actionsInHand.length === 0) return -1;
  return Math.floor(rng() * actionsInHand.length);
}

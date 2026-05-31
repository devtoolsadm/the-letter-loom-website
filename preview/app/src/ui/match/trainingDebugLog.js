/**
 * ui/match/trainingDebugLog.js — In-memory chronological log of everything
 * that happens during a training session, surfaced via the debug badge.
 *
 * The log is purely a UI/debug concern: it lives in module state, is not
 * persisted to localStorage and is not part of the match state, so the core
 * trainingMatch logic and its tests remain untouched.
 *
 * Entries are pushed from training.js at meaningful points and rendered as
 * plain text in a modal when the user clicks the 🐛 DEBUG badge.
 */

const log = [];
let sessionStart = null;

function nameOf(state, playerId) {
  if (!playerId) return "—";
  const p = (state?.players ?? []).find((x) => x.id === playerId);
  return p?.name || playerId;
}

function tsLabel(entry) {
  if (sessionStart == null) sessionStart = entry.ts;
  const dt = ((entry.ts - sessionStart) / 1000).toFixed(1);
  return `[+${dt.padStart(5, " ")}s]`;
}

function actorIcon(state, playerId) {
  const p = (state?.players ?? []).find((x) => x.id === playerId);
  if (!p) return "·";
  return p.isGhost ? "👻" : "👤";
}

function snapshotOf(state) {
  return {
    shieldedPlayers: [...(state?.shieldedPlayers ?? [])],
    forcedRules: cloneRules(state?.forcedRules),
    scoreModifiers: { ...(state?.scoreModifiers ?? {}) },
  };
}

function cloneRules(rules) {
  if (!rules) return {};
  const out = {};
  for (const [k, v] of Object.entries(rules)) {
    out[k] = Array.isArray(v) ? v.map((e) => ({ ...e })) : v;
  }
  return out;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function debugLogReset() {
  log.length = 0;
  sessionStart = null;
}

export function debugLogPushBazaStart(state) {
  log.push({
    kind: "baza-start",
    ts: Date.now(),
    bazaNum: state.round,
    snapshot: snapshotOf(state),
  });
}

export function debugLogPushPreselect(state, actionId) {
  const userId = state.players?.[0]?.id;
  log.push({
    kind: "preselect",
    ts: Date.now(),
    bazaNum: state.round,
    actorId: userId,
    actorName: nameOf(state, userId),
    actionId,
    snapshot: snapshotOf(state),
  });
}

export function debugLogPushAction(state, { actorId, actionId, targetId, payload, blocked, moves }) {
  log.push({
    kind: "action",
    ts: Date.now(),
    bazaNum: state.round,
    actorId,
    actorName: nameOf(state, actorId),
    actionId,
    targetId,
    targetName: targetId ? nameOf(state, targetId) : null,
    payload: payload || null,
    blocked: !!blocked,
    moves: Array.isArray(moves) ? moves : [],
    snapshot: snapshotOf(state),
  });
}

export function debugLogPushWord(state, { word, valid, score, reason, source }) {
  log.push({
    kind: "word",
    ts: Date.now(),
    bazaNum: state.round,
    word,
    valid,
    score,
    reason: reason ?? null,
    source: source ?? null,
    snapshot: snapshotOf(state),
  });
}

export function debugLogPushBazaEnd(state) {
  const scores = (state.players ?? []).map((p) => `${p.name}=${p.score ?? 0}`).join("  ");
  log.push({
    kind: "baza-end",
    ts: Date.now(),
    bazaNum: state.round,
    scoresLine: scores,
    snapshot: snapshotOf(state),
  });
}

// ─── Formatter ──────────────────────────────────────────────────────────────

export function formatDebugLog(state) {
  if (log.length === 0) return "(sin eventos registrados todavía)";
  const lines = [];
  let lastBaza = null;
  for (const e of log) {
    if (e.bazaNum !== lastBaza) {
      lines.push(`─────────────────────────────────────────────`);
      lines.push(`BAZA ${e.bazaNum ?? "?"}`);
      lines.push(`─────────────────────────────────────────────`);
      lastBaza = e.bazaNum;
    }
    lines.push(formatEntry(e, state));
  }
  return lines.join("\n");
}

function formatEntry(e, state) {
  const ts = tsLabel(e);
  switch (e.kind) {
    case "baza-start":
      return `${ts}  ── Reparto ──`;

    case "preselect":
      return `${ts}  ${actorIcon(state, e.actorId)} ${e.actorName}  preselecciona  ${e.actionId}\n` +
             `         escudos:[${e.snapshot.shieldedPlayers.join(",") || "—"}]`;

    case "action": {
      const target = e.targetName ? `→ ${e.targetName}` : "";
      const pl = formatPayload(e.payload);
      const flag = e.blocked ? "  🛡 BLOQUEADO" : "";
      const ruleNote = formatForcedRules(e.snapshot.forcedRules);
      const shieldNote = e.snapshot.shieldedPlayers.length
        ? `escudos:[${e.snapshot.shieldedPlayers.join(",")}]`
        : "";
      const scoreNote = formatScoreModifiers(e.snapshot.scoreModifiers);
      const movesLine = formatMoves(e.moves);
      const tail = [shieldNote, ruleNote, scoreNote].filter(Boolean).join("  ");
      const lines = [`${ts}  ${actorIcon(state, e.actorId)} ${e.actorName}  juega  ${e.actionId}${pl ? `(${pl})` : ""}  ${target}${flag}`];
      if (movesLine) lines.push(`         ${movesLine}`);
      if (tail) lines.push(`         ${tail}`);
      return lines.join("\n");
    }

    case "word": {
      const verdict = e.valid ? "✓ válida" : "✗ inválida";
      const reasonNote = e.reason ? ` (${e.reason})` : "";
      const sourceNote = e.source ? ` [${e.source}]` : "";
      return `${ts}  ✍  Palabra: ${e.word}  ${verdict}${reasonNote}${sourceNote}  → ${e.score} pts`;
    }

    case "baza-end":
      return `${ts}  ── Fin de baza ──\n         ${e.scoresLine}`;

    default:
      return `${ts}  ? ${JSON.stringify(e)}`;
  }
}

function formatPayload(p) {
  if (!p) return "";
  const bits = [];
  if (p.letter)   bits.push(`letra=${p.letter}`);
  if (p.cardId)   bits.push(`card=${p.cardId}`);
  if (p.targetKind) bits.push(`kind=${p.targetKind}`);
  if (p.cardIds)  bits.push(`cards=${p.cardIds.join(",")}`);
  return bits.join(", ");
}

function formatForcedRules(rules) {
  if (!rules) return "";
  const entries = Object.entries(rules).filter(([, list]) => Array.isArray(list) && list.length);
  if (entries.length === 0) return "";
  const parts = entries.map(([pid, list]) => {
    const ids = list.map((r) => r.actionId).join(",");
    return `${pid}:[${ids}]`;
  });
  return `reglas:{${parts.join(" ")}}`;
}

function formatScoreModifiers(mods) {
  if (!mods) return "";
  const entries = Object.entries(mods).filter(([, v]) => v);
  if (entries.length === 0) return "";
  return `mods:{${entries.map(([k, v]) => `${k}:${v > 0 ? "+" : ""}${v}`).join(" ")}}`;
}

// Render the card-movement diff as a compact arrow list. Each entry is
// "<letter> <from>→<to>" — letter uppercased, ★ for wildcards.
function formatMoves(moves) {
  if (!Array.isArray(moves) || moves.length === 0) return "";
  const bits = moves.map((m) => {
    const letter = (m.letter && m.letter !== "*") ? m.letter.toUpperCase() : "★";
    return `${letter} ${m.from}→${m.to}`;
  });
  return `cartas:[${bits.join(" · ")}]`;
}

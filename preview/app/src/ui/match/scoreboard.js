import { matchController, validateWordRemote } from "../../core/matchController.js";
import {
  loadActiveMatch,
  saveActiveMatch,
  upsertArchiveMatch,
  loadArchive,
  matchHasRecord,
  loadRecords,
} from "../../core/matchStorage.js";
import {
  MATCH_MODE_ROUNDS,
  MATCH_MODE_POINTS,
  MIN_ROUND_SCORE,
  MAX_ROUND_SCORE,
  RECORD_MIN_POINTS,
  RECORD_AVG_PENALTY_THRESHOLD,
  RECORD_AVG_PENALTY_DECAY,
  RECORD_AVG_PENALTY_MAX,
  DEFAULT_ROUNDS_TARGET,
  DEFAULT_POINTS_TARGET,
  DEFAULT_STRATEGY_SECONDS,
  DEFAULT_CREATION_SECONDS,
  ROUND_KEYPAD_AUTO_ZERO_ON_NAV,
  PLAYER_COLORS,
} from "../../core/constants.js";
import { updateState, loadState } from "../../core/stateStore.js";
import { logger } from "../../core/logger.js";
import { TEXTS, getShellLanguage } from "../../i18n/texts.js";
import { openModal, closeModal, closeTopModal, closeAllModals } from "../shell/modal.js";
import { getDealerPalette, darkenHexColor } from "../utils.js";
import { capture, flush } from "../../lib/analytics.js";

// Shell callbacks
let _shell = {
  showScreen: () => {},
  playClickFeedback: () => {},
  openConfirm: () => {},
  setI18nById: () => {},
  setI18n: () => {},
  scaleGame: () => {},
  renderMatchPlayers: () => {},
  getActivePlayers: () => [],
  getDealerIndex: () => 0,
  getDealerInfo: () => ({ name: "", color: null }),
  saveRecords: () => {},
  loadRecords: () => [],
  triggerHapticFeedback: () => {},
  createValidationSection: () => {},
  clearMatchWordFor: () => {},
  clearStatusValidationFor: () => {},
  getKnownPlayerNames: () => [],
  maybeRecordWordScores: () => {},
  recordMatchAverages: () => {},
  finalizeWordRecordCandidates: () => {},
  upsertWordRecord: () => {},
  upsertMatchRecord: () => {},
  canEnterWordRecords: () => false,
  canEnterMatchRecords: () => false,
  getWordRecordThreshold: () => 0,
  getMatchRecordThreshold: () => 0,
  formatRecordDate: () => "",
  formatSeconds: () => "",
  escapeHtml: (s) => s,
  sortRecords: (list) => list,
  deleteRecordEntry: () => {},
  persistActiveMatchSnapshot: () => {},
  showMatchWinners: () => {},
  renderRecordsScreen: () => {},
  stopMatchTimer: () => {},
  stopClockLoop: () => {},
  startMatchPhase: () => {},
  playValidationResultSound: () => {},
  getValidationRules: () => "",
  updateValidationControls: () => {},
  validationSections: null,
  getValidationSections: () => new Map(),
  renderMatch: () => {},
  currentScreen: () => "",
  pausedBeforeScoreboard: { value: null },
  winnersModalOpen: { value: false },
  suppressWinnersPrompt: { value: false },
  lastWinnersIds: { value: [] },
  normalizeValidationWord: (v) => String(v || "").trim().toLowerCase(),
  getPlayerIndexMap: () => new Map(),
  getActivePlayers: () => [],
  getDealerIndex: () => 0,
  clampRoundScore: (v) => { const n = Number(v); return Number.isFinite(n) ? Math.min(MAX_ROUND_SCORE, Math.max(MIN_ROUND_SCORE, Math.round(n))) : 0; },
  isOddScore: (v) => { const n = Number(v); return Number.isFinite(n) && Math.abs(n % 2) === 1; },
  formatRoundEndScoreDisplay: (v) => (v == null || String(v).trim() === "") ? "" : String(v),
  getRoundEndPlayerLabel: () => "",
  formatScoreboardName: (name) => name,
  buildRecordDateMessage: () => "",
  applyShareIcon: () => {},
  updateHorizontalScrollHintState: () => {},
  updateScrollHintState: () => {},
  scheduleCreationTimeupAutoAdvance: () => {},
  clearCreationTimeupAutoAdvance: () => {},
  updateMatchConfigStepControls: () => {},
  updateMatchStartButtonState: () => {},
  showRoundIntro: () => {},
  triggerDealerFocus: () => {},
  updateSummarySeparators: () => {},
  formatPhaseDuration: () => "",
  playModalOpenSound: () => {},
  matchHasAnyScores: () => false,
  // Canvas helpers
  createShareCanvas: () => ({ canvas: null, ctx: null }),
  drawRoundedRect: () => {},
  truncateText: (ctx, text) => String(text || ""),
  drawShareCardFrame: () => {},
  drawShareCardTitle: () => 0,
  drawIconWithOutline: () => {},
  getCenteredTextBaseline: () => 0,
  formatShareMessage: () => "",
  formatShareName: (n) => String(n || "").trim().toUpperCase(),
  formatShareWord: (w) => String(w || "").trim().toUpperCase(),
  loadImageElement: () => Promise.resolve(null),
  canvasToBlob: () => Promise.resolve(null),
  shareImageBlob: () => Promise.resolve(false),
  buildShareFileName: () => "share.png",
  formatRecordPoints: () => "",
  openRecordWordModal: null,
  updateActionOverlayStates: () => {},
};

export function initScoreboard(callbacks) {
  Object.assign(_shell, callbacks);
}

// i18n helper
function t(key, vars) {
  const lang = getShellLanguage();
  const texts = TEXTS[lang] || TEXTS.es;
  let str = texts[key] ?? key;
  if (vars) {
    Object.keys(vars).forEach((k) => {
      str = str.replace(`{${k}}`, vars[k]);
    });
  }
  return str;
}

// Module state — scoreboard
let scoreboardDraft = null;
let scoreboardBase = null;
let scoreboardRounds = [];
let scoreboardPlayers = [];
let scoreboardDirty = false;
let scoreboardReadOnly = false;
let scoreboardInfoText = "";
let scoreboardRecordHighlight = null;
let scoreboardReturnScreen = "match";
let recordsTab = "words";
let recordShareBusy = false;
let scoreboardShareBusy = false;
let scoreboardKeypadOpen = false;
let scoreboardKeypadPlayerId = null;
let scoreboardKeypadRound = null;
let scoreboardKeypadOrder = [];
let scoreboardKeypadInitialValue = null;
let scoreboardReturnWinners = false;
// Round-end state
let roundEndScores = {};
let roundEndOrder = [];
let roundEndUnlocked = new Set();
let roundEndSelectedWinners = new Set();
let roundEndKeypadOpen = false;
let roundEndKeypadPlayerId = null;
let roundEndValidationByPlayer = new Map();
let lastMatchWord = "";
// Record-word modal state
let recordWordModalState = null;
let recordWordFeatures = {
  sameColor: false,
  usedWildcard: false,
  doubleScore: false,
  plusPoints: false,
  minusPoints: false,
};
let recordWordPendingNext = null;
let recordWordModalStaging = false;
let recordWordValidating = false;
let recordWordStatusWord = "";
let recordWordStatusOk = null;
// Word candidate draft
let scoreboardWordCandidatesDraft = null;
let scoreboardWordCandidatesDirty = false;
let scoreboardWordCandidatesMatchId = null;

const WORD_CANDIDATES_KEY = "letterloom_word_candidates";
const AUTO_CONTINUE_ROUND_END = true;
const SHARE_CARD_WIDTH = 1080;
const SHARE_CARD_HEIGHT = 1350;
const SHARE_CARD_MARGIN = 60;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRoundScoreEmpty(value) {
  return value == null || String(value).trim() === "";
}

function isScoreFilled(value) {
  return String(value ?? "").trim() !== "";
}

function getScoreNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function isScoreOutOfRange(value) {
  if (!isScoreFilled(value)) return false;
  const num = getScoreNumber(value);
  return num < MIN_ROUND_SCORE || num > MAX_ROUND_SCORE;
}

function isScoreValidForRecord(value, { requireEven = true } = {}) {
  if (!isScoreFilled(value)) return false;
  if (isScoreOutOfRange(value)) return false;
  if (getScoreNumber(value) < 0) return false;
  if (requireEven && _shell.isOddScore(value)) return false;
  return true;
}

// ─── Unified score validation ─────────────────────────────────────────────────

function validateScores(players, scores) {
  let missing = false;
  let oddPlayer = null;
  let outOfRangePlayer = null;
  for (const player of players) {
    const value = scores[String(player.id)];
    if (isRoundScoreEmpty(value)) {
      missing = true;
      continue;
    }
    const num = Number(value);
    if (!Number.isFinite(num) || num < MIN_ROUND_SCORE || num > MAX_ROUND_SCORE) {
      if (!outOfRangePlayer) outOfRangePlayer = player;
    } else if (Math.abs(num % 2) === 1 && !oddPlayer) {
      oddPlayer = player;
    }
  }
  return { missing, oddPlayer, outOfRangePlayer };
}

// ─── Round-end helpers ────────────────────────────────────────────────────────

function buildRoundEndOrder(matchState) {
  const players = _shell.getActivePlayers(matchState);
  if (!players.length) return [];
  const dealerIndex = _shell.getDealerIndex(matchState);
  const startIndex =
    dealerIndex >= 0 ? (dealerIndex + 1) % players.length : 0;
  const order = [];
  for (let i = 0; i < players.length; i += 1) {
    order.push(String(players[(startIndex + i) % players.length].id));
  }
  return order;
}

function getRoundEndOrderMap(order) {
  const map = new Map();
  order.forEach((id, idx) => map.set(String(id), idx));
  return map;
}

function getNextRoundEndId(order) {
  if (!order.length) return null;
  for (let i = 0; i < order.length; i += 1) {
    if (!roundEndUnlocked.has(order[i])) return order[i];
  }
  return null;
}

function getRoundEndOrderIndex(matchState, playerId) {
  if (!roundEndOrder.length) {
    roundEndOrder = buildRoundEndOrder(matchState);
  }
  return roundEndOrder.indexOf(String(playerId));
}

function canContinueRoundEnd(matchState) {
  if (!matchState?.scoringEnabled) return false;
  const players = _shell.getActivePlayers(matchState);
  const { missing, oddPlayer, outOfRangePlayer } = validateScores(players, roundEndScores);
  return !missing && !oddPlayer && !outOfRangePlayer;
}

function getRoundEndWarningTargets() {
  return [
    document.getElementById("roundEndWarning"),
    document.getElementById("roundEndKeypadWarning"),
  ].filter(Boolean);
}

function getRoundEndValidationEntry(playerId) {
  return roundEndValidationByPlayer.get(String(playerId)) || null;
}

function setRoundEndValidationEntry(playerId, entry) {
  if (!playerId || !entry) return;
  roundEndValidationByPlayer.set(String(playerId), entry);
  syncRecordWordStatusFromEntry(playerId, entry);
}

function clearRoundEndValidationEntry(playerId) {
  if (!playerId) return;
  roundEndValidationByPlayer.delete(String(playerId));
  syncRecordWordStatusFromEntry(playerId, null);
}

function syncRecordWordStatusFromEntry(playerId, entry) {
  if (
    !recordWordModalState ||
    recordWordModalState.source !== "round-end" ||
    String(recordWordModalState.playerId) !== String(playerId)
  ) {
    return;
  }
  const statusEl = document.getElementById("recordWordValidationStatus");
  const input = document.getElementById("recordWordInput");
  if (!statusEl || !input) return;
  const wordKey = _shell.normalizeValidationWord(input.value || "");
  if (
    entry &&
    Number(entry.round) === Number(recordWordModalState.round) &&
    entry.wordKey === wordKey &&
    entry.statusText
  ) {
    statusEl.textContent = entry.statusText;
    statusEl.className = `${entry.statusClass} record-word-validation-status`;
    recordWordStatusWord = wordKey;
    recordWordStatusOk = entry.ok === true;
    return;
  }
  statusEl.textContent = "";
  statusEl.className = "match-validation-status record-word-validation-status";
  recordWordStatusWord = "";
  recordWordStatusOk = null;
}

function restoreRoundEndValidation(playerId) {
  const sections = _shell.getValidationSections();
  const section = sections.get("round-keypad");
  if (!section) return;
  const entry = getRoundEndValidationEntry(playerId);
  if (!entry) {
    _shell.clearMatchWordFor("round-keypad", false);
    _shell.clearStatusValidationFor("round-keypad");
    return;
  }
  if (section.input) {
    section.input.value = entry.word || "";
    _shell.updateValidationControls(section);
  }
  if (section.status) {
    section.status.textContent = entry.statusText || "";
    section.status.className = entry.statusClass || "match-validation-status";
  }
}

function clearRoundEndKeypadValidation() {
  const valueEl = document.getElementById("roundEndKeypadValue");
  if (valueEl) valueEl.classList.remove("is-invalid");
  const warnings = getRoundEndWarningTargets();
  warnings.forEach((warning) => warning.classList.add("hidden"));
}

function applyRoundEndKeypadValue(matchState, playerId, value) {
  const id = String(playerId);
  roundEndScores[id] = value;
  roundEndUnlocked.add(id);
  clearRoundEndKeypadValidation();
  updateRoundEndLockState(matchState);
  updateRoundEndContinueState(matchState);
  updateRoundEndKeypad(matchState);
}

function openRoundEndKeypad(playerId) {
  const st = matchController.getState();
  if (!st?.scoringEnabled) return;
  const id = String(playerId || "");
  if (!id) return;
  if (!roundEndOrder.length) {
    roundEndOrder = buildRoundEndOrder(st);
  }
  const nextId = getNextRoundEndId(roundEndOrder);
  const locked = !roundEndUnlocked.has(id) && id !== nextId;
  if (locked) {
    showRoundEndLockedWarning();
    return;
  }
  roundEndKeypadOpen = true;
  roundEndKeypadPlayerId = id;
  restoreRoundEndValidation(id);
  clearRoundEndKeypadValidation();
  updateRoundEndLockState(st);
  updateRoundEndContinueState(st);
  updateRoundEndKeypad(st);
}

function closeRoundEndKeypad({ autoAdvance = false } = {}) {
  const st = matchController.getState();
  roundEndKeypadOpen = false;
  roundEndKeypadPlayerId = null;
  updateRoundEndKeypad(st);
  if (autoAdvance && st && canContinueRoundEnd(st)) {
    handleRoundEndContinue();
  }
}

function getRoundEndKeypadNeighbor(matchState, direction) {
  const idx = getRoundEndOrderIndex(matchState, roundEndKeypadPlayerId);
  if (idx < 0) return null;
  const nextIndex = direction === "prev" ? idx - 1 : idx + 1;
  if (nextIndex < 0 || nextIndex >= roundEndOrder.length) return null;
  return roundEndOrder[nextIndex];
}

function validateRoundEndKeypadValue(matchState, playerId) {
  const id = String(playerId);
  const raw = roundEndScores[id];
  const warnings = getRoundEndWarningTargets();
  const valueEl = document.getElementById("roundEndKeypadValue");
  const playerLabel = _shell.getRoundEndPlayerLabel(matchState, id);
  const missing = isRoundScoreEmpty(raw);
  const odd = !missing && _shell.isOddScore(raw);
  const outOfRange = !missing && isScoreOutOfRange(raw);
  if (valueEl) valueEl.classList.toggle("is-invalid", odd || outOfRange || missing);
  if (!warnings.length) {
    return { valid: !(missing || odd || outOfRange) };
  }
  if (odd) {
    _shell.playValidationResultSound(false);
    warnings.forEach((warning) => {
      _shell.setI18n(warning, "matchRoundScoresOdd", { vars: { player: playerLabel } });
      warning.classList.toggle("hidden", false);
    });
    return { valid: false };
  }
  if (outOfRange) {
    _shell.playValidationResultSound(false);
    warnings.forEach((warning) => {
      _shell.setI18n(warning, "matchRoundScoresOutOfRange", {
        vars: { player: playerLabel, min: MIN_ROUND_SCORE, max: MAX_ROUND_SCORE },
      });
      warning.classList.toggle("hidden", false);
    });
    return { valid: false };
  }
  if (missing) {
    _shell.playValidationResultSound(false);
    warnings.forEach((warning) => {
      _shell.setI18n(warning, "matchRoundScoresMissing");
      warning.classList.toggle("hidden", false);
    });
    return { valid: false };
  }
  warnings.forEach((warning) => warning.classList.add("hidden"));
  return { valid: true };
}

function handleRoundEndKeypadKey(key) {
  const st = matchController.getState();
  if (!st?.scoringEnabled || !roundEndKeypadPlayerId) return;
  const id = String(roundEndKeypadPlayerId);
  const current = roundEndScores[id] ?? "";

  if (key === "back") {
    const negative = current.startsWith("-");
    const digits = current.replace("-", "");
    if (digits.length <= 1) {
      applyRoundEndKeypadValue(st, id, "");
      return;
    }
    const nextDigits = digits.slice(0, -1);
    const nextNum = Number(nextDigits) * (negative ? -1 : 1);
    applyRoundEndKeypadValue(st, id, String(nextNum));
    return;
  }

  if (key === "minus") {
    const num = Number(current) || 0;
    const next = num * -1;
    applyRoundEndKeypadValue(st, id, String(next));
    return;
  }

  if (key >= "0" && key <= "9") {
    const negative = current.startsWith("-");
    let digits = current.replace("-", "");
    if (digits === "0" || digits === "") {
      digits = key;
    } else {
      digits = `${digits}${key}`;
    }
    const nextNum = Number(digits) * (negative ? -1 : 1);
    applyRoundEndKeypadValue(st, id, String(nextNum));
  }
}

function handleRoundEndKeypadNavigate(direction) {
  const st = matchController.getState();
  if (!st?.scoringEnabled) return;
  const currentId = roundEndKeypadPlayerId;
  if (currentId && isRoundScoreEmpty(roundEndScores[String(currentId)])) {
    if (ROUND_KEYPAD_AUTO_ZERO_ON_NAV) {
      applyRoundEndKeypadValue(st, currentId, "0");
    }
  }
  if (currentId) {
    const isEmpty = isRoundScoreEmpty(roundEndScores[String(currentId)]);
    if (!(direction === "prev" && isEmpty)) {
      const validation = validateRoundEndKeypadValue(st, currentId);
      if (!validation.valid) {
        return;
      }
    }
    const raw = roundEndScores[String(currentId)];
    const points = Number(raw);
    const invalid = !isScoreValidForRecord(raw, { requireEven: true });
    const roundNumber = st.round;
    const records = loadRecords() || {};
    if (!invalid && _shell.canEnterWordRecords(points, records)) {
      const candidate = getWordCandidate(st.matchId, currentId, roundNumber);
      const shouldPrompt =
        !candidate ||
        candidate.ignored ||
        !candidate.word ||
        Number(candidate.points) !== points;
      if (shouldPrompt) {
        const nextId = getRoundEndKeypadNeighbor(st, direction);
        openRecordWordModal(
          {
            matchId: st.matchId,
            playerId: currentId,
            round: roundNumber,
            points,
            when: Date.now(),
            source: "round-end",
          },
          { pendingNext: { nextId, autoAdvance: !nextId && direction === "next" } }
        );
        return;
      }
    }
  }
  const nextId = getRoundEndKeypadNeighbor(st, direction);
  if (nextId) {
    openRoundEndKeypad(nextId);
    return;
  }
  closeRoundEndKeypad({
    autoAdvance: direction === "next" && AUTO_CONTINUE_ROUND_END,
  });
}

function getFirstOddRoundScore(matchState) {
  const players = _shell.getActivePlayers(matchState);
  for (const player of players) {
    const value = roundEndScores[String(player.id)];
    if (isRoundScoreEmpty(value)) continue;
    if (_shell.isOddScore(value)) return player;
  }
  return null;
}

// ─── Round-end keypad render ──────────────────────────────────────────────────

function updateRoundEndKeypad(matchState) {
  const keypad = document.getElementById("roundEndKeypad");
  if (!keypad) return;
  keypad.classList.toggle("hidden", !roundEndKeypadOpen);
  keypad.setAttribute("aria-hidden", roundEndKeypadOpen ? "false" : "true");
  if (!roundEndKeypadOpen) return;

  const playerId = roundEndKeypadPlayerId;
  const player = (matchState?.players || []).find((p) => String(p.id) === String(playerId));
  if (!player) return;

  const palette = getDealerPalette(player.color || "#d9c79f");
  const playerEl = document.getElementById("roundEndKeypadPlayer");
  if (playerEl) {
    playerEl.style.setProperty("--player-color", player.color || "#d9c79f");
    playerEl.style.setProperty("--player-border", palette.border);
    playerEl.style.setProperty("--player-text", palette.text);
  }

  const orderIndex = _shell.getPlayerIndexMap(matchState).get(String(playerId)) ?? 0;
  const orderPrefix = t("matchRoundPlayerPrefix");
  const orderEl = document.getElementById("roundEndKeypadOrder");
  const nameEl = document.getElementById("roundEndKeypadName");
  if (orderEl) orderEl.textContent = `${orderPrefix}${orderIndex + 1}`;
  if (nameEl) nameEl.textContent = player.name || "";

  const valueEl = document.getElementById("roundEndKeypadValue");
  if (valueEl) {
    const value = roundEndScores[String(playerId)];
    const textValue = isRoundScoreEmpty(value) ? "" : _shell.formatRoundEndScoreDisplay(value);
    const points = getScoreNumber(value);
    const invalid = !isScoreValidForRecord(value, { requireEven: true });
    const records = loadRecords() || {};
    const showRecord = !invalid && _shell.canEnterWordRecords(points, records);
    valueEl.textContent = "";
    const span = document.createElement("span");
    span.className = "round-end-keypad-value-text";
    span.textContent = textValue;
    valueEl.appendChild(span);
    const badge = document.createElement("span");
    badge.className = "round-end-keypad-record";
    badge.classList.toggle("hidden", !showRecord);
    valueEl.appendChild(badge);
    valueEl.classList.toggle("is-negative", Number(value) < 0);
    valueEl.classList.toggle("is-editing", true);
  }

  const prevBtn = document.getElementById("roundEndKeypadPrevBtn");
  const nextBtn = document.getElementById("roundEndKeypadNextBtn");
  const idx = getRoundEndOrderIndex(matchState, playerId);
  const prevId = idx > 0 ? roundEndOrder[idx - 1] : null;
  const nextId = idx >= 0 && idx < roundEndOrder.length - 1 ? roundEndOrder[idx + 1] : null;
  if (prevBtn) prevBtn.disabled = !prevId;
  if (nextBtn) {
    _shell.setI18nById(
      "roundEndKeypadNextBtn",
      nextId ? "matchRoundKeypadNext" : "matchRoundKeypadFinish"
    );
  }
}

function updateRoundEndContinueState(matchState) {
  const warning = document.getElementById("roundEndWarning");
  const continueBtn = document.getElementById("roundEndContinueBtn");
  const tieActions = document.getElementById("roundEndTieActions");
  const scoringEnabled = !!matchState?.scoringEnabled;
  const tieBreakPending =
    Array.isArray(matchState?.tieBreakPending?.players) &&
    matchState.tieBreakPending.players.length > 0;
  const roundsTarget = matchState.roundsTarget ?? DEFAULT_ROUNDS_TARGET;
  const roundsMode = matchState.mode === MATCH_MODE_ROUNDS;
  const manualSelection =
    !scoringEnabled &&
    (matchState.mode === MATCH_MODE_POINTS ||
      matchState.tieBreak ||
      matchState.round >= roundsTarget);
  const selectionCount = roundEndSelectedWinners.size;
  const showTieActions = tieBreakPending || (manualSelection && selectionCount > 1);
  const showContinue = !showTieActions;
  let disableContinue = false;

  if (continueBtn) {
    continueBtn.classList.toggle("hidden", !showContinue);
  }
  if (tieActions) {
    tieActions.classList.toggle("hidden", !showTieActions);
  }

  if (!scoringEnabled) {
    if (warning) warning.classList.add("hidden");
    if (manualSelection && roundsMode && selectionCount === 0) {
      disableContinue = true;
    }
    if (continueBtn) continueBtn.disabled = disableContinue;
    return;
  }

  if (tieBreakPending) {
    if (warning) warning.classList.add("hidden");
    return;
  }

  const players = _shell.getActivePlayers(matchState);
  const { missing, oddPlayer, outOfRangePlayer } = validateScores(players, roundEndScores);
  if (continueBtn) continueBtn.disabled = missing || !!oddPlayer || !!outOfRangePlayer;
  if (warning) {
    if (oddPlayer) {
      _shell.setI18n(warning, "matchRoundScoresOdd", {
        vars: { player: _shell.getRoundEndPlayerLabel(matchState, oddPlayer.id) },
      });
      warning.classList.toggle("hidden", false);
    } else if (outOfRangePlayer) {
      _shell.setI18n(warning, "matchRoundScoresOutOfRange", {
        vars: { player: _shell.getRoundEndPlayerLabel(matchState, outOfRangePlayer.id), min: MIN_ROUND_SCORE, max: MAX_ROUND_SCORE },
      });
      warning.classList.toggle("hidden", false);
    } else {
      _shell.setI18n(warning, "matchRoundScoresMissing");
      warning.classList.toggle("hidden", !missing);
    }
  }
  document.querySelectorAll(".round-end-score-row").forEach((row) => {
    const id = row.dataset.playerId;
    row.classList.toggle("is-empty", isRoundScoreEmpty(roundEndScores[id]));
    row.classList.toggle("is-odd", _shell.isOddScore(roundEndScores[id]));
    const pill = row.querySelector(".round-end-score-pill");
    if (pill) {
      pill.textContent = _shell.formatRoundEndScoreDisplay(roundEndScores[id]);
    }
  });
}

function updateRoundEndLockState(matchState) {
  roundEndOrder = buildRoundEndOrder(matchState);
  const order = roundEndOrder;
  const playerIndexMap = new Map();
  matchState.players.forEach((player, idx) => {
    playerIndexMap.set(String(player.id), idx);
  });
  const nextId = getNextRoundEndId(order);
  document.querySelectorAll(".round-end-score-row").forEach((row) => {
    const id = row.dataset.playerId;
    const unlocked = roundEndUnlocked.has(id) || id === nextId;
    row.classList.toggle("is-locked", !unlocked);
    const scoreBtn = row.querySelector(".round-end-score-pill");
    if (scoreBtn) scoreBtn.setAttribute("aria-disabled", unlocked ? "false" : "true");
  });
}

function shouldShowRoundEndWinners(matchState) {
  if (!matchState) return false;
  if (matchState.tieBreakPending?.players?.length) return true;
  if (matchState.scoringEnabled) return false;
  const roundsTarget = matchState.roundsTarget ?? DEFAULT_ROUNDS_TARGET;
  if (matchState.mode === MATCH_MODE_ROUNDS) {
    return matchState.tieBreak || matchState.round >= roundsTarget;
  }
  return true;
}

function getRoundEndWinnerCandidates(matchState) {
  if (matchState?.tieBreakPending?.players?.length) {
    const players = Array.isArray(matchState?.players) ? matchState.players : [];
    const map = new Map(players.map((p) => [String(p.id), p]));
    return matchState.tieBreakPending.players.map((id) => map.get(String(id))).filter(Boolean);
  }
  return _shell.getActivePlayers(matchState);
}

function renderRoundEndWinners(matchState) {
  const section = document.getElementById("roundEndWinnersSection");
  const listEl = document.getElementById("roundEndWinnersList");
  const titleEl = document.getElementById("roundEndWinnersTitle");
  if (!section || !listEl) return;
  const show = shouldShowRoundEndWinners(matchState);
  section.classList.toggle("hidden", !show);
  listEl.innerHTML = "";
  if (!show) return;

  const tiePending = !!matchState?.tieBreakPending?.players?.length;
  const roundsTarget = matchState.roundsTarget ?? DEFAULT_ROUNDS_TARGET;
  const isPoints = matchState.mode === MATCH_MODE_POINTS;
  const allowSelection = !matchState.scoringEnabled;
  const candidates = getRoundEndWinnerCandidates(matchState);
  const playerIndexMap = _shell.getPlayerIndexMap(matchState);

  if (titleEl) {
    if (tiePending) {
      _shell.setI18n(titleEl, "matchRoundTiePrompt");
    } else if (!matchState.scoringEnabled && isPoints) {
      _shell.setI18n(titleEl, "matchRoundSelectReached", {
        vars: { points: matchState.pointsTarget ?? DEFAULT_POINTS_TARGET },
      });
    } else {
      _shell.setI18n(titleEl, "matchRoundSelectTop", {
        vars: { rounds: roundsTarget },
      });
    }
  }

  if (tiePending) {
    roundEndSelectedWinners = new Set(
      matchState.tieBreakPending.players.map((id) => String(id))
    );
  }

  candidates.forEach((player) => {
    const playerId = String(player.id);
    const item = document.createElement("button");
    item.type = "button";
    item.className = "round-end-winner-item";
    item.dataset.playerId = playerId;
    if (roundEndSelectedWinners.has(playerId)) {
      item.classList.add("is-selected");
    }
    if (!allowSelection) {
      item.disabled = true;
      item.classList.add("is-locked");
    }
    const palette = getDealerPalette(player.color || "#d9c79f");
    item.style.setProperty("--player-color", player.color || "#d9c79f");
    item.style.setProperty("--player-border", palette.border);
    item.style.setProperty("--player-text", palette.text);

    const badge = document.createElement("span");
    badge.className = "round-end-winner-order";
    const orderIndex = playerIndexMap.get(playerId);
    badge.textContent = `${t("matchRoundPlayerPrefix")}${(orderIndex ?? 0) + 1}`;

    const name = document.createElement("span");
    name.className = "round-end-winner-name";
    name.textContent = player.name || "";

    item.append(badge, name);
    if (allowSelection) {
      item.addEventListener("click", () => {
        if (roundEndSelectedWinners.has(playerId)) {
          roundEndSelectedWinners.delete(playerId);
          item.classList.remove("is-selected");
        } else {
          roundEndSelectedWinners.add(playerId);
          item.classList.add("is-selected");
        }
        updateRoundEndContinueState(matchState);
      });
    }
    listEl.appendChild(item);
  });
}

function showRoundEndLockedWarning() {
  const st = matchController.getState();
  if (!st) return;
  const nextId = getNextRoundEndId(roundEndOrder);
  const nextIndex = st.players.findIndex(
    (p) => String(p.id) === String(nextId)
  );
  const nextPlayer = st.players[nextIndex];
  if (!nextPlayer) return;
  const orderPrefix = t("matchRoundPlayerPrefix");
  const label = `${orderPrefix}${nextIndex + 1} ${nextPlayer.name || ""}`.trim();
  _shell.openConfirm({
    title: "matchRoundOrderWarningTitle",
    body: "matchRoundOrderWarningBody",
    bodyVars: { player: label },
    acceptText: "confirmAccept",
    hideCancel: true,
  });
}

// ─── Scoreboard helpers ───────────────────────────────────────────────────────

function formatScoreboardScoreDisplay(value) {
  if (!isScoreFilled(value)) return t("matchRoundScorePlaceholder");
  return String(value);
}

function getScoreboardPlayerLabel(playerId) {
  const players = scoreboardPlayers || [];
  const idx = players.findIndex((p) => String(p.id) === String(playerId));
  if (idx < 0) return "";
  const orderPrefix = t("matchRoundPlayerPrefix");
  const name = players[idx]?.name?.trim() || "";
  return name ? `${orderPrefix}${idx + 1} ${name}` : `${orderPrefix}${idx + 1}`;
}

function buildScoreboardKeypadOrder() {
  const order = [];
  const rounds = scoreboardRounds || [];
  const players = scoreboardPlayers || [];
  rounds.forEach((round) => {
    players.forEach((player) => {
      order.push({ playerId: String(player.id), round });
    });
  });
  return order;
}

function getScoreboardKeypadIndex(playerId, round) {
  if (!scoreboardKeypadOrder.length) {
    scoreboardKeypadOrder = buildScoreboardKeypadOrder();
  }
  return scoreboardKeypadOrder.findIndex(
    (item) => item.playerId === String(playerId) && item.round === Number(round)
  );
}

function getScoreboardOddScore() {
  const rounds = scoreboardRounds || [];
  const players = scoreboardPlayers || [];
  for (const round of rounds) {
    for (const player of players) {
      const value = scoreboardDraft?.[String(player.id)]?.[round];
      if (!isScoreFilled(value)) continue;
      if (_shell.isOddScore(value)) {
        return { playerId: String(player.id), round };
      }
    }
  }
  return null;
}

function getScoreboardOutOfRangeScore() {
  const rounds = scoreboardRounds || [];
  const players = scoreboardPlayers || [];
  for (const round of rounds) {
    for (const player of players) {
      const value = scoreboardDraft?.[String(player.id)]?.[round];
      if (!isScoreFilled(value)) continue;
      const num = getScoreNumber(value);
      if (num < MIN_ROUND_SCORE || num > MAX_ROUND_SCORE) {
        return { playerId: String(player.id), round };
      }
    }
  }
  return null;
}

function getScoreboardMissingScore() {
  const rounds = scoreboardRounds || [];
  const players = scoreboardPlayers || [];
  for (const round of rounds) {
    for (const player of players) {
      const value = scoreboardDraft?.[String(player.id)]?.[round];
      if (!isScoreFilled(value)) {
        return { playerId: String(player.id), round };
      }
    }
  }
  return null;
}

function updateScoreboardWarnings() {
  const note = document.getElementById("scoreboardNote");
  const saveBtn = document.getElementById("scoreboardSaveBtn");
  if (!note) return;
  if (scoreboardReadOnly) {
    note.classList.add("hidden");
    if (saveBtn) saveBtn.disabled = true;
    return;
  }
  const odd = getScoreboardOddScore();
  const outOfRange = getScoreboardOutOfRangeScore();
  const missing = getScoreboardMissingScore();
  if (odd) {
    _shell.setI18n(note, "matchScoreboardOdd", {
      vars: {
        player: getScoreboardPlayerLabel(odd.playerId),
        round: odd.round,
      },
    });
    note.classList.remove("hidden");
    note.classList.add("has-icon");
  } else if (outOfRange) {
    _shell.setI18n(note, "matchScoreboardScoresOutOfRange", {
      vars: {
        player: getScoreboardPlayerLabel(outOfRange.playerId),
        round: outOfRange.round,
        min: MIN_ROUND_SCORE,
        max: MAX_ROUND_SCORE,
      },
    });
    note.classList.remove("hidden");
    note.classList.add("has-icon");
  } else if (missing) {
    _shell.setI18n(note, "matchScoreboardScoresMissing", {
      vars: {
        player: getScoreboardPlayerLabel(missing.playerId),
        round: missing.round,
      },
    });
    note.classList.remove("hidden");
    note.classList.add("has-icon");
  } else {
    note.classList.add("hidden");
    note.classList.remove("has-icon");
  }
  if (saveBtn) saveBtn.disabled = !!odd || !!outOfRange || !!missing;
  updateScoreboardActionPadding();
}

function updateScoreboardKeypad(matchState) {
  const keypad = document.getElementById("scoreboardKeypad");
  if (!keypad) return;
  keypad.classList.toggle("hidden", !scoreboardKeypadOpen);
  keypad.setAttribute("aria-hidden", scoreboardKeypadOpen ? "false" : "true");
  if (!scoreboardKeypadOpen) return;

  const playerId = scoreboardKeypadPlayerId;
  const round = scoreboardKeypadRound;
  const player = (scoreboardPlayers || []).find((p) => String(p.id) === String(playerId));
  if (!player) return;

  const palette = getDealerPalette(player.color || "#d9c79f");
  const playerEl = document.getElementById("scoreboardKeypadPlayer");
  if (playerEl) {
    playerEl.style.setProperty("--player-color", player.color || "#d9c79f");
    playerEl.style.setProperty("--player-border", palette.border);
    playerEl.style.setProperty("--player-text", palette.text);
  }

  const orderIndex =
    scoreboardPlayers.findIndex((p) => String(p.id) === String(playerId)) ?? 0;
  const orderPrefix = t("matchRoundPlayerPrefix");
  const orderEl = document.getElementById("scoreboardKeypadOrder");
  const nameEl = document.getElementById("scoreboardKeypadName");
  if (orderEl) orderEl.textContent = `${orderPrefix}${orderIndex + 1}`;
  if (nameEl) nameEl.textContent = player.name || "";

  const valueEl = document.getElementById("scoreboardKeypadValue");
  if (valueEl) {
    const value = scoreboardDraft?.[String(playerId)]?.[Number(round)];
    const textValue = isScoreFilled(value) ? String(value) : "";
    const points = getScoreNumber(value);
    const invalid = !isScoreValidForRecord(value, { requireEven: true });
    const records = loadRecords() || {};
    const showRecord = !invalid && _shell.canEnterWordRecords(points, records);
    valueEl.textContent = "";
    const span = document.createElement("span");
    span.className = "round-end-keypad-value-text";
    span.textContent = textValue;
    valueEl.appendChild(span);
    const badge = document.createElement("span");
    badge.className = "round-end-keypad-record";
    badge.classList.toggle("hidden", !showRecord);
    valueEl.appendChild(badge);
    valueEl.classList.toggle("is-negative", Number(value) < 0);
    valueEl.classList.toggle("is-editing", true);
  }
}

function openScoreboardKeypad(playerId, round) {
  if (scoreboardReadOnly) return;
  if (!scoreboardDraft) return;
  scoreboardKeypadOpen = true;
  scoreboardKeypadPlayerId = String(playerId);
  scoreboardKeypadRound = Number(round);
  scoreboardKeypadInitialValue =
    scoreboardDraft?.[String(playerId)]?.[Number(round)] ?? "";
  if (!scoreboardKeypadOrder.length) {
    scoreboardKeypadOrder = buildScoreboardKeypadOrder();
  }
  updateScoreboardKeypad(matchController.getState());
}

function closeScoreboardKeypad({ restore = false } = {}) {
  const id = scoreboardKeypadPlayerId;
  const round = scoreboardKeypadRound;
  const initialValue = scoreboardKeypadInitialValue;
  scoreboardKeypadOpen = false;
  scoreboardKeypadPlayerId = null;
  scoreboardKeypadRound = null;
  scoreboardKeypadInitialValue = null;
  if (restore && id != null && round != null && scoreboardDraft) {
    applyScoreboardKeypadValue(matchController.getState(), id, round, initialValue ?? "");
  }
  if (!restore && id != null && round != null) {
    handleScoreboardRecordCandidateUpdate(matchController.getState(), id, round, initialValue);
  }
  updateScoreboardKeypad(matchController.getState());
}

function handleScoreboardRecordCandidateUpdate(matchState, playerId, round, initialValue) {
  if (!matchState || scoreboardReadOnly) return;
  if (!scoreboardDraft) return;
  const matchId = matchState.matchId;
  if (!matchId) return;
  ensureScoreboardWordCandidatesDraft(matchState);
  const id = String(playerId);
  const rnd = Number(round);
  const current = scoreboardDraft?.[id]?.[rnd] ?? "";
  const previous = initialValue ?? "";
  if (String(current) === String(previous)) return;
  const invalid = !isScoreValidForRecord(current, { requireEven: true });
  const points = getScoreNumber(current);
  const records = loadRecords() || {};
  if (invalid || !_shell.canEnterWordRecords(points, records)) {
    removeScoreboardWordCandidate(matchId, id, rnd);
    return;
  }
  const existing = getScoreboardWordCandidate(matchId, id, rnd);
  if (!existing || existing.ignored || !existing.word) {
    openRecordWordModalFromScoreboard(
      {
        matchId,
        playerId: id,
        round: rnd,
        points,
        when: Date.now(),
        source: "scoreboard",
      },
      { pendingNext: null }
    );
    return;
  }
  upsertScoreboardWordCandidate(matchId, {
    ...existing,
    points,
    when: Date.now(),
    ignored: false,
  });
}

function applyScoreboardKeypadValue(matchState, playerId, round, value) {
  if (!scoreboardDraft) return;
  const id = String(playerId);
  const rnd = Number(round);
  if (!scoreboardDraft[id]) scoreboardDraft[id] = {};
  scoreboardDraft[id][rnd] = value;
  updateScoreboardDirty();
  updateScoreboardIndicators();
  updateScoreboardWarnings();
  updateScoreboardKeypad(matchState);
}

function handleScoreboardKeypadKey(key) {
  const st = matchController.getState();
  if (!scoreboardKeypadPlayerId || scoreboardKeypadRound == null) return;
  const id = String(scoreboardKeypadPlayerId);
  const round = Number(scoreboardKeypadRound);
  const current = scoreboardDraft?.[id]?.[round] ?? "";

  if (key === "back") {
    const negative = current.startsWith("-");
    const digits = current.replace("-", "");
    if (digits.length <= 1) {
      applyScoreboardKeypadValue(st, id, round, "");
      return;
    }
    const nextDigits = digits.slice(0, -1);
    const nextNum = Number(nextDigits) * (negative ? -1 : 1);
    applyScoreboardKeypadValue(st, id, round, String(nextNum));
    return;
  }

  if (key === "minus") {
    const num = Number(current) || 0;
    const next = num * -1;
    applyScoreboardKeypadValue(st, id, round, String(next));
    return;
  }

  if (key >= "0" && key <= "9") {
    const negative = current.startsWith("-");
    let digits = current.replace("-", "");
    if (digits === "0" || digits === "") {
      digits = key;
    } else {
      digits = `${digits}${key}`;
    }
    const nextNum = Number(digits) * (negative ? -1 : 1);
    applyScoreboardKeypadValue(st, id, round, String(nextNum));
  }
}

function handleScoreboardKeypadNavigate(direction) {
  if (scoreboardKeypadPlayerId != null && scoreboardKeypadRound != null) {
    handleScoreboardRecordCandidateUpdate(
      matchController.getState(),
      scoreboardKeypadPlayerId,
      scoreboardKeypadRound,
      scoreboardKeypadInitialValue
    );
  }
  const idx = getScoreboardKeypadIndex(scoreboardKeypadPlayerId, scoreboardKeypadRound);
  if (idx < 0) {
    closeScoreboardKeypad();
    return;
  }
  const nextIndex = direction === "prev" ? idx - 1 : idx + 1;
  if (nextIndex < 0 || nextIndex >= scoreboardKeypadOrder.length) {
    closeScoreboardKeypad();
    return;
  }
  const next = scoreboardKeypadOrder[nextIndex];
  if (next) {
    openScoreboardKeypad(next.playerId, next.round);
  }
}

// ─── Scoreboard data ──────────────────────────────────────────────────────────

function formatScoreboardName(name) {
  const trimmed = name.trim();
  if (!trimmed) return name;
  if (/\s/.test(trimmed) || trimmed.length < 9) {
    return trimmed;
  }
  const mid = Math.ceil(trimmed.length / 2);
  return `${trimmed.slice(0, mid)}​${trimmed.slice(mid)}`;
}

function cloneScoreboardValues(values) {
  return JSON.parse(JSON.stringify(values || {}));
}

function buildScoreboardData(matchState) {
  const players = Array.isArray(matchState?.players) ? matchState.players : [];
  const roundSet = new Set();
  players.forEach((player) => {
    (player.rounds || []).forEach((entry) => {
      if (Number.isFinite(Number(entry.round))) {
        roundSet.add(Number(entry.round));
      }
    });
  });
  const rounds = Array.from(roundSet).sort((a, b) => b - a);
  const values = {};
  players.forEach((player) => {
    const map = {};
    rounds.forEach((round) => {
      map[round] = "";
    });
    (player.rounds || []).forEach((entry) => {
      if (rounds.includes(entry.round)) {
        map[entry.round] = String(entry.points ?? 0);
      }
    });
    values[String(player.id)] = map;
  });
  return { rounds, players, values };
}

function getScoreboardTotals(players, rounds, values) {
  const totals = new Map();
  players.forEach((player) => {
    const id = String(player.id);
    const row = values[id] || {};
    const total = rounds.reduce((sum, round) => {
      const value = row[round];
      if (!isScoreFilled(value) || isScoreOutOfRange(value)) return sum;
      return sum + getScoreNumber(value);
    }, 0);
    totals.set(id, total);
  });
  return totals;
}

function getScoreboardRoundMax(rounds, players, values) {
  const maxMap = new Map();
  rounds.forEach((round) => {
    let max = null;
    players.forEach((player) => {
      const value = values[String(player.id)]?.[round];
      if (!isScoreFilled(value)) return;
      const num = getScoreNumber(value);
      if (max === null || num > max) max = num;
    });
    if (max !== null) maxMap.set(round, max);
  });
  return maxMap;
}

function getScoreboardOverallMax(rounds, players, values) {
  let overall = null;
  rounds.forEach((round) => {
    players.forEach((player) => {
      const value = values[String(player.id)]?.[round];
      if (!isScoreFilled(value)) return;
      const num = getScoreNumber(value);
      if (overall === null || num > overall) overall = num;
    });
  });
  return overall;
}

function updateScoreboardDirty() {
  if (!scoreboardBase || !scoreboardDraft) return;
  let dirty = false;
  Object.keys(scoreboardDraft).forEach((playerId) => {
    const baseRow = scoreboardBase[playerId] || {};
    const draftRow = scoreboardDraft[playerId] || {};
    Object.keys(draftRow).forEach((round) => {
      if (String(baseRow[round] ?? "") !== String(draftRow[round] ?? "")) {
        dirty = true;
      }
    });
  });
  scoreboardDirty = dirty;
  const actionButtons = document.getElementById("scoreboardActionButtons");
  if (actionButtons) {
    actionButtons.classList.toggle("hidden", scoreboardReadOnly || !scoreboardDirty);
  }
  updateScoreboardWarnings();
}

function updateScoreboardIndicators() {
  const table = document.getElementById("scoreboardTable");
  const tableLeft = document.getElementById("scoreboardTableLeftCol");
  if (!table || !scoreboardDraft) return;
  const players = scoreboardPlayers || [];
  const rounds = scoreboardRounds || [];
  const totals = getScoreboardTotals(players, rounds, scoreboardDraft);
  const maxTotal = Math.max(...Array.from(totals.values()), 0);
  const roundMax = getScoreboardRoundMax(rounds, players, scoreboardDraft);
  const overallMax = getScoreboardOverallMax(rounds, players, scoreboardDraft);

  if (tableLeft) {
    tableLeft.querySelectorAll(".scoreboard-player-cell").forEach((cell) => {
      const playerId = cell.dataset.playerId;
      if (!playerId) return;
      const totalEl = cell.querySelector(".scoreboard-player-total");
      if (totalEl) {
        totalEl.textContent = String(totals.get(playerId) ?? 0);
      }
      cell.classList.toggle(
        "is-leader",
        maxTotal > 0 && totals.get(playerId) === maxTotal && maxTotal > 0
      );
    });
  }

  table.querySelectorAll(".scoreboard-score-cell").forEach((cell) => {
    const round = Number(cell.dataset.round);
    const playerId = cell.dataset.playerId;
    if (!playerId || !Number.isFinite(round)) return;
    const value = scoreboardDraft[playerId]?.[round];
    const roundMaxValue = roundMax.get(round);
    const scoreNum = getScoreNumber(value);
    const isValid = isScoreFilled(value) && !isScoreOutOfRange(value);
    const isRoundMax =
      roundMaxValue != null &&
      isValid &&
      scoreNum === roundMaxValue && scoreNum > 0;
    const isOverallMax =
      overallMax != null &&
      isValid &&
      scoreNum === overallMax && scoreNum > 0;
    cell.classList.toggle("is-round-max", isRoundMax);
    cell.classList.toggle("is-overall-max", isOverallMax);

    const pill = cell.querySelector(".scoreboard-score-pill");
    if (pill) {
      pill.textContent = formatScoreboardScoreDisplay(value);
      pill.classList.toggle("is-empty", !isScoreFilled(value));
      pill.classList.toggle("is-odd", _shell.isOddScore(value));
      pill.classList.toggle("is-negative", isScoreFilled(value) && getScoreNumber(value) < 0);
      pill.classList.toggle("is-invalid", isScoreOutOfRange(value));
    }
    const label = cell.querySelector(".scoreboard-score-value");
    if (label) {
      label.textContent = isScoreFilled(value)
        ? String(value)
        : t("matchRoundScorePlaceholder");
      label.classList.toggle("is-negative", isScoreFilled(value) && getScoreNumber(value) < 0);
      label.classList.toggle("is-invalid", isScoreOutOfRange(value));
    }
  });
}

export function renderScoreboardScreen(matchState) {
  const table = document.getElementById("scoreboardTable");
  const tableHeader = document.getElementById("scoreboardTableHeaderRow");
  const tableLeft = document.getElementById("scoreboardTableLeftCol");
  const tableCorner = document.getElementById("scoreboardTableCorner");
  const tableShell = document.getElementById("scoreboardTableShell");
  const tableWrap = document.getElementById("scoreboardTableWrap");
  const editHint = document.getElementById("scoreboardEditHint");
  const note = document.getElementById("scoreboardNote");
  const actionButtons = document.getElementById("scoreboardActionButtons");
  const shareBtn = document.getElementById("scoreboardShareBtn");
  if (!table || !tableHeader || !tableLeft || !tableCorner || !tableShell) return;
  let emptyEl = document.getElementById("scoreboardEmpty");
  if (!emptyEl) {
    emptyEl = document.createElement("div");
    emptyEl.id = "scoreboardEmpty";
    emptyEl.className = "scoreboard-empty hidden";
    tableShell.appendChild(emptyEl);
  }

  if (!scoreboardDraft) {
    const data = buildScoreboardData(matchState);
    scoreboardRounds = data.rounds;
    scoreboardPlayers = data.players;
    scoreboardBase = cloneScoreboardValues(data.values);
    scoreboardDraft = cloneScoreboardValues(data.values);
    scoreboardDirty = false;
  }
  if (!scoreboardReadOnly) {
    ensureScoreboardWordCandidatesDraft(matchState);
  }

  const rounds = scoreboardRounds || [];
  const players = scoreboardPlayers || [];
  tableShell.style.setProperty("--scoreboard-rounds", Math.max(1, rounds.length).toString());
  table.innerHTML = "";
  tableHeader.innerHTML = "";
  tableLeft.innerHTML = "";

  if (actionButtons) {
    actionButtons.classList.toggle("hidden", scoreboardReadOnly || !scoreboardDirty);
  }
  const dateText =
    scoreboardInfoText ||
    (matchState?.matchOver
      ? _shell.buildRecordDateMessage(matchState.updatedAt || matchState.lastSavedAt || Date.now())
      : "");
  const showDateMeta = !!dateText;
  if (editHint) {
    if (showDateMeta) {
      editHint.textContent = dateText;
      editHint.classList.remove("hidden");
    } else if (scoreboardReadOnly) {
      editHint.classList.add("hidden");
    } else {
      editHint.textContent = t("matchScoreboardEditHint") || "";
      editHint.classList.remove("hidden");
    }
  }
  if (shareBtn) {
    _shell.applyShareIcon(shareBtn, t("scoreboardShare") || "Compartir");
    shareBtn.classList.toggle("hidden", !showDateMeta);
  }

  if (!rounds.length || !players.length) {
    if (editHint) editHint.classList.add("hidden");
    if (shareBtn) shareBtn.classList.add("hidden");
    tableCorner.textContent = "";
    tableShell.classList.add("is-empty");
    tableCorner.style.display = "none";
    tableHeader.style.display = "none";
    tableLeft.style.display = "none";
    if (tableWrap) tableWrap.style.display = "none";
    _shell.setI18n(emptyEl, "matchScoreboardEmpty");
    emptyEl.classList.remove("hidden");
    return;
  }
  if (shareBtn) shareBtn.classList.remove("hidden");
  tableShell.classList.remove("is-empty");
  tableCorner.style.display = "";
  tableHeader.style.display = "";
  tableLeft.style.display = "";
  if (tableWrap) tableWrap.style.display = "";
  emptyEl.classList.add("hidden");

  tableCorner.className =
    "scoreboard-cell scoreboard-header scoreboard-player-cell scoreboard-corner";
  _shell.setI18n(tableCorner, "matchScoreboardPlayerHeader");
  rounds.forEach((round) => {
    const header = document.createElement("div");
    header.className = "scoreboard-cell scoreboard-header";
    const label = t("matchScoreboardRoundShort").replace("{round}", round);
    header.textContent = label;
    tableHeader.appendChild(header);
  });

  const totals = getScoreboardTotals(players, rounds, scoreboardDraft);
  const maxTotal = Math.max(...Array.from(totals.values()), 0);
  const roundMax = getScoreboardRoundMax(rounds, players, scoreboardDraft);
  const overallMax = getScoreboardOverallMax(rounds, players, scoreboardDraft);
  const orderPrefix = t("matchRoundPlayerPrefix");

  players.forEach((player, idx) => {
    const id = String(player.id);
    const palette = getDealerPalette(player.color || "#d9c79f");
    const playerCell = document.createElement("div");
    playerCell.className = "scoreboard-cell scoreboard-player-cell";
    playerCell.dataset.playerId = id;
    playerCell.style.setProperty("--player-color", player.color || "#d9c79f");
    playerCell.style.setProperty("--player-border", palette.border);
    playerCell.style.setProperty("--player-text", palette.text);
    playerCell.style.setProperty("--points-pill-bg", darkenHexColor(player.color || "#d9c79f", 0.92));
    playerCell.style.setProperty(
      "--points-pill-border",
      darkenHexColor(player.color || "#d9c79f", 0.8)
    );
    playerCell.classList.toggle(
      "is-leader",
      maxTotal > 0 && totals.get(id) === maxTotal && maxTotal > 0
    );

    const info = document.createElement("div");
    info.className = "scoreboard-player-info";
    const order = document.createElement("span");
    order.className = "scoreboard-player-order";
    order.textContent = `${orderPrefix}${idx + 1}`;
    const name = document.createElement("span");
    name.className = "scoreboard-player-name";
    name.textContent = player.name || `${t("playerLabel")} ${idx + 1}`;
    info.append(order, name);

    const total = document.createElement("span");
    total.className = "scoreboard-player-total";
    total.textContent = String(totals.get(id) ?? 0);

    const leaderBadge = document.createElement("span");
    leaderBadge.className = "scoreboard-player-leader";
    leaderBadge.setAttribute("aria-hidden", "true");

    playerCell.append(info, total, leaderBadge);
    tableLeft.appendChild(playerCell);

    rounds.forEach((round) => {
      const cell = document.createElement("div");
      cell.className = "scoreboard-cell scoreboard-score-cell";
      cell.dataset.playerId = id;
      cell.dataset.round = String(round);
      const value = scoreboardDraft[id]?.[round] ?? "";
      const scoreNum = getScoreNumber(value);
      const isValid = isScoreFilled(value) && !isScoreOutOfRange(value);
      const isRoundMax =
        roundMax.get(round) != null &&
        isValid &&
        scoreNum === roundMax.get(round) && scoreNum > 0;
      const isOverallMax =
        overallMax != null &&
        isValid &&
        scoreNum === overallMax && scoreNum > 0;
      cell.classList.toggle("is-round-max", isRoundMax);
      cell.classList.toggle("is-overall-max", isOverallMax);
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "scoreboard-score-pill";
      pill.textContent = formatScoreboardScoreDisplay(value);
      pill.classList.toggle("is-empty", !isScoreFilled(value));
      pill.classList.toggle("is-odd", _shell.isOddScore(value));
      pill.classList.toggle("is-negative", isScoreFilled(value) && getScoreNumber(value) < 0);
      pill.classList.toggle("is-invalid", isScoreOutOfRange(value));
      if (scoreboardReadOnly) {
        pill.disabled = true;
        pill.classList.add("is-readonly");
      }
      const isRecord =
        scoreboardRecordHighlight &&
        String(matchState?.matchId || "") === String(scoreboardRecordHighlight.matchId) &&
        String(scoreboardRecordHighlight.playerId) === id &&
        Number(scoreboardRecordHighlight.round) === Number(round);
      if (isRecord) {
        cell.classList.add("is-record");
        pill.classList.add("is-record");
      }
      cell.appendChild(pill);
      table.appendChild(cell);
    });
  });
  updateScoreboardWarnings();
  updateScoreboardHintBounds();
  const hintOverlay = document.getElementById("scoreboardHints");
  if (tableWrap) {
    requestAnimationFrame(() => {
      _shell.updateHorizontalScrollHintState(tableWrap, hintOverlay || tableShell);
      _shell.updateScrollHintState(tableWrap, null, null, hintOverlay || tableShell);
      const config = tableWrap.closest(".scoreboard-config");
      if (config) _shell.updateScrollHintState(tableWrap, null, null, config);
      const header = document.getElementById("scoreboardTableHeader");
      const left = document.getElementById("scoreboardTableLeft");
      const leftCol = document.getElementById("scoreboardTableLeftCol");
      if (header) header.scrollLeft = tableWrap.scrollLeft;
      if (leftCol) leftCol.style.transform = "";
      if (left) left.scrollTop = tableWrap.scrollTop;
    });
  }
}

function renderMatchScoreboard(matchState) {
  const board = document.getElementById("matchScoreboard");
  const boardTitle = document.getElementById("matchScoreboardTitle");
  const boardGrid = document.getElementById("matchScoreGrid");
  if (!board) return;
  const show =
    matchState.phase !== "config";
  board.classList.toggle("hidden", !show);
  if (!show) {
    if (boardGrid) boardGrid.innerHTML = "";
    return;
  }
  const players = Array.isArray(matchState.players) ? matchState.players : [];
  const activePlayers = _shell.getActivePlayers(matchState);
  const activeIds = new Set(activePlayers.map((p) => String(p.id)));
  if (!players.length) {
    if (boardGrid) boardGrid.innerHTML = "";
    return;
  }
  if (boardTitle) {
    if (matchState.scoringEnabled) {
      if (matchState.mode === MATCH_MODE_POINTS) {
        const pointsTarget = matchState.pointsTarget ?? DEFAULT_POINTS_TARGET;
        _shell.setI18n(boardTitle, "matchScoreboardGoalPoints", {
          vars: { points: pointsTarget },
        });
      } else {
        const roundsTarget = matchState.roundsTarget ?? DEFAULT_ROUNDS_TARGET;
        _shell.setI18n(boardTitle, "matchScoreboardGoalRounds", {
          vars: { rounds: roundsTarget },
        });
      }
    } else {
      _shell.setI18n(boardTitle, "matchScoreboardOrderTitle");
    }
  }
  const dealerIndex = _shell.getDealerIndex(matchState);
  const dealerId =
    activePlayers[dealerIndex] != null ? String(activePlayers[dealerIndex].id) : null;
  const scoreSource = activePlayers.length ? activePlayers : players;
  const scores = scoreSource.map((p) => Number(p.score) || 0);
  const maxScore = Math.max(...scores);
  const showLeaders = matchState.scoringEnabled && maxScore > 0;
  const leaderIds = showLeaders
    ? scoreSource.filter((p) => (Number(p.score) || 0) === maxScore).map((p) => p.id)
    : [];

  board.style.setProperty("--score-columns", Math.min(2, players.length).toString());
  if (boardGrid) boardGrid.innerHTML = "";

  players.forEach((player, idx) => {
    const score = Number(player.score) || 0;
    const playerId = String(player.id);
    const isActive = !activePlayers.length || activeIds.has(playerId);
    const isDealer = dealerId === playerId;
    const isLeader = isActive && leaderIds.includes(player.id);
    const item = document.createElement("div");
    item.className = "match-score-item";
    if (isDealer) item.classList.add("is-dealer");
    if (isLeader) item.classList.add("is-leader");
    if (!isActive) item.classList.add("is-inactive");
    const color = player.color || "#d9b874";
    const palette = getDealerPalette(color);
    item.style.setProperty("--chip-bg", color);
    item.style.setProperty("--chip-border", palette.border);
    item.style.setProperty("--chip-text", palette.text);
    item.style.setProperty("--points-pill-bg", darkenHexColor(color, 0.92));
    item.style.setProperty("--points-pill-border", darkenHexColor(color, 0.8));
    if (isDealer) {
      item.style.setProperty("--dealer-bg", palette.bg);
      item.style.setProperty("--dealer-border", palette.border);
      item.style.setProperty("--dealer-text", palette.text);
    }

    const top = document.createElement("div");
    top.className = "match-score-top";
    const nameEl = document.createElement("span");
    nameEl.className = "match-score-name";
    const rawName = player.name || `${t("playerLabel")} ${idx + 1}`;
    const displayName = formatScoreboardName(rawName);
    nameEl.textContent = displayName;
    const nameLength = rawName.trim().length;
    if (nameLength >= 13) {
      nameEl.classList.add("match-score-name-xlong");
    } else if (nameLength >= 11) {
      nameEl.classList.add("match-score-name-long");
    }
    top.appendChild(nameEl);

    const meta = document.createElement("div");
    meta.className = "match-score-meta";
    if (matchState.scoringEnabled) {
      const pointsEl = document.createElement("span");
      pointsEl.className = "match-score-points";
      if (isLeader) pointsEl.classList.add("is-leader");
      pointsEl.textContent = String(score);
      pointsEl.classList.toggle("is-negative", score < 0);
      meta.appendChild(pointsEl);
    }

    const leaderBadge = document.createElement("span");
    leaderBadge.className = "match-score-leader";
    leaderBadge.setAttribute("aria-hidden", "true");

    const dealerBadge = document.createElement("span");
    dealerBadge.className = "match-score-dealer";
    dealerBadge.textContent = t("matchDealerLabel").replace(":", "").trim();

    item.appendChild(top);
    if (matchState.scoringEnabled) {
      item.appendChild(meta);
    }
    item.appendChild(leaderBadge);
    item.appendChild(dealerBadge);
    boardGrid?.appendChild(item);
  });
}

function renderMatch() {
  renderMatchFromState(matchController.getState());
}

function renderMatchFromState(matchState) {
  _shell.renderMatchFromState(matchState);
}

export function updateScoreboardActionPadding() {
  const shell = document.getElementById("scoreboardTableShell");
  const actions = document.getElementById("scoreboardActions");
  const wrap = document.getElementById("scoreboardTableWrap");
  if (!shell || !actions || !wrap) return;
  const note = document.getElementById("scoreboardNote");
  const buttons = document.getElementById("scoreboardActionButtons");
  const hasContent =
    (note && !note.classList.contains("hidden")) ||
    (buttons && !buttons.classList.contains("hidden"));
  const isPortrait = window.matchMedia
    ? window.matchMedia("(orientation: portrait)").matches
    : window.innerHeight > window.innerWidth;
  const playerCount = (scoreboardPlayers || []).length;
  const allowPad = !isPortrait || playerCount > 6;
  let pad = 0;
  if (hasContent && allowPad) {
    const hintBase = actions.offsetHeight;
    if (isPortrait) {
      pad = hintBase;
    } else {
      const wrapRect = wrap.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const overlaps = actionsRect.top < wrapRect.bottom - 1;
      pad = overlaps ? hintBase : 0;
    }
  }
  shell.style.setProperty("--scoreboard-actions-pad", `${pad}px`);
}

function updateScoreboardHintBounds() {
  const hints = document.getElementById("scoreboardHints");
  const wrap = document.getElementById("scoreboardTableWrap");
  if (!hints || !wrap) return;
  const config = wrap.closest(".scoreboard-config");
  if (!config) return;
  const wrapRect = wrap.getBoundingClientRect();
  const configRect = config.getBoundingClientRect();
  const top = Math.max(0, wrapRect.top - configRect.top);
  const left = Math.max(0, wrapRect.left - configRect.left);
  const right = Math.max(0, configRect.right - wrapRect.right);
  const bottom = Math.max(0, configRect.bottom - wrapRect.bottom);
  hints.style.top = `${top}px`;
  hints.style.left = `${left}px`;
  hints.style.right = `${right}px`;
  hints.style.bottom = `${bottom}px`;
}

// ─── Open/close scoreboard ────────────────────────────────────────────────────

function openRoundEndScreen() {
  const st = matchController.getState();
  if (!st) return;
  roundEndScores = {};
  roundEndOrder = buildRoundEndOrder(st);
  roundEndUnlocked = new Set();
  roundEndSelectedWinners = new Set();
  roundEndValidationByPlayer = new Map();
  roundEndKeypadOpen = false;
  roundEndKeypadPlayerId = null;
  const activePlayers = _shell.getActivePlayers(st);
  activePlayers.forEach((player) => {
    roundEndScores[String(player.id)] = "";
  });
  _shell.stopMatchTimer();
  _shell.stopClockLoop(false);
  _shell.showScreen("round-end");
  if (st.scoringEnabled && roundEndOrder.length) {
    const firstId = getNextRoundEndId(roundEndOrder);
    if (firstId) {
      openRoundEndKeypad(firstId);
    }
  }
}

function openScoreboard({ readOnly = false } = {}) {
  const st = matchController.getState();
  if (!st) return;
  _shell.pausedBeforeScoreboard.value = null;
  if (st.phase === "strategy-run") {
    _shell.pausedBeforeScoreboard.value = "strategy";
    matchController.pause();
    _shell.stopClockLoop(false);
  } else if (st.phase === "creation-run") {
    _shell.pausedBeforeScoreboard.value = "creation";
    matchController.pause();
    _shell.stopClockLoop(false);
  }
  const data = buildScoreboardData(st);
  scoreboardRounds = data.rounds;
  scoreboardPlayers = data.players;
  scoreboardBase = cloneScoreboardValues(data.values);
  scoreboardDraft = cloneScoreboardValues(data.values);
  scoreboardDirty = false;
  scoreboardReadOnly = readOnly;
  scoreboardInfoText = "";
  scoreboardReturnScreen = _shell.currentScreen() || "match";
  scoreboardReturnWinners = _shell.winnersModalOpen.value;
  scoreboardKeypadOpen = false;
  scoreboardKeypadPlayerId = null;
  scoreboardKeypadRound = null;
  scoreboardKeypadOrder = [];
  scoreboardKeypadInitialValue = null;
  if (_shell.winnersModalOpen.value) {
    _shell.suppressWinnersPrompt.value = true;
    closeModal("match-winners", { reason: "scoreboard" });
  }
  renderScoreboardScreen(st);
  _shell.showScreen("scoreboard");
  _shell.scaleGame();
}

function closeScoreboard() {
  const resumePhase = _shell.pausedBeforeScoreboard.value;
  _shell.pausedBeforeScoreboard.value = null;
  scoreboardDraft = null;
  scoreboardBase = null;
  scoreboardRounds = [];
  scoreboardPlayers = [];
  scoreboardDirty = false;
  scoreboardReadOnly = false;
  scoreboardInfoText = "";
  scoreboardRecordHighlight = null;
  scoreboardKeypadOpen = false;
  scoreboardKeypadPlayerId = null;
  scoreboardKeypadRound = null;
  scoreboardKeypadOrder = [];
  scoreboardKeypadInitialValue = null;
  _shell.showScreen(scoreboardReturnScreen || "match");
  _shell.scaleGame();
  if (scoreboardReturnWinners && _shell.lastWinnersIds.value.length) {
    _shell.suppressWinnersPrompt.value = false;
    scoreboardReturnWinners = false;
    _shell.showMatchWinners(_shell.lastWinnersIds.value);
  } else {
    scoreboardReturnWinners = false;
  }
  if (resumePhase) {
    const st = matchController.getState();
    if (resumePhase === "strategy" && st?.phase === "strategy-paused") {
      _shell.startMatchPhase("strategy");
    } else if (resumePhase === "creation" && st?.phase === "creation-paused") {
      _shell.startMatchPhase("creation");
    }
  }
}

// ─── Word candidates ──────────────────────────────────────────────────────────

function loadWordCandidatesMap() {
  const raw = localStorage.getItem(WORD_CANDIDATES_KEY);
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveWordCandidatesMap(map) {
  localStorage.setItem(WORD_CANDIDATES_KEY, JSON.stringify(map || {}));
}

function cloneWordCandidatesList(list) {
  return (list || []).map((item) => ({
    ...item,
    features: item?.features ? { ...item.features } : undefined,
  }));
}

function getWordCandidatesListFromMap(map, matchId) {
  return Array.isArray(map?.[matchId]) ? map[matchId] : [];
}

function getWordCandidateFromList(list, playerId, round) {
  return (
    (list || []).find(
      (item) =>
        String(item?.playerId) === String(playerId) &&
        Number(item?.round) === Number(round)
    ) || null
  );
}

function upsertWordCandidateInList(list, candidate) {
  const idx = (list || []).findIndex(
    (item) =>
      String(item?.playerId) === String(candidate?.playerId) &&
      Number(item?.round) === Number(candidate?.round)
  );
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...candidate };
  } else {
    list.push(candidate);
  }
  return list;
}

function removeWordCandidateFromList(list, playerId, round) {
  const idx = (list || []).findIndex(
    (item) =>
      String(item?.playerId) === String(playerId) &&
      Number(item?.round) === Number(round)
  );
  if (idx >= 0) list.splice(idx, 1);
  return list;
}

function ensureScoreboardWordCandidatesDraft(matchState) {
  const matchId = matchState?.matchId;
  if (!matchId) return;
  if (scoreboardWordCandidatesMatchId === matchId && scoreboardWordCandidatesDraft) {
    return;
  }
  const map = loadWordCandidatesMap();
  scoreboardWordCandidatesDraft = cloneWordCandidatesList(
    getWordCandidatesListFromMap(map, matchId)
  );
  scoreboardWordCandidatesDirty = false;
  scoreboardWordCandidatesMatchId = matchId;
}

function getScoreboardWordCandidate(matchId, playerId, round) {
  if (scoreboardWordCandidatesMatchId === matchId && scoreboardWordCandidatesDraft) {
    return getWordCandidateFromList(scoreboardWordCandidatesDraft, playerId, round);
  }
  return getWordCandidate(matchId, playerId, round);
}

function upsertScoreboardWordCandidate(matchId, candidate) {
  if (!matchId) return;
  if (scoreboardWordCandidatesMatchId !== matchId || !scoreboardWordCandidatesDraft) {
    ensureScoreboardWordCandidatesDraft({ matchId });
  }
  if (!scoreboardWordCandidatesDraft) return;
  upsertWordCandidateInList(scoreboardWordCandidatesDraft, candidate);
  scoreboardWordCandidatesDirty = true;
}

function removeScoreboardWordCandidate(matchId, playerId, round) {
  if (!matchId) return;
  if (scoreboardWordCandidatesMatchId !== matchId || !scoreboardWordCandidatesDraft) {
    ensureScoreboardWordCandidatesDraft({ matchId });
  }
  if (!scoreboardWordCandidatesDraft) return;
  removeWordCandidateFromList(scoreboardWordCandidatesDraft, playerId, round);
  scoreboardWordCandidatesDirty = true;
}

function persistScoreboardWordCandidatesDraft() {
  const matchId = scoreboardWordCandidatesMatchId;
  if (!matchId || !scoreboardWordCandidatesDirty) return;
  const map = loadWordCandidatesMap();
  map[matchId] = cloneWordCandidatesList(scoreboardWordCandidatesDraft || []);
  saveWordCandidatesMap(map);
  scoreboardWordCandidatesDirty = false;
}

function discardScoreboardWordCandidatesDraft(matchState) {
  const matchId = matchState?.matchId || scoreboardWordCandidatesMatchId;
  if (!matchId) return;
  const map = loadWordCandidatesMap();
  scoreboardWordCandidatesDraft = cloneWordCandidatesList(
    getWordCandidatesListFromMap(map, matchId)
  );
  scoreboardWordCandidatesDirty = false;
  scoreboardWordCandidatesMatchId = matchId;
}

function getWordCandidate(matchId, playerId, round) {
  const map = loadWordCandidatesMap();
  const list = Array.isArray(map[matchId]) ? map[matchId] : [];
  return (
    list.find(
      (item) =>
        String(item?.playerId) === String(playerId) &&
        Number(item?.round) === Number(round)
    ) || null
  );
}

function upsertWordCandidate(matchId, candidate) {
  const map = loadWordCandidatesMap();
  const list = Array.isArray(map[matchId]) ? [...map[matchId]] : [];
  const idx = list.findIndex(
    (item) =>
      String(item?.playerId) === String(candidate?.playerId) &&
      Number(item?.round) === Number(candidate?.round)
  );
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...candidate };
  } else {
    list.push(candidate);
  }
  map[matchId] = list;
  saveWordCandidatesMap(map);
}

// ─── Record word modal ────────────────────────────────────────────────────────

function openRecordWordModal(candidate, { pendingNext = null } = {}) {
  const input = document.getElementById("recordWordInput");
  const statusEl = document.getElementById("recordWordValidationStatus");
  recordWordModalState = candidate;
  recordWordPendingNext = pendingNext;
  recordWordModalStaging = false;
  recordWordStatusWord = "";
  recordWordStatusOk = null;
  recordWordFeatures = {
    sameColor: false,
    usedWildcard: false,
    doubleScore: false,
    plusPoints: false,
    minusPoints: false,
  };
  if (candidate?.matchId && candidate?.playerId != null && candidate?.round != null) {
    const existing = getWordCandidate(candidate.matchId, candidate.playerId, candidate.round);
    if (existing?.features) {
      recordWordFeatures = { ...recordWordFeatures, ...existing.features };
    }
    if (existing?.word) {
      candidate.word = existing.word;
    }
    if (candidate?.source === "round-end") {
      const entry = getRoundEndValidationEntry(candidate.playerId);
      if (entry?.word && Number(entry.round) === Number(candidate.round)) {
        candidate.word = entry.word;
      }
    }
  }
  document.querySelectorAll(".record-word-chip").forEach((btn) => {
    const key = btn.dataset.feature;
    btn.classList.toggle("active", !!recordWordFeatures[key]);
  });
  if (input) {
    input.value = candidate?.word || "";
    input.focus();
  }
  if (statusEl) {
    statusEl.textContent = "";
    statusEl.className = "match-validation-status record-word-validation-status";
  }
  if (candidate?.source === "round-end" && candidate?.playerId != null) {
    const entry = getRoundEndValidationEntry(candidate.playerId);
    if (entry) syncRecordWordStatusFromEntry(candidate.playerId, entry);
  }
  updateRecordWordSaveState();
  openModal("record-word", { closable: true });
}

function openRecordWordModalFromScoreboard(candidate, { pendingNext = null } = {}) {
  const input = document.getElementById("recordWordInput");
  const statusEl = document.getElementById("recordWordValidationStatus");
  recordWordModalState = candidate;
  recordWordPendingNext = pendingNext;
  recordWordModalStaging = true;
  recordWordStatusWord = "";
  recordWordStatusOk = null;
  recordWordFeatures = {
    sameColor: false,
    usedWildcard: false,
    doubleScore: false,
    plusPoints: false,
    minusPoints: false,
  };
  if (candidate?.matchId && candidate?.playerId != null && candidate?.round != null) {
    const existing = getScoreboardWordCandidate(
      candidate.matchId,
      candidate.playerId,
      candidate.round
    );
    if (existing?.features) {
      recordWordFeatures = { ...recordWordFeatures, ...existing.features };
    }
    if (existing?.word) {
      candidate.word = existing.word;
    }
  }
  document.querySelectorAll(".record-word-chip").forEach((btn) => {
    const key = btn.dataset.feature;
    btn.classList.toggle("active", !!recordWordFeatures[key]);
  });
  if (input) {
    input.value = candidate?.word || "";
    input.focus();
  }
  if (statusEl) {
    statusEl.textContent = "";
    statusEl.className = "match-validation-status record-word-validation-status";
  }
  if (candidate?.source === "round-end" && candidate?.playerId != null) {
    const entry = getRoundEndValidationEntry(candidate.playerId);
    if (entry) syncRecordWordStatusFromEntry(candidate.playerId, entry);
  }
  updateRecordWordSaveState();
  openModal("record-word", { closable: true });
}

function closeRecordWordModal({ continuePending = true } = {}) {
  closeModal("record-word", { reason: "action" });
  const pending = continuePending ? recordWordPendingNext : null;
  recordWordPendingNext = null;
  recordWordModalState = null;
  recordWordModalStaging = false;
  if (pending?.nextId) {
    openRoundEndKeypad(pending.nextId);
    return;
  }
  if (pending?.autoAdvance) {
    closeRoundEndKeypad({ autoAdvance: true });
  }
}

function handleRecordWordToggle(e) {
  const btn = e.currentTarget;
  const key = btn?.dataset?.feature;
  if (!key) return;
  recordWordFeatures[key] = !recordWordFeatures[key];
  btn.classList.toggle("active", recordWordFeatures[key]);
}

function handleRecordWordSkip() {
  if (recordWordModalState?.matchId) {
    if (recordWordModalStaging) {
      upsertScoreboardWordCandidate(recordWordModalState.matchId, {
        ...recordWordModalState,
        ignored: true,
      });
    } else {
      upsertWordCandidate(recordWordModalState.matchId, {
        ...recordWordModalState,
        ignored: true,
      });
    }
  }
  closeRecordWordModal({ continuePending: true });
}

function setRecordWordValidating(isValidating) {
  recordWordValidating = isValidating;
  const statusEl = document.getElementById("recordWordValidationStatus");
  if (statusEl) statusEl.classList.toggle("is-validating", isValidating);
  const spinner = document.getElementById("recordWordSpinner");
  if (spinner) spinner.classList.toggle("hidden", !isValidating);
}

async function handleRecordWordSave() {
  const input = document.getElementById("recordWordInput");
  const word = String(input?.value || "").trim();
  if (!recordWordModalState || !recordWordModalState.matchId) return;
  if (!word) {
    if (input) input.focus();
    return;
  }
  if (recordWordValidating) return;
  const st = matchController.getState();
  const requiresValidation =
    recordWordModalState?.source === "round-end" &&
    st?.matchId === recordWordModalState?.matchId &&
    st?.scoringEnabled &&
    st?.validateRecordWords !== false;
  if (requiresValidation) {
    const entry = getRoundEndValidationEntry(recordWordModalState?.playerId);
    const valid =
      !!entry?.ok &&
      Number(entry?.round) === Number(recordWordModalState?.round) &&
      entry.wordKey === _shell.normalizeValidationWord(word);
    if (!valid) {
      const statusEl = document.getElementById("recordWordValidationStatus");
      const saveBtn = document.getElementById("recordWordSaveBtn");
      setRecordWordValidating(true);
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.classList.add("disabled");
      }
      try {
        const rulesText = _shell.getValidationRules();
        const result = await matchController.validateWord(word, rulesText);
        const ok = !!result?.isValid;
        const base = ok ? t("matchValidateOk") : t("matchValidateFail");
        const reason = result?.reason ? ` ${result.reason}` : "";
        if (statusEl) {
          statusEl.textContent = `${base}${reason}`;
          statusEl.className = `match-validation-status record-word-validation-status ${ok ? "ok" : "fail"}`;
        }
        recordWordStatusWord = _shell.normalizeValidationWord(word);
        recordWordStatusOk = ok;
        _shell.playValidationResultSound(ok);
        if (!ok) {
          if (recordWordModalState?.playerId) {
            setRoundEndValidationEntry(recordWordModalState.playerId, {
              word,
              wordKey: _shell.normalizeValidationWord(word),
              ok: false,
              round: recordWordModalState.round,
              statusText: `${base}${reason}`,
              statusClass: "match-validation-status fail",
            });
          }
          updateRecordWordSaveState();
          if (input) input.focus();
          return;
        }
        if (recordWordModalState?.playerId) {
          setRoundEndValidationEntry(recordWordModalState.playerId, {
            word,
            wordKey: _shell.normalizeValidationWord(word),
            ok: true,
            round: recordWordModalState.round,
            statusText: `${base}${reason}`,
            statusClass: "match-validation-status ok",
          });
        }
      } catch (e) {
        logger.error("Record word validation failed", e);
        if (statusEl) {
          statusEl.textContent = t("matchValidateError");
          statusEl.className = "match-validation-status record-word-validation-status fail";
        }
        recordWordStatusWord = _shell.normalizeValidationWord(word);
        recordWordStatusOk = false;
        _shell.playValidationResultSound(false);
        if (recordWordModalState?.playerId) {
          setRoundEndValidationEntry(recordWordModalState.playerId, {
            word,
            wordKey: _shell.normalizeValidationWord(word),
            ok: false,
            round: recordWordModalState.round,
            statusText: t("matchValidateError"),
            statusClass: "match-validation-status fail",
          });
        }
        if (input) input.focus();
        return;
      } finally {
        setRecordWordValidating(false);
        updateRecordWordSaveState();
      }
    }
  }
  if (recordWordModalStaging) {
    upsertScoreboardWordCandidate(recordWordModalState.matchId, {
      ...recordWordModalState,
      word,
      features: { ...recordWordFeatures },
      ignored: false,
    });
  } else {
    upsertWordCandidate(recordWordModalState.matchId, {
      ...recordWordModalState,
      word,
      features: { ...recordWordFeatures },
      ignored: false,
    });
  }
  closeRecordWordModal({ continuePending: true });
}

function updateRecordWordSaveState() {
  const input = document.getElementById("recordWordInput");
  const saveBtn = document.getElementById("recordWordSaveBtn");
  const clearBtn = document.getElementById("recordWordClearBtn");
  const statusEl = document.getElementById("recordWordValidationStatus");
  if (!saveBtn) return;
  const rawWord = String(input?.value || "");
  const word = rawWord.trim();
  const wordKey = _shell.normalizeValidationWord(word);
  if (recordWordModalState?.source === "round-end" && recordWordModalState?.playerId) {
    if (!word) {
      clearRoundEndValidationEntry(recordWordModalState.playerId);
    } else {
      const entry = getRoundEndValidationEntry(recordWordModalState.playerId);
      const key = _shell.normalizeValidationWord(word);
      if (!entry || entry.wordKey !== key) {
        setRoundEndValidationEntry(recordWordModalState.playerId, {
          word,
          wordKey: key,
          ok: false,
          round: recordWordModalState.round,
          statusText: "",
          statusClass: "match-validation-status",
        });
      }
    }
    const sections = _shell.getValidationSections();
    const section = sections.get("round-keypad");
    if (section?.input) {
      section.input.value = word;
      _shell.updateValidationControls(section);
    }
    const entry = getRoundEndValidationEntry(recordWordModalState.playerId);
    if (section?.status) {
      if (entry?.ok && entry.wordKey === _shell.normalizeValidationWord(word)) {
        section.status.textContent = entry.statusText || "";
        section.status.className = entry.statusClass || "match-validation-status ok";
      } else {
        section.status.textContent = "";
        section.status.className = "match-validation-status";
      }
    }
    if (entry) syncRecordWordStatusFromEntry(recordWordModalState.playerId, entry);
  }
  const hasWord = word.length > 0;
  const st = matchController.getState();
  const requiresValidation =
    recordWordModalState?.source === "round-end" &&
    st?.matchId === recordWordModalState?.matchId &&
    st?.scoringEnabled &&
    st?.validateRecordWords !== false;
  const hasFailedValidation =
    requiresValidation &&
    recordWordStatusWord &&
    recordWordStatusWord === wordKey &&
    recordWordStatusOk === false;
  saveBtn.disabled = !hasWord || recordWordValidating || hasFailedValidation;
  saveBtn.classList.toggle("disabled", !hasWord || recordWordValidating || hasFailedValidation);
  if (clearBtn) clearBtn.classList.toggle("hidden", !hasWord);
  if (statusEl && recordWordStatusWord && wordKey !== recordWordStatusWord) {
    statusEl.textContent = "";
    statusEl.className = "match-validation-status record-word-validation-status";
    recordWordStatusWord = "";
    recordWordStatusOk = null;
  }
}

// ─── Share canvas ─────────────────────────────────────────────────────────────

async function buildScoreboardShareCanvas(matchState) {
  if (document?.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {}
  }
  let { canvas, ctx } = _shell.createShareCanvas(SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

  const cardX = SHARE_CARD_MARGIN;
  const cardY = SHARE_CARD_MARGIN;
  const cardW = SHARE_CARD_WIDTH - SHARE_CARD_MARGIN * 2;
  let cardH = SHARE_CARD_HEIGHT - 160;

  const logo = await _shell.loadImageElement("assets/img/logo-letters.png");
  const headerIcon = await _shell.loadImageElement("assets/img/podium.svg");
  const logoWidth = 340;
  const ratio = logo?.height ? logo.width / logo.height : 1;
  const logoHeight = logoWidth / ratio;
  const logoX = cardX + (cardW - logoWidth) / 2;
  const logoY = cardY + 18;
  let logoBottom = cardY + 20;
  if (logo) {
    ctx.drawImage(logo, logoX, logoY, logoWidth, logoHeight);
    logoBottom = logoY + logoHeight;
  }

  const headerTop = logoBottom + 36;
  const headerLabel = t("scoreboardShareTitle");
  const headerBottom = _shell.drawShareCardTitle(
    ctx,
    cardX,
    cardW,
    headerTop,
    headerIcon,
    headerLabel
  );
  let cursorY = headerBottom + 22;

  const rounds = scoreboardRounds || [];
  const players = scoreboardPlayers || [];
  const values = scoreboardDraft || scoreboardBase || {};
  const totals = getScoreboardTotals(players, rounds, values);
  const rows = players
    .map((player) => ({
      name: player.name || t("playerLabel"),
      total: totals.get(String(player.id)) ?? 0,
      color: player.color || "#d9c79f",
    }))
    .sort((a, b) => Number(b.total) - Number(a.total));

  const rowHeight = 92;
  const rowGap = 14;
  const listX = cardX + 50;
  const listW = cardW - 100;
  const cellW = Math.round(listW * 0.75);
  const cellX = listX + (listW - cellW) / 2;
  ctx.textBaseline = "middle";
  const maxRows = Math.floor((cardY + cardH - cursorY - 20) / (rowHeight + rowGap));
  const maxItems = Math.max(1, maxRows);

  const visibleCount = Math.min(rows.length, maxItems);
  const listH = visibleCount * rowHeight + Math.max(0, visibleCount - 1) * rowGap + 24;

  const dateLabel = _shell.formatRecordDate(Date.now());
  const roundsCount = Array.isArray(scoreboardRounds) ? scoreboardRounds.length : 0;
  const roundsLabel =
    t("matchModeRounds") || t("recordsRoundsHeader") || "Bazas";
  const dateLine = dateLabel
    ? roundsCount
      ? `${dateLabel} · ${roundsCount} ${roundsLabel}`
      : dateLabel
    : "";
  const dateBlockH = dateLine ? 48 : 0;

  cardH = (cursorY - cardY) + listH + (dateBlockH ? dateBlockH + 18 : 0) + 24;
  const desiredHeight = cardY + cardH + SHARE_CARD_MARGIN;
  const finalHeight = Math.min(SHARE_CARD_HEIGHT, desiredHeight);
  if (finalHeight !== SHARE_CARD_HEIGHT) {
    ({ canvas, ctx } = _shell.createShareCanvas(SHARE_CARD_WIDTH, finalHeight));
  }
  ctx.fillStyle = "#f7ead1";
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, finalHeight);
  _shell.drawShareCardFrame(ctx, cardX, cardY, cardW, cardH);
  if (logo) {
    ctx.drawImage(logo, logoX, logoY, logoWidth, logoHeight);
  }
  _shell.drawShareCardTitle(ctx, cardX, cardW, headerTop, headerIcon, headerLabel);

  _shell.drawRoundedRect(ctx, listX - 12, cursorY - 8, listW + 24, listH, 18);
  ctx.fillStyle = "rgba(255, 248, 233, 0.55)";
  ctx.fill();

  const winnerIcon = await _shell.loadImageElement("assets/img/leader.svg");
  const maxTotal = rows.length ? rows[0].total : null;
  const visibleRows = rows.slice(0, maxItems);
  const pointsPadX = 16;
  const pointsPillH = 52;
  ctx.font = `900 52px "Fredoka", "Montserrat", sans-serif`;
  const maxPointsWidth = visibleRows.reduce((acc, row) => {
    const w = ctx.measureText(String(row.total)).width;
    return Math.max(acc, w);
  }, 0);
  const pointsPillWFixed = Math.max(maxPointsWidth + pointsPadX * 2, 90);

  visibleRows.forEach((row, index) => {
    const x = cellX;
    const y = cursorY + index * (rowHeight + rowGap);
    const palette = getDealerPalette(row.color || "#d9c79f");
    _shell.drawRoundedRect(ctx, x, y + 3, cellW, rowHeight, 12);
    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.fill();

    _shell.drawRoundedRect(ctx, x, y, cellW, rowHeight, 12);
    ctx.fillStyle = row.color || "#d9c79f";
    ctx.fill();
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 3;
    ctx.stroke();

    const posText = `#${index + 1}`;
    ctx.textAlign = "left";
    ctx.font = `900 52px "Fredoka", "Montserrat", sans-serif`;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth = 3;
    ctx.textBaseline = "alphabetic";
    const posBaseline = _shell.getCenteredTextBaseline(ctx, y, rowHeight, posText);
    ctx.strokeText(posText, x + 12, posBaseline);
    ctx.fillStyle = "#ffe26f";
    ctx.fillText(posText, x + 12, posBaseline);

    ctx.textAlign = "center";
    ctx.font = `900 52px "Fredoka", "Montserrat", sans-serif`;
    const pointsText = String(row.total);
    const pointsPillW = pointsPillWFixed;
    const pointsPillX = x + cellW - 12 - pointsPillW;
    const pointsPillY = y + (rowHeight - pointsPillH) / 2;
    const isWinner = maxTotal != null && row.total === maxTotal;
    _shell.drawRoundedRect(ctx, pointsPillX, pointsPillY, pointsPillW, pointsPillH, 14);
    if (isWinner) {
      const pointsGradient = ctx.createLinearGradient(
        0,
        pointsPillY,
        0,
        pointsPillY + pointsPillH
      );
      pointsGradient.addColorStop(0, "#ffe26f");
      pointsGradient.addColorStop(1, "#ffc94f");
      ctx.fillStyle = pointsGradient;
      ctx.fill();
      ctx.strokeStyle = "rgba(107, 60, 29, 0.45)";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = "#6b3c1d";
    } else {
      const darker = darkenHexColor(row.color || "#d9c79f", 0.92);
      ctx.fillStyle = darker;
      ctx.fill();
      ctx.strokeStyle = darkenHexColor(row.color || "#d9c79f", 0.78);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
      ctx.lineWidth = 3;
    }
    ctx.textBaseline = "alphabetic";
    const pointsBaseline = _shell.getCenteredTextBaseline(ctx, pointsPillY, pointsPillH, pointsText);
    if (!isWinner) {
      ctx.strokeText(pointsText, pointsPillX + pointsPillW / 2, pointsBaseline);
    }
    ctx.fillText(pointsText, pointsPillX + pointsPillW / 2, pointsBaseline);

    const nameMaxW = Math.max(40, pointsPillX - (x + 90) - 16);
    ctx.textAlign = "left";
    ctx.font = `800 56px "Fredoka", "Montserrat", sans-serif`;
    const name = _shell.truncateText(ctx, _shell.formatShareName(row.name), nameMaxW);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth = 3;
    const nameBaseline = _shell.getCenteredTextBaseline(ctx, y, rowHeight, name);
    ctx.strokeText(name, x + 90, nameBaseline);
    ctx.fillStyle = palette.text;
    ctx.fillText(name, x + 90, nameBaseline);

    if (winnerIcon && maxTotal != null && row.total === maxTotal) {
      const iconSize = 80;
      const iconX = x + 90;
      const iconY = y - iconSize / 2;
      _shell.drawIconWithOutline(ctx, winnerIcon, iconX, iconY, iconSize, "#111111");
    }
  });

  if (dateLine) {
    ctx.font = `800 40px "Fredoka", "Montserrat", sans-serif`;
    ctx.fillStyle = "#c9a56c";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const dateY = cursorY + listH + 18 + 20;
    ctx.fillText(dateLine, cardX + cardW / 2, dateY);
  }

  return canvas;
}

async function handleScoreboardShare() {
  if (scoreboardShareBusy) return;
  const matchState = matchController.getState();
  if (!scoreboardRounds?.length || !scoreboardPlayers?.length) return;
  scoreboardShareBusy = true;
  try {
    const canvas = await buildScoreboardShareCanvas(matchState);
    if (!canvas) return;
    const dateLabel = _shell.formatRecordDate(Date.now());
    const filename = _shell.buildShareFileName("scoreboard", dateLabel, "match");
    const appName = t("appTitle") || "The Letter Loom";
    const shareMessage = _shell.formatShareMessage(t("scoreboardShareMessage"), {
      app: appName,
    }).trim();
    const parts = [shareMessage];
    if (dateLabel) parts.push(dateLabel);
    const rounds = scoreboardRounds || [];
    const players = scoreboardPlayers || [];
    const values = scoreboardDraft || scoreboardBase || {};
    const totals = getScoreboardTotals(players, rounds, values);
    const winner = players
      .map((player) => ({
        name: _shell.formatShareName(player.name || t("playerLabel") || ""),
        total: totals.get(String(player.id)) ?? 0,
      }))
      .sort((a, b) => Number(b.total) - Number(a.total))[0];
    if (winner?.name) {
      const winnerLabel = (t("scoreboardShareWinnerLabel") || "Ganador").toUpperCase();
      parts.push(`${winnerLabel} ${winner.name}`);
    }
    const text = parts.filter(Boolean).join(" · ");
    const blob = await _shell.canvasToBlob(canvas);
    await _shell.shareImageBlob(blob, { filename, title: shareMessage, text });
    capture('scoreboard_shared', { player_count: (scoreboardPlayers || []).length });
    flush();
  } catch (err) {
    logger.warn("Share scoreboard failed", err);
  } finally {
    scoreboardShareBusy = false;
  }
}

// ─── Records / archive ────────────────────────────────────────────────────────

function openRecordScoreboard(record, { highlightWord = false } = {}) {
  if (!record || !record.matchId) {
    logger.warn("openRecordScoreboard: missing record or matchId", record || null);
    return;
  }
  const archive = loadArchive();
  const entry = archive?.byId?.[String(record.matchId)];
  if (!entry) {
    logger.warn("openRecordScoreboard: archive entry missing", {
      matchId: record.matchId,
      archiveCount: Array.isArray(archive?.order) ? archive.order.length : 0,
    });
    return;
  }
  if (!entry.matchState) {
    logger.warn("openRecordScoreboard: matchState missing in archive entry", {
      matchId: record.matchId,
      savedAt: entry.savedAt || null,
      status: entry.status || null,
    });
    return;
  }
  let matchState = entry.matchState;
  const players = Array.isArray(matchState.players) ? matchState.players : [];
  const roundsTotal = players.reduce(
    (sum, player) => sum + (Array.isArray(player.rounds) ? player.rounds.length : 0),
    0
  );
  if (roundsTotal === 0) {
    const active = loadActiveMatch();
    if (
      active?.matchState?.matchId &&
      String(active.matchState.matchId) === String(record.matchId) &&
      _shell.matchHasAnyScores(active.matchState)
    ) {
      matchState = active.matchState;
    } else {
      logger.warn("openRecordScoreboard: matchState has no rounds", {
        matchId: record.matchId,
        players: players.length,
        round: matchState.round ?? null,
        phase: matchState.phase || null,
      });
    }
  }
  scoreboardRounds = [];
  scoreboardPlayers = [];
  scoreboardBase = null;
  scoreboardDraft = null;
  scoreboardDirty = false;
  scoreboardReadOnly = true;
  scoreboardInfoText = _shell.buildRecordDateMessage(
    record.when || entry.savedAt || entry.matchState?.updatedAt
  );
  scoreboardRecordHighlight =
    highlightWord && record.playerId != null && record.round != null
      ? {
          matchId: String(record.matchId),
          playerId: String(record.playerId),
          round: Number(record.round),
        }
      : null;
  scoreboardReturnScreen = "records";
  scoreboardReturnWinners = false;
  scoreboardKeypadOpen = false;
  scoreboardKeypadPlayerId = null;
  scoreboardKeypadRound = null;
  scoreboardKeypadOrder = [];
  scoreboardKeypadInitialValue = null;
  renderScoreboardScreen(matchState);
  _shell.showScreen("scoreboard");
  _shell.scaleGame();
}

function openRecords() {
  const records = loadRecords() || {};
  const hasWordRecords = Array.isArray(records.bestWord) && records.bestWord.length > 0;
  const hasMatchRecords = Array.isArray(records.bestMatch) && records.bestMatch.length > 0;
  if (!hasWordRecords && hasMatchRecords) {
    recordsTab = "matches";
  } else {
    recordsTab = "words";
  }
  _shell.showScreen("records");
  _shell.scaleGame();
}

function openRecordsFromWinners() {
  if (_shell.winnersModalOpen.value) {
    _shell.suppressWinnersPrompt.value = true;
    closeModal("match-winners", { reason: "records" });
  }
  openRecords();
}

// ─── Apply / reset scoreboard changes ────────────────────────────────────────

function applyScoreboardChanges() {
  const st = matchController.getState();
  if (!st || !scoreboardDraft) return;
  const odd = getScoreboardOddScore();
  if (odd) {
    updateScoreboardWarnings();
    return;
  }
  scoreboardRounds.forEach((round) => {
    const scores = {};
    scoreboardPlayers.forEach((player) => {
      const raw = scoreboardDraft[player.id]?.[round];
      const value = isScoreFilled(raw) ? _shell.clampRoundScore(raw) : 0;
      scores[player.id] = value;
    });
    matchController.updateRoundScores(round, scores);
  });
  persistScoreboardWordCandidatesDraft();
  const nextState = matchController.getState();
  const data = buildScoreboardData(nextState);
  scoreboardRounds = data.rounds;
  scoreboardPlayers = data.players;
  scoreboardBase = cloneScoreboardValues(data.values);
  scoreboardDraft = cloneScoreboardValues(data.values);
  scoreboardDirty = false;
  _shell.persistActiveMatchSnapshot(nextState);
  renderScoreboardScreen(nextState);
  updateScoreboardDirty();
}

function resetScoreboardDraft(matchState) {
  if (!scoreboardBase) return;
  scoreboardDraft = cloneScoreboardValues(scoreboardBase);
  scoreboardDirty = false;
  discardScoreboardWordCandidatesDraft(matchState || matchController.getState());
  renderScoreboardScreen(matchState || matchController.getState());
  updateScoreboardDirty();
  updateScoreboardIndicators();
  updateScoreboardWarnings();
}

function handleRoundEndContinue() {
  const st = matchController.getState();
  if (!st) return;
  if (st.scoringEnabled) {
    const activePlayers = _shell.getActivePlayers(st);
    const oddPlayer = getFirstOddRoundScore(st);
    const missing = activePlayers.some((player) =>
      isRoundScoreEmpty(roundEndScores[String(player.id)])
    );
    if (missing || oddPlayer) {
      updateRoundEndContinueState(st);
      return;
    }
    const scores = {};
    activePlayers.forEach((player) => {
      const raw = roundEndScores[String(player.id)];
      scores[player.id] = _shell.clampRoundScore(raw);
    });
    const roundNumber = st.round;
    matchController.addRoundScores(scores);
    const nextState = matchController.getState();
    _shell.persistActiveMatchSnapshot(nextState);
    if (nextState?.matchOver) {
      roundEndScores = {};
      roundEndUnlocked = new Set();
      roundEndSelectedWinners = new Set();
      _shell.clearMatchWordFor("match");
      _shell.stopClockLoop(false);
      _shell.showScreen("match");
      _shell.renderMatch();
      _shell.showMatchWinners(nextState.winnerIds || []);
      flush();
      return;
    }
    if (nextState?.tieBreakPending?.players?.length) {
      renderRoundEndScreen();
      return;
    }
  } else {
    const roundsMode = st.mode === MATCH_MODE_ROUNDS;
    const roundsTarget = st.roundsTarget ?? DEFAULT_ROUNDS_TARGET;
    const selected = [...roundEndSelectedWinners];

    if (!st.tieBreak && roundsMode && st.round < roundsTarget) {
      matchController.nextRound();
    } else if (!selected.length) {
      if (roundsMode) {
        updateRoundEndContinueState(st);
        return;
      }
      matchController.nextRound();
    } else if (selected.length === 1) {
      matchController.declareWinners(selected);
      const nextState = matchController.getState();
      if (nextState?.matchOver) {
        roundEndScores = {};
        roundEndUnlocked = new Set();
        roundEndSelectedWinners = new Set();
        _shell.clearMatchWordFor("match");
        _shell.stopClockLoop(false);
        _shell.showScreen("match");
        _shell.renderMatch();
        _shell.showMatchWinners(nextState.winnerIds || []);
        return;
      }
    } else {
      updateRoundEndContinueState(st);
      return;
    }
  }
  roundEndScores = {};
  roundEndUnlocked = new Set();
  roundEndSelectedWinners = new Set();
  _shell.clearMatchWordFor("match");
  _shell.stopClockLoop(false);
  _shell.showScreen("match");
  _shell.renderMatch();
}

// ─── Round-end screen render ──────────────────────────────────────────────────

function renderRoundEndScreen() {
  const matchState = matchController.getState();
  if (!matchState) return;

  const scoringSection = document.getElementById("roundEndScoringSection");
  const validationSection = document.getElementById("roundEndValidationMount")?.parentElement;
  const scoringList = document.getElementById("roundEndScoringList");
  const scoringEnabled = !!matchState.scoringEnabled;
  const tieBreakPending =
    Array.isArray(matchState?.tieBreakPending?.players) &&
    matchState.tieBreakPending.players.length > 0;

  if (validationSection) {
    validationSection.classList.toggle("hidden", scoringEnabled);
    if (scoringEnabled) {
      _shell.clearMatchWordFor("match", false);
      _shell.clearStatusValidationFor("match");
    }
  }

  if (!scoringEnabled || tieBreakPending) {
    roundEndKeypadOpen = false;
    roundEndKeypadPlayerId = null;
  }

  if (scoringSection) {
    scoringSection.classList.toggle("hidden", !scoringEnabled || tieBreakPending);
  }

  if (!scoringList) return;
  scoringList.innerHTML = "";
  if (!scoringEnabled || tieBreakPending) {
    renderRoundEndWinners(matchState);
    updateRoundEndContinueState(matchState);
    return;
  }

  roundEndOrder = buildRoundEndOrder(matchState);
  const activePlayers = _shell.getActivePlayers(matchState);
  const activeMap = new Map(activePlayers.map((player) => [String(player.id), player]));
  const displayOrder = (matchState.players || [])
    .map((player) => String(player.id))
    .filter((id) => activeMap.has(id));
  const dealerIndex = _shell.getDealerIndex(matchState);
  const dealerId = activePlayers[dealerIndex] ? String(activePlayers[dealerIndex].id) : null;
  const orderPrefix = t("matchRoundPlayerPrefix");
  const playerIndexMap = _shell.getPlayerIndexMap(matchState);
  displayOrder.forEach((playerId) => {
    const player = activeMap.get(String(playerId));
    if (!player) return;
    const id = String(player.id);
    const row = document.createElement("div");
    row.className = "round-end-score-row";
    row.dataset.playerId = id;
    if (id === dealerId) {
      row.classList.add("is-dealer");
    }
    const palette = getDealerPalette(player.color || "#d9c79f");
    row.style.setProperty("--player-color", player.color || "#d9c79f");
    row.style.setProperty("--player-border", palette.border);
    row.style.setProperty("--player-text", palette.text);
    row.style.setProperty("--points-pill-bg", darkenHexColor(player.color || "#d9c79f", 0.92));
    row.style.setProperty(
      "--points-pill-border",
      darkenHexColor(player.color || "#d9c79f", 0.8)
    );
    if (id === dealerId) {
      row.style.setProperty("--dealer-bg", palette.bg);
      row.style.setProperty("--dealer-border", palette.border);
      row.style.setProperty("--dealer-text", palette.text);
    }

    const header = document.createElement("div");
    header.className = "round-end-score-header";

    const orderBadge = document.createElement("span");
    orderBadge.className = "round-end-score-order";
    const orderIndex = playerIndexMap.get(id);
    orderBadge.textContent = `${orderPrefix}${(orderIndex ?? 0) + 1}`;

    const nameEl = document.createElement("div");
    nameEl.className = "round-end-score-name";
    nameEl.textContent = player.name || "";

    header.append(orderBadge, nameEl);

    const dealerBadge = document.createElement("span");
    dealerBadge.className = "round-end-score-dealer";
    dealerBadge.textContent = t("matchDealerLabel");
    if (id === dealerId) {
      header.appendChild(dealerBadge);
    }

    const scoreBtn = document.createElement("button");
    scoreBtn.type = "button";
    scoreBtn.className = "round-end-score-pill";
    scoreBtn.textContent = _shell.formatRoundEndScoreDisplay(roundEndScores[id]);
    scoreBtn.setAttribute("aria-label", player.name || "");

    row.append(header, scoreBtn);
    scoringList.appendChild(row);
  });
  updateRoundEndLockState(matchState);
  renderRoundEndWinners(matchState);
  updateRoundEndContinueState(matchState);
  updateRoundEndKeypad(matchState);
  _shell.updateActionOverlayStates();
}

// ─── Named exports ────────────────────────────────────────────────────────────

export function getRoundEndScore(id) { return roundEndScores[String(id)]; }
export function getRoundEndKeypadPlayerId() { return roundEndKeypadPlayerId; }
export function getRoundEndOrder() { return [...roundEndOrder]; }
export function getRoundEndSelectedIds(matchState) {
  if (matchState?.tieBreakPending?.players?.length) {
    return matchState.tieBreakPending.players.map((id) => String(id));
  }
  return [...roundEndSelectedWinners];
}

export {
  validateScores,
  isRoundScoreEmpty,
  renderRoundEndScreen,
  updateRoundEndKeypad,
  openRoundEndKeypad,
  closeRoundEndKeypad,
  handleRoundEndKeypadKey,
  handleRoundEndKeypadNavigate,
  renderRoundEndWinners,
  updateRoundEndContinueState,
  updateRoundEndLockState,
  openRoundEndScreen,
  openScoreboard,
  closeScoreboard,
  renderMatch,
  renderMatchFromState,
  applyScoreboardChanges,
  resetScoreboardDraft,
  handleRoundEndContinue,
  openRecords,
  openRecordsFromWinners,
  openRecordScoreboard,
  openRecordWordModal,
  openRecordWordModalFromScoreboard,
  buildScoreboardShareCanvas,
  handleScoreboardShare,
  updateScoreboardWarnings,
  updateScoreboardKeypad,
  openScoreboardKeypad,
  closeScoreboardKeypad,
  handleScoreboardKeypadKey,
  handleScoreboardKeypadNavigate,
  handleScoreboardRecordCandidateUpdate,
  handleRecordWordSkip,
  handleRecordWordSave,
  handleRecordWordToggle,
  getNextRoundEndId,
  getRoundEndValidationEntry,
  setRoundEndValidationEntry,
  clearRoundEndValidationEntry,
  restoreRoundEndValidation,
  closeRecordWordModal,
  updateRecordWordSaveState,
};

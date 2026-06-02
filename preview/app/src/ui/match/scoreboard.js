import { matchController, validateWordRemote } from "../../core/matchController.js";
import { validateWordDebug, LAYER_PRESETS } from "../../core/wordValidator.js";
import {
  loadActiveMatch,
  saveActiveMatch,
  upsertArchiveMatch,
  loadArchive,
  saveArchive,
  matchHasRecord,
  loadRecords,
  clearActiveMatch,
  normalizeMatchForResume,
  isResumeEligible,
} from "../../core/matchStorage.js";
import {
  MATCH_MODE_ROUNDS,
  MATCH_MODE_POINTS,
  MIN_ROUND_SCORE,
  MAX_ROUND_SCORE,
  MIN_PHASE_SECONDS,
  MAX_PHASE_SECONDS,
  MIN_PLAYERS,
  MAX_PLAYERS,
  DEFAULT_PLAYER_COUNT,
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
  PLAYER_NAME_MAX,
} from "../../core/constants.js";
import { updateState, loadState } from "../../core/stateStore.js";
import { logger } from "../../core/logger.js";
import { TEXTS, getShellLanguage, getAvailableLanguages, BULLET_CHAR } from "../../i18n/texts.js";
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
  triggerHapticFeedback: () => {},
  openSettingsModal: () => {},
  openQuickGuide: () => {},
  openManual: () => {},
  getQuickGuideSectionForPhase: () => "",
  stopClockLoop: () => {},
  playClockLoop: () => {},
  clockLowTimeMode: { value: false },
  playValidationResultSound: () => {},
  renderMatch: () => {},
  currentScreen: () => "",
  pausedBeforeScoreboard: { value: null },
  winnersModalOpen: { value: false },
  suppressWinnersPrompt: { value: false },
  lastWinnersIds: { value: [] },
  scheduleCreationTimeupAutoAdvance: () => {},
  clearCreationTimeupAutoAdvance: () => {},
  tempMatchPlayers: { value: [] },
  cachedNickname: { value: null },
  playModalOpenSound: () => {},
  openRecordWordModal: null,
  matchConfigCustomizeOpen: { value: false },
  tempMatchPrefs: { value: {} },
  validationRules: { value: null },
  tempValidationRules: { value: null },
  rulesEditContext: { value: "live" },
  triggerTimeUpEffects: () => {},
  playLowTimeTick: () => {},
  stopIntroAudio: () => {},
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

function normalizeLanguage(value) {
  const lang = String(value || "").trim().toLowerCase().slice(0, 2);
  return lang === "en" ? "en" : "es";
}

function textForLanguage(lang, key) {
  const texts = TEXTS[normalizeLanguage(lang)] || TEXTS.es;
  return texts[key] ?? t(key);
}

function getMatchLanguage(matchState = matchController.getState()) {
  return normalizeLanguage(matchState?.language ?? matchState?.preferencesRef?.language ?? "es");
}

function getRulesLanguage() {
  const state = matchController.getState();
  if (state && state.phase !== "config") return getMatchLanguage(state);
  return normalizeLanguage(getShellLanguage());
}

function getValidationBaseLanguage(key = "match") {
  return key === "help" ? normalizeLanguage(getShellLanguage()) : getRulesLanguage();
}

function getValidationSelectedLanguage(section, key = "match") {
  return normalizeLanguage(section?.langOverride || getValidationBaseLanguage(key));
}

function renderLanguageBadge(titleEl, gameLanguage) {
  if (!titleEl) return;
  const layer = titleEl.closest(".screen-topbar") || titleEl.parentElement || titleEl;
  layer.querySelectorAll(".match-language-badge").forEach((el) => el.remove());
  const lang = normalizeLanguage(gameLanguage);
  if (lang === normalizeLanguage(getShellLanguage())) return;
  const badge = document.createElement("span");
  badge.className = "match-language-badge";
  badge.textContent = lang.toUpperCase();
  layer.appendChild(badge);
}

// Module state — event setup
let delegatedControlsBound = false;

// Module state — player management
let openPlayerColorIndex = null;
let openPlayerNameIndex = null;
let lastPlayerSwap = null;
let playerDragState = null;
let playerDragGhost = null;
let playerDragOffset = null;

// Module state — analytics
let _analyticsMatchStartTime = null;
let _analyticsRoundStartTime = null;
let _analyticsStrategyStartTime = null;
let _analyticsCreationStartTime = null;
let _analyticsStrategyDuration = null;
let _analyticsCreationDuration = null;
let _analyticsValidationCount = 0;
let _analyticsIsRematch = false;

// Module state — match persistence
let activeMatchSaveTimer = null;
let restoredMatchActive = false;
let skipNextActiveMatchSave = false;

// Module state — match render
let lastMatchPhase = "";
let roundIntroActive = false;
let roundIntroTimer = null;
let lastRoundIntroKey = "";
let pendingDealerFocusState = null;
let dealerFocusTimer = null;

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
let recordsReturnScreen = "splash";
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
let lastMatchWordFeatures = {
  sameColor: false,
  usedWildcard: false,
  doubleScore: false,
  plusPoints: false,
  minusPoints: false,
};
const validationSections = new Map();
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
let recordWordStatusLang = null;
let recordWordLangOverride = null;
// Word candidate draft
let scoreboardWordCandidatesDraft = null;
let scoreboardWordCandidatesDirty = false;
let scoreboardWordCandidatesMatchId = null;

const WORD_CANDIDATES_KEY = "letterloom_word_candidates";
const AUTO_CONTINUE_ROUND_END = true;
const SHARE_CARD_WIDTH = 1080;
const SHARE_CARD_HEIGHT = 1350;
const SHARE_CARD_MARGIN = 60;

// ─── Pure data utilities ─────────────────────────────────────────────────────

function getActivePlayers(matchState) {
  const players = Array.isArray(matchState?.players) ? matchState.players : [];
  const tieBreakIds = matchState?.tieBreak?.players;
  if (!Array.isArray(tieBreakIds) || !tieBreakIds.length) {
    return players;
  }
  const map = new Map(players.map((p) => [String(p.id), p]));
  return tieBreakIds.map((id) => map.get(String(id))).filter(Boolean);
}

function getPlayersByIds(matchState, ids = []) {
  const players = Array.isArray(matchState?.players) ? matchState.players : [];
  const map = new Map(players.map((p) => [String(p.id), p]));
  return ids.map((id) => map.get(String(id))).filter(Boolean);
}

function getPlayerIndexMap(matchState) {
  const map = new Map();
  const players = Array.isArray(matchState?.players) ? matchState.players : [];
  players.forEach((player, idx) => {
    map.set(String(player.id), idx);
  });
  return map;
}

function getDealerIndex(matchState) {
  const allPlayers = Array.isArray(matchState?.players) ? matchState.players : [];
  const activePlayers = getActivePlayers(matchState);
  if (!activePlayers.length) return 0;
  const isTieBreak = allPlayers.length && activePlayers.length !== allPlayers.length;
  if (!isTieBreak) {
    return ((matchState.round ?? 1) - 1) % activePlayers.length;
  }
  const round = matchState.round ?? 1;
  const lastDealerIndex = round > 1 ? (round - 2) % allPlayers.length : 0;
  const activeIds = new Set(activePlayers.map((p) => String(p.id)));
  for (let i = 1; i <= allPlayers.length; i += 1) {
    const idx = (lastDealerIndex + i) % allPlayers.length;
    const id = String(allPlayers[idx]?.id ?? "");
    if (activeIds.has(id)) {
      const activeIndex = activePlayers.findIndex((p) => String(p.id) === id);
      return activeIndex >= 0 ? activeIndex : 0;
    }
  }
  return 0;
}

function getDealerInfo(matchState) {
  const players = getActivePlayers(matchState);
  if (!players.length) return { name: "", color: null };
  const index = getDealerIndex(matchState);
  const player = players[index] || {};
  const name = player.name?.trim() || `${t("playerLabel")} ${index + 1}`;
  return { name, color: player.color || null };
}

function matchHasAnyScores(matchState) {
  const players = matchState?.players || [];
  return players.some((player) => Array.isArray(player.rounds) && player.rounds.length > 0);
}

function formatSeconds(val) {
  const v = Math.max(0, Math.round(val));
  const m = Math.floor(v / 60).toString().padStart(2, "0");
  const s = (v % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function normalizeValidationWord(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePlayerName(value) {
  return String(value || "").trim().toLowerCase();
}

function clampRoundScore(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(MAX_ROUND_SCORE, Math.max(MIN_ROUND_SCORE, Math.round(n))) : 0;
}

function isOddScore(v) {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n % 2) === 1;
}

function getRoundEndPlayerLabel(matchState, playerId) {
  const players = Array.isArray(matchState?.players) ? matchState.players : [];
  const player = players.find((p) => String(p.id) === String(playerId));
  if (!player) return "";
  const index = getPlayerIndexMap(matchState).get(String(playerId)) ?? 0;
  const prefix = t("matchRoundPlayerPrefix");
  const orderLabel = `${prefix}${index + 1}`;
  return player.name ? `${orderLabel} ${player.name}`.trim() : orderLabel;
}

function formatRoundEndScoreDisplay(value) {
  if (isRoundScoreEmpty(value)) return t("matchRoundScorePlaceholder");
  return String(value);
}

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
  if (requireEven && isOddScore(value)) return false;
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
  const players = getActivePlayers(matchState);
  if (!players.length) return [];
  const dealerIndex = getDealerIndex(matchState);
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
  const players = getActivePlayers(matchState);
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

function setValidationSectionLanguage(section, lang) {
  if (!section) return;
  const nextLang = normalizeLanguage(lang);
  section.langOverride = nextLang;
  section.langBtns?.forEach((b) =>
    b.classList.toggle("is-active", b.dataset.lang === nextLang)
  );
  if (section.input) {
    section.input.placeholder = textForLanguage(nextLang, "matchValidatePlaceholder") || "";
  }
}

function setRecordWordLanguage(lang, { syncRoundKeypad = true } = {}) {
  const nextLang = normalizeLanguage(lang);
  const previousLang = recordWordLangOverride;
  recordWordLangOverride = nextLang;
  const toggle = document.getElementById("recordWordLangToggle");
  if (toggle) {
    toggle.querySelectorAll(".validation-lang-btn").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.lang === nextLang)
    );
  }
  const input = document.getElementById("recordWordInput");
  if (input) {
    input.placeholder = textForLanguage(nextLang, "recordWordPlaceholder")
      || textForLanguage(nextLang, "matchValidatePlaceholder")
      || "";
  }
  if (syncRoundKeypad && recordWordModalState?.source === "round-end") {
    const section = getValidationSections().get("round-keypad");
    setValidationSectionLanguage(section, nextLang);
  }
  if (previousLang && previousLang !== nextLang) {
    updateRecordWordSaveState();
  }
}

function getRoundKeypadValidationLanguage() {
  const section = getValidationSections().get("round-keypad");
  return normalizeLanguage(section?.langOverride || getRulesLanguage());
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
  const wordKey = normalizeValidationWord(input.value || "");
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
    recordWordStatusLang = normalizeLanguage(entry.language || recordWordLangOverride || getRulesLanguage());
    return;
  }
  statusEl.textContent = "";
  statusEl.className = "match-validation-status record-word-validation-status";
  recordWordStatusWord = "";
  recordWordStatusOk = null;
  recordWordStatusLang = null;
}

function restoreRoundEndValidation(playerId) {
  const sections = getValidationSections();
  const section = sections.get("round-keypad");
  if (!section) return;
  const entry = getRoundEndValidationEntry(playerId);
  setValidationSectionLanguage(section, entry?.language || getRulesLanguage());
  if (!entry) {
    clearMatchWordFor("round-keypad", false);
    clearStatusValidationFor("round-keypad");
    return;
  }
  if (section.input) {
    section.input.value = entry.word || "";
    updateValidationControls(section);
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
  const playerLabel = getRoundEndPlayerLabel(matchState, id);
  const missing = isRoundScoreEmpty(raw);
  const odd = !missing && isOddScore(raw);
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
    if (!invalid && canEnterWordRecords(points, records)) {
      const candidate = getWordCandidate(st.matchId, currentId, roundNumber);
      const shouldPrompt =
        !candidate ||
        (!candidate.ignored && (!candidate.word || Number(candidate.points) !== points));
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
  const players = getActivePlayers(matchState);
  for (const player of players) {
    const value = roundEndScores[String(player.id)];
    if (isRoundScoreEmpty(value)) continue;
    if (isOddScore(value)) return player;
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

  const orderIndex = getPlayerIndexMap(matchState).get(String(playerId)) ?? 0;
  const orderPrefix = t("matchRoundPlayerPrefix");
  const orderEl = document.getElementById("roundEndKeypadOrder");
  const nameEl = document.getElementById("roundEndKeypadName");
  if (orderEl) orderEl.textContent = `${orderPrefix}${orderIndex + 1}`;
  if (nameEl) nameEl.textContent = player.name || "";

  const valueEl = document.getElementById("roundEndKeypadValue");
  if (valueEl) {
    const value = roundEndScores[String(playerId)];
    const textValue = isRoundScoreEmpty(value) ? "" : formatRoundEndScoreDisplay(value);
    const points = getScoreNumber(value);
    const invalid = !isScoreValidForRecord(value, { requireEven: true });
    const records = loadRecords() || {};
    const showRecord = !invalid && canEnterWordRecords(points, records);
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

  const players = getActivePlayers(matchState);
  const { missing, oddPlayer, outOfRangePlayer } = validateScores(players, roundEndScores);
  if (continueBtn) continueBtn.disabled = missing || !!oddPlayer || !!outOfRangePlayer;
  if (warning) {
    if (oddPlayer) {
      _shell.setI18n(warning, "matchRoundScoresOdd", {
        vars: { player: getRoundEndPlayerLabel(matchState, oddPlayer.id) },
      });
      warning.classList.toggle("hidden", false);
    } else if (outOfRangePlayer) {
      _shell.setI18n(warning, "matchRoundScoresOutOfRange", {
        vars: { player: getRoundEndPlayerLabel(matchState, outOfRangePlayer.id), min: MIN_ROUND_SCORE, max: MAX_ROUND_SCORE },
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
    row.classList.toggle("is-odd", isOddScore(roundEndScores[id]));
    const pill = row.querySelector(".round-end-score-pill");
    if (pill) {
      pill.textContent = formatRoundEndScoreDisplay(roundEndScores[id]);
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
  return getActivePlayers(matchState);
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
  const playerIndexMap = getPlayerIndexMap(matchState);

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
      if (isOddScore(value)) {
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
    const showRecord = !invalid && canEnterWordRecords(points, records);
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
  if (invalid || !canEnterWordRecords(points, records)) {
    removeScoreboardWordCandidate(matchId, id, rnd);
    return;
  }
  const existing = getScoreboardWordCandidate(matchId, id, rnd);
  if (existing?.ignored) return;
  if (!existing || !existing.word) {
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
      pill.classList.toggle("is-odd", isOddScore(value));
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
  renderLanguageBadge(document.getElementById("scoreboardTitle"), getMatchLanguage(matchState));
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
      ? buildRecordDateMessage(matchState.updatedAt || matchState.lastSavedAt || Date.now())
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
    applyShareIcon(shareBtn, t("scoreboardShare") || "Compartir");
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
      pill.classList.toggle("is-odd", isOddScore(value));
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
      updateHorizontalScrollHintState(tableWrap, hintOverlay || tableShell);
      updateScrollHintState(tableWrap, null, null, hintOverlay || tableShell);
      const config = tableWrap.closest(".scoreboard-config");
      if (config) updateScrollHintState(tableWrap, null, null, config);
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
  const activePlayers = getActivePlayers(matchState);
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
  const dealerIndex = getDealerIndex(matchState);
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
  renderMatchFromStateInner(matchState);
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
  const activePlayers = getActivePlayers(st);
  activePlayers.forEach((player) => {
    roundEndScores[String(player.id)] = "";
  });
  stopMatchTimer();
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
    showMatchWinners(_shell.lastWinnersIds.value);
  } else {
    scoreboardReturnWinners = false;
  }
  if (resumePhase) {
    const st = matchController.getState();
    if (resumePhase === "strategy" && st?.phase === "strategy-paused") {
      startMatchPhase("strategy");
    } else if (resumePhase === "creation" && st?.phase === "creation-paused") {
      startMatchPhase("creation");
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

function removeWordCandidatesForMatch(matchId) {
  const map = loadWordCandidatesMap();
  if (map[matchId]) {
    delete map[matchId];
    saveWordCandidatesMap(map);
  }
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
  recordWordStatusLang = null;
  setRecordWordLanguage(
    candidate?.source === "round-end" ? getRoundKeypadValidationLanguage() : getRulesLanguage()
  );
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
  recordWordStatusLang = null;
  setRecordWordLanguage(
    candidate?.source === "round-end" ? getRoundKeypadValidationLanguage() : getRulesLanguage()
  );
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
  recordWordStatusLang = null;
  recordWordLangOverride = null;
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
      entry.wordKey === normalizeValidationWord(word);
    if (!valid) {
      const statusEl = document.getElementById("recordWordValidationStatus");
      const saveBtn = document.getElementById("recordWordSaveBtn");
      setRecordWordValidating(true);
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.classList.add("disabled");
      }
      try {
        const validationLang = normalizeLanguage(recordWordLangOverride || getRulesLanguage());
        const rulesText = getValidationRulesForLang(validationLang);
        const result = await matchController.validateWord(word, rulesText, { language: validationLang });
        const ok = !!result?.isValid;
        const base = ok ? t("matchValidateOk") : t("matchValidateFail");
        const reason = result?.reason ? ` ${result.reason}` : "";
        if (statusEl) {
          statusEl.textContent = `${base}${reason}`;
          statusEl.className = `match-validation-status record-word-validation-status ${ok ? "ok" : "fail"}`;
        }
        recordWordStatusWord = normalizeValidationWord(word);
        recordWordStatusOk = ok;
        recordWordStatusLang = validationLang;
        _shell.playValidationResultSound(ok);
        if (!ok) {
          if (recordWordModalState?.playerId) {
            setRoundEndValidationEntry(recordWordModalState.playerId, {
              word,
              wordKey: normalizeValidationWord(word),
              ok: false,
              round: recordWordModalState.round,
              statusText: `${base}${reason}`,
              statusClass: "match-validation-status fail",
              language: validationLang,
            });
          }
          updateRecordWordSaveState();
          if (input) input.focus();
          return;
        }
        if (recordWordModalState?.playerId) {
          setRoundEndValidationEntry(recordWordModalState.playerId, {
            word,
            wordKey: normalizeValidationWord(word),
            ok: true,
            round: recordWordModalState.round,
            statusText: `${base}${reason}`,
            statusClass: "match-validation-status ok",
            language: validationLang,
          });
        }
      } catch (e) {
        logger.error("Record word validation failed", e);
        if (statusEl) {
          statusEl.textContent = t("matchValidateError");
          statusEl.className = "match-validation-status record-word-validation-status fail";
        }
        recordWordStatusWord = normalizeValidationWord(word);
        recordWordStatusOk = false;
        recordWordStatusLang = validationLang;
        _shell.playValidationResultSound(false);
        if (recordWordModalState?.playerId) {
          setRoundEndValidationEntry(recordWordModalState.playerId, {
            word,
            wordKey: normalizeValidationWord(word),
            ok: false,
            round: recordWordModalState.round,
            statusText: t("matchValidateError"),
            statusClass: "match-validation-status fail",
            language: validationLang,
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
  const wordKey = normalizeValidationWord(word);
  if (recordWordModalState?.source === "round-end" && recordWordModalState?.playerId) {
    if (!word) {
      clearRoundEndValidationEntry(recordWordModalState.playerId);
    } else {
      const entry = getRoundEndValidationEntry(recordWordModalState.playerId);
      const key = normalizeValidationWord(word);
      if (!entry || entry.wordKey !== key) {
        setRoundEndValidationEntry(recordWordModalState.playerId, {
          word,
          wordKey: key,
          ok: false,
          round: recordWordModalState.round,
          statusText: "",
          statusClass: "match-validation-status",
          language: normalizeLanguage(recordWordLangOverride || getRulesLanguage()),
        });
      }
    }
    const sections = getValidationSections();
    const section = sections.get("round-keypad");
    if (section?.input) {
      section.input.value = word;
      updateValidationControls(section);
    }
    const entry = getRoundEndValidationEntry(recordWordModalState.playerId);
    if (section?.status) {
      if (entry?.ok && entry.wordKey === normalizeValidationWord(word)) {
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
    normalizeLanguage(recordWordStatusLang || getRulesLanguage()) === normalizeLanguage(recordWordLangOverride || getRulesLanguage()) &&
    recordWordStatusOk === false;
  saveBtn.disabled = !hasWord || recordWordValidating || hasFailedValidation;
  saveBtn.classList.toggle("disabled", !hasWord || recordWordValidating || hasFailedValidation);
  if (clearBtn) clearBtn.classList.toggle("hidden", !hasWord);
  if (statusEl && recordWordStatusWord && wordKey !== recordWordStatusWord) {
    statusEl.textContent = "";
    statusEl.className = "match-validation-status record-word-validation-status";
    recordWordStatusWord = "";
    recordWordStatusOk = null;
    recordWordStatusLang = null;
  }
}

// ─── Share canvas ─────────────────────────────────────────────────────────────

async function buildScoreboardShareCanvas(matchState) {
  if (document?.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {}
  }
  let { canvas, ctx } = createShareCanvas(SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

  const cardX = SHARE_CARD_MARGIN;
  const cardY = SHARE_CARD_MARGIN;
  const cardW = SHARE_CARD_WIDTH - SHARE_CARD_MARGIN * 2;
  let cardH = SHARE_CARD_HEIGHT - 160;

  const logo = await loadImageElement("assets/img/logo-letters.png");
  const headerIcon = await loadImageElement("assets/img/podium.svg");
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
  const headerBottom = drawShareCardTitle(
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

  const dateLabel = formatRecordDate(Date.now());
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
    ({ canvas, ctx } = createShareCanvas(SHARE_CARD_WIDTH, finalHeight));
  }
  ctx.fillStyle = "#f7ead1";
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, finalHeight);
  drawShareCardFrame(ctx, cardX, cardY, cardW, cardH);
  if (logo) {
    ctx.drawImage(logo, logoX, logoY, logoWidth, logoHeight);
  }
  drawShareCardTitle(ctx, cardX, cardW, headerTop, headerIcon, headerLabel);

  drawRoundedRect(ctx, listX - 12, cursorY - 8, listW + 24, listH, 18);
  ctx.fillStyle = "rgba(255, 248, 233, 0.55)";
  ctx.fill();

  const winnerIcon = await loadImageElement("assets/img/leader.svg");
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
    drawRoundedRect(ctx, x, y + 3, cellW, rowHeight, 12);
    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.fill();

    drawRoundedRect(ctx, x, y, cellW, rowHeight, 12);
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
    const posBaseline = getCenteredTextBaseline(ctx, y, rowHeight, posText);
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
    drawRoundedRect(ctx, pointsPillX, pointsPillY, pointsPillW, pointsPillH, 14);
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
    const pointsBaseline = getCenteredTextBaseline(ctx, pointsPillY, pointsPillH, pointsText);
    if (!isWinner) {
      ctx.strokeText(pointsText, pointsPillX + pointsPillW / 2, pointsBaseline);
    }
    ctx.fillText(pointsText, pointsPillX + pointsPillW / 2, pointsBaseline);

    const nameMaxW = Math.max(40, pointsPillX - (x + 90) - 16);
    ctx.textAlign = "left";
    ctx.font = `800 56px "Fredoka", "Montserrat", sans-serif`;
    const name = truncateText(ctx, formatShareName(row.name), nameMaxW);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth = 3;
    const nameBaseline = getCenteredTextBaseline(ctx, y, rowHeight, name);
    ctx.strokeText(name, x + 90, nameBaseline);
    ctx.fillStyle = palette.text;
    ctx.fillText(name, x + 90, nameBaseline);

    if (winnerIcon && maxTotal != null && row.total === maxTotal) {
      const iconSize = 80;
      const iconX = x + 90;
      const iconY = y - iconSize / 2;
      drawIconWithOutline(ctx, winnerIcon, iconX, iconY, iconSize, "#111111");
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
    const dateLabel = formatRecordDate(Date.now());
    const filename = buildShareFileName("scoreboard", dateLabel, "match");
    const appName = t("appTitle") || "The Letter Loom";
    const shareMessage = formatShareMessage(t("scoreboardShareMessage"), {
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
        name: formatShareName(player.name || t("playerLabel") || ""),
        total: totals.get(String(player.id)) ?? 0,
      }))
      .sort((a, b) => Number(b.total) - Number(a.total))[0];
    if (winner?.name) {
      const winnerLabel = (t("scoreboardShareWinnerLabel") || "Ganador").toUpperCase();
      parts.push(`${winnerLabel} ${winner.name}`);
    }
    const text = parts.filter(Boolean).join(" · ");
    const blob = await canvasToBlob(canvas);
    await shareImageBlob(blob, { filename, title: shareMessage, text });
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
      matchHasAnyScores(active.matchState)
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
  scoreboardInfoText = buildRecordDateMessage(
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
  const source = _shell.currentScreen?.() || "splash";
  if (source !== "records") {
    recordsReturnScreen = source;
  }
  scoreboardReturnWinners = false;
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
      const value = isScoreFilled(raw) ? clampRoundScore(raw) : 0;
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
  persistActiveMatchSnapshot(nextState);
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
    const activePlayers = getActivePlayers(st);
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
      scores[player.id] = clampRoundScore(raw);
    });
    const roundNumber = st.round;
    matchController.addRoundScores(scores);
    const nextState = matchController.getState();
    persistActiveMatchSnapshot(nextState);
    if (nextState?.matchOver) {
      roundEndScores = {};
      roundEndUnlocked = new Set();
      roundEndSelectedWinners = new Set();
      clearMatchWordFor("match");
      _shell.stopClockLoop(false);
      _shell.showScreen("match");
      _shell.renderMatch();
      showMatchWinners(nextState.winnerIds || []);
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
        clearMatchWordFor("match");
        _shell.stopClockLoop(false);
        _shell.showScreen("match");
        _shell.renderMatch();
        showMatchWinners(nextState.winnerIds || []);
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
  clearMatchWordFor("match");
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
      clearMatchWordFor("match", false);
      clearStatusValidationFor("match");
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
  const activePlayers = getActivePlayers(matchState);
  const activeMap = new Map(activePlayers.map((player) => [String(player.id), player]));
  const displayOrder = (matchState.players || [])
    .map((player) => String(player.id))
    .filter((id) => activeMap.has(id));
  const dealerIndex = getDealerIndex(matchState);
  const dealerId = activePlayers[dealerIndex] ? String(activePlayers[dealerIndex].id) : null;
  const orderPrefix = t("matchRoundPlayerPrefix");
  const playerIndexMap = getPlayerIndexMap(matchState);
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
    scoreBtn.textContent = formatRoundEndScoreDisplay(roundEndScores[id]);
    scoreBtn.setAttribute("aria-label", player.name || "");

    row.append(header, scoreBtn);
    scoringList.appendChild(row);
  });
  updateRoundEndLockState(matchState);
  renderRoundEndWinners(matchState);
  updateRoundEndContinueState(matchState);
  updateRoundEndKeypad(matchState);
  updateActionOverlayStates();
}

// ─── Canvas / share helpers (relocated from shell/main.js) ───────────────────

function formatRecordDate(value) {
  if (!value) return "";
  const parsed = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toLocaleDateString(getShellLanguage() || "es");
}

function formatRecordPoints(value, { average = false } = {}) {
  if (value == null || value === "") return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return average ? num.toFixed(2) : String(num);
}

function createShareCanvas(width, height) {
  const canvas = document.createElement("canvas");
  const scale = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  return { canvas, ctx };
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function splitWordRows(wordValue) {
  const word = String(wordValue || "").trim();
  if (!word) return [];
  const letters = [...word];
  const length = letters.length;
  let rowsCount = 1;
  if (length >= 11) {
    rowsCount = Math.ceil(length / 9);
    if (rowsCount < 2) rowsCount = 2;
    if (rowsCount > 3) rowsCount = 3;
  }
  let rowSizes = [];
  if (rowsCount === 1) {
    rowSizes = [length];
  } else {
    let remaining = length;
    let ok = false;
    for (let attempt = rowsCount; attempt >= 1 && !ok; attempt -= 1) {
      remaining = length;
      rowSizes = [];
      ok = true;
      for (let i = 0; i < attempt - 1; i += 1) {
        const minNeededForRest = 8 * Math.max(0, attempt - 2 - i);
        const maxForRow = remaining - minNeededForRest;
        const count = Math.min(9, maxForRow);
        if (count < 8) {
          ok = false;
          break;
        }
        rowSizes.push(count);
        remaining -= count;
      }
      if (ok) {
        rowSizes.push(remaining);
        rowsCount = attempt;
      }
    }
  }
  const rows = [];
  let offset = 0;
  rowSizes.forEach((size) => {
    rows.push(letters.slice(offset, offset + size));
    offset += size;
  });
  return rows;
}

function measureWordTilesLayout(word, maxWidth, options = {}) {
  const rows = splitWordRows(word);
  if (!rows.length) {
    return { rows, tileSize: 0, gap: 0, height: 0 };
  }
  const maxRowSize = Math.max(...rows.map((row) => row.length));
  const gap = options.gap ?? 10;
  const tileMax = options.tileSizeMax ?? 90;
  const tileSize = Math.min(tileMax, (maxWidth - gap * (maxRowSize - 1)) / maxRowSize);
  const height = rows.length * tileSize + (rows.length - 1) * gap;
  return { rows, tileSize, gap, height };
}

function drawWordTiles(ctx, word, centerX, startY, maxWidth, options = {}) {
  const { rows, tileSize, gap } = measureWordTilesLayout(word, maxWidth, options);
  if (!rows.length) return startY;
  const radius = Math.max(8, tileSize * 0.2);
  const fontSize = Math.floor(tileSize * (options.fontScale ?? 0.55));
  const tileFill = options.tileFill || "#fffaf1";
  const tileStroke = options.tileStroke || "#d6a357";
  const tileText = options.tileText || "#6b3c1d";
  const fontWeight = options.fontWeight || 700;
  const lineWidth = options.tileLineWidth || 3;
  const shadow = options.tileShadow || null;
  const useGradient = options.tileGradient || false;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${fontWeight} ${fontSize}px "Fredoka", "Montserrat", sans-serif`;
  rows.forEach((row, rowIndex) => {
    const rowWidth = row.length * tileSize + (row.length - 1) * gap;
    let x = centerX - rowWidth / 2;
    const y = startY + rowIndex * (tileSize + gap);
    row.forEach((letter) => {
      if (shadow) {
        ctx.save();
        ctx.shadowColor = shadow.color || "rgba(0, 0, 0, 0.2)";
        ctx.shadowBlur = shadow.blur ?? 0;
        ctx.shadowOffsetX = shadow.offsetX ?? 0;
        ctx.shadowOffsetY = shadow.offsetY ?? 0;
      }
      drawRoundedRect(ctx, x, y, tileSize, tileSize, radius);
      if (useGradient) {
        const gradient = ctx.createLinearGradient(0, y, 0, y + tileSize);
        gradient.addColorStop(0, options.tileGradientFrom || tileFill);
        gradient.addColorStop(1, options.tileGradientTo || tileFill);
        ctx.fillStyle = gradient;
      } else {
        ctx.fillStyle = tileFill;
      }
      ctx.fill();
      ctx.strokeStyle = tileStroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      if (shadow) ctx.restore();
      if (options.textStroke) {
        ctx.strokeStyle = options.textStroke;
        ctx.lineWidth = options.textStrokeWidth ?? 2;
        ctx.strokeText(String(letter).toUpperCase(), x + tileSize / 2, y + tileSize / 2 + 1);
      }
      ctx.fillStyle = tileText;
      ctx.fillText(String(letter).toUpperCase(), x + tileSize / 2, y + tileSize / 2 + 1);
      x += tileSize + gap;
    });
  });
  return startY + rows.length * tileSize + (rows.length - 1) * gap;
}

function layoutChips(ctx, items, maxWidth, options = {}) {
  const gap = options.gap ?? 10;
  const padX = options.padX ?? 14;
  const padY = options.padY ?? 8;
  const fontSize = options.fontSize ?? 28;
  const height = fontSize + padY * 2;
  ctx.font = `${options.fontWeight ?? 700} ${fontSize}px "Fredoka", "Montserrat", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  let cursorX = 0;
  let cursorY = 0;
  const labels = items
    .map((item) => String(item?.label ?? item ?? "").trim())
    .filter(Boolean);
  const lines = [];
  let lineWidth = 0;
  let lineItems = [];
  labels.forEach((text, index) => {
    const textWidth = ctx.measureText(text).width;
    const chipWidth = textWidth + padX * 2;
    if (cursorX + chipWidth > maxWidth && cursorX > 0) {
      lines.push({ width: lineWidth - gap, items: lineItems });
      cursorX = 0;
      cursorY += height + gap;
      lineWidth = 0;
      lineItems = [];
    }
    cursorX += chipWidth + gap;
    lineWidth += chipWidth + gap;
    lineItems.push({ label: text, width: chipWidth, index });
  });
  if (lineItems.length) {
    lines.push({ width: lineWidth - gap, items: lineItems });
  }
  if (!labels.length) return { height: 0, lineHeight: height, lines: [] };
  return { height: cursorY + height, lineHeight: height, lines };
}

function measureChipsLayout(ctx, items, maxWidth, options = {}) {
  const layout = layoutChips(ctx, items, maxWidth, options);
  return { height: layout.height, lineHeight: layout.lineHeight };
}

function drawChips(ctx, items, x, y, maxWidth, options = {}) {
  const layout = layoutChips(ctx, items, maxWidth, options);
  if (!layout.height) return y;
  const gap = options.gap ?? 10;
  const padX = options.padX ?? 14;
  const padY = options.padY ?? 8;
  const fontSize = options.fontSize ?? 28;
  const chipH = fontSize + padY * 2;
  ctx.font = `${options.fontWeight ?? 700} ${fontSize}px "Fredoka", "Montserrat", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  let cursorY = y;
  layout.lines.forEach((line) => {
    let cursorX = x;
    line.items.forEach((item) => {
      drawRoundedRect(ctx, cursorX, cursorY, item.width, chipH, chipH / 2);
      ctx.fillStyle = options.fill || "#fff0cc";
      ctx.fill();
      ctx.strokeStyle = options.stroke || "#d6a357";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = options.color || "#6b3c1d";
      ctx.fillText(item.label, cursorX + padX, cursorY + chipH / 2 + 1);
      cursorX += item.width + gap;
    });
    cursorY += chipH + gap;
  });
  return cursorY - gap;
}

function drawColorChips(ctx, items, x, y, maxWidth, options = {}) {
  const layout = layoutChips(ctx, items, maxWidth, options);
  if (!layout.height) return y;
  const gap = options.gap ?? 10;
  const padX = options.padX ?? 12;
  const padY = options.padY ?? 6;
  const fontSize = options.fontSize ?? 24;
  const chipH = fontSize + padY * 2;
  const lineWidth = options.lineWidth ?? 2;
  ctx.font = `${options.fontWeight ?? 700} ${fontSize}px "Fredoka", "Montserrat", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  let cursorY = y;
  layout.lines.forEach((line) => {
    const lineStartX =
      options.align === "center" ? x + (maxWidth - line.width) / 2 : x;
    let cursorX = lineStartX;
    line.items.forEach((lineItem) => {
      const item = items[lineItem.index];
      drawRoundedRect(ctx, cursorX, cursorY, lineItem.width, chipH, chipH / 2);
      ctx.fillStyle = item?.fill || options.fill || "#fff0cc";
      ctx.fill();
      ctx.strokeStyle = item?.stroke || options.stroke || "#d6a357";
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      ctx.fillStyle = item?.color || options.color || "#6b3c1d";
      ctx.fillText(lineItem.label, cursorX + padX, cursorY + chipH / 2 + 1);
      cursorX += lineItem.width + gap;
    });
    cursorY += chipH + gap;
  });
  return cursorY - gap;
}

function truncateText(ctx, text, maxWidth) {
  const value = String(text || "");
  if (!value) return "";
  if (ctx.measureText(value).width <= maxWidth) return value;
  let trimmed = value;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}

function wrapTextLines(ctx, text, maxWidth) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    const width = ctx.measureText(test).width;
    if (width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  });
  if (line) lines.push(line);
  return lines;
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, align = "center") {
  const lines = wrapTextLines(ctx, text, maxWidth);
  ctx.textAlign = align;
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });
  return y + lines.length * lineHeight;
}

function drawShareCardFrame(ctx, x, y, w, h) {
  drawRoundedRect(ctx, x, y, w, h, 40);
  ctx.fillStyle = "#fff8e9";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#d6a357";
  ctx.stroke();
  drawRoundedRect(ctx, x + 6, y + 6, w - 12, h - 12, 34);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#fff3dc";
  ctx.stroke();
  drawRoundedRect(ctx, x + 12, y + 12, w - 24, h - 24, 30);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#e3c38a";
  ctx.stroke();
}

const iconOffsetCache = new Map();

function getIconContentOffset(img, size) {
  if (!img) return { dx: 0, dy: 0 };
  const key = `${img.src || "img"}:${size}`;
  if (iconOffsetCache.has(key)) return iconOffsetCache.get(key);
  const tmp = document.createElement("canvas");
  tmp.width = size;
  tmp.height = size;
  const tctx = tmp.getContext("2d");
  tctx.drawImage(img, 0, 0, size, size);
  const { data, width, height } = tctx.getImageData(0, 0, size, size);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4 + 3;
      if (data[idx] > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  let offset = { dx: 0, dy: 0 };
  if (maxX >= minX && maxY >= minY) {
    const contentW = maxX - minX + 1;
    const contentH = maxY - minY + 1;
    const dx = (width - contentW) / 2 - minX;
    const dy = (height - contentH) / 2 - minY;
    offset = { dx, dy };
  }
  iconOffsetCache.set(key, offset);
  return offset;
}

function drawShareCardTitle(ctx, cardX, cardW, topY, iconImg, label) {
  const iconSize = 70;
  const iconPillSize = 90;
  const text = String(label || "");
  ctx.font = `800 68px "Fredoka", "Montserrat", sans-serif`;
  const textWidth = ctx.measureText(text).width;
  const textX = cardX + (cardW - textWidth) / 2;
  const textY = topY + 36;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#6b3c1d";
  ctx.fillText(text, textX, textY);
  const nextY = topY + 84;
  if (iconImg) {
    const pillX = cardX + (cardW - iconPillSize) / 2;
    const pillY = nextY;
    drawRoundedRect(ctx, pillX, pillY, iconPillSize, iconPillSize, iconPillSize / 2);
    ctx.fillStyle = "#fff3dc";
    ctx.fill();
    ctx.strokeStyle = "#d6a357";
    ctx.lineWidth = 3;
    ctx.stroke();
    const iconX = pillX + (iconPillSize - iconSize) / 2;
    const iconY = pillY + (iconPillSize - iconSize) / 2;
    const { dx, dy } = getIconContentOffset(iconImg, iconSize);
    ctx.drawImage(iconImg, iconX + dx, iconY + dy, iconSize, iconSize);
    return pillY + iconPillSize + 8;
  }
  return nextY;
}

function drawIconWithOutline(ctx, img, x, y, size, color = "#000000") {
  if (!img) return;
  const tmp = document.createElement("canvas");
  tmp.width = size;
  tmp.height = size;
  const tctx = tmp.getContext("2d");
  tctx.drawImage(img, 0, 0, size, size);
  tctx.globalCompositeOperation = "source-in";
  tctx.fillStyle = color;
  tctx.fillRect(0, 0, size, size);
  tctx.globalCompositeOperation = "source-over";

  const offsets = [
    [-2, 0],
    [2, 0],
    [0, -2],
    [0, 2],
    [-2, -2],
    [2, -2],
    [-2, 2],
    [2, 2],
    [-3, 0],
    [3, 0],
    [0, -3],
    [0, 3],
  ];
  offsets.forEach(([dx, dy]) => {
    ctx.drawImage(tmp, x + dx, y + dy, size, size);
  });
  ctx.drawImage(img, x, y, size, size);
}

function getCenteredTextBaseline(ctx, y, height, sample = "Ag") {
  const metrics = ctx.measureText(sample);
  if (
    typeof metrics.actualBoundingBoxAscent === "number" &&
    typeof metrics.actualBoundingBoxDescent === "number"
  ) {
    const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    return y + (height - textHeight) / 2 + metrics.actualBoundingBoxAscent;
  }
  const sizeMatch = String(ctx.font).match(/(\d+(?:\.\d+)?)px/);
  const fontSize = sizeMatch ? Number(sizeMatch[1]) : 0;
  return y + height / 2 + fontSize * 0.35;
}

function formatShareMessage(template, vars) {
  if (!template) return "";
  let text = String(template);
  Object.entries(vars || {}).forEach(([key, value]) => {
    text = text.split(`{${key}}`).join(value ?? "");
  });
  return text;
}

function formatShareName(name) {
  return String(name || "").trim().toUpperCase();
}

function formatShareWord(word) {
  return String(word || "").trim().toUpperCase();
}

function loadImageElement(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.decoding = "async";
    img.crossOrigin = "anonymous";
    img.src = src;
  });
}

async function canvasToBlob(canvas) {
  const blob = await new Promise((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/png", 0.92);
  });
  if (blob) return blob;
  const dataUrl = canvas.toDataURL("image/png");
  const res = await fetch(dataUrl);
  return res.blob();
}

async function shareImageBlob(blob, { filename, title, text } = {}) {
  if (!blob) return false;
  const safeName = filename || "letter-loom-share.png";
  const file = new File([blob], safeName, { type: blob.type || "image/png" });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({ files: [file], title, text });
    return true;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return false;
}

function buildShareFileName(prefix, recordDate, name) {
  const dateLabel = recordDate ? String(recordDate).replace(/[^\d-]/g, "-") : "";
  const safeName = String(name || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  const parts = [prefix, safeName, dateLabel].filter(Boolean);
  return `${parts.join("-")}.png`;
}

function getShareIconSrc() {
  if (/(iPhone|iPad|iPod)/i.test(navigator.userAgent)) return "assets/img/share-ios.svg";
  if (/Android/i.test(navigator.userAgent)) return "assets/img/share-android.svg";
  return "assets/img/share.svg";
}

function applyShareIcon(el, labelOverride = "") {
  if (!el) return;
  const src = getShareIconSrc();
  el.style.setProperty("--share-icon", `url("${src}")`);
  const img = el.querySelector?.(".share-icon-img");
  if (img) {
    img.setAttribute("src", src);
    img.setAttribute("alt", "");
  }
  const label =
    labelOverride ||
    t("scoreboardShare") ||
    t("recordsShare") ||
    "Compartir";
  el.setAttribute("aria-label", label);
  el.setAttribute("title", label);
}

async function buildRecordShareCanvas(record, kind, position = null) {
  if (!record) return null;
  if (document?.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {}
  }
  let { canvas, ctx } = createShareCanvas(SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);
  const playerName = formatShareName(record.playerName || t("playerLabel") || "");
  const wordValue = formatShareWord(record.word || "");
  const pointsText = formatRecordPoints(record.points, { average: kind !== "word" });

  const cardX = SHARE_CARD_MARGIN;
  const cardY = SHARE_CARD_MARGIN;
  const cardW = SHARE_CARD_WIDTH - SHARE_CARD_MARGIN * 2;
  let cardH = SHARE_CARD_HEIGHT - 160;

  const logo = await loadImageElement("assets/img/logo-letters.png");
  const headerIcon = await loadImageElement(
    kind === "word" ? "assets/img/record.svg" : "assets/img/winner.svg"
  );
  const logoWidth = 340;
  const logoRatio = logo?.height ? logo.width / logo.height : 1;
  const logoHeight = logoWidth / logoRatio;
  const logoX = cardX + (cardW - logoWidth) / 2;
  const logoY = cardY + 18;
  const logoBottom = logoY + logoHeight;
  const headerLabel =
    kind === "word" ? t("recordsShareWordTitle") : t("recordsShareMatchTitle");
  const headerTop = logoBottom + 36;
  const headerBottom = drawShareCardTitle(ctx, cardX, cardW, headerTop, headerIcon, headerLabel);

  const pillX = cardX + 40;
  const pillW = cardW - 80;
  const pillY = headerBottom + 22;
  const baseColor =
    position != null
      ? PLAYER_COLORS[(position - 1 + PLAYER_COLORS.length) % PLAYER_COLORS.length]
      : record.color || PLAYER_COLORS[0];
  const palette = getDealerPalette(baseColor);

  const pillPad = 22;
  const pointsPillH = 72;
  const topRowH = pointsPillH;
  const wordOptions = {
    tileSizeMax: 84,
    gap: 10,
    fontScale: 0.62,
    tileGradient: true,
    tileGradientFrom: "#fff6de",
    tileGradientTo: "#f7d9a4",
    tileStroke: "rgba(131, 79, 30, 0.6)",
    tileLineWidth: 3,
    tileText: "#6b3c1d",
    fontWeight: 900,
    tileShadow: { color: "rgba(0, 0, 0, 0.18)", blur: 0, offsetX: 0, offsetY: 2 },
  };

  const wordLayout =
    kind === "word" && wordValue
      ? measureWordTilesLayout(wordValue, pillW - 60, wordOptions)
      : { height: 0 };

  const tags = [];
  const dateLabel = formatRecordDate(record.when);
  if (dateLabel) tags.push(dateLabel);
  if (record.round != null) tags.push(`B${record.round}`);
  const tagChips = tags.map((tag) => ({
    label: String(tag).toUpperCase(),
    fill: "rgba(0, 0, 0, 0.35)",
    stroke: "rgba(255, 255, 255, 0.25)",
    color: "#ffffff",
  }));
  const featureChips = [];
  if (kind === "word") {
    const features = record.features || {};
    if (features.sameColor) {
      featureChips.push({
        label: t("recordsFeatureSameColor"),
        fill: "#ffe7a8",
        stroke: "#d7b882",
        color: "#7b3b21",
      });
    }
    if (features.usedWildcard) {
      featureChips.push({
        label: t("recordsFeatureWildcard"),
        fill: "#e6e6ff",
        stroke: "#b7b7f0",
        color: "#4b3b7b",
      });
    }
    if (features.doubleScore) {
      featureChips.push({
        label: t("recordsFeatureDouble"),
        fill: "#ffe2a8",
        stroke: "#d7a24a",
        color: "#7b3b21",
      });
    }
    if (features.plusPoints) {
      featureChips.push({
        label: t("recordsFeaturePlus"),
        fill: "#d8f6d8",
        stroke: "#7cc47a",
        color: "#1f6b2c",
      });
    }
    if (features.minusPoints) {
      featureChips.push({
        label: t("recordsFeatureMinus"),
        fill: "#ffd6d6",
        stroke: "#d16b6b",
        color: "#7b1f1f",
      });
    }
  }
  const featureLayout = featureChips.length
    ? measureChipsLayout(ctx, featureChips, pillW - pillPad * 2, {
        fontSize: 44,
        padX: 20,
        padY: 10,
        gap: 12,
      })
    : { height: 0 };

  let contentHeight = topRowH;
  if (wordLayout.height) contentHeight += 14 + wordLayout.height;
  if (featureLayout.height) contentHeight += 8 + featureLayout.height;

  const dateChips = [];
  if (dateLabel) dateChips.push(dateLabel);
  if (record.round != null) {
    dateChips.push(`Baza ${record.round}`);
  } else if (kind !== "word") {
    const roundsValue = record.rounds ?? record.round ?? 0;
    if (roundsValue) {
      const roundsLabel =
        t("matchModeRounds") || t("recordsRoundsHeader") || "Bazas";
      dateChips.push(`${roundsLabel} ${roundsValue}`);
    }
  }
  const dateTextParts = dateChips;
  const dateFontSize = 46;
  const dateLineHeight = dateFontSize + 6;
  const dateLayout = dateTextParts.length
    ? { height: dateLineHeight }
    : { height: 0 };

  const pillH = Math.max(260, contentHeight + pillPad * 2);
  const bottomContentHeight = dateLayout.height ? dateLayout.height + 18 : 0;
  cardH = pillY - cardY + pillH + bottomContentHeight + 24;
  const desiredHeight = cardY + cardH + SHARE_CARD_MARGIN;

  const finalHeight = Math.min(SHARE_CARD_HEIGHT, desiredHeight);
  if (finalHeight !== SHARE_CARD_HEIGHT) {
    ({ canvas, ctx } = createShareCanvas(SHARE_CARD_WIDTH, finalHeight));
  }

  ctx.fillStyle = "#f7ead1";
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, finalHeight);

  drawShareCardFrame(ctx, cardX, cardY, cardW, cardH);

  if (logo) {
    ctx.drawImage(logo, logoX, logoY, logoWidth, logoHeight);
  }
  drawShareCardTitle(ctx, cardX, cardW, headerTop, headerIcon, headerLabel);

  drawRoundedRect(ctx, pillX, pillY + 4, pillW, pillH, 16);
  ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
  ctx.fill();
  drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 16);
  ctx.fillStyle = palette.bg;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = palette.border;
  ctx.stroke();
  drawRoundedRect(ctx, pillX + 2, pillY + 2, pillW - 4, pillH - 4, 14);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const topRowY = pillY + pillPad;
  const rowH = pointsPillH;
  const topRowCenterY = topRowY + rowH / 2;
  let nameX = pillX + pillPad;

  ctx.font = `800 60px "Fredoka", "Montserrat", sans-serif`;
  const pointsPillW = Math.max(92, ctx.measureText(pointsText).width + 26);
  const pointsPillX = pillX + pillW - pillPad - pointsPillW;
  const nameMaxW = Math.max(40, pointsPillX - nameX - 10);
  const displayName = truncateText(ctx, playerName, nameMaxW);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
  ctx.lineWidth = 4;
  ctx.strokeText(displayName, nameX, topRowCenterY + 1);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(displayName, nameX, topRowCenterY + 1);

  drawRoundedRect(ctx, pointsPillX, topRowY, pointsPillW, pointsPillH, 14);
  const pointsGradient = ctx.createLinearGradient(0, topRowY, 0, topRowY + pointsPillH);
  pointsGradient.addColorStop(0, "#ffe26f");
  pointsGradient.addColorStop(1, "#ffc94f");
  ctx.fillStyle = pointsGradient;
  ctx.fill();
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.font = `900 52px "Fredoka", "Montserrat", sans-serif`;
  ctx.fillStyle = "#6b3c1d";
  ctx.fillText(pointsText, pointsPillX + pointsPillW / 2, topRowCenterY + 1);

  let cursorY = topRowY + pointsPillH + 14;

  if (kind === "word" && wordValue) {
    const wordY = drawWordTiles(
      ctx,
      wordValue,
      pillX + pillW / 2,
      cursorY,
      pillW - 60,
      wordOptions
    );
    cursorY = wordY + 16;
  }

  if (kind === "word") {
    if (featureChips.length) {
      cursorY = drawColorChips(
        ctx,
        featureChips,
        pillX + pillPad,
        cursorY,
        pillW - pillPad * 2,
        { fontSize: 44, padX: 20, padY: 10, gap: 12, align: "center" }
      );
      cursorY += 10;
    }
  } else {
    const others = Array.isArray(record.otherPlayers) ? record.otherPlayers.filter(Boolean) : [];
    const otherChips = others.map((name) => ({
      label: formatShareName(name),
      fill: "rgba(255, 255, 255, 0.55)",
      stroke: "rgba(107, 60, 29, 0.25)",
      color: "#6b3c1d",
    }));
    if (otherChips.length) {
      cursorY = drawColorChips(
        ctx,
        otherChips,
        pillX + pillPad,
        cursorY,
        pillW - pillPad * 2,
        { fontSize: 26, padX: 12, padY: 7, align: "center" }
      );
      cursorY += 10;
    }
  }

  let bottomContentY = pillY + pillH;
  if (dateTextParts.length) {
    const dateLine = dateTextParts.join(" · ");
    ctx.font = `800 ${dateFontSize}px "Fredoka", "Montserrat", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#c9a56c";
    const textY = bottomContentY + 18 + dateLineHeight / 2;
    ctx.fillText(dateLine, pillX + pillW / 2, textY);
    bottomContentY = textY + dateLineHeight / 2;
  }

  return canvas;
}

async function handleRecordShare(record, kind, position = null) {
  if (!record || recordShareBusy) return;
  recordShareBusy = true;
  try {
    const canvas = await buildRecordShareCanvas(record, kind, position);
    if (!canvas) return;
    const dateLabel = formatRecordDate(record.when);
    const appName = t("appTitle") || "The Letter Loom";
    const playerName = formatShareName(record.playerName || t("playerLabel") || "");
    const messageTemplate =
      kind === "word" ? t("recordsShareWordMessage") : t("recordsShareMatchMessage");
    const shareMessage = formatShareMessage(messageTemplate, {
      app: appName,
      player: playerName,
    }).trim();
    const filename = buildShareFileName(
      kind === "word" ? "record-word" : "record-match",
      dateLabel,
      record.playerName
    );
    const parts = [shareMessage];
    if (kind === "word") {
      const wordText = formatShareWord(record.word || "");
      if (wordText) parts.push(wordText);
      const pointsText = formatRecordPoints(record.points);
      if (pointsText) {
        const pointsLabel = (t("recordsPointsHeader") || "Puntos").toUpperCase();
        parts.push(`${pointsText} ${pointsLabel}`);
      }
    } else {
      const avgText = formatRecordPoints(record.points, { average: true });
      if (avgText) {
        const avgLabel = (t("recordsAverageLabel") || "Promedio").toUpperCase();
        parts.push(`${avgLabel} ${avgText}`);
      }
      const roundsValue = record.rounds ?? record.round ?? 0;
      if (roundsValue) {
        const roundsLabel = (t("matchModeRounds") || t("recordsRoundsHeader") || "Bazas").toUpperCase();
        parts.push(`${roundsValue} ${roundsLabel}`);
      }
    }
    const text = parts.filter(Boolean).join(" · ");
    const blob = await canvasToBlob(canvas);
    await shareImageBlob(blob, { filename, title: shareMessage, text });
    capture('record_shared', { kind })
    flush()
  } catch (err) {
    logger.warn("Share record failed", err);
  } finally {
    recordShareBusy = false;
  }
}

function buildRecordDateMessage(dateValue) {
  const date = formatRecordDate(dateValue);
  const template = t("scoreboardRecordDate") || "Partida del {date}";
  return template.replace("{date}", date || "");
}

// ─── Records management ───────────────────────────────────────────────────────

function getWordRecordThreshold(records) {
  const list = Array.isArray(records?.bestWord) ? records.bestWord : [];
  if (list.length < 10) return RECORD_MIN_POINTS;
  const sorted = sortRecords(list, "points");
  return Number(sorted[9]?.points) || RECORD_MIN_POINTS;
}

function canEnterWordRecords(points, records) {
  if (!Number.isFinite(points) || points < RECORD_MIN_POINTS) return false;
  const list = Array.isArray(records?.bestWord) ? records.bestWord : [];
  if (list.length < 10) return true;
  const threshold = getWordRecordThreshold(records);
  return points > threshold;
}

function getMatchRecordThreshold(records) {
  const list = Array.isArray(records?.bestMatch) ? records.bestMatch : [];
  if (list.length < 10) return Number.NEGATIVE_INFINITY;
  const sorted = sortRecords(list, "points");
  return Number(sorted[9]?.points) || Number.NEGATIVE_INFINITY;
}

function canEnterMatchRecords(points, records) {
  if (!Number.isFinite(points)) return false;
  const list = Array.isArray(records?.bestMatch) ? records.bestMatch : [];
  if (list.length < 10) return true;
  const threshold = getMatchRecordThreshold(records);
  return points > threshold;
}

function upsertWordRecord(entry, records) {
  if (!entry) return records;
  const list = Array.isArray(records.bestWord) ? [...records.bestWord] : [];
  const key = `${entry.matchId || ""}|${entry.playerId || ""}|${entry.round || ""}|${entry.word || ""}`;
  const existingIndex = list.findIndex(
    (item) =>
      `${item?.matchId || ""}|${item?.playerId || ""}|${item?.round || ""}|${item?.word || ""}` ===
      key
  );
  if (existingIndex >= 0) {
    const prev = list[existingIndex];
    if (Number(entry.points) > Number(prev?.points || 0)) {
      list[existingIndex] = entry;
    }
  } else {
    list.push(entry);
  }
  const sorted = sortRecords(list, "points").slice(0, 10);
  return { ...records, bestWord: sorted };
}

function upsertMatchRecord(entry, records) {
  if (!entry) return records;
  const list = Array.isArray(records.bestMatch) ? [...records.bestMatch] : [];
  const key = `${entry.matchId || ""}|${entry.playerId || ""}`;
  const existingIndex = list.findIndex(
    (item) => `${item?.matchId || ""}|${item?.playerId || ""}` === key
  );
  if (existingIndex >= 0) {
    const prev = list[existingIndex];
    if (Number(entry.points) > Number(prev?.points || 0)) {
      list[existingIndex] = entry;
    }
  } else {
    list.push(entry);
  }
  const sorted = sortRecords(list, "points").slice(0, 10);
  return { ...records, bestMatch: sorted };
}

function recordMatchAverages(matchState) {
  if (!matchState?.matchOver) return;
  const records = loadRecords() || {};
  const when = Date.now();
  const rounds = matchState.round ?? 0;
  matchState.players?.forEach((player) => {
    const total = Number(player.score) || 0;
    const played = Array.isArray(player.rounds) ? player.rounds.length : rounds;
    if (!played) return;
    const avg = total / played;
    const threshold = RECORD_AVG_PENALTY_THRESHOLD;
    const decay = RECORD_AVG_PENALTY_DECAY;
    const maxPenalty = RECORD_AVG_PENALTY_MAX;
    const factor =
      played < threshold
        ? played / threshold
        : 1 - maxPenalty * Math.exp(-(played - threshold) / decay);
    const adjusted = avg * Math.max(0, Math.min(1, factor));
    const entry = {
      matchId: matchState.matchId,
      playerId: player.id,
      playerName: player.name || "",
      points: Number(adjusted.toFixed(2)),
      rounds: played,
      when,
      otherPlayers: matchState.players
        .filter((p) => p.id !== player.id)
        .map((p) => p.name)
        .filter(Boolean),
    };
    const existing = Array.isArray(records.bestMatch)
      ? records.bestMatch.find(
          (item) =>
            `${item?.matchId || ""}|${item?.playerId || ""}` ===
            `${entry.matchId || ""}|${entry.playerId || ""}`
        )
      : null;
    if (!existing && !canEnterMatchRecords(entry.points, records)) return;
    const next = upsertMatchRecord(entry, records);
    records.bestMatch = next.bestMatch;
  });
  saveRecords(records);
}

function finalizeWordRecordCandidates(matchState) {
  if (!matchState?.matchOver) return;
  const map = loadWordCandidatesMap();
  const list = Array.isArray(map[matchState.matchId]) ? map[matchState.matchId] : [];
  if (!list.length) return;
  let records = loadRecords() || {};
  list.forEach((candidate) => {
    if (candidate?.ignored) return;
    if (!candidate?.word) return;
    const points = Number(candidate?.points);
    if (!Number.isFinite(points)) return;
    if (!isScoreValidForRecord(points, { requireEven: true })) return;
    if (!canEnterWordRecords(points, records)) return;
    const player = matchState.players?.find((p) => String(p.id) === String(candidate.playerId));
    const entry = {
      matchId: matchState.matchId,
      playerId: candidate.playerId,
      playerName: player?.name || "",
      round: candidate.round,
      word: candidate.word,
      points: Number(candidate.points),
      when: candidate.when || Date.now(),
      features: { ...candidate.features },
    };
    records = upsertWordRecord(entry, records);
  });
  saveRecords(records);
  removeWordCandidatesForMatch(matchState.matchId);
}

function applySimulatedRecords() {
  if (window.__simulatedRecordsApplied) return false;
  if (!SIMULATED_RECORDS) return false;
  window.__simulatedRecordsApplied = true;
  const existing = loadRecords() || {};
  const simulatedWord = Array.isArray(SIMULATED_RECORDS.bestWord) ? SIMULATED_RECORDS.bestWord : [];
  const simulatedMatch = Array.isArray(SIMULATED_RECORDS.bestMatch)
    ? SIMULATED_RECORDS.bestMatch
    : [];
  const mergeByKey = (items, keyFn) => {
    const map = new Map();
    items.forEach((item) => {
      const key = keyFn(item);
      if (!key) return;
      map.set(key, item);
    });
    return Array.from(map.values());
  };
  const bestWord = mergeByKey(
    [...(Array.isArray(existing.bestWord) ? existing.bestWord : []), ...simulatedWord],
    (item) => {
      if (!item) return "";
      return `${item.matchId || ""}|${item.playerId || ""}|${item.round || ""}|${item.word || ""}`;
    }
  );
  const bestMatch = mergeByKey(
    [...(Array.isArray(existing.bestMatch) ? existing.bestMatch : []), ...simulatedMatch],
    (item) => {
      if (!item) return "";
      return `${item.matchId || ""}|${item.playerId || ""}`;
    }
  );
  const records = { ...existing, bestWord, bestMatch };
  localStorage.setItem("letterloom_match_records", JSON.stringify(records));
  const seeds = Array.isArray(SIMULATED_MATCH_SEEDS) ? SIMULATED_MATCH_SEEDS : [];
  if (seeds.length) {
    const seedsById = new Map(seeds.map((seed) => [String(seed.matchId || ""), seed]));
    const ids = new Set();
    [...records.bestWord, ...records.bestMatch].forEach((entry) => {
      if (entry?.matchId) ids.add(String(entry.matchId));
    });
    ids.forEach((matchId) => {
      const seed = seedsById.get(String(matchId));
      if (!seed) return;
      const matchState = buildSimulatedMatchState(seed);
      const savedAt = seed.lastSavedAt ? Date.parse(seed.lastSavedAt) : Date.now();
      upsertArchiveMatch({
        matchId,
        savedAt: Number.isFinite(savedAt) ? savedAt : Date.now(),
        status: "finished",
        matchState,
      });
    });
  }
  return true;
}

function sortRecords(list, valueKey = "points") {
  return [...list].sort((a, b) => {
    const av = Number(a?.[valueKey]) || 0;
    const bv = Number(b?.[valueKey]) || 0;
    if (bv !== av) return bv - av;
    const aw = Number.isFinite(Number(a?.when)) ? Number(a.when) : Date.parse(a?.when || 0);
    const bw = Number.isFinite(Number(b?.when)) ? Number(b.when) : Date.parse(b?.when || 0);
    if (Number.isFinite(aw) && Number.isFinite(bw)) return aw - bw;
    return 0;
  });
}

function saveRecords(records) {
  localStorage.setItem("letterloom_match_records", JSON.stringify(records || {}));
  const wordCount = Array.isArray(records?.bestWord) ? records.bestWord.length : 0;
  const matchCount = Array.isArray(records?.bestMatch) ? records.bestMatch.length : 0;
  const ids = new Set();
  (records?.bestWord || []).forEach((entry) => entry?.matchId && ids.add(String(entry.matchId)));
  (records?.bestMatch || []).forEach((entry) => entry?.matchId && ids.add(String(entry.matchId)));
  logger.debug(`Records saved: words=${wordCount} matches=${matchCount} ids=${[...ids].join(",")}`);
  const current = matchController.getState?.();
  if (current?.matchId && ids.has(String(current.matchId)) && matchHasAnyScores(current)) {
    upsertArchiveMatch(
      {
        matchId: current.matchId,
        savedAt: Date.now(),
        status: current.matchOver ? "finished" : "active",
        matchState: current,
      },
      { records }
    );
  }
}

function deleteRecordEntry(record, kind) {
  if (!record) return;
  const records = loadRecords() || {};
  logger.debug(`Delete record: kind=${kind || "unknown"} matchId=${record.matchId || ""}`);
  if (kind === "word") {
    const list = Array.isArray(records.bestWord) ? records.bestWord : [];
    const targetMatch = String(record.matchId || "");
    const targetPlayer = String(record.playerId || "");
    const targetRound = String(record.round || "");
    const targetWord = String(record.word || "");
    const next = list.filter((item) => {
      const matchId = String(item?.matchId || "");
      const playerId = String(item?.playerId || "");
      const round = String(item?.round || "");
      if (targetMatch && targetPlayer && targetRound) {
        return matchId !== targetMatch || playerId !== targetPlayer || round !== targetRound;
      }
      return String(item?.word || "") !== targetWord;
    });
    records.bestWord = next;
  } else if (kind === "match") {
    const list = Array.isArray(records.bestMatch) ? records.bestMatch : [];
    const next = list.filter(
      (item) =>
        String(item?.matchId || "") !== String(record.matchId || "") ||
        String(item?.playerId || "") !== String(record.playerId || "")
    );
    records.bestMatch = next;
  }
  saveRecords(records);
  const matchId = record?.matchId != null ? String(record.matchId) : "";
  if (matchId && !matchHasRecord(matchId, records)) {
    const archive = loadArchive();
    if (archive?.byId?.[matchId]) {
      delete archive.byId[matchId];
      archive.order = (archive.order || []).filter((id) => String(id) !== matchId);
      saveArchive(archive);
      logger.debug(`Archive entry removed for matchId=${matchId}`);
    }
  }
}

// ─── Records UI ───────────────────────────────────────────────────────────────

function renderRecordsList({ listId, records, emptyText, showWord = false } = {}) {
  const list = document.getElementById(listId);
  if (!list) return;
  const rows = Array.isArray(records) ? records.slice(0, 10) : [];
  list.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "records-empty";
    empty.textContent = emptyText || t("recordsEmpty") || "Sin records";
    list.appendChild(empty);
    return;
  }

  rows.forEach((record, idx) => {
    const pill = document.createElement("div");
    pill.className = "records-pill";
    let longPressTimer = null;
    let longPressFired = false;
    const clearLongPress = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };
    const startLongPress = () => {
      clearLongPress();
      longPressFired = false;
      longPressTimer = setTimeout(() => {
        longPressFired = true;
        _shell.openConfirm({
          title: "confirmTitleDeleteRecord",
          body: "confirmBodyDeleteRecord",
          acceptText: "confirmDelete",
          onConfirm: () => {
            deleteRecordEntry(record, showWord ? "word" : "match");
            renderRecordsScreen();
          },
        });
      }, 3000);
    };
    pill.addEventListener("pointerdown", startLongPress);
    pill.addEventListener("pointerup", clearLongPress);
    pill.addEventListener("pointerleave", clearLongPress);
    pill.addEventListener("pointercancel", clearLongPress);
    pill.addEventListener("click", (event) => {
      if (longPressFired) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      _shell.playClickFeedback();
      openRecordScoreboard(record, { highlightWord: showWord });
    });
    const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
    const palette = getDealerPalette(color);
    pill.style.setProperty("--pill-bg-1", palette.bg);
    pill.style.setProperty("--pill-border", palette.border);

    const top = document.createElement("div");
    top.className = "records-pill-top";
    const pos = document.createElement("span");
    pos.className = "records-pill-pos";
    pos.textContent = `#${idx + 1}`;
    const name = document.createElement("span");
    name.className = "records-pill-name";
    name.textContent = record.playerName || "";
    const points = document.createElement("span");
    points.className = "records-pill-points";
    points.textContent = formatRecordPoints(record.points, { average: !showWord });
    top.append(pos, name, points);

    let wordRow = null;
    if (showWord) {
      wordRow = document.createElement("div");
      wordRow.className = "records-pill-word-row";
      const wordValue = String(record.word || "").trim();
      const letters = [...wordValue];
      const length = letters.length;
      let rowsCount = 1;
      if (length >= 11) {
        rowsCount = Math.ceil(length / 9);
        if (rowsCount < 2) rowsCount = 2;
        if (rowsCount > 3) rowsCount = 3;
      }
      let rowSizes = [];
      if (rowsCount === 1) {
        rowSizes = [length];
      } else {
        let remaining = length;
        let ok = false;
        for (let attempt = rowsCount; attempt >= 1 && !ok; attempt -= 1) {
          remaining = length;
          rowSizes = [];
          ok = true;
          for (let i = 0; i < attempt - 1; i += 1) {
            const minNeededForRest = 8 * Math.max(0, attempt - 2 - i);
            const maxForRow = remaining - minNeededForRest;
            const count = Math.min(9, maxForRow);
            if (count < 8) {
              ok = false;
              break;
            }
            rowSizes.push(count);
            remaining -= count;
          }
          if (ok) {
            rowSizes.push(remaining);
            rowsCount = attempt;
          }
        }
      }
      let offset = 0;
      for (let rowIndex = 0; rowIndex < rowSizes.length; rowIndex += 1) {
        const size = rowSizes[rowIndex];
        const row = document.createElement("div");
        row.className = "records-pill-word-line";
        letters.slice(offset, offset + size).forEach((letter) => {
          const tile = document.createElement("span");
          tile.className = "records-pill-letter";
          tile.textContent = letter.toUpperCase();
          row.appendChild(tile);
        });
        wordRow.appendChild(row);
        offset += size;
      }
    }

    const mid = document.createElement("div");
    mid.className = "records-pill-mid";
    const round = document.createElement("span");
    round.className = "records-pill-tag";
    round.textContent = record.round != null ? `B${record.round}` : "";
    const date = document.createElement("span");
    date.className = "records-pill-date";
    date.textContent = formatRecordDate(record.when);
    if (date.textContent) mid.appendChild(date);
    if (round.textContent) mid.appendChild(round);

    const playersRow = document.createElement("div");
    playersRow.className = "records-pill-players";
    if (showWord) {
      const features = record.features || {};
      const featureLabels = [
        ["sameColor", t("recordsFeatureSameColor")],
        ["usedWildcard", t("recordsFeatureWildcard")],
        ["doubleScore", t("recordsFeatureDouble")],
        ["plusPoints", t("recordsFeaturePlus")],
        ["minusPoints", t("recordsFeatureMinus")],
      ];
      featureLabels.forEach(([key, label]) => {
        if (!features[key] || !label) return;
        const chip = document.createElement("span");
        chip.className = `records-pill-chip records-feature-${key}`;
        chip.textContent = label;
        playersRow.appendChild(chip);
      });
    } else {
      const others = Array.isArray(record.otherPlayers) ? record.otherPlayers : [];
      others.forEach((player) => {
        const chip = document.createElement("span");
        chip.className = "records-pill-chip";
        chip.textContent = player;
        playersRow.appendChild(chip);
      });
    }

    const view = document.createElement("span");
    view.className = "records-pill-view";
    view.setAttribute("aria-hidden", "true");
    view.textContent = t("recordsViewMatch") || "Ver partida";

    const share = document.createElement("button");
    share.type = "button";
    share.className = "records-pill-share share-icon-btn";
    share.textContent = t("recordsShare") || "Compartir";
    const shareImg = document.createElement("img");
    shareImg.className = "share-icon-img";
    shareImg.alt = "";
    share.appendChild(shareImg);
    applyShareIcon(share, share.textContent);
    share.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    share.addEventListener("pointerup", (event) => {
      event.stopPropagation();
    });
    share.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      _shell.playClickFeedback();
      handleRecordShare(record, showWord ? "word" : "match", idx + 1);
    });

    pill.append(top);
    if (wordRow) pill.appendChild(wordRow);
    pill.append(mid, playersRow, view);
    pill.appendChild(share);
    list.appendChild(pill);
  });
}

function renderRecordsScreen() {
  const records = loadRecords() || {};
  const wordRecords = Array.isArray(records.bestWord) ? sortRecords(records.bestWord, "points") : [];
  const matchRecords = Array.isArray(records.bestMatch)
    ? sortRecords(records.bestMatch, "points")
    : [];

  renderRecordsList({
    listId: "recordsWordList",
    records: wordRecords,
    emptyText: t("recordsEmptyWord"),
    showWord: true,
  });

  renderRecordsList({
    listId: "recordsMatchList",
    records: matchRecords,
    emptyText: t("recordsEmptyMatch"),
    showWord: false,
  });

  setRecordsTab(recordsTab || "words");
}

function closeRecords() {
  if (recordsReturnScreen === "match-winners" && _shell.lastWinnersIds.value.length) {
    _shell.suppressWinnersPrompt.value = false;
    showMatchWinners(_shell.lastWinnersIds.value);
    return;
  }
  _shell.showScreen(recordsReturnScreen || "scoreboard");
  _shell.scaleGame();
}

function setRecordsTab(nextTab) {
  recordsTab = nextTab === "matches" ? "matches" : "words";
  const tabs = document.getElementById("recordsTabs");
  const wordsBtn = document.getElementById("recordsTabWordsBtn");
  const matchesBtn = document.getElementById("recordsTabMatchesBtn");
  const wordsSection = document.getElementById("recordsWordList")?.closest(".records-section");
  const matchesSection = document.getElementById("recordsMatchList")?.closest(".records-section");
  if (tabs) tabs.classList.toggle("is-points", recordsTab === "matches");
  if (wordsBtn) wordsBtn.classList.toggle("active", recordsTab === "words");
  if (matchesBtn) matchesBtn.classList.toggle("active", recordsTab === "matches");
  if (wordsSection) wordsSection.classList.toggle("hidden", recordsTab !== "words");
  if (matchesSection) matchesSection.classList.toggle("hidden", recordsTab !== "matches");
  const recordsConfig = document.querySelector(".records-config");
  const activeSection = recordsTab === "matches" ? matchesSection : wordsSection;
  if (recordsConfig && activeSection) {
    updateScrollHintState(activeSection, null, null, recordsConfig);
  }
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


// ─── Match render helpers (moved from main.js) ──────────────────────────────
const LOW_TIME_THRESHOLD = 10;


function updateMatchTick() {
  const st = matchController.getState();
  if (!st) return;

  const stratTotal = st.strategySeconds ?? DEFAULT_STRATEGY_SECONDS;
  const creationTotal = st.creationSeconds ?? DEFAULT_CREATION_SECONDS;

  const stratRunning =
    st.phase === "strategy-run" || st.phase === "strategy-paused" || st.phase === "strategy-timeup";
  const creationRunning =
    st.phase === "creation-run" ||
    st.phase === "creation-paused" ||
    st.phase === "creation-timeup" ||
    st.phase === "done";

  const stratRemaining = stratRunning ? st.remaining : stratTotal;
  const creationRemaining = creationRunning ? st.remaining : creationTotal;

  const strategyValueEl = document.getElementById("matchStrategyTimerValue");
  const creationValueEl = document.getElementById("matchCreationTimerValue");

  if (strategyValueEl) {
    strategyValueEl.textContent = st.phase === "strategy-timeup" ? t("matchTimeUp") : formatSeconds(stratRemaining);
  }
  if (creationValueEl) {
    creationValueEl.textContent =
      st.phase === "creation-timeup" ? t("matchTimeUp") : formatSeconds(creationRemaining);
  }

  const strategyCard = document.getElementById("matchStrategyTimerCard");
  const creationCard = document.getElementById("matchCreationTimerCard");

  if (strategyCard) {
    strategyCard.classList.toggle(
      "time-pressure",
      st.phase === "strategy-run" && st.remaining <= LOW_TIME_THRESHOLD && st.remaining > 5
    );
    strategyCard.classList.toggle(
      "time-pressure-urgent",
      st.phase === "strategy-run" && st.remaining <= 5
    );
    strategyCard.classList.toggle("timeup", st.phase === "strategy-timeup");
  }
  if (creationCard) {
    creationCard.classList.toggle(
      "time-pressure",
      st.phase === "creation-run" && st.remaining <= LOW_TIME_THRESHOLD && st.remaining > 5
    );
    creationCard.classList.toggle(
      "time-pressure-urgent",
      st.phase === "creation-run" && st.remaining <= 5
    );
    creationCard.classList.toggle("timeup", st.phase === "creation-timeup");
  }
}
function updateActionOverlayState(container, scrollEl) {
  if (!container || !scrollEl) return;
  const hasScroll = scrollEl.scrollHeight > scrollEl.clientHeight + 1;
  const atBottom =
    scrollEl.scrollTop >= scrollEl.scrollHeight - scrollEl.clientHeight - 1;
  const hasBelow = hasScroll && !atBottom;
  container.classList.toggle("has-scroll", hasScroll);
  container.classList.toggle("has-scroll-below", hasBelow);
  updateScrollHintState(scrollEl, hasScroll, hasBelow);
}

function updateScrollHintState(scrollEl, hasScroll = null, hasBelow = null, containerOverride = null) {
  if (!scrollEl) return;
  const computedHasScroll =
    hasScroll ?? scrollEl.scrollHeight > scrollEl.clientHeight + 1;
  const computedHasBelow =
    hasBelow ??
    (computedHasScroll &&
      scrollEl.scrollTop < scrollEl.scrollHeight - scrollEl.clientHeight - 1);
  const computedHasAbove = computedHasScroll && scrollEl.scrollTop > 1;
  const container = containerOverride || scrollEl.closest(".match-config");
  if (!container) return;
  container.classList.toggle("has-scroll", computedHasScroll);
  container.classList.toggle("has-scroll-below", computedHasBelow);
  container.classList.toggle("has-scroll-above", computedHasAbove);
}

function scrollByClamped(scrollEl, { top = 0, left = 0 } = {}) {
  if (!scrollEl) return;
  const maxTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
  const maxLeft = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth);
  const nextTop = Math.min(maxTop, Math.max(0, scrollEl.scrollTop + top));
  const nextLeft = Math.min(maxLeft, Math.max(0, scrollEl.scrollLeft + left));
  scrollEl.scrollTo({
    top: nextTop,
    left: nextLeft,
    behavior: "smooth",
  });
}

// → ui/match/scoreboard.js (updateScoreboardActionPadding)

function updateActionOverlayStates() {
  const matchConfigBlock = document.getElementById("matchConfigBlock");
  const matchConfigScroll = matchConfigBlock?.querySelector(".match-config-scroll");
  updateActionOverlayState(matchConfigBlock, matchConfigScroll);

  const roundEndConfig = document.querySelector(".round-end-config");
  const roundEndScroll = roundEndConfig?.querySelector(".round-end-content");
  updateActionOverlayState(roundEndConfig, roundEndScroll);

  document.querySelectorAll(".match-config-scroll").forEach((scrollEl) => {
    if (scrollEl.classList.contains("scoreboard-scroll")) return;
    updateScrollHintState(scrollEl);
  });

  const scoreboardWrap = document.getElementById("scoreboardTableWrap");
  if (scoreboardWrap) {
    const scoreboardShell = document.getElementById("scoreboardTableShell");
    const hintOverlay = document.getElementById("scoreboardHints");
    updateScoreboardHintBounds();
    updateScoreboardActionPadding();
    updateHorizontalScrollHintState(scoreboardWrap, hintOverlay || scoreboardShell);
    if (hintOverlay || scoreboardShell) {
      updateScrollHintState(scoreboardWrap, null, null, hintOverlay || scoreboardShell);
    }
    const config = scoreboardWrap.closest(".scoreboard-config");
    if (config) updateScrollHintState(scoreboardWrap, null, null, config);
  }
}

function setupActionOverlayListeners() {
  const pairs = [
    {
      container: document.getElementById("matchConfigBlock"),
      scrollEl: document.querySelector("#matchConfigBlock .match-config-scroll"),
    },
    {
      container: document.querySelector(".round-end-config"),
      scrollEl: document.querySelector(".round-end-config .round-end-content"),
    },
  ];

  pairs.forEach(({ container, scrollEl }) => {
    if (!container || !scrollEl) return;
    if (scrollEl.dataset.overlayListener === "1") return;
    const onUpdate = () => updateActionOverlayState(container, scrollEl);
    scrollEl.addEventListener("scroll", onUpdate);
    scrollEl.dataset.overlayListener = "1";
    onUpdate();
  });

  document.querySelectorAll(".match-config-scroll").forEach((scrollEl) => {
    if (scrollEl.classList.contains("scoreboard-scroll")) return;
    if (!scrollEl || scrollEl.dataset.scrollHintListener === "1") return;
    const onUpdate = () => updateScrollHintState(scrollEl);
    scrollEl.addEventListener("scroll", onUpdate);
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => updateScrollHintState(scrollEl));
      observer.observe(scrollEl);
      scrollEl._scrollHintObserver = observer;
    }
    if (window.MutationObserver) {
      const mutationObserver = new MutationObserver(() =>
        updateScrollHintState(scrollEl)
      );
      mutationObserver.observe(scrollEl, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      scrollEl._scrollHintMutationObserver = mutationObserver;
    }
    const container = scrollEl.closest(".match-config");
    const chevronDown = container?.querySelector(".scroll-hint-down");
    if (chevronDown) {
      chevronDown.addEventListener("click", () => {
        const step = Math.max(60, Math.round(scrollEl.clientHeight * 0.6));
        scrollByClamped(scrollEl, { top: step });
      });
    }
    const chevronUp = container?.querySelector(".scroll-hint-up");
    if (chevronUp) {
      chevronUp.addEventListener("click", () => {
        const step = Math.max(60, Math.round(scrollEl.clientHeight * 0.6));
        scrollByClamped(scrollEl, { top: -step });
      });
    }
    scrollEl.dataset.scrollHintListener = "1";
    onUpdate();
    requestAnimationFrame(() => updateScrollHintState(scrollEl));
    setTimeout(() => updateScrollHintState(scrollEl), 250);
  });

  const recordsConfig = document.querySelector(".records-config");
  const recordsWordList = document.getElementById("recordsWordList");
  const recordsMatchList = document.getElementById("recordsMatchList");
  const recordsWordSection = recordsWordList?.closest(".records-section");
  const recordsMatchSection = recordsMatchList?.closest(".records-section");
  if (recordsConfig && !recordsConfig.dataset.recordsScrollHints) {
    const getActiveList = () => {
      if (recordsMatchSection && !recordsMatchSection.classList.contains("hidden")) {
        return recordsMatchSection;
      }
      if (recordsWordSection && !recordsWordSection.classList.contains("hidden")) {
        return recordsWordSection;
      }
      return recordsWordSection || recordsMatchSection || null;
    };
    const onUpdate = () => {
      const active = getActiveList();
      if (!active) return;
      updateScrollHintState(active, null, null, recordsConfig);
    };
    [recordsWordSection, recordsMatchSection].forEach((section) => {
      if (!section) return;
      section.addEventListener("scroll", onUpdate);
      if (window.ResizeObserver) {
        const observer = new ResizeObserver(onUpdate);
        observer.observe(section);
        section._scrollHintObserver = observer;
      }
      if (window.MutationObserver) {
        const mutationObserver = new MutationObserver(onUpdate);
        mutationObserver.observe(section, {
          childList: true,
          subtree: true,
          attributes: true,
        });
        section._scrollHintMutationObserver = mutationObserver;
      }
    });
    const downChevron = recordsConfig.querySelector(".scroll-hint-down");
    if (downChevron) {
      downChevron.addEventListener("click", () => {
        const active = getActiveList();
        if (!active) return;
        const step = Math.max(60, Math.round(active.clientHeight * 0.6));
        scrollByClamped(active, { top: step });
      });
    }
    const upChevron = recordsConfig.querySelector(".scroll-hint-up");
    if (upChevron) {
      upChevron.addEventListener("click", () => {
        const active = getActiveList();
        if (!active) return;
        const step = Math.max(60, Math.round(active.clientHeight * 0.6));
        scrollByClamped(active, { top: -step });
      });
    }
    recordsConfig.dataset.recordsScrollHints = "1";
    requestAnimationFrame(onUpdate);
    setTimeout(onUpdate, 250);
  }

  const quickGuideConfig = document.querySelector(".quick-guide-config");
  const quickGuideScroll = document.getElementById("quickGuideScroll");
  if (quickGuideConfig && quickGuideScroll && !quickGuideConfig.dataset.quickGuideScrollHints) {
    const onUpdate = () => updateScrollHintState(quickGuideScroll, null, null, quickGuideConfig);
    quickGuideScroll.addEventListener("scroll", onUpdate);
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(onUpdate);
      observer.observe(quickGuideScroll);
      quickGuideScroll._scrollHintObserver = observer;
    }
    if (window.MutationObserver) {
      const mutationObserver = new MutationObserver(onUpdate);
      mutationObserver.observe(quickGuideScroll, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      quickGuideScroll._scrollHintMutationObserver = mutationObserver;
    }
    const downChevron = quickGuideConfig.querySelector(".scroll-hint-down");
    if (downChevron) {
      downChevron.addEventListener("click", () => {
        const step = Math.max(60, Math.round(quickGuideScroll.clientHeight * 0.6));
        scrollByClamped(quickGuideScroll, { top: step });
      });
    }
    const upChevron = quickGuideConfig.querySelector(".scroll-hint-up");
    if (upChevron) {
      upChevron.addEventListener("click", () => {
        const step = Math.max(60, Math.round(quickGuideScroll.clientHeight * 0.6));
        scrollByClamped(quickGuideScroll, { top: -step });
      });
    }
    quickGuideConfig.dataset.quickGuideScrollHints = "1";
    requestAnimationFrame(onUpdate);
    setTimeout(onUpdate, 250);
  }

  const tableWrap = document.getElementById("scoreboardTableWrap");
  const tableShell = document.getElementById("scoreboardTableShell");
  const tableHeader = document.getElementById("scoreboardTableHeader");
  const tableLeft = document.getElementById("scoreboardTableLeft");
  const tableLeftCol = document.getElementById("scoreboardTableLeftCol");
  const hintOverlay = document.getElementById("scoreboardHints");
  if (tableWrap && tableWrap.dataset.scrollHintX !== "1") {
    const updateXY = () => {
      if (tableHeader) tableHeader.scrollLeft = tableWrap.scrollLeft;
      if (tableLeftCol) tableLeftCol.style.transform = "";
      if (tableLeft) tableLeft.scrollTop = tableWrap.scrollTop;
      updateScoreboardHintBounds();
      updateHorizontalScrollHintState(tableWrap, hintOverlay || tableShell);
      if (hintOverlay || tableShell) {
        updateScrollHintState(tableWrap, null, null, hintOverlay || tableShell);
      }
      const config = tableWrap.closest(".scoreboard-config");
      if (config) {
        updateScrollHintState(tableWrap, null, null, config);
      }
    };
    tableWrap.addEventListener("scroll", updateXY);
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(updateXY);
      observer.observe(tableWrap);
      tableWrap._scrollHintXObserver = observer;
    }
    tableWrap.dataset.scrollHintX = "1";
    updateXY();
    const hintHost = hintOverlay || tableShell || tableWrap;
    const downChevron = hintHost.querySelector(".scroll-hint-down");
    if (downChevron) {
      downChevron.addEventListener("click", () => {
        const step = Math.max(60, Math.round(tableWrap.clientHeight * 0.6));
        scrollByClamped(tableWrap, { top: step });
      });
    }
    const upChevron = hintHost.querySelector(".scroll-hint-up");
    if (upChevron) {
      upChevron.addEventListener("click", () => {
        const step = Math.max(60, Math.round(tableWrap.clientHeight * 0.6));
        scrollByClamped(tableWrap, { top: -step });
      });
    }
    const leftChevron = hintHost.querySelector(".scroll-hint-left");
    if (leftChevron) {
      leftChevron.addEventListener("click", () => {
        const step = Math.max(60, Math.round(tableWrap.clientWidth * 0.6));
        scrollByClamped(tableWrap, { left: -step });
      });
    }
    const rightChevron = hintHost.querySelector(".scroll-hint-right");
    if (rightChevron) {
      rightChevron.addEventListener("click", () => {
        const step = Math.max(60, Math.round(tableWrap.clientWidth * 0.6));
        scrollByClamped(tableWrap, { left: step });
      });
    }
  }

  if (tableWrap && tableLeft && tableLeft.dataset.scrollProxy !== "1") {
    const onWheel = (e) => {
      if (!tableWrap) return;
      e.preventDefault();
      if (Math.abs(e.deltaX) > 0) {
        scrollByClamped(tableWrap, { left: e.deltaX });
      }
      if (Math.abs(e.deltaY) > 0) {
        scrollByClamped(tableWrap, { top: e.deltaY });
      }
    };
    let touchStartY = null;
    let touchStartX = null;
    const onTouchStart = (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      touchStartY = e.touches[0].clientY;
      touchStartX = e.touches[0].clientX;
    };
    const onTouchMove = (e) => {
      if ((touchStartY == null && touchStartX == null) || !e.touches || e.touches.length !== 1) return;
      const currentY = e.touches[0].clientY;
      const currentX = e.touches[0].clientX;
      const deltaY = touchStartY == null ? 0 : touchStartY - currentY;
      const deltaX = touchStartX == null ? 0 : touchStartX - currentX;
      touchStartY = currentY;
      touchStartX = currentX;
      e.preventDefault();
      if (Math.abs(deltaX) > 0) {
        scrollByClamped(tableWrap, { left: deltaX });
      }
      if (Math.abs(deltaY) > 0) {
        scrollByClamped(tableWrap, { top: deltaY });
      }
    };
    const onTouchEnd = () => {
      touchStartY = null;
      touchStartX = null;
    };
    tableLeft.addEventListener("wheel", onWheel, { passive: false });
    tableLeft.addEventListener("touchstart", onTouchStart, { passive: true });
    tableLeft.addEventListener("touchmove", onTouchMove, { passive: false });
    tableLeft.addEventListener("touchend", onTouchEnd, { passive: true });
    tableLeft.addEventListener("touchcancel", onTouchEnd, { passive: true });
    tableLeft.dataset.scrollProxy = "1";
  }

  if (tableWrap && tableHeader && tableHeader.dataset.scrollProxyX !== "1") {
    const onWheelX = (e) => {
      if (!tableWrap) return;
      e.preventDefault();
      if (Math.abs(e.deltaX) > 0) {
        scrollByClamped(tableWrap, { left: e.deltaX });
      }
      if (Math.abs(e.deltaY) > 0) {
        scrollByClamped(tableWrap, { top: e.deltaY });
      }
    };
    let touchStartX = null;
    let touchStartY = null;
    const onTouchStartX = (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    };
    const onTouchMoveX = (e) => {
      if ((touchStartX == null && touchStartY == null) || !e.touches || e.touches.length !== 1) return;
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const deltaX = touchStartX == null ? 0 : touchStartX - currentX;
      const deltaY = touchStartY == null ? 0 : touchStartY - currentY;
      touchStartX = currentX;
      touchStartY = currentY;
      e.preventDefault();
      if (Math.abs(deltaX) > 0) {
        scrollByClamped(tableWrap, { left: deltaX });
      }
      if (Math.abs(deltaY) > 0) {
        scrollByClamped(tableWrap, { top: deltaY });
      }
    };
    const onTouchEndX = () => {
      touchStartX = null;
      touchStartY = null;
    };
    tableHeader.addEventListener("wheel", onWheelX, { passive: false });
    tableHeader.addEventListener("touchstart", onTouchStartX, { passive: true });
    tableHeader.addEventListener("touchmove", onTouchMoveX, { passive: false });
    tableHeader.addEventListener("touchend", onTouchEndX, { passive: true });
    tableHeader.addEventListener("touchcancel", onTouchEndX, { passive: true });
    tableHeader.dataset.scrollProxyX = "1";
  }

  const tableCorner = document.getElementById("scoreboardTableCorner");
  if (tableWrap && tableCorner && tableCorner.dataset.scrollProxyCorner !== "1") {
    const onWheelCorner = (e) => {
      if (!tableWrap) return;
      e.preventDefault();
      if (Math.abs(e.deltaX) > 0) {
        scrollByClamped(tableWrap, { left: e.deltaX });
      }
      if (Math.abs(e.deltaY) > 0) {
        scrollByClamped(tableWrap, { top: e.deltaY });
      }
    };
    let touchStartX = null;
    let touchStartY = null;
    const onTouchStartCorner = (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    };
    const onTouchMoveCorner = (e) => {
      if ((touchStartX == null && touchStartY == null) || !e.touches || e.touches.length !== 1) return;
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const deltaX = touchStartX == null ? 0 : touchStartX - currentX;
      const deltaY = touchStartY == null ? 0 : touchStartY - currentY;
      touchStartX = currentX;
      touchStartY = currentY;
      e.preventDefault();
      if (Math.abs(deltaX) > 0) {
        scrollByClamped(tableWrap, { left: deltaX });
      }
      if (Math.abs(deltaY) > 0) {
        scrollByClamped(tableWrap, { top: deltaY });
      }
    };
    const onTouchEndCorner = () => {
      touchStartX = null;
      touchStartY = null;
    };
    tableCorner.addEventListener("wheel", onWheelCorner, { passive: false });
    tableCorner.addEventListener("touchstart", onTouchStartCorner, { passive: true });
    tableCorner.addEventListener("touchmove", onTouchMoveCorner, { passive: false });
    tableCorner.addEventListener("touchend", onTouchEndCorner, { passive: true });
    tableCorner.addEventListener("touchcancel", onTouchEndCorner, { passive: true });
    tableCorner.dataset.scrollProxyCorner = "1";
  }

  const onResize = () => updateActionOverlayStates();
  window.addEventListener("resize", onResize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onResize);
  }
}
function updateHorizontalScrollHintState(scrollEl, stateEl) {
  if (!scrollEl) return;
  const target = stateEl || scrollEl;
  const hasScroll = scrollEl.scrollWidth > scrollEl.clientWidth + 1;
  const atStart = scrollEl.scrollLeft <= 1;
  const atEnd =
    scrollEl.scrollLeft >= scrollEl.scrollWidth - scrollEl.clientWidth - 1;
  target.classList.toggle("has-scroll-left", hasScroll && !atStart);
  target.classList.toggle("has-scroll-right", hasScroll && !atEnd);
}

// ─── Match state render (moved from main.js) ────────────────────────────────

function formatPhaseDuration(val) {
  const v = Math.max(0, Math.round(val));
  const minutes = Math.floor(v / 60);
  const seconds = v % 60;
  if (minutes === 0) {
    return `${seconds}${t("matchSecondAbbrev")}`;
  }
  if (seconds === 0) {
    return `${minutes}${t("matchMinuteAbbrev")}`;
  }
  return `${minutes}${t("matchMinuteAbbrev")} ${seconds}${t("matchSecondAbbrev")}`;
}

function formatPhaseDurationFull(val) {
  const v = Math.max(0, Math.round(val));
  const minutes = Math.floor(v / 60);
  const seconds = v % 60;
  return `${minutes}${t("matchMinuteAbbrev")} ${seconds}${t("matchSecondAbbrev")}`;
}

// parseHexColor, toHex, getDealerPalette, darkenHexColor → ui/utils.js

// → ui/match/scoreboard.js (cloneScoreboardValues, buildScoreboardData)

// → ui/match/scoreboard.js (getScoreboardTotals, getScoreboardRoundMax, getScoreboardOverallMax, updateScoreboardDirty, updateScoreboardIndicators)

// → ui/match/scoreboard.js (renderScoreboardScreen)


function setTimerButtonIcon(btn, iconClass) {
  if (!btn) return;
  const iconEl = btn.querySelector(".icon-btn-img");
  if (!iconEl) return;
  iconEl.classList.remove("icon-play", "icon-pause");
  iconEl.classList.add(iconClass);
}

function applyPhaseValue(el, totalSeconds) {
  if (!el) return;
  const minutes = Math.floor(Math.max(0, Math.round(totalSeconds)) / 60);
  const seconds = Math.max(0, Math.round(totalSeconds)) % 60;
  const hasBoth = minutes > 0 && seconds > 0;
  el.textContent = formatPhaseDuration(totalSeconds);
  el.classList.toggle("match-value-text-reduced", hasBoth);
}

function renderMatchFromStateInner(matchState) {
  const strategyVal = document.getElementById("matchStrategyValue");
  const creationVal = document.getElementById("matchCreationValue");
  const playersVal = document.getElementById("matchPlayersValue");
  const topbarTitle = document.getElementById("matchConfigTitle");
  const phaseIndicator = document.getElementById("matchPhaseIndicator");
  const phaseSwitchEl = document.getElementById("matchPhaseSwitch");
  const phaseStrategyBtn = document.getElementById("matchPhaseStrategyBtn");
  const phaseCreationBtn = document.getElementById("matchPhaseCreationBtn");
  const dealerNameEl = document.getElementById("matchDealerName");
  const dealerPill = document.getElementById("matchDealerPill");
  const modeRoundsBtn = document.getElementById("matchModeRoundsBtn");
  const modePointsBtn = document.getElementById("matchModePointsBtn");
  const modeSwitch = document.querySelector(".match-mode-switch");
  const roundsRow = document.getElementById("matchRoundsRow");
  const pointsRow = document.getElementById("matchPointsRow");
  const roundsVal = document.getElementById("matchRoundsValue");
  const pointsVal = document.getElementById("matchPointsValue");
  const scoringToggle = document.getElementById("matchScoringToggle");
  const scoringCaption = document.getElementById("matchScoringCaption");
  const recordValidationToggle = document.getElementById("matchRecordValidationToggle");
  const recordValidationCaption = document.getElementById("matchRecordValidationCaption");
  const modeCaption = document.getElementById("matchModeCaption");
  const summaryBlock = document.getElementById("matchConfigSummary");
  const summaryCaption = document.getElementById("matchSummaryCaption");
  const summaryDetails = document.getElementById("matchSummaryDetails");
  const modeBlock = document.getElementById("matchModeBlock");
  const advancedBlock = document.getElementById("matchConfigCustomize");
  const scoreboardOpenBtn = document.getElementById("matchScoreboardOpenBtn");
  const stratTotal = matchState.strategySeconds ?? DEFAULT_STRATEGY_SECONDS;
  const creationTotal = matchState.creationSeconds ?? DEFAULT_CREATION_SECONDS;

    if (matchState.phase !== lastMatchPhase) {
      if (matchState.phase === "strategy-ready") {
        showRoundIntro(matchState);
        triggerDealerFocus(matchState);
      }
      lastMatchPhase = matchState.phase;
    }

  if (matchState.phase !== "config") {
    _shell.matchConfigCustomizeOpen.value = false;
  }
  const showSummary = matchState.phase === "config" && !_shell.matchConfigCustomizeOpen.value;
  if (summaryBlock) summaryBlock.classList.toggle("hidden", !showSummary);
  if (modeBlock) modeBlock.classList.toggle("hidden", !_shell.matchConfigCustomizeOpen.value);
  if (advancedBlock) advancedBlock.classList.toggle("hidden", !_shell.matchConfigCustomizeOpen.value);
  applyPhaseValue(strategyVal, stratTotal);
  applyPhaseValue(creationVal, creationTotal);
  if (playersVal)
    playersVal.textContent =
      _shell.tempMatchPrefs.value.playersCount ?? matchState.players?.length ?? DEFAULT_PLAYER_COUNT;
  if (dealerNameEl || dealerPill) {
    const dealerInfo = getDealerInfo(matchState);
    if (dealerNameEl) {
      dealerNameEl.textContent = dealerInfo.name;
    }
    if (dealerPill) {
      const palette = getDealerPalette(dealerInfo.color);
      dealerPill.style.setProperty("--dealer-bg", palette.bg);
      dealerPill.style.setProperty("--dealer-border", palette.border);
      dealerPill.style.setProperty("--dealer-text", palette.text);
    }
  }

  if (modeRoundsBtn && modePointsBtn) {
    const isPoints = matchState.mode === MATCH_MODE_POINTS;
    modeRoundsBtn.classList.toggle("active", !isPoints);
    modePointsBtn.classList.toggle("active", isPoints);
    if (modeSwitch) {
      modeSwitch.classList.toggle("is-points", isPoints);
    }
  }
  if (roundsRow) roundsRow.classList.toggle("hidden", matchState.mode === MATCH_MODE_POINTS);
  if (pointsRow) pointsRow.classList.toggle("hidden", matchState.mode !== MATCH_MODE_POINTS);
  if (roundsVal) roundsVal.textContent = matchState.roundsTarget ?? DEFAULT_ROUNDS_TARGET;
  if (pointsVal) pointsVal.textContent = matchState.pointsTarget ?? DEFAULT_POINTS_TARGET;
  updateMatchConfigStepControls(matchState);
  if (scoringToggle) {
    scoringToggle.textContent = "";
    scoringToggle.classList.toggle("active", matchState.scoringEnabled);
    scoringToggle.setAttribute("aria-pressed", matchState.scoringEnabled ? "true" : "false");
  }
  if (scoringCaption) {
    _shell.setI18n(
      scoringCaption,
      matchState.scoringEnabled ? "matchScoringCaptionOn" : "matchScoringCaptionOff"
    );
  }
  if (recordValidationToggle) {
    const rawEnabled = matchState.validateRecordWords !== false;
    const disabled = !matchState.scoringEnabled;
    const enabled = !disabled && rawEnabled;
    recordValidationToggle.textContent = "";
    recordValidationToggle.classList.toggle("active", enabled);
    recordValidationToggle.setAttribute("aria-pressed", enabled ? "true" : "false");
    recordValidationToggle.disabled = disabled;
    recordValidationToggle.classList.toggle("is-disabled", disabled);
  }
  if (recordValidationCaption) {
    if (!matchState.scoringEnabled) {
      _shell.setI18n(recordValidationCaption, "matchRecordValidationCaptionOff");
    } else if (matchState.validateRecordWords !== false) {
      _shell.setI18n(recordValidationCaption, "matchRecordValidationCaptionOn");
    } else {
      _shell.setI18n(recordValidationCaption, "matchRecordValidationCaptionDisabled");
    }
  }
  if (modeCaption) {
    if (matchState.mode === MATCH_MODE_POINTS) {
      const pointsTarget = matchState.pointsTarget ?? DEFAULT_POINTS_TARGET;
      _shell.setI18n(modeCaption, "matchWinnerByPoints", {
        vars: { points: pointsTarget },
      });
    } else {
      const roundsTarget = matchState.roundsTarget ?? DEFAULT_ROUNDS_TARGET;
      _shell.setI18n(modeCaption, "matchWinnerByRounds", {
        vars: { rounds: roundsTarget },
      });
    }
  }
  if (summaryCaption) {
    if (matchState.mode === MATCH_MODE_POINTS) {
      const pointsTarget = matchState.pointsTarget ?? DEFAULT_POINTS_TARGET;
      _shell.setI18n(summaryCaption, "matchWinnerByPoints", {
        vars: { points: pointsTarget },
      });
    } else {
      const roundsTarget = matchState.roundsTarget ?? DEFAULT_ROUNDS_TARGET;
      _shell.setI18n(summaryCaption, "matchWinnerByRounds", {
        vars: { rounds: roundsTarget },
      });
    }
  }
  if (summaryDetails) {
    const scoringKey = matchState.scoringEnabled
      ? "matchConfigSummaryScoringOn"
      : "matchConfigSummaryScoringOff";
    const template = t("matchConfigSummaryDetails") || "";
    const strategy = formatPhaseDuration(stratTotal);
    const creation = formatPhaseDuration(creationTotal);
    const scoring = t(scoringKey);
    const resolved = template
      .replace("{strategy}", strategy)
      .replace("{creation}", creation)
      .replace("{scoring}", scoring);
    const parts = resolved.split("·").map((part) => part.trim()).filter(Boolean);
    summaryDetails.innerHTML = parts
      .map((part) => `<span class="match-summary-item">${escapeHtml(part)}</span>`)
      .join(" ");
    updateSummarySeparators(summaryDetails);
  }

  if (topbarTitle) {
    if (matchState.phase === "config") {
      _shell.setI18n(topbarTitle, "matchConfigTitle");
    } else if (matchState.tieBreak?.players?.length) {
      const tieIndex = matchState.tieBreak.index || 1;
      _shell.setI18n(topbarTitle, "matchTieBreakTitle", { vars: { index: tieIndex } });
    } else {
      delete topbarTitle.dataset.i18n;
      delete topbarTitle.dataset.i18nAttr;
      const roundTemplate = t("matchRound");
      const roundText =
        typeof roundTemplate === "string"
          ? roundTemplate.replace("{round}", matchState.round)
          : `Round ${matchState.round}`;
      topbarTitle.textContent = roundText;
      if (matchState.mode === MATCH_MODE_ROUNDS) {
        const totalRounds = matchState.roundsTarget ?? DEFAULT_ROUNDS_TARGET;
        const totalEl = document.createElement("span");
        totalEl.className = "match-round-total";
        totalEl.textContent = `/${totalRounds}`;
        topbarTitle.appendChild(totalEl);
      }
    }
    if (matchState.phase !== "config") {
      renderLanguageBadge(topbarTitle, getMatchLanguage(matchState));
    }
  }

  const roundLabel = document.getElementById("matchRoundLabel");
  if (roundLabel) {
    roundLabel.textContent = "";
    roundLabel.classList.add("hidden");
  }

  renderMatchScoreboard(matchState);
  if (scoreboardOpenBtn) {
    scoreboardOpenBtn.classList.toggle("hidden", !matchState.scoringEnabled);
  }

  if (matchState.phase === "config") {
    renderMatchPlayers();
  }

  const stratRemaining =
    matchState.phase === "strategy-run" ||
    matchState.phase === "strategy-paused" ||
    matchState.phase === "strategy-timeup"
      ? matchState.remaining
      : stratTotal;
  const creationRemaining =
    matchState.phase === "creation-run" ||
    matchState.phase === "creation-paused" ||
    matchState.phase === "creation-timeup" ||
    matchState.phase === "done"
      ? matchState.remaining
      : creationTotal;

  const strategyValueEl = document.getElementById("matchStrategyTimerValue");
  const creationValueEl = document.getElementById("matchCreationTimerValue");
  const strategyTimeup = matchState.phase === "strategy-timeup";
  const creationTimeup = matchState.phase === "creation-timeup";
  const strategyCard = document.getElementById("matchStrategyTimerCard");
  const creationCard = document.getElementById("matchCreationTimerCard");

  if (strategyValueEl) {
    strategyValueEl.textContent = strategyTimeup ? t("matchTimeUp") : formatSeconds(stratRemaining);
    strategyValueEl.classList.toggle("timeup", strategyTimeup);
  } else {
    setText(
      "matchStrategyTimerValue",
      strategyTimeup ? t("matchTimeUp") : formatSeconds(stratRemaining)
    );
  }
  if (creationValueEl) {
    creationValueEl.textContent = creationTimeup ? t("matchTimeUp") : formatSeconds(creationRemaining);
    creationValueEl.classList.toggle("timeup", creationTimeup);
  } else {
    setText(
      "matchCreationTimerValue",
      creationTimeup ? t("matchTimeUp") : formatSeconds(creationRemaining)
    );
  }

  const roundCard = document.getElementById("matchRoundCard");
  const configBlock = document.getElementById("matchConfigBlock");
  const matchBackBtn = document.getElementById("matchBackBtn");
  const matchExitBtn = document.getElementById("matchExitBtn");
  const startMatchBtn = document.getElementById("matchStartMatchBtn");
  const stratBtn = document.getElementById("matchStartStrategyBtn");
  const creatBtn = document.getElementById("matchStartCreationBtn");
  const stratFinishBtn = document.getElementById("matchStrategyFinishBtn");
  const creatFinishBtn = document.getElementById("matchCreationFinishBtn");
  const stratResetBtn = document.getElementById("matchStrategyResetBtn");
  const creatResetBtn = document.getElementById("matchCreationResetBtn");
  const nextRoundBtn = document.getElementById("matchNextRoundBtn");
  const roundActions = roundCard?.querySelector(".match-actions");
  const strategySection = document.getElementById("matchStrategyTimerSection");
  const creationSection = document.getElementById("matchCreationTimerSection");
  const strategyActions = document.getElementById("matchStrategyTimerActions");
  const creationActions = document.getElementById("matchCreationTimerActions");
  const roundCardContainer = document.getElementById("matchRoundCard");
  const creationTimeupCta = document.getElementById("matchCreationTimeupCta");
  const creationTimeupCtaBtn = document.getElementById("matchStartCreationCtaBtn");

  const showConfig = matchState.phase === "config";
  const isCreationPhase =
    matchState.phase.startsWith("creation") || matchState.phase === "done";
  if (phaseIndicator) {
    phaseIndicator.classList.toggle("hidden", showConfig);
  }
  if (phaseSwitchEl) {
    phaseSwitchEl.classList.toggle("is-creation", isCreationPhase);
  }
  if (phaseStrategyBtn) {
    phaseStrategyBtn.classList.toggle("active", !isCreationPhase);
  }
  if (phaseCreationBtn) {
    phaseCreationBtn.classList.toggle("active", isCreationPhase);
  }
  const showStrategyTimers = ["strategy-ready", "strategy-run", "strategy-paused", "strategy-timeup"].includes(
    matchState.phase
  );
  const showCreationTimers = ["creation-ready", "creation-run", "creation-paused", "creation-timeup"].includes(
    matchState.phase
  );
  const showValidation = matchState.phase === "creation-timeup" || matchState.phase === "done";

  if (matchState.phase === "creation-timeup") {
    _shell.scheduleCreationTimeupAutoAdvance();
  } else {
    _shell.clearCreationTimeupAutoAdvance(true);
  }

  if (roundCard) roundCard.classList.toggle("hidden", showConfig);
  if (configBlock) configBlock.classList.toggle("hidden", !showConfig);
  if (matchBackBtn) matchBackBtn.classList.toggle("hidden", !showConfig);
  if (matchExitBtn) matchExitBtn.classList.toggle("hidden", showConfig);
  if (strategyCard) {
    strategyCard.classList.toggle("hidden", !showStrategyTimers);
    strategyCard.classList.toggle(
      "time-pressure",
      matchState.phase === "strategy-run" && matchState.remaining <= LOW_TIME_THRESHOLD
    );
    strategyCard.classList.toggle(
      "time-pressure-urgent",
      matchState.phase === "strategy-run" && matchState.remaining <= 5
    );
    strategyCard.classList.toggle("timeup", matchState.phase === "strategy-timeup");
  }
  if (strategySection) {
    strategySection.classList.toggle("hidden", !showStrategyTimers);
  }
  if (strategyActions) {
    strategyActions.classList.toggle("hidden", !showStrategyTimers);
  }
  if (creationCard) {
    creationCard.classList.toggle("hidden", !showCreationTimers);
    creationCard.classList.toggle(
      "time-pressure",
      matchState.phase === "creation-run" && matchState.remaining <= LOW_TIME_THRESHOLD
    );
    creationCard.classList.toggle(
      "time-pressure-urgent",
      matchState.phase === "creation-run" && matchState.remaining <= 5
    );
    creationCard.classList.toggle("timeup", matchState.phase === "creation-timeup");
  }
  if (creationSection) {
    creationSection.classList.toggle("hidden", !showCreationTimers);
  }
  if (creationActions) {
    creationActions.classList.toggle("hidden", !showCreationTimers);
  }
  if (startMatchBtn) updateMatchStartButtonState();

  if (stratBtn) {
    const phase = matchState.phase;
    if (phase === "strategy-ready") {
      stratBtn.disabled = false;
      setTimerButtonIcon(stratBtn, "icon-play");
      _shell.setI18nById("matchStartStrategyBtn", "matchStartStrategy", { attr: "aria-label" });
    } else if (phase === "strategy-run") {
      stratBtn.disabled = false;
      setTimerButtonIcon(stratBtn, "icon-pause");
      _shell.setI18nById("matchStartStrategyBtn", "matchPause", { attr: "aria-label" });
    } else if (phase === "strategy-paused") {
      stratBtn.disabled = false;
      setTimerButtonIcon(stratBtn, "icon-play");
      _shell.setI18nById("matchStartStrategyBtn", "matchResume", { attr: "aria-label" });
    } else if (phase === "strategy-timeup") {
      stratBtn.disabled = true;
      stratBtn.classList.add("hidden");
    } else {
      stratBtn.disabled = true;
    }
    if (phase !== "strategy-timeup") stratBtn.classList.remove("hidden");
  }
  if (stratFinishBtn) {
    const isTimeup = matchState.phase === "strategy-timeup";
    const enableFinish = ["strategy-run", "strategy-paused"].includes(matchState.phase);
    stratFinishBtn.classList.toggle("hidden", isTimeup);
    stratFinishBtn.disabled = !enableFinish;
  }
  if (stratResetBtn) {
    const enableReset = ["strategy-run", "strategy-paused", "strategy-ready"].includes(matchState.phase);
    stratResetBtn.disabled = !enableReset;
    stratResetBtn.classList.toggle("hidden", !enableReset);
    _shell.setI18nById("matchStrategyResetBtn", "matchStrategyReset", { attr: "aria-label" });
  }

  if (creatBtn) {
    const phase = matchState.phase;
    if (phase === "creation-ready") {
      creatBtn.disabled = false;
      setTimerButtonIcon(creatBtn, "icon-play");
      _shell.setI18nById("matchStartCreationBtn", "matchStartCreation", { attr: "aria-label" });
    } else if (phase === "creation-run") {
      creatBtn.disabled = false;
      setTimerButtonIcon(creatBtn, "icon-pause");
      _shell.setI18nById("matchStartCreationBtn", "matchPause", { attr: "aria-label" });
    } else if (phase === "creation-paused") {
      creatBtn.disabled = false;
      setTimerButtonIcon(creatBtn, "icon-play");
      _shell.setI18nById("matchStartCreationBtn", "matchResume", { attr: "aria-label" });
    } else if (phase === "strategy-timeup") {
      creatBtn.disabled = false;
      creatBtn.classList.remove("hidden");
      setTimerButtonIcon(creatBtn, "icon-play");
      _shell.setI18nById("matchStartCreationBtn", "matchStartCreation", { attr: "aria-label" });
    } else if (phase === "creation-timeup" || phase === "done") {
      creatBtn.disabled = true;
      setTimerButtonIcon(creatBtn, "icon-play");
      _shell.setI18nById("matchStartCreationBtn", "matchStartCreation", { attr: "aria-label" });
    } else {
      creatBtn.disabled = true;
    }
    creatBtn.classList.toggle("hidden", phase === "creation-timeup" || phase === "done");
  }
  if (creatResetBtn) {
    const enableReset = ["creation-run", "creation-paused", "creation-ready"].includes(matchState.phase);
    creatResetBtn.disabled = !enableReset;
    creatResetBtn.classList.toggle("hidden", !enableReset);
    _shell.setI18nById("matchCreationResetBtn", "matchCreationReset", { attr: "aria-label" });
  }
  if (creatFinishBtn) {
    const isTimeup = matchState.phase === "creation-timeup" || matchState.phase === "done";
    const enableFinish = ["creation-run", "creation-paused"].includes(matchState.phase);
    creatFinishBtn.classList.toggle("hidden", isTimeup);
    creatFinishBtn.disabled = !enableFinish;
  }
  if (nextRoundBtn) {
    const showNext = matchState.phase === "done" || matchState.phase === "creation-timeup";
    nextRoundBtn.disabled = !showNext;
    nextRoundBtn.classList.toggle("hidden", !showNext);
  }
  if (roundActions) {
    const showNext = matchState.phase === "done" || matchState.phase === "creation-timeup";
    roundActions.classList.toggle("hidden", !showNext);
  }

  if (creationTimeupCta && creationTimeupCtaBtn) {
    const showCta = strategyTimeup;
    creationTimeupCta.classList.toggle("hidden", !showCta);
    creationTimeupCtaBtn.disabled = !showCta;
    _shell.setI18nById("matchStartCreationCtaBtn", "matchStartCreationCTA");
  }

  const matchValidation = validationSections.get("match");
  if (matchValidation?.root) {
    const wasHidden = matchValidation.root.classList.contains("hidden");
    matchValidation.root.classList.toggle("hidden", !showValidation);
    if (showValidation && wasHidden) {
      clearMatchWordFor("match", false);
      clearStatusValidationFor("match");
    } else if (!showValidation) {
      clearMatchWordFor("match");
    }
  }

  if (configBlock) configBlock.classList.toggle("hidden", !showConfig);
  if (matchBackBtn) matchBackBtn.classList.toggle("hidden", !showConfig);
  if (matchExitBtn) matchExitBtn.classList.toggle("hidden", showConfig);

  updateActionOverlayStates();
  if (_shell.currentScreen() === "round-end") {
    renderRoundEndScreen();
  }
}

function showRoundIntro(matchState) {
  if (!matchState || matchState.phase === "config") return;
  const isTieBreak = !!matchState.tieBreak?.players?.length;
  const phase = String(matchState.phase || "");
  if (!isTieBreak && matchState.phase !== "strategy-ready") return;
  if (isTieBreak && matchState.phase !== "strategy-ready") return;
  const tieIndex = matchState.tieBreak?.index || 1;
  const roundKey = `${matchState.round}-${isTieBreak ? `tb${tieIndex}` : "round"}`;
  if (roundKey === lastRoundIntroKey) return;
  lastRoundIntroKey = roundKey;
  const intro = document.getElementById("roundIntro");
  const title = document.getElementById("roundIntroTitle");
  const dealer = document.getElementById("roundIntroDealer");
  if (!intro || !title || !dealer) return;
  if (roundIntroTimer) {
    clearTimeout(roundIntroTimer);
    roundIntroTimer = null;
  }
  if (isTieBreak) {
    const template = t("matchTieBreakTitle") || "Tie break {index}";
    title.textContent =
      typeof template === "string"
        ? template.replace("{index}", tieIndex)
        : `Tie break ${tieIndex}`;
  } else {
    const roundTemplate = t("matchRound");
    const roundText =
      typeof roundTemplate === "string"
        ? roundTemplate.replace("{round}", matchState.round)
        : `Round ${matchState.round}`;
    title.textContent = roundText;
  }
  const dealerInfo = getDealerInfo(matchState);
  dealer.textContent = `${t("matchDealerLabel")} ${dealerInfo.name}`;
  const palette = getDealerPalette(dealerInfo.color);
  dealer.style.setProperty("--dealer-bg", palette.bg);
  dealer.style.setProperty("--dealer-border", palette.border);
  dealer.style.setProperty("--dealer-text", palette.text);
  dealer.style.setProperty("--player-name-color", palette.text);
  intro.classList.remove("hidden");
  intro.classList.remove("show");
  void intro.offsetWidth;
  intro.classList.add("show");
  intro.setAttribute("aria-hidden", "false");
  roundIntroActive = true;
  pendingDealerFocusState = matchState.phase === "strategy-ready" ? matchState : null;
  _shell.playModalOpenSound();
  if (!intro._dismissRoundIntro) {
    intro.addEventListener("click", () => dismissRoundIntro());
    intro._dismissRoundIntro = true;
  }
  const durationMs = getRoundIntroDurationMs(intro);
  roundIntroTimer = setTimeout(() => {
    dismissRoundIntro();
  }, durationMs);
}

function finishRoundIntroDismiss(intro) {
  if (!intro) return;
  intro.classList.remove("show");
  intro.classList.remove("is-dismissing");
  intro.classList.add("hidden");
  intro.setAttribute("aria-hidden", "true");
  roundIntroActive = false;
  if (pendingDealerFocusState) {
    const st = pendingDealerFocusState;
    pendingDealerFocusState = null;
    triggerDealerFocus(st);
  }
}

function dismissRoundIntro({ animate = true } = {}) {
  if (roundIntroTimer) {
    clearTimeout(roundIntroTimer);
    roundIntroTimer = null;
  }
  const intro = document.getElementById("roundIntro");
  if (!intro) return;
  if (intro.classList.contains("is-dismissing")) return;
  if (!animate) {
    finishRoundIntroDismiss(intro);
    return;
  }
  intro.classList.add("is-dismissing");
  const inner = intro.querySelector(".round-intro-inner");
  if (inner) {
    inner.addEventListener(
      "animationend",
      () => finishRoundIntroDismiss(intro),
      { once: true }
    );
  } else {
    setTimeout(() => finishRoundIntroDismiss(intro), 350);
  }
}

function getRoundIntroDurationMs(introEl) {
  if (!introEl) return 2000;
  const raw = getComputedStyle(introEl).getPropertyValue("--round-intro-duration").trim();
  if (!raw) return 2000;
  const match = raw.match(/^(\d+(?:\.\d+)?)(ms|s)$/i);
  if (!match) return 2000;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 2000;
  return match[2].toLowerCase() === "s" ? value * 1000 : value;
}

function triggerDealerFocus(matchState) {
  if (!matchState || matchState.phase !== "strategy-ready") return;
  if (roundIntroActive) {
    pendingDealerFocusState = matchState;
    return;
  }
  const dealerPillEl = document.getElementById("matchDealerPill");
  if (!dealerPillEl) return;
  dealerPillEl.classList.remove("dealer-focus");
  void dealerPillEl.offsetWidth;
  dealerPillEl.classList.add("dealer-focus");
  if (dealerFocusTimer) {
    clearTimeout(dealerFocusTimer);
  }
  dealerFocusTimer = setTimeout(() => {
    dealerPillEl.classList.remove("dealer-focus");
    dealerFocusTimer = null;
  }, 2200);
}

function updateSummarySeparators(container) {
  if (!container) return;
  container.querySelectorAll(".match-summary-sep").forEach((el) => el.remove());
  const items = Array.from(container.querySelectorAll(".match-summary-item"));
  if (items.length < 2) return;
  const offsets = items.map((item) => item.offsetTop);
  for (let i = 1; i < items.length; i += 1) {
    if (offsets[i] !== offsets[i - 1]) continue;
    const sep = document.createElement("span");
    sep.className = "match-summary-sep";
    sep.textContent = "•";
    container.insertBefore(sep, items[i]);
  }
}

// ─── Player management (moved from main.js) ──────────────────────────────────

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Mac") && "ontouchend" in document);
}

function clampPlayerName(value) {
  return String(value || "").slice(0, PLAYER_NAME_MAX);
}

function buildMatchPrefs(src = {}) {
  const playersCount = src.playersCount ?? DEFAULT_PLAYER_COUNT;
  const mode = src.mode === MATCH_MODE_POINTS ? MATCH_MODE_POINTS : MATCH_MODE_ROUNDS;
  const roundsTarget =
    mode === MATCH_MODE_ROUNDS
      ? src.roundsTarget ?? getDefaultRoundsTarget(playersCount)
      : src.roundsTarget ?? DEFAULT_ROUNDS_TARGET;
  const playersLength =
    Array.isArray(src.players) && src.players.length ? src.players.length : null;
  return {
    playersCount: playersLength ?? playersCount,
    strategySeconds: src.strategySeconds ?? DEFAULT_STRATEGY_SECONDS,
    creationSeconds: src.creationSeconds ?? DEFAULT_CREATION_SECONDS,
    mode,
    roundsTarget,
    pointsTarget: src.pointsTarget ?? DEFAULT_POINTS_TARGET,
    scoringEnabled: src.scoringEnabled ?? true,
    validateRecordWords: src.validateRecordWords ?? true,
    language: src.language ? normalizeLanguage(src.language) : null,
  };
}

function getDefaultRoundsTarget(playersCount) {
  const count = Number.isFinite(playersCount) ? playersCount : DEFAULT_PLAYER_COUNT;
  return count < 4 ? count * 2 : count;
}

function getKnownPlayerNames() {
  const state = loadState();
  return state.settings?.knownPlayerNames || [];
}

function ensureUniquePlayerName(candidate, usedNames) {
  const baseRaw = clampPlayerName(String(candidate || "").trim());
  const base = baseRaw || "Player";
  let name = base;
  let index = 2;
  while (usedNames.has(normalizePlayerName(name))) {
    const suffix = ` ${index}`;
    const trimmedBase = base.slice(0, Math.max(1, PLAYER_NAME_MAX - suffix.length));
    name = `${trimmedBase}${suffix}`;
    index += 1;
  }
  usedNames.add(normalizePlayerName(name));
  return name;
}

function markPlayerSwap(fromIndex, toIndex) {
  lastPlayerSwap = {
    from: fromIndex,
    to: toIndex,
    at: Date.now(),
  };
}

function clearPlayerDropTargets(container) {
  container
    .querySelectorAll(".match-player-row.is-drop-target")
    .forEach((row) => row.classList.remove("is-drop-target"));
}

function createPlayerDragGhost(row, clientX, clientY) {
  if (!row) return;
  const rect = row.getBoundingClientRect();
  playerDragOffset = {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
  playerDragGhost = row.cloneNode(true);
  playerDragGhost.classList.remove("is-dragging", "is-drop-target");
  playerDragGhost.classList.add("match-player-ghost");
  playerDragGhost.style.width = `${rect.width}px`;
  playerDragGhost.style.height = `${rect.height}px`;
  playerDragGhost.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
  document.body.appendChild(playerDragGhost);
}

function updatePlayerDragGhost(clientX, clientY) {
  if (!playerDragGhost || !playerDragOffset) return;
  const x = clientX - playerDragOffset.x;
  const y = clientY - playerDragOffset.y;
  playerDragGhost.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

function removePlayerDragGhost() {
  if (playerDragGhost) {
    playerDragGhost.remove();
    playerDragGhost = null;
  }
  playerDragOffset = null;
}

function autoScrollMatchConfig(clientY) {
  const scrollEl = document.querySelector(".match-config-scroll");
  if (!scrollEl) return;
  const rect = scrollEl.getBoundingClientRect();
  const edge = 28;
  if (clientY < rect.top + edge) {
    scrollEl.scrollTop -= 10;
  } else if (clientY > rect.bottom - edge) {
    scrollEl.scrollTop += 10;
  }
}

function getPlayerPlaceholder(listEl) {
  let placeholder = listEl.querySelector(".match-player-placeholder");
  if (!placeholder) {
    placeholder = document.createElement("div");
    placeholder.className = "match-player-placeholder";
  }
  return placeholder;
}

function clearPlayerDropIndicator(listEl) {
  clearPlayerDropTargets(listEl);
  const placeholder = listEl.querySelector(".match-player-placeholder");
  if (placeholder) placeholder.remove();
}

function updatePlayerDropIndicator(listEl, row, clientY, target) {
  clearPlayerDropTargets(listEl);
  const placeholder = getPlayerPlaceholder(listEl);
  if (typeof clientY === "number") {
    autoScrollMatchConfig(clientY);
  }
  if (target && target.classList?.contains("match-player-placeholder")) {
    const nextRow = target.nextElementSibling;
    if (playerDragState) {
      const nextIndex = nextRow
        ? Number(nextRow.dataset.index)
        : listEl.querySelectorAll(".match-player-row").length;
      playerDragState.overIndex = nextIndex;
      if (
        playerDragState.moved &&
        playerDragState.lastHapticIndex !== nextIndex
      ) {
        playerDragState.lastHapticIndex = nextIndex;
        if (!isIOS()) {
          _shell.triggerHapticFeedback(1);
        }
      }
    }
    return;
  }
  if (!row || !listEl.contains(row)) {
    listEl.appendChild(placeholder);
    if (playerDragState) {
      const nextIndex = listEl.querySelectorAll(".match-player-row").length;
      playerDragState.overIndex = nextIndex;
      if (
        playerDragState.moved &&
        playerDragState.lastHapticIndex !== nextIndex
      ) {
        playerDragState.lastHapticIndex = nextIndex;
        if (!isIOS()) {
          _shell.triggerHapticFeedback(1);
        }
      }
    }
    return;
  }
  const rect = row.getBoundingClientRect();
  const insertAfter = typeof clientY === "number" && clientY > rect.top + rect.height / 2;
  row.classList.add("is-drop-target");
  if (insertAfter) {
    row.after(placeholder);
    if (playerDragState) {
      const nextIndex = Number(row.dataset.index) + 1;
      playerDragState.overIndex = nextIndex;
      if (
        playerDragState.moved &&
        playerDragState.lastHapticIndex !== nextIndex
      ) {
        playerDragState.lastHapticIndex = nextIndex;
        if (!isIOS()) {
          _shell.triggerHapticFeedback(1);
        }
      }
    }
  } else {
    row.before(placeholder);
    if (playerDragState) {
      const nextIndex = Number(row.dataset.index);
      playerDragState.overIndex = nextIndex;
      if (
        playerDragState.moved &&
        playerDragState.lastHapticIndex !== nextIndex
      ) {
        playerDragState.lastHapticIndex = nextIndex;
        if (!isIOS()) {
          _shell.triggerHapticFeedback(1);
        }
      }
    }
  }
}

function handlePlayerDragMove(clientX, clientY) {
  if (!playerDragState) return;
  const dx = Math.abs(clientX - playerDragState.startX);
  const dy = Math.abs(clientY - playerDragState.startY);
  if (!playerDragState.moved && dx + dy < 4) {
    return;
  }
  if (!playerDragState.moved) {
    playerDragState.moved = true;
    const { rowEl, listEl } = playerDragState;
    if (rowEl) {
      rowEl.classList.add("is-dragging");
      createPlayerDragGhost(rowEl, clientX, clientY);
      updatePlayerDropIndicator(listEl, rowEl, clientY, rowEl);
    }
    listEl.classList.add("is-dragging");
  }
  updatePlayerDragGhost(clientX, clientY);
  const { listEl } = playerDragState;
  const target = document.elementFromPoint(clientX, clientY);
  const row = target?.closest(".match-player-row");
  updatePlayerDropIndicator(listEl, row, clientY, target);
}

function handlePlayerPointerMove(e) {
  if (!playerDragState) return;
  e.preventDefault();
  handlePlayerDragMove(e.clientX, e.clientY);
}

function handlePlayerPointerUp() {
  if (!playerDragState) return;
  document.removeEventListener("pointermove", handlePlayerPointerMove);
  removePlayerDragGhost();
  _shell.triggerHapticFeedback(2);
  const { fromIndex, overIndex, listEl } = playerDragState;
  clearPlayerDropIndicator(listEl);
  listEl.classList.remove("is-dragging");
  const row = listEl.querySelector(`[data-index="${fromIndex}"]`);
  if (row) row.classList.remove("is-dragging");
  const moved = playerDragState.moved;
  playerDragState = null;
  if (moved && Number.isFinite(overIndex) && overIndex !== fromIndex) {
    const list = [..._shell.tempMatchPlayers.value];
    const [movedItem] = list.splice(fromIndex, 1);
    if (!movedItem) {
      renderMatchPlayers();
      return;
    }
    let insertIndex = overIndex;
    if (insertIndex > fromIndex) {
      insertIndex -= 1;
    }
    list.splice(insertIndex, 0, movedItem);
    _shell.tempMatchPlayers.value = list;
    markPlayerSwap(fromIndex, insertIndex);
    _shell.playClickFeedback();
  }
  renderMatchPlayers();
}

function startPlayerPointerDrag(e, index, listEl) {
  const hapticOk = _shell.triggerHapticFeedback(1);
  e.preventDefault();
  logger.debug("Player drag haptic", {
    vibrateSupported: typeof navigator !== "undefined" && !!navigator.vibrate,
    hapticOk,
    pointerType: e?.pointerType || "",
  });
  openPlayerColorIndex = null;
  closePlayerNameModal();
  listEl
    .querySelectorAll(".match-player-color-palette.is-open")
    .forEach((palette) => palette.classList.remove("is-open"));
  playerDragState = {
    fromIndex: index,
    listEl,
    overIndex: null,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
    lastHapticIndex: null,
    rowEl: null,
  };
  const row = listEl.querySelector(`[data-index="${index}"]`);
  if (row) {
    playerDragState.rowEl = row;
  }
  if (e.currentTarget?.setPointerCapture) {
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  document.addEventListener("pointermove", handlePlayerPointerMove);
  document.addEventListener("pointerup", handlePlayerPointerUp, { once: true });
  document.addEventListener("pointercancel", handlePlayerPointerUp, { once: true });
}

function getDefaultPlayerName(index) {
  return t("matchPlayerDefault").replace("{index}", index + 1);
}

function isDefaultPlayerName(name, index) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return false;
  const candidates = new Set();
  getAvailableLanguages().forEach((lang) => {
    const text = TEXTS[lang]?.matchPlayerDefault;
    if (text) {
      candidates.add(text.replace("{index}", index + 1));
    }
  });
  candidates.add(`Player ${index + 1}`);
  candidates.add(`Jugador ${index + 1}`);
  const normalized = trimmed.toLowerCase();
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.toLowerCase() === normalized) return true;
  }
  return false;
}

function buildTempPlayers(count, existing = []) {
  const n = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, count));
  const list = [];
  const used = new Set();
  for (let i = 0; i < n; i += 1) {
    const existingPlayer = existing[i];
    let color = existingPlayer && existingPlayer.color;
    if (!PLAYER_COLORS.includes(color)) {
      color = null;
    }
    color = color || PLAYER_COLORS[i % PLAYER_COLORS.length];
    if (used.has(color)) {
      const alt = PLAYER_COLORS.find((c) => !used.has(c));
      if (alt) color = alt;
    }
    used.add(color);
    let name = clampPlayerName(existingPlayer?.name || "");
    if (isDefaultPlayerName(name, i)) {
      name = "";
    }
    list.push({ name, color });
  }
  return list;
}

function syncTempPlayers(count) {
  const n = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, count));
  if (!Array.isArray(_shell.tempMatchPlayers.value)) {
    _shell.tempMatchPlayers.value = [];
  }
  const list = [..._shell.tempMatchPlayers.value];
  if (list.length > n) {
    list.length = n;
  } else if (list.length < n) {
    for (let i = list.length; i < n; i += 1) {
      const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
      list.push({ name: "", color });
    }
  }
  const used = new Set();
  _shell.tempMatchPlayers.value = list.map((player, idx) => {
    let color = player.color;
    if (!PLAYER_COLORS.includes(color)) {
      color = null;
    }
    color = color || PLAYER_COLORS[idx % PLAYER_COLORS.length];
    if (used.has(color)) {
      const alt = PLAYER_COLORS.find((c) => !used.has(c));
      if (alt) color = alt;
    }
    used.add(color);
    let name = clampPlayerName(player.name || "");
    if (isDefaultPlayerName(name, idx)) {
      name = "";
    }
    return { ...player, name, color };
  });
}

function buildPlayerFallbacks(count) {
  const knownNames = getKnownPlayerNames();
  const usedNames = new Set();
  _shell.tempMatchPlayers.value.forEach((player) => {
    if (player && player.name && player.name.trim()) {
      usedNames.add(normalizePlayerName(player.name));
    }
  });
  const fallbackNames = [];
  for (let i = 0; i < count; i += 1) {
    const base =
      (knownNames[i] && knownNames[i].trim()) ||
      (i === 0 && _shell.cachedNickname.value && _shell.cachedNickname.value.trim()) ||
      getDefaultPlayerName(i);
    fallbackNames.push(ensureUniquePlayerName(base, usedNames));
  }
  return fallbackNames;
}

function getAvailableKnownNames(excludeNames = []) {
  const knownNames = getKnownPlayerNames();
  const excluded = new Set(excludeNames.map(normalizePlayerName));
  const seen = new Set();
  const list = [];
  knownNames.forEach((raw) => {
    const name = String(raw || "").trim();
    if (!name) return;
    const norm = normalizePlayerName(name);
    if (excluded.has(norm)) return;
    if (seen.has(norm)) return;
    seen.add(norm);
    list.push(name);
  });
  return list;
}

function buildFinalPlayers() {
  const usedNames = new Set();
  const players = _shell.tempMatchPlayers.value;
  const fallbackNames = buildPlayerFallbacks(players.length);
  return players.map((player, idx) => {
    const raw = clampPlayerName(player.name).trim();
    const candidate = raw || fallbackNames[idx] || getDefaultPlayerName(idx);
    const name = ensureUniquePlayerName(candidate, usedNames);
    return { ...player, name };
  });
}

function removeKnownPlayerName(name) {
  const current = getKnownPlayerNames();
  const normalized = normalizePlayerName(name);
  const next = current.filter(
    (item) => normalizePlayerName(item) !== normalized
  );
  updateState({ settings: { knownPlayerNames: next } });
}

function getStartMatchIssue(players = []) {
  if (!Array.isArray(players) || !players.length) return "matchStartDisabledMissingName";
  const trimmed = players.map((player) => (player?.name || "").trim());
  if (trimmed.some((name) => !name)) return "matchStartDisabledMissingName";
  const seen = new Set();
  for (const name of trimmed) {
    const norm = normalizePlayerName(name);
    if (seen.has(norm)) {
      return "matchStartDisabledDuplicateName";
    }
    seen.add(norm);
  }
  return null;
}

function hasAllPlayerNames(players = []) {
  if (!Array.isArray(players) || !players.length) return false;
  return players.every((player) => player?.name && player.name.trim().length);
}

function updateMatchStartButtonState() {
  const startMatchBtn = document.getElementById("matchStartMatchBtn");
  const hintEl = document.getElementById("matchStartHint");
  if (!startMatchBtn) return;
  const matchState = matchController.getState();
  if (matchState.phase !== "config") {
    startMatchBtn.disabled = true;
    if (hintEl) hintEl.classList.add("hidden");
    return;
  }
  const players =
    Array.isArray(_shell.tempMatchPlayers.value) && _shell.tempMatchPlayers.value.length
      ? _shell.tempMatchPlayers.value
      : matchState.players || [];
  const issueKey = getStartMatchIssue(players);
  startMatchBtn.disabled = Boolean(issueKey);
  if (hintEl) {
    if (issueKey) {
      _shell.setI18n(hintEl, issueKey);
      hintEl.classList.remove("hidden");
    } else {
      hintEl.classList.add("hidden");
    }
  }
}

function updateMatchConfigStepControls(matchState) {
  if (!matchState || matchState.phase !== "config") return;
  const playersCount =
    _shell.tempMatchPrefs.value.playersCount ?? matchState.players?.length ?? DEFAULT_PLAYER_COUNT;
  const roundsTarget = _shell.tempMatchPrefs.value.roundsTarget ?? DEFAULT_ROUNDS_TARGET;
  const pointsTarget = _shell.tempMatchPrefs.value.pointsTarget ?? DEFAULT_POINTS_TARGET;
  const strategySeconds =
    _shell.tempMatchPrefs.value.strategySeconds ?? DEFAULT_STRATEGY_SECONDS;
  const creationSeconds =
    _shell.tempMatchPrefs.value.creationSeconds ?? DEFAULT_CREATION_SECONDS;

  const setDisabled = (id, disabled) => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !!disabled;
  };

  setDisabled("matchPlayersMinus", playersCount <= MIN_PLAYERS);
  setDisabled("matchPlayersPlus", playersCount >= MAX_PLAYERS);
  setDisabled("matchRoundsMinus", roundsTarget <= 1);
  setDisabled("matchRoundsPlus", false);
  setDisabled("matchPointsMinus", pointsTarget <= RECORD_MIN_POINTS);
  setDisabled("matchPointsPlus", false);
  setDisabled("matchStrategyMinus", strategySeconds <= MIN_PHASE_SECONDS);
  setDisabled("matchStrategyPlus", strategySeconds >= MAX_PHASE_SECONDS);
  setDisabled("matchCreationMinus", creationSeconds <= MIN_PHASE_SECONDS);
  setDisabled("matchCreationPlus", creationSeconds >= MAX_PHASE_SECONDS);
}

function closePlayerNameModal() {
  openPlayerNameIndex = null;
  closeModal("player-names");
}

function renderPlayerNameModal() {
  const listEl = document.getElementById("playerNamesList");
  const hintEl = document.getElementById("playerNamesHint");
  const hintDeleteEl = document.getElementById("playerNamesHintDelete");
  if (!listEl) return;
  listEl.innerHTML = "";
  if (hintEl) hintEl.classList.add("hidden");
  if (hintDeleteEl) hintDeleteEl.classList.add("hidden");
  if (openPlayerNameIndex == null) {
    const empty = document.createElement("div");
    empty.className = "player-name-empty";
    _shell.setI18n(empty, "matchPlayerNameEmpty");
    listEl.appendChild(empty);
    return;
  }
  const player = _shell.tempMatchPlayers.value[openPlayerNameIndex];
  if (!player) {
    closePlayerNameModal();
    return;
  }
  const usedNameValues = _shell.tempMatchPlayers.value
    .filter((_, idx) => idx !== openPlayerNameIndex)
    .map((p) => p.name)
    .filter((name) => name && name.trim());
  const currentName = player.name ? player.name.trim() : "";
  const availableNames = getAvailableKnownNames([
    ...usedNameValues,
    currentName,
  ]);
  if (!availableNames.length) {
    const empty = document.createElement("div");
    empty.className = "player-name-empty";
    _shell.setI18n(empty, "matchPlayerNameEmpty");
    listEl.appendChild(empty);
    return;
  }
  if (hintEl) {
    _shell.setI18n(hintEl, "matchPlayerNameHintMain");
    hintEl.classList.remove("hidden");
  }
  if (hintDeleteEl) {
    _shell.setI18n(hintDeleteEl, "matchPlayerNameHintDelete");
    hintDeleteEl.classList.remove("hidden");
  }
  availableNames.forEach((name) => {
    const pill = document.createElement("div");
    pill.className = "player-name-pill";

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "player-name-pill-select";
    selectBtn.textContent = name;
    selectBtn.addEventListener("click", () => {
      _shell.playClickFeedback();
      const nextName = clampPlayerName(name);
      _shell.tempMatchPlayers.value[openPlayerNameIndex] = { ...player, name: nextName };
      closePlayerNameModal();
      renderMatchPlayers();
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "player-name-pill-remove";
    _shell.setI18n(removeBtn, "matchPlayerNameRemove", { attr: "aria-label" });
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      _shell.playClickFeedback();
      removeKnownPlayerName(name);
      renderPlayerNameModal();
    });

    pill.appendChild(selectBtn);
    pill.appendChild(removeBtn);
    listEl.appendChild(pill);
  });
}

function openPlayerNameModal(index) {
  openPlayerNameIndex = index;
  renderPlayerNameModal();
  const overlay = document.querySelector(
    '.modal-overlay[data-modal="player-names"]'
  );
  if (overlay && overlay.classList.contains("open")) return;
  openModal("player-names", {
    onClose: () => {
      openPlayerNameIndex = null;
    },
  });
}

function renderMatchPlayers() {
  const listEl = document.getElementById("matchPlayersList");
  if (!listEl) return;
  if (!listEl.dataset.dragInit) {
    listEl.dataset.dragInit = "1";
    listEl.addEventListener("dragover", (e) => e.preventDefault());
  }
  const knownNames = getKnownPlayerNames();
  const hasKnownNames = knownNames.length > 0;
  const count = _shell.tempMatchPrefs.value.playersCount ?? DEFAULT_PLAYER_COUNT;
  syncTempPlayers(count);
  listEl.innerHTML = "";
  const usedColors = _shell.tempMatchPlayers.value.map((p) => p.color);
  const shouldAnimateSwap =
    lastPlayerSwap && Date.now() - lastPlayerSwap.at < 600;
  if (!hasKnownNames && openPlayerNameIndex != null) {
    closePlayerNameModal();
  }

  _shell.tempMatchPlayers.value.forEach((player, index) => {
    const usedByOthers = new Set(
      usedColors.filter((color, idx) => idx !== index)
    );
    const row = document.createElement("div");
    row.className = "match-player-row";
    row.dataset.index = `${index}`;
    if (index % 2 === 1) {
      row.classList.add("is-alt");
    }
    row.draggable = false;
    const dragHandle = document.createElement("button");
    dragHandle.type = "button";
    dragHandle.className = "match-player-drag-handle";
    _shell.setI18n(dragHandle, "matchPlayerDrag", { attr: "aria-label" });
    dragHandle.addEventListener("pointerdown", (e) =>
      startPlayerPointerDrag(e, index, listEl)
    );
    if (
      shouldAnimateSwap &&
      (index === lastPlayerSwap.from || index === lastPlayerSwap.to)
    ) {
      row.classList.add("is-animating");
    }

    const upBtn = document.createElement("button");
    upBtn.className = "match-player-move";
    upBtn.type = "button";
    upBtn.textContent = "▲";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", () => {
      if (index === 0) return;
      _shell.playClickFeedback();
      _shell.triggerHapticFeedback(1);
      const list = [..._shell.tempMatchPlayers.value];
      const temp = list[index - 1];
      list[index - 1] = list[index];
      list[index] = temp;
      _shell.tempMatchPlayers.value = list;
      openPlayerColorIndex = null;
      closePlayerNameModal();
      markPlayerSwap(index, index - 1);
      renderMatchPlayers();
    });

    const colorBtn = document.createElement("button");
    colorBtn.className = "match-player-color-button";
    colorBtn.type = "button";
    colorBtn.style.background = player.color;
    _shell.setI18n(colorBtn, "matchPlayerColor", { attr: "aria-label" });
    colorBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      _shell.playClickFeedback();
      closePlayerNameModal();
      openPlayerColorIndex = openPlayerColorIndex === index ? null : index;
      renderMatchPlayers();
    });

    const nameWrap = document.createElement("div");
    nameWrap.className = "match-player-name-wrap";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "match-player-name";
    const initialName = clampPlayerName(player.name || "");
    nameInput.value = initialName;
    nameInput.maxLength = PLAYER_NAME_MAX;
    if (initialName !== (player.name || "")) {
      _shell.tempMatchPlayers.value[index] = { ...player, name: initialName };
    }
    _shell.setI18n(nameInput, "matchPlayerDefault", {
      attr: "placeholder",
      vars: { index: index + 1 },
    });

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "match-player-name-clear";
    clearBtn.textContent = "X";
    _shell.setI18n(clearBtn, "matchPlayerNameClear", { attr: "aria-label" });
    clearBtn.classList.toggle("hidden", !nameInput.value);
    nameInput.addEventListener("input", (e) => {
      const nextName = clampPlayerName(e.target.value);
      if (nextName !== e.target.value) {
        e.target.value = nextName;
      }
      _shell.tempMatchPlayers.value[index] = { ...player, name: nextName };
      clearBtn.classList.toggle("hidden", !nextName);
      updateMatchStartButtonState();
    });
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      _shell.playClickFeedback();
      nameInput.value = "";
      _shell.tempMatchPlayers.value[index] = { ...player, name: "" };
      clearBtn.classList.add("hidden");
      updateMatchStartButtonState();
      nameInput.focus();
    });

    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "match-player-name-btn";
    _shell.setI18n(nameBtn, "matchPlayerNameSelect", { attr: "aria-label" });
    if (!hasKnownNames) {
      nameBtn.classList.add("hidden");
      nameBtn.disabled = true;
    }
    nameBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      _shell.playClickFeedback();
      openPlayerColorIndex = null;
      openPlayerNameModal(index);
    });

    nameWrap.appendChild(nameInput);
    nameWrap.appendChild(clearBtn);

    const colorsRow = document.createElement("div");
    colorsRow.className = "match-player-color-palette";
    _shell.setI18n(colorsRow, "matchPlayerColor", { attr: "aria-label" });
    if (openPlayerColorIndex === index) {
      colorsRow.classList.add("is-open");
    }
    PLAYER_COLORS.forEach((color) => {
      if (usedByOthers.has(color)) return;
      const option = document.createElement("button");
      option.type = "button";
      option.className = "match-player-color-option";
      option.style.background = color;
      _shell.setI18n(option, "matchPlayerColor", { attr: "aria-label" });
      if (color === player.color) {
        option.classList.add("is-selected");
      }
      option.addEventListener("click", () => {
        if (player.color === color) return;
        _shell.playClickFeedback();
        _shell.tempMatchPlayers.value[index] = { ...player, color };
        openPlayerColorIndex = null;
        closePlayerNameModal();
        renderMatchPlayers();
      });
      colorsRow.appendChild(option);
    });

    const downBtn = document.createElement("button");
    downBtn.className = "match-player-move";
    downBtn.type = "button";
    downBtn.textContent = "▼";
    downBtn.disabled = index === _shell.tempMatchPlayers.value.length - 1;
    downBtn.addEventListener("click", () => {
      if (index >= _shell.tempMatchPlayers.value.length - 1) return;
      _shell.playClickFeedback();
      _shell.triggerHapticFeedback(1);
      const list = [..._shell.tempMatchPlayers.value];
      const temp = list[index + 1];
      list[index + 1] = list[index];
      list[index] = temp;
      _shell.tempMatchPlayers.value = list;
      openPlayerColorIndex = null;
      closePlayerNameModal();
      markPlayerSwap(index, index + 1);
      renderMatchPlayers();
    });

    if (!hasKnownNames) {
      row.classList.add("no-name-list");
    }
    row.appendChild(dragHandle);
    row.appendChild(upBtn);
    row.appendChild(colorBtn);
    row.appendChild(nameWrap);
    row.appendChild(nameBtn);
    row.appendChild(downBtn);
    row.appendChild(colorsRow);
    listEl.appendChild(row);

    row.addEventListener("dragstart", (e) => e.preventDefault());
    row.addEventListener("dragend", (e) => e.preventDefault());
  });

  if (shouldAnimateSwap && Date.now() - lastPlayerSwap.at >= 400) {
    lastPlayerSwap = null;
  }
  if (openPlayerNameIndex != null) {
    if (!_shell.tempMatchPlayers.value[openPlayerNameIndex]) {
      closePlayerNameModal();
    } else {
      renderPlayerNameModal();
    }
  }
  updateMatchStartButtonState();
}

// ─── Match phase control + config adjusters (moved from main.js) ─────────────

function clampPhaseSeconds(val) {
  const num = Number(val);
  if (Number.isNaN(num)) return MIN_PHASE_SECONDS;
  return Math.min(MAX_PHASE_SECONDS, Math.max(MIN_PHASE_SECONDS, Math.round(num)));
}

function adjustMatchTimer(kind, delta) {
  const st = matchController.getState();
  if (!st || st.phase !== "config") return;
  const key = kind === "strategy" ? "strategySeconds" : "creationSeconds";
  const base =
    _shell.tempMatchPrefs.value[key] ??
    (kind === "strategy" ? DEFAULT_STRATEGY_SECONDS : DEFAULT_CREATION_SECONDS);
  const nextVal = clampPhaseSeconds(base + delta);
  updateMatchPreferences({ [key]: nextVal });
}

function adjustPlayers(delta) {
  const st = matchController.getState();
  if (!st || st.phase !== "config") return;
  const current = _shell.tempMatchPrefs.value.playersCount ?? st.players?.length ?? DEFAULT_PLAYER_COUNT;
  const next = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, current + delta));
  updateMatchPreferences({ playersCount: next });
}

function setMatchMode(mode) {
  const st = matchController.getState();
  if (!st || st.phase !== "config") return;
  const next = mode === MATCH_MODE_POINTS ? MATCH_MODE_POINTS : MATCH_MODE_ROUNDS;
  updateMatchPreferences({ mode: next });
}

function adjustRounds(delta) {
  const st = matchController.getState();
  if (!st || st.phase !== "config") return;
  const current = _shell.tempMatchPrefs.value.roundsTarget ?? DEFAULT_ROUNDS_TARGET;
  const next = Math.max(1, current + delta);
  updateMatchPreferences({ roundsTarget: next });
}

function adjustPoints(delta) {
  const st = matchController.getState();
  if (!st || st.phase !== "config") return;
  const current = _shell.tempMatchPrefs.value.pointsTarget ?? DEFAULT_POINTS_TARGET;
  const next = Math.max(RECORD_MIN_POINTS, current + delta);
  updateMatchPreferences({ pointsTarget: next });
}

function toggleScoring() {
  const st = matchController.getState();
  if (!st || st.phase !== "config") return;
  updateMatchPreferences({ scoringEnabled: !_shell.tempMatchPrefs.value.scoringEnabled });
}

function toggleRecordValidation() {
  const st = matchController.getState();
  if (!st || st.phase !== "config") return;
  if (!_shell.tempMatchPrefs.value.scoringEnabled) return;
  updateMatchPreferences({ validateRecordWords: !_shell.tempMatchPrefs.value.validateRecordWords });
}

function handlePhaseTabClick(target) {
  const st = matchController.getState();
  if (!st || st.phase === "config" || st.matchOver) return;
  const isCreationPhase = st.phase.startsWith("creation") || st.phase === "done";
  if (target === "creation") {
    if (isCreationPhase) return;
    _shell.openConfirm({
      title: "confirmTitlePhaseChange",
      body: "confirmBodyPhaseChange",
      acceptText: "confirmAccept",
      cancelText: "cancel",
      onConfirm: () => {
        _shell.stopClockLoop(false);
        matchController.skipToCreation({ autoStart: true });
        _shell.playClockLoop();
        renderMatch();
      },
    });
    return;
  }
  if (!isCreationPhase) return;
  _shell.openConfirm({
    title: "confirmTitlePhaseChange",
    body: "confirmBodyPhaseChange",
    acceptText: "confirmAccept",
    cancelText: "cancel",
    onConfirm: () => {
      _shell.stopClockLoop(false);
      matchController.restartPhase("strategy", { autoStart: false });
      renderMatch();
    },
  });
}

function startMatchPhase(kind) {
  const st = matchController.getState();
  if (!st) return;
  const phase = st.phase;
  if (kind === "strategy") {
    if (phase === "config") {
      const prompted = maybePromptRestoreStaleMatch({
        onDecline: () => startMatchPhase(kind),
      });
      if (prompted) return;
      matchController.startMatch({ language: getShellLanguage() });
      persistActiveMatchSnapshot(matchController.getState());
    }
    const current = matchController.getState().phase;
    if (current === "strategy-ready") {
      matchController.startPhase("strategy");
      persistActiveMatchSnapshot(matchController.getState());
      _shell.playClockLoop();
    } else if (current === "strategy-run") {
      matchController.pause();
      _shell.stopClockLoop(false);
    } else if (current === "strategy-paused") {
      matchController.resume();
      const resumed = matchController.getState();
      const remaining = resumed?.remaining ?? 0;
      if (remaining <= LOW_TIME_THRESHOLD && remaining > 0) {
        _shell.clockLowTimeMode.value = true;
        _shell.stopClockLoop(false);
      } else {
        _shell.clockLowTimeMode.value = false;
        _shell.playClockLoop();
      }
    }
  } else if (kind === "creation") {
    if (phase === "strategy-timeup" || phase === "creation-ready") {
      matchController.startPhase("creation");
      persistActiveMatchSnapshot(matchController.getState());
      _shell.playClockLoop();
    } else if (phase === "creation-run") {
      matchController.pause();
      _shell.stopClockLoop(false);
    } else if (phase === "creation-paused") {
      matchController.resume();
      const resumed = matchController.getState();
      const remaining = resumed?.remaining ?? 0;
      if (remaining <= LOW_TIME_THRESHOLD && remaining > 0) {
        _shell.clockLowTimeMode.value = true;
        _shell.stopClockLoop(false);
      } else {
        _shell.clockLowTimeMode.value = false;
        _shell.playClockLoop();
      }
    } else if (phase === "config") {
      const prompted = maybePromptRestoreStaleMatch({
        onDecline: () => startMatchPhase(kind),
      });
      if (prompted) return;
      matchController.startMatch({ language: getShellLanguage() });
      persistActiveMatchSnapshot(matchController.getState());
    }
  }
  renderMatch();
}

function resetMatchPhase(kind) {
  const target = kind === "creation" ? "creation" : "strategy";
  matchController.restartPhase(target, { autoStart: false });
  _shell.stopClockLoop(false);
  renderMatch();
}

function finishMatchPhase(kind) {
  const st = matchController.getState();
  if (!st) return;
  if (kind === "strategy" && st.phase.startsWith("strategy")) {
    matchController.finishPhase();
    _shell.stopClockLoop(false);
  } else if (kind === "creation" && st.phase.startsWith("creation")) {
    matchController.finishPhase();
    _shell.stopClockLoop(false);
  }
  renderMatch();
}

function confirmFinishPhase(kind) {
  _shell.openConfirm({
    title: "confirmTitleFinish",
    body: "confirmBodyFinish",
    acceptText: "confirmAccept",
    cancelText: "cancel",
    onConfirm: () => finishMatchPhase(kind),
  });
}

// ─── Validation section (moved from main.js) ─────────────────────────────────

function sanitizeValidationInput(refs) {
  if (!refs?.input) return;
  const allowed = refs.input.value.replace(/[^A-Za-zÁÉÍÓÚÜáéíóúüÑñ-]/g, "");
  if (allowed !== refs.input.value) {
    const pos = refs.input.selectionStart || allowed.length;
    refs.input.value = allowed;
    refs.input.selectionStart = refs.input.selectionEnd = Math.min(pos, allowed.length);
  }
}

function updateValidationControls(refs) {
  if (!refs?.input) return;
  const hasText = refs.input.value.trim().length > 0;
  if (refs.clearBtn) refs.clearBtn.classList.toggle("hidden", !hasText);
  if (refs.validateBtn) {
    refs.validateBtn.disabled = !hasText;
    refs.validateBtn.classList.toggle("disabled", !hasText);
  }
}

function clearStatusValidationFor(key = "match") {
  const section = validationSections.get(key);
  if (section?.status) {
    section.status.textContent = "";
    section.status.className = "match-validation-status";
  }
  if (key === "match") updateRestoreButtonVisibility();
}

function clearMatchWordFor(key = "match", focusInput = true) {
  const section = validationSections.get(key);
  if (section?.input) {
    section.input.value = "";
    if (focusInput) section.input.focus();
    section.input.setAttribute("autocomplete", "off");
    updateValidationControls(section);
  }
  if (key === "match") {
    lastMatchWord = "";
    lastMatchWordFeatures = {
      sameColor: false,
      usedWildcard: false,
      doubleScore: false,
      plusPoints: false,
      minusPoints: false,
    };
  }
  clearStatusValidationFor(key);
}

function createValidationSection(mountId, key) {
  const mount = document.getElementById(mountId);
  const tpl = document.getElementById("validation-template");
  if (!mount || !tpl) return;
  const clone = tpl.content.firstElementChild.cloneNode(true);
  clone.classList.remove("hidden");
  clone.classList.add("validation-embedded");
  mount.innerHTML = "";
  mount.appendChild(clone);
  const refs = {
    root: clone,
    title: clone.querySelector(".validation-title"),
    input: clone.querySelector(".validation-input"),
    clearBtn: clone.querySelector(".validation-clear"),
    validateBtn: clone.querySelector(".validation-validate"),
    status: clone.querySelector(".validation-status"),
    rulesBtn: clone.querySelector(".validation-rules-btn"),
    langToggle: clone.querySelector(".validation-lang-toggle"),
    langBtns: clone.querySelectorAll(".validation-lang-btn"),
    langOverride: null, // null = use default; "en"/"es" = user picked
  };
  // Wire the language toggle. Active button gets is-active class; selection
  // is stored in refs.langOverride and read by handleValidateSection.
  refs.langBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      refs.langOverride = btn.dataset.lang;
      refs.langBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
      // Update placeholder to match selected language.
      if (refs.input) {
        const ph = textForLanguage(refs.langOverride, "matchValidatePlaceholder");
        refs.input.placeholder = ph || "";
      }
      if (key === "round-keypad" && recordWordModalState?.source === "round-end") {
        setRecordWordLanguage(refs.langOverride, { syncRoundKeypad: false });
      }
    });
  });
  if (refs.input) {
    refs.input.addEventListener("input", () => {
      sanitizeValidationInput(refs);
      clearStatusValidationFor(key);
      if (key === "round-keypad" && getRoundEndKeypadPlayerId()) {
        const word = refs.input.value || "";
        const keyWord = normalizeValidationWord(word);
        if (keyWord) {
          setRoundEndValidationEntry(getRoundEndKeypadPlayerId(), {
            word,
            wordKey: keyWord,
            ok: false,
            round: matchController.getState()?.round,
            statusText: "",
            statusClass: "match-validation-status",
            language: getValidationSelectedLanguage(refs, key),
          });
        } else {
          clearRoundEndValidationEntry(getRoundEndKeypadPlayerId());
        }
      }
      updateValidationControls(refs);
    });
    refs.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (refs.input.value.trim().length > 0) {
          handleValidateSection(key);
        }
      }
    });
    refs.input.setAttribute("autocomplete", "off");
    updateValidationControls(refs);
  }
  if (refs.clearBtn) {
    refs.clearBtn.addEventListener("click", () => clearMatchWordFor(key));
  }
  if (refs.validateBtn) {
    refs.validateBtn.addEventListener("click", () => handleValidateSection(key));
    attachValidatorDebugLongPress(refs.validateBtn, refs);
  }
  if (refs.rulesBtn) {
    refs.rulesBtn.addEventListener("click", () => openRulesModal());
  }
  // Show the toggle immediately for help and scoreboard sections — the user
  // can always switch between ES/EN (unlike training, where it only appears
  // when a language card is active). Pre-select the default language.
  if (key !== "training-creation" && refs.langToggle) {
    const defaultLang = getValidationBaseLanguage(key);
    refs.langToggle.classList.remove("hidden");
    refs.langOverride = defaultLang;
    refs.langBtns.forEach((b) =>
      b.classList.toggle("is-active", b.dataset.lang === defaultLang)
    );
    if (refs.input) {
      refs.input.placeholder = textForLanguage(defaultLang, "matchValidatePlaceholder") || "";
    }
  }

  validationSections.set(key, refs);
}

// Show the lang toggle for a validation section and pre-select a language.
// Called by training.js when an in_english/in_spanish card is active.
export function showValidationLangToggle(key, defaultLang) {
  const section = validationSections.get(key);
  if (!section?.langToggle) return;
  const lang = normalizeLanguage(defaultLang);
  section.langToggle.classList.remove("hidden");
  section.langOverride = lang;
  section.langBtns.forEach((b) =>
    b.classList.toggle("is-active", b.dataset.lang === lang)
  );
  if (section.input) {
    section.input.placeholder = textForLanguage(lang, "matchValidatePlaceholder") || "";
  }
}
export function hideValidationLangToggle(key) {
  const section = validationSections.get(key);
  if (!section?.langToggle) return;
  section.langToggle.classList.add("hidden");
  section.langOverride = null;
  section.langBtns.forEach((b) => b.classList.remove("is-active"));
}

async function handleValidateSection(key = "match") {
  const section = validationSections.get(key);
  if (!section) return;
  const { input, status, validateBtn } = section;
  if (!input || !status) return;
  const word = input.value.trim();
  if (!word) {
    status.textContent = t("matchValidateEmpty");
    status.className = "match-validation-status error";
    return;
  }
  section.root?.classList.add("loading");
  if (input) input.disabled = true;
  if (validateBtn) validateBtn.disabled = true;
  if (section.clearBtn) section.clearBtn.disabled = true;
  if (section.rulesBtn) section.rulesBtn.disabled = true;
  status.textContent = t("matchValidateAction");
  status.className = "match-validation-status";
  try {
    const validationLang = getValidationSelectedLanguage(section, key);
    const baseLang = getValidationBaseLanguage(key);
    const rulesText = getValidationRulesForLang(validationLang);
    const result = await matchController.validateWord(word, rulesText, { language: validationLang });
    const ok = !!result?.isValid;
    const base = ok ? t("matchValidateOk") : t("matchValidateFail");
    const reason = result?.reason ? ` ${result.reason}` : "";
    status.textContent = `${base}${reason}`;
    status.className = `match-validation-status ${ok ? "ok" : "fail"}`;
    showValidationResult(ok ? "ok" : "fail", `${base}${reason}`,
      validationLang !== baseLang ? validationLang.toUpperCase() : null);
    if (key === "round-keypad" && getRoundEndKeypadPlayerId()) {
      const st = matchController.getState();
      setRoundEndValidationEntry(getRoundEndKeypadPlayerId(), {
        word,
        wordKey: normalizeValidationWord(word),
        ok,
        round: st?.round,
        statusText: status.textContent,
        statusClass: status.className,
        language: validationLang,
      });
    }
    if (key === "match" && ok) {
      lastMatchWord = word;
      lastMatchWordFeatures = {
        sameColor: false,
        usedWildcard: false,
        doubleScore: false,
        plusPoints: false,
        minusPoints: false,
      };
    }
  } catch (e) {
    logger.error("Word validation failed", e);
    status.textContent = t("matchValidateError");
    status.className = "match-validation-status error";
    showValidationResult("error", t("matchValidateError"), null);
    if (key === "round-keypad" && getRoundEndKeypadPlayerId()) {
      const st = matchController.getState();
      setRoundEndValidationEntry(getRoundEndKeypadPlayerId(), {
        word,
        wordKey: normalizeValidationWord(word),
        ok: false,
        round: st?.round,
        statusText: status.textContent,
        statusClass: status.className,
        language: validationLang,
      });
    }
  } finally {
    section.root?.classList.remove("loading");
    if (input) {
      input.disabled = false;
      if (key !== "round-keypad") {
        input.value = "";
      }
    }
    if (validateBtn) validateBtn.disabled = false;
    if (section.clearBtn) section.clearBtn.disabled = false;
    if (section.rulesBtn) section.rulesBtn.disabled = false;
    updateValidationControls(section);
  }
}

function getValidationSections() {
  return validationSections;
}

// ─── Match winners / validation result (moved from main.js) ──────────────────

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNameList(names, lang = "es") {
  const list = Array.isArray(names) ? names.filter(Boolean) : [];
  if (list.length <= 1) return list[0] || "";
  const conj = lang.startsWith("en") ? "and" : "y";
  if (list.length === 2) return `${list[0]} ${conj} ${list[1]}`;
  return `${list.slice(0, -1).join(", ")} ${conj} ${list[list.length - 1]}`;
}

function formatNameListHtml(names, lang = "es") {
  const list = Array.isArray(names) ? names.filter(Boolean) : [];
  if (!list.length) return "";
  const conj = lang.startsWith("en") ? "and" : "y";
  const wrap = (name) => `<span class="match-winners-record-name">${escapeHtml(name)}</span>`;
  if (list.length === 1) return wrap(list[0]);
  if (list.length === 2) return `${wrap(list[0])} ${conj} ${wrap(list[1])}`;
  const head = list.slice(0, -1).map((name) => wrap(name)).join(", ");
  const tail = wrap(list[list.length - 1]);
  return `${head} ${conj} ${tail}`;
}

function stopMatchTimer() {
  matchController.stopTimer?.();
}

function showValidationResult(status, message, langBadge = null) {
  const overlay = document.querySelector('.modal-overlay[data-modal="validation-result"]');
  if (!overlay) return;
  const panel = overlay.querySelector(".result-panel");
  if (panel) {
    panel.classList.toggle("ok", status === "ok");
    panel.classList.toggle("fail", status === "fail");
    panel.classList.toggle("error", status === "error");
  }
  const iconEl = document.getElementById("validationResultIcon");
  const titleEl = document.getElementById("validationResultTitle");
  const msgEl = document.getElementById("validationResultMessage");
  // Language badge on the ribbon — shown when validation used a different
  // language than the session default (e.g. EN toggle on an ES game).
  const badgeEl = document.getElementById("validationResultLangBadge");
  if (badgeEl) {
    badgeEl.textContent = langBadge || "";
    badgeEl.classList.toggle("hidden", !langBadge);
  }
  const btn = document.getElementById("validationResultCloseBtn");
  if (iconEl) iconEl.textContent = status === "ok" ? "✔" : status === "fail" ? "✖" : "!";
  if (titleEl)
    titleEl.textContent =
      status === "ok"
        ? t("matchValidateOk")
        : status === "fail"
        ? t("matchValidateFail")
        : t("unexpectedErrortitle");
  if (msgEl) msgEl.textContent = message || "";
  if (btn) {
    btn.textContent = t("ok");
    btn.classList.toggle("primary", status === "ok");
    btn.classList.toggle("ghost", status !== "ok");
    if (!btn._bindClose) {
      btn.addEventListener("click", () => closeModal("validation-result", { reason: "action" }));
      btn._bindClose = true;
    }
  }
  if (status !== "error") _shell.playValidationResultSound(status === "ok");
  openModal("validation-result", { closable: true });
}

function getMatchRecordNames(matchState, records) {
  const matchId = matchState?.matchId;
  if (!matchId) return [];
  const players = Array.isArray(matchState?.players) ? matchState.players : [];
  const byId = new Map(players.map((p) => [String(p.id), p.name || ""]));
  const names = new Set();
  const wordRecords = Array.isArray(records?.bestWord) ? records.bestWord : [];
  const matchRecords = Array.isArray(records?.bestMatch) ? records.bestMatch : [];
  const all = [...wordRecords, ...matchRecords];
  all.forEach((entry) => {
    if (!entry || String(entry.matchId) !== String(matchId)) return;
    const name =
      entry.playerName ||
      byId.get(String(entry.playerId)) ||
      `${t("playerLabel")} ${entry.playerId}`;
    if (name) names.add(name);
  });
  return Array.from(names);
}

function updateMatchWinnersRecordsUI(matchState, { recordsBtn, recordsNote } = {}) {
  if (!matchState) return;
  const records = loadRecords() || {};
  const recordNames = getMatchRecordNames(matchState, records);
  const hasRecords = recordNames.length > 0;
  if (recordsBtn) recordsBtn.classList.toggle("hidden", !hasRecords);
  if (recordsNote) {
    recordsNote.classList.toggle("hidden", !hasRecords);
    if (hasRecords) {
      const namesText = formatNameListHtml(recordNames, getShellLanguage());
      const template = t("matchWinnersRecordsNote") || "";
      recordsNote.innerHTML = template.replace("{names}", namesText);
    }
  }
}

function showMatchWinners(winnerIds = []) {
  const st = matchController.getState();
  if (!st) return;
  if (_shell.winnersModalOpen.value) return;
  _shell.lastWinnersIds.value = Array.isArray(winnerIds) ? [...winnerIds] : [];
  const winners = getPlayersByIds(st, winnerIds);
  const titleEl = document.getElementById("matchWinnersTitle");
  const subtitleEl = document.getElementById("matchWinnersSubtitle");
  const listEl = document.getElementById("matchWinnersList");
  const scoreBtn = document.getElementById("matchWinnersScoreBtn");
  const recordsBtn = document.getElementById("matchWinnersRecordsBtn");
  const recordsNote = document.getElementById("matchWinnersRecordsNote");
  const isMulti = winners.length > 1;
  if (titleEl) {
    _shell.setI18n(titleEl, isMulti ? "matchWinnerTitleMulti" : "matchWinnerTitleSingle");
  }
  if (subtitleEl) {
    _shell.setI18n(subtitleEl, isMulti ? "matchWinnerSubtitleMulti" : "matchWinnerSubtitleSingle");
  }
  if (listEl) {
    listEl.innerHTML = "";
    winners.forEach((player, idx) => {
      const chip = document.createElement("div");
      chip.className = "match-winner-chip";
      const palette = getDealerPalette(player?.color || "#d9c79f");
      chip.style.setProperty("--winner-bg", player?.color || "#d9c79f");
      chip.style.setProperty("--winner-border", palette.border);
      chip.style.setProperty("--winner-text", palette.text);
      chip.textContent = player?.name || `${t("playerLabel")} ${idx + 1}`;
      listEl.appendChild(chip);
    });
  }
  if (scoreBtn) {
    scoreBtn.classList.toggle("hidden", !st.scoringEnabled);
  }
  updateMatchWinnersRecordsUI(st, { recordsBtn, recordsNote });
  _shell.playModalOpenSound();
  _shell.winnersModalOpen.value = true;
  openModal("match-winners", {
    closable: true,
    onClose: () => {
      const skipPrompt = _shell.suppressWinnersPrompt.value;
      _shell.suppressWinnersPrompt.value = false;
      _shell.winnersModalOpen.value = false;
      if (!skipPrompt) {
        promptMatchPlayAgain();
      }
    },
  });
}

function handleRoundEndAllWin() {
  const st = matchController.getState();
  if (!st) return;
  const selected = getRoundEndSelectedIds(st);
  if (!selected.length) return;
  matchController.declareWinners(selected);
  const nextState = matchController.getState();
  if (nextState?.matchOver) {
    clearMatchWordFor("match");
    _shell.stopClockLoop(false);
    _shell.showScreen("match");
    renderMatch();
    showMatchWinners(nextState.winnerIds || []);
    return;
  }
  clearMatchWordFor("match");
  _shell.stopClockLoop(false);
  _shell.showScreen("match");
  renderMatch();
}

function handleRoundEndTieBreak() {
  const st = matchController.getState();
  if (!st) return;
  const selected = getRoundEndSelectedIds(st);
  if (selected.length < 2) return;
  matchController.startTieBreak(selected);
  clearMatchWordFor("match");
  _shell.stopClockLoop(false);
  _shell.showScreen("match");
  renderMatch();
}

function onMatchStarted({ state, isRematch = false } = {}) {
  _analyticsMatchStartTime = Date.now();
  _analyticsRoundStartTime = null;
  _analyticsValidationCount = 0;
  _analyticsIsRematch = isRematch;
  if (state) {
    capture("match_started", {
      match_language: getMatchLanguage(state),
      mode: state.mode,
      player_count: state.players.length,
      rounds_target: state.roundsTarget,
      points_target: state.pointsTarget,
      strategy_seconds_configured: state.strategySeconds,
      creation_seconds_configured: state.creationSeconds,
      scoring_enabled: state.scoringEnabled,
      word_record_validation_enabled: state.validateRecordWords,
      ...(isRematch ? { is_rematch: true } : {}),
    });
  }
}

function setupMatchControllerEvents() {
  matchController.on("statechange", () => {
    _shell.renderMatch();
    if (getAndClearSkipFlag()) return;
    const st = matchController.getState();
    if (!st?.matchOver) {
      scheduleActiveMatchSave(st);
    }
  });
  matchController.on("phaseStart", ({ phase }) => {
    if (phase && phase.endsWith("-run")) {
      _shell.clockLowTimeMode.value = false;
      _shell.playClockLoop();
    }
    const now = Date.now();
    if (phase === "strategy-run") {
      _analyticsStrategyStartTime = now;
      _analyticsStrategyDuration = null;
      if (!_analyticsRoundStartTime) _analyticsRoundStartTime = now;
    } else if (phase === "creation-run") {
      if (_analyticsStrategyStartTime) {
        _analyticsStrategyDuration = Math.round((now - _analyticsStrategyStartTime) / 1000);
      }
      _analyticsCreationStartTime = now;
      _analyticsCreationDuration = null;
    }
  });
  matchController.on("paused", () => {
    _shell.clockLowTimeMode.value = false;
    _shell.stopClockLoop(false);
  });
  matchController.on("tick", ({ phase, remaining }) => {
    updateMatchTick();
    if (!phase) return;
    const kind = phase.startsWith("strategy") ? "strategy" : phase.startsWith("creation") ? "creation" : null;
    if (!kind) return;
    if (remaining <= LOW_TIME_THRESHOLD && remaining > 0) {
      if (!_shell.clockLowTimeMode.value) {
        _shell.clockLowTimeMode.value = true;
        _shell.stopClockLoop(false);
      }
      _shell.playLowTimeTick();
    } else if (remaining > LOW_TIME_THRESHOLD && _shell.clockLowTimeMode.value) {
      _shell.clockLowTimeMode.value = false;
      _shell.playClockLoop();
    }
  });
  matchController.on("timeup", ({ phase }) => {
    _shell.clockLowTimeMode.value = false;
    const kind = phase?.startsWith("strategy") ? "strategy" : "creation";
    _shell.triggerTimeUpEffects(kind);
    _shell.renderMatch();
    const now = Date.now();
    if (kind === "creation" && _analyticsCreationStartTime) {
      _analyticsCreationDuration = Math.round((now - _analyticsCreationStartTime) / 1000);
    }
  });
  matchController.on("validationResult", () => {
    _analyticsValidationCount++;
  });
  matchController.on("roundFinished", () => {
    const st = matchController.getState();
    if (!st) return;
    const now = Date.now();
    const players = st.players || [];
    const n = players.length;
    if (n === 0) return;

    const roundScores = players.map((p) => {
      const last = Array.isArray(p.rounds) && p.rounds.length > 0
        ? p.rounds[p.rounds.length - 1].points : 0;
      return last;
    });
    const accScores = players.map((p) => p.score);
    const maxRound = Math.max(...roundScores);
    const maxAcc = Math.max(...accScores);
    const accThreshold = Math.max(10, maxAcc * 0.1);

    capture("round_finished", {
      match_language: getMatchLanguage(st),
      round_number: st.round,
      mode: st.mode,
      player_count: n,
      is_tie_break: st.tieBreak !== null,
      strategy_seconds_configured: st.strategySeconds,
      creation_seconds_configured: st.creationSeconds,
      strategy_duration_seconds: _analyticsStrategyDuration,
      creation_duration_seconds: _analyticsCreationDuration,
      round_duration_min: _analyticsRoundStartTime
        ? parseFloat(((now - _analyticsRoundStartTime) / 60000).toFixed(1)) : null,
      avg_score: Math.round(roundScores.reduce((a, b) => a + b, 0) / n),
      max_score: maxRound,
      min_score: Math.min(...roundScores),
      score_range: maxRound - Math.min(...roundScores),
      zero_rounds_total: roundScores.filter((s) => s === 0).length,
      avg_score_accumulated: Math.round(accScores.reduce((a, b) => a + b, 0) / n),
      max_score_accumulated: maxAcc,
      min_score_accumulated: Math.min(...accScores),
      score_range_accumulated: maxAcc - Math.min(...accScores),
      close_finish_pct: Math.round(
        (accScores.filter((s) => maxAcc - s <= accThreshold).length / n) * 100
      ),
    });

    _analyticsRoundStartTime = null;
    _analyticsStrategyStartTime = null;
    _analyticsCreationStartTime = null;
    _analyticsStrategyDuration = null;
    _analyticsCreationDuration = null;
  });
  matchController.on("matchFinished", ({ winners }) => {
    _shell.stopClockLoop(false);
    const finalState = matchController.getState();
    recordMatchAverages(finalState);
    finalizeWordRecordCandidates(finalState);
    const records = loadRecords() || {};
    if (finalState?.matchId) {
      upsertArchiveMatch(
        {
          matchId: finalState.matchId,
          savedAt: Date.now(),
          status: "finished",
          matchState: finalState,
        },
        { records }
      );
    }
    finalizeMatchSnapshot(finalState, { status: "finished" });
    showMatchWinners(winners);
    if (_shell.winnersModalOpen.value && finalState) {
      const recordsBtn = document.getElementById("matchWinnersRecordsBtn");
      const recordsNote = document.getElementById("matchWinnersRecordsNote");
      updateMatchWinnersRecordsUI(finalState, { recordsBtn, recordsNote });
    }
  });
}

// ── Match preferences + start ─────────────────────────────────────────────

function updateMatchPreferences(partial) {
  const st = matchController.getState() || {};
  _shell.tempMatchPrefs.value = {
    ..._shell.tempMatchPrefs.value,
    ...partial,
  };
  if (Object.prototype.hasOwnProperty.call(partial, "playersCount")) {
    syncTempPlayers(_shell.tempMatchPrefs.value.playersCount ?? DEFAULT_PLAYER_COUNT);
    const activeMode = _shell.tempMatchPrefs.value.mode ?? st.mode ?? MATCH_MODE_ROUNDS;
    if (activeMode === MATCH_MODE_ROUNDS) {
      const count = _shell.tempMatchPrefs.value.playersCount ?? DEFAULT_PLAYER_COUNT;
      _shell.tempMatchPrefs.value.roundsTarget = getDefaultRoundsTarget(count);
    }
  }
  const prefs = {
    playersCount: _shell.tempMatchPrefs.value.playersCount ?? st.players?.length ?? DEFAULT_PLAYER_COUNT,
    strategySeconds: _shell.tempMatchPrefs.value.strategySeconds ?? DEFAULT_STRATEGY_SECONDS,
    creationSeconds: _shell.tempMatchPrefs.value.creationSeconds ?? DEFAULT_CREATION_SECONDS,
    mode: _shell.tempMatchPrefs.value.mode ?? MATCH_MODE_ROUNDS,
    roundsTarget: _shell.tempMatchPrefs.value.roundsTarget ?? DEFAULT_ROUNDS_TARGET,
    pointsTarget: _shell.tempMatchPrefs.value.pointsTarget ?? DEFAULT_POINTS_TARGET,
    scoringEnabled: _shell.tempMatchPrefs.value.scoringEnabled ?? true,
    validateRecordWords: _shell.tempMatchPrefs.value.validateRecordWords ?? true,
  };
  matchController.applyPreferences(prefs, { persist: false });
  _shell.renderMatch();
}

function startMatchPlay({ skipResumePrompt = false } = {}) {
  if (!skipResumePrompt) {
    const prompted = maybePromptRestoreStaleMatch({
      onDecline: () => startMatchPlay({ skipResumePrompt: true }),
    });
    if (prompted) return;
  }
  _shell.stopClockLoop(false);
  _shell.stopIntroAudio();
  _shell.validationRules.value = cloneValidationRules(_shell.tempValidationRules.value);
  const matchLanguage = getShellLanguage();
  const finalPlayers = Array.isArray(_shell.tempMatchPlayers.value) && _shell.tempMatchPlayers.value.length
    ? buildFinalPlayers()
    : [];
  updateState({
    gamePreferences: {
      ..._shell.tempMatchPrefs.value,
      language: matchLanguage,
      players: finalPlayers,
    },
    settings: { validationRules: _shell.validationRules.value },
  });
  _shell.tempValidationRules.value = cloneValidationRules(_shell.validationRules.value);
  matchController.applyPreferences({ ..._shell.tempMatchPrefs.value, language: matchLanguage });
  if (finalPlayers.length) {
    _shell.tempMatchPlayers.value = finalPlayers;
    matchController.setPlayers(finalPlayers);
  }
  matchController.startMatch({ language: matchLanguage });
  onMatchStarted({ state: matchController.getState(), isRematch: false });
  persistActiveMatchSnapshot(matchController.getState());
  _shell.renderMatch();
}

// ── Validation rules ──────────────────────────────────────────────────────

function cloneValidationRules(source) {
  if (!source) return null;
  if (typeof source === "string") return source;
  if (typeof source === "object") {
    return JSON.parse(JSON.stringify(source));
  }
  return null;
}

function getValidationRules() {
  return getValidationRulesForLang(getRulesLanguage());
}

function getValidationRulesForLang(lang) {
  const source =
    _shell.rulesEditContext.value === "temp"
      ? _shell.tempValidationRules.value
      : _shell.validationRules.value;
  const langRule =
    source && typeof source === "object" && source !== null
      ? source[lang]
      : null;
  if (langRule) return langRule;
  if (typeof source === "string") return source;
  return textForLanguage(lang, "matchValidateDefaultRules");
}

function normalizeRulesText(str) {
  return (str || "")
    .replace(new RegExp(`\\n${BULLET_CHAR}\\s*\\n`, "g"), "\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function rulesDifferFromDefault(text) {
  const current = normalizeRulesText(text);
  const def = normalizeRulesText(textForLanguage(getRulesLanguage(), "matchValidateDefaultRules"));
  return current !== def;
}

function updateRestoreButtonVisibility(currentValue) {
  const btn = document.getElementById("rulesRestoreBtn");
  if (!btn) return;
  const show = rulesDifferFromDefault(currentValue != null ? currentValue : getValidationRules());
  btn.classList.toggle("hidden", !show);
}

function openRulesModal(context = "live") {
  _shell.rulesEditContext.value = context === "temp" ? "temp" : "live";
  _shell.playClickFeedback();
  _shell.playModalOpenSound();
  const textarea = document.getElementById("rulesTextarea");
  if (textarea) {
    textarea.maxLength = 1000;
    const rules = getValidationRules();
    textarea.value = (rules || "").slice(0, 1000);
    updateRestoreButtonVisibility(rules);
    textarea.removeEventListener("input", textarea._rulesInputHandler || (() => {}));
    textarea.removeEventListener("keydown", textarea._rulesKeyHandler || (() => {}));

    const handler = () => {
      if (textarea.value.length > 1000) {
        const caret = textarea.selectionStart;
        textarea.value = textarea.value.slice(0, 1000);
        const pos = Math.min(caret, textarea.value.length);
        textarea.selectionStart = textarea.selectionEnd = pos;
      }
      updateRestoreButtonVisibility(textarea.value);
    };
    textarea._rulesInputHandler = handler;
    textarea.addEventListener("input", handler);

    const keyHandler = (e) => {
      if (e.key !== "Enter") return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;

      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const lineEnd = value.indexOf("\n", start);
      const lineEndSafe = lineEnd === -1 ? value.length : lineEnd;
      const contentAhead = value.slice(start, lineEndSafe).trim();
      if (contentAhead.length > 0) {
        return;
      }

      const lineText = value.slice(lineStart, lineEndSafe);
      const lineNoSpaces = lineText.replace(/\s/g, "");
      const hasEmptyBullet = lineNoSpaces === "" || lineNoSpaces === BULLET_CHAR;

      e.preventDefault();
      const prefix = hasEmptyBullet ? "\n" : `\n${BULLET_CHAR} `;
      const before = value.slice(0, start);
      const after = value.slice(end);
      const nextValue = (before + prefix + after).slice(0, 1000);
      textarea.value = nextValue;
      const caretPos = Math.min(before.length + prefix.length, textarea.value.length);
      textarea.selectionStart = textarea.selectionEnd = caretPos;
      updateRestoreButtonVisibility(textarea.value);
    };
    textarea._rulesKeyHandler = keyHandler;
    textarea.addEventListener("keydown", keyHandler);
  }
  openModal("validation-rules", { closable: true });
}

function applyDefaultRules() {
  const textarea = document.getElementById("rulesTextarea");
  if (textarea) {
    const def = textForLanguage(getRulesLanguage(), "matchValidateDefaultRules");
    textarea.value = def.slice(0, 1000);
    updateRestoreButtonVisibility(def);
  }
}

function confirmRestoreDefaultRules() {
  _shell.openConfirm({
    title: "matchRulesTitle",
    body: "matchRulesRestoreConfirm",
    acceptText: "matchRulesRestore",
    cancelText: "cancel",
    onConfirm: () => applyDefaultRules(),
  });
}

function saveRulesModal() {
  const lang = getRulesLanguage();
  const textarea = document.getElementById("rulesTextarea");
  const value = (textarea?.value || "").slice(0, 1000).trim();
  const hasContent = /[A-Za-z0-9]/.test(value);
  const defaultRulesText = textForLanguage(lang, "matchValidateDefaultRules");
  const isDefaultContent = normalizeRulesText(value) === normalizeRulesText(defaultRulesText);
  let nextRules =
    _shell.rulesEditContext.value === "temp"
      ? cloneValidationRules(_shell.tempValidationRules.value)
      : cloneValidationRules(_shell.validationRules.value);
  if (!nextRules) nextRules = {};

  if (hasContent) {
    if (isDefaultContent) {
      delete nextRules[lang];
    } else {
      nextRules[lang] = value;
    }
  } else {
    delete nextRules[lang];
  }
  if (Object.keys(nextRules).length === 0) nextRules = null;

  if (_shell.rulesEditContext.value === "temp") {
    _shell.tempValidationRules.value = cloneValidationRules(nextRules);
  } else {
    _shell.validationRules.value = cloneValidationRules(nextRules);
    updateState({ settings: { validationRules: nextRules } });
  }
  if (textarea) updateRestoreButtonVisibility(value);
  closeModal("validation-rules", { reason: "action" });
  _shell.rulesEditContext.value = "live";
}

// ── Match lifecycle ───────────────────────────────────────────────────────

function resetMatchState() {
  stopMatchTimer();
  _shell.stopClockLoop(true);
  lastRoundIntroKey = "";
  if (roundIntroTimer) {
    clearTimeout(roundIntroTimer);
    roundIntroTimer = null;
  }
  const intro = document.getElementById("roundIntro");
  if (intro) {
    intro.classList.remove("show");
    intro.classList.add("hidden");
    intro.setAttribute("aria-hidden", "true");
  }
  const state = loadState();
  _shell.tempMatchPrefs.value = buildMatchPrefs(state.gamePreferences);
  _shell.tempMatchPlayers.value = buildTempPlayers(
    _shell.tempMatchPrefs.value.playersCount ?? DEFAULT_PLAYER_COUNT,
    state.gamePreferences?.players || state.matchState?.players || []
  );
  _shell.validationRules.value = state.settings.validationRules ?? null;
  _shell.tempValidationRules.value = cloneValidationRules(_shell.validationRules.value);
  matchController.applyPreferences(state.gamePreferences || {}, { persist: false });
  const storedPlayers = state.gamePreferences?.players || state.matchState?.players;
  if (Array.isArray(storedPlayers) && storedPlayers.length) {
    matchController.setPlayers(storedPlayers, { persist: false, updateKnownNames: false });
  }
}

function exitMatchDirect() {
  _shell.playClickFeedback();
  finalizeMatchSnapshot(matchController.getState(), { status: "finished", exitExplicit: true });
  _shell.stopClockLoop(true);
  resetMatchState();
  _shell.showScreen("splash");
}

function confirmExitToSplash() {
  _shell.playClickFeedback();
  _shell.openConfirm({
    title: "matchEndMatch",
    body: "confirmBodyExit",
    acceptText: "confirmAccept",
    cancelText: "cancel",
    onConfirm: () => {
      const _ast = matchController.getState();
      if (_ast?.isActive) {
        const matchStartTime = _analyticsMatchStartTime;
        capture("match_abandoned", {
          match_language: getMatchLanguage(_ast),
          mode: _ast.mode,
          player_count: _ast.players.length,
          round_number: _ast.round,
          phase_at_abandon: _ast.phase,
          rounds_completed_pct: (_ast.roundsTarget ?? 0) > 0
            ? Math.round((_ast.round / _ast.roundsTarget) * 100) : null,
          match_duration_min: matchStartTime
            ? Math.round((Date.now() - matchStartTime) / 60000) : null,
        });
        flush();
      }
      finalizeMatchSnapshot(matchController.getState(), { status: "finished", exitExplicit: true });
      _shell.stopClockLoop(true);
      resetMatchState();
      _shell.showScreen("splash");
    },
  });
}

function restartMatchWithSameSettings() {
  const st = matchController.getState();
  if (!st) return;
  const players = Array.isArray(st.players)
    ? st.players.map((player, idx) => ({
        id: player.id || `p${idx + 1}`,
        name: player.name,
        color: player.color,
      }))
    : [];
  if (players.length) {
    matchController.setPlayers(players);
  }
  matchController.startMatch({ language: getShellLanguage() });
  onMatchStarted({ state: matchController.getState(), isRematch: true });
  clearMatchWordFor("match");
  _shell.stopClockLoop(false);
  _shell.showScreen("match");
  _shell.renderMatch();
}

function promptMatchPlayAgain() {
  _shell.openConfirm({
    title: "matchPlayAgainTitle",
    body: "matchPlayAgainBody",
    acceptText: "matchPlayAgainYes",
    cancelText: "matchPlayAgainNo",
    onConfirm: () => restartMatchWithSameSettings(),
    onCancel: () => _shell.showScreen("splash"),
  });
}

// ── Match persistence ──────────────────────────────────────────────────────

function buildActiveMatchSnapshot(matchState, { status = "active", exitExplicit = false } = {}) {
  if (!matchState) return null;
  return {
    matchId: matchState.matchId,
    status,
    exitExplicit,
    lastSavedAt: Date.now(),
    matchState,
  };
}

function persistActiveMatchSnapshot(matchState) {
  if (!matchState) return;
  if (!matchState.isActive && !matchState.matchOver) return;
  const status = matchState.matchOver
    ? "finished"
    : matchState.isActive
      ? "active"
      : "inactive";
  const snapshot = buildActiveMatchSnapshot(matchState, { status });
  if (snapshot) {
    saveActiveMatch(snapshot);
  }
}

function scheduleActiveMatchSave(matchState) {
  if (activeMatchSaveTimer) return;
  activeMatchSaveTimer = window.setTimeout(() => {
    activeMatchSaveTimer = null;
    persistActiveMatchSnapshot(matchState || matchController.getState());
  }, 200);
}

function finalizeMatchSnapshot(matchState, { status = "finished", exitExplicit = false } = {}) {
  if (!matchState) {
    clearActiveMatch();
    return;
  }
  if (!matchState.isActive && !matchState.matchOver && !matchHasAnyScores(matchState)) {
    clearActiveMatch();
    return;
  }
  if (exitExplicit) {
    skipNextActiveMatchSave = true;
  }
  const snapshot = buildActiveMatchSnapshot(matchState, { status, exitExplicit });
  if (snapshot) {
    snapshot.savedAt = snapshot.lastSavedAt;
    upsertArchiveMatch(snapshot);
    clearActiveMatch();
  }
}

function restoreActiveMatchIfEligible() {
  const stored = loadActiveMatch();
  if (!isResumeEligible(stored)) return false;
  return restoreMatchFromSnapshot(stored);
}

function restoreMatchFromSnapshot(snapshot) {
  const normalized = normalizeMatchForResume(snapshot?.matchState);
  if (!normalized) return false;
  matchController.loadMatchState(normalized, { persist: true });
  _shell.tempMatchPrefs.value = buildMatchPrefs(normalized.preferencesRef || {});
  _shell.tempMatchPlayers.value = normalized.players.map((player) => ({
    id: player.id,
    name: player.name,
    color: player.color,
  }));
  restoredMatchActive = true;
  return true;
}

function formatStoredMatchSummary(snapshot) {
  if (!snapshot?.matchState) return { date: "", players: "" };
  const date = snapshot.lastSavedAt
    ? new Date(snapshot.lastSavedAt).toLocaleString(getShellLanguage() || "es")
    : "";
  const players = Array.isArray(snapshot.matchState.players)
    ? snapshot.matchState.players.map((p) => p.name).filter(Boolean).join(", ")
    : "";
  return { date, players };
}

function maybePromptRestoreStaleMatch({ onAccept, onDecline } = {}) {
  const stored = loadActiveMatch();
  if (!stored?.matchState) return false;
  if (stored.exitExplicit) return false;
  const status = stored.status || "active";
  if (status !== "active") return false;
  if (isResumeEligible(stored)) return false;

  const summary = formatStoredMatchSummary(stored);
  _shell.openConfirm({
    title: "confirmTitleResumeStale",
    body: "confirmBodyResumeStale",
    acceptText: "confirmAccept",
    cancelText: "cancel",
    bodyVars: summary,
    onConfirm: () => {
      const restored = restoreMatchFromSnapshot(stored);
      if (restored) {
        _shell.showScreen("match");
      }
      if (typeof onAccept === "function") onAccept(restored);
    },
    onCancel: () => {
      clearActiveMatch();
      if (typeof onDecline === "function") onDecline();
    },
  });
  return true;
}

function getRestoredMatchActive() {
  return restoredMatchActive;
}

function getAndClearSkipFlag() {
  const v = skipNextActiveMatchSave;
  skipNextActiveMatchSave = false;
  return v;
}

export function renderMatchTexts(setI18nById, setI18n) {
  setI18nById("scoreboardEditHint", "matchScoreboardEditHint");
  setI18nById("matchScoreboardOpenBtn", "matchScoreboardEdit", { attr: "aria-label" });
  setI18nById("matchScoreboardOpenBtn", "matchScoreboardEdit");
  setI18nById("matchTopbarHelpBtn", "helpQuickGuide", { attr: "aria-label" });
  setI18nById("setupTitle", "setupTitle");
  setI18nById("setupSubtitle", "setupSubtitle");
  setI18nById("playersTitle", "playersTitle");
  setI18nById("addPlayerBtn", "addPlayer");
  setI18nById("timersTitle", "timersTitle");
  setI18nById("strategyTimerLabel", "strategyTimerLabel");
  setI18nById("creationTimerLabel", "creationTimerLabel");
  setI18nById("startGameBtn", "startGame");
  setI18nById("liveTitle", "liveTitle");
  setI18nById("phaseTitle", "phaseTitle");
  setI18nById("strategyPhaseLabel", "strategyPhaseLabel");
  setI18nById("creationPhaseLabel", "creationPhaseLabel");
  setI18nById("startStrategyBtn", "startStrategy");
  setI18nById("startCreationBtn", "startCreation");
  setI18nById("goToScoringBtn", "goToScoring");
  setI18nById("scoringTitle", "scoringTitle");
  setI18nById("scoringNote", "scoringNote");
  setI18nById("saveBazaBtn", "saveBaza");
  setI18nById("editHistoryBtn", "editHistory");
  setI18nById("historyTitle", "historyTitle");
  setI18nById("backToLiveBtn", "backToLive");
  setI18nById("settingsTitle", "settingsTitle");
  setI18nById("settingsSoundLabel", "settingsSound");
  setI18nById("settingsMusicLabel", "settingsMusic");
  setI18nById("settingsLanguageLabel", "settingsLanguage");
  setI18nById("settingsAccountLabel", "settingsAccount");
  setI18nById("accountTitle", "accountTitle");
  setI18nById("accountNicknameLabel", "accountNicknameLabel");
  setI18nById("accountOptInLabel", "onboardingOptIn");
  setI18nById("accountLogoutLabel", "accountLogout");
  setI18nById("accountLogoutBtn", "accountLogout", { attr: "aria-label" });
  setI18nById("accountNicknameInput", "accountNicknameLabel", { attr: "aria-label" });
  setI18nById("accountNicknameInput", "onboardingPlaceholder", { attr: "placeholder" });
  setI18nById("supportTitle", "supportTitle");
  setI18nById("supportBody", "supportBody");
  setI18nById("supportCtaBtn", "supportCta");
  setI18nById("matchWinnersScoreBtn", "matchScoreboardOpen");
  setI18nById("matchWinnersRecordsBtn", "recordsOpen");
  setI18nById("matchWinnersRecordsNote", "matchWinnersRecordsNote");
  setI18nById("matchWinnersOkBtn", "matchWinnerOk");
  setI18nById("matchTitle", "matchTitle");
  setI18nById("matchConfigTitle", "matchConfigTitle");
  setI18nById("matchTopbarTitle", "matchConfigTitle");
  setI18nById("matchCustomizeBtn", "matchConfigCustomize");
  setI18nById("matchPlayersLabel", "matchPlayersLabel");
  setI18nById("matchPlayersCaption", "matchPlayersCaption");
  setI18nById("matchModeLabel", "matchModeLabel");
  setI18nById("matchModeRoundsBtn", "matchModeRounds");
  setI18nById("matchModePointsBtn", "matchModePoints");
  setI18nById("matchPhaseStrategyBtn", "matchPhaseStrategy");
  setI18nById("matchPhaseCreationBtn", "matchPhaseCreation");
  setI18nById("matchPhaseHelpBtn", "helpTitle", { attr: "aria-label" });
  setI18nById("matchDealerLabel", "matchDealerLabel");
  setI18nById("matchRoundsLabel", "matchRoundsLabel");
  setI18nById("matchPointsLabel", "matchPointsLabel");
  setI18nById("matchScoringLabel", "matchScoringLabel");
  setI18nById("matchRecordValidationLabel", "matchRecordValidationLabel");
  setI18nById("matchRecordValidationCaption", "matchRecordValidationCaptionOn");
  setI18nById("matchRulesCaption", "matchRulesInfo");
  setI18nById("matchRulesBtnText", "matchRulesConfigure");
  setI18nById("matchStrategyLabel", "matchStrategyLabel");
  setI18nById("matchCreationLabel", "matchCreationLabel");
  setI18nById("matchRulesLabel", "matchRulesTitle");
  setI18nById("matchRulesBtn", "matchRulesTitle", { attr: "aria-label" });
  setI18nById("matchScoreboardOpenBtn", "matchScoreboardOpen", { attr: "aria-label" });
  setI18nById("matchStartMatchBtn", "matchStartMatch");
  setI18nById("matchStrategyTimerTitle", "matchStrategyLabel");
  setI18nById("matchCreationTimerTitle", "matchCreationLabel");
  setI18nById("matchStartStrategyBtn", "matchStartStrategy", { attr: "aria-label" });
  setI18nById("matchStrategyFinishBtn", "matchFinish", { attr: "aria-label" });
  setI18nById("matchStrategyResetBtn", "matchStrategyReset", { attr: "aria-label" });
  setI18nById("matchStartCreationBtn", "matchStartCreation", { attr: "aria-label" });
  setI18nById("matchCreationFinishBtn", "matchFinish", { attr: "aria-label" });
  setI18nById("matchCreationResetBtn", "matchCreationReset", { attr: "aria-label" });
  setI18nById("matchNextRoundBtn", "matchEndRound");
  setI18nById("roundEndTitle", "matchRoundEndTitle");
  setI18nById("roundEndScoringTitle", "matchRoundScoringSubtitle");
  setI18nById("roundEndContinueBtn", "matchRoundContinue");
  setI18nById("roundEndAllWinBtn", "matchRoundAllWin");
  setI18nById("roundEndTieBreakBtn", "matchRoundTieBreak");
  setI18nById("roundEndBackBtn", "matchExit", { attr: "aria-label" });
  setI18nById("roundEndSettingsBtn", "settingsTitle", { attr: "aria-label" });
  setI18nById("roundEndHelpBtn", "helpQuickGuide", { attr: "aria-label" });
  setI18nById("roundIntroHelpBtn", "helpQuickGuide", { attr: "aria-label" });
  setI18nById("roundEndKeypadPrevBtn", "matchRoundKeypadPrev");
  setI18nById("roundEndKeypadNextBtn", "matchRoundKeypadNext");
  setI18nById("scoreboardKeypadCancelBtn", "cancel");
  setI18nById("scoreboardKeypadAcceptBtn", "confirmAccept");
  setI18nById("scoreboardTitle", "matchScoreboardTitle");
  setI18nById("scoreboardBackBtn", "matchExit", { attr: "aria-label" });
  setI18nById("scoreboardSettingsBtn", "settingsTitle", { attr: "aria-label" });
  setI18nById("scoreboardSaveBtn", "save");
  setI18nById("scoreboardCancelBtn", "cancel");
  setI18nById("scoreboardShareBtn", "scoreboardShare", { attr: "aria-label" });
  setI18nById("recordsTitle", "recordsTitle");
  setI18nById("recordsBackBtn", "matchExit", { attr: "aria-label" });
  setI18nById("recordsSettingsBtn", "settingsTitle", { attr: "aria-label" });
  setI18nById("splashRecordsBtn", "recordsOpen", { attr: "aria-label" });
  setI18nById("recordsTabWordsBtn", "recordsTabWords");
  setI18nById("recordsTabMatchesBtn", "recordsTabMatches");
  setI18nById("recordsWordPill", "recordsWordPill");
  setI18nById("recordsMatchPill", "recordsMatchPill");
  setI18nById("recordWordTitle", "recordWordTitle");
  setI18nById("recordWordIntro", "recordWordIntro");
  setI18nById("recordWordCaption", "recordWordCaption");
  setI18nById("recordWordInput", "recordWordPlaceholder", { attr: "placeholder" });
  setI18nById("recordWordInput", "recordWordPlaceholder", { attr: "aria-label" });
  setI18nById("recordWordClearBtn", "recordWordClear", { attr: "aria-label" });
  setI18nById("recordWordFeaturesHint", "recordWordFeaturesHint");
  setI18nById("recordWordSameColor", "recordWordSameColor");
  setI18nById("recordWordWildcard", "recordWordWildcard");
  setI18nById("recordWordDouble", "recordWordDouble");
  setI18nById("recordWordPlus", "recordWordPlus");
  setI18nById("recordWordMinus", "recordWordMinus");
  setI18nById("recordWordSkipBtn", "recordWordSkip");
  setI18nById("recordWordSaveBtn", "recordWordSave");
  setI18nById("rulesTitle", "matchRulesTitle");
  setI18nById("rulesInfoPill", "matchRulesInfo");
  setI18nById("rulesRestoreBtn", "matchRulesRestore");
  setI18nById("rulesCancelBtn", "cancel");
  setI18nById("rulesSaveBtn", "save");
  setI18nById("confirmTitle", "confirmTitle");
  setI18nById("confirmBody", "confirmBodyExit");
  setI18nById("confirmAcceptBtn", "confirmAccept");
  setI18nById("confirmCancelBtn", "cancel");
  setI18nById("playerNamesTitle", "matchPlayerNameTitle");
  setI18nById("matchPauseLabel", "matchPause");
  setI18nById("matchResumeLabel", "matchResume");
  getValidationSections().forEach((refs) => {
    setI18n(refs.title, "matchValidateTitle");
    setI18n(refs.input, "matchValidatePlaceholder", { attr: "placeholder" });
    setI18n(refs.validateBtn, "matchValidateAction", { attr: "aria-label" });
    setI18n(refs.rulesBtn, "matchRulesTitle", { attr: "aria-label" });
    updateRestoreButtonVisibility();
  });
}

export function setupMatchEventListeners() {
  const map = [
    ["matchExitBtn", () => confirmExitToSplash()],
    ["matchBackBtn", () => exitMatchDirect()],
    ["matchSettingsBtn", () => _shell.openSettingsModal()],
    ["matchScoreboardOpenBtn", () => openScoreboard()],
    ["matchCustomizeBtn", () => {
      _shell.matchConfigCustomizeOpen.value = true;
      renderMatchFromState(matchController.getState());
      const scrollEl = document.querySelector(".match-config-scroll");
      if (scrollEl) scrollEl.scrollTop = 0;
    }],
    ["matchTopbarHelpBtn", () => _shell.openQuickGuide("start")],
    ["matchStartMatchBtn", () => startMatchPlay()],
    ["matchStartStrategyBtn", () => startMatchPhase("strategy")],
    ["matchStrategyResetBtn", () => resetMatchPhase("strategy")],
    ["matchStartCreationBtn", () => startMatchPhase("creation")],
    ["matchCreationResetBtn", () => resetMatchPhase("creation")],
    ["matchStartCreationCtaBtn", () => startMatchPhase("creation")],
    ["matchStrategyFinishBtn", () => confirmFinishPhase("strategy")],
    ["matchCreationFinishBtn", () => confirmFinishPhase("creation")],
    ["matchNextRoundBtn", () => openRoundEndScreen()],
    ["roundEndBackBtn", () => _shell.showScreen("match")],
    ["roundEndSettingsBtn", () => _shell.openSettingsModal()],
    ["roundEndHelpBtn", () => _shell.openQuickGuide("scoring")],
    ["roundEndContinueBtn", () => handleRoundEndContinue()],
    ["roundEndAllWinBtn", () => handleRoundEndAllWin()],
    ["roundEndTieBreakBtn", () => handleRoundEndTieBreak()],
    ["roundIntroHelpBtn", () => {
      dismissRoundIntro();
      _shell.openQuickGuide("round-setup");
    }],
    ["scoreboardBackBtn", () => closeScoreboard()],
    ["scoreboardSettingsBtn", () => _shell.openSettingsModal()],
    ["scoreboardShareBtn", () => handleScoreboardShare()],
    ["scoreboardSaveBtn", () => applyScoreboardChanges()],
    ["scoreboardCancelBtn", () => resetScoreboardDraft()],
    ["recordsSettingsBtn", () => _shell.openSettingsModal()],
    ["recordsBackBtn", () => closeRecords()],
    ["recordsTabWordsBtn", () => setRecordsTab("words")],
    ["recordsTabMatchesBtn", () => setRecordsTab("matches")],
    ["splashRecordsBtn", () => openRecords()],
    ["recordWordSaveBtn", () => handleRecordWordSave()],
    ["recordWordSkipBtn", () => handleRecordWordSkip()],
    ["recordWordCloseBtn", () => handleRecordWordSkip()],
    ["matchWinnersScoreBtn", () => openScoreboard({ readOnly: true })],
    ["matchWinnersRecordsBtn", () => openRecordsFromWinners()],
    ["matchWinnersOkBtn", () => closeModal("match-winners", { reason: "action" })],
    ["rulesRestoreBtn", () => confirmRestoreDefaultRules()],
    ["rulesSaveBtn", () => saveRulesModal()],
    ["rulesCancelBtn", () => closeModal("validation-rules", { reason: "close" })],
  ];
  map.forEach(([id, handler]) => {
    const el = document.getElementById(id);
    if (el)
      el.addEventListener("click", () => {
        _shell.playClickFeedback();
        handler();
      });
  });

  const matchScoreboardEl = document.getElementById("matchScoreboard");
  if (matchScoreboardEl) {
    matchScoreboardEl.addEventListener("click", () => {
      if (_shell.currentScreen() !== "match") return;
      const st = matchController.getState();
      if (!st?.scoringEnabled) return;
      if (matchScoreboardEl.classList.contains("hidden")) return;
      openScoreboard();
    });
  }

  const roundEndScoringList = document.getElementById("roundEndScoringList");
  if (roundEndScoringList) {
    roundEndScoringList.addEventListener("click", (e) => {
      const row = e.target.closest(".round-end-score-row");
      if (!row) return;
      const playerId = row.dataset.playerId;
      if (row.classList.contains("is-locked")) {
        showRoundEndLockedWarning();
        return;
      }
      if (playerId) openRoundEndKeypad(playerId);
    });
  }

  const roundEndKeypad = document.getElementById("roundEndKeypad");
  if (roundEndKeypad) {
    roundEndKeypad.addEventListener("click", (e) => {
      if (e.target === roundEndKeypad) closeRoundEndKeypad();
    });
  }

  document.getElementById("roundEndKeypadCloseBtn")
    ?.addEventListener("click", () => closeRoundEndKeypad());
  document.getElementById("roundEndKeypadPrevBtn")
    ?.addEventListener("click", () => handleRoundEndKeypadNavigate("prev"));
  document.getElementById("roundEndKeypadNextBtn")
    ?.addEventListener("click", () => handleRoundEndKeypadNavigate("next"));

  const scoreboardTable = document.getElementById("scoreboardTable");
  if (scoreboardTable) {
    scoreboardTable.addEventListener("click", (e) => {
      const cell = e.target.closest(".scoreboard-score-cell");
      if (!cell || scoreboardReadOnly) return;
      const playerId = cell.dataset.playerId;
      const round = cell.dataset.round;
      if (!playerId || !round) return;
      openScoreboardKeypad(playerId, Number(round));
    });
  }

  const scoreboardKeypadEl = document.getElementById("scoreboardKeypad");
  if (scoreboardKeypadEl) {
    scoreboardKeypadEl.addEventListener("click", (e) => {
      if (e.target === scoreboardKeypadEl) closeScoreboardKeypad({ restore: true });
    });
  }

  document.getElementById("scoreboardKeypadCloseBtn")
    ?.addEventListener("click", () => closeScoreboardKeypad({ restore: true }));
  document.getElementById("scoreboardKeypadCancelBtn")
    ?.addEventListener("click", () => closeScoreboardKeypad({ restore: true }));
  document.getElementById("scoreboardKeypadAcceptBtn")
    ?.addEventListener("click", () => closeScoreboardKeypad());

  document.querySelectorAll(".record-word-chip").forEach((btn) => {
    btn.addEventListener("click", handleRecordWordToggle);
  });
  document.querySelectorAll("#recordWordLangToggle .validation-lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => setRecordWordLanguage(btn.dataset.lang));
  });

  const recordWordInput = document.getElementById("recordWordInput");
  if (recordWordInput) {
    recordWordInput.addEventListener("input", () => updateRecordWordSaveState());
  }
  const recordWordClearBtn = document.getElementById("recordWordClearBtn");
  if (recordWordClearBtn) {
    recordWordClearBtn.addEventListener("click", () => {
      const input = document.getElementById("recordWordInput");
      if (input) { input.value = ""; input.focus(); }
      updateRecordWordSaveState();
    });
  }

  const modeRoundsBtn = document.getElementById("matchModeRoundsBtn");
  const modePointsBtn = document.getElementById("matchModePointsBtn");
  const scoringToggle = document.getElementById("matchScoringToggle");
  const recordValidationToggle = document.getElementById("matchRecordValidationToggle");
  const matchRulesBtn = document.getElementById("matchRulesBtn");
  const matchPhaseHelpBtn = document.getElementById("matchPhaseHelpBtn");
  const matchPhaseStrategyBtn = document.getElementById("matchPhaseStrategyBtn");
  const matchPhaseCreationBtn = document.getElementById("matchPhaseCreationBtn");
  if (modeRoundsBtn)
    modeRoundsBtn.addEventListener("click", () => {
      _shell.playClickFeedback(); setMatchMode(MATCH_MODE_ROUNDS);
    });
  if (modePointsBtn)
    modePointsBtn.addEventListener("click", () => {
      _shell.playClickFeedback(); setMatchMode(MATCH_MODE_POINTS);
    });
  if (scoringToggle)
    scoringToggle.addEventListener("click", () => {
      _shell.playClickFeedback(); toggleScoring();
    });
  if (recordValidationToggle)
    recordValidationToggle.addEventListener("click", () => {
      _shell.playClickFeedback(); toggleRecordValidation();
    });
  if (matchRulesBtn)
    matchRulesBtn.addEventListener("click", () => {
      _shell.playClickFeedback();
      _shell.rulesEditContext.value = "temp";
      openRulesModal("temp");
    });
  if (matchPhaseHelpBtn)
    matchPhaseHelpBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const st = matchController.getState();
      _shell.openQuickGuide(_shell.getQuickGuideSectionForPhase(st?.phase));
    });
  if (matchPhaseStrategyBtn)
    matchPhaseStrategyBtn.addEventListener("click", () => {
      _shell.playClickFeedback(); handlePhaseTabClick("strategy");
    });
  if (matchPhaseCreationBtn)
    matchPhaseCreationBtn.addEventListener("click", () => {
      _shell.playClickFeedback(); handlePhaseTabClick("creation");
    });

  if (delegatedControlsBound) return;
  delegatedControlsBound = true;
  document.addEventListener("click", (e) => {
    const keypadBtn = e.target.closest("[data-keypad]");
    if (keypadBtn) {
      const key = keypadBtn.dataset.keypad;
      if (!key) return;
      if (keypadBtn.closest("#roundEndKeypadGrid")) { handleRoundEndKeypadKey(key); return; }
      if (keypadBtn.closest("#scoreboardKeypadGrid")) { handleScoreboardKeypadKey(key); return; }
      return;
    }
    const control = e.target.closest(
      "#matchPlayersMinus, #matchPlayersPlus, #matchRoundsMinus, #matchRoundsPlus, #matchPointsMinus, #matchPointsPlus, #matchStrategyMinus, #matchStrategyPlus, #matchCreationMinus, #matchCreationPlus"
    );
    if (!control) return;
    const button = control.closest("button") || control;
    if (button.disabled) return;
    switch (control.id) {
      case "matchPlayersMinus": adjustPlayers(-1); break;
      case "matchPlayersPlus": adjustPlayers(1); break;
      case "matchRoundsMinus": adjustRounds(-1); break;
      case "matchRoundsPlus": adjustRounds(1); break;
      case "matchPointsMinus": adjustPoints(-5); break;
      case "matchPointsPlus": adjustPoints(5); break;
      case "matchStrategyMinus": adjustMatchTimer("strategy", -10); break;
      case "matchStrategyPlus": adjustMatchTimer("strategy", 10); break;
      case "matchCreationMinus": adjustMatchTimer("creation", -10); break;
      case "matchCreationPlus": adjustMatchTimer("creation", 10); break;
      default: break;
    }
  });
}

// ─── Validator debug inspector ───────────────────────────────────────────────
// Long-press on the "validate" button (in the help screen's validator widget,
// or any other validation section) opens a modal that lets you select which
// engines to run and shows the verdict from each independently.
//
// Selection is persisted in localStorage; on localhost development the
// inspector starts with all three engines enabled by default.

const VALIDATOR_DEBUG_STORAGE_KEY = "ll-validator-debug-layers";
let validatorDebugSourceRefs = null; // refs of the validation section that opened the modal

function isLocalDevHost() {
  if (typeof location === "undefined") return false;
  return location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

function getValidatorDebugLayers() {
  try {
    const raw = localStorage.getItem(VALIDATOR_DEBUG_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return isLocalDevHost()
    ? LAYER_PRESETS.debug
    : LAYER_PRESETS.match;
}

function setValidatorDebugLayers(layers) {
  try { localStorage.setItem(VALIDATOR_DEBUG_STORAGE_KEY, JSON.stringify(layers)); } catch {}
}

function attachValidatorDebugLongPress(btn, refs) {
  let timer = null;
  let firedLongPress = false;
  const start = (ev) => {
    firedLongPress = false;
    clearTimeout(timer);
    try { btn.setPointerCapture(ev.pointerId); } catch {}
    timer = setTimeout(() => {
      timer = null;
      firedLongPress = true;
      openValidatorDebugModal(refs);
    }, 700);
  };
  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };
  btn.addEventListener("pointerdown", start);
  btn.addEventListener("pointerup", cancel);
  btn.addEventListener("pointercancel", cancel);
  // Note: do NOT listen on pointerleave — mobile browsers often fire it while
  // the finger is still pressed if it drifts a few px outside the bounding box.
  // The click handler is suppressed when the long-press fired.
  btn.addEventListener("click", (ev) => {
    if (firedLongPress) {
      ev.stopImmediatePropagation();
      ev.preventDefault();
      firedLongPress = false;
    }
  }, true); // capture phase so we run before the validation click handler
}

let validatorDebugWired = false;
function ensureValidatorDebugWired() {
  if (validatorDebugWired) return;
  const btn = document.getElementById("validatorDebugRunBtn");
  if (btn) {
    btn.addEventListener("click", runValidatorDebug);
    validatorDebugWired = true;
  }
}

function openValidatorDebugModal(refs) {
  validatorDebugSourceRefs = refs;
  ensureValidatorDebugWired();
  const layers = getValidatorDebugLayers();
  const cbLocal  = document.getElementById("validatorDebugLocal");
  const cbPublic = document.getElementById("validatorDebugPublic");
  const cbAi     = document.getElementById("validatorDebugAi");
  if (cbLocal)  cbLocal.checked  = layers.includes("local");
  if (cbPublic) cbPublic.checked = layers.includes("public");
  if (cbAi)     cbAi.checked     = layers.includes("ai");
  const results = document.getElementById("validatorDebugResults");
  if (results) results.innerHTML = '<div class="hint-empty">Pulsa "Probar" para ejecutar los motores seleccionados.</div>';
  openModal("validator-debug", { closable: true });
}

async function runValidatorDebug() {
  if (!validatorDebugSourceRefs) return;
  const input = validatorDebugSourceRefs.input;
  const word = (input?.value || "").trim();
  const results = document.getElementById("validatorDebugResults");
  if (!word) {
    if (results) results.innerHTML = '<div class="hint-empty">Escribe una palabra en el campo y vuelve a abrir el inspector.</div>';
    return;
  }
  const cbLocal  = document.getElementById("validatorDebugLocal");
  const cbPublic = document.getElementById("validatorDebugPublic");
  const cbAi     = document.getElementById("validatorDebugAi");
  const layers = [];
  if (cbLocal?.checked)  layers.push("local");
  if (cbPublic?.checked) layers.push("public");
  if (cbAi?.checked)     layers.push("ai");
  if (layers.length === 0) {
    if (results) results.innerHTML = '<div class="hint-empty">Selecciona al menos un motor.</div>';
    return;
  }
  setValidatorDebugLayers(layers);

  const language = matchController.getState()?.language || "es";
  const rulesText = typeof getValidationRules === "function" ? getValidationRules() : "";

  if (results) results.innerHTML = '<div class="hint-empty">Consultando motores…</div>';
  let out;
  try {
    out = await validateWordDebug(word, {
      language,
      layers,
      aiContext: { customRules: rulesText },
    });
  } catch (err) {
    if (results) results.innerHTML = `<div class="hint-empty">Error: ${err?.message || err}</div>`;
    return;
  }
  renderValidatorDebugResults(word, out);
}

function renderValidatorDebugResults(word, out) {
  const root = document.getElementById("validatorDebugResults");
  if (!root) return;
  const ICONS = { accepted: "✓", rejected: "✗", unknown: "?", skipped: "—" };
  const COLORS = {
    accepted: "#1e7f34",
    rejected: "#992d22",
    unknown:  "#7a6020",
    skipped:  "#666",
  };
  const rows = out.layers.map((r) => {
    const icon = ICONS[r.result] || "?";
    const color = COLORS[r.result] || "#666";
    const extra = r.error ? ` <span style="opacity:0.7">(${escapeForHtml(r.error)})</span>` : "";
    const ms = r.elapsedMs != null ? ` <span style="opacity:0.6">${r.elapsedMs}ms</span>` : "";
    return `<li style="color:${color}"><b>${icon} ${r.layer}</b>: ${r.result}${extra}${ms}</li>`;
  }).join("");
  root.innerHTML = `
    <div style="margin-bottom:6px;font-family:var(--font-heading);font-weight:700;color:#2f1b12;">
      <span style="text-transform:uppercase;letter-spacing:0.5px;">${escapeForHtml(word)}</span>
      <span style="opacity:0.6;font-size:11px;margin-left:6px;">[${out.language}]</span>
    </div>
    <ul style="list-style:none;padding:0;margin:0;font-family:var(--font-heading);font-size:14px;line-height:1.7;">${rows}</ul>
  `;
}

function escapeForHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
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
  sortRecords,
  saveRecords,
  renderRecordsScreen,
  closeRecords,
  setRecordsTab,
  canEnterWordRecords,
  upsertWordRecord,
  recordMatchAverages,
  applySimulatedRecords,
  finalizeWordRecordCandidates,
  getActivePlayers,
  getPlayersByIds,
  getPlayerIndexMap,
  getDealerIndex,
  getDealerInfo,
  matchHasAnyScores,
  formatSeconds,
  normalizeValidationWord,
  normalizePlayerName,
  clampRoundScore,
  isOddScore,
  getRoundEndPlayerLabel,
  formatRoundEndScoreDisplay,
  isScoreFilled,
  getScoreNumber,
  isScoreOutOfRange,
  isScoreValidForRecord,
  formatScoreboardName,
  getFirstOddRoundScore,
  renderMatchScoreboard,
  updateMatchTick,
  updateActionOverlayStates,
  setupActionOverlayListeners,
  renderMatchFromStateInner,
  dismissRoundIntro,
  updateScrollHintState,
  updateHorizontalScrollHintState,
  stopMatchTimer,
  showMatchWinners,
  showValidationResult,
  updateMatchWinnersRecordsUI,
  handleRoundEndAllWin,
  handleRoundEndTieBreak,
  clearMatchWordFor,
  clearStatusValidationFor,
  updateValidationControls,
  handleValidateSection,
  getValidationSections,
  createValidationSection,
  startMatchPhase,
  resetMatchPhase,
  finishMatchPhase,
  confirmFinishPhase,
  adjustMatchTimer,
  adjustPlayers,
  setMatchMode,
  adjustRounds,
  adjustPoints,
  toggleScoring,
  toggleRecordValidation,
  handlePhaseTabClick,
  buildMatchPrefs,
  getDefaultRoundsTarget,
  buildTempPlayers,
  syncTempPlayers,
  buildFinalPlayers,
  renderMatchPlayers,
  updateMatchStartButtonState,
  updateMatchConfigStepControls,
  showRoundEndLockedWarning,
  hasAllPlayerNames,
  buildActiveMatchSnapshot,
  persistActiveMatchSnapshot,
  scheduleActiveMatchSave,
  finalizeMatchSnapshot,
  restoreActiveMatchIfEligible,
  maybePromptRestoreStaleMatch,
  getRestoredMatchActive,
  getAndClearSkipFlag,
  cloneValidationRules,
  getValidationRules,
  onMatchStarted,
  setupMatchControllerEvents,
  updateMatchPreferences,
  startMatchPlay,
  resetMatchState,
  exitMatchDirect,
  confirmExitToSplash,
  restartMatchWithSameSettings,
  promptMatchPlayAgain,
  updateRestoreButtonVisibility,
  openRulesModal,
  applyDefaultRules,
  confirmRestoreDefaultRules,
  saveRulesModal,
};

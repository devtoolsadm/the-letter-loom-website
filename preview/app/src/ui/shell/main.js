// Unified score validation for round end and scoreboard
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
import {
  TEXTS,
  BULLET_CHAR,
  getShellLanguage,
  setShellLanguage,
  onShellLanguageChange,
  getAvailableLanguages,
  validateTexts,
} from "../../i18n/texts.js";
import {
  DEFAULT_STRATEGY_SECONDS,
  DEFAULT_CREATION_SECONDS,
  DEFAULT_ROUNDS_TARGET,
  DEFAULT_POINTS_TARGET,
  MIN_PHASE_SECONDS,
  MAX_PHASE_SECONDS,
  DEFAULT_PLAYER_COUNT,
  MIN_PLAYERS,
  MAX_PLAYERS,
  PLAYER_NAME_MAX,
  MIN_ROUND_SCORE,
  MAX_ROUND_SCORE,
  MATCH_MODE_ROUNDS,
  MATCH_MODE_POINTS,
  PLAYER_COLORS,
  PLAYER_COLORS_PASTEL,
  CREATION_TIMEUP_AUTO_ACTION_MS,
  ROUND_KEYPAD_AUTO_ZERO_ON_NAV,
  SIMULATE_MATCH_ON_START,
  SIMULATED_MATCH_STATE,
  SIMULATE_RECORDS_ON_START,
  SIMULATED_RECORDS,
  SIMULATED_MATCH_SEEDS,
  buildSimulatedMatchState,
  RECORD_MIN_POINTS,
  RECORD_AVG_PENALTY_K,
} from "../../core/constants.js";
import { matchController, validateWordRemote } from "../../core/matchController.js";
import { openModal, closeModal, closeTopModal } from "./modal.js";
import {
  initWakeLockManager,
  requestLock,
  releaseLock,
} from "../../core/wakeLockManager.js";
import { loadState, updateState } from "../../core/stateStore.js";
import { APP_VERSION } from "../../core/version.js";
import { logger, onLog, getLogs } from "../../core/logger.js";
import {
  loadActiveMatch,
  saveActiveMatch,
  clearActiveMatch,
  upsertArchiveMatch,
  normalizeMatchForResume,
  isResumeEligible,
  loadArchive,
  loadRecords,
} from "../../core/matchStorage.js";

const urlParams = new URLSearchParams(window.location.search);
const fromPWA = urlParams.get("fromPWA") === "1";
const fromInstall = urlParams.get("fromInstall") === "1";
const MANUAL_URL = "assets/doc/manual.pdf";
const HELP_QUICK_URL = null;
const HELP_VIDEO_URL = null;
const HELP_INSTAGRAM_URL = "https://www.instagram.com/the.letter.loom";
const HELP_TIKTOK_URL = "https://www.tiktok.com/@the.letter.loom";
const HELP_EMAIL = "info@theletterloom.com";
const HELP_WEB_URL = "https://theletterloom.com";

const appState = loadState();
const BASE_GAME_WIDTH =
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--game-width")) || 360;
const BASE_GAME_HEIGHT =
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--game-height")) || 640;
const AUTO_CONTINUE_ROUND_END = true;

let shellLanguage = getShellLanguage();
let shellTexts = TEXTS[shellLanguage];
let installButtonEl = null;
let pwaInstallEl = null;
let wakeLockActive = false;
let unsubscribeLanguage = null;
let currentScreen = "splash";
let soundOn = appState.settings.sound ?? true;
let musicOn = appState.settings.music ?? true;
let soundVolume = appState.settings.soundVolume ?? 50;
let musicVolume = appState.settings.musicVolume ?? 50;
let settingsSnapshot = null;
let tempSettings = {
  sound: soundOn,
  music: musicOn,
  soundVolume,
  musicVolume,
  language: shellLanguage,
};
let splashLoaderInterval = null;
let splashLoaderComplete = false;
let splashLoaderProgress = 0;
let hasScaledOnce = false;
let installedAppDetected = false;
let activeMatchSaveTimer = null;
let restoredMatchActive = false;
let skipNextActiveMatchSave = false;
let persistentStorageChecked = false;
let persistentStorageGranted = false;
let debugPanelTitleEl = null;
let debugFilterLabelEl = null;
let debugFilterSelectEl = null;
let creationTimeupTimer = null;
let creationTimeupCancelled = false;
let introAudio = null;
let matchConfigExpanded = false;
let clickAudio = null;
let clockAudio = null;
let tickAudio = null;
let timeAudio = null;
let modalOpenAudio = null;
let successAudio = null;
let failAudio = null;
let audioReady = false;
let clockLowTimeMode = false;
let audioCtx = null;
let musicGain = null;
let soundGain = null;
let musicSource = null;
let clickSource = null;
let clockSource = null;
let tickSource = null;
let timeSource = null;
let modalOpenSource = null;
let successSource = null;
let failSource = null;
let wakeLockTimer = null;
let winnersModalOpen = false;
let suppressWinnersPrompt = false;
let lastWinnersIds = [];
let scoreboardReturnWinners = false;
let simulatedStartActive = false;
let openPlayerColorIndex = null;
let openPlayerNameIndex = null;
let lastPlayerSwap = null;
let playerDragState = null;
let playerDragGhost = null;
let playerDragOffset = null;
let lastMatchPhase = null;
let dealerFocusTimer = null;
const WAKE_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const TIMEUP_VIBRATION_MS = 400;

// Match config controls (temporary until starting the match)
let tempMatchPrefs = buildMatchPrefs(appState.gamePreferences);
let tempMatchPlayers = buildTempPlayers(
  tempMatchPrefs.playersCount ?? DEFAULT_PLAYER_COUNT,
  appState.gamePreferences?.players || appState.matchState?.players || []
);
let roundEndScores = {};
let roundEndOrder = [];
let roundEndUnlocked = new Set();
let roundEndSelectedWinners = new Set();
let roundEndKeypadOpen = false;
let roundEndKeypadPlayerId = null;
let lastMatchWord = "";
let lastMatchWordFeatures = {
  sameColor: false,
  usedWildcard: false,
  doubleScore: false,
  plusPoints: false,
  minusPoints: false,
};
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
let scoreboardWordCandidatesDraft = null;
let scoreboardWordCandidatesDirty = false;
let scoreboardWordCandidatesMatchId = null;
let scoreboardDraft = null;
let scoreboardBase = null;
let scoreboardRounds = [];
let scoreboardPlayers = [];
let scoreboardDirty = false;
let scoreboardReadOnly = false;
let scoreboardInfoText = "";
let scoreboardRecordHighlight = null;
let scoreboardReturnScreen = "match";
let recordsReturnScreen = "scoreboard";
let recordsTab = "words";
let pausedBeforeScoreboard = null;
let scoreboardKeypadOpen = false;
let scoreboardKeypadPlayerId = null;
let scoreboardKeypadRound = null;
let scoreboardKeypadOrder = [];
let scoreboardKeypadInitialValue = null;
let delegatedControlsBound = false;

function getActivePlayers(matchState) {
  const players = Array.isArray(matchState?.players) ? matchState.players : [];
  const tieBreakIds = matchState?.tieBreak?.players;
  if (!Array.isArray(tieBreakIds) || !tieBreakIds.length) {
    return players;
  }
  const map = new Map(players.map((p) => [String(p.id), p]));
  return tieBreakIds
    .map((id) => map.get(String(id)))
    .filter(Boolean);
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
  };
}

function getDefaultRoundsTarget(playersCount) {
  const count = Number.isFinite(playersCount) ? playersCount : DEFAULT_PLAYER_COUNT;
  return count < 4 ? count * 2 : count;
}

function normalizePlayerName(value) {
  return String(value || "").trim().toLowerCase();
}

  function clampPlayerName(value) {
    return String(value || "").slice(0, PLAYER_NAME_MAX);
  }

  function clampRoundScore(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.min(MAX_ROUND_SCORE, Math.max(MIN_ROUND_SCORE, Math.round(num)));
  }

  function normalizeScoreInput(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const num = Number(raw);
    if (!Number.isFinite(num)) return "";
    return String(clampRoundScore(num));
  }

  function isOddScore(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return false;
    return Math.abs(num % 2) === 1;
  }

  function getRoundEndPlayerLabel(matchState, playerId) {
    const players = Array.isArray(matchState?.players) ? matchState.players : [];
    const player = players.find((p) => String(p.id) === String(playerId));
    if (!player) return "";
    const index = getPlayerIndexMap(matchState).get(String(playerId)) ?? 0;
    const prefix = shellTexts.matchRoundPlayerPrefix;
    const orderLabel = `${prefix}${index + 1}`;
    return player.name ? `${orderLabel} ${player.name}`.trim() : orderLabel;
  }

  function formatRoundEndScoreDisplay(value) {
    if (isRoundScoreEmpty(value)) return shellTexts.matchRoundScorePlaceholder;
    return String(value);
  }

  function getRoundEndWarningTargets() {
    return [
      document.getElementById("roundEndWarning"),
      document.getElementById("roundEndKeypadWarning"),
    ].filter(Boolean);
  }

  function canContinueRoundEnd(matchState) {
    if (!matchState?.scoringEnabled) return false;
    const players = getActivePlayers(matchState);
    const { missing, oddPlayer, outOfRangePlayer } = validateScores(players, roundEndScores);
    return !missing && !oddPlayer && !outOfRangePlayer;
  }

  function getRoundEndOrderIndex(matchState, playerId) {
    if (!roundEndOrder.length) {
      roundEndOrder = buildRoundEndOrder(matchState);
    }
    return roundEndOrder.indexOf(String(playerId));
  }

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
    const orderPrefix = shellTexts.matchRoundPlayerPrefix;
    const orderEl = document.getElementById("roundEndKeypadOrder");
    const nameEl = document.getElementById("roundEndKeypadName");
    if (orderEl) orderEl.textContent = `${orderPrefix}${orderIndex + 1}`;
    if (nameEl) nameEl.textContent = player.name || "";

    const valueEl = document.getElementById("roundEndKeypadValue");
    if (valueEl) {
      const value = roundEndScores[String(playerId)];
      const textValue = isRoundScoreEmpty(value) ? "" : formatRoundEndScoreDisplay(value);
      valueEl.textContent = "";
      const span = document.createElement("span");
      span.className = "round-end-keypad-value-text";
      span.textContent = textValue;
      valueEl.appendChild(span);
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
      setI18nById(
        "roundEndKeypadNextBtn",
        nextId ? "matchRoundKeypadNext" : "matchRoundKeypadFinish"
      );
    }
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
    clearMatchWordFor("round-keypad", false);
    clearStatusValidationFor("round-keypad");
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

  function applyRoundEndKeypadValue(matchState, playerId, value) {
    const id = String(playerId);
    roundEndScores[id] = value;
    roundEndUnlocked.add(id);
    clearRoundEndKeypadValidation();
    updateRoundEndLockState(matchState);
    updateRoundEndContinueState(matchState);
    updateRoundEndKeypad(matchState);
  }

  function clearRoundEndKeypadValidation() {
    const valueEl = document.getElementById("roundEndKeypadValue");
    if (valueEl) valueEl.classList.remove("is-invalid");
    const warnings = getRoundEndWarningTargets();
    warnings.forEach((warning) => warning.classList.add("hidden"));
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
      playValidationResultSound(false);
      warnings.forEach((warning) => {
        setI18n(warning, "matchRoundScoresOdd", { vars: { player: playerLabel } });
        warning.classList.toggle("hidden", false);
      });
      return { valid: false };
    }
    if (outOfRange) {
      playValidationResultSound(false);
      warnings.forEach((warning) => {
        setI18n(warning, "matchRoundScoresOutOfRange", {
          vars: { player: playerLabel, min: MIN_ROUND_SCORE, max: MAX_ROUND_SCORE },
        });
        warning.classList.toggle("hidden", false);
      });
      return { valid: false };
    }
    if (missing) {
      playValidationResultSound(false);
      warnings.forEach((warning) => {
        setI18n(warning, "matchRoundScoresMissing");
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
      const validation = validateRoundEndKeypadValue(st, currentId);
      if (!validation.valid) {
        return;
      }
      const raw = roundEndScores[String(currentId)];
      const points = Number(raw);
      const invalid = !isScoreValidForRecord(raw, { requireEven: true });
      const roundNumber = st.round;
      if (!invalid && Number.isFinite(points) && points >= RECORD_MIN_POINTS) {
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

function formatScoreboardScoreDisplay(value) {
  if (!isScoreFilled(value)) return shellTexts.matchRoundScorePlaceholder;
  return String(value);
}

function getScoreboardPlayerLabel(playerId) {
  const players = scoreboardPlayers || [];
  const idx = players.findIndex((p) => String(p.id) === String(playerId));
  if (idx < 0) return "";
  const orderPrefix = shellTexts.matchRoundPlayerPrefix;
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
    setI18n(note, "matchScoreboardOdd", {
      vars: {
        player: getScoreboardPlayerLabel(odd.playerId),
        round: odd.round,
      },
    });
    note.classList.remove("hidden");
    note.classList.add("has-icon");
  } else if (outOfRange) {
    setI18n(note, "matchScoreboardScoresOutOfRange", {
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
    setI18n(note, "matchScoreboardScoresMissing", {
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
  const orderPrefix = shellTexts.matchRoundPlayerPrefix;
  const orderEl = document.getElementById("scoreboardKeypadOrder");
  const nameEl = document.getElementById("scoreboardKeypadName");
  if (orderEl) orderEl.textContent = `${orderPrefix}${orderIndex + 1}`;
  if (nameEl) nameEl.textContent = player.name || "";

  const valueEl = document.getElementById("scoreboardKeypadValue");
  if (valueEl) {
    const value = scoreboardDraft?.[String(playerId)]?.[Number(round)];
    valueEl.textContent = isScoreFilled(value) ? String(value) : "";
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
  if (invalid || !Number.isFinite(points) || points < RECORD_MIN_POINTS) {
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

function isRoundScoreEmpty(value) {
  return value == null || String(value).trim() === "";
}

function isScoreValidForRecord(value, { requireEven = true } = {}) {
  if (!isScoreFilled(value)) return false;
  if (isScoreOutOfRange(value)) return false;
  if (getScoreNumber(value) < 0) return false;
  if (requireEven && isOddScore(value)) return false;
  return true;
}

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
      setI18n(warning, "matchRoundScoresOdd", {
        vars: { player: getRoundEndPlayerLabel(matchState, oddPlayer.id) },
      });
      warning.classList.toggle("hidden", false);
    } else if (outOfRangePlayer) {
      setI18n(warning, "matchRoundScoresOutOfRange", {
        vars: { player: getRoundEndPlayerLabel(matchState, outOfRangePlayer.id), min: MIN_ROUND_SCORE, max: MAX_ROUND_SCORE },
      });
      warning.classList.toggle("hidden", false);
    } else {
      setI18n(warning, "matchRoundScoresMissing");
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
    return getPlayersByIds(matchState, matchState.tieBreakPending.players);
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
      setI18n(titleEl, "matchRoundTiePrompt");
    } else if (!matchState.scoringEnabled && isPoints) {
      setI18n(titleEl, "matchRoundSelectReached", {
        vars: { points: matchState.pointsTarget ?? DEFAULT_POINTS_TARGET },
      });
    } else {
      setI18n(titleEl, "matchRoundSelectTop", {
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
    badge.textContent = `${shellTexts.matchRoundPlayerPrefix}${(orderIndex ?? 0) + 1}`;

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
  const orderPrefix = shellTexts.matchRoundPlayerPrefix;
  const label = `${orderPrefix}${nextIndex + 1} ${nextPlayer.name || ""}`.trim();
  openConfirm({
    title: "matchRoundOrderWarningTitle",
    body: "matchRoundOrderWarningBody",
    bodyVars: { player: label },
    acceptText: "confirmAccept",
    hideCancel: true,
  });
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
      playerDragState.overIndex = nextRow
        ? Number(nextRow.dataset.index)
        : listEl.querySelectorAll(".match-player-row").length;
    }
    return;
  }
  if (!row || !listEl.contains(row)) {
    listEl.appendChild(placeholder);
    if (playerDragState) {
      playerDragState.overIndex = listEl.querySelectorAll(".match-player-row").length;
    }
    return;
  }
  const rect = row.getBoundingClientRect();
  const insertAfter = typeof clientY === "number" && clientY > rect.top + rect.height / 2;
  row.classList.add("is-drop-target");
  if (insertAfter) {
    row.after(placeholder);
    if (playerDragState) {
      playerDragState.overIndex = Number(row.dataset.index) + 1;
    }
  } else {
    row.before(placeholder);
    if (playerDragState) {
      playerDragState.overIndex = Number(row.dataset.index);
    }
  }
}

function handlePlayerPointerMove(e) {
  if (!playerDragState) return;
  e.preventDefault();
  const dx = Math.abs(e.clientX - playerDragState.startX);
  const dy = Math.abs(e.clientY - playerDragState.startY);
  if (!playerDragState.moved && dx + dy < 4) {
    return;
  }
  if (!playerDragState.moved) {
    playerDragState.moved = true;
    const { rowEl, listEl } = playerDragState;
    if (rowEl) {
      rowEl.classList.add("is-dragging");
      createPlayerDragGhost(rowEl, e.clientX, e.clientY);
      updatePlayerDropIndicator(listEl, rowEl, e.clientY, rowEl);
    }
    listEl.classList.add("is-dragging");
  }
  updatePlayerDragGhost(e.clientX, e.clientY);
  const { listEl } = playerDragState;
  const target = document.elementFromPoint(e.clientX, e.clientY);
  const row = target?.closest(".match-player-row");
  updatePlayerDropIndicator(listEl, row, e.clientY, target);
}

function handlePlayerPointerUp() {
  if (!playerDragState) return;
  document.removeEventListener("pointermove", handlePlayerPointerMove);
  removePlayerDragGhost();
  const { fromIndex, overIndex, listEl } = playerDragState;
  clearPlayerDropIndicator(listEl);
  listEl.classList.remove("is-dragging");
  const row = listEl.querySelector(`[data-index="${fromIndex}"]`);
  if (row) row.classList.remove("is-dragging");
  const moved = playerDragState.moved;
  playerDragState = null;
  if (moved && Number.isFinite(overIndex) && overIndex !== fromIndex) {
    const list = [...tempMatchPlayers];
    const [moved] = list.splice(fromIndex, 1);
    if (!moved) {
      renderMatchPlayers();
      return;
    }
    let insertIndex = overIndex;
    if (insertIndex > fromIndex) {
      insertIndex -= 1;
    }
    list.splice(insertIndex, 0, moved);
    tempMatchPlayers = list;
    markPlayerSwap(fromIndex, insertIndex);
  }
  renderMatchPlayers();
}

function startPlayerPointerDrag(e, index, listEl) {
  e.preventDefault();
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
  const base = shellTexts.matchPlayerDefault;
  return base.replace("{index}", index + 1);
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
    list.push({
      name,
      color,
    });
  }
  return list;
}

function syncTempPlayers(count) {
  const n = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, count));
  if (!Array.isArray(tempMatchPlayers)) {
    tempMatchPlayers = [];
  }
  const list = [...tempMatchPlayers];
  if (list.length > n) {
    list.length = n;
  } else if (list.length < n) {
    for (let i = list.length; i < n; i += 1) {
      const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
      list.push({ name: "", color });
    }
  }
  const used = new Set();
  tempMatchPlayers = list.map((player, idx) => {
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
    return {
      ...player,
      name,
      color,
    };
  });
}

function buildPlayerFallbacks(count) {
  const knownNames = getKnownPlayerNames();
  const usedNames = new Set();
  tempMatchPlayers.forEach((player) => {
    if (player && player.name && player.name.trim()) {
      usedNames.add(normalizePlayerName(player.name));
    }
  });
  const fallbackNames = [];
  for (let i = 0; i < count; i += 1) {
    const base =
      (knownNames[i] && knownNames[i].trim()) || getDefaultPlayerName(i);
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
  const fallbackNames = buildPlayerFallbacks(tempMatchPlayers.length);
  return tempMatchPlayers.map((player, idx) => {
    const raw = clampPlayerName(player.name).trim();
    const candidate = raw || fallbackNames[idx] || getDefaultPlayerName(idx);
    const name = ensureUniquePlayerName(candidate, usedNames);
    return {
      ...player,
      name,
    };
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
    Array.isArray(tempMatchPlayers) && tempMatchPlayers.length
      ? tempMatchPlayers
      : matchState.players || [];
  const issueKey = getStartMatchIssue(players);
  startMatchBtn.disabled = Boolean(issueKey);
  if (hintEl) {
    if (issueKey) {
      setI18n(hintEl, issueKey);
      hintEl.classList.remove("hidden");
    } else {
      hintEl.classList.add("hidden");
    }
  }
}

function closePlayerNameModal() {
  openPlayerNameIndex = null;
  closeModal("player-names");
}

function renderPlayerNameModal() {
  const listEl = document.getElementById("playerNamesList");
  if (!listEl) return;
  listEl.innerHTML = "";
  if (openPlayerNameIndex == null) {
    const empty = document.createElement("div");
    empty.className = "player-name-empty";
    setI18n(empty, "matchPlayerNameEmpty");
    listEl.appendChild(empty);
    return;
  }
  const player = tempMatchPlayers[openPlayerNameIndex];
  if (!player) {
    closePlayerNameModal();
    return;
  }
  const usedNameValues = tempMatchPlayers
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
    setI18n(empty, "matchPlayerNameEmpty");
    listEl.appendChild(empty);
    return;
  }
  availableNames.forEach((name) => {
    const pill = document.createElement("div");
    pill.className = "player-name-pill";

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "player-name-pill-select";
    selectBtn.textContent = name;
    selectBtn.addEventListener("click", () => {
      playClickSfx();
      const nextName = clampPlayerName(name);
      tempMatchPlayers[openPlayerNameIndex] = { ...player, name: nextName };
      closePlayerNameModal();
      renderMatchPlayers();
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "player-name-pill-remove";
    setI18n(removeBtn, "matchPlayerNameRemove", { attr: "aria-label" });
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      playClickSfx();
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
  const count = tempMatchPrefs.playersCount ?? DEFAULT_PLAYER_COUNT;
  syncTempPlayers(count);
  listEl.innerHTML = "";
  const usedColors = tempMatchPlayers.map((p) => p.color);
  const shouldAnimateSwap =
    lastPlayerSwap && Date.now() - lastPlayerSwap.at < 600;
  if (!hasKnownNames && openPlayerNameIndex != null) {
    closePlayerNameModal();
  }

  tempMatchPlayers.forEach((player, index) => {
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
    setI18n(dragHandle, "matchPlayerDrag", { attr: "aria-label" });
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
      playClickSfx();
      const list = [...tempMatchPlayers];
      const temp = list[index - 1];
      list[index - 1] = list[index];
      list[index] = temp;
      tempMatchPlayers = list;
      openPlayerColorIndex = null;
      closePlayerNameModal();
      markPlayerSwap(index, index - 1);
      renderMatchPlayers();
    });

    const colorBtn = document.createElement("button");
    colorBtn.className = "match-player-color-button";
    colorBtn.type = "button";
    colorBtn.style.background = player.color;
    setI18n(colorBtn, "matchPlayerColor", { attr: "aria-label" });
    colorBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      playClickSfx();
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
        tempMatchPlayers[index] = { ...player, name: initialName };
      }
      setI18n(nameInput, "matchPlayerDefault", {
        attr: "placeholder",
        vars: { index: index + 1 },
      });

      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "match-player-name-clear";
      clearBtn.textContent = "x";
      setI18n(clearBtn, "matchPlayerNameClear", { attr: "aria-label" });
      clearBtn.classList.toggle("hidden", !nameInput.value);
      nameInput.addEventListener("input", (e) => {
        const nextName = clampPlayerName(e.target.value);
        if (nextName !== e.target.value) {
          e.target.value = nextName;
        }
        tempMatchPlayers[index] = { ...player, name: nextName };
        clearBtn.classList.toggle("hidden", !nextName);
        updateMatchStartButtonState();
      });
      clearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        playClickSfx();
        nameInput.value = "";
        tempMatchPlayers[index] = { ...player, name: "" };
        clearBtn.classList.add("hidden");
        updateMatchStartButtonState();
        nameInput.focus();
      });

    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "match-player-name-btn";
    setI18n(nameBtn, "matchPlayerNameSelect", { attr: "aria-label" });
    if (!hasKnownNames) {
      nameBtn.classList.add("hidden");
      nameBtn.disabled = true;
    }
    nameBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      playClickSfx();
      openPlayerColorIndex = null;
      openPlayerNameModal(index);
    });

    nameWrap.appendChild(nameInput);
    nameWrap.appendChild(clearBtn);

    const colorsRow = document.createElement("div");
    colorsRow.className = "match-player-color-palette";
    setI18n(colorsRow, "matchPlayerColor", { attr: "aria-label" });
    if (openPlayerColorIndex === index) {
      colorsRow.classList.add("is-open");
    }
    PLAYER_COLORS.forEach((color) => {
      if (usedByOthers.has(color)) return;
      const option = document.createElement("button");
      option.type = "button";
      option.className = "match-player-color-option";
      option.style.background = color;
      setI18n(option, "matchPlayerColor", { attr: "aria-label" });
      if (color === player.color) {
        option.classList.add("is-selected");
      }
      option.addEventListener("click", () => {
        if (player.color === color) return;
        playClickSfx();
        tempMatchPlayers[index] = { ...player, color };
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
    downBtn.disabled = index === tempMatchPlayers.length - 1;
    downBtn.addEventListener("click", () => {
      if (index >= tempMatchPlayers.length - 1) return;
      playClickSfx();
      const list = [...tempMatchPlayers];
      const temp = list[index + 1];
      list[index + 1] = list[index];
      list[index] = temp;
      tempMatchPlayers = list;
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
    if (!tempMatchPlayers[openPlayerNameIndex]) {
      closePlayerNameModal();
    } else {
      renderPlayerNameModal();
    }
  }
  updateMatchStartButtonState();
}

function cloneValidationRules(source) {
  if (!source) return null;
  if (typeof source === "string") return source;
  if (typeof source === "object") {
    return JSON.parse(JSON.stringify(source));
  }
  return null;
}

let confirmCallback = null;
let confirmCancelCallback = null;
let pausedBeforeConfirm = null;
let lastLowTimeTick = 0;
let lastRoundIntroKey = "";
let roundIntroTimer = null;
let roundIntroActive = false;
let pendingDealerFocusState = null;
let validationRules = appState.settings.validationRules ?? null; // persisted rules
let tempValidationRules = null; // temp during settings (init later)
let rulesEditContext = "live"; // "live" | "temp"
const validationSections = new Map();
let preserveMatchConfigOnExit = false;

tempValidationRules = cloneValidationRules(validationRules);

const WORD_CANDIDATES_KEY = "letterloom_word_candidates";

function loadWordCandidatesMap() {
  const raw = localStorage.getItem(WORD_CANDIDATES_KEY);
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
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

function openRecordWordModal(candidate, { pendingNext = null } = {}) {
  const input = document.getElementById("recordWordInput");
  recordWordModalState = candidate;
  recordWordPendingNext = pendingNext;
  recordWordModalStaging = false;
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
  }
  document.querySelectorAll(".record-word-chip").forEach((btn) => {
    const key = btn.dataset.feature;
    btn.classList.toggle("active", !!recordWordFeatures[key]);
  });
  if (input) {
    input.value = candidate?.word || "";
    input.focus();
  }
  updateRecordWordSaveState();
  openModal("record-word", { closable: true });
}

function openRecordWordModalFromScoreboard(candidate, { pendingNext = null } = {}) {
  const input = document.getElementById("recordWordInput");
  recordWordModalState = candidate;
  recordWordPendingNext = pendingNext;
  recordWordModalStaging = true;
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

function handleRecordWordSave() {
  const input = document.getElementById("recordWordInput");
  const word = String(input?.value || "").trim();
  if (!recordWordModalState || !recordWordModalState.matchId) return;
  if (!word) {
    if (input) input.focus();
    return;
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
  if (!saveBtn) return;
  const hasWord = String(input?.value || "").trim().length > 0;
  saveBtn.disabled = !hasWord;
  saveBtn.classList.toggle("disabled", !hasWord);
  if (clearBtn) clearBtn.classList.toggle("hidden", !hasWord);
}

function saveWordCandidatesMap(map) {
  localStorage.setItem(WORD_CANDIDATES_KEY, JSON.stringify(map || {}));
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

function removeWordCandidatesForMatch(matchId) {
  const map = loadWordCandidatesMap();
  if (map[matchId]) {
    delete map[matchId];
    saveWordCandidatesMap(map);
  }
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
  };
  if (refs.input) {
    refs.input.addEventListener("input", () => {
      sanitizeValidationInput(refs);
      clearStatusValidationFor(key);
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
  }
  if (refs.rulesBtn) {
    refs.rulesBtn.addEventListener("click", () => openRulesModal());
  }
  validationSections.set(key, refs);
}

  function initValidationSections() {
    createValidationSection("roundEndValidationMount", "match");
    createValidationSection("roundEndKeypadValidationMount", "round-keypad");
    createValidationSection("helpValidationMount", "help");
  }

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
function playClickSfx() {
  if (!soundOn || !clickAudio) return;
  // If routed through Web Audio, use the shared element with gain; otherwise clone
  if (audioCtx && soundGain && clickSource) {
    soundGain.gain.value = soundVolume / 100;
    try {
      clickAudio.currentTime = 0;
    } catch (e) {}
    clickAudio.play().catch(() => {});
    return;
  }
  const instance = clickAudio.cloneNode();
  instance.volume = (soundVolume / 100) * clickAudio.volume;
  instance.play().catch(() => {});
}
// 1x1 transparent GIF to avoid broken-image icons before real sources are assigned
const PLACEHOLDER_IMG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg==";

document.title = shellTexts.appTitle;

function clearI18nVars(el) {
  Object.keys(el.dataset).forEach((key) => {
    if (key.startsWith("i18nVar")) {
      delete el.dataset[key];
    }
  });
}

function applyI18nToNode(el) {
  const key = el?.dataset?.i18n;
  if (!key) return;
  const template = shellTexts[key];
  if (typeof template !== "string") return;
  let text = template;
  Object.keys(el.dataset).forEach((dataKey) => {
    if (!dataKey.startsWith("i18nVar")) return;
    const raw = dataKey.slice("i18nVar".length);
    if (!raw) return;
    const varName = raw.charAt(0).toLowerCase() + raw.slice(1);
    const value = el.dataset[dataKey];
    text = text.split(`{${varName}}`).join(value);
  });
  const attr = el.dataset.i18nAttr || "text";
  if (attr === "text") {
    el.textContent = text;
  } else {
    el.setAttribute(attr, text);
  }
}

function applyI18n(root = document) {
  if (!root) return;
  if (root.dataset?.i18n) {
    applyI18nToNode(root);
  }
  root.querySelectorAll("[data-i18n]").forEach((el) => applyI18nToNode(el));
}

function updateBodyLanguageClass(lang) {
  const body = document.body;
  if (!body) return;
  const prefix = "lang-";
  [...body.classList].forEach((cls) => {
    if (cls.startsWith(prefix)) body.classList.remove(cls);
  });
  if (lang) {
    body.classList.add(`${prefix}${String(lang).toLowerCase()}`);
  }
}

function setI18n(el, key, { attr = "text", vars = null } = {}) {
  if (!el) return;
  el.dataset.i18n = key;
  if (attr && attr !== "text") {
    el.dataset.i18nAttr = attr;
  } else {
    delete el.dataset.i18nAttr;
  }
  clearI18nVars(el);
  if (vars) {
    Object.entries(vars).forEach(([name, value]) => {
      const suffix = `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
      el.dataset[`i18nVar${suffix}`] = `${value}`;
    });
  }
  applyI18nToNode(el);
}

function setI18nById(id, key, options) {
  setI18n(document.getElementById(id), key, options);
}

function renderShellTexts() {
  const year = new Date().getFullYear();
  document.title = shellTexts.appTitle;
  setI18nById("appTitle", "appTitle");
  setI18nById("gameFooter", "footer", { vars: { year } });

  setI18nById("splashTitle", "splashTitle");
  setI18nById("splashSubtitle", "splashSubtitle");
  setI18nById("splashContinueBtn", "splashContinue");
  setI18nById("resumeMatchBtn", "splashResume");
  setI18nById("installAppBtn", "installButtonText");
  setI18nById("splashHelpBtn", "splashHelp");
  setI18nById("splashLoaderLabel", "splashLoadingLabel");
  setI18nById("helpTitle", "helpTitle");
  setI18nById("helpQuickBtn", "helpQuickGuide");
  setI18nById("helpVideoBtn", "helpVideo");
  setI18nById("helpManualBtn", "helpManual");
  setI18nById("helpInstagramBtn", "helpInstagram", { attr: "aria-label" });
  setI18nById("helpTiktokBtn", "helpTiktok", { attr: "aria-label" });
  setI18nById("helpEmailBtn", "helpEmail", { attr: "aria-label" });
  setI18nById("helpWebBtn", "helpWeb", { attr: "aria-label" });
  setI18nById("helpInstagramShort", "helpInstagramShort");
  setI18nById("helpTiktokShort", "helpTiktokShort");
  setI18nById("helpEmailShort", "helpEmailShort");
  setI18nById("helpWebShort", "helpWebShort");
  setI18nById("helpFooter", "helpFooter", { vars: { year, version: APP_VERSION } });
  setI18nById("scoreboardEditHint", "matchScoreboardEditHint");
  setI18nById("matchScoreboardOpenBtn", "matchScoreboardEdit", { attr: "aria-label" });
  setI18nById("matchScoreboardOpenBtn", "matchScoreboardEdit");

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
  setI18nById("settingsSaveBtn", "save");
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
  setI18nById("matchSummaryConfigBtn", "matchConfigConfigure");
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
  setI18nById("roundEndKeypadPrevBtn", "matchRoundKeypadPrev");
  setI18nById("roundEndKeypadNextBtn", "matchRoundKeypadNext");
  setI18nById("scoreboardKeypadCancelBtn", "cancel");
  setI18nById("scoreboardKeypadAcceptBtn", "confirmAccept");
  setI18nById("scoreboardTitle", "matchScoreboardTitle");
  setI18nById("scoreboardBackBtn", "matchExit", { attr: "aria-label" });
  setI18nById("scoreboardSettingsBtn", "settingsTitle", { attr: "aria-label" });
  setI18nById("scoreboardSaveBtn", "save");
  setI18nById("scoreboardCancelBtn", "cancel");
  setI18nById("recordsTitle", "recordsTitle");
  setI18nById("recordsBackBtn", "matchExit", { attr: "aria-label" });
  setI18nById("recordsSettingsBtn", "settingsTitle", { attr: "aria-label" });
  setI18nById("splashRecordsBtn", "recordsOpen", { attr: "aria-label" });
  setI18nById("recordsTabWordsBtn", "recordsTabWords");
  setI18nById("recordsTabMatchesBtn", "recordsTabMatches");
  setI18nById("recordsWordPill", "recordsWordPill");
  setI18nById("recordsMatchPill", "recordsMatchPill");
  setI18nById("recordWordTitle", "recordWordTitle");
  setI18nById("recordWordCaption", "recordWordCaption");
  setI18nById("recordWordInput", "recordWordPlaceholder", { attr: "placeholder" });
  setI18nById("recordWordInput", "recordWordPlaceholder", { attr: "aria-label" });
  setI18nById("recordWordClearBtn", "recordWordClear", { attr: "aria-label" });
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

  validationSections.forEach((refs) => {
    setI18n(refs.title, "matchValidateTitle");
    setI18n(refs.input, "matchValidatePlaceholder", { attr: "placeholder" });
    setI18n(refs.validateBtn, "matchValidateAction", { attr: "aria-label" });
    setI18n(refs.rulesBtn, "matchRulesTitle", { attr: "aria-label" });
    updateRestoreButtonVisibility();
  });

  updateInstallCopy();
  updateDebugFilterLabels();
  renderLanguageSelector();
  renderSettingsLanguageSelector();
  updateManifestLink();
  updateSoundToggle();
  updateSettingsControls();
  updateLanguageButton();
  updateInstallButtonVisibility();
}

function updateDebugFilterLabels() {
  if (debugPanelTitleEl) {
    debugPanelTitleEl.textContent = shellTexts.debugLogTitle || "Debug Log";
  }
  if (debugFilterLabelEl) {
    debugFilterLabelEl.textContent = shellTexts.debugLogFilterLabel || "Filtro";
  }
  if (debugFilterSelectEl) {
    const options = debugFilterSelectEl.options;
    const labels = [
      shellTexts.debugLogFilterDebug || "Debug",
      shellTexts.debugLogFilterInfo || "Info",
      shellTexts.debugLogFilterWarn || "Warn",
      shellTexts.debugLogFilterError || "Error",
    ];
    for (let i = 0; i < options.length && i < labels.length; i += 1) {
      options[i].textContent = labels[i];
    }
  }
}

function openConfirm({
  title,
  body,
  acceptText,
  cancelText,
  onConfirm,
  onCancel,
  hideCancel = false,
  titleVars = null,
  bodyVars = null,
}) {
  const titleKey = title || "confirmTitle";
  const bodyKey = body || "";
  const acceptKey = acceptText || "confirmAccept";
  const cancelKey = cancelText || "cancel";
  setI18n(document.getElementById("confirmTitle"), titleKey, { vars: titleVars });
  if (bodyKey) {
    setI18n(document.getElementById("confirmBody"), bodyKey, { vars: bodyVars });
  } else {
    const bodyEl = document.getElementById("confirmBody");
    if (bodyEl) {
      bodyEl.textContent = "";
      delete bodyEl.dataset.i18n;
      delete bodyEl.dataset.i18nAttr;
      clearI18nVars(bodyEl);
    }
  }
  setI18nById("confirmAcceptBtn", acceptKey);
  setI18nById("confirmCancelBtn", cancelKey);
  const cancelBtn = document.getElementById("confirmCancelBtn");
  if (cancelBtn) {
    cancelBtn.classList.toggle("hidden", !!hideCancel);
    cancelBtn.disabled = !!hideCancel;
    cancelBtn.setAttribute("aria-hidden", hideCancel ? "true" : "false");
  }
  playModalOpenSound();
  pausedBeforeConfirm = null;
  const stForConfirm = matchController.getState();
  if (stForConfirm?.phase === "strategy-run") {
    pausedBeforeConfirm = "strategy";
    matchController.pause();
    stopClockLoop(false);
  } else if (stForConfirm?.phase === "creation-run") {
    pausedBeforeConfirm = "creation";
    matchController.pause();
    stopClockLoop(false);
  }
  confirmCallback = typeof onConfirm === "function" ? onConfirm : null;
  confirmCancelCallback = typeof onCancel === "function" ? onCancel : null;
  playModalOpenSound();
  openModal("confirm", { closable: true });
}

function handleConfirmAccept() {
  if (confirmCallback) {
    try {
      confirmCallback();
    } catch (e) {
      logger.warn("Confirm callback failed", e);
    }
  }
  confirmCallback = null;
  confirmCancelCallback = null;
  pausedBeforeConfirm = null;
  closeModal("confirm", { reason: "action" });
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el && typeof value === "string") {
    el.textContent = value;
  }
}

function preventMobileZoom() {
  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (event) => {
      const target = event.target;
      const isInteractive =
        target instanceof Element &&
        target.closest(
          "button, input, textarea, select, a, [role='button'], [data-keypad]"
        );
      const now = Date.now();
      if (!isInteractive && now - lastTouchEnd <= 350) {
        event.preventDefault();
      }
      lastTouchEnd = now;
    },
    { passive: false }
  );
  ["gesturestart", "gesturechange", "gestureend"].forEach((evt) =>
    document.addEventListener(evt, (e) => e.preventDefault())
  );
}

function preventRightClick() {
  document.addEventListener("contextmenu", (e) => e.preventDefault());
}

function setupWakeLock() {
  const videoEl = document.getElementById("videoWakeLockWorkaround");
  const statusEl = document.getElementById("wakeLockStatus");
  initWakeLockManager({
    videoEl,
    statusEl,
    messages: {
      activeStandard: shellTexts.wakeLockStatusActiveStandard,
      released: shellTexts.wakeLockStatusReleased,
      activeFallback: shellTexts.wakeLockStatusActiveFallback,
      fallbackFailed: shellTexts.wakeLockStatusFallbackFailed,
      inactive: shellTexts.wakeLockStatusInactive,
    },
    showDebug: false,
  });
}

function isDesktop() {
  return !/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Tablet|Mobile/i.test(
    navigator.userAgent
  );
}

function getGameDimensions() {
  const root = getComputedStyle(document.documentElement);
  return {
    width: parseFloat(root.getPropertyValue("--game-width")),
    height: parseFloat(root.getPropertyValue("--game-height")),
  };
}

function getViewportZoom() {
  if (window.visualViewport && typeof window.visualViewport.scale === "number") {
    return window.visualViewport.scale;
  }
  const { width, height } = getGameDimensions();
  return Math.min(window.innerWidth / width, window.innerHeight / height);
}

function isStandaloneApp() {
  const mode = getDisplayMode();
  return mode === "fullscreen" || mode === "standalone" || window.navigator.standalone === true;
}

function getDisplayMode() {
  if (window.matchMedia) {
    if (window.matchMedia("(display-mode: fullscreen)").matches) return "fullscreen";
    if (window.matchMedia("(display-mode: standalone)").matches) return "standalone";
  }
  return "browser";
}

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || 
        (navigator.userAgent.includes('Mac') && 'ontouchend' in document);
}

function isLocalHost() {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") return true;
  if (host.endsWith(".local")) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  const m = host.match(/^172\.(\d+)\./);
  if (m) {
    const n = Number(m[1]);
    return n >= 16 && n <= 31;
  }
  return false;
}

function isOfflineStandaloneIOS() {
  return isIOS() && isStandaloneApp() && navigator.onLine === false;
}

function createDownload() {
  if (isIOS() || isStandaloneApp() || !('download' in document.createElement('a'))) {
    return (link, filename) => downloadWithBlob(link, filename);
  } else {
    return (link, filename) => downloadWithAnchor(link, filename);
  }
}

function getFilenameFromLink(link) {
  try { 
    const url = new URL(link, window.location.href);
    const path = url.pathname;
    const lastSegment = path.substring(path.lastIndexOf('/') + 1);
    return lastSegment || '';
  } catch {
    return '';
  }
}


function downloadWithAnchor(link, filename) {
  const a = document.createElement('a');
  a.href = link;
  // If filename is provided, use it; otherwise, extract from link
  if (typeof filename === 'string' && filename.length > 0) {
    a.download = filename;
  } else {
    a.download = getFilenameFromLink(link);
  }
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function downloadWithBlob(link, filename) {
  fetch(link)
    .then(response => response.blob())
    .then(blob => {
      const fileURL = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = fileURL;
      // If filename is provided, use it; otherwise, extract from link
      if (typeof filename === 'string' && filename.length > 0) {
        a.download = filename;
      } else {
        a.download = getFilenameFromLink(link);
      }
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(fileURL);
    })
    .catch(error => console.error('Download error (with blob):', error));
}

function switchLanguage(nextLang) {
  if (!TEXTS[nextLang] || nextLang === shellLanguage) return;
  shellLanguage = setShellLanguage(nextLang);
}

function renderLanguageSelector() {
  const select = document.getElementById("languageSelect");
  if (!select) return;
  select.innerHTML = "";
  getAvailableLanguages().forEach((code) => {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = getLanguageName(code);
    select.appendChild(option);
  });
  select.value = shellLanguage;
  buildLanguageDropdown(select);
}

function setupLanguageSelector() {
  const select = document.getElementById("languageSelect");
  if (!select) return;
  renderLanguageSelector();
  select.addEventListener("change", (evt) => {
    const targetLang = evt.target.value;
    switchLanguage(targetLang);
  });
}

function renderSettingsLanguageSelector() {
  const dropdown = document.getElementById("settingsLanguageDropdown");
  const codeEl = document.getElementById("settingsLanguageCode");
  if (!dropdown || !codeEl) return;
  dropdown.innerHTML = "";
  const current = tempSettings.language || shellLanguage;
  getAvailableLanguages().forEach((code) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = getLanguageName(code);
    btn.dataset.value = code;
    if (code === current) btn.classList.add("active");
    btn.addEventListener("click", () => {
      tempSettings.language = code;
      applyLiveSettings(tempSettings, { persist: false });
      closeSettingsLanguageDropdown();
    });
    dropdown.appendChild(btn);
  });
  codeEl.textContent = getLanguageName(current);
}

function buildLanguageDropdown(select) {
  // Header dropdown removed; settings dropdown is built separately.
}

function toggleLanguageDropdown(force) {
  // Header dropdown removed
}

function closeLanguageDropdown() {
  toggleLanguageDropdown(false);
}

function toggleSettingsLanguageDropdown(force) {
  const control = document.getElementById("settingsLangControl");
  const dropdown = document.getElementById("settingsLanguageDropdown");
  const btn = document.getElementById("settingsLanguageButton");
  if (!control || !dropdown || !btn) return;
  const shouldOpen =
    typeof force === "boolean" ? force : !control.classList.contains("open");
  control.classList.toggle("open", shouldOpen);
  dropdown.hidden = !shouldOpen;
  btn.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

function closeSettingsLanguageDropdown() {
  toggleSettingsLanguageDropdown(false);
}

function getLanguageName(code) {
  return TEXTS[code]?.languageName;
}

function checkOrientationOverlay() {
  const overlay = document.getElementById("orientation-overlay");
  const overlayRoot = document.getElementById("orientation-root");
  const gameRoot = document.getElementById("game-root");
  const msg = document.getElementById("orientation-message");
  if (!overlay || !overlayRoot || !gameRoot) return;
  const isLandscape = window.innerWidth > window.innerHeight;
  const allowLandscape = currentScreen === "scoreboard";
  if (isLandscape && !isDesktop() && !allowLandscape) {
    overlay.classList.add("active");
    overlayRoot.style.display = "flex";
    gameRoot.style.display = "none";
    if (msg) {
      msg.textContent = shellTexts.orientationMessage;
    }
  } else {
    overlay.classList.remove("active");
    overlayRoot.style.display = "none";
    gameRoot.style.display = "flex";
  }
}

function scaleGame() {
  const gameRoot = document.getElementById("game-root");
  const overlayRoot = document.getElementById("orientation-root");
  if (!gameRoot || !overlayRoot) return;
  const isLandscape = window.innerWidth > window.innerHeight;
  const allowLandscape = currentScreen === "scoreboard" && !isDesktop();
  const rootStyle = document.documentElement.style;
  if (allowLandscape && isLandscape) {
    rootStyle.setProperty("--game-width", `${BASE_GAME_HEIGHT}px`);
    rootStyle.setProperty("--game-height", `${BASE_GAME_WIDTH}px`);
  } else {
    rootStyle.setProperty("--game-width", `${BASE_GAME_WIDTH}px`);
    rootStyle.setProperty("--game-height", `${BASE_GAME_HEIGHT}px`);
  }
  const { width, height } = getGameDimensions();
  const w = window.innerWidth;
  const h = window.innerHeight;
  const scale = Math.min(w / width, h / height);
  gameRoot.style.transform = `scale(${scale})`;
  gameRoot.style.left = `${(w - width * scale) / 2}px`;
  gameRoot.style.top = `${(h - height * scale) / 2}px`;

  const overlayWidth = height;
  const overlayHeight = width;
  const scaleOverlay = Math.min(w / overlayWidth, h / overlayHeight);
  overlayRoot.style.transform = `scale(${scaleOverlay})`;
  overlayRoot.style.left = `${(w - overlayWidth * scaleOverlay) / 2}px`;
  overlayRoot.style.top = `${(h - overlayHeight * scaleOverlay) / 2}px`;

  checkOrientationOverlay();
  if (!hasScaledOnce) {
    hasScaledOnce = true;
    document.body.classList.add("shell-ready");
  }
}

function setupNavigation() {
  const map = [
    ["splashContinueBtn", () => {
      const prompted = maybePromptRestoreStaleMatch({
        onDecline: () => showScreen("match"),
      });
      if (!prompted) showScreen("match");
    }],
    ["resumeMatchBtn", () => showScreen("match")],
    ["splashHelpBtn", () => showScreen("help")],
    ["helpBtn", () => showScreen("help")],
    ["helpBackBtn", () => showScreen("splash")],
    ["helpQuickBtn", () => openQuickGuide()],
    ["helpVideoBtn", () => openHelpVideo()],
    ["helpManualBtn", () => openManual()],
    ["helpSettingsBtn", () => openSettingsModal()],
    ["helpInstagramBtn", () => openSocialLink("instagram")],
    ["helpTiktokBtn", () => openSocialLink("tiktok")],
    ["helpEmailBtn", () => openSocialLink("email")],
    ["helpWebBtn", () => openSocialLink("web")],
    ["matchExitBtn", () => confirmExitToSplash()],
    ["matchBackBtn", () => exitMatchDirect()],
    ["matchSettingsBtn", () => openSettingsModal()],
    ["matchScoreboardOpenBtn", () => openScoreboard()],
    ["matchSummaryConfigBtn", () => {
      matchConfigExpanded = true;
      renderMatchFromState(matchController.getState());
      const scrollEl = document.querySelector(".match-config-scroll");
      if (scrollEl) scrollEl.scrollTop = 0;
    }],
    ["matchStartMatchBtn", () => startMatchPlay()],
    ["matchStartStrategyBtn", () => startMatchPhase("strategy")],
    ["matchStrategyResetBtn", () => resetMatchPhase("strategy")],
    ["matchStartCreationBtn", () => startMatchPhase("creation")],
    ["matchCreationResetBtn", () => resetMatchPhase("creation")],
    ["matchStartCreationCtaBtn", () => startMatchPhase("creation")],
    ["matchStrategyFinishBtn", () => confirmFinishPhase("strategy")],
    ["matchCreationFinishBtn", () => confirmFinishPhase("creation")],
    ["matchNextRoundBtn", () => openRoundEndScreen()],
    ["roundEndBackBtn", () => {
      roundEndScores = {};
      roundEndUnlocked = new Set();
      roundEndSelectedWinners = new Set();
      showScreen("match");
    }],
    ["roundEndSettingsBtn", () => openSettingsModal()],
    ["roundEndContinueBtn", () => handleRoundEndContinue()],
    ["roundEndAllWinBtn", () => handleRoundEndAllWin()],
    ["roundEndTieBreakBtn", () => handleRoundEndTieBreak()],
    ["scoreboardBackBtn", () => closeScoreboard()],
    ["scoreboardSettingsBtn", () => openSettingsModal()],
    ["scoreboardSaveBtn", () => applyScoreboardChanges()],
    ["scoreboardCancelBtn", () => resetScoreboardDraft()],
    ["recordsSettingsBtn", () => openSettingsModal()],
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
    ["confirmAcceptBtn", () => handleConfirmAccept()],
    ["confirmCancelBtn", () => handleConfirmCancel()],
  ];
  map.forEach(([id, handler]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", handler);
  });

  setupDelegatedControls();

  const matchScoreboard = document.getElementById("matchScoreboard");
  if (matchScoreboard) {
    matchScoreboard.addEventListener("click", () => {
      if (currentScreen !== "match") return;
      const st = matchController.getState();
      if (!st?.scoringEnabled) return;
      if (matchScoreboard.classList.contains("hidden")) return;
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
      if (e.target === roundEndKeypad) {
        closeRoundEndKeypad();
      }
    });
  }

  const roundEndKeypadCloseBtn = document.getElementById("roundEndKeypadCloseBtn");
  if (roundEndKeypadCloseBtn) {
    roundEndKeypadCloseBtn.addEventListener("click", () => closeRoundEndKeypad());
  }

  const roundEndKeypadPrevBtn = document.getElementById("roundEndKeypadPrevBtn");
  if (roundEndKeypadPrevBtn) {
    roundEndKeypadPrevBtn.addEventListener("click", () =>
      handleRoundEndKeypadNavigate("prev")
    );
  }

  const roundEndKeypadNextBtn = document.getElementById("roundEndKeypadNextBtn");
  if (roundEndKeypadNextBtn) {
    roundEndKeypadNextBtn.addEventListener("click", () =>
      handleRoundEndKeypadNavigate("next")
    );
  }

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

  const scoreboardKeypad = document.getElementById("scoreboardKeypad");
  if (scoreboardKeypad) {
    scoreboardKeypad.addEventListener("click", (e) => {
      if (e.target === scoreboardKeypad) {
        closeScoreboardKeypad({ restore: true });
      }
    });
  }

  const scoreboardKeypadCloseBtn = document.getElementById("scoreboardKeypadCloseBtn");
  if (scoreboardKeypadCloseBtn) {
    scoreboardKeypadCloseBtn.addEventListener("click", () =>
      closeScoreboardKeypad({ restore: true })
    );
  }

  const scoreboardKeypadCancelBtn = document.getElementById("scoreboardKeypadCancelBtn");
  if (scoreboardKeypadCancelBtn) {
    scoreboardKeypadCancelBtn.addEventListener("click", () =>
      closeScoreboardKeypad({ restore: true })
    );
  }

  const scoreboardKeypadAcceptBtn = document.getElementById("scoreboardKeypadAcceptBtn");
  if (scoreboardKeypadAcceptBtn) {
    scoreboardKeypadAcceptBtn.addEventListener("click", () => closeScoreboardKeypad());
  }

  const confirmCancel = document.getElementById("confirmCancelBtn");
  if (confirmCancel) {
    confirmCancel.addEventListener("click", () => handleConfirmCancel());
  }

  document.querySelectorAll(".record-word-chip").forEach((btn) => {
    btn.addEventListener("click", handleRecordWordToggle);
  });

  const recordWordInput = document.getElementById("recordWordInput");
  if (recordWordInput) {
    recordWordInput.addEventListener("input", () => updateRecordWordSaveState());
  }
  const recordWordClearBtn = document.getElementById("recordWordClearBtn");
  if (recordWordClearBtn) {
    recordWordClearBtn.addEventListener("click", () => {
      const input = document.getElementById("recordWordInput");
      if (input) {
        input.value = "";
        input.focus();
      }
      updateRecordWordSaveState();
    });
  }

  const addPlayerBtn = document.getElementById("addPlayerBtn");
  if (addPlayerBtn) {
    addPlayerBtn.addEventListener("click", () => {
      const list = document.getElementById("playerList");
      if (!list) return;
      const item = document.createElement("li");
      const count = list.children.length + 1;
      item.textContent = `${shellTexts.playerLabel} ${count}`;
      list.appendChild(item);
    });
  }

  const soundBtn = document.getElementById("soundToggleBtn");
  if (soundBtn) {
    soundBtn.addEventListener("click", () => {
      soundOn = !soundOn;
      updateState({ settings: { sound: soundOn } });
      updateSoundToggle();
      updateSettingsControls();
    });
  }

  document.querySelectorAll("[data-modal-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modalId = btn.dataset.modalOpen;
      if (!modalId) return;
      const closable = btn.dataset.modalClosable !== "0";
      if (modalId === "settings") {
        openSettingsModal();
      } else {
        openModal(modalId, { closable });
      }
    });
  });

  document.querySelectorAll("[data-modal-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modalId = btn.dataset.modalClose;
      if (modalId) closeModal(modalId, { reason: "close" });
    });
  });

  document.querySelectorAll("[data-modal-close-top]").forEach((btn) => {
    btn.addEventListener("click", () => closeTopModal());
  });

  const settingsSoundSlider = document.getElementById("settingsSoundSlider");
  const settingsSoundIcon = document.getElementById("settingsSoundIcon");
  if (settingsSoundSlider) {
    settingsSoundSlider.addEventListener("input", (e) => {
      tempSettings.soundVolume = clampVolume(e.target.value);
      tempSettings.sound = tempSettings.soundVolume > 0;
      applyLiveSettings(tempSettings, { persist: false });
    });
  }
  if (settingsSoundIcon) {
    settingsSoundIcon.addEventListener("click", () => {
      playClickSfx();
      toggleVolumeIcon("sound");
    });
  }

  const settingsMusicSlider = document.getElementById("settingsMusicSlider");
  const settingsMusicIcon = document.getElementById("settingsMusicIcon");
  if (settingsMusicSlider) {
    settingsMusicSlider.addEventListener("input", (e) => {
      tempSettings.musicVolume = clampVolume(e.target.value);
      tempSettings.music = tempSettings.musicVolume > 0;
      applyLiveSettings(tempSettings, { persist: false });
    });
  }
  if (settingsMusicIcon) {
    settingsMusicIcon.addEventListener("click", () => {
      playClickSfx();
      toggleVolumeIcon("music");
    });
  }

  const settingsLanguageIcon = document.getElementById("settingsLanguageIcon");
  if (settingsLanguageIcon) {
    settingsLanguageIcon.addEventListener("click", () => {
      playClickSfx();
      cycleLanguage();
    });
  }
  const settingsLangBtn = document.getElementById("settingsLanguageButton");
  const settingsLangControl = document.getElementById("settingsLangControl");
  if (settingsLangBtn && settingsLangControl) {
    settingsLangBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      playClickSfx();
      toggleSettingsLanguageDropdown();
    });
    document.addEventListener("click", (e) => {
      if (!settingsLangControl.contains(e.target)) {
        closeSettingsLanguageDropdown();
      }
    });
  }

  const settingsSave = document.getElementById("settingsSaveBtn");
  if (settingsSave) {
    settingsSave.addEventListener("click", () => {
      applySettingsFromTemp();
      closeModal("settings", { reason: "action", action: "apply" });
    });
  }

  const modeRoundsBtn = document.getElementById("matchModeRoundsBtn");
  const modePointsBtn = document.getElementById("matchModePointsBtn");
  const modeSwitch = document.querySelector(".match-mode-switch");
  const scoringToggle = document.getElementById("matchScoringToggle");
  const matchRulesBtn = document.getElementById("matchRulesBtn");
  const matchPhaseHelpBtn = document.getElementById("matchPhaseHelpBtn");
  const matchPhaseStrategyBtn = document.getElementById("matchPhaseStrategyBtn");
  const matchPhaseCreationBtn = document.getElementById("matchPhaseCreationBtn");
  if (modeRoundsBtn) modeRoundsBtn.addEventListener("click", () => setMatchMode(MATCH_MODE_ROUNDS));
  if (modePointsBtn) modePointsBtn.addEventListener("click", () => setMatchMode(MATCH_MODE_POINTS));
  if (scoringToggle) scoringToggle.addEventListener("click", toggleScoring);
  if (matchRulesBtn)
    matchRulesBtn.addEventListener("click", () => {
      rulesEditContext = "temp";
      openRulesModal("temp");
    });
  if (matchPhaseHelpBtn)
    matchPhaseHelpBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  if (matchPhaseStrategyBtn)
    matchPhaseStrategyBtn.addEventListener("click", () => handlePhaseTabClick("strategy"));
  if (matchPhaseCreationBtn)
    matchPhaseCreationBtn.addEventListener("click", () => handlePhaseTabClick("creation"));
}

function setupDelegatedControls() {
  if (delegatedControlsBound) return;
  delegatedControlsBound = true;
  document.addEventListener("click", (e) => {
    const keypadBtn = e.target.closest("[data-keypad]");
    if (keypadBtn) {
      const key = keypadBtn.dataset.keypad;
      if (!key) return;
      if (keypadBtn.closest("#roundEndKeypadGrid")) {
        handleRoundEndKeypadKey(key);
        return;
      }
      if (keypadBtn.closest("#scoreboardKeypadGrid")) {
        handleScoreboardKeypadKey(key);
        return;
      }
      return;
    }

    const control = e.target.closest(
      "#matchPlayersMinus, #matchPlayersPlus, #matchRoundsMinus, #matchRoundsPlus, #matchPointsMinus, #matchPointsPlus, #matchStrategyMinus, #matchStrategyPlus, #matchCreationMinus, #matchCreationPlus"
    );
    if (!control) return;
    const button = control.closest("button") || control;
    if (button.disabled) return;
    switch (control.id) {
      case "matchPlayersMinus":
        adjustPlayers(-1);
        break;
      case "matchPlayersPlus":
        adjustPlayers(1);
        break;
      case "matchRoundsMinus":
        adjustRounds(-1);
        break;
      case "matchRoundsPlus":
        adjustRounds(1);
        break;
      case "matchPointsMinus":
        adjustPoints(-5);
        break;
      case "matchPointsPlus":
        adjustPoints(5);
        break;
      case "matchStrategyMinus":
        adjustMatchTimer("strategy", -10);
        break;
      case "matchStrategyPlus":
        adjustMatchTimer("strategy", 10);
        break;
      case "matchCreationMinus":
        adjustMatchTimer("creation", -10);
        break;
      case "matchCreationPlus":
        adjustMatchTimer("creation", 10);
        break;
      default:
        break;
    }
  });
}

function openManual() {
  playClickSfx();
  const triggerDownload = createDownload();
  triggerDownload(MANUAL_URL, "LetterLoom_Manual.pdf");
}

function openQuickGuide() {
  playClickSfx();
  if (HELP_QUICK_URL) {
    window.open(HELP_QUICK_URL, "_blank", "noopener");
    return;
  }
  // fallback to manual
  openManual();
}

function openHelpVideo() {
  playClickSfx();
  if (HELP_VIDEO_URL) {
    window.open(HELP_VIDEO_URL, "_blank", "noopener");
  } else {
  logger.debug("Help video not available yet");
  }
}

function openSocialLink(kind) {
  playClickSfx();
  if (kind === "instagram" && HELP_INSTAGRAM_URL) {
    window.open(HELP_INSTAGRAM_URL, "_blank", "noopener");
    return;
  }
  if (kind === "tiktok" && HELP_TIKTOK_URL) {
    window.open(HELP_TIKTOK_URL, "_blank", "noopener");
    return;
  }
  if (kind === "email" && HELP_EMAIL) {
    window.location.href = `mailto:${HELP_EMAIL}`;
    return;
  }
  if (kind === "web" && HELP_WEB_URL) {
    window.open(HELP_WEB_URL, "_blank", "noopener");
    return;
  }
  logger.debug("Help link not available");
}

function initMatch() {
  if (SIMULATE_MATCH_ON_START && isLocalHost()) {
    applySimulatedMatch();
  }
  if (SIMULATE_RECORDS_ON_START && isLocalHost()) {
    applySimulatedRecords();
  }
  if (restoreActiveMatchIfEligible()) {
    showScreen("match");
  }
  const snap = matchController.getState();
  if (!snap) return;
  renderMatchFromState(snap);
}

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

function matchHasAnyScores(matchState) {
  const players = matchState?.players || [];
  return players.some((player) => Array.isArray(player.rounds) && player.rounds.length > 0);
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
  tempMatchPrefs = buildMatchPrefs(normalized.preferencesRef || {});
  tempMatchPlayers = normalized.players.map((player) => ({
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
    ? new Date(snapshot.lastSavedAt).toLocaleString(shellLanguage || "es")
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
  openConfirm({
    title: "confirmTitleResumeStale",
    body: "confirmBodyResumeStale",
    acceptText: "confirmAccept",
    cancelText: "cancel",
    bodyVars: summary,
    onConfirm: () => {
      const restored = restoreMatchFromSnapshot(stored);
      if (restored) {
        showScreen("match");
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

function applySimulatedMatch() {
  if (window.__simulatedMatchApplied) return false;
  if (!SIMULATED_MATCH_STATE || !SIMULATED_MATCH_STATE.players) return false;
  window.__simulatedMatchApplied = true;

  const normalized = normalizeMatchForResume(SIMULATED_MATCH_STATE);
  const snapshot = buildActiveMatchSnapshot(normalized, { status: "active" });
  if (snapshot) {
    snapshot.lastSavedAt = normalized.updatedAt || snapshot.lastSavedAt;
    saveActiveMatch(snapshot);
  }
  return true;
}

function formatSeconds(val) {
  const v = Math.max(0, Math.round(val));
  const m = Math.floor(v / 60)
    .toString()
    .padStart(2, "0");
  const s = (v % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function formatPhaseDuration(val) {
  const v = Math.max(0, Math.round(val));
  const minutes = Math.floor(v / 60);
  const seconds = v % 60;
  if (minutes === 0) {
    return `${seconds}${shellTexts.matchSecondAbbrev}`;
  }
  if (seconds === 0) {
    return `${minutes}${shellTexts.matchMinuteAbbrev}`;
  }
  return `${minutes}${shellTexts.matchMinuteAbbrev} ${seconds}${shellTexts.matchSecondAbbrev}`;
}

function formatPhaseDurationFull(val) {
  const v = Math.max(0, Math.round(val));
  const minutes = Math.floor(v / 60);
  const seconds = v % 60;
  return `${minutes}${shellTexts.matchMinuteAbbrev} ${seconds}${shellTexts.matchSecondAbbrev}`;
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

function parseHexColor(hex) {
  if (typeof hex !== "string") return null;
  const raw = hex.trim().replace("#", "");
  const value =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return { r, g, b };
}

function toHex({ r, g, b }) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

function getDealerPalette(color) {
  const rgb = parseHexColor(color);
  const forcedText =
    typeof document !== "undefined"
      ? getComputedStyle(document.documentElement)
          .getPropertyValue("--player-name-color")
          .trim()
      : "";
  if (!rgb) {
    return {
      bg: "#d9c79f",
      border: "#c5af7d",
      text: forcedText || "#2f1b12",
    };
  }
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  const text = forcedText || (luminance > 0.62 ? "#2f1b12" : "#ffffff");
  const border = toHex({
    r: rgb.r * 0.7,
    g: rgb.g * 0.7,
    b: rgb.b * 0.7,
  });
  return { bg: color, border, text };
}

function getDealerInfo(matchState) {
  const players = getActivePlayers(matchState);
  if (!players.length) {
    return { name: "", color: null };
  }
  const index = getDealerIndex(matchState);
  const player = players[index] || {};
  const name = player.name?.trim() || `${shellTexts.playerLabel} ${index + 1}`;
  return { name, color: player.color || null };
}

function formatScoreboardName(name) {
  const trimmed = name.trim();
  if (!trimmed) return name;
  if (/\s/.test(trimmed) || trimmed.length < 9) {
    return trimmed;
  }
  const mid = Math.ceil(trimmed.length / 2);
  return `${trimmed.slice(0, mid)}\u200B${trimmed.slice(mid)}`;
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
        : shellTexts.matchRoundScorePlaceholder;
      label.classList.toggle("is-negative", isScoreFilled(value) && getScoreNumber(value) < 0);
      label.classList.toggle("is-invalid", isScoreOutOfRange(value));
    }
  });
}

function renderScoreboardScreen(matchState) {
  const table = document.getElementById("scoreboardTable");
  const tableHeader = document.getElementById("scoreboardTableHeaderRow");
  const tableLeft = document.getElementById("scoreboardTableLeftCol");
  const tableCorner = document.getElementById("scoreboardTableCorner");
  const tableShell = document.getElementById("scoreboardTableShell");
  const editHint = document.getElementById("scoreboardEditHint");
  const note = document.getElementById("scoreboardNote");
  const actionButtons = document.getElementById("scoreboardActionButtons");
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
  if (editHint) {
    if (scoreboardReadOnly) {
      if (scoreboardInfoText) {
        editHint.textContent = scoreboardInfoText;
        editHint.classList.remove("hidden");
      } else {
        editHint.classList.add("hidden");
      }
    } else {
      editHint.textContent = shellTexts.matchScoreboardEditHint || "";
      editHint.classList.remove("hidden");
    }
  }

  if (!rounds.length || !players.length) {
    tableCorner.textContent = "";
    tableShell.classList.add("is-empty");
    setI18n(emptyEl, "matchScoreboardEmpty");
    emptyEl.classList.remove("hidden");
    return;
  }
  tableShell.classList.remove("is-empty");
  emptyEl.classList.add("hidden");

  tableCorner.className =
    "scoreboard-cell scoreboard-header scoreboard-player-cell scoreboard-corner";
  setI18n(tableCorner, "matchScoreboardPlayerHeader");
  rounds.forEach((round) => {
    const header = document.createElement("div");
    header.className = "scoreboard-cell scoreboard-header";
    const label = shellTexts.matchScoreboardRoundShort.replace("{round}", round);
    header.textContent = label;
    tableHeader.appendChild(header);
  });

  const totals = getScoreboardTotals(players, rounds, scoreboardDraft);
  const maxTotal = Math.max(...Array.from(totals.values()), 0);
  const roundMax = getScoreboardRoundMax(rounds, players, scoreboardDraft);
  const overallMax = getScoreboardOverallMax(rounds, players, scoreboardDraft);
  const orderPrefix = shellTexts.matchRoundPlayerPrefix;

  players.forEach((player, idx) => {
    const id = String(player.id);
    const palette = getDealerPalette(player.color || "#d9c79f");
    const playerCell = document.createElement("div");
    playerCell.className = "scoreboard-cell scoreboard-player-cell";
    playerCell.dataset.playerId = id;
    playerCell.style.setProperty("--player-color", player.color || "#d9c79f");
    playerCell.style.setProperty("--player-border", palette.border);
    playerCell.style.setProperty("--player-text", palette.text);
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
    name.textContent = player.name || `${shellTexts.playerLabel} ${idx + 1}`;
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
  const tableWrap = document.getElementById("scoreboardTableWrap");
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
    setI18n(
      boardTitle,
      matchState.scoringEnabled ? "matchScoreboardTitle" : "matchScoreboardOrderTitle"
    );
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
    if (isDealer) {
      item.style.setProperty("--dealer-bg", palette.bg);
      item.style.setProperty("--dealer-border", palette.border);
      item.style.setProperty("--dealer-text", palette.text);
    }

    const top = document.createElement("div");
    top.className = "match-score-top";
    const nameEl = document.createElement("span");
    nameEl.className = "match-score-name";
    const rawName = player.name || `${shellTexts.playerLabel} ${idx + 1}`;
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
      pointsEl.textContent = String(score);
      pointsEl.classList.toggle("is-negative", score < 0);
      meta.appendChild(pointsEl);
    }

    const leaderBadge = document.createElement("span");
    leaderBadge.className = "match-score-leader";
    leaderBadge.setAttribute("aria-hidden", "true");

    const dealerBadge = document.createElement("span");
    dealerBadge.className = "match-score-dealer";
    dealerBadge.textContent = shellTexts.matchDealerLabel.replace(":", "").trim();

    item.appendChild(top);
    if (matchState.scoringEnabled) {
      item.appendChild(meta);
    }
    item.appendChild(leaderBadge);
    item.appendChild(dealerBadge);
    boardGrid?.appendChild(item);
  });
}

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

function clampPhaseSeconds(val) {
  const num = Number(val);
  if (Number.isNaN(num)) return MIN_PHASE_SECONDS;
  return Math.min(MAX_PHASE_SECONDS, Math.max(MIN_PHASE_SECONDS, Math.round(num)));
}

function renderMatch() {
  renderMatchFromState(matchController.getState());
}

function renderRoundEndScreen() {
  const matchState = matchController.getState();
  if (!matchState) return;

  const scoringSection = document.getElementById("roundEndScoringSection");
  const scoringList = document.getElementById("roundEndScoringList");
  const scoringEnabled = !!matchState.scoringEnabled;
  const tieBreakPending =
    Array.isArray(matchState?.tieBreakPending?.players) &&
    matchState.tieBreakPending.players.length > 0;

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
  const orderPrefix = shellTexts.matchRoundPlayerPrefix;
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
    dealerBadge.textContent = shellTexts.matchDealerLabel;
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

/* Timer border progress helper (disabled for now).
function setTimerProgress(card, remaining, total) {
  if (!card) return;
  const totalSeconds = Number(total) || 0;
  const remainingSeconds = Math.max(0, Number(remaining) || 0);
  const progress =
    totalSeconds > 0 ? Math.min(1, remainingSeconds / totalSeconds) : 0;
  card.style.setProperty("--timer-progress", progress.toFixed(4));
}
*/

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
    strategyValueEl.textContent = st.phase === "strategy-timeup" ? shellTexts.matchTimeUp : formatSeconds(stratRemaining);
  }
  if (creationValueEl) {
    creationValueEl.textContent =
      st.phase === "creation-timeup" ? shellTexts.matchTimeUp : formatSeconds(creationRemaining);
  }

  const strategyCard = document.getElementById("matchStrategyTimerCard");
  const creationCard = document.getElementById("matchCreationTimerCard");

  if (strategyCard) {
    strategyCard.classList.toggle(
      "time-pressure",
      st.phase === "strategy-run" && st.remaining <= 10 && st.remaining > 5
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
      st.phase === "creation-run" && st.remaining <= 10 && st.remaining > 5
    );
    creationCard.classList.toggle(
      "time-pressure-urgent",
      st.phase === "creation-run" && st.remaining <= 5
    );
    creationCard.classList.toggle("timeup", st.phase === "creation-timeup");
  }
}

function renderMatchFromState(matchState) {
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
  const modeCaption = document.getElementById("matchModeCaption");
  const summaryBlock = document.getElementById("matchConfigSummary");
  const summaryCaption = document.getElementById("matchSummaryCaption");
  const summaryDetails = document.getElementById("matchSummaryDetails");
  const modeBlock = document.getElementById("matchModeBlock");
  const advancedBlock = document.getElementById("matchConfigAdvanced");
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
    matchConfigExpanded = false;
  }
  const showSummary = matchState.phase === "config" && !matchConfigExpanded;
  if (summaryBlock) summaryBlock.classList.toggle("hidden", !showSummary);
  if (modeBlock) modeBlock.classList.toggle("hidden", !matchConfigExpanded);
  if (advancedBlock) advancedBlock.classList.toggle("hidden", !matchConfigExpanded);
  applyPhaseValue(strategyVal, stratTotal);
  applyPhaseValue(creationVal, creationTotal);
  if (playersVal)
    playersVal.textContent =
      tempMatchPrefs.playersCount ?? matchState.players?.length ?? DEFAULT_PLAYER_COUNT;
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
  if (scoringToggle) {
    scoringToggle.textContent = "";
    scoringToggle.classList.toggle("active", matchState.scoringEnabled);
    scoringToggle.setAttribute("aria-pressed", matchState.scoringEnabled ? "true" : "false");
  }
  if (scoringCaption) {
    setI18n(
      scoringCaption,
      matchState.scoringEnabled ? "matchScoringCaptionOn" : "matchScoringCaptionOff"
    );
  }
  if (modeCaption) {
    if (matchState.mode === MATCH_MODE_POINTS) {
      const pointsTarget = matchState.pointsTarget ?? DEFAULT_POINTS_TARGET;
      setI18n(modeCaption, "matchWinnerByPoints", {
        vars: { points: pointsTarget },
      });
    } else {
      const roundsTarget = matchState.roundsTarget ?? DEFAULT_ROUNDS_TARGET;
      setI18n(modeCaption, "matchWinnerByRounds", {
        vars: { rounds: roundsTarget },
      });
    }
  }
  if (summaryCaption) {
    if (matchState.mode === MATCH_MODE_POINTS) {
      const pointsTarget = matchState.pointsTarget ?? DEFAULT_POINTS_TARGET;
      setI18n(summaryCaption, "matchWinnerByPoints", {
        vars: { points: pointsTarget },
      });
    } else {
      const roundsTarget = matchState.roundsTarget ?? DEFAULT_ROUNDS_TARGET;
      setI18n(summaryCaption, "matchWinnerByRounds", {
        vars: { rounds: roundsTarget },
      });
    }
  }
  if (summaryDetails) {
    const scoringKey = matchState.scoringEnabled
      ? "matchConfigSummaryScoringOn"
      : "matchConfigSummaryScoringOff";
    setI18n(summaryDetails, "matchConfigSummaryDetails", {
      vars: {
        strategy: formatPhaseDurationFull(stratTotal),
        creation: formatPhaseDurationFull(creationTotal),
        scoring: shellTexts[scoringKey],
      },
    });
  }

  if (topbarTitle) {
    if (matchState.phase === "config") {
      setI18n(topbarTitle, "matchConfigTitle");
    } else if (matchState.tieBreak?.players?.length) {
      const tieIndex = matchState.tieBreak.index || 1;
      setI18n(topbarTitle, "matchTieBreakTitle", { vars: { index: tieIndex } });
    } else {
      delete topbarTitle.dataset.i18n;
      delete topbarTitle.dataset.i18nAttr;
      const roundTemplate = shellTexts.matchRound;
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
    strategyValueEl.textContent = strategyTimeup ? shellTexts.matchTimeUp : formatSeconds(stratRemaining);
    strategyValueEl.classList.toggle("timeup", strategyTimeup);
  } else {
    setText(
      "matchStrategyTimerValue",
      strategyTimeup ? shellTexts.matchTimeUp : formatSeconds(stratRemaining)
    );
  }
  if (creationValueEl) {
    creationValueEl.textContent = creationTimeup ? shellTexts.matchTimeUp : formatSeconds(creationRemaining);
    creationValueEl.classList.toggle("timeup", creationTimeup);
  } else {
    setText(
      "matchCreationTimerValue",
      creationTimeup ? shellTexts.matchTimeUp : formatSeconds(creationRemaining)
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
    scheduleCreationTimeupAutoAdvance();
  } else {
    clearCreationTimeupAutoAdvance(true);
  }

  if (roundCard) roundCard.classList.toggle("hidden", showConfig);
  if (configBlock) configBlock.classList.toggle("hidden", !showConfig);
  if (matchBackBtn) matchBackBtn.classList.toggle("hidden", !showConfig);
  if (matchExitBtn) matchExitBtn.classList.toggle("hidden", showConfig);
  if (strategyCard) {
    strategyCard.classList.toggle("hidden", !showStrategyTimers);
    strategyCard.classList.toggle(
      "time-pressure",
      matchState.phase === "strategy-run" && matchState.remaining <= 10
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
      matchState.phase === "creation-run" && matchState.remaining <= 10
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
      setI18nById("matchStartStrategyBtn", "matchStartStrategy", { attr: "aria-label" });
    } else if (phase === "strategy-run") {
      stratBtn.disabled = false;
      setTimerButtonIcon(stratBtn, "icon-pause");
      setI18nById("matchStartStrategyBtn", "matchPause", { attr: "aria-label" });
    } else if (phase === "strategy-paused") {
      stratBtn.disabled = false;
      setTimerButtonIcon(stratBtn, "icon-play");
      setI18nById("matchStartStrategyBtn", "matchResume", { attr: "aria-label" });
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
    setI18nById("matchStrategyResetBtn", "matchStrategyReset", { attr: "aria-label" });
  }

  if (creatBtn) {
    const phase = matchState.phase;
    if (phase === "creation-ready") {
      creatBtn.disabled = false;
      setTimerButtonIcon(creatBtn, "icon-play");
      setI18nById("matchStartCreationBtn", "matchStartCreation", { attr: "aria-label" });
    } else if (phase === "creation-run") {
      creatBtn.disabled = false;
      setTimerButtonIcon(creatBtn, "icon-pause");
      setI18nById("matchStartCreationBtn", "matchPause", { attr: "aria-label" });
    } else if (phase === "creation-paused") {
      creatBtn.disabled = false;
      setTimerButtonIcon(creatBtn, "icon-play");
      setI18nById("matchStartCreationBtn", "matchResume", { attr: "aria-label" });
    } else if (phase === "strategy-timeup") {
      creatBtn.disabled = false;
      creatBtn.classList.remove("hidden");
      setTimerButtonIcon(creatBtn, "icon-play");
      setI18nById("matchStartCreationBtn", "matchStartCreation", { attr: "aria-label" });
    } else if (phase === "creation-timeup" || phase === "done") {
      creatBtn.disabled = true;
      setTimerButtonIcon(creatBtn, "icon-play");
      setI18nById("matchStartCreationBtn", "matchStartCreation", { attr: "aria-label" });
    } else {
      creatBtn.disabled = true;
    }
    creatBtn.classList.toggle("hidden", phase === "creation-timeup" || phase === "done");
  }
  if (creatResetBtn) {
    const enableReset = ["creation-run", "creation-paused", "creation-ready"].includes(matchState.phase);
    creatResetBtn.disabled = !enableReset;
    creatResetBtn.classList.toggle("hidden", !enableReset);
    setI18nById("matchCreationResetBtn", "matchCreationReset", { attr: "aria-label" });
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
    setI18nById("matchStartCreationCtaBtn", "matchStartCreationCTA");
  }

  const matchValidation = validationSections.get("match");
  if (matchValidation?.root) {
    matchValidation.root.classList.toggle("hidden", !showValidation);
    if (!showValidation) clearMatchWordFor("match");
  }

  if (configBlock) configBlock.classList.toggle("hidden", !showConfig);
  if (matchBackBtn) matchBackBtn.classList.toggle("hidden", !showConfig);
  if (matchExitBtn) matchExitBtn.classList.toggle("hidden", showConfig);

  updateActionOverlayStates();
  if (currentScreen === "round-end") {
    renderRoundEndScreen();
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

function updateScoreboardActionPadding() {
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
    const template = shellTexts.matchTieBreakTitle || "Tie break {index}";
    title.textContent =
      typeof template === "string"
        ? template.replace("{index}", tieIndex)
        : `Tie break ${tieIndex}`;
  } else {
    const roundTemplate = shellTexts.matchRound;
    const roundText =
      typeof roundTemplate === "string"
        ? roundTemplate.replace("{round}", matchState.round)
        : `Round ${matchState.round}`;
    title.textContent = roundText;
  }
  const dealerInfo = getDealerInfo(matchState);
  dealer.textContent = `${shellTexts.matchDealerLabel} ${dealerInfo.name}`;
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
  playModalOpenSound();
  if (!intro._dismissRoundIntro) {
    intro.addEventListener("click", () => dismissRoundIntro());
    intro._dismissRoundIntro = true;
  }
  const durationMs = getRoundIntroDurationMs(intro);
  roundIntroTimer = setTimeout(() => {
    dismissRoundIntro();
  }, durationMs);
}

function dismissRoundIntro() {
  if (roundIntroTimer) {
    clearTimeout(roundIntroTimer);
    roundIntroTimer = null;
  }
  const intro = document.getElementById("roundIntro");
  if (!intro) return;
  intro.classList.remove("show");
  intro.classList.add("hidden");
  intro.setAttribute("aria-hidden", "true");
  roundIntroActive = false;
  if (pendingDealerFocusState) {
    const st = pendingDealerFocusState;
    pendingDealerFocusState = null;
    triggerDealerFocus(st);
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

function clearStatusValidation() {
  clearStatusValidationFor("match");
}

function clearMatchWord() {
  clearMatchWordFor("match");
}

function getValidationRules() {
  const source =
    rulesEditContext === "temp" ? tempValidationRules : validationRules;
  const langRule =
    source && typeof source === "object" && source !== null
      ? source[shellLanguage]
      : null;
  if (langRule) return langRule;
  if (typeof source === "string") return source;
  return shellTexts.matchValidateDefaultRules;
}

function normalizeRulesText(str) {
  return (str || "")
    .replace(new RegExp(`\\n${BULLET_CHAR}\\s*\\n`, "g"), "\n") // remove empty bullet lines
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function rulesDifferFromDefault(text) {
  const current = normalizeRulesText(text);
  const def = normalizeRulesText(shellTexts.matchValidateDefaultRules);
  return current !== def;
}

function updateRestoreButtonVisibility(currentValue) {
  const btn = document.getElementById("rulesRestoreBtn");
  if (!btn) return;
  const show = rulesDifferFromDefault(currentValue != null ? currentValue : getValidationRules());
  btn.classList.toggle("hidden", !show);
}

function showValidationResult(status, message) {
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
  const btn = document.getElementById("validationResultCloseBtn");

  if (iconEl) iconEl.textContent = status === "ok" ? "✔" : status === "fail" ? "✖" : "!";
  if (titleEl)
    titleEl.textContent =
      status === "ok"
        ? shellTexts.matchValidateOk
        : status === "fail"
        ? shellTexts.matchValidateFail
        : shellTexts.unexpectedErrortitle;
  if (msgEl) msgEl.textContent = message || "";
  if (btn) {
    btn.textContent = shellTexts.ok;
    btn.classList.toggle("primary", status === "ok");
    btn.classList.toggle("ghost", status !== "ok");
    if (!btn._bindClose) {
      btn.addEventListener("click", () => closeModal("validation-result", { reason: "action" }));
      btn._bindClose = true;
    }
  }
  if (status !== "error") playValidationResultSound(status === "ok");
  openModal("validation-result", { closable: true });
}
function openRulesModal(context = "live") {
  rulesEditContext = context === "temp" ? "temp" : "live";
  playClickSfx();
  playModalOpenSound();
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
        return; // leave default behavior
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
    const def = shellTexts.matchValidateDefaultRules;
    textarea.value = def.slice(0, 1000);
    updateRestoreButtonVisibility(def);
  }
}

function confirmRestoreDefaultRules() {
  openConfirm({
    title: "matchRulesTitle",
    body: "matchRulesRestoreConfirm",
    acceptText: "matchRulesRestore",
    cancelText: "cancel",
    onConfirm: () => applyDefaultRules(),
  });
}

function saveRulesModal() {
  const textarea = document.getElementById("rulesTextarea");
  const value = (textarea?.value || "").slice(0, 1000).trim();
  // Consider empty / non-alphanumeric as default rules (use simple charset for wide browser support)
  const hasContent = /[A-Za-z0-9]/.test(value);
  const defaultRulesText = shellTexts.matchValidateDefaultRules;
  const isDefaultContent = normalizeRulesText(value) === normalizeRulesText(defaultRulesText);
  let nextRules =
    rulesEditContext === "temp"
      ? cloneValidationRules(tempValidationRules)
      : cloneValidationRules(validationRules);
  if (!nextRules) nextRules = {};

  if (hasContent) {
    if (isDefaultContent) {
      delete nextRules[shellLanguage];
    } else {
      nextRules[shellLanguage] = value;
    }
  } else {
    delete nextRules[shellLanguage];
  }
  // normalize to null if empty map
  if (Object.keys(nextRules).length === 0) nextRules = null;

  if (rulesEditContext === "temp") {
    tempValidationRules = cloneValidationRules(nextRules);
  } else {
    validationRules = cloneValidationRules(nextRules);
    updateState({ settings: { validationRules: nextRules } });
  }
  if (textarea) updateRestoreButtonVisibility(value);
  closeModal("validation-rules", { reason: "action" });
  rulesEditContext = "live";
}

async function handleValidateSection(key = "match") {
  const section = validationSections.get(key);
  if (!section) return;
  const { input, status, validateBtn } = section;
  if (!input || !status) return;
  const word = input.value.trim();
  if (!word) {
    status.textContent = shellTexts.matchValidateEmpty;
    status.className = "match-validation-status error";
    return;
  }
  section.root?.classList.add("loading");
  if (input) input.disabled = true;
  if (validateBtn) validateBtn.disabled = true;
  if (section.clearBtn) section.clearBtn.disabled = true;
  if (section.rulesBtn) section.rulesBtn.disabled = true;
  status.textContent = shellTexts.matchValidateAction;
  status.className = "match-validation-status";
  try {
    const rulesText = getValidationRules();
    const result = await matchController.validateWord(word, rulesText);
    const ok = !!result?.isValid;
    const base = ok ? shellTexts.matchValidateOk : shellTexts.matchValidateFail;
    const reason = result?.reason ? ` ${result.reason}` : "";
    status.textContent = `${base}${reason}`;
    status.className = `match-validation-status ${ok ? "ok" : "fail"}`;
    showValidationResult(ok ? "ok" : "fail", `${base}${reason}`);
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
    status.textContent = shellTexts.matchValidateError;
    status.className = "match-validation-status error";
    showValidationResult("error", shellTexts.matchValidateError);
  } finally {
    section.root?.classList.remove("loading");
    if (input) {
      input.disabled = false;
      input.value = "";
    }
    if (validateBtn) validateBtn.disabled = false;
    if (section.clearBtn) section.clearBtn.disabled = false;
    if (section.rulesBtn) section.rulesBtn.disabled = false;
    updateValidationControls(section);
  }
}

function adjustMatchTimer(kind, delta) {
  const st = matchController.getState();
  if (!st || st.phase !== "config") return;
  const key = kind === "strategy" ? "strategySeconds" : "creationSeconds";
  const base =
    tempMatchPrefs[key] ??
    (kind === "strategy" ? DEFAULT_STRATEGY_SECONDS : DEFAULT_CREATION_SECONDS);
  const nextVal = clampPhaseSeconds(base + delta);
  updateMatchPreferences({ [key]: nextVal });
  renderMatch();
}

function adjustPlayers(delta) {
  const st = matchController.getState();
  if (!st || st.phase !== "config") return;
  const current = tempMatchPrefs.playersCount ?? st.players?.length ?? DEFAULT_PLAYER_COUNT;
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
  const current = tempMatchPrefs.roundsTarget ?? DEFAULT_ROUNDS_TARGET;
  const next = Math.max(1, current + delta);
  updateMatchPreferences({ roundsTarget: next });
}

function adjustPoints(delta) {
  const st = matchController.getState();
  if (!st || st.phase !== "config") return;
  const current = tempMatchPrefs.pointsTarget ?? DEFAULT_POINTS_TARGET;
  const next = Math.max(1, current + delta);
  updateMatchPreferences({ pointsTarget: next });
}

function toggleScoring() {
  const st = matchController.getState();
  if (!st || st.phase !== "config") return;
  updateMatchPreferences({ scoringEnabled: !tempMatchPrefs.scoringEnabled });
}

function updateMatchPreferences(partial) {
  const st = matchController.getState() || {};
  tempMatchPrefs = {
    ...tempMatchPrefs,
    ...partial,
  };
  if (Object.prototype.hasOwnProperty.call(partial, "playersCount")) {
    syncTempPlayers(tempMatchPrefs.playersCount ?? DEFAULT_PLAYER_COUNT);
    const activeMode = tempMatchPrefs.mode ?? st.mode ?? MATCH_MODE_ROUNDS;
    if (activeMode === MATCH_MODE_ROUNDS) {
      const count = tempMatchPrefs.playersCount ?? DEFAULT_PLAYER_COUNT;
      tempMatchPrefs.roundsTarget = getDefaultRoundsTarget(count);
    }
  }
  const prefs = {
    playersCount: tempMatchPrefs.playersCount ?? st.players?.length ?? DEFAULT_PLAYER_COUNT,
    strategySeconds: tempMatchPrefs.strategySeconds ?? DEFAULT_STRATEGY_SECONDS,
    creationSeconds: tempMatchPrefs.creationSeconds ?? DEFAULT_CREATION_SECONDS,
    mode: tempMatchPrefs.mode ?? MATCH_MODE_ROUNDS,
    roundsTarget: tempMatchPrefs.roundsTarget ?? DEFAULT_ROUNDS_TARGET,
    pointsTarget: tempMatchPrefs.pointsTarget ?? DEFAULT_POINTS_TARGET,
    scoringEnabled: tempMatchPrefs.scoringEnabled ?? true,
  };
  matchController.applyPreferences(prefs, { persist: false });
  renderMatch();
}

function startMatchPlay({ skipResumePrompt = false } = {}) {
  if (!skipResumePrompt) {
    const prompted = maybePromptRestoreStaleMatch({
      onDecline: () => startMatchPlay({ skipResumePrompt: true }),
    });
    if (prompted) return;
  }
  stopClockLoop(false);
  if (introAudio) {
    introAudio.pause();
    introAudio.currentTime = 0;
  }
  validationRules = cloneValidationRules(tempValidationRules);
  const finalPlayers = Array.isArray(tempMatchPlayers) && tempMatchPlayers.length
    ? buildFinalPlayers()
    : [];
  updateState({
    gamePreferences: {
      ...tempMatchPrefs,
      players: finalPlayers,
    },
    settings: { validationRules },
  });
  tempValidationRules = cloneValidationRules(validationRules);
  matchController.applyPreferences(tempMatchPrefs);
  if (finalPlayers.length) {
    tempMatchPlayers = finalPlayers;
    matchController.setPlayers(finalPlayers);
  }
  matchController.startMatch();
  persistActiveMatchSnapshot(matchController.getState());
  renderMatch();
}

function handlePhaseTabClick(target) {
  const st = matchController.getState();
  if (!st || st.phase === "config" || st.matchOver) return;
  const isCreationPhase = st.phase.startsWith("creation") || st.phase === "done";
  if (target === "creation") {
    if (isCreationPhase) return;
    playClickSfx();
    openConfirm({
      title: "confirmTitlePhaseChange",
      body: "confirmBodyPhaseChange",
      acceptText: "confirmAccept",
      cancelText: "cancel",
      onConfirm: () => {
        stopClockLoop(false);
        matchController.skipToCreation({ autoStart: true });
        playClockLoop();
        renderMatch();
      },
    });
    return;
  }
  if (!isCreationPhase) return;
  playClickSfx();
  openConfirm({
    title: "confirmTitlePhaseChange",
    body: "confirmBodyPhaseChange",
    acceptText: "confirmAccept",
    cancelText: "cancel",
    onConfirm: () => {
      stopClockLoop(false);
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
      matchController.startMatch();
      persistActiveMatchSnapshot(matchController.getState());
    }
    const current = matchController.getState().phase;
    if (current === "strategy-ready") {
      matchController.startPhase("strategy");
      persistActiveMatchSnapshot(matchController.getState());
      playClockLoop();
    } else if (current === "strategy-run") {
      matchController.pause();
      stopClockLoop(false);
    } else if (current === "strategy-paused") {
      matchController.resume();
      const resumed = matchController.getState();
      const remaining = resumed?.remaining ?? 0;
      if (remaining <= 10 && remaining > 0) {
        clockLowTimeMode = true;
        stopClockLoop(false);
      } else {
        clockLowTimeMode = false;
        playClockLoop();
      }
    }
  } else if (kind === "creation") {
    if (phase === "strategy-timeup" || phase === "creation-ready") {
      matchController.startPhase("creation");
      persistActiveMatchSnapshot(matchController.getState());
      playClockLoop();
    } else if (phase === "creation-run") {
      matchController.pause();
      stopClockLoop(false);
    } else if (phase === "creation-paused") {
      matchController.resume();
      const resumed = matchController.getState();
      const remaining = resumed?.remaining ?? 0;
      if (remaining <= 10 && remaining > 0) {
        clockLowTimeMode = true;
        stopClockLoop(false);
      } else {
        clockLowTimeMode = false;
        playClockLoop();
      }
    } else if (phase === "config") {
      const prompted = maybePromptRestoreStaleMatch({
        onDecline: () => startMatchPhase(kind),
      });
      if (prompted) return;
      matchController.startMatch();
      persistActiveMatchSnapshot(matchController.getState());
    }
  }
  renderMatch();
}

function resetMatchPhase(kind) {
  const target = kind === "creation" ? "creation" : "strategy";
  matchController.restartPhase(target, { autoStart: false });
  stopClockLoop(false);
  renderMatch();
}

function skipToCreation(autoStart = true) {
  matchController.skipToCreation({ autoStart });
  if (autoStart) playClockLoop();
  renderMatch();
}

function advanceMatchRound() {
  matchController.nextRound();
  stopClockLoop(false);
  renderMatch();
}

function openRoundEndScreen() {
  const st = matchController.getState();
  if (!st) return;
  roundEndScores = {};
  roundEndOrder = buildRoundEndOrder(st);
  roundEndUnlocked = new Set();
  roundEndSelectedWinners = new Set();
  roundEndKeypadOpen = false;
  roundEndKeypadPlayerId = null;
  const activePlayers = getActivePlayers(st);
  activePlayers.forEach((player) => {
    roundEndScores[String(player.id)] = "";
  });
  stopMatchTimer();
  stopClockLoop(false);
  showScreen("round-end");
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
  pausedBeforeScoreboard = null;
  if (st.phase === "strategy-run") {
    pausedBeforeScoreboard = "strategy";
    matchController.pause();
    stopClockLoop(false);
  } else if (st.phase === "creation-run") {
    pausedBeforeScoreboard = "creation";
    matchController.pause();
    stopClockLoop(false);
  }
  const data = buildScoreboardData(st);
  scoreboardRounds = data.rounds;
  scoreboardPlayers = data.players;
  scoreboardBase = cloneScoreboardValues(data.values);
  scoreboardDraft = cloneScoreboardValues(data.values);
  scoreboardDirty = false;
  scoreboardReadOnly = readOnly;
  scoreboardInfoText = "";
  scoreboardReturnScreen = currentScreen || "match";
  scoreboardReturnWinners = winnersModalOpen;
  scoreboardKeypadOpen = false;
  scoreboardKeypadPlayerId = null;
  scoreboardKeypadRound = null;
  scoreboardKeypadOrder = [];
  scoreboardKeypadInitialValue = null;
  if (winnersModalOpen) {
    suppressWinnersPrompt = true;
    closeModal("match-winners", { reason: "scoreboard" });
  }
  renderScoreboardScreen(st);
  showScreen("scoreboard");
  scaleGame();
}

function closeScoreboard() {
  const resumePhase = pausedBeforeScoreboard;
  pausedBeforeScoreboard = null;
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
  showScreen(scoreboardReturnScreen || "match");
  scaleGame();
  if (scoreboardReturnWinners && lastWinnersIds.length) {
    suppressWinnersPrompt = false;
    scoreboardReturnWinners = false;
    showMatchWinners(lastWinnersIds);
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

function formatRecordDate(value) {
  if (!value) return "";
  const parsed = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toLocaleDateString(shellLanguage || "es");
}

function formatRecordPoints(value, { average = false } = {}) {
  if (value == null || value === "") return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return average ? num.toFixed(2) : String(num);
}

function buildRecordDateMessage(dateValue) {
  const date = formatRecordDate(dateValue);
  const template = shellTexts.scoreboardRecordDate || "Partida del {date}";
  return template.replace("{date}", date || "");
}

function openRecordScoreboard(record, { highlightWord = false } = {}) {
  if (!record || !record.matchId) return;
  const archive = loadArchive();
  const entry = archive?.byId?.[String(record.matchId)];
  if (!entry?.matchState) return;
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
  renderScoreboardScreen(entry.matchState);
  showScreen("scoreboard");
  scaleGame();
}

function renderRecordsList({ listId, records, emptyText, showWord = false } = {}) {
  const list = document.getElementById(listId);
  if (!list) return;
  const rows = Array.isArray(records) ? records.slice(0, 10) : [];
  list.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "records-empty";
    empty.textContent = emptyText || shellTexts.recordsEmpty || "Sin records";
    list.appendChild(empty);
    return;
  }

  rows.forEach((record, idx) => {
    const pill = document.createElement("div");
    pill.className = "records-pill";
    pill.addEventListener("click", () =>
      openRecordScoreboard(record, { highlightWord: showWord })
    );
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
        ["sameColor", shellTexts.recordsFeatureSameColor],
        ["usedWildcard", shellTexts.recordsFeatureWildcard],
        ["doubleScore", shellTexts.recordsFeatureDouble],
        ["plusPoints", shellTexts.recordsFeaturePlus],
        ["minusPoints", shellTexts.recordsFeatureMinus],
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
    view.textContent = shellTexts.recordsViewMatch || "Ver partida";

    pill.append(top);
    if (wordRow) pill.appendChild(wordRow);
    pill.append(mid, playersRow, view);
    list.appendChild(pill);
  });
}

function renderRecordsScreen() {
  const records = loadRecords() || {};
  const wordRecords = Array.isArray(records.bestWord) ? records.bestWord : [];
  const matchRecords = Array.isArray(records.bestMatch) ? records.bestMatch : [];

  renderRecordsList({
    listId: "recordsWordList",
    records: wordRecords,
    emptyText: shellTexts.recordsEmptyWord,
    showWord: true,
  });

  renderRecordsList({
    listId: "recordsMatchList",
    records: matchRecords,
    emptyText: shellTexts.recordsEmptyMatch,
    showWord: false,
  });

  setRecordsTab(recordsTab || "words");
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
  recordsReturnScreen = currentScreen || "scoreboard";
  showScreen("records");
  scaleGame();
}

function closeRecords() {
  if (recordsReturnScreen === "match-winners" && lastWinnersIds.length) {
    suppressWinnersPrompt = false;
    showMatchWinners(lastWinnersIds);
    return;
  }
  showScreen(recordsReturnScreen || "scoreboard");
  scaleGame();
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
}

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
      stopClockLoop(false);
      showScreen("match");
      renderMatch();
      showMatchWinners(nextState.winnerIds || []);
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
        stopClockLoop(false);
        showScreen("match");
        renderMatch();
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
  stopClockLoop(false);
  showScreen("match");
  renderMatch();
}

function getRoundEndSelectedIds(matchState) {
  if (matchState?.tieBreakPending?.players?.length) {
    return matchState.tieBreakPending.players.map((id) => String(id));
  }
  return [...roundEndSelectedWinners];
}

function handleRoundEndAllWin() {
  const st = matchController.getState();
  if (!st) return;
  const selected = getRoundEndSelectedIds(st);
  if (!selected.length) return;
  matchController.declareWinners(selected);
  const nextState = matchController.getState();
  if (nextState?.matchOver) {
    roundEndScores = {};
    roundEndUnlocked = new Set();
    roundEndSelectedWinners = new Set();
    clearMatchWordFor("match");
    stopClockLoop(false);
    showScreen("match");
    renderMatch();
    showMatchWinners(nextState.winnerIds || []);
    return;
  }
  roundEndScores = {};
  roundEndUnlocked = new Set();
  roundEndSelectedWinners = new Set();
  clearMatchWordFor("match");
  stopClockLoop(false);
  showScreen("match");
  renderMatch();
}

function handleRoundEndTieBreak() {
  const st = matchController.getState();
  if (!st) return;
  const selected = getRoundEndSelectedIds(st);
  if (selected.length < 2) return;
  matchController.startTieBreak(selected);
  roundEndScores = {};
  roundEndUnlocked = new Set();
  roundEndSelectedWinners = new Set();
  clearMatchWordFor("match");
  stopClockLoop(false);
  showScreen("match");
  renderMatch();
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
  matchController.startMatch();
  roundEndScores = {};
  roundEndUnlocked = new Set();
  roundEndSelectedWinners = new Set();
  clearMatchWordFor("match");
  stopClockLoop(false);
  showScreen("match");
  renderMatch();
}

function promptMatchPlayAgain() {
  openConfirm({
    title: "matchPlayAgainTitle",
    body: "matchPlayAgainBody",
    acceptText: "matchPlayAgainYes",
    cancelText: "matchPlayAgainNo",
    onConfirm: () => restartMatchWithSameSettings(),
    onCancel: () => showScreen("splash"),
  });
}

function showMatchWinners(winnerIds = []) {
  const st = matchController.getState();
  if (!st) return;
  if (winnersModalOpen) return;
  lastWinnersIds = Array.isArray(winnerIds) ? [...winnerIds] : [];
  const winners = getPlayersByIds(st, winnerIds);
  const titleEl = document.getElementById("matchWinnersTitle");
  const subtitleEl = document.getElementById("matchWinnersSubtitle");
  const listEl = document.getElementById("matchWinnersList");
  const scoreBtn = document.getElementById("matchWinnersScoreBtn");
  const recordsBtn = document.getElementById("matchWinnersRecordsBtn");
  const recordsNote = document.getElementById("matchWinnersRecordsNote");
  const isMulti = winners.length > 1;

  if (titleEl) {
    setI18n(titleEl, isMulti ? "matchWinnerTitleMulti" : "matchWinnerTitleSingle");
  }
  if (subtitleEl) {
    setI18n(subtitleEl, isMulti ? "matchWinnerSubtitleMulti" : "matchWinnerSubtitleSingle");
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
      chip.textContent = player?.name || `${shellTexts.playerLabel} ${idx + 1}`;
      listEl.appendChild(chip);
    });
  }
  if (scoreBtn) {
    scoreBtn.classList.toggle("hidden", !st.scoringEnabled);
  }
  updateMatchWinnersRecordsUI(st, { recordsBtn, recordsNote });
  playModalOpenSound();
  winnersModalOpen = true;
  openModal("match-winners", {
    closable: true,
    onClose: () => {
      const skipPrompt = suppressWinnersPrompt;
      suppressWinnersPrompt = false;
      winnersModalOpen = false;
      if (!skipPrompt) {
        promptMatchPlayAgain();
      }
    },
  });
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
      `${shellTexts.playerLabel} ${entry.playerId}`;
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
      const namesText = formatNameList(recordNames, shellLanguage || "es");
      const template = shellTexts.matchWinnersRecordsNote || "";
      recordsNote.textContent = template.replace("{names}", namesText);
    }
  }
}

function formatNameList(names, lang = "es") {
  const list = Array.isArray(names) ? names.filter(Boolean) : [];
  if (list.length <= 1) return list[0] || "";
  const conj = lang.startsWith("en") ? "and" : "y";
  if (list.length === 2) return `${list[0]} ${conj} ${list[1]}`;
  return `${list.slice(0, -1).join(", ")} ${conj} ${list[list.length - 1]}`;
}

function openRecordsFromWinners() {
  if (winnersModalOpen) {
    suppressWinnersPrompt = true;
    closeModal("match-winners", { reason: "records" });
  }
  openRecords();
  recordsReturnScreen = "match-winners";
}

function finishMatchPhase(kind) {
  const st = matchController.getState();
  if (!st) return;
  if (kind === "strategy" && st.phase.startsWith("strategy")) {
    matchController.finishPhase();
    stopClockLoop(false);
  } else if (kind === "creation" && st.phase.startsWith("creation")) {
    matchController.finishPhase();
    stopClockLoop(false);
  }
  renderMatch();
}

function confirmFinishPhase(kind) {
  openConfirm({
    title: "confirmTitleFinish",
    body: "confirmBodyFinish",
    acceptText: "confirmAccept",
    cancelText: "cancel",
    onConfirm: () => finishMatchPhase(kind),
  });
}

function stopMatchTimer() {
  matchController.stopTimer?.();
}

function resetMatchState() {
  stopMatchTimer();
  stopClockLoop(true);
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
  tempMatchPrefs = buildMatchPrefs(state.gamePreferences);
  tempMatchPlayers = buildTempPlayers(
    tempMatchPrefs.playersCount ?? DEFAULT_PLAYER_COUNT,
    state.gamePreferences?.players || state.matchState?.players || []
  );
  validationRules = state.settings.validationRules ?? null;
  tempValidationRules = cloneValidationRules(validationRules);
  matchController.applyPreferences(state.gamePreferences || {}, { persist: false });
  const storedPlayers = state.gamePreferences?.players || state.matchState?.players;
  if (Array.isArray(storedPlayers) && storedPlayers.length) {
    matchController.setPlayers(storedPlayers, { persist: false, updateKnownNames: false });
  }
}

function confirmExitToSplash() {
  playClickSfx();
  openConfirm({
    title: "matchEndMatch",
    body: "confirmBodyExit",
    acceptText: "confirmAccept",
    cancelText: "cancel",
    onConfirm: () => {
      finalizeMatchSnapshot(matchController.getState(), { status: "finished", exitExplicit: true });
      stopClockLoop(true);
      resetMatchState();
      showScreen("splash");
    },
  });
}

function exitMatchDirect() {
  playClickSfx();
  finalizeMatchSnapshot(matchController.getState(), { status: "finished", exitExplicit: true });
  stopClockLoop(true);
  preserveMatchConfigOnExit = false;
  resetMatchState();
  showScreen("splash");
}

function handleConfirmCancel() {
  const st = matchController.getState();
  if (pausedBeforeConfirm === "strategy" && st?.phase === "strategy-paused") {
    startMatchPhase("strategy");
  } else if (pausedBeforeConfirm === "creation" && st?.phase === "creation-paused") {
    startMatchPhase("creation");
  }
  pausedBeforeConfirm = null;
  if (confirmCancelCallback) {
    try {
      confirmCancelCallback();
    } catch (e) {
      logger.warn("Confirm cancel callback failed", e);
    }
  }
  confirmCancelCallback = null;
  closeModal("confirm", { reason: "cancel" });
}

function showScreen(name) {
  currentScreen = name;
  if (name !== "match") {
    matchConfigExpanded = false;
  }
  if (name !== "match") {
    clearCreationTimeupAutoAdvance(true);
  }
  const targetId = `screen-${name}`;
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("active", el.id === targetId);
  });
  if (name !== "round-end") {
    roundEndKeypadOpen = false;
    roundEndKeypadPlayerId = null;
    const keypad = document.getElementById("roundEndKeypad");
    if (keypad) {
      keypad.classList.add("hidden");
      keypad.setAttribute("aria-hidden", "true");
    }
  }
  if (name !== "scoreboard") {
    scoreboardKeypadOpen = false;
    scoreboardKeypadPlayerId = null;
    scoreboardKeypadRound = null;
    scoreboardKeypadOrder = [];
    scoreboardKeypadInitialValue = null;
    const keypad = document.getElementById("scoreboardKeypad");
    if (keypad) {
      keypad.classList.add("hidden");
      keypad.setAttribute("aria-hidden", "true");
    }
  }
  const activeScreen = document.getElementById(targetId);
  if (activeScreen) {
    activeScreen.scrollTop = 0;
    activeScreen.scrollLeft = 0;
    activeScreen.querySelectorAll("*").forEach((el) => {
      if (el.scrollTop) el.scrollTop = 0;
      if (el.scrollLeft) el.scrollLeft = 0;
    });
  }
  if (name === "match") {
    renderMatch();
  } else if (name === "round-end") {
    renderRoundEndScreen();
  } else if (name === "scoreboard") {
    renderScoreboardScreen(matchController.getState());
  } else if (name === "records") {
    renderRecordsScreen();
  } else {
    if (name === "splash") {
      if (!preserveMatchConfigOnExit) {
        resetMatchState();
      }
      preserveMatchConfigOnExit = false;
    }
    stopMatchTimer();
    stopClockLoop(true);
  }
  if (name === "live") {
    ensureWakeLock(true);
  } else {
    ensureWakeLock(false);
  }
  checkOrientationOverlay();
}

function updateSoundToggle() {
  const btn = document.getElementById("soundToggleBtn");
  if (!btn) return;
  btn.dataset.state = soundOn ? "on" : "off";
  btn.setAttribute("aria-label", soundOn ? shellTexts.soundOn : shellTexts.soundOff);
  btn.textContent = "";
}

function updateSettingsControls(source = {}) {
  const soundValue = source.sound ?? soundOn;
  const musicValue = source.music ?? musicOn;
  const soundVol = clampVolume(source.soundVolume ?? soundVolume);
  const musicVol = clampVolume(source.musicVolume ?? musicVolume);
  const langValue = source.language ?? shellLanguage;

  const soundSlider = document.getElementById("settingsSoundSlider");
  const soundValueLabel = document.getElementById("settingsSoundValue");
  if (soundSlider) {
    soundSlider.value = soundVol;
  }
  if (soundValueLabel) soundValueLabel.textContent = `${soundVol}%`;
  const soundIcon = document.getElementById("settingsSoundIcon");
  if (soundIcon) {
    soundIcon.classList.toggle("off", !soundValue || soundVol === 0);
  }

  const musicSlider = document.getElementById("settingsMusicSlider");
  const musicValueLabel = document.getElementById("settingsMusicValue");
  if (musicSlider) {
    musicSlider.value = musicVol;
  }
  if (musicValueLabel) musicValueLabel.textContent = `${musicVol}%`;
  const musicIcon = document.getElementById("settingsMusicIcon");
  if (musicIcon) {
    musicIcon.classList.toggle("off", !musicValue || musicVol === 0);
  }

  const langCode = document.getElementById("settingsLanguageCode");
  if (langCode) {
    langCode.textContent = getLanguageName(langValue);
  }
}

function openSettingsModal() {
  settingsSnapshot = getCurrentSettingsState();
  tempSettings = {
    sound: soundOn || soundVolume > 0,
    music: musicOn || musicVolume > 0,
    soundVolume,
    musicVolume,
    language: shellLanguage,
  };
  renderSettingsLanguageSelector();
  updateSettingsControls(tempSettings);
  playModalOpenSound();
  openModal("settings", { closable: true });
}

function applySettingsFromTemp() {
  const nextLang = tempSettings.language || shellLanguage;
  const langChanged = nextLang !== shellLanguage;

  soundVolume = clampVolume(tempSettings.soundVolume);
  musicVolume = clampVolume(tempSettings.musicVolume);
  soundOn = soundVolume > 0 && tempSettings.sound !== false;
  musicOn = musicVolume > 0 && tempSettings.music !== false;

  applyLiveSettings(
    {
      sound: soundOn,
      music: musicOn,
      soundVolume,
      musicVolume,
      language: nextLang,
    },
    { persist: true }
  );
  settingsSnapshot = getCurrentSettingsState();
}

function applyLiveSettings(settings, { persist = false } = {}) {
  const nextSoundVol = clampVolume(settings.soundVolume ?? soundVolume);
  const nextMusicVol = clampVolume(settings.musicVolume ?? musicVolume);
  const nextSound = settings.sound ?? soundOn;
  const nextMusic = settings.music ?? musicOn;
  const nextLang = settings.language || shellLanguage;

  soundVolume = nextSoundVol;
  musicVolume = nextMusicVol;
  soundOn = nextSoundVol > 0 && nextSound !== false;
  musicOn = nextMusicVol > 0 && nextMusic !== false;

  if (persist) {
    updateState({
      settings: {
        sound: soundOn,
        music: musicOn,
        soundVolume,
        musicVolume,
        language: nextLang,
      },
    });
  }

  updateSoundToggle();
  updateAudioVolumes();
  if (!musicOn && introAudio) {
    introAudio.pause();
  } else if (musicOn) {
    attemptPlayIntro();
  }

  if (persist) {
    setShellLanguage(nextLang);
  } else if (TEXTS[nextLang]) {
    shellLanguage = nextLang;
    shellTexts = TEXTS[nextLang];
    updateBodyLanguageClass(shellLanguage);
    renderShellTexts();
    applyI18n(document);
    const st = matchController.getState();
    if (st) {
      renderMatchFromState(st);
      renderScoreboardScreen(st);
    }
  }

  updateSettingsControls({
    sound: soundOn,
    music: musicOn,
    soundVolume,
    musicVolume,
    language: shellLanguage,
  });
}

function cycleLanguage() {
  const langs = getAvailableLanguages();
  if (!langs.length) return;
  const current = tempSettings.language || shellLanguage;
  const idx = langs.indexOf(current);
  const next = langs[(idx + 1) % langs.length];
  tempSettings.language = next;
  applyLiveSettings(tempSettings, { persist: false });
}

function getCurrentSettingsState() {
  return {
    sound: soundOn,
    music: musicOn,
    soundVolume,
    musicVolume,
    language: shellLanguage,
  };
}

function revertSettingsSnapshot() {
  if (settingsSnapshot) {
    applyLiveSettings(settingsSnapshot, { persist: false });
    tempSettings = { ...settingsSnapshot };
    settingsSnapshot = null;
  }
}

function handleModalClosed(evt) {
  const detail = evt.detail || {};
  if (detail.id === "settings") {
    if (detail.action === "apply") {
      settingsSnapshot = getCurrentSettingsState();
    } else {
      revertSettingsSnapshot();
    }
  } else if (detail.id === "confirm") {
    if (detail.reason !== "action") {
      handleConfirmCancel();
    }
  } else if (detail.id === "validation-rules") {
    rulesEditContext = "live";
  } else if (detail.id === "validation-result") {
    clearMatchWordFor("match");
    clearMatchWordFor("splash");
  }
}

function updateLanguageButton() {
  // Header language button removed; settings button shows language.
}

async function ensureWakeLock(shouldLock) {
  if (shouldLock) {
    const locked = await requestLock();
    wakeLockActive = locked;
    if (locked) {
      resetWakeLockTimer();
    }
  } else {
    await releaseLock();
    wakeLockActive = false;
    if (wakeLockTimer) {
      clearTimeout(wakeLockTimer);
      wakeLockTimer = null;
    }
  }
}

function setupDebugRevealGesture(container) {
  const targets = [document.querySelector(".brand-mark"), document.getElementById("appTitle")].filter(
    Boolean
  );
  if (!targets.length) return;
  let taps = [];
  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    container.style.display = "block";
  };
  const handler = () => {
    const now = Date.now();
    taps = taps.filter((t) => now - t <= 10000);
    taps.push(now);
    if (taps.length >= 5) {
      reveal();
      targets.forEach((el) => el.removeEventListener("click", handler));
    }
  };
  targets.forEach((el) => el.addEventListener("click", handler));
}

function setupLogoLongPressForDebug(logoEl) {
  if (!logoEl) return;
  let pressTimer = null;
  const reveal = () => {
    if (window.__revealDebugPanel) {
      window.__revealDebugPanel();
    }
  };
  const start = () => {
    clear();
    pressTimer = window.setTimeout(reveal, 3000);
  };
  const clear = () => {
    if (pressTimer) {
      window.clearTimeout(pressTimer);
      pressTimer = null;
    }
  };
  ["pointerdown", "touchstart", "mousedown"].forEach((evt) => {
    logoEl.addEventListener(evt, start, { passive: true });
  });
  ["pointerup", "pointerleave", "touchend", "touchcancel", "mouseup"].forEach((evt) => {
    logoEl.addEventListener(evt, clear, { passive: true });
  });
}

function setupWakeLockActivityTracking() {
  const activityHandler = () => {
    ensureWakeLock(true);
  };
  ["pointerdown", "keydown", "touchstart"].forEach((evt) => {
    document.addEventListener(evt, activityHandler, true);
  });
}

function startSplashLoader() {
  if (splashLoaderComplete) return;
  document.body.classList.add("splash-loading");
  const loadingBlock = document.getElementById("splashLoadingBlock");
  const mainBlock = document.getElementById("splashMainContent");
  const bar = document.getElementById("splashLoaderProgress");
  const percent = document.getElementById("splashLoaderPercent");
  const logoEl = document.getElementById("splashLogo");
  if (loadingBlock) loadingBlock.classList.remove("hidden");
  if (mainBlock) mainBlock.classList.add("hidden");
  if (logoEl) setupLogoLongPressForDebug(logoEl);

  const updateProgress = (value) => {
    splashLoaderProgress = Math.min(100, Math.max(splashLoaderProgress, value));
    if (bar) bar.style.width = `${splashLoaderProgress}%`;
    if (percent) percent.textContent = `${Math.round(splashLoaderProgress)}%`;
  };

  const assets = loadSplashAssets();
  const total = assets.total || 1;
  const minDuration = (isStandaloneApp() || fromPWA) ? 1 : 3000;
  const start = Date.now();
  let completed = 0;

  const handleComplete = () => {
    completed += 1;
    const next = 5 + (completed / total) * 90; // keep a headroom for the final 100%
    updateProgress(next);
  };

  const bump = () => handleComplete();

  updateProgress(5);

  const logoPhase = assets.logoLoader
    ? assets.logoLoader().catch((err) => logger.warn("Logo load failed", err)).finally(bump)
    : Promise.resolve();

  const backgroundPhase = logoPhase.then(() =>
    assets.backgroundLoader
      ? assets.backgroundLoader()
          .catch((err) => logger.warn("Background load failed", err))
          .finally(bump)
      : Promise.resolve()
  );

  const allPhases = backgroundPhase.then(() => {
    const restPromises = (assets.restLoaders || []).map((loader) =>
      loader()
        .catch((err) => logger.warn("Splash asset load failed", err))
        .finally(bump)
    );
    return Promise.allSettled(restPromises);
  });

  const finish = () => {
    if (splashLoaderComplete) return;
    splashLoaderComplete = true;
    splashLoaderInterval = null;
    updateProgress(100);
    window.setTimeout(() => {
      document.body.classList.remove("splash-loading");
      document.body.classList.add("splash-ready");
      if (loadingBlock) loadingBlock.classList.add("hidden");
      if (mainBlock) mainBlock.classList.remove("hidden");
      if (logoEl) logoEl.classList.add("logo-animated");
    }, 200);
  };

  allPhases.finally(() => {
    const elapsed = Date.now() - start;
    const remaining = Math.max(0, minDuration - elapsed);
    window.setTimeout(finish, remaining);
  });
}

function setupAudio() {
  if (audioReady) return;
  audioReady = true;

  const ensureAudioContext = () => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      musicGain = audioCtx.createGain();
      soundGain = audioCtx.createGain();
      const musicLevel = (musicVolume / 100) * 0.7;
      const soundLevel = soundVolume / 100;
      musicGain.gain.value = musicLevel;
      soundGain.gain.value = soundLevel;
      musicGain.connect(audioCtx.destination);
      soundGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
  };

  introAudio = new Audio("assets/sounds/intro.wav");
  introAudio.loop = true;
  introAudio.volume = 1;

  clockAudio = new Audio("assets/sounds/clock-melody.mp3");
  clockAudio.loop = true;
  clockAudio.volume = 1;

  tickAudio = new Audio("assets/sounds/tick.mp3");
  tickAudio.volume = 1;

  timeAudio = new Audio("assets/sounds/time.mp3");
  timeAudio.volume = 1;

  modalOpenAudio = new Audio("assets/sounds/open.mp3");
  modalOpenAudio.volume = 1;

  clickAudio = new Audio("assets/sounds/click.mp3");
  clickAudio.volume = 1;

  successAudio = new Audio("assets/sounds/success.mp3");
  successAudio.volume = 1;

  failAudio = new Audio("assets/sounds/fail.mp3");
  failAudio.volume = 1;

  const unlock = () => {
    ensureAudioContext();
    if (!musicSource && audioCtx) {
      musicSource = audioCtx.createMediaElementSource(introAudio);
      musicSource.connect(musicGain);
    }
    if (!clockSource && audioCtx) {
      clockSource = audioCtx.createMediaElementSource(clockAudio);
      clockSource.connect(musicGain);
    }
    if (!tickSource && audioCtx) {
      tickSource = audioCtx.createMediaElementSource(tickAudio);
      tickSource.connect(soundGain);
    }
    if (!timeSource && audioCtx) {
      timeSource = audioCtx.createMediaElementSource(timeAudio);
      timeSource.connect(soundGain);
    }
    if (!modalOpenSource && audioCtx) {
      modalOpenSource = audioCtx.createMediaElementSource(modalOpenAudio);
      modalOpenSource.connect(soundGain);
    }
    if (!clickSource && audioCtx) {
      clickSource = audioCtx.createMediaElementSource(clickAudio);
      clickSource.connect(soundGain);
    }
    if (!successSource && audioCtx) {
      successSource = audioCtx.createMediaElementSource(successAudio);
      successSource.connect(soundGain);
    }
    if (!failSource && audioCtx) {
      failSource = audioCtx.createMediaElementSource(failAudio);
      failSource.connect(soundGain);
    }
    updateAudioVolumes();
    attemptPlayIntro();
    if (clickAudio) {
      clickAudio.play().catch(() => {});
      clickAudio.pause();
      clickAudio.currentTime = 0;
    }
    document.removeEventListener("pointerdown", unlock, true);
  };
  document.addEventListener("pointerdown", unlock, true);

  document.addEventListener(
    "click",
    (evt) => {
      const btn = evt.target.closest("button,input[type='range']");
      if (!btn) return;
      ensureAudioContext();
      playClickSfx();
    },
    true
  );

  attemptPlayIntro();
  updateAudioVolumes();
}

function attemptPlayIntro() {
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  if (!introAudio || !musicOn) return;
  introAudio.play().catch(() => {});
}

function updateAudioVolumes() {
  const musicLevel = (musicVolume / 100) * 0.7;
  const soundLevel = soundVolume / 100;
  if (musicGain) musicGain.gain.value = musicLevel;
  if (soundGain) soundGain.gain.value = soundLevel;
  // fallback for platforms without Web Audio volume control
  if (introAudio) {
    introAudio.volume = musicLevel;
  }
  if (clockAudio) {
    clockAudio.volume = musicLevel;
  }
  if (tickAudio) {
    tickAudio.volume = soundLevel;
  }
  if (timeAudio) {
    timeAudio.volume = soundLevel;
  }
  if (modalOpenAudio) {
    modalOpenAudio.volume = soundLevel;
  }
  if (clickAudio) {
    clickAudio.volume = soundLevel;
  }
  if (successAudio) successAudio.volume = soundLevel;
  if (failAudio) failAudio.volume = soundLevel;
}

function playClockLoop() {
  if (!musicOn || !clockAudio) return;
  if (introAudio) {
    introAudio.pause();
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  clockAudio.play().catch(() => {});
}

function stopClockLoop(allowIntro = true) {
  if (clockAudio) {
    clockAudio.pause();
    clockAudio.currentTime = 0;
  }
  if (musicOn && allowIntro && currentScreen !== "match") {
    attemptPlayIntro();
  }
}

function playLowTimeTick(force = false) {
  if (!soundOn) return;
  const now = Date.now();
  if (!force && now - lastLowTimeTick < 900) return;
  lastLowTimeTick = now;
  if (!tickAudio) return;
  const inst = tickAudio.cloneNode();
  inst.volume = (soundVolume / 100) * 1.0;
  inst.play().catch(() => {});
}

function triggerTimeUpEffects(kind) {
  if (soundOn && timeAudio) {
    try {
      const inst = timeAudio.cloneNode();
      inst.volume = (soundVolume / 100) * 1.0;
      inst.play().catch(() => {});
    } catch (e) {
      playLowTimeTick(true);
    }
  }
  if (navigator.vibrate) {
    try {
      navigator.vibrate(TIMEUP_VIBRATION_MS);
    } catch (e) {}
  }
  stopClockLoop(false);
}

function clearCreationTimeupAutoAdvance(resetCancelled = false) {
  if (creationTimeupTimer) {
    window.clearTimeout(creationTimeupTimer);
    creationTimeupTimer = null;
  }
  if (resetCancelled) creationTimeupCancelled = false;
}

function scheduleCreationTimeupAutoAdvance() {
  if (creationTimeupTimer || creationTimeupCancelled) return;
  creationTimeupTimer = window.setTimeout(() => {
    creationTimeupTimer = null;
    const st = matchController.getState();
    if (!st || st.phase !== "creation-timeup" || currentScreen !== "match") return;
    creationTimeupCancelled = false;
    openRoundEndScreen();
  }, CREATION_TIMEUP_AUTO_ACTION_MS);
}

function handleCreationTimeupInteraction() {
  if (!creationTimeupTimer) return;
  const st = matchController.getState();
  if (!st || st.phase !== "creation-timeup" || currentScreen !== "match") return;
  clearCreationTimeupAutoAdvance();
  creationTimeupCancelled = true;
}

function setupCreationTimeupInteractionTracking() {
  ["pointerdown", "touchstart", "mousedown", "keydown"].forEach((evt) => {
    document.addEventListener(evt, handleCreationTimeupInteraction, true);
  });
}

function setupMatchControllerEvents() {
  matchController.on("statechange", () => {
    renderMatch();
    if (skipNextActiveMatchSave) {
      skipNextActiveMatchSave = false;
      return;
    }
    const st = matchController.getState();
    if (!st?.matchOver) {
      scheduleActiveMatchSave(st);
    }
  });
  matchController.on("phaseStart", ({ phase }) => {
    if (phase && phase.endsWith("-run")) {
      clockLowTimeMode = false;
      playClockLoop();
    }
  });
  matchController.on("paused", () => {
    clockLowTimeMode = false;
    stopClockLoop(false);
  });
  matchController.on("tick", ({ phase, remaining }) => {
    updateMatchTick();
    if (!phase) return;
    const kind = phase.startsWith("strategy") ? "strategy" : phase.startsWith("creation") ? "creation" : null;
    if (!kind) return;
    if (remaining <= 10 && remaining > 0) {
      if (!clockLowTimeMode) {
        clockLowTimeMode = true;
        stopClockLoop(false);
      }
      playLowTimeTick();
    } else if (remaining > 10 && clockLowTimeMode) {
      clockLowTimeMode = false;
      playClockLoop();
    }
  });
  matchController.on("timeup", ({ phase }) => {
    clockLowTimeMode = false;
    const kind = phase?.startsWith("strategy") ? "strategy" : "creation";
    triggerTimeUpEffects(kind);
    renderMatch();
  });
  matchController.on("matchFinished", ({ winners }) => {
    stopClockLoop(false);
    finalizeMatchSnapshot(matchController.getState(), { status: "finished" });
    const finalState = matchController.getState();
    recordMatchAverages(finalState);
    finalizeWordRecordCandidates(finalState);
    showMatchWinners(winners);
    if (winnersModalOpen && finalState) {
      const recordsBtn = document.getElementById("matchWinnersRecordsBtn");
      const recordsNote = document.getElementById("matchWinnersRecordsNote");
      updateMatchWinnersRecordsUI(finalState, { recordsBtn, recordsNote });
    }
  });
}

function playModalOpenSound() {
  if (!soundOn || !modalOpenAudio) return;
  const inst = modalOpenAudio.cloneNode();
  inst.volume = (soundVolume / 100) * 1.0;
  inst.play().catch(() => {});
}

function playValidationResultSound(ok = true) {
  if (!soundOn) return;
  const base = ok ? successAudio : failAudio;
  if (!base) return;
  const inst = base.cloneNode();
  inst.volume = (soundVolume / 100) * 1.0;
  inst.play().catch(() => {});
}

function resetWakeLockTimer() {
  if (wakeLockTimer) {
    clearTimeout(wakeLockTimer);
  }
  wakeLockTimer = setTimeout(() => {
    ensureWakeLock(false);
  }, WAKE_LOCK_TIMEOUT_MS);
}

function clampVolume(val) {
  const num = Number(val);
  if (Number.isNaN(num)) return 0;
  return Math.min(100, Math.max(0, Math.round(num)));
}

function toggleVolumeIcon(kind) {
  if (kind === "sound") {
    tempSettings.soundVolume = tempSettings.soundVolume === 0 ? 100 : 0;
    tempSettings.sound = tempSettings.soundVolume > 0;
    applyLiveSettings(tempSettings, { persist: false });
    return;
  }
  if (kind === "music") {
    tempSettings.musicVolume = tempSettings.musicVolume === 0 ? 100 : 0;
    tempSettings.music = tempSettings.musicVolume > 0;
    applyLiveSettings(tempSettings, { persist: false });
  }
}

// Loader strategy:
// - Only resources that appear on the splash itself (logo, background, header icons, main CTA skin)
//   are preloaded here so the percentage reflects real downloads.
// - Avoid wiring assets directly in app/index.html; if needed, put a data-src (or similar) on the tag
//   and assign it here once loaded to keep everything behind the loader and prevent broken images.
// - The rest of the app can rely on normal browser caching when those screens are shown later.
function loadSplashAssets() {
  const logoEl = document.getElementById("splashLogo");
  const logoSrc = (logoEl && logoEl.getAttribute("data-src")) || "assets/img/logo-letters.png";
  const backgroundSrc =
    document.documentElement.getAttribute("data-bg-image") ||
    document.body.getAttribute("data-bg-image");
  const { entries: dataEntries, bySrc } = buildDataSrcEntries();

  const logoNodes = logoEl ? [logoEl] : bySrc.get(logoSrc) || [];
  logoNodes.forEach((node) => {
    if (!node.getAttribute("src")) {
      node.setAttribute("src", PLACEHOLDER_IMG);
    }
  });
  const restData = dataEntries.filter((entry) => entry.src !== logoSrc);

  const logoLoader = () =>
    loadImage(logoSrc).then(() => {
      assignSrcToNodes(logoNodes, logoSrc);
    });

  const backgroundLoader = backgroundSrc
    ? () =>
        loadImage(backgroundSrc).then(() => {
          applyBodyBackground(backgroundSrc);
        })
    : null;

  const explicitRest = [
    "assets/img/rotate-device-icon.png",
    "assets/img/audioOn.svg",
    "assets/img/audioOff.svg",
    "assets/img/musicOn.svg",
    "assets/img/musicOff.svg",
    "assets/img/button.svg",
    "assets/img/settings.svg",
    "assets/img/exit.svg",
    "assets/img/help.svg",
    "assets/img/previous.svg",
  ];

  const soundAssets = [
    "assets/sounds/intro.wav",
    "assets/sounds/click.mp3",
    "assets/sounds/clock-melody.mp3",
    "assets/sounds/tick.mp3",
    "assets/sounds/time.mp3",
    "assets/sounds/open.mp3",
    "assets/sounds/success.mp3",
    "assets/sounds/fail.mp3",
  ];

  const restLoaders = [...restData.map((entry) => entry.loader)];
  const seen = new Set(restData.map((entry) => entry.src));
  explicitRest.forEach((src) => {
    if (src === logoSrc || src === backgroundSrc) return;
    if (seen.has(src)) return;
    seen.add(src);
    restLoaders.push(() => loadImage(src));
  });
  soundAssets.forEach((src) => {
    if (seen.has(src)) return;
    seen.add(src);
    restLoaders.push(() => preloadAsset(src).catch(() => {}));
  });

  return {
    logoLoader,
    backgroundLoader,
    restLoaders,
    total: 1 + (backgroundLoader ? 1 : 0) + restLoaders.length,
  };
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

function applyBodyBackground(url) {
  const targets = [document.documentElement, document.body].filter(Boolean);
  const desktop = isDesktop();
  targets.forEach((el) => {
      if (desktop) {
        el.style.background = `url("${url}") center top repeat fixed`;
        el.style.backgroundSize = "520px auto";
      } else {
        el.style.background = `url("${url}") center / cover no-repeat fixed`;
        el.style.backgroundSize = "cover";
      }
      const root = getComputedStyle(document.documentElement);    
      el.style.backgroundColor = root.getPropertyValue("--sky");
      el.classList.add("bg-pan");
    });
  }

function buildDataSrcEntries() {
  const nodes = Array.from(document.querySelectorAll("[data-src]"));
  const bySrc = new Map();
  const entries = nodes
    .map((node) => {
      const src = node.getAttribute("data-src");
      if (!src) return null;
      if (node.tagName.toLowerCase() === "img" && !node.getAttribute("src")) {
        node.setAttribute("src", PLACEHOLDER_IMG);
      }
      bySrc.set(src, [...(bySrc.get(src) || []), node]);
      return {
        src,
        loader: () =>
          preloadAsset(src, node)
            .then(() => assignSrcToNodes([node], src))
            .catch(() => {}),
      };
    })
    .filter(Boolean);
  return { entries, bySrc };
}

function getManifestHref() {
  const lang = (shellLanguage || "en").toLowerCase();
  const href = `manifest-${lang}.json`;
  const manifestLink = document.querySelector('link[rel="manifest"]');
  if (manifestLink) {
    manifestLink.setAttribute("href", href);
  } else {
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = href;
    document.head.appendChild(link);
  }
  return href;
}

function updateManifestLink() {
  const href = getManifestHref();
  const pwaEl = pwaInstallEl || document.querySelector("pwa-install");
  if (pwaEl) {
    pwaEl.setAttribute("manifest-url", href);
  }
}

function preloadAsset(src, node) {
  if (isOfflineStandaloneIOS()) return Promise.resolve();
  const tag = (node?.tagName || "").toLowerCase();
  if (tag === "video" || tag === "audio" || tag === "source") {
    // Let the browser/service worker reuse cache if available.
    return fetch(src).catch(() => {});
  }
  return loadImage(src);
}

function assignSrcToNodes(nodes, src) {
  nodes.forEach((node) => {
    if ("src" in node) {
      node.src = src;
    } else if (node.tagName.toLowerCase() === "use") {
      node.setAttribute("xlink:href", src);
      node.setAttribute("href", src);
    }
    node.removeAttribute("data-src");
  });
}

  function bootstrapShell() {
    logger.info(`App version ${APP_VERSION}`);
    requestServiceWorkerVersion();
    const textErrors = validateTexts(TEXTS);
  if (textErrors.length) {
    const msg = `Translation validation failed:\n${textErrors.join("\n")}`;
    logger.error(msg);
    throw new Error(msg);
  }
    updateBodyLanguageClass(shellLanguage);
    setupAudio();
    setupMatchControllerEvents();
    matchController.setValidator((word, customRules) =>
    validateWordRemote({
      word,
      language: shellLanguage,
      customRules,
    })
  );
    initValidationSections();
    renderShellTexts();
    updatePreviewBadge();
  initMatch();
  setupLanguageSelector();
  setupNavigation();
  setupActionOverlayListeners();
  setupWakeLockActivityTracking();
  setupCreationTimeupInteractionTracking();
  document.addEventListener("modal:closed", handleModalClosed);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      persistActiveMatchSnapshot(matchController.getState());
    }
  });
  window.addEventListener("pagehide", () => {
    persistActiveMatchSnapshot(matchController.getState());
  });
    if (!unsubscribeLanguage) {
    unsubscribeLanguage = onShellLanguageChange(handleLanguageChange);
    window.addEventListener("beforeunload", () => {
      if (unsubscribeLanguage) unsubscribeLanguage();
      unsubscribeLanguage = null;
    });
  }
  preventRightClick();
  preventMobileZoom();
  fetchVersionFile();
  setupWakeLock();
  setupDebugPanel();
  setupInstallFlow();
  requestPersistentStorage();
  setupServiceWorkerMessaging();
  showScreen(simulatedStartActive || restoredMatchActive ? "match" : "splash");
  startSplashLoader();
  detectInstalledApp().finally(() => updateInstallButtonVisibility());
  scaleGame();
  window.addEventListener("resize", scaleGame);
  window.addEventListener("orientationchange", scaleGame);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scaleGame);
    window.visualViewport.addEventListener("scroll", scaleGame);
  }
  registerServiceWorker();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrapShell);
} else {
  bootstrapShell();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register("service-worker.js")
    .then((registration) => {
      logger.debug("Service worker registered");
      if (navigator.onLine === true) {
        registration.update().catch(() => {});
      }
    })
    .catch((err) => logger.error("Service worker registration failed", err));
}

function updatePreviewBadge() {
  const badge = document.getElementById("previewLogoBadge");
  if (!badge) return;
  const host = window.location.hostname || "";
  const href = window.location.href || "";
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local");
  const isPreview = /preview/i.test(host) || /preview/i.test(href);
  const shouldShow = isPreview || isLocal;
  badge.classList.toggle("hidden", !shouldShow);
  badge.textContent = isLocal && !isPreview ? "LOCAL" : "PREVIEW";
  badge.classList.remove("is-active");
  void badge.offsetWidth;
  if (shouldShow) badge.classList.add("is-active");
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

function saveRecords(records) {
  localStorage.setItem("letterloom_match_records", JSON.stringify(records || {}));
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

function maybeRecordWordScores(matchState, scoresByPlayerId, roundNumber) {
  if (!matchState || !scoresByPlayerId) return;
  if (!lastMatchWord) return;
  const records = loadRecords() || {};
  const when = Date.now();
  Object.entries(scoresByPlayerId).forEach(([playerId, raw]) => {
    const points = Number(raw);
    if (!Number.isFinite(points) || points < RECORD_MIN_POINTS) return;
    const player = matchState.players?.find((p) => String(p.id) === String(playerId));
    const entry = {
      matchId: matchState.matchId,
      playerId,
      playerName: player?.name || "",
      round: roundNumber,
      word: lastMatchWord,
      points,
      when,
      features: { ...lastMatchWordFeatures },
    };
    const next = upsertWordRecord(entry, records);
    records.bestWord = next.bestWord;
  });
  saveRecords(records);
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
    const adjusted = avg * (played / (played + RECORD_AVG_PENALTY_K));
    if (adjusted < RECORD_MIN_POINTS) return;
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
    if (points < RECORD_MIN_POINTS) return;
    if (!isScoreValidForRecord(points, { requireEven: true })) return;
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

function setupServiceWorkerMessaging() {
  if (!("serviceWorker" in navigator)) return;
  let reloaded = false;
  const triggerReload = () => {
    if (reloaded) return;
    reloaded = true;
    logger.info("Service worker requested refresh; reloading");
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (!event.data) return;
    if (event.data.type === "refresh") {
      triggerReload();
      return;
    }
    if (event.data.type === "sw-version") {
      const ver = event.data.version || "unknown";
      const cache = event.data.cache || "";
      logger.info(`Service worker version ${ver}${cache ? ` (${cache})` : ""}`);
    }
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    triggerReload();
  });
}

function requestServiceWorkerVersion() {
  if (!("serviceWorker" in navigator)) return;
  const send = (ctrl) => {
    if (!ctrl || typeof ctrl.postMessage !== "function") return;
    ctrl.postMessage({ type: "get-sw-version" });
  };
  if (navigator.serviceWorker.controller) {
    send(navigator.serviceWorker.controller);
    return;
  }
  navigator.serviceWorker.ready.then((reg) => send(reg.active)).catch(() => {});
}

function handleLanguageChange(lang) {
  if (!TEXTS[lang]) return;
  shellLanguage = lang;
  shellTexts = TEXTS[shellLanguage];
  updateBodyLanguageClass(shellLanguage);
  renderShellTexts();
  applyI18n(document);
  const st = matchController.getState();
  if (st) renderMatchFromState(st);
}

function setupDebugPanel() {
  const container = document.createElement("div");
  container.className = "debug-container";
  container.id = "debug-container";

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "debug-toggle";
  toggleBtn.textContent = "Logs";

  const panel = document.createElement("div");
  panel.className = "debug-panel hidden";
  const title = document.createElement("h3");
  title.textContent = shellTexts.debugLogTitle || "Debug Log";
  const filterRow = document.createElement("div");
  filterRow.className = "debug-filter-row";
  const filterLabel = document.createElement("span");
  filterLabel.textContent = "Filtro";
  const filterSelect = document.createElement("select");
  filterSelect.className = "debug-filter-select";
  ["debug", "info", "warn", "error"].forEach((value) => {
    const opt = document.createElement("option");
    opt.value = value;
    filterSelect.appendChild(opt);
  });
  const storedFilter = localStorage.getItem("debugLogFilter");
  if (storedFilter && ["debug", "info", "warn", "error"].includes(storedFilter)) {
    filterSelect.value = storedFilter;
  } else {
    filterSelect.value = "info";
  }
  filterSelect.addEventListener("change", () => {
    localStorage.setItem("debugLogFilter", filterSelect.value);
    render();
  });
  filterRow.append(filterLabel, filterSelect);
  const list = document.createElement("div");
  panel.appendChild(title);
  panel.appendChild(filterRow);
  panel.appendChild(list);

  container.appendChild(toggleBtn);
  container.appendChild(panel);
  document.body.appendChild(container);

  container.style.display = "none";

  const reveal = () => {
    container.style.display = "block";
  };

  toggleBtn.addEventListener("click", () => {
    panel.classList.toggle("hidden");
  });

  setupDebugRevealGesture(container);
  window.__revealDebugPanel = reveal;

  function render() {
    const allEntries = getLogs();
    const rank = { debug: 0, info: 1, warn: 2, error: 3 };
    const filter = filterSelect.value || "info";
    const minRank = rank[filter] ?? rank.info;
    const entries = allEntries.filter((entry) => (rank[entry.level] ?? 0) >= minRank);
    list.innerHTML = "";
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "debug-log-empty";
      empty.textContent = shellTexts.debugLogEmpty || "Sin entradas";
      list.appendChild(empty);
      return;
    }
    entries.forEach((entry) => {
      const item = document.createElement("div");
      item.className = `debug-log-entry ${entry.level || ""}`;
      const ctx =
        entry.context && entry.context.length
          ? `<div class="ctx">${entry.context
              .map((c) => {
                if (typeof c === "string") return c;
                try {
                  return JSON.stringify(c);
                } catch (err) {
                  return String(c);
                }
              })
              .join(" | ")}</div>`
          : "";
      item.innerHTML = `<div class="debug-log-msg"><strong>[${entry.level.toUpperCase()}]</strong> ${entry.message}</div>
        ${ctx}
        <div class="meta"><span>${new Date(entry.time).toLocaleTimeString()}</span><span>${entry.source.toUpperCase()}</span></div>`;
      list.appendChild(item);
    });
    list.scrollTop = list.scrollHeight;
  }

  debugPanelTitleEl = title;
  debugFilterLabelEl = filterLabel;
  debugFilterSelectEl = filterSelect;
  updateDebugFilterLabels();
  render();
  onLog(() => render());
  updateDebugScale(container);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => updateDebugScale(container));
  }
  window.addEventListener("resize", () => updateDebugScale(container));
}

function fetchVersionFile() {
  if (isOfflineStandaloneIOS()) return;
  const doFetch = () =>
    fetch("src/core/version.js", { cache: "no-store" }).catch((err) =>
      logger.warn("Version file fetch failed", err)
    );
  if ("serviceWorker" in navigator) {
    if (navigator.serviceWorker.controller) {
      doFetch();
      return;
    }
    navigator.serviceWorker.ready.then(doFetch).catch(doFetch);
    return;
  }
  doFetch();
}

function isPreviewEnv() {
  return window.location.pathname.startsWith("/preview");
}

function updateDebugScale(container) {
  const vpScale =
    (window.visualViewport && window.visualViewport.scale) ||
    (window.devicePixelRatio ? 1 / window.devicePixelRatio : 1);
  const effective = vpScale && vpScale !== 1 ? vpScale : 1;
  container.style.transform = `scale(${1 / effective})`;
}

function setupInstallFlow() {
  if (isStandaloneApp() || fromPWA) return;
  pwaInstallReady
    .then(() => {
      const panel = document.getElementById("screen-splash");
      if (!panel) return;

      const pwaEl = document.querySelector("pwa-install") || document.createElement("pwa-install");
      pwaEl.setAttribute("manifest-url", getManifestHref());
      pwaEl.setAttribute("lang", shellLanguage);
      pwaEl.manualChrome = true;
      pwaEl.manualApple = true;
      const isIOSChrome = isIOS() && /CriOS/i.test(navigator.userAgent);
      if (isIOSChrome) {
        pwaEl.disableChrome = true;
        pwaEl.manualChrome = true;
        pwaEl.disableFallback = false;
      }

      if (!pwaEl.isConnected) document.body.appendChild(pwaEl);

      const installBtn = document.getElementById("installAppBtn");
      if (installBtn) {
        installBtn.addEventListener("click", () => triggerPwaInstall(pwaEl, true));
        installButtonEl = installBtn;
      }
      pwaInstallEl = pwaEl;
      updateInstallCopy();
      updateInstallButtonVisibility();

      window.addEventListener("appinstalled", () => updateInstallButtonVisibility());
      window.matchMedia &&
        window
          .matchMedia("(display-mode: standalone)")
          .addEventListener("change", updateInstallButtonVisibility);

      if (fromInstall) {
        logger.debug("fromInstall detected; opening pwa-install dialog");
        triggerPwaInstall(pwaEl, true);
      }
    })
    .catch((err) => logger.warn("pwa-install script not ready", err));
}

async function triggerPwaInstall(pwaEl, force = false) {
  try {
    const element = await waitForPwaInstallElement(pwaEl);
    if (!element) return;

    const promptFn =
      typeof element.openPrompt === "function"
        ? element.openPrompt
        : typeof element.prompt === "function"
        ? element.prompt
        : typeof element.showDialog === "function"
        ? element.showDialog
        : null;

    if (!promptFn) {
      logger.warn("pwa-install prompt not available");
      return;
    }

    const result =
      force && promptFn === element.showDialog
        ? promptFn.call(element, true)
        : promptFn.call(element);

    if (result && typeof result.then === "function") {
      result
        .then((outcome) => logger.debug(`Install choice: ${outcome}`))
        .catch((err) => logger.warn("Install prompt failed", err));
    } else if (force && promptFn === element.showDialog) {
      ensureInstallDialogVisible(element);
    }
  } catch (err) {
    logger.warn("Install prompt failed", err);
  }
}

async function waitForPwaInstallElement(pwaEl) {
  if (!pwaEl) {
    logger.warn("pwa-install element not ready");
    return null;
  }
  try {
    if (window.customElements && typeof window.customElements.whenDefined === "function") {
      await window.customElements.whenDefined("pwa-install");
    }
  } catch (err) {
    logger.warn("pwa-install custom element not defined yet", err);
  }
  if (!pwaEl.isConnected) {
    document.body.appendChild(pwaEl);
  }
  const updateReady = pwaEl.updateComplete;
  if (updateReady && typeof updateReady.then === "function") {
    try {
      await updateReady;
    } catch (err) {
      logger.warn("pwa-install update did not complete cleanly", err);
    }
  }
  return pwaEl;
}

function ensureInstallDialogVisible(pwaEl) {
  requestAnimationFrame(() => {
    const dialog =
      pwaEl.shadowRoot && pwaEl.shadowRoot.querySelector("#pwa-install-element");
    const available = dialog && dialog.classList.contains("available");
    if (!available && typeof pwaEl.showDialog === "function") {
      try {
        pwaEl.showDialog(true);
      } catch (err) {
        logger.warn("Secondary attempt to open install dialog failed", err);
      }
    }
  });
}

function updateInstallButtonVisibility() {
  const btn = installButtonEl || document.getElementById("installAppBtn");
  if (!btn) return;
  const hidden = !fromInstall && (isStandaloneApp() || fromPWA || installedAppDetected);
  btn.style.display = hidden ? "none" : "";
}

async function requestPersistentStorage() {
  if (persistentStorageChecked) return;
  persistentStorageChecked = true;
  if (!(isStandaloneApp() || fromPWA)) return;
  const storage = navigator.storage;
  if (!storage || typeof storage.persist !== "function") return;
  try {
    const granted = await storage.persist();
    if (granted) {
      persistentStorageGranted = true;
      logger.debug("Persistent storage granted");
    } else {
      logger.warn("Persistent storage denied");
    }
  } catch (err) {
    logger.warn("Persistent storage request failed", err);
  }
}

function updateInstallCopy() {
  if (installButtonEl) {
    installButtonEl.textContent = shellTexts.installButtonText;
  }
  const pwaEl = pwaInstallEl || document.querySelector("pwa-install");
  if (pwaEl) {
    pwaEl.setAttribute("lang", shellLanguage);
    if (shellTexts.installPromptTitle) {
      pwaEl.setAttribute("install-title", shellTexts.installPromptTitle);
    }
    if (shellTexts.installPromptDescription) {
      pwaEl.setAttribute("install-description", shellTexts.installPromptDescription);
    }
    if (shellTexts.appDescription) {
      pwaEl.setAttribute("description", shellTexts.appDescription);
    }
    if (shellTexts.appTitle) {
      pwaEl.setAttribute("name", shellTexts.appTitle);
    }
  }
}

async function detectInstalledApp() {
  if (installedAppDetected) return true;
  if (isStandaloneApp()) {
    installedAppDetected = true;
    return true;
  }
  if (navigator.getInstalledRelatedApps) {
    try {
      const manifestUrl = new URL(getManifestHref(), window.location.href).toString();
      const related = await navigator.getInstalledRelatedApps();
      const match = related.some(
        (app) =>
          app.manifestUrl === manifestUrl ||
          (app.manifestUrl && app.manifestUrl.endsWith(`/${getManifestHref()}`))
      );
      if (match) {
        installedAppDetected = true;
        return true;
      }
    } catch (err) {
      logger.warn("getInstalledRelatedApps failed", err);
    }
  }
  return installedAppDetected;
}

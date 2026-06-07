import {
  createTrainingMatch,
  getTrainingMatch,
  saveTrainingMatch,
  clearTrainingMatch,
  initializeRound,
  revealLetterSlot,
  revealBoardSlot,
  fillRemainingBoardRandomly,
  fillRemainingHandRandomly,
  tickStrategyTimer,
  tickCreationTimer,
  enterActionsPhase,
  selectActionInStrategy,
  planGhostAction,
  applyPlannedGhostAction,
  useShieldOnAttack,
  playUserAction,
  advanceActionsQueue,
  userHasShield,
  playerHasShield,
  autoDrawForEmptyGhosts,
  isAttackOnUser,
  isUserShieldPreSelected,
  drawEmergencyLetter,
  userHandHasNoLetters,
  finalizeUserWord,
  addToWord,
  removeFromWord,
  reorderWord,
  toggleTildeInWord,
  setWildcardLetterInWord,
  submitUserWord,
  advanceToNextBaza,
} from "../../core/trainingMatch.js";
import {
  ACTION_CARDS,
  TRAINING_DIFFICULTIES,
  TRAINING_DIFFICULTY_PRESETS,
  getActionCardDefsForLanguage,
} from "../../core/constants.js";
import { findHints } from "../../core/hintSolver.js";
import { validateWord as validateWordLayered, LAYER_PRESETS } from "../../core/wordValidator.js";
import { renderScoreBreakdown } from "./scoreBreakdown.js";
import {
  configurePhaseFlash,
  maybeShowPhaseFlash,
  getPhaseFlashEndsAt,
  resetPhaseFlash,
  PHASE_FLASH_DURATION_MS,
  STRATEGY_BANNER_DELAY_MS,
} from "./phaseFlash.js";
import {
  configureActionToast,
  showActionToast,
  updateAttackBannerDetail,
  attachActionBubble,
  clearActionBanner,
  getCurrentActionBubble,
  BUBBLE_AUTOHIDE_MS,
} from "./actionToast.js";
import {
  configureActionFX,
  applyActionWithFX,
  playActionWithReadDelay,
  consumeLastFxMoves,
  fxFlushPostRender,
  fxConsumePopIn,
  fxConsumePulse,
  fxConsumeFadeIn,
} from "./actionFX.js";
import { TIMING } from "./timing.js";
import {
  configureActionsController,
  setProcessTurnFn,
  scheduleDriverTick,
  stopDriver,
  isDriverBusy,
  markDriverBusy,
  clearDriverBusy,
  ensureDriverScheduledIfNeeded,
  advanceAfterAction,
} from "./actionsController.js";
import { getForcedWordLanguage } from "../../core/wordRules.js";
import {
  debugLogReset,
  debugLogPushBazaStart,
  debugLogPushPreselect,
  debugLogPushAction,
  debugLogPushWord,
  debugLogPushBazaEnd,
  formatDebugLog,
} from "./trainingDebugLog.js";
import { updateState, loadState } from "../../core/stateStore.js";
import { logger } from "../../core/logger.js";
import { TEXTS, getShellLanguage } from "../../i18n/texts.js";
import { openModal, closeModal, closeTopModal, closeAllModals } from "../shell/modal.js";
import { renderLetterCard } from "../components/letterCard.js";
import {
  renderActionCard,
  actionLabel,
  actionDesc,
  humanActionName,
  makeActionIconEl,
} from "../components/actionCard.js";

// Shell callbacks — set via initTraining() during app bootstrap
let _shell = {
  showScreen: () => {},
  playClickFeedback: () => {},
  openConfirm: () => {},
  playClockLoop: () => {},
  stopClockLoop: () => {},
  setI18nById: () => {},
  renderMatch: () => {},
  triggerTimeUpEffects: () => {},
  playLowTimeTick: () => {},
};

export function initTraining(callbacks) {
  Object.assign(_shell, callbacks);
}

// i18n helper — reads current language from TEXTS
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

function textForTrainingLanguage(lang) {
  const uiLang = normalizeLanguage(getShellLanguage());
  const code = normalizeLanguage(lang);
  if (uiLang === "en") return code === "en" ? "English" : "Spanish";
  return code === "en" ? "Inglés" : "Español";
}

// Wire the shared phase-flash module to the training-screen-specific render
// and i18n helper. Arrow functions defer the lookup to call time so the
// forward references resolve correctly.
configurePhaseFlash({
  render: () => renderTrainingMatch(),
  t: (key) => t(key),
  flashElementId: "trainingPhaseFlash",
});

// Wire the shared action-toast module. `isReachingUser` is the training
// rule: target=userId OR the card's `target` meta is "all". Online match
// will share the same rule when wired against its own state.
configureActionToast({
  humanActionName: (id) => humanActionName(id),
  isReachingUser: (state, log) => {
    const userId = state?.players?.[0]?.id;
    if (!userId || log?.playerId === userId) return false;
    const def = ACTION_CARDS.find((c) => c.id === log.actionId);
    return log.targetId === userId || def?.target === "all";
  },
  bannerElementId: "trainingAttackBanner",
  bubbleClass: "training-action-bubble",
  pillSelector: (pid) => `.training-score-pill[data-player-id="${pid}"]`,
  userPillSelector: ".training-score-pill.is-user",
});

// Wire the shared action FX module to this screen's state + render. The
// pill selector and score-chip class default to training's CSS but are
// configurable for the future online match.
configureActionFX({
  getState: () => getTrainingMatch(),
  render: () => renderTrainingMatch(),
  pillSelector: (pid) => `.training-score-pill[data-player-id="${pid}"]`,
  cardSelector: ".tcard[data-card-id]",
  scoreChipClass: "training-score-chip",
});

// Actions-phase driver. The controller owns the busy mutex and the
// scheduling timeout; this module just registers the "process one turn"
// callback and how to advance the queue / handle emergency draws.
configureActionsController({
  getState: () => getTrainingMatch(),
  advanceQueue: (s) => advanceActionsQueue(s),
  render: () => renderTrainingMatch(),
  onEmergencyDraw: (resume) => maybeOfferEmergencyDraw(resume),
  cooldownMs: BUBBLE_AUTOHIDE_MS,
  ghostGapMs: TIMING.actionsDriver.ghostGapMs,
});
setProcessTurnFn(() => processNextActionsTurn());

function getTrainingEffectiveWordLanguage(state) {
  if (state?.userWordResult?.language) return normalizeLanguage(state.userWordResult.language);
  if (trainingWordLangOverride) return trainingWordLangOverride;
  const userId = state?.players?.[0]?.id;
  const forcedEffects = userId ? (state.forcedRules?.[userId] ?? []) : [];
  return getForcedWordLanguage(state?.language || "es", forcedEffects);
}

function shouldShowTrainingResultLanguageBadge(state, result) {
  if (!result?.languageBonusAttempted) return false;
  return normalizeLanguage(result.language) !== normalizeLanguage(state?.language || "es");
}

function formatMovedLetters(moves) {
  const letters = (moves ?? [])
    .map((m) => String(m?.letter || "?").toUpperCase())
    .filter(Boolean);
  if (letters.length === 0) return "";
  return letters.slice(0, 4).join(", ") + (letters.length > 4 ? "..." : "");
}

function formatActionBannerDetailForUser(state, log, moves) {
  const userId = state?.players?.[0]?.id;
  if (!userId || !log || !Array.isArray(moves) || moves.length === 0) return "";
  const userHandKey = `hand:${userId}`;
  const actorHandKey = `hand:${log.playerId}`;
  const fromUser = moves.filter((m) => m.fromKey === userHandKey);
  const toUser = moves.filter((m) => m.toKey === userHandKey);
  const toBoard = moves.filter((m) => m.fromKey === userHandKey && m.toKey === "board");
  const toDiscard = moves.filter((m) => m.fromKey === userHandKey && !m.toKey);

  switch (log.actionId) {
    case "steal_letter":
    case "great_heist": {
      const stolen = fromUser.filter((m) => m.toKey === actorHandKey || m.toKey?.startsWith("hand:"));
      const letters = formatMovedLetters(stolen);
      return letters ? `Te roba ${letters}` : "";
    }
    case "out_one": {
      const letters = formatMovedLetters(toDiscard);
      return letters ? `Pierdes ${letters}` : "";
    }
    case "discard_one": {
      const letters = formatMovedLetters(toDiscard);
      return letters ? `Descartas ${letters}` : "";
    }
    case "two_to_center": {
      const boardLetters = formatMovedLetters(toBoard);
      if (boardLetters) return `Tu ${boardLetters} va al tablero`;
      const discardLetters = formatMovedLetters(toDiscard);
      return discardLetters ? `Te quita ${discardLetters}` : "";
    }
    case "one_for_all": {
      const letters = formatMovedLetters(toBoard);
      return letters ? `Pone tu ${letters} en el tablero` : "";
    }
    case "swap_all": {
      const received = formatMovedLetters(toUser);
      const given = formatMovedLetters(fromUser);
      if (received && given) return `Recibes ${received}; das ${given}`;
      if (received) return `Recibes ${received}`;
      if (given) return `Das ${given}`;
      return "";
    }
    default:
      return "";
  }
}

function consumeMovesAndUpdateAttackBanner(state, log) {
  const moves = consumeLastFxMoves();
  const detail = formatActionBannerDetailForUser(state, log, moves);
  if (detail) updateAttackBannerDetail(detail);
  return moves;
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

// Module-level state
let creationTimeupTimer = null;
let creationTimeupCancelled = false;
let dealerFocusTimer = null;
// actionsDriverTimeout / actionsDriverBusy now live in ./actionsController.js.
// Use scheduleDriverTick/stopDriver/markDriverBusy/clearDriverBusy/isDriverBusy.
let focusedActionIndex = null;
let lastActionTapIndex = null;
let lastActionTapTime = 0;
const DOUBLE_TAP_MS = 400;
// currentActionBubble / bubbleAutoHideTimeout / BUBBLE_AUTOHIDE_MS now live
// in ./actionToast.js (shared with future online match). Use the imported
// getCurrentActionBubble()/clearActionBanner()/showActionToast()/etc.
let trainingTimerInterval = null;
let trainingClockPhase = null;
let debugMode = false;
// Phase-flash module configured below; uses _shell-injected `t` and
// `renderTrainingMatch` to handle i18n and the post-banner re-render.
let userTurnTimerInterval = null;
let userTurnRemainingMs = 0;

const USER_TURN_DURATION_MS = TIMING.userTurn;
const LOW_TIME_THRESHOLD = TIMING.lowTime;
const PICKER_TIMEOUT_MS = TIMING.picker;
const TILDE_FORMS = { A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" };
const VOWEL_LETTERS = ["A", "E", "I", "O", "U"];
const CONSONANT_LETTERS = [
  "B","C","D","F","G","H","J","K","L","M","N","Ñ","P","Q","R","S","T","V","W","X","Y","Z",
];
const TRAINING_SECTION_MAX_CARD_SIZE = 56;
const TRAINING_SECTION_CARD_GAP = 5;

function setupTrainingDebugToggle() {
  let pressTimer = null;
  const el = document.getElementById("trainingRoundLabel");
  if (!el) return;
  el.addEventListener("pointerdown", () => {
    pressTimer = setTimeout(() => {
      debugMode = !debugMode;
      const badge = document.getElementById("trainingDebugBadge");
      if (badge) badge.classList.toggle("hidden", !debugMode);
      renderTrainingMatch();
    }, 800);
  });
  el.addEventListener("pointerup",     () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
  el.addEventListener("pointercancel", () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });

  // Click on the 🐛 DEBUG badge → open the debug log modal.
  const badgeEl = document.getElementById("trainingDebugBadge");
  if (badgeEl) {
    badgeEl.style.cursor = "pointer";
    badgeEl.addEventListener("click", openTrainingDebugLog);
  }
  const copyBtn = document.getElementById("trainingDebugLogCopyBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const body = document.getElementById("trainingDebugLogBody");
      if (!body) return;
      try {
        await navigator.clipboard.writeText(body.textContent || "");
        copyBtn.textContent = "✓ Copiado";
        setTimeout(() => { copyBtn.textContent = "📋 Copiar"; }, 1200);
      } catch {
        copyBtn.textContent = "✗ Falló";
      }
    });
  }

  // Long-press on the phase label (REPARTO/CREACIÓN/etc.) reveals the hint
  // button in non-practice difficulties. In "words" (Practicar) the hint button
  // is always visible.
  let hintPressTimer = null;
  const phaseEl = document.getElementById("trainingPhaseLabel");
  if (phaseEl) {
    phaseEl.addEventListener("pointerdown", () => {
      hintPressTimer = setTimeout(() => {
        hintRevealedByLongPress = !hintRevealedByLongPress;
        updateHintButtonVisibility();
      }, 800);
    });
    phaseEl.addEventListener("pointerup",     () => { if (hintPressTimer) { clearTimeout(hintPressTimer); hintPressTimer = null; } });
    phaseEl.addEventListener("pointercancel", () => { if (hintPressTimer) { clearTimeout(hintPressTimer); hintPressTimer = null; } });
  }
}

// Called when the user taps the "Listo" button during strategy OR when the
// strategy timer naturally expires. If a card is focused, it becomes the
// preselected action; otherwise we just enter the actions phase without
// preselection.
function confirmStrategyReady() {
  const state = getTrainingMatch();
  if (!state || state.phase !== "strategy") return;
  stopTrainingTimer();
  trainingClockPhase = null;
  _shell.stopClockLoop(false);
  let after;
  if (focusedActionIndex != null) {
    const userId = state.players[0].id;
    const card = state.hands[userId]?.actions?.[focusedActionIndex];
    after = selectActionInStrategy(state, focusedActionIndex);
    if (card) debugLogPushPreselect(after, card.actionId);
  } else {
    // No focus → enter actions without preselection.
    after = enterActionsPhase(state);
  }
  focusedActionIndex = null;
  renderTrainingMatch();
  if (after.phase === "actions") scheduleDriverTick();
}

function openTrainingDebugLog() {
  const body = document.getElementById("trainingDebugLogBody");
  if (!body) return;
  const state = getTrainingMatch();
  body.textContent = formatDebugLog(state);
  openModal("training-debug-log", { closable: true });
}

// ── Debug: swap the action cards dealt to the user ──────────────────────────
// In debug mode only, long-pressing on one of the user's action cards opens a
// picker with every MVP action, so the tester can replace the dealt card with
// a specific one before the strategy phase advances. This lets you set up the
// exact sequence you want to test without re-shuffling the deck.
function attachDebugActionSwapLongPress(el, idx) {
  let pressTimer = null;
  const start = (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      openDebugActionSwapPicker(idx);
    }, 700);
  };
  const cancel = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
  el.addEventListener("pointerdown", start);
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("pointerleave", cancel);
}

function openDebugActionSwapPicker(slotIndex) {
  const state = getTrainingMatch();
  if (!state) return;
  const userId = state.players[0].id;
  const mvpCards = getActionCardDefsForLanguage(state.language).filter((c) => c.inMVP);
  openTrainingPicker({
    titleKey: null,
    context: { label: "🐛 Cambiar carta:", kind: "self" },
    options: mvpCards.map((c) => ({ id: c.id, label: humanActionName(c.id) })),
    onPick: (actionId) => {
      const cur = getTrainingMatch();
      if (!cur) return;
      const userHand = cur.hands[userId];
      if (!userHand || userHand === "<hidden>") return;
      const cardDef = ACTION_CARDS.find((c) => c.id === actionId);
      const newCard = {
        id: `dbg-${actionId}-${Date.now()}`,
        type: "action",
        ...cardDef,
        actionId: cardDef.id,
      };
      const newActions = (userHand.actions ?? []).slice();
      newActions[slotIndex] = newCard;
      const next = {
        ...cur,
        hands: { ...cur.hands, [userId]: { ...userHand, actions: newActions } },
      };
      saveTrainingMatch(next);
      renderTrainingMatch();
    },
  });
}

// Hint button visibility:
//   - PRACTICAR (words): hidden during creation phase, auto-reveals after
//     PRACTICE_HINT_DELAY_MS of idle thinking (no validation submitted yet).
//   - Other modes: hidden until the user long-presses the phase pill.
const PRACTICE_HINT_DELAY_MS = TIMING.practiceHint;
let hintRevealedByLongPress = false;
let practiceHintTimer = null;

// Language toggle state for the word-strip (training creation phase).
// Only shown when the user has an in_english/in_spanish card active.
// null = no override (use game language); "en"/"es" = user's choice.
let trainingWordLangOverride = null;
let practiceHintRevealed = false;
let practiceHintKey = null;

function resetPracticeHintTimer() {
  if (practiceHintTimer) {
    clearTimeout(practiceHintTimer);
    practiceHintTimer = null;
  }
  practiceHintRevealed = false;
  practiceHintKey = null;
}

function updateHintButtonVisibility() {
  const btn = document.getElementById("trainingHintBtn");
  if (!btn) return;
  const state = getTrainingMatch();
  const isPractice = state?.difficulty === "words";
  const inCreation = state?.phase === "creation";

  if (isPractice) {
    if (inCreation) {
      // First time we see this (round, phase) → start the 46s reveal timer.
      const key = `${state.round}-${state.phase}`;
      if (key !== practiceHintKey) {
        practiceHintKey = key;
        practiceHintRevealed = false;
        if (practiceHintTimer) clearTimeout(practiceHintTimer);
        practiceHintTimer = setTimeout(() => {
          practiceHintRevealed = true;
          practiceHintTimer = null;
          const b = document.getElementById("trainingHintBtn");
          if (b) b.classList.remove("hidden");
        }, PRACTICE_HINT_DELAY_MS);
      }
      btn.classList.toggle("hidden", !practiceHintRevealed);
    } else {
      // Left creation phase (validated, next baza, etc.) → reset for next round.
      resetPracticeHintTimer();
      btn.classList.add("hidden");
    }
    return;
  }

  // Non-practice modes: visibility driven solely by long-press toggle.
  btn.classList.toggle("hidden", !hintRevealedByLongPress);
}

function renderTrainingSetup() {
  const state = loadState();
  const stats = state.training?.stats || {};
  for (const diff of TRAINING_DIFFICULTIES) {
    const preset = TRAINING_DIFFICULTY_PRESETS[diff];
    const cap = capitalizeStr(diff);
    _shell.setI18nById(`trainingCard${cap}Players`, preset.opponents === 0 ? "trainingCardNoOpponents" : "trainingCardPlayers", {
      vars: { opponents: preset.opponents },
    });
    const timerKey = preset.untimedCreation
      ? "trainingCardNoTimer"
      : (preset.skipStrategy ? "trainingCardCreationTimer" : "trainingCardTimers");
    _shell.setI18nById(`trainingCard${cap}Timers`, timerKey, {
      vars: { strategy: preset.strategySeconds, creation: preset.creationSeconds },
    });
    const cardEl = document.getElementById(`trainingCard${cap}`);
    cardEl?.querySelector(".training-card-clock")?.classList.toggle("hidden", !!preset.untimedCreation);
    const best = stats[diff]?.best;
    const statEl = document.getElementById(`trainingCard${cap}Stat`);
    if (best != null) {
      _shell.setI18nById(`trainingCard${cap}Stat`, "trainingCardBest", { vars: { points: best } });
      statEl?.classList.remove("hidden");
    } else {
      statEl?.classList.add("hidden");
    }
  }
}

function startTrainingMatch(difficulty) {
  _shell.playClickFeedback();
  const preset = TRAINING_DIFFICULTY_PRESETS[difficulty];
  if (!preset) return;
  const nickname = loadState().settings?.knownPlayerNames?.[0] || null;
  const state = createTrainingMatch(difficulty, { userNickname: nickname, language: getShellLanguage() });
  logger.info("Training match created", { matchId: state.matchId, difficulty });
  debugLogReset();
  debugLogPushBazaStart(state);
  resetPhaseFlash();
  _shell.showScreen("training");
}

// ── Training match rendering (Block 1: skeleton + placeholders) ──

function renderTrainingMatch() {
  let state = getTrainingMatch();
  if (!state) {
    _shell.showScreen("training-setup");
    return;
  }
  // Deal central board + action cards on first render of a fresh round.
  if (state.centralBoard.length === 0) {
    state = initializeRound(state);
    // If the dealer is a ghost, the board has just been auto-filled. Give
    // it the same theatrical reveal as the human-dealer case: face-down
    // backs for a short hold, then a cascade flip to face-up.
    const userId = state.players[0].id;
    const dealerIsGhost = state.dealerId !== userId;
    const boardHasCards = (state.centralBoard ?? []).some((c) => c != null);
    if (dealerIsGhost && boardHasCards) {
      ghostBoardDealHoldUntil = Date.now() + GHOST_BOARD_DEAL_HOLD_MS;
      setTimeout(() => {
        const cur = getTrainingMatch();
        (cur?.centralBoard ?? []).forEach((c, i) => {
          if (c) markRevealed("board", i);
        });
        renderTrainingMatch();
      }, GHOST_BOARD_DEAL_HOLD_MS);
    }
  }

  _shell.setI18nById("trainingMatchTitle", `trainingDifficulty${capitalizeStr(state.difficulty)}`);
  renderLanguageBadge(document.getElementById("trainingMatchTitle"), state.language);
  _shell.setI18nById("trainingBoardLabel", "trainingBoardLabel");
  _shell.setI18nById("trainingHandLabel", "trainingHandLabel");
  _shell.setI18nById("trainingHintBtnLabel", "trainingHintBtnLabel");
  _shell.setI18nById("trainingRoundLabel", "trainingRoundLabel", {
    vars: { round: state.round, total: state.roundsTarget },
  });
  _shell.setI18nById("trainingPhaseLabel", `trainingPhase${capitalizeStr(state.phase)}`);
  const _debugBadge = document.getElementById("trainingDebugBadge");
  if (_debugBadge) _debugBadge.classList.toggle("hidden", !debugMode);
  renderTrainingPrompt(state);

  renderTrainingScoreboard(state);
  renderTrainingForcedRules(state);
  renderTrainingWordStrip(state);
  renderTrainingBoard(state);
  renderTrainingValidateButton(state);
  renderTrainingHand(state);
  renderTrainingActions(state);
  renderTrainingTimer(state);
  renderTrainingResult(state);
  const isResultOrDone = state.phase === "result" || state.phase === "done";
  // During result/done: hide the game content sections so the result panel can expand.
  [".training-section.is-board", ".training-section:not(.is-board)"].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) el.classList.toggle("hidden", isResultOrDone);
  });
  // While the user is dealing the central board, hide (but keep space for)
  // the hand and word-strip sections so the layout doesn't jump when they
  // appear later.
  const boardFilledForLayout = (state.centralBoard ?? []).length > 0
    && (state.centralBoard ?? []).every((c) => c != null);
  const handHoldActive = state.phase === "dealing"
    && boardFilledForLayout
    && Date.now() < handPickerHoldUntil;
  const reserveHandSpace = state.phase === "dealing"
    && (!boardFilledForLayout || handHoldActive);
  const matchRoot = document.querySelector(".training-match");
  if (matchRoot) matchRoot.classList.toggle("is-board-dealing", reserveHandSpace);
  const reserveWordSpace = ["dealing", "strategy", "actions"].includes(state.phase);
  if (matchRoot) matchRoot.classList.toggle("is-pre-creation", reserveWordSpace);
  document.getElementById("trainingValidateWrap")?.classList.toggle("hidden", isResultOrDone || !(state.phase === "creation" && state.untimedCreation));
  updateHintButtonVisibility();
  // maybeShowPhaseFlash MUST run before ensureTrainingTimer — the flash
  // handler updates `phaseFlashEndsAt`, which the timer reads to decide if
  // it should gate (don't tick while the banner is still visible). With the
  // opposite order the very first render of a new phase saw
  // phaseFlashEndsAt = 0 and the timer started immediately.
  maybeShowPhaseFlash(state);
  if (state.phase === "strategy" || state.phase === "creation") {
    ensureTrainingTimer();
  } else {
    stopTrainingTimer();
  }
  const userId = state.players[0].id;
  // Safety-net: if we end up in actions phase with a non-empty queue and no
  // pending driver tick (because, e.g., this render came from a prompt
  // resolving), kick the driver. The controller checks the busy mutex and
  // does nothing if it can't proceed.
  const isUserTurn = state.actionsQueue?.[0] === userId && state.userActionIndex == null;
  if (state.phase === "actions" && !isUserTurn) {
    ensureDriverScheduledIfNeeded();
  }
  if (state.phase !== "strategy" && focusedActionIndex != null) { focusedActionIndex = null; lastActionTapIndex = null; }
  if (state.phase !== "actions") clearActionBanner();
  maybeStartUserTurnTimer(state);
  if (state.phase === "creation") {
    // Safety net: if the user reached creation with an empty hand somehow,
    // give them an emergency letter (manual rule).
    maybeOfferEmergencyDraw();
  }
  // Run any post-render FX (fly ghosts, pop-out ghosts, score chips) once
  // the DOM reflects the new state — they need both src (captured before
  // applyActionWithFX) and dst (current DOM) positions.
  fxFlushPostRender();
}

function capitalizeStr(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

// Shows the contextual prompt above the row that needs the user's attention,
// and hides the top instruction (or vice-versa for non-interactive phases).
function renderTrainingPrompt(state) {
  const topInstr    = document.getElementById("trainingInstruction");
  const timerPrompt = document.getElementById("trainingTimerPrompt");
  const doneBtn     = document.getElementById("trainingTimerDoneBtn");
  if (!topInstr || !timerPrompt || !doneBtn) return;

  // All phase prompts now share the slot below the timer.
  topInstr.classList.add("hidden");
  timerPrompt.classList.add("hidden");
  timerPrompt.classList.remove("is-collapsed", "is-action-required", "is-info");
  doneBtn.classList.add("hidden");

  const userId = state.players[0].id;
  let key = null;
  let showDone = false;
  let promptKind = "is-info";

  // Visibility of the random-deal buttons follows the dealing sub-phase.
  const dealBoardBtn = document.getElementById("trainingDealRandomBoardBtn");
  const dealHandBtn = document.getElementById("trainingDealRandomHandBtn");
  const dealBoardLabel = document.getElementById("trainingDealRandomBoardLabel");
  const dealHandLabel = document.getElementById("trainingDealRandomHandLabel");
  if (dealBoardLabel) dealBoardLabel.textContent = t("trainingDealRandomBtn") || "Aleatorio";
  if (dealHandLabel) dealHandLabel.textContent = t("trainingDealRandomBtn") || "Aleatorio";
  if (dealBoardBtn) dealBoardBtn.classList.add("hidden");
  if (dealHandBtn) dealHandBtn.classList.add("hidden");

  if (state.phase === "dealing") {
    const boardFilled = (state.centralBoard ?? []).every((c) => c != null)
      && (state.centralBoard ?? []).length > 0;
    const handLetters = state.hands[userId]?.letters ?? [];
    const handHasNulls = handLetters.some((c) => c == null);
    const handReady = boardFilled && Date.now() >= handPickerHoldUntil;
    if (!boardFilled && dealBoardBtn) dealBoardBtn.classList.remove("hidden");
    if (handReady && handHasNulls && dealHandBtn) dealHandBtn.classList.remove("hidden");
    promptKind = "is-action-required";
    const boardPrompt = document.getElementById("trainingBoardPrompt");
    if (!boardFilled) {
      // Still dealing the board → board prompt visible, timer prompt
      // collapsed so it doesn't reserve vertical space.
      timerPrompt.classList.add("hidden", "is-collapsed");
      if (boardPrompt) {
        boardPrompt.classList.remove("hidden");
        _shell.setI18nById("trainingBoardPrompt", "trainingInstrDealingBoard");
      }
      return;
    }
    if (!handReady) {
      // Board just completed but we're holding the hand picker for a moment
      // so the user can read the central letters. Hide both prompts.
      timerPrompt.classList.add("hidden", "is-collapsed");
      if (boardPrompt) boardPrompt.classList.add("hidden");
      return;
    }
    timerPrompt.classList.remove("is-collapsed");
    if (boardPrompt) boardPrompt.classList.add("hidden");
    key = "trainingInstrDealingHand";
  } else {
    const boardPrompt = document.getElementById("trainingBoardPrompt");
    if (boardPrompt) boardPrompt.classList.add("hidden");
  }
  if (state.phase === "strategy") {
    key = "trainingInstrStrategy";
    showDone = true;
    promptKind = "is-action-required";
  } else if (state.phase === "creation") {
    // Strip label "TU PALABRA" is enough — collapse the timer prompt to
    // free vertical space, but keep the Listo button visible.
    timerPrompt.classList.add("is-collapsed");
    showDone = !state.untimedCreation;
  } else if (state.phase === "actions"
      && state.actionsQueue?.[0] === userId
      && !state.userActionResolved
      && !isUserTurnBlockedByActionBubble(state)) {
    key = "trainingInstrUserTurn";
    promptKind = "is-action-required";
  } else if (state.phase === "actions") {
    key = "trainingInstrActions";
  } else if (state.phase === "result") {
    key = "trainingInstrResult";
  }

  if (key) {
    _shell.setI18nById("trainingTimerPrompt", key);
    timerPrompt.classList.add(promptKind);
    timerPrompt.classList.remove("hidden");
  }
  if (showDone) {
    doneBtn.setAttribute("aria-label", t("trainingTimerDone") || "");
    doneBtn.classList.remove("hidden");
  }
}

// Phase-flash module is configured at module init time (below) so it can
// dispatch `t()` and `renderTrainingMatch()` without coupling to host
// specifics. `maybeShowPhaseFlash`, `getPhaseFlashEndsAt`, `resetPhaseFlash`
// are imported from ./phaseFlash.js.

function renderTrainingScoreboard(state) {
  const root = document.getElementById("trainingScoreboard");
  if (!root) return;
  root.innerHTML = "";

  const currentActorId = state.phase === "actions" ? (state.actionsQueue?.[0] ?? null) : null;
  const userId = state.players?.[0]?.id ?? null;
  const userTurnBlockedByBubble = isUserTurnBlockedByActionBubble(state);
  const waitingForUserAction = state.phase === "actions"
    && currentActorId === userId
    && state.userActionIndex == null
    && !state.userActionResolved
    && !userTurnBlockedByBubble;
  const bubbleActorId = state.phase === "actions" && !waitingForUserAction
    ? (getCurrentActionBubble()?.playerId ?? null)
    : null;

  for (const p of state.players) {
    const hand = state.hands?.[p.id];
    const letters = hand && hand !== "<hidden>" ? (hand.letters ?? []).filter(Boolean) : [];
    // Pill is shown only when the player is actually shielded — i.e. the
    // shield has been activated (reactive prompt accepted or proactively
    // played on their turn). Preselection alone does NOT light it up.
    const hasShield = (state.shieldedPlayers ?? []).includes(p.id);
    const isDealer = p.id === state.dealerId;
    const isActive = bubbleActorId ? p.id === bubbleActorId : p.id === currentActorId;

    const pill = document.createElement("div");
    let pillClass = "training-score-pill" + (p.isGhost ? "" : " is-user");
    if (hasShield) pillClass += " has-shield";
    if (isDealer) pillClass += " is-dealer";
    if (isActive) pillClass += " is-active";
    pill.className = pillClass;
    pill.dataset.playerId = p.id;

    const name = document.createElement("span");
    name.className = "training-score-pill-name";
    name.textContent = p.name;

    const value = document.createElement("span");
    value.className = "training-score-pill-value";
    value.textContent = String(p.score);

    // Card count: one dot per actual letter in hand (no fixed cap)
    const dots = document.createElement("div");
    dots.className = "training-score-pill-cards";
    const dotCount = Math.max(letters.length, 1); // at least 1 slot so pill doesn't collapse
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
    // Accumulated score modifier this baza (boost_total, explosion, etc.).
    // Persistent badge so the user always knows the
    // running +/- attached to each player at scoring time.
    const mod = state.scoreModifiers?.[p.id] ?? 0;
    if (mod !== 0) {
      const modBadge = document.createElement("span");
      modBadge.className = "pill-badge pill-badge-mod " + (mod > 0 ? "is-positive" : "is-negative");
      modBadge.textContent = (mod > 0 ? "+" : "") + mod;
      pill.appendChild(modBadge);
    }

    pill.append(name, value, dots);
    root.appendChild(pill);
  }
  attachActionBubble();
}

function renderTrainingBoard(state) {
  const root = document.getElementById("trainingBoard");
  if (!root) return;
  root.innerHTML = "";
  const slots = state.centralBoard.length
    ? state.centralBoard
    : Array.from({ length: 5 }, () => null);
  const isDealing = state.phase === "dealing";
  const isCreation = state.phase === "creation";
  const wordIds = new Set((state.userWord ?? []).map((s) => s.cardId));
  const requiredCardIds = collectRequiredCardIds(state);
  // During the ghost-deal hold window, render board cards as face-down
  // (V/C colored backs) so the cascade flip has something to reveal.
  const showBoardFaceDown = Date.now() < ghostBoardDealHoldUntil;
  slots.forEach((card, idx) => {
    if (!card && isDealing) {
      root.appendChild(renderDealPickerCard(idx, "board"));
      return;
    }
    const el = renderLetterCard(card, { faceDown: showBoardFaceDown });
    if (card && requiredCardIds.has(card.id)) {
      el.classList.add("is-required-letter");
    }
    if (card && consumeReveal("board", idx)) {
      el.classList.add("is-reveal-flip");
      attachRevealCleanup(el);
    } else if (card && fxConsumePopIn(card.id)) {
      el.classList.add("is-reveal-pop");
      attachRevealCleanup(el);
    } else if (card) {
      const fadeDelay = fxConsumeFadeIn(card.id);
      if (fadeDelay != null) {
        el.style.setProperty("--shuffle-rot", (Math.random() < 0.5 ? -14 : 14) + "deg");
        if (fadeDelay > 0) el.style.animationDelay = `${fadeDelay}ms`;
        el.classList.add("is-fade-in");
        el.addEventListener("animationend", () => {
          el.classList.remove("is-fade-in");
          el.style.animationDelay = "";
        }, { once: true });
      }
    }
    if (card && fxConsumePulse(card.id)) {
      el.classList.add("is-forced-pulse");
      el.addEventListener("animationend", () => el.classList.remove("is-forced-pulse"), { once: true });
    }
    if (card && isCreation) attachCardSelectableBehavior(el, card, "board", wordIds.has(card.id));
    root.appendChild(el);
  });
  applyTwoRowCardLayout(root, slots.length);
}

function getTrainingWordSources(state) {
  const userId = state.players[0].id;
  const handIds = new Set((state.hands?.[userId]?.letters ?? []).filter(Boolean).map((c) => c.id));
  const boardIds = new Set((state.centralBoard ?? []).filter(Boolean).map((c) => c.id));
  let hasHand = false;
  let hasBoard = false;
  for (const slot of state.userWord ?? []) {
    if (handIds.has(slot.cardId)) hasHand = true;
    if (boardIds.has(slot.cardId)) hasBoard = true;
  }
  return { hasHand, hasBoard };
}

function renderTrainingValidateButton(state) {
  const wrap = document.getElementById("trainingValidateWrap");
  const btn = document.getElementById("trainingValidateBtn");
  const tip = document.getElementById("trainingValidateTip");
  if (!wrap || !btn || !tip) return;
  const visible = state.phase === "creation" && state.untimedCreation;
  wrap.classList.toggle("hidden", !visible);
  if (!visible) return;

  const { hasHand, hasBoard } = getTrainingWordSources(state);
  const enabled = hasHand && hasBoard;
  _shell.setI18nById("trainingValidateBtn", "trainingValidateWord");
  btn.disabled = !enabled;
  btn.setAttribute("aria-disabled", enabled ? "false" : "true");

  let tipKey = "";
  if (!hasHand && !hasBoard) tipKey = "trainingValidateTipMissingBoth";
  else if (!hasHand) tipKey = "trainingValidateTipMissingHand";
  else if (!hasBoard) tipKey = "trainingValidateTipMissingBoard";
  if (tipKey) {
    _shell.setI18nById("trainingValidateTip", tipKey);
    tip.classList.remove("hidden");
  } else {
    tip.textContent = "";
    tip.classList.add("hidden");
  }
}

function collectRequiredCardIds(state) {
  const userId = state.players[0].id;
  const effects = state.forcedRules?.[userId] ?? [];
  const ids = new Set();
  for (const e of effects) {
    if (["use_vowel", "use_consonant", "use_letter"].includes(e.actionId)) {
      if (e.payload?.cardId) ids.add(e.payload.cardId);
    }
  }
  return ids;
}

function renderTrainingForcedRules(state) {
  const root = document.getElementById("trainingForcedRules");
  if (!root) return;
  root.innerHTML = "";
  const userId = state.players[0].id;
  const effects = state.forcedRules?.[userId] ?? [];
  if (effects.length === 0 || (state.phase !== "creation" && state.phase !== "strategy")) {
    root.classList.add("hidden");
    return;
  }
  const messages = [];
  const requiredLetters = [];
  for (const e of effects) {
    if (e.actionId === "philologist") {
      messages.push(t("trainingForcedTilde") || "");
    } else if (e.actionId === "brain_squeeze") {
      messages.push(t("trainingForcedSyllables") || "");
    } else if (["use_vowel", "use_consonant", "use_letter"].includes(e.actionId)) {
      requiredLetters.push(e.payload?.letter || "?");
    }
  }
  if (requiredLetters.length === 1) {
    const tpl = t("trainingForcedUseLetter") || "Usa la letra {letter}";
    messages.unshift(tpl.replace("{letter}", requiredLetters[0]));
  } else if (requiredLetters.length > 1) {
    const tpl = t("trainingForcedUseLetters") || "Usa las letras {letters}";
    messages.unshift(tpl.replace("{letters}", formatForcedLetters(requiredLetters)));
  }
  if (messages.length === 0) {
    root.classList.add("hidden");
    return;
  }
  const chip = document.createElement("div");
  chip.className = "training-forced-chip";
  chip.textContent = messages.join(" · ");
  root.appendChild(chip);
  root.classList.remove("hidden");
}

function formatForcedLetters(letters) {
  const unique = [...new Set(letters.filter(Boolean))];
  // Comma-separated only — keeps the chip compact when multiple rules pile up.
  return unique.length ? unique.join(", ") : "?";
}

function renderTrainingHand(state) {
  const root = document.getElementById("trainingHand");
  if (!root) return;
  root.innerHTML = "";
  const userId = state.players[0].id;
  const userHand = state.hands[userId];
  const letters = userHand && userHand !== "<hidden>" ? userHand.letters : [null, null, null];
  const actions = userHand && userHand !== "<hidden>" ? userHand.actions : [null, null];
  // After the last V/C pick closes the dealing phase we keep the hand
  // rendered face-down for one flip window (pendingDealCascade) so the
  // user sees the V/C backs land, before the cascade flips them face-up.
  const isDealing = state.phase === "dealing" || pendingDealCascade;
  const isCreation = state.phase === "creation";
  const isStrategy = state.phase === "strategy";
  const isUserTurn = state.phase === "actions"
    && (state.actionsQueue?.[0] === userId)
    && !state.userActionResolved;
  const tappable = isStrategy || (isUserTurn && !isUserTurnBlockedByActionBubble(state));
  // The dealer (the user) picks the central board first; only once the board
  // is fully revealed do their own hand slots become pickable. After the
  // board is freshly completed, hold the hand pickers for
  // BOARD_REVEAL_PAUSE_MS so the user can digest the central letters first.
  const boardFilled = (state.centralBoard ?? []).every((c) => c != null)
    && (state.centralBoard ?? []).length > 0;
  const handPickable = isDealing && boardFilled && Date.now() >= handPickerHoldUntil;
  const wordIds = new Set((state.userWord ?? []).map((s) => s.cardId));
  letters.forEach((card, idx) => {
    if (!card && handPickable) {
      root.appendChild(renderDealPickerCard(idx));
    } else {
      const el = renderLetterCard(card, { faceDown: isDealing });
      if (card && consumeReveal("hand", idx)) {
        el.classList.add("is-reveal-flip");
        attachRevealCleanup(el);
      } else if (card && fxConsumePopIn(card.id)) {
        el.classList.add("is-reveal-pop");
        attachRevealCleanup(el);
      } else if (card && fxConsumeFadeIn(card.id)) {
        el.style.setProperty("--shuffle-rot", (Math.random() < 0.5 ? -10 : 10) + "deg");
        el.classList.add("is-fade-in");
        el.addEventListener("animationend", () => el.classList.remove("is-fade-in"), { once: true });
      }
      if (card && isCreation) attachCardSelectableBehavior(el, card, "hand", wordIds.has(card.id));
      root.appendChild(el);
    }
  });
  if (!isCreation && state.phase !== "result" && state.phase !== "done") {
    actions.forEach((card, idx) => {
      // Focus persists from strategy through the whole actions phase — the
      // preselected card stays visually emphasised (with the other one
      // dimmed) until the user actually plays an action. During strategy
      // we read the live `focusedActionIndex` (UI state); from the actions
      // phase onward we read `state.userActionIndex` (committed in strategy).
      const isInActionsWithPreselect = state.phase === "actions"
        && state.userActionIndex != null
        && !state.userActionResolved;
      const isFocused = (isStrategy && focusedActionIndex === idx)
        || (isInActionsWithPreselect && state.userActionIndex === idx);
      const clickHandler = tappable && card ? () => {
        if (isStrategy) {
          // Strategy: single tap toggles focus (read the description). The
          // focused card becomes the "default pick" if the timer runs out
          // or the user taps the "Listo" button.
          focusedActionIndex = focusedActionIndex === idx ? null : idx;
          renderTrainingMatch();
        } else {
          // Actions phase, user's turn: tap plays the card immediately.
          handleUserPickAction(idx);
        }
      } : null;
      const hasFocus = (isStrategy && focusedActionIndex != null)
        || isInActionsWithPreselect;
      const cardEl = renderActionCard(card, {
        selectable: tappable && !!card,
        selected: false,
        focused: isFocused,
        dimmed: hasFocus && !isFocused,
        faceDown: isDealing,
        onClick: clickHandler,
      });
      if (card && consumeReveal("action", idx)) {
        cardEl.classList.add("is-reveal-flip");
        attachRevealCleanup(cardEl);
      } else if (card && fxConsumePopIn(card.id)) {
        cardEl.classList.add("is-reveal-pop");
        attachRevealCleanup(cardEl);
      }
      // Debug long-press on an action card during the strategy phase opens a
      // picker to swap it for any other action — useful for testing concrete
      // sequences without relying on the dealt cards.
      if (debugMode && (isStrategy || isDealing) && (card || isDealing)) {
        attachDebugActionSwapLongPress(cardEl, idx);
      }
      if (!isDealing && card) {
        const wrap = document.createElement("div");
        wrap.className = "tcard-action-wrap";
        wrap.appendChild(cardEl);
        const label = document.createElement("span");
        label.className = "tcard-action-label";
        label.textContent = actionLabel(card.actionId);
        if (clickHandler) label.addEventListener("click", clickHandler);
        wrap.appendChild(label);
        root.appendChild(wrap);
      } else {
        root.appendChild(cardEl);
      }
    });
  }
  applyTwoRowCardLayout(root, root.children.length);
  renderActionFocusPanel(state);
}

function applyTwoRowCardLayout(root, cardCount) {
  if (!root) return;
  if (cardCount <= 10) {
    root.style.setProperty("--training-section-card-size", `${TRAINING_SECTION_MAX_CARD_SIZE}px`);
    return;
  }
  const columns = cardCount > 10 ? Math.ceil(cardCount / 2) : Math.min(cardCount, 5);
  if (!columns) {
    root.style.removeProperty("--training-section-card-size");
    return;
  }
  const width = root.clientWidth || root.getBoundingClientRect().width || 0;
  const gaps = Math.max(0, columns - 1) * TRAINING_SECTION_CARD_GAP;
  if (width > 0) {
    const size = Math.min(
      TRAINING_SECTION_MAX_CARD_SIZE,
      Math.floor((width - gaps) / columns),
    );
    root.style.setProperty("--training-section-card-size", `${Math.max(34, size)}px`);
    return;
  }
  root.style.setProperty(
    "--training-section-card-size",
    `min(${TRAINING_SECTION_MAX_CARD_SIZE}px, calc((100% - ${gaps}px) / ${columns}))`,
  );
}

function renderActionFocusPanel(state) {
  const panel = document.getElementById("trainingActionFocusPanel");
  if (!panel) return;
  const nameEl = document.getElementById("trainingActionFocusName");
  const descEl = document.getElementById("trainingActionFocusDesc");
  const playBtn = document.getElementById("trainingActionFocusPlay");

  const isStrategy = state?.phase === "strategy";
  if (!isStrategy || focusedActionIndex == null) {
    panel.classList.add("hidden");
    return;
  }
  const userId = state.players[0].id;
  const card = state.hands[userId]?.actions?.[focusedActionIndex];
  if (!card) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  nameEl.textContent = actionLabel(card.actionId);
  descEl.textContent = actionDesc(card.actionId);
  // During strategy this button shortcuts the timer: closes the phase using
  // the focused card as the preselection.
  playBtn.textContent = t("trainingChooseThisCard") || "Listo";
  playBtn.onclick = () => { confirmStrategyReady(); };
}

function attachCardSelectableBehavior(el, card, source, isAlreadyInWord) {
  if (isAlreadyInWord) {
    el.classList.add("is-in-word");
    return;
  }
  el.classList.add("is-tappable");
  el.addEventListener("click", () => handleWordCardTap(card, source));
}

function handleWordCardTap(card, source) {
  _shell.playClickFeedback();
  const state = getTrainingMatch();
  if (!state || state.phase !== "creation") return;
  // For pickers (wildcard letter / tilde choice) the callback fires
  // asynchronously. If the creation timer expires while the picker is open
  // and we used the captured state, `addToWord` would spread phase=creation
  // back over phase=result and silently undo the timeup transition.
  // Re-read state in the callback and abort if creation already ended.
  if (card.isWildcard) {
    openTrainingPicker({
      titleKey: "trainingPickWildcardTitle",
      options: wildcardLetterOptions(card),
      onPick: (letter) => {
        const fresh = getTrainingMatch();
        if (!fresh || fresh.phase !== "creation") return;
        addToWord(fresh, card.id, source, { chosenLetter: letter });
        renderTrainingMatch();
      },
    });
    return;
  }
  if (card.tildeValue != null) {
    openTildeChoice(card, (withTilde) => {
      const fresh = getTrainingMatch();
      if (!fresh || fresh.phase !== "creation") return;
      addToWord(fresh, card.id, source, { tilde: withTilde });
      renderTrainingMatch();
    });
    return;
  }
  addToWord(state, card.id, source);
  renderTrainingMatch();
}

function openTildeChoice(card, onPick) {
  const overlay = document.createElement("div");
  overlay.className = "training-picker-overlay";
  const cardEl = document.createElement("div");
  cardEl.className = "training-picker-card";
  const title = document.createElement("div");
  title.className = "training-picker-title";
  title.textContent = t("trainingTildeChoiceTitle") || "";
  cardEl.appendChild(title);

  const options = document.createElement("div");
  options.className = "training-tilde-options";
  const tildedLetter = card.tildeForm || TILDE_FORMS[card.letter] || card.letter;
  const isDiaeresis = card.tildeKind === "diaeresis";
  const withKey    = isDiaeresis ? "trainingDiaeresisWithLabel"    : "trainingTildeWithLabel";
  const withoutKey = isDiaeresis ? "trainingDiaeresisWithoutLabel" : "trainingTildeWithoutLabel";

  options.appendChild(
    buildTildeOption({
      letter: card.letter,
      value: card.value,
      label: t(withoutKey) || "",
      color: card.color,
      onClick: () => {
        document.body.removeChild(overlay);
        onPick(false);
      },
    }),
  );
  options.appendChild(
    buildTildeOption({
      letter: tildedLetter,
      value: card.tildeValue,
      label: t(withKey) || "",
      color: card.color,
      onClick: () => {
        document.body.removeChild(overlay);
        onPick(true);
      },
    }),
  );

  cardEl.appendChild(options);
  overlay.appendChild(cardEl);
  document.body.appendChild(overlay);
}

function buildTildeOption({ letter, value, label, color, onClick }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "training-tilde-option";
  const cardFace = document.createElement("div");
  cardFace.className = "tcard training-tilde-option-card";
  cardFace.dataset.color = color || "none";
  const letterSpan = document.createElement("span");
  letterSpan.className = "tcard-letter";
  letterSpan.textContent = letter;
  const valueSpan = document.createElement("span");
  valueSpan.className = "tcard-value";
  valueSpan.textContent = String(value);
  cardFace.append(letterSpan, valueSpan);
  const labelEl = document.createElement("div");
  labelEl.className = "training-tilde-option-label";
  labelEl.textContent = label;
  btn.append(cardFace, labelEl);
  btn.addEventListener("click", onClick);
  return btn;
}

function wildcardLetterOptions(card) {
  // Action wildcard (gold) can stand for any letter; vowel/consonant wildcards
  // are restricted to their kind.
  let letters;
  if (card.kind === "vowel") letters = VOWEL_LETTERS;
  else if (card.kind === "consonant") letters = CONSONANT_LETTERS;
  else letters = [...VOWEL_LETTERS, ...CONSONANT_LETTERS];
  return letters.map((l) => ({ id: l, label: l }));
}

function renderTrainingWordStrip(state) {
  const root = document.getElementById("trainingWordStrip");
  const cardsRoot = document.getElementById("trainingWordStripCards");
  const label = document.getElementById("trainingWordStripLabel");
  if (!root || !cardsRoot || !label) return;
  const visible = state.phase === "creation";
  root.classList.toggle("hidden", !visible);
  root.classList.remove("is-placeholder");
  if (!visible) {
    // Hide the lang toggle and reset the override when leaving creation.
    trainingWordLangOverride = null;
    const toggle = document.getElementById("trainingWordLangToggle");
    if (toggle) toggle.classList.add("hidden");
    return;
  }
  _shell.setI18nById("trainingWordStripLabel", "trainingWordStripLabel");

  // Show the language toggle only when the user has an active
  // in_english / in_spanish card this baza. Pre-select the card's language
  // on first entry; preserve the user's choice on subsequent re-renders.
  const userId = state.players[0].id;
  const forcedEffects = state.forcedRules?.[userId] ?? [];
  const langCard = forcedEffects.find((e) =>
    ["in_english", "in_spanish"].includes(e.actionId),
  );
  const toggle = document.getElementById("trainingWordLangToggle");
  let langBonusMessage = null;
  if (toggle) {
    const hasLangCard = !!langCard;
    toggle.classList.toggle("hidden", !hasLangCard);
    if (hasLangCard) {
      const cardLang = langCard.actionId === "in_english" ? "en" : "es";
      const baseLang = normalizeLanguage(state.language || "es");
      langBonusMessage = t("trainingWordStripLangBonus", {
        bonus: textForTrainingLanguage(cardLang),
        base: textForTrainingLanguage(baseLang),
      });
      // Only pre-select on first appearance; preserve manual choice after.
      if (trainingWordLangOverride === null) {
        trainingWordLangOverride = cardLang;
        toggle.querySelectorAll(".validation-lang-btn").forEach((b) =>
          b.classList.toggle("is-active", b.dataset.lang === cardLang),
        );
        // Wire click handlers once (idempotent via dataset flag).
        if (!toggle.dataset.wired) {
          toggle.dataset.wired = "1";
          toggle.querySelectorAll(".validation-lang-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
              trainingWordLangOverride = btn.dataset.lang;
              toggle.querySelectorAll(".validation-lang-btn").forEach((b) =>
                b.classList.toggle("is-active", b === btn),
              );
            });
          });
        }
      } else {
        // Re-apply active class to match current override (re-render safe).
        toggle.querySelectorAll(".validation-lang-btn").forEach((b) =>
          b.classList.toggle("is-active", b.dataset.lang === trainingWordLangOverride),
        );
      }
    } else {
      trainingWordLangOverride = null;
    }
  }
  cardsRoot.innerHTML = "";
  const word = state.userWord ?? [];
  if (word.length === 0) {
    const empty = document.createElement("div");
    empty.className = "training-word-strip-empty";
    const main = document.createElement("div");
    main.className = "training-word-strip-empty-main";
    main.textContent = t("trainingWordStripEmpty") || "";
    empty.appendChild(main);
    if (langBonusMessage) {
      const hint = document.createElement("div");
      hint.className = "training-word-strip-empty-hint";
      hint.textContent = langBonusMessage;
      empty.appendChild(hint);
    }
    cardsRoot.appendChild(empty);
    return;
  }
  const allCards = buildAllCardsIndex(state);
  word.forEach((slot, idx) => {
    const card = allCards.get(slot.cardId);
    if (!card) return;
    const wrapper = document.createElement("div");
    wrapper.className = "training-word-slot";
    wrapper.dataset.index = String(idx);
    wrapper.dataset.source = slot.source ?? "";
    wrapper.dataset.cardId = slot.cardId;
    wrapper.addEventListener("pointerdown", handleWordSlotPointerDown);
    // Click is bound on the wrapper (not cardEl) because setPointerCapture
    // redirects the synthetic click to the capture target.
    wrapper.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (suppressNextWordSlotClick) return;
      handleWordSlotTap(slot.cardId);
    });

    // Render the underlying card with chosen letter (wildcards) or tilded
    // form (when the tilde toggle is active for a tilde-capable card).
    let displayLetter = card.letter;
    if (slot.chosen) {
      displayLetter = slot.chosen;
    } else if (slot.tilde && card.tildeValue != null) {
      displayLetter = card.tildeForm || TILDE_FORMS[card.letter] || card.letter;
    }
    const displayCard = { ...card, letter: displayLetter };
    const cardEl = renderLetterCard(displayCard);
    if (slot.tilde && card.tildeValue != null) {
      cardEl.classList.add("is-tilde-active");
    }
    cardEl.classList.add("is-tappable");
    wrapper.appendChild(cardEl);
    cardsRoot.appendChild(wrapper);
  });
}

function buildAllCardsIndex(state) {
  const map = new Map();
  for (const c of state.centralBoard ?? []) map.set(c.id, c);
  const userHand = state.hands?.[state.players[0].id];
  if (userHand && userHand !== "<hidden>") {
    for (const c of userHand.letters ?? []) if (c) map.set(c.id, c);
  }
  return map;
}

function handleWordSlotTap(cardId) {
  _shell.playClickFeedback();
  const state = getTrainingMatch();
  if (!state || state.phase !== "creation") return;
  removeFromWord(state, cardId);
  renderTrainingMatch();
}

function handleWordSlotToggleTilde(cardId) {
  _shell.playClickFeedback();
  const state = getTrainingMatch();
  if (!state || state.phase !== "creation") return;
  toggleTildeInWord(state, cardId);
  renderTrainingMatch();
}

// ── Word slot reordering (Pointer Events) ───────────────────────────────────
// HTML5 native drag-and-drop is broken on iOS Safari (renders a black ghost
// and is hard to drop accurately). Pointer Events work uniformly across
// desktop, iOS, and Android — we manage the ghost element ourselves and do
// hit-testing with document.elementFromPoint.
const DRAG_THRESHOLD_PX = 6;
let wordDragState = null;
let suppressNextWordSlotClick = false;

function handleWordSlotPointerDown(ev) {
  if (ev.button !== undefined && ev.button !== 0) return;
  const wrapper = ev.currentTarget;
  wordDragState = {
    wrapper,
    fromIndex: Number(wrapper.dataset.index),
    source: wrapper.dataset.source || "",
    cardId: wrapper.dataset.cardId || "",
    startX: ev.clientX,
    startY: ev.clientY,
    pointerId: ev.pointerId,
    dragging: false,
    ghost: null,
  };
  try { wrapper.setPointerCapture(ev.pointerId); } catch {}
  document.addEventListener("pointermove", handleWordSlotPointerMove);
  document.addEventListener("pointerup", handleWordSlotPointerUp);
  document.addEventListener("pointercancel", handleWordSlotPointerUp);
}

function handleWordSlotPointerMove(ev) {
  if (!wordDragState || wordDragState.pointerId !== ev.pointerId) return;
  const dx = ev.clientX - wordDragState.startX;
  const dy = ev.clientY - wordDragState.startY;

  if (!wordDragState.dragging) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    wordDragState.dragging = true;
    const orig = wordDragState.wrapper;
    const rect = orig.getBoundingClientRect();
    const ghost = orig.cloneNode(true);
    ghost.classList.add("training-word-ghost");
    ghost.style.position = "fixed";
    ghost.style.left = rect.left + "px";
    ghost.style.top = rect.top + "px";
    ghost.style.width = rect.width + "px";
    ghost.style.height = rect.height + "px";
    ghost.style.pointerEvents = "none";
    ghost.style.zIndex = "9999";
    ghost.style.transformOrigin = "center center";
    document.body.appendChild(ghost);
    wordDragState.ghost = ghost;
    orig.classList.add("is-dragging");
  }

  if (wordDragState.ghost) {
    wordDragState.ghost.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.12)`;
  }
  document.querySelectorAll(".training-word-slot.is-drop-target, .is-origin-drop-target")
    .forEach((el) => el.classList.remove("is-drop-target", "is-origin-drop-target"));
  const target = findWordSlotAt(ev.clientX, ev.clientY);
  if (target && target !== wordDragState.wrapper) {
    target.classList.add("is-drop-target");
  } else {
    const origin = findOriginDropZone(ev.clientX, ev.clientY, wordDragState.source);
    if (origin) origin.classList.add("is-origin-drop-target");
  }
  // Prevent the page from scrolling under the finger.
  ev.preventDefault();
}

function findOriginDropZone(x, y, source) {
  const id = source === "board" ? "trainingBoard" : source === "hand" ? "trainingHand" : null;
  if (!id) return null;
  const el = document.getElementById(id);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const tol = 12;
  if (x >= r.left - tol && x <= r.right + tol && y >= r.top - tol && y <= r.bottom + tol) return el;
  return null;
}

function handleWordSlotPointerUp(ev) {
  if (!wordDragState || wordDragState.pointerId !== ev.pointerId) return;
  const orig = wordDragState.wrapper;
  const wasDragging = wordDragState.dragging;
  let didChange = false;

  if (wasDragging) {
    const target = findWordSlotAt(ev.clientX, ev.clientY);
    if (target && target !== orig) {
      const toIdx = Number(target.dataset.index);
      const state = getTrainingMatch();
      if (state && !Number.isNaN(toIdx) && toIdx !== wordDragState.fromIndex) {
        reorderWord(state, wordDragState.fromIndex, toIdx);
        didChange = true;
      }
    } else {
      const origin = findOriginDropZone(ev.clientX, ev.clientY, wordDragState.source);
      if (origin && wordDragState.cardId) {
        const state = getTrainingMatch();
        if (state && state.phase === "creation") {
          removeFromWord(state, wordDragState.cardId);
          didChange = true;
        }
      }
    }
  }

  document.querySelectorAll(".training-word-slot.is-drop-target, .is-origin-drop-target")
    .forEach((el) => el.classList.remove("is-drop-target", "is-origin-drop-target"));
  if (wordDragState.ghost) wordDragState.ghost.remove();
  orig.classList.remove("is-dragging");
  try { orig.releasePointerCapture(wordDragState.pointerId); } catch {}
  document.removeEventListener("pointermove", handleWordSlotPointerMove);
  document.removeEventListener("pointerup", handleWordSlotPointerUp);
  document.removeEventListener("pointercancel", handleWordSlotPointerUp);
  wordDragState = null;

  if (wasDragging) {
    // Stop the synthetic click that would fire on the inner card (which would
    // otherwise remove the slot from the word).
    suppressNextWordSlotClick = true;
    setTimeout(() => { suppressNextWordSlotClick = false; }, 350);
  }
  if (didChange) renderTrainingMatch();
}

function findWordSlotAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const direct = el ? el.closest(".training-word-slot") : null;
  if (direct) return direct;

  // Edge fallback: if the pointer is to the left of the first slot or to the
  // right of the last slot (within the word-strip's vertical band), treat it
  // as a drop on the corresponding edge slot.
  const stripCards = document.getElementById("trainingWordStripCards");
  if (!stripCards) return null;
  const slots = stripCards.querySelectorAll(".training-word-slot");
  if (slots.length === 0) return null;
  const stripRect = stripCards.getBoundingClientRect();
  // Vertical tolerance so the user doesn't have to drag pixel-perfect.
  const vTolerance = 24;
  if (y < stripRect.top - vTolerance || y > stripRect.bottom + vTolerance) return null;
  const first = slots[0];
  const last = slots[slots.length - 1];
  if (x < first.getBoundingClientRect().left) return first;
  if (x > last.getBoundingClientRect().right) return last;
  return null;
}

function renderDealPickerCard(slotIndex, target = "hand") {
  const el = document.createElement("div");
  el.className = "tcard is-deal-picker";
  const vowelBtn = document.createElement("button");
  vowelBtn.type = "button";
  vowelBtn.className = "tcard-pick-half tcard-pick-vowel";
  vowelBtn.textContent = "V";
  vowelBtn.setAttribute("aria-label", "vocal");
  vowelBtn.addEventListener("click", () => handleDealPick(slotIndex, "vowel", target));
  const consonantBtn = document.createElement("button");
  consonantBtn.type = "button";
  consonantBtn.className = "tcard-pick-half tcard-pick-consonant";
  consonantBtn.textContent = "C";
  consonantBtn.setAttribute("aria-label", "consonant");
  consonantBtn.addEventListener("click", () => handleDealPick(slotIndex, "consonant", target));
  el.append(vowelBtn, consonantBtn);
  return el;
}

// Track slots that were just revealed so the renderer plays the entry
// animation exactly once. Keys are "board:<idx>" / "hand:<idx>" /
// "action:<idx>". The flag is consumed on read so subsequent re-renders
// don't restart the anim.
const pendingReveals = new Set();
function markRevealed(target, slotIndex) {
  pendingReveals.add(`${target}:${slotIndex}`);
}
function consumeReveal(target, slotIndex) {
  const key = `${target}:${slotIndex}`;
  if (!pendingReveals.has(key)) return false;
  pendingReveals.delete(key);
  return true;
}

// Remove the one-shot reveal animation class once it finishes so any other
// CSS animation that should run on the card (e.g. the selectable pulse on
// action cards) can resume normally.
function attachRevealCleanup(el) {
  el.addEventListener("animationend", () => {
    el.classList.remove("is-reveal-flip", "is-reveal-pop");
  }, { once: true });
}

// Action FX (animations, fly ghosts, score chip, forced pulse, read-delay
// sequencing, card-movement diff) all live in ./actionFX.js, configured at
// module-init below to use this screen's state getter and renderer.

// When the LAST V/C pick (or random batch) closes the dealing phase, the hand
// cards stay face-down until the "ESTRATEGIA" banner finishes. The face-up
// cascade flip fires just after the banner disappears; keeping a small buffer
// avoids the banner-hide render replacing the card DOM and swallowing the flip.
const DEAL_CASCADE_DELAY_MS =
  STRATEGY_BANNER_DELAY_MS + PHASE_FLASH_DURATION_MS + TIMING.dealCascade.afterFlashBuffer;

// After the board has just become fully revealed, hold the hand pickers
// for a moment so the user has time to digest the central letters before
// being asked to pick their own.
const BOARD_REVEAL_PAUSE_MS = TIMING.boardReveal.pause;
let handPickerHoldUntil = 0;

// When a baza starts and the dealer is a ghost, the central board is
// auto-filled by initializeRound. To give the user the same theatrical
// reveal as the human-dealer case, we render those cards face-down for a
// short hold, then flip them to face-up with the reveal animation.
const GHOST_BOARD_DEAL_HOLD_MS = TIMING.ghostBoardDeal.hold;
let ghostBoardDealHoldUntil = 0;
function maybeHoldHandPickerAfterBoard(stateBefore, stateAfter) {
  const before = stateBefore?.centralBoard ?? [];
  const after = stateAfter?.centralBoard ?? [];
  const wasIncomplete = before.length === 0 || before.some((c) => c == null);
  const nowComplete = after.length > 0 && after.every((c) => c != null);
  if (!(wasIncomplete && nowComplete)) return;
  handPickerHoldUntil = Date.now() + BOARD_REVEAL_PAUSE_MS;
  setTimeout(renderTrainingMatch, BOARD_REVEAL_PAUSE_MS);
}
let pendingDealCascade = false;
function isTrainingTimerGated() {
  return Date.now() < getPhaseFlashEndsAt() || pendingDealCascade;
}

function startDealCascade(stateAfter) {
  pendingDealCascade = true;
  setTimeout(() => {
    pendingDealCascade = false;
    const cur = getTrainingMatch() || stateAfter;
    if (!cur) return;
    // Cascade ONLY flips the hand — letters + action cards. Board cards
    // were already revealed one-by-one (or via 🎲) during the dealing
    // sub-phase, so re-flipping them here would be redundant.
    const userId = cur.players?.[0]?.id;
    const userHand = userId ? cur.hands[userId] : null;
    (userHand?.letters ?? []).forEach((c, i) => { if (c) markRevealed("hand", i); });
    (userHand?.actions ?? []).forEach((c, i) => { if (c) markRevealed("action", i); });
    renderTrainingMatch();
  }, DEAL_CASCADE_DELAY_MS);
}

function handleDealPick(slotIndex, kind, target = "hand") {
  _shell.playClickFeedback();
  const state = getTrainingMatch();
  if (!state || state.phase !== "dealing") return;
  if (target === "board") revealBoardSlot(state, slotIndex, kind);
  else revealLetterSlot(state, slotIndex, kind);
  markRevealed(target, slotIndex);
  const after = getTrainingMatch();
  if (target === "board") maybeHoldHandPickerAfterBoard(state, after);
  if (after && after.phase !== "dealing") startDealCascade(after);
  renderTrainingMatch();
}

function renderTrainingActions(state) {
  // Action cards are now rendered inside renderTrainingHand alongside letter cards.
  const root = document.getElementById("trainingActionsHand");
  if (root) root.innerHTML = "";
}

// renderLetterCard → ui/components/letterCard.js

// renderActionCard → ui/components/actionCard.js

function renderTrainingTimer(state) {
  const el = document.getElementById("trainingTimerValue");
  const card = document.getElementById("trainingMatchTimerCard");
  if (!el) return;
  if (card) card.classList.toggle("hidden", !!state.untimedCreation);
  const s = Math.max(0, state.remaining || 0);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  el.textContent = `${mm}:${ss}`;
  if (card) {
    const running = state.phase === "strategy" || state.phase === "creation";
    const timerEffectsActive = running && !isTrainingTimerGated() && trainingTimerInterval != null;
    card.classList.toggle("time-pressure", timerEffectsActive && s <= LOW_TIME_THRESHOLD && s > 5);
    card.classList.toggle("time-pressure-urgent", timerEffectsActive && s <= 5 && s > 0);
    card.classList.toggle("timeup", timerEffectsActive && s === 0);
  }
}

function renderTrainingResult(state) {
  const panel = document.getElementById("trainingResultPanel");
  if (!panel) return;
  const isResult = state.phase === "result";
  const isDone   = state.phase === "done";
  if (!isResult && !isDone) {
    closeModal("training-result");
    return;
  }
  // Update title ribbon: "BAZA n/N" for per-baza result, end-of-match label
  // for the done view.
  const titleEl = document.getElementById("trainingResultTitle");
  const totalRounds = state.roundsTarget ?? state.rounds ?? null;
  if (titleEl) {
    if (isDone) {
      titleEl.textContent = t("trainingMatchDoneTitle") || "¡Fin del entrenamiento!";
    } else {
      const tpl = t("trainingBazaCount") || "Baza {round}{slash}{total}";
      titleEl.textContent = totalRounds
        ? tpl.replace("{round}", state.round).replace("{slash}", "/").replace("{total}", totalRounds)
        : `Baza ${state.round}`;
    }
  }
  openModal("training-result", { closable: false });
  panel.innerHTML = "";

  if (isDone) {
    renderTrainingDonePanel(panel, state);
    return;
  }

  // ── Baza result ──────────────────────────────────────────────
  const result = state.userWordResult;
  if (result) {
    const validityRow = document.createElement("div");
    validityRow.className = "training-result-validity";
    const badge = document.createElement("div");
    if (result.checking) {
      badge.className = "training-result-badge is-checking";
      badge.textContent = t("trainingResultChecking") || "⏳ Validando…";
    } else {
      badge.className = "training-result-badge " + (result.valid ? "is-valid" : "is-invalid");
      badge.textContent = result.valid
        ? (t("trainingResultValidWord") || "✓ Válida")
        : (t("trainingResultInvalidWord") || "✗ No válida");
    }
    validityRow.appendChild(badge);
    if (shouldShowTrainingResultLanguageBadge(state, result)) {
      const langBadge = document.createElement("span");
      langBadge.className = "training-result-language-badge";
      langBadge.textContent = normalizeLanguage(result.language).toUpperCase();
      validityRow.appendChild(langBadge);
    }
    panel.appendChild(validityRow);

    const wordEl = document.createElement("div");
    wordEl.className = "training-result-word" + (!result.checking && !result.valid ? " is-invalid" : "");
    wordEl.textContent = result.word || "—";
    panel.appendChild(wordEl);

    if (!result.checking && !result.valid && result.reason) {
      const reasonEl = document.createElement("div");
      reasonEl.className = "training-result-reason";
      const reasonKey = {
        too_short:          "trainingResultReasonTooShort",
        missing_source:     "trainingResultReasonSource",
        forced_rule:        "trainingResultReasonForcedRule",
        not_in_dictionary:  "trainingResultReasonNotInDictionary",
      }[result.reason];
      const fallback = result.reason === "not_in_dictionary"
        ? "No existe en el diccionario"
        : result.reason;
      reasonEl.textContent = (reasonKey ? t(reasonKey) : fallback) || fallback;
      panel.appendChild(reasonEl);
    }

    // Score breakdown: render each contributing part (letter values,
    // wildcard bonuses, action-card modifiers, x2 if applicable).
    if (!result.checking && result.valid && Array.isArray(result.breakdown) && result.breakdown.length > 0) {
      const breakdownEl = renderScoreBreakdown(result.breakdown, result.score);
      if (breakdownEl) panel.appendChild(breakdownEl);
    }
  }

  // Scores table (this baza)
  const table = document.createElement("table");
  table.className = "training-result-table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["", t("trainingResultThisRound") || "Esta baza", t("trainingResultTotal") || "Total"].forEach((text, i) => {
    const th = document.createElement("th");
    th.textContent = text;
    if (i > 0) th.className = i === 1 ? "col-round" : "col-total";
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (const p of state.players) {
    const roundEntry = (p.rounds ?? []).find((r) => r.round === state.round);
    const roundPts = roundEntry != null ? roundEntry.points : "—";
    const tr = document.createElement("tr");
    if (!p.isGhost) tr.classList.add("is-user");
    const nameTd = document.createElement("td");
    nameTd.textContent = p.name;
    const roundTd = document.createElement("td");
    roundTd.className = "col-round";
    roundTd.textContent = typeof roundPts === "number" ? String(roundPts) : roundPts;
    const totalTd = document.createElement("td");
    totalTd.className = "col-total";
    totalTd.textContent = String(p.score ?? 0);
    tr.append(nameTd, roundTd, totalTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  panel.appendChild(table);

  // Educational suggestions: top 3 words the user could have played with
  // their hand + the board snapshot at validation time. Skipped in Practicar
  // (which already exposes the in-creation hint button).
  if (state.difficulty !== "words") {
    const suggBox = document.createElement("div");
    suggBox.className = "training-result-suggestions";
    suggBox.innerHTML = `<div class="hints-meta">…</div>`;
    panel.appendChild(suggBox);
    void renderRoundEndHints(suggBox, state);
  }

  const actionsDiv = document.createElement("div");
  actionsDiv.className = "training-result-actions";
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "game-btn primary";
  nextBtn.textContent = t("trainingNextBaza") || "Siguiente";
  nextBtn.addEventListener("click", handleNextBaza);
  actionsDiv.appendChild(nextBtn);
  panel.appendChild(actionsDiv);
}

async function renderRoundEndHints(box, state) {
  const uiDiff = state.difficulty || "normal";
  const solverDiff = uiDiff === "hard" ? "hard" : uiDiff === "normal" ? "normal" : "easy";
  let hints = [];
  try {
    // Request a few extra so we have buffer after filtering out the user's
    // own word.
    hints = await findHints(state, { count: 6, difficulty: solverDiff, language: getTrainingEffectiveWordLanguage(state) });
  } catch (err) {
    logger.warn("[round-end hints] solver failed", err);
  }
  // Avoid overwriting if the modal was closed before the solver returned.
  if (!box.isConnected) return;

  const userScore = state.userWordResult?.score ?? 0;
  const userValid = state.userWordResult?.valid;
  const userWord = state.userWordResult?.word ?? "";
  const norm = (w) => (w || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const userKey = norm(userWord);
  // Drop suggestions that match the user's word with equal-or-worse score.
  // Keep them when the score is higher — that's the educational case
  // ("same word but built smarter": wildcard +6, matching colors, etc.).
  const filtered = userValid && userKey
    ? hints.filter((h) => !(norm(h.word) === userKey && h.score <= userScore))
    : hints;
  const top3 = filtered.slice(0, 3);

  const top = top3[0];
  if (!top) {
    // No suggestions to show — drop the section entirely.
    box.remove();
    return;
  }
  if (userValid && userScore >= top.score) {
    box.innerHTML = `<div class="training-result-suggestions-header">🎯 ¡Has sacado la mejor palabra posible!</div>`;
    return;
  }
  // Use the same per-letter rendering as the hints modal so wildcards mark
  // exactly which letter they're standing in for (★ underneath that letter).
  const rows = top3.map(renderHintItem).join("");
  box.innerHTML = `
    <div class="training-result-suggestions-header">${t("trainingAlsoCould") || "También podías"}</div>
    <ol class="hints-list">${rows}</ol>
  `;
}

function saveTrainingStats(state) {
  const prev = loadState().training?.stats?.[state.difficulty] ?? {};
  const userWon = state.players[0].score >= Math.max(...state.players.map((p) => p.score));
  updateState({
    training: {
      stats: {
        [state.difficulty]: {
          played: (prev.played || 0) + 1,
          wins: (prev.wins || 0) + (userWon ? 1 : 0),
          best: Math.max(prev.best || 0, state.players[0].score ?? 0),
          streak: userWon ? (prev.streak || 0) + 1 : 0,
        },
      },
    },
  });
}

function renderTrainingDonePanel(panel, state) {
  if (!state.statsSaved) {
    saveTrainingMatch({ ...state, statsSaved: true });
    saveTrainingStats(state);
  }

  // Win / lose / draw badge (title is already in the modal ribbon)
  const userId = state.players[0].id;
  const maxScore = Math.max(...state.players.map((p) => p.score ?? 0));
  const winners = state.players.filter((p) => (p.score ?? 0) === maxScore);
  const userWon  = !state.players[0].isGhost && winners.some((p) => p.id === userId);
  const isDraw   = winners.length > 1 && userWon;
  const outcomeKey = isDraw ? "trainingResultDraw" : userWon ? "trainingResultWon" : "trainingResultLost";
  const outcomeBadge = document.createElement("div");
  outcomeBadge.className = "training-result-badge " + (userWon ? "is-valid" : "is-invalid");
  outcomeBadge.textContent = t(outcomeKey) || (userWon ? "¡Has ganado!" : "¡Bien jugado!");
  const badgeRow = document.createElement("div");
  badgeRow.className = "training-result-validity";
  badgeRow.appendChild(outcomeBadge);
  panel.appendChild(badgeRow);

  // Final standings label
  const standingsLabel = document.createElement("div");
  standingsLabel.className = "training-result-standings-label";
  standingsLabel.textContent = t("trainingResultFinalStandings") || "Clasificación final";
  panel.appendChild(standingsLabel);

  // Final standings table (sorted by score desc)
  const sorted = state.players.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const table = document.createElement("table");
  table.className = "training-result-table training-result-table-done";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const thRank = document.createElement("th");
  thRank.className = "col-rank";
  thRank.textContent = "#";
  const thName = document.createElement("th");
  thName.className = "col-name";
  thName.textContent = t("trainingResultPlayer") || "Jugador";
  const thTotal = document.createElement("th");
  thTotal.className = "col-total";
  thTotal.textContent = t("trainingResultTotal") || "Total";
  headerRow.append(thRank, thName, thTotal);
  thead.appendChild(headerRow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  let rank = 1;
  sorted.forEach((p, idx) => {
    if (idx > 0 && (sorted[idx - 1].score ?? 0) > (p.score ?? 0)) rank = idx + 1;
    const tr = document.createElement("tr");
    if (!p.isGhost) tr.classList.add("is-user");
    if (rank === 1) tr.classList.add("is-top");
    const rankTd = document.createElement("td");
    rankTd.className = "col-rank";
    rankTd.textContent = String(rank);
    const nameTd = document.createElement("td");
    nameTd.className = "col-name";
    nameTd.textContent = p.name;
    const totalTd = document.createElement("td");
    totalTd.className = "col-total";
    totalTd.textContent = String(p.score ?? 0);
    tr.append(rankTd, nameTd, totalTd);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  panel.appendChild(table);

  const actionsDiv = document.createElement("div");
  actionsDiv.className = "training-result-actions";
  const playAgainBtn = document.createElement("button");
  playAgainBtn.type = "button";
  playAgainBtn.className = "game-btn primary";
  playAgainBtn.textContent = t("trainingMatchPlayAgain") || "Jugar otra";
  playAgainBtn.addEventListener("click", handleTrainingPlayAgain);
  actionsDiv.appendChild(playAgainBtn);
  panel.appendChild(actionsDiv);
}

function handleNextBaza() {
  _shell.playClickFeedback();
  const state = getTrainingMatch();
  if (!state || state.phase !== "result") return;
  debugLogPushBazaEnd(state);
  advanceToNextBaza(state);
  const next = getTrainingMatch();
  if (next && next.phase !== "done") debugLogPushBazaStart(next);
  resetPhaseFlash(); // allow phase flash for new baza
  renderTrainingMatch();
}

function handleTrainingPlayAgain() {
  _shell.playClickFeedback();
  trainingClockPhase = null;
  _shell.stopClockLoop(false);
  closeModal("training-result");
  clearTrainingMatch();
  _shell.showScreen("training-setup");
}

function exitTrainingMatch() {
  stopTrainingTimer();
  stopDriver();
  stopUserTurnTimer();
  trainingClockPhase = null;
  _shell.stopClockLoop(false);
  closeModal("training-result");
  clearTrainingMatch();
  _shell.showScreen("training-setup");
}

function finishTrainingTimer() {
  _shell.playClickFeedback();
  const state = getTrainingMatch();
  if (!state) return;
  if (state.phase === "strategy") {
    // Same path as the user pressing "Listo": close strategy honouring the
    // currently focused action card (if any) as the preselection.
    confirmStrategyReady();
    return;
  }
  if (state.phase === "creation") {
    stopTrainingTimer();
    trainingClockPhase = null;
    _shell.stopClockLoop(false);
    const finalized = finalizeUserWord(state, trainingWordLangOverride ?? state.language ?? "es");
    const r = finalized.userWordResult;
    if (r) debugLogPushWord(finalized, { word: r.word, valid: r.valid, score: r.score, reason: r.reason });
    renderTrainingMatch();
    if (r?.valid && r?.word) validateAndUpdateUserWord(finalized);
    return;
  }
}

// Async word-existence validation. Runs AFTER finalizeUserWord (which only
// checks structural rules). If the word doesn't exist in the dictionary (and
// AI also rejects it), we revert the user's score for the round to 0 and
// mark the result as invalid. Network-dependent; rendered as "validando…"
// while in flight.
async function validateAndUpdateUserWord(state) {
  const word = state.userWordResult?.word;
  if (!word) return;
  const language = getTrainingEffectiveWordLanguage(state);
  // Mark as "checking" so the UI can show a transient state.
  const checking = {
    ...state,
    userWordResult: { ...state.userWordResult, checking: true },
  };
  saveTrainingMatch(checking);
  renderTrainingMatch();

  let result;
  try {
    result = await validateWordLayered(word, {
      language,
      layers: LAYER_PRESETS.training,
    });
  } catch (err) {
    logger.warn("[training] dictionary validation failed", err);
    // On error, leave the structural verdict intact (don't penalise).
    const current = getTrainingMatch();
    if (!current?.userWordResult) return;
    const cleared = {
      ...current,
      userWordResult: { ...current.userWordResult, checking: false },
    };
    saveTrainingMatch(cleared);
    renderTrainingMatch();
    return;
  }

  const current = getTrainingMatch();
  if (!current?.userWordResult) return;
  // If the word changed between submit and validation (next baza already
  // started), abort the update.
  if (current.userWordResult.word !== word) return;

  if (result.valid) {
    // Dictionary confirmed; clear the checking flag.
    const cleared = {
      ...current,
      userWordResult: {
        ...current.userWordResult,
        checking: false,
        validationSource: result.source,
      },
    };
    saveTrainingMatch(cleared);
    renderTrainingMatch();
    return;
  }

  // Word doesn't exist → invalidate and revert the user's score.
  const userId = current.players[0].id;
  const previousScore = current.userWordResult.score ?? 0;
  const newPlayers = current.players.map((p) => {
    if (p.id !== userId) return p;
    const rounds = (p.rounds ?? []).slice();
    if (rounds.length > 0) {
      rounds[rounds.length - 1] = { ...rounds[rounds.length - 1], points: 0 };
    }
    return { ...p, rounds, score: Math.max(0, (p.score ?? 0) - previousScore) };
  });
  const updated = {
    ...current,
    players: newPlayers,
    userWordResult: {
      ...current.userWordResult,
      valid: false,
      reason: "not_in_dictionary",
      score: 0,
      checking: false,
      validationSource: result.source,
    },
  };
  saveTrainingMatch(updated);
  renderTrainingMatch();
}

// ── Actions phase driver ───────────────────────────────────
// The scheduler, busy mutex, and "advance after action" logic now live in
// ./actionsController.js. This module just registers `processNextActionsTurn`
// as the tick callback and pulls in the named helpers from the controller.

function processNextActionsTurn() {
  if (isDriverBusy()) return;
  const state = getTrainingMatch();
  if (!state || state.phase !== "actions") return;
  const queue = state.actionsQueue ?? [];
  if (queue.length === 0) {
    renderTrainingMatch();
    return;
  }
  const nextActorId = queue[0];
  const userId = state.players[0].id;

  if (nextActorId === userId) {
    if (isUserTurnBlockedByActionBubble(state)) {
      renderTrainingMatch();
      scheduleDriverTick(250);
      return;
    }
    if (state.userActionResolved) {
      // Already resolved (shield interrupt or pre-played). Skip turn.
      const next = advanceActionsQueue(state);
      renderTrainingMatch();
      if (next.phase === "actions") scheduleDriverTick();
      return;
    }
    // Always wait for user input. The user picks their card here (single
    // tap) — there is no "preselect = auto-play" path anymore. If the user
    // has a card focused/preselected (from strategy), the UI highlights it
    // and `playTurnAutoForUser` runs that one if the turn timer expires.
    renderTrainingMatch();
    return;
  }

  // Debug mode: let user choose which card the ghost plays
  if (debugMode) {
    const ghostName = state.players.find((p) => p.id === nextActorId)?.name || nextActorId;
    const mvpCards = getActionCardDefsForLanguage(state.language).filter((c) => c.inMVP);
    markDriverBusy("picker");
    openTrainingPicker({
      titleKey: null,
      context: { label: `🐛 ${ghostName} juega:`, kind: "forced" },
      options: mvpCards.map((c) => ({ id: c.id, label: humanActionName(c.id) })),
      onPick: (actionId) => {
        const cardDef = ACTION_CARDS.find((c) => c.id === actionId);
        const fakeCard = { id: "debug-ghost-card", type: "action", ...cardDef, actionId: cardDef.id };

        function applyDebugGhost(targetId, payload = {}) {
          clearDriverBusy();
          // Re-read fresh state — closure value may be stale after previous ghosts
          // in the same baza have modified shieldedPlayers / forcedRules.
          const fresh = getTrainingMatch();
          const fakeLog = { playerId: nextActorId, actionId, targetId, payload };
          // NOTE: must pass `fakeCard` (which has `actionId`) to isAttackOnUser
          // — `cardDef` from constants has `id`, not `actionId`, so the
          // SHIELDABLE_ATTACK_IDS check silently returned false (and the
          // shield prompt never appeared).
          const isAtk = isAttackOnUser(fakeCard, targetId, userId);
          // Always prompt if the user has a shield in hand and is not yet
          // shielded. Preselecting the shield in strategy no longer auto-
          // activates it — it remains reactive on every attack.
          if (isAtk && userHasShield(fresh) && !(fresh.shieldedPlayers ?? []).includes(userId)) {
            markDriverBusy("picker");
            promptShield({ source: nextActorId, card: fakeCard }, fakeLog);
          } else {
            playActionWithReadDelay(
              () => applyPlannedGhostAction(fresh, fakeLog),
              fakeLog,
              (s) => {
                const moves = consumeMovesAndUpdateAttackBanner(s, fakeLog);
                debugLogPushAction(s, { actorId: nextActorId, actionId, targetId, payload, moves });
                advanceAfterAction(s);
              },
            );
          }
        }

        pickTargetAndPayloadForUser(getTrainingMatch() || state, fakeCard, (targetId, payload) => {
          applyDebugGhost(targetId, payload);
        }, `🐛 ${ghostName}`, nextActorId);
      },
    });
    return;
  }
  // Ghost turn (normal)
  const planned = planGhostAction(state, nextActorId);
  if (!planned.log) {
    advanceActionsQueue(planned.state);
    renderTrainingMatch();
    scheduleDriverTick();
    return;
  }

  saveTrainingMatch(planned.state);

  // Shield is now always reactive — if `planned.shieldOpportunity` is set,
  // the prompt is shown a few lines below. No auto-shield branch needed.

  // discard_one targeting user → user picks which card to discard
  if (planned.log.actionId === "discard_one" && planned.log.targetId === userId) {
    markDriverBusy("picker");
    promptDiscardOne(planned.state, planned.log);
    return;
  }

  if (planned.shieldOpportunity) {
    markDriverBusy("picker");
    promptShield(planned.shieldOpportunity, planned.log);
    return;
  }

  // No shield prompt: show the actor's bubble/banner first, then (after the
  // read pause) apply the effect and advance.
  playActionWithReadDelay(
    () => applyPlannedGhostAction(planned.state, planned.log),
    planned.log,
    (s) => {
      const moves = consumeMovesAndUpdateAttackBanner(s, planned.log);
      debugLogPushAction(s, { ...planned.log, actorId: planned.log.playerId, moves });
      advanceAfterAction(s);
    },
  );
}

function promptShield(opportunity, log) {
  const sourcePlayer = (getTrainingMatch().players ?? []).find((p) => p.id === opportunity.source);
  const sourceName = sourcePlayer?.name || opportunity.source;
  const attackLabel = humanActionName(opportunity.card.actionId);
  const bodyTpl = t("trainingShieldPromptBody") || "{source} → {action}";
  const subtitle = bodyTpl.replace("{source}", sourceName).replace("{action}", attackLabel);
  openTrainingPicker({
    titleKey: "trainingShieldPromptTitle",
    context: { label: `🛡 ¿Usas escudo?`, kind: "shield" },
    subtitle,
    options: [
      { id: "use",  label: t("optInConfirmActivate") || "🛡" },
      { id: "skip", label: t("optInConfirmSkip")    || "✗"  },
    ],
    timeoutMs: PICKER_TIMEOUT_MS,
    onPick: (choice) => {
      clearDriverBusy();
      if (choice === "use") {
        // Shield reactively: register the user in shieldedPlayers FIRST so
        // the attack will short-circuit. The blocked toast shows the 🛡;
        // no read pause needed since the user just clicked through the
        // shield prompt.
        let s = useShieldOnAttack(getTrainingMatch(), opportunity.source);
        saveTrainingMatch(s);
        s = applyActionWithFX(
          () => applyPlannedGhostAction(s, log, { shielded: true }),
          log,
        );
        const moves = consumeMovesAndUpdateAttackBanner(s, log);
        debugLogPushAction(s, { ...log, actorId: log.playerId, blocked: true, moves });
        showActionToast(s, log, { blocked: true });
        advanceAfterAction(s);
      } else {
        playActionWithReadDelay(
          () => applyPlannedGhostAction(getTrainingMatch(), log),
          log,
          (s) => {
            const moves = consumeMovesAndUpdateAttackBanner(s, log);
            debugLogPushAction(s, { ...log, actorId: log.playerId, moves });
            advanceAfterAction(s);
          },
        );
      }
    },
  });
}

function promptDiscardOne(state, log) {
  const userId = state.players[0].id;
  const hand = state.hands[userId];
  const letters = hand && hand !== "<hidden>" ? (hand.letters ?? []).filter(Boolean) : [];
  const attacker = state.players.find((p) => p.id === log.playerId);
  if (letters.length === 0) {
    clearDriverBusy();
    let s = advanceActionsQueue(state);
    renderTrainingMatch();
    if (s.phase === "actions") scheduleDriverTick();
    return;
  }
  const attackerName = attacker?.name || log.playerId;
  openTrainingPicker({
    titleKey: "trainingDiscardOneTitle",
    context: { label: `⚡ ${attackerName}: Deshazte de una`, kind: "forced" },
    options: letters.map((c) => ({ id: c.id, label: c.letter })),
    timeoutMs: PICKER_TIMEOUT_MS,
    onPick: (cardId) => {
      clearDriverBusy();
      const finalLog = { ...log, payload: { cardId } };
      // Re-read state in case anything moved between picker open and
      // confirm; we apply against the latest, not the captured snapshot.
      // (Drives the same fix pattern as the wildcard/tilde pickers in
      // creation phase — never spread a stale state when saving.)
      const fresh = getTrainingMatch();
      if (!fresh) return;
      let s = applyActionWithFX(
        () => applyPlannedGhostAction(fresh, finalLog),
        finalLog,
      );
      showActionToast(s, log);
      const moves = consumeMovesAndUpdateAttackBanner(s, finalLog);
      debugLogPushAction(s, { ...finalLog, actorId: finalLog.playerId, moves });
      advanceAfterAction(s);
    },
  });
}

// ACTION_CARD_META + action helpers → ui/components/actionCard.js

// actionIcon, actionDesc, makeActionIconEl → ui/components/actionCard.js

// openActionGallery removed (button now opens quick guide directly)

// humanActionName, actionLabel → ui/components/actionCard.js

// Manual rule: when the user's hand is emptied by ghost actions, they get
// to draw 1 letter (vowel or consonant) before continuing. Returns true if
// the prompt was shown (caller should pause its loop).
function maybeOfferEmergencyDraw(onPicked) {
  let state = getTrainingMatch();
  if (!state) return false;
  // Auto-draw for any ghost with empty hand first
  const after = autoDrawForEmptyGhosts(state);
  if (after !== state) {
    saveTrainingMatch(after);
    state = after;
    renderTrainingMatch();
  }
  // Then check if the user also needs to draw
  if (!userHandHasNoLetters(state)) return false;
  markDriverBusy("picker");
  openTrainingPicker({
    titleKey: "trainingEmergencyDrawTitle",
    context: { label: `⚡ Robo de emergencia`, kind: "forced" },
    options: [
      { id: "vowel",     label: t("trainingEmergencyDrawVowel") || "Vocal" },
      { id: "consonant", label: t("trainingEmergencyDrawConsonant") || "Consonante" },
    ],
    timeoutMs: PICKER_TIMEOUT_MS,
    onPick: (kind) => {
      drawEmergencyLetter(getTrainingMatch(), kind);
      clearDriverBusy();
      renderTrainingMatch();
      if (typeof onPicked === "function") onPicked();
    },
  });
  return true;
}

// ── 5s auto-select countdown when user's turn starts in actions phase ─

function stopUserTurnTimer() {
  if (userTurnTimerInterval) {
    clearInterval(userTurnTimerInterval);
    userTurnTimerInterval = null;
  }
  const wrap = document.getElementById("trainingActionBarWrap");
  if (wrap) wrap.classList.add("hidden");
}

function startUserTurnTimer() {
  stopUserTurnTimer();
  userTurnRemainingMs = USER_TURN_DURATION_MS;
  const wrap = document.getElementById("trainingActionBarWrap");
  const bar = document.getElementById("trainingActionBar");
  if (wrap) wrap.classList.remove("hidden");
  if (bar) bar.style.width = "100%";
  userTurnTimerInterval = setInterval(() => {
    userTurnRemainingMs -= 100;
    const pct = Math.max(0, (userTurnRemainingMs / USER_TURN_DURATION_MS) * 100);
    const barEl = document.getElementById("trainingActionBar");
    if (barEl) barEl.style.width = pct + "%";
    if (userTurnRemainingMs <= 0) {
      stopUserTurnTimer();
      autoPickUserAction();
    }
  }, 100);
}

function maybeStartUserTurnTimer(state) {
  const userId = state.players[0].id;
  const isUserTurn = state.phase === "actions"
    && state.actionsQueue?.[0] === userId
    && !state.userActionResolved
    && !isUserTurnBlockedByActionBubble(state);
  if (isUserTurn) {
    if (!userTurnTimerInterval) startUserTurnTimer();
  } else {
    stopUserTurnTimer();
  }
}

function isUserTurnBlockedByActionBubble(state) {
  const bubble = getCurrentActionBubble();
  if (!state || state.phase !== "actions" || !bubble) return false;
  const userId = state.players?.[0]?.id;
  return !!userId
    && state.actionsQueue?.[0] === userId
    && bubble.playerId !== userId;
}

function autoPickUserAction() {
  if (isDriverBusy()) return;
  const state = getTrainingMatch();
  if (!state || state.phase !== "actions") return;
  const userId = state.players[0].id;
  if (state.actionsQueue?.[0] !== userId) return;
  if (state.userActionResolved) return;
  const hand = state.hands[userId];
  if (!hand || hand === "<hidden>") return;
  // Prefer the preselected card (userActionIndex set from strategy via focus);
  // otherwise fall back to the first available card.
  const preselectedIdx = state.userActionIndex != null
    && hand.actions?.[state.userActionIndex] != null
    ? state.userActionIndex
    : -1;
  const firstIdx = preselectedIdx >= 0 ? preselectedIdx : hand.actions.findIndex((c) => c != null);
  if (firstIdx < 0) return;
  const card = hand.actions[firstIdx];

  // ESCUDO TOTAL auto-played on timeout — same special handling as the
  // proactive tap: discard all cards, register the user in shieldedPlayers.
  if (card.actionId === "shield_total") {
    const allActions = (hand?.actions ?? []).filter(Boolean);
    const alreadyShielded = (state.shieldedPlayers ?? []).includes(userId);
    let s = { ...state,
      hands: { ...state.hands, [userId]: { ...hand, actions: [] } },
      discards: { ...state.discards, actions: [...state.discards.actions, ...allActions] },
      shieldedPlayers: alreadyShielded
        ? state.shieldedPlayers
        : [...(state.shieldedPlayers ?? []), userId],
      userActionResolved: true,
    };
    saveTrainingMatch(s);
    debugLogPushAction(s, { actorId: userId, actionId: "shield_total" });
    showActionToast(s, { playerId: userId, actionId: "shield_total" });
    s = advanceActionsQueue(s);
    renderTrainingMatch();
    if (s.phase === "actions") scheduleDriverTick();
    return;
  }

  // For any action that requires picking a target or payload, defer to the
  // normal user-tap flow (handleUserPickAction). That opens the picker so
  // the user still has a chance to choose victim / letter — the picker's
  // own 7 s timeout will fall back to the first option if they don't, but
  // they were at least ASKED instead of having it auto-decided silently.
  handleUserPickAction(firstIdx);
}

// User taps an action card during their own turn → play it immediately. The
// strategy phase no longer reaches this function; single-tap there just
// toggles focus (preselection is finalised when the timer expires or the
// "Listo" button is pressed).
function handleUserPickAction(actionIndex) {
  _shell.playClickFeedback();
  const state = getTrainingMatch();
  if (!state) return;
  const userId = state.players[0].id;
  const card = state.hands[userId]?.actions?.[actionIndex];
  if (!card) return;

  if (state.phase === "actions" && state.actionsQueue?.[0] === userId && !state.userActionResolved) {
    stopUserTurnTimer();

    // ESCUDO TOTAL played proactively on the user's turn: discard ALL action
    // cards in hand, register the player in shieldedPlayers so the remaining
    // attacks in this trick will skip them.
    if (card.actionId === "shield_total") {
      const userHand = state.hands[userId];
      const allActions = (userHand?.actions ?? []).filter(Boolean);
      const alreadyShielded = (state.shieldedPlayers ?? []).includes(userId);
      let s = { ...state,
        hands: { ...state.hands, [userId]: { ...userHand, actions: [] } },
        discards: { ...state.discards, actions: [...state.discards.actions, ...allActions] },
        shieldedPlayers: alreadyShielded
          ? state.shieldedPlayers
          : [...(state.shieldedPlayers ?? []), userId],
        userActionResolved: true,
      };
      saveTrainingMatch(s);
      debugLogPushAction(s, { actorId: userId, actionId: "shield_total" });
      showActionToast(s, { playerId: userId, actionId: "shield_total" });
      s = advanceActionsQueue(s);
      renderTrainingMatch();
      if (s.phase === "actions") scheduleDriverTick();
      return;
    }

    markDriverBusy("picker");
    pickTargetAndPayloadForUser(state, card, (targetId, payload) => {
      clearDriverBusy();
      const userLog = { playerId: userId, actionId: card.actionId, targetId, payload };
      let s = applyActionWithFX(
        () => playUserAction(getTrainingMatch(), actionIndex, targetId, payload),
        userLog,
      );
      const moves = consumeMovesAndUpdateAttackBanner(s, userLog);
      debugLogPushAction(s, { actorId: userId, actionId: card.actionId, targetId, payload, moves });
      showActionToast(s, userLog);
      s = advanceActionsQueue(s);
      renderTrainingMatch();
      if (s.phase === "actions") scheduleDriverTick();
    });
  }
}

function openChangeCardsPicker(letters, titleKey, onConfirm, context = null, timeoutMs = PICKER_TIMEOUT_MS) {
  const overlay = document.createElement("div");
  overlay.className = "training-picker-overlay";
  const card = document.createElement("div");
  card.className = "training-picker-card";
  const title = document.createElement("div");
  title.className = "training-picker-title";
  title.textContent = t(titleKey) || "¿Qué cartas cambias?";
  card.appendChild(title);
  if (context) {
    const ctx = document.createElement("div");
    ctx.className = "training-picker-context is-" + context.kind;
    ctx.textContent = context.label;
    card.insertBefore(ctx, title);
  }

  const selected = new Set();
  let timerInterval = null;
  let remaining = timeoutMs;

  function confirmSelection() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (document.body.contains(overlay)) document.body.removeChild(overlay);
    onConfirm(selected.size > 0 ? [...selected] : letters.map((l) => l.id));
  }

  if (timeoutMs > 0 && letters.length > 0) {
    const timerWrap = document.createElement("div");
    timerWrap.className = "training-picker-timer-wrap";
    const timerBar = document.createElement("div");
    timerBar.className = "training-picker-timer-bar";
    timerBar.style.width = "100%";
    timerWrap.appendChild(timerBar);
    card.appendChild(timerWrap);
    timerInterval = setInterval(() => {
      remaining -= 100;
      const pct = Math.max(0, (remaining / timeoutMs) * 100);
      timerBar.style.width = pct + "%";
      if (remaining <= 0) {
        confirmSelection();
      }
    }, 100);
  }

  const list = document.createElement("div");
  list.className = "training-picker-options";
  const btns = {};
  for (const l of letters) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "training-picker-option"
      + (l.isWildcard ? " is-wildcard-choice" : "")
      + (l.isActionWildcard ? " is-action-wildcard-choice" : "")
      + (!l.isActionWildcard && l.isWildcard && l.kind === "vowel" ? " is-vowel-wildcard-choice" : "")
      + (!l.isActionWildcard && l.isWildcard && l.kind === "consonant" ? " is-consonant-wildcard-choice" : "");
    btn.textContent = l.isWildcard ? "★" : l.letter;
    btns[l.id] = btn;
    btn.addEventListener("click", () => {
      if (selected.has(l.id)) {
        selected.delete(l.id);
        btn.classList.remove("is-selected");
      } else {
        selected.add(l.id);
        btn.classList.add("is-selected");
      }
      const count = selected.size;
      confirmBtn.textContent =
        (t("trainingChangeCardsConfirm") || "Cambiar") +
        (count > 0 ? ` (${count})` : "");
    });
    list.appendChild(btn);
  }
  card.appendChild(list);

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "training-picker-confirm-btn";
  confirmBtn.textContent = t("trainingChangeCardsConfirm") || "Cambiar";
  confirmBtn.addEventListener("click", confirmSelection);
  card.appendChild(confirmBtn);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function pickerCardTokenClass(card) {
  return "training-picker-card-token"
    + (card?.isWildcard ? " is-wildcard-choice" : "")
    + (card?.isActionWildcard ? " is-action-wildcard-choice" : "")
    + (!card?.isActionWildcard && card?.isWildcard && card?.kind === "vowel" ? " is-vowel-wildcard-choice" : "")
    + (!card?.isActionWildcard && card?.isWildcard && card?.kind === "consonant" ? " is-consonant-wildcard-choice" : "");
}

function renderPickerCardToken(card) {
  const token = document.createElement("span");
  token.className = pickerCardTokenClass(card);
  token.textContent = card?.isWildcard ? "★" : (card?.letter || "?");
  return token;
}

function findPickedTwoToCenterCards(state, picks) {
  const cards = [];
  for (const pick of picks ?? []) {
    const hand = state.hands?.[pick.playerId];
    const letters = hand && hand !== "<hidden>" ? (hand.letters ?? []) : [];
    let card = null;
    if (pick.cardId) {
      card = letters.find((c) => c?.id === pick.cardId && !c.isActionWildcard);
    }
    if (!card) {
      card = letters.find((c) => c && !c.isActionWildcard && (!pick.kind || c.kind === pick.kind));
    }
    if (card) cards.push(card);
  }
  return cards;
}

function openTwoToCenterBoardPicker(cards, context, onConfirm, timeoutMs = PICKER_TIMEOUT_MS) {
  const overlay = document.createElement("div");
  overlay.className = "training-picker-overlay";
  const card = document.createElement("div");
  card.className = "training-picker-card";
  if (context) {
    const ctx = document.createElement("div");
    ctx.className = "training-picker-context is-" + context.kind;
    ctx.textContent = context.label;
    card.appendChild(ctx);
  }
  const title = document.createElement("div");
  title.className = "training-picker-title";
  title.textContent = t("trainingTwoToCenterPickBoardTitle") || "Elige 2 para el tablero";
  card.appendChild(title);

  const selected = new Set();
  let timerInterval = null;
  let remaining = timeoutMs;

  function confirmSelection() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (document.body.contains(overlay)) document.body.removeChild(overlay);
    const ids = [...selected].slice(0, 2);
    onConfirm(ids.length === 2 ? ids : cards.slice(0, 2).map((c) => c.id));
  }

  if (timeoutMs > 0 && cards.length > 0) {
    const timerWrap = document.createElement("div");
    timerWrap.className = "training-picker-timer-wrap";
    const timerBar = document.createElement("div");
    timerBar.className = "training-picker-timer-bar";
    timerBar.style.width = "100%";
    timerWrap.appendChild(timerBar);
    card.appendChild(timerWrap);
    timerInterval = setInterval(() => {
      remaining -= 100;
      const pct = Math.max(0, (remaining / timeoutMs) * 100);
      timerBar.style.width = pct + "%";
      if (remaining <= 0) confirmSelection();
    }, 100);
  }

  const list = document.createElement("div");
  list.className = "training-picker-options";
  for (const picked of cards) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "training-picker-option is-card-choice"
      + (picked.isWildcard ? " is-wildcard-choice" : "")
      + (picked.kind === "vowel" ? " is-vowel-wildcard-choice" : " is-consonant-wildcard-choice")
      + (selected.has(picked.id) ? " is-selected" : "");
    btn.textContent = picked.isWildcard ? "★" : picked.letter;
    btn.addEventListener("click", () => {
      if (selected.has(picked.id)) {
        selected.delete(picked.id);
      } else {
        if (selected.size >= 2) selected.delete([...selected][0]);
        selected.add(picked.id);
      }
      list.querySelectorAll("button").forEach((b) =>
        b.classList.toggle("is-selected", selected.has(b.dataset.cardId)),
      );
      confirmBtn.disabled = selected.size !== 2;
      confirmBtn.classList.toggle("disabled", selected.size !== 2);
    });
    btn.dataset.cardId = picked.id;
    list.appendChild(btn);
  }
  card.appendChild(list);

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "training-picker-confirm-btn";
  confirmBtn.textContent = t("trainingChooseThisCard") || "Listo";
  confirmBtn.disabled = selected.size !== 2;
  confirmBtn.classList.toggle("disabled", selected.size !== 2);
  confirmBtn.addEventListener("click", confirmSelection);
  card.appendChild(confirmBtn);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ── Ghost dorso (back-of-card) helpers ────────────────────────
// Generate N simulated card backs (V/C) for a ghost's hidden hand.
// ~35% vowels, 65% consonants (Spanish distribution).
function generateGhostBacks(count = 3) {
  return Array.from({ length: count }, () => ({
    kind: Math.random() < 0.35 ? "vowel" : "consonant",
  }));
}

// Show a dorso (back-of-card) picker for a ghost's simulated hand.
// backs = [{kind}], onPick(kind) called with chosen kind.
function openDorsoPicker({ backs, context, onPick, timeoutMs = 0 }) {
  const overlay = document.createElement("div");
  overlay.className = "training-picker-overlay";
  const card = document.createElement("div");
  card.className = "training-picker-card";
  if (context) {
    const ctx = document.createElement("div");
    ctx.className = "training-picker-context is-" + context.kind;
    ctx.textContent = context.label;
    card.appendChild(ctx);
  }
  const title = document.createElement("div");
  title.className = "training-picker-title";
  title.textContent = t("trainingPickDorsoTitle") || "¿Qué carta robas?";
  card.appendChild(title);

  let timerInterval = null;
  let remaining = timeoutMs;

  function dismiss(back) {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (document.body.contains(overlay)) document.body.removeChild(overlay);
    onPick(back);
  }

  if (timeoutMs > 0 && backs.length > 0) {
    const timerWrap = document.createElement("div");
    timerWrap.className = "training-picker-timer-wrap";
    const timerBar = document.createElement("div");
    timerBar.className = "training-picker-timer-bar";
    timerBar.style.width = "100%";
    timerWrap.appendChild(timerBar);
    card.appendChild(timerWrap);
    timerInterval = setInterval(() => {
      remaining -= 100;
      const pct = Math.max(0, (remaining / timeoutMs) * 100);
      timerBar.style.width = pct + "%";
      if (remaining <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        dismiss(backs[0]);
      }
    }, 100);
  }

  const list = document.createElement("div");
  list.className = "training-picker-options";
  for (const b of backs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `training-picker-option is-dorso is-dorso-${b.kind === "vowel" ? "vowel" : "consonant"}`;
    btn.textContent = b.kind === "vowel" ? "V" : "C";
    btn.addEventListener("click", () => dismiss(b));
    list.appendChild(btn);
  }
  card.appendChild(list);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// Returns dorso backs for a player: real kinds if hand is visible, random if hidden.
function getPlayerBacks(state, playerId) {
  const hand = state.hands[playerId];
  if (!hand || hand === "<hidden>") return generateGhostBacks(3);
  const letters = (hand.letters ?? []).filter(Boolean);
  if (letters.length === 0) return generateGhostBacks(3);
  return letters.map((c) => ({ id: c.id, kind: c.kind }));
}

// Reorder players clockwise starting from the player AFTER actorId.
function inTurnOrder(players, actorId) {
  const n = players.length;
  const idx = players.findIndex((p) => p.id === actorId);
  if (idx < 0) return players;
  const result = [];
  for (let i = 1; i < n; i++) result.push(players[(idx + i) % n]);
  return result;
}

// Pick from each victim sequentially (for out_one, great_heist, two_to_center).
// victims = [player], context = context badge object.
// onAllPicked([{ playerId, kind }]) called when all victims processed.
function pickFromEachGhostSequential(victims, count, context, onAllPicked, state = null) {
  const picks = [];
  function pickNext(idx) {
    if (idx >= victims.length) { onAllPicked(picks); return; }
    const victim = victims[idx];
    const backs = state ? getPlayerBacks(state, victim.id) : generateGhostBacks(count);
    openDorsoPicker({
      backs,
      context: { label: context.label + " " + victim.name, kind: context.kind },
      timeoutMs: PICKER_TIMEOUT_MS,
      onPick: (back) => {
        picks.push({ playerId: victim.id, kind: back.kind, cardId: back.id });
        pickNext(idx + 1);
      },
    });
  }
  pickNext(0);
}

function pickTargetAndPayloadForUser(state, card, done, actorLabel = null, actorId = null) {
  const userId = state.players[0].id;
  const actor_id = actorId || userId;
  const cardDisplayName = humanActionName(card.actionId);
  const actor = actorLabel || "Tú";
  const selfCtx    = { label: `🎯 ${actor}: ${cardDisplayName}`, kind: actorLabel ? "forced" : "self"   };
  const attackCtx  = { label: `⚔️ ${actor} ataca: ${cardDisplayName}`, kind: actorLabel ? "forced" : "attack" };
  // Filter out players whose shield is already ACTIVE (visible info). A
  // shield_total in hand — preselected or not — is hidden information, so
  // those players stay valid targets (attacker can't know they have one).
  const activeShields = new Set(state.shieldedPlayers ?? []);
  const unshielded = (players) => players.filter((p) => !activeShields.has(p.id));

  // one_for_all: pick a target, then pick from their V/C backs
  if (card.actionId === "one_for_all") {
    const candidates = unshielded(inTurnOrder(state.players, actor_id));
    if (candidates.length === 0) { done(null, {}); return; }
    openTrainingPicker({
      titleKey: "trainingPickTargetTitle",
      context: attackCtx,
      options: candidates.map((p) => ({ id: p.id, label: p.name })),
      timeoutMs: PICKER_TIMEOUT_MS,
      onPick: (targetId) => {
        const backs = getPlayerBacks(state, targetId);
        openDorsoPicker({
          backs,
          context: attackCtx,
          timeoutMs: PICKER_TIMEOUT_MS,
          onPick: (back) => done(targetId, { targetKind: back.kind, cardId: back.id }),
        });
      },
    });
    return;
  }

  // steal_letter: pick target, then pick from their V/C backs
  if (card.actionId === "steal_letter") {
    const candidates = unshielded(inTurnOrder(state.players, actor_id));
    if (candidates.length === 0) { done(null, {}); return; }
    openTrainingPicker({
      titleKey: "trainingPickTargetTitle",
      context: attackCtx,
      options: candidates.map((p) => ({ id: p.id, label: p.name })),
      timeoutMs: PICKER_TIMEOUT_MS,
      onPick: (targetId) => {
        const backs = getPlayerBacks(state, targetId);
        openDorsoPicker({
          backs,
          context: attackCtx,
          timeoutMs: PICKER_TIMEOUT_MS,
          onPick: (back) => done(targetId, { targetKind: back.kind, cardId: back.id }),
        });
      },
    });
    return;
  }

  // out_one: pick from each victim sequentially by V/C backs (exclude actor)
  if (card.actionId === "out_one") {
    const victims = unshielded(inTurnOrder(state.players, actor_id));
    if (victims.length === 0) { done(null, {}); return; }
    pickFromEachGhostSequential(victims, 3, attackCtx, (picks) => {
      done(null, { picks });
    }, state);
    return;
  }

  // great_heist: pick from each victim sequentially by V/C backs (exclude actor)
  if (card.actionId === "great_heist") {
    const victims = unshielded(inTurnOrder(state.players, actor_id));
    if (victims.length === 0) { done(null, {}); return; }
    pickFromEachGhostSequential(victims, 3, attackCtx, (picks) => {
      done(null, { picks });
    }, state);
    return;
  }

  // two_to_center: pick from each victim sequentially by V/C backs (exclude actor)
  if (card.actionId === "two_to_center") {
    const victims = unshielded(inTurnOrder(state.players, actor_id));
    if (victims.length === 0) { done(null, {}); return; }
    pickFromEachGhostSequential(victims, 3, attackCtx, (picks) => {
      const pickedCards = findPickedTwoToCenterCards(state, picks);
      if (pickedCards.length <= 2) {
        done(null, { picks, boardCardIds: pickedCards.map((c) => c.id) });
        return;
      }
      openTwoToCenterBoardPicker(pickedCards, selfCtx, (boardCardIds) => {
        done(null, { picks, boardCardIds });
      });
    }, state);
    return;
  }
  // extra_card: pick vowel or consonant
  if (card.actionId === "extra_card") {
    openTrainingPicker({
      titleKey: "trainingPickKindTitle",
      context: selfCtx,
      options: [
        { id: "vowel",     label: t("trainingEmergencyDrawVowel")     || "Vocal" },
        { id: "consonant", label: t("trainingEmergencyDrawConsonant") || "Consonante" },
      ],
      onPick: (kind) => done(null, { kind }),
      timeoutMs: PICKER_TIMEOUT_MS,
    });
    return;
  }
  // solo_mia: pick which board card to take
  if (card.actionId === "solo_mia") {
    const boardCards = (state.centralBoard ?? []).filter(Boolean);
    if (boardCards.length === 0) { done(null, {}); return; }
    openTrainingPicker({
      titleKey: "trainingPickBoardCardTitle",
      context: selfCtx,
      options: boardCards.map((c) => ({ id: c.id, label: c.letter })),
      onPick: (cardId) => done(null, { cardId }),
      timeoutMs: PICKER_TIMEOUT_MS,
    });
    return;
  }
  // change_cards: multi-select which of the ACTOR's cards to discard, then vowel/consonant per card
  if (card.actionId === "change_cards") {
    const actorHand = state.hands[actor_id];
    const letters = actorHand && actorHand !== "<hidden>"
      ? (actorHand.letters ?? []).filter(Boolean) : [];
    if (letters.length === 0) { done(null, {}); return; }
    openChangeCardsPicker(letters, "trainingChangeCardsTitle", (selectedIds) => {
      if (selectedIds.length === 0) { done(null, {}); return; }
      const kinds = {};
      function askKindFor(idx) {
        if (idx >= selectedIds.length) {
          done(null, { cardIds: selectedIds, kinds });
          return;
        }
        const cId = selectedIds[idx];
        const sourceCard = letters.find((l) => l.id === cId);
        openTrainingPicker({
          titleKey: "trainingChangeCardsDiscardLabel",
          context: selfCtx,
          subtitleCard: sourceCard,
          optionsLabel: t("trainingChangeCardsReceiveLabel") || "Recibes",
          options: [
            { id: "vowel",     label: t("trainingEmergencyDrawVowel")     || "Vocal",      className: "is-kind-choice" },
            { id: "consonant", label: t("trainingEmergencyDrawConsonant") || "Consonante", className: "is-kind-choice" },
          ],
          timeoutMs: PICKER_TIMEOUT_MS,
          onPick: (kind) => {
            kinds[cId] = kind;
            askKindFor(idx + 1);
          },
        });
      }
      askKindFor(0);
    }, selfCtx);
    return;
  }

  // swap_all: pick target only — TODAS the actor's letters swap with the
  // target's (action wildcards stay with their owner). The manual is
  // explicit: no per-card selection.
  if (card.actionId === "swap_all") {
    const candidates = unshielded(inTurnOrder(state.players, actor_id));
    if (candidates.length === 0) { done(null, {}); return; }
    openTrainingPicker({
      titleKey: "trainingPickTargetTitle",
      context: attackCtx,
      options: candidates.map((p) => ({ id: p.id, label: p.name })),
      timeoutMs: PICKER_TIMEOUT_MS,
      onPick: (targetId) => { done(targetId, {}); },
    });
    return;
  }

  // swap_one: pick target, then pick which of ACTOR's own letters to give, then pick target's V/C back
  if (card.actionId === "swap_one") {
    const candidates = unshielded(inTurnOrder(state.players, actor_id));
    if (candidates.length === 0) { done(null, {}); return; }
    openTrainingPicker({
      titleKey: "trainingPickTargetTitle",
      context: attackCtx,
      options: candidates.map((p) => ({ id: p.id, label: p.name })),
      timeoutMs: PICKER_TIMEOUT_MS,
      onPick: (targetId) => {
        const actorHand = state.hands[actor_id];
        const letters = actorHand && actorHand !== "<hidden>"
          ? (actorHand.letters ?? []).filter(Boolean) : [];
        if (letters.length === 0) { done(targetId, {}); return; }
        openTrainingPicker({
          titleKey: "trainingSwapOnePickTitle",
          context: attackCtx,
          subtitle: t("trainingSwapOnePickSubtitle") || null,
          options: letters.map((c) => ({ id: c.id, label: c.letter })),
          timeoutMs: PICKER_TIMEOUT_MS,
          onPick: (fromId) => {
            const backs = getPlayerBacks(state, targetId);
            openDorsoPicker({
              backs,
              context: attackCtx,
              timeoutMs: PICKER_TIMEOUT_MS,
              onPick: (back) => done(targetId, { fromId, targetKind: back.kind, toId: back.id }),
            });
          },
        });
      },
    });
    return;
  }

  // Player-target actions
  if (card.target === "one") {
    const candidates = unshielded(inTurnOrder(state.players, actor_id));
    openTrainingPicker({
      titleKey: "trainingPickTargetTitle",
      context: attackCtx,
      options: candidates.map((p) => ({ id: p.id, label: p.name })),
      onPick: (targetId) => done(targetId, {}),
      timeoutMs: PICKER_TIMEOUT_MS,
    });
    return;
  }
  // Letter payload for use_vowel / use_consonant / use_letter
  if (["use_vowel", "use_consonant", "use_letter"].includes(card.actionId)) {
    const letters = (state.centralBoard ?? []).filter((c) => {
      if (c.isWildcard) return false; // wildcards have no fixed letter
      if (card.actionId === "use_vowel") return c.kind === "vowel";
      if (card.actionId === "use_consonant") return c.kind === "consonant";
      return true;
    });
    if (letters.length === 0) { done(null, { letter: null, cardId: null }); return; }
    openTrainingPicker({
      titleKey: "trainingPickLetterTitle",
      context: selfCtx,
      options: letters.map((c) => ({ id: c.id, label: c.letter })),
      onPick: (id) => {
        const lc = letters.find((c) => c.id === id);
        done(null, { letter: lc?.letter, cardId: lc?.id });
      },
      timeoutMs: PICKER_TIMEOUT_MS,
    });
    return;
  }
  done(null, {});
}

// Simple picker modal — reuses openConfirm shape with custom buttons.
// Pass timeoutMs to show a countdown bar and auto-pick the first option on expiry.
// Pass subtitle (string) or subtitleCard to render body content below the title.
function openTrainingPicker({ titleKey, subtitle, subtitleCard, optionsLabel, context, options, onPick, timeoutMs = 0 }) {
  const overlay = document.createElement("div");
  overlay.className = "training-picker-overlay";
  const card = document.createElement("div");
  card.className = "training-picker-card";
  const title = document.createElement("div");
  title.className = "training-picker-title";
  title.textContent = t(titleKey) || "";
  card.appendChild(title);
  if (subtitle) {
    const sub = document.createElement("div");
    sub.className = "training-picker-subtitle";
    sub.textContent = subtitle;
    card.appendChild(sub);
  }
  if (subtitleCard) {
    const subCardWrap = document.createElement("div");
    subCardWrap.className = "training-picker-subtitle-card";
    subCardWrap.appendChild(renderPickerCardToken(subtitleCard));
    card.appendChild(subCardWrap);
  }
  if (context) {
    const ctx = document.createElement("div");
    ctx.className = "training-picker-context is-" + context.kind;
    ctx.textContent = context.label;
    card.insertBefore(ctx, title); // context badge goes ABOVE the title
  }

  let timerInterval = null;
  let remaining = timeoutMs;

  function dismiss(id) {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (document.body.contains(overlay)) document.body.removeChild(overlay);
    onPick(id);
  }

  if (timeoutMs > 0 && options.length > 0) {
    const timerWrap = document.createElement("div");
    timerWrap.className = "training-picker-timer-wrap";
    const timerBar = document.createElement("div");
    timerBar.className = "training-picker-timer-bar";
    timerBar.style.width = "100%";
    timerWrap.appendChild(timerBar);
    card.appendChild(timerWrap);
    timerInterval = setInterval(() => {
      remaining -= 100;
      const pct = Math.max(0, (remaining / timeoutMs) * 100);
      timerBar.style.width = pct + "%";
      if (remaining <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        dismiss(options[0].id);
      }
    }, 100);
  }

  const list = document.createElement("div");
  list.className = "training-picker-options";
  if (optionsLabel) {
    const label = document.createElement("div");
    label.className = "training-picker-options-label";
    label.textContent = optionsLabel;
    card.appendChild(label);
  }
  for (const opt of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "training-picker-option" + (opt.className ? ` ${opt.className}` : "");
    btn.textContent = opt.label;
    btn.addEventListener("click", () => dismiss(opt.id));
    list.appendChild(btn);
  }
  card.appendChild(list);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ── Action speech bubble (attached to acting player's pill) ─
// State persists across re-renders; renderTrainingScoreboard re-attaches it.

// triggerAttackBanner / showActionToast / clearActionBanner / attachActionBubble
// now live in ./actionToast.js. The training-screen-specific config (the
// "reaches user" heuristic, which depends on the ACTION_CARDS metadata and
// the player IDs) is wired below.

function confirmExitTrainingMatch() {
  _shell.playClickFeedback();
  const state = getTrainingMatch();
  // No active match, or match hasn't really started (no cards dealt yet) → exit directly.
  if (!state || state.centralBoard.length === 0) {
    exitTrainingMatch();
    return;
  }
  _shell.openConfirm({
    title: "trainingExitConfirmTitle",
    body: "trainingExitConfirmBody",
    acceptText: "confirmAccept",
    cancelText: "cancel",
    onConfirm: () => exitTrainingMatch(),
  });
}

function stopTrainingTimer() {
  if (trainingTimerInterval) {
    clearInterval(trainingTimerInterval);
    trainingTimerInterval = null;
  }
}

function ensureTrainingTimer() {
  stopTrainingTimer();
  const state = getTrainingMatch();
  if (!state) return;
  const phase = state.phase;
  if (phase !== "strategy" && phase !== "creation") return;
  if (phase === "creation" && state.untimedCreation) return;
  // Don't tick down while the "ESTRATEGIA"/"CREACIÓN" phase flash is still
  // visible — the banner hide handler re-renders, and on that re-render we
  // get a fresh ensureTrainingTimer call that actually starts the tick.
  if (isTrainingTimerGated()) return;
  if (trainingClockPhase !== phase) {
    trainingClockPhase = phase;
    _shell.playClockLoop();
  }
  trainingTimerInterval = setInterval(() => {
    const current = getTrainingMatch();
    if (!current || (current.phase !== "strategy" && current.phase !== "creation")) {
      stopTrainingTimer();
      return;
    }
    let next;
    if (current.phase === "strategy") {
      next = tickStrategyTimer(current);
      // If strategy just ended and the user had a card focused, treat the
      // focus as a preselection — the focused card becomes the default play.
      if (current.phase === "strategy" && next.phase === "actions" && focusedActionIndex != null) {
        const userId = current.players[0].id;
        const card = current.hands?.[userId]?.actions?.[focusedActionIndex];
        next = selectActionInStrategy(current, focusedActionIndex);
        if (card) debugLogPushPreselect(next, card.actionId);
        focusedActionIndex = null;
      }
    } else {
      // Creation phase: tick; if timer ran out, finalize the word with
      // validation/score and transition to result.
      next = tickCreationTimer(current);
      if (current.phase === "creation" && next.phase === "result") {
        next = finalizeUserWord(current, trainingWordLangOverride ?? current.language ?? "es");
        const r = next.userWordResult;
        if (r) debugLogPushWord(next, { word: r.word, valid: r.valid, score: r.score, reason: r.reason });
        if (r?.valid && r?.word) {
          // Fire-and-forget; updates UI when the dictionary verdict returns.
          validateAndUpdateUserWord(next);
        }
      }
    }
    if (next.phase !== current.phase) {
      trainingClockPhase = null;
      // Force the timer label to "00:00" before any re-render so the user
      // actually sees the counter reach zero (otherwise the last frame
      // visible is the previous tick value, e.g. "00:01").
      const timerEl = document.getElementById("trainingTimerValue");
      if (timerEl) timerEl.textContent = "00:00";
      saveTrainingMatch(next);
      stopTrainingTimer();
      _shell.triggerTimeUpEffects("training");
      renderTrainingMatch();
      return;
    }
    saveTrainingMatch(next);
    renderTrainingTimer(next);
    if (next.remaining <= LOW_TIME_THRESHOLD && next.remaining > 0) {
      _shell.playLowTimeTick();
    }
  }, 1000);
}

// Called by main.js showScreen() when navigating away from training
export function cleanupTraining(stopClock) {
  stopTrainingTimer();
  stopDriver();
  stopUserTurnTimer();
  if (trainingClockPhase !== null) {
    trainingClockPhase = null;
    _shell.stopClockLoop(stopClock);
  }
}

async function requestTrainingHints() {
  const state = getTrainingMatch();
  const body = document.getElementById("hintsModalBody");
  const btn = document.getElementById("trainingHintBtn");
  if (!body || !state) return;

  // Map UI training difficulty → solver difficulty profile.
  const uiDiff = state.difficulty || "normal";
  let solverDiff = "normal";
  if (uiDiff === "hard") solverDiff = "hard";
  else if (uiDiff === "normal") solverDiff = "normal";
  else solverDiff = "easy";

  const labelEl = btn?.querySelector(".training-hint-btn-label");
  if (btn) btn.disabled = true;
  if (labelEl) labelEl.textContent = "Buscando…";
  body.innerHTML = '<div class="hint-empty">Buscando…</div>';
  openModal("hints", { closable: true });

  let hints = [];
  const t0 = performance.now();
  try {
    hints = await findHints(state, { count: 5, difficulty: solverDiff, language: getTrainingEffectiveWordLanguage(state) });
  } catch (err) {
    logger.warn("[hints] solver failed", err);
  }
  const elapsed = Math.round(performance.now() - t0);

  if (btn) btn.disabled = false;
  if (labelEl) labelEl.textContent = "Sugerir";

  if (hints.length === 0) {
    body.innerHTML = '<div class="hint-empty">No se han encontrado palabras</div>';
    return;
  }

  const items = hints.map((h) => renderHintItem(h)).join("");
  body.innerHTML = `<ol class="hints-list">${items}</ol><div class="hints-meta">${hints.length} resultado${hints.length === 1 ? "" : "s"} · ${elapsed} ms</div>`;
}

function renderHintItem(hint) {
  // Render letter-by-letter so wildcards can carry a marker below.
  const letters = (hint.cards ?? []).map((card) => {
    const shown = card.isWildcard
      ? (card.chosenLetter || "?").toUpperCase()
      : (card.usingTilde && card.tildeChar)
        ? card.tildeChar
        : (card.letter || "").toUpperCase();
    const cls = card.isWildcard ? "hint-letter is-wild" : "hint-letter";
    return `<span class="${cls}">${escapeHtml(shown)}</span>`;
  }).join("");
  // Compact breakdown: only the non-letter parts (wildcard bonus, modifier,
  // x2). Letter values are obvious from the letters above.
  const compact = (hint.breakdown ?? [])
    .filter((p) => p.kind !== "letter")
    .map((p) => {
      if (p.kind === "wildcard-bonus") return `<span class="hint-tag is-wild">★ +6</span>`;
      if (p.kind === "modifier") {
        const sign = p.delta > 0 ? "+" : "";
        const cls = p.delta > 0 ? "is-positive" : "is-negative";
        return `<span class="hint-tag ${cls}">${sign}${p.delta}</span>`;
      }
      if (p.kind === "double") {
        const lbl = p.reason === "color" ? "×2 color" : "×2 todo";
        return `<span class="hint-tag is-double">${lbl}</span>`;
      }
      return "";
    })
    .filter(Boolean)
    .join("");
  const tags = compact ? `<span class="hint-tags">${compact}</span>` : "";
  return `<li><span class="hint-word">${letters}</span>${tags}<span class="hint-score">${hint.score}</span></li>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function handleDealRandomBoard() {
  _shell.playClickFeedback();
  const state = getTrainingMatch();
  if (!state || state.phase !== "dealing") return;
  (state.centralBoard ?? []).forEach((c, i) => {
    if (c == null) markRevealed("board", i);
  });
  fillRemainingBoardRandomly(state);
  const after = getTrainingMatch();
  maybeHoldHandPickerAfterBoard(state, after);
  if (after && after.phase !== "dealing") startDealCascade(after);
  renderTrainingMatch();
}

function handleDealRandomHand() {
  _shell.playClickFeedback();
  const state = getTrainingMatch();
  if (!state || state.phase !== "dealing") return;
  const userId = state.players[0].id;
  (state.hands[userId]?.letters ?? []).forEach((c, i) => {
    if (c == null) markRevealed("hand", i);
  });
  fillRemainingHandRandomly(state);
  const after = getTrainingMatch();
  if (after && after.phase !== "dealing") startDealCascade(after);
  renderTrainingMatch();
}

// Exports used by main.js
export {
  setupTrainingDebugToggle,
  startTrainingMatch,
  confirmExitTrainingMatch,
  finishTrainingTimer,
  renderTrainingMatch,
  renderTrainingSetup,
  requestTrainingHints,
  handleDealRandomBoard,
  handleDealRandomHand,
};

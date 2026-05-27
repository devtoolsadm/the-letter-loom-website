import {
  createTrainingMatch,
  getTrainingMatch,
  saveTrainingMatch,
  clearTrainingMatch,
  initializeRound,
  revealLetterSlot,
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
import { ACTION_CARDS, TRAINING_DIFFICULTIES, TRAINING_DIFFICULTY_PRESETS } from "../../core/constants.js";
import { findHints } from "../../core/hintSolver.js";
import { validateWord as validateWordLayered } from "../../core/wordValidator.js";
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

// Module-level state
let creationTimeupTimer = null;
let creationTimeupCancelled = false;
let dealerFocusTimer = null;
let actionsDriverTimeout = null;
let actionsDriverBusy = false;
let focusedActionIndex = null;
let lastActionTapIndex = null;
let lastActionTapTime = 0;
const DOUBLE_TAP_MS = 400;
let currentActionBubble = null;
let bubbleAutoHideTimeout = null;
const BUBBLE_AUTOHIDE_MS = 2800;
let trainingTimerInterval = null;
let trainingClockPhase = null;
let debugMode = false;
let lastFlashedPhase = null;
let userTurnTimerInterval = null;
let userTurnRemainingMs = 0;
let attackBannerTimeout = null;

const USER_TURN_DURATION_MS = 10000;
const LOW_TIME_THRESHOLD = 10;
const PICKER_TIMEOUT_MS = 7000;
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

// Hint button visibility:
//   - PRACTICAR (words): hidden during creation phase, auto-reveals after
//     PRACTICE_HINT_DELAY_MS of idle thinking (no validation submitted yet).
//   - Other modes: hidden until the user long-presses the phase pill.
const PRACTICE_HINT_DELAY_MS = 46_000;
let hintRevealedByLongPress = false;
let practiceHintTimer = null;
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
  const state = createTrainingMatch(difficulty, { userNickname: nickname });
  logger.info("Training match created", { matchId: state.matchId, difficulty });
  lastFlashedPhase = null;
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
  }

  _shell.setI18nById("trainingMatchTitle", `trainingDifficulty${capitalizeStr(state.difficulty)}`);
  _shell.setI18nById("trainingBoardLabel", "trainingBoardLabel");
  _shell.setI18nById("trainingHandLabel", "trainingHandLabel");
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
  document.getElementById("trainingValidateWrap")?.classList.toggle("hidden", isResultOrDone || !(state.phase === "creation" && state.untimedCreation));
  updateHintButtonVisibility();
  if (state.phase === "strategy" || state.phase === "creation") {
    ensureTrainingTimer();
  } else {
    stopTrainingTimer();
  }
  const userId = state.players[0].id;
  const isUserTurn = state.actionsQueue?.[0] === userId && state.userActionIndex == null;
  if (state.phase === "actions" && (state.actionsQueue?.length ?? 0) > 0 && !isUserTurn
      && !actionsDriverBusy && !actionsDriverTimeout) {
    scheduleActionsDriver();
  }
  if (state.phase !== "strategy" && focusedActionIndex != null) { focusedActionIndex = null; lastActionTapIndex = null; }
  if (state.phase !== "actions") clearActionBanner();
  maybeStartUserTurnTimer(state);
  maybeShowPhaseFlash(state);
  if (state.phase === "creation") {
    // Safety net: if the user reached creation with an empty hand somehow,
    // give them an emergency letter (manual rule).
    maybeOfferEmergencyDraw();
  }
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

  if (state.phase === "dealing") {
    key = "trainingInstrDealing";
    promptKind = "is-action-required";
  } else if (state.phase === "strategy") {
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
      && state.userActionIndex == null
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

// Phase-transition flash banner. Triggered when entering strategy or creation.
function maybeShowPhaseFlash(state) {
  const phase = state.phase;
  if (phase === lastFlashedPhase) return;
  if (phase === "strategy" || phase === "creation") {
    const flash = document.getElementById("trainingPhaseFlash");
    if (!flash) {
      lastFlashedPhase = phase;
      return;
    }
    const key = `trainingPhase${capitalizeStr(phase)}`;
    flash.textContent = t(key) || phase.toUpperCase();
    flash.classList.remove("hidden");
    flash.style.animation = "none";
    void flash.offsetWidth;
    flash.style.animation = "";
    clearTimeout(flash._hideTimer);
    flash._hideTimer = setTimeout(() => {
      flash.classList.add("hidden");
    }, 1200);
  }
  lastFlashedPhase = phase;
}

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
    ? (currentActionBubble?.playerId ?? null)
    : null;

  for (const p of state.players) {
    const hand = state.hands?.[p.id];
    const letters = hand && hand !== "<hidden>" ? (hand.letters ?? []).filter(Boolean) : [];
    const hasShield = p.isGhost
      ? (state.shieldedPlayers ?? []).includes(p.id)
      : isUserShieldPreSelected(state);
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
      if (i < letters.length) dot.className = letters[i].kind === "vowel" ? "is-vowel" : "is-consonant";
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
  const isCreation = state.phase === "creation";
  const wordIds = new Set((state.userWord ?? []).map((s) => s.cardId));
  const requiredCardIds = collectRequiredCardIds(state);
  for (const card of slots) {
    const el = renderLetterCard(card);
    if (card && requiredCardIds.has(card.id)) {
      el.classList.add("is-required-letter");
    }
    if (card && isCreation) attachCardSelectableBehavior(el, card, "board", wordIds.has(card.id));
    root.appendChild(el);
  }
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
  if (unique.length <= 1) return unique[0] || "?";
  const conj = getShellLanguage() === "en" ? " and " : " y ";
  return unique.slice(0, -1).join(", ") + conj + unique.at(-1);
}

function renderTrainingHand(state) {
  const root = document.getElementById("trainingHand");
  if (!root) return;
  root.innerHTML = "";
  const userId = state.players[0].id;
  const userHand = state.hands[userId];
  const letters = userHand && userHand !== "<hidden>" ? userHand.letters : [null, null, null];
  const actions = userHand && userHand !== "<hidden>" ? userHand.actions : [null, null];
  const isDealing = state.phase === "dealing";
  const isCreation = state.phase === "creation";
  const isStrategy = state.phase === "strategy";
  const isUserTurn = state.phase === "actions"
    && (state.actionsQueue?.[0] === userId)
    && state.userActionIndex == null;
  const tappable = isStrategy || (isUserTurn && !isUserTurnBlockedByActionBubble(state));
  const wordIds = new Set((state.userWord ?? []).map((s) => s.cardId));
  letters.forEach((card, idx) => {
    if (!card && isDealing) {
      root.appendChild(renderDealPickerCard(idx));
    } else {
      const el = renderLetterCard(card, { faceDown: isDealing });
      if (card && isCreation) attachCardSelectableBehavior(el, card, "hand", wordIds.has(card.id));
      root.appendChild(el);
    }
  });
  if (!isCreation && state.phase !== "result" && state.phase !== "done") {
    actions.forEach((card, idx) => {
      const isFocused = isStrategy && focusedActionIndex === idx;
      const clickHandler = tappable && card ? () => {
        if (isStrategy) {
          const now = Date.now();
          const isDoubleTap = lastActionTapIndex === idx && (now - lastActionTapTime) < DOUBLE_TAP_MS;
          lastActionTapIndex = idx;
          lastActionTapTime = now;
          if (isDoubleTap) {
            focusedActionIndex = null;
            lastActionTapIndex = null;
            handleUserPickAction(idx);
          } else {
            focusedActionIndex = focusedActionIndex === idx ? null : idx;
            renderTrainingMatch();
          }
        } else {
          handleUserPickAction(idx);
        }
      } : null;
      const hasFocus = isStrategy && focusedActionIndex != null;
      const cardEl = renderActionCard(card, {
        selectable: tappable && !!card,
        selected: false,
        focused: isFocused,
        dimmed: hasFocus && !isFocused,
        faceDown: isDealing,
        onClick: clickHandler,
      });
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
  playBtn.textContent = "Jugar esta carta";
  playBtn.onclick = () => {
    handleUserPickAction(focusedActionIndex);
    focusedActionIndex = null;
  };
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
  if (card.isWildcard) {
    openTrainingPicker({
      titleKey: "trainingPickWildcardTitle",
      options: wildcardLetterOptions(card),
      onPick: (letter) => {
        addToWord(state, card.id, source, { chosenLetter: letter });
        renderTrainingMatch();
      },
    });
    return;
  }
  if (card.tildeValue != null) {
    // Tilde-capable: ask whether to use it with or without tilde.
    openTildeChoice(card, (withTilde) => {
      addToWord(state, card.id, source, { tilde: withTilde });
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
  if (!visible) return;
  _shell.setI18nById("trainingWordStripLabel", "trainingWordStripLabel");
  cardsRoot.innerHTML = "";
  const word = state.userWord ?? [];
  if (word.length === 0) {
    const empty = document.createElement("div");
    empty.className = "training-word-strip-empty";
    empty.textContent = t("trainingWordStripEmpty") || "";
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
    wrapper.addEventListener("pointerdown", handleWordSlotPointerDown);

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
    cardEl.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (suppressNextWordSlotClick) return;
      handleWordSlotTap(slot.cardId);
    });
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
  document.querySelectorAll(".training-word-slot.is-drop-target")
    .forEach((el) => el.classList.remove("is-drop-target"));
  const target = findWordSlotAt(ev.clientX, ev.clientY);
  if (target && target !== wordDragState.wrapper) {
    target.classList.add("is-drop-target");
  }
  // Prevent the page from scrolling under the finger.
  ev.preventDefault();
}

function handleWordSlotPointerUp(ev) {
  if (!wordDragState || wordDragState.pointerId !== ev.pointerId) return;
  const orig = wordDragState.wrapper;
  const wasDragging = wordDragState.dragging;
  let didReorder = false;

  if (wasDragging) {
    const target = findWordSlotAt(ev.clientX, ev.clientY);
    if (target && target !== orig) {
      const toIdx = Number(target.dataset.index);
      const state = getTrainingMatch();
      if (state && !Number.isNaN(toIdx) && toIdx !== wordDragState.fromIndex) {
        reorderWord(state, wordDragState.fromIndex, toIdx);
        didReorder = true;
      }
    }
  }

  document.querySelectorAll(".training-word-slot.is-drop-target")
    .forEach((el) => el.classList.remove("is-drop-target"));
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
  if (didReorder) renderTrainingMatch();
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

function renderDealPickerCard(slotIndex) {
  const el = document.createElement("div");
  el.className = "tcard is-deal-picker";
  const vowelBtn = document.createElement("button");
  vowelBtn.type = "button";
  vowelBtn.className = "tcard-pick-half tcard-pick-vowel";
  vowelBtn.textContent = "V";
  vowelBtn.setAttribute("aria-label", "vocal");
  vowelBtn.addEventListener("click", () => handleDealPick(slotIndex, "vowel"));
  const consonantBtn = document.createElement("button");
  consonantBtn.type = "button";
  consonantBtn.className = "tcard-pick-half tcard-pick-consonant";
  consonantBtn.textContent = "C";
  consonantBtn.setAttribute("aria-label", "consonant");
  consonantBtn.addEventListener("click", () => handleDealPick(slotIndex, "consonant"));
  el.append(vowelBtn, consonantBtn);
  return el;
}

function handleDealPick(slotIndex, kind) {
  _shell.playClickFeedback();
  const state = getTrainingMatch();
  if (!state || state.phase !== "dealing") return;
  revealLetterSlot(state, slotIndex, kind);
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
    card.classList.toggle("time-pressure", running && s <= LOW_TIME_THRESHOLD && s > 5);
    card.classList.toggle("time-pressure-urgent", running && s <= 5 && s > 0);
    card.classList.toggle("timeup", running && s === 0);
  }
}

function renderTrainingResult(state) {
  const panel = document.getElementById("trainingResultPanel");
  if (!panel) return;
  const isResult = state.phase === "result";
  const isDone   = state.phase === "done";
  if (!isResult && !isDone) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
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

  const actionsDiv = document.createElement("div");
  actionsDiv.className = "training-result-actions";
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "training-result-btn";
  nextBtn.textContent = t("trainingNextBaza") || "Siguiente baza";
  nextBtn.addEventListener("click", handleNextBaza);
  actionsDiv.appendChild(nextBtn);
  panel.appendChild(actionsDiv);
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

  // Title
  const title = document.createElement("div");
  title.className = "training-result-done-title";
  title.textContent = t("trainingMatchDoneTitle") || "¡Fin del entrenamiento!";
  panel.appendChild(title);

  // Win / lose / draw badge
  const userId = state.players[0].id;
  const userScore = state.players[0].score ?? 0;
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
  table.className = "training-result-table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["#", t("trainingResultTotal") || "Total"].forEach((text, i) => {
    const th = document.createElement("th");
    th.textContent = text;
    if (i === 1) th.className = "col-total";
    else th.style.width = "24px";
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  let rank = 1;
  sorted.forEach((p, idx) => {
    if (idx > 0 && (sorted[idx - 1].score ?? 0) > (p.score ?? 0)) rank = idx + 1;
    const tr = document.createElement("tr");
    if (!p.isGhost) tr.classList.add("is-user");
    const rankTd = document.createElement("td");
    rankTd.textContent = String(rank);
    rankTd.style.color = rank === 1 ? "#ffe566" : "rgba(255,255,255,0.5)";
    rankTd.style.width = "24px";
    const nameTd = document.createElement("td");
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
  playAgainBtn.className = "training-result-btn is-play-again";
  playAgainBtn.textContent = t("trainingMatchPlayAgain") || "Jugar otra";
  playAgainBtn.addEventListener("click", handleTrainingPlayAgain);
  actionsDiv.appendChild(playAgainBtn);
  panel.appendChild(actionsDiv);
}

function handleNextBaza() {
  _shell.playClickFeedback();
  const state = getTrainingMatch();
  if (!state || state.phase !== "result") return;
  advanceToNextBaza(state);
  lastFlashedPhase = null; // allow phase flash for new baza
  renderTrainingMatch();
}

function handleTrainingPlayAgain() {
  _shell.playClickFeedback();
  trainingClockPhase = null;
  _shell.stopClockLoop(false);
  clearTrainingMatch();
  _shell.showScreen("training-setup");
}

function exitTrainingMatch() {
  stopTrainingTimer();
  stopActionsDriver();
  stopUserTurnTimer();
  trainingClockPhase = null;
  _shell.stopClockLoop(false);
  clearTrainingMatch();
  _shell.showScreen("training-setup");
}

function finishTrainingTimer() {
  _shell.playClickFeedback();
  const state = getTrainingMatch();
  if (!state) return;
  if (state.phase === "strategy") {
    stopTrainingTimer();
    trainingClockPhase = null;
    _shell.stopClockLoop(false);
    enterActionsPhase(state);
    renderTrainingMatch();
    return;
  }
  if (state.phase === "creation") {
    stopTrainingTimer();
    trainingClockPhase = null;
    _shell.stopClockLoop(false);
    const finalized = finalizeUserWord(state, getShellLanguage());
    renderTrainingMatch();
    if (finalized.userWordResult?.valid && finalized.userWordResult?.word) {
      validateAndUpdateUserWord(finalized);
    }
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
  const language = getShellLanguage();
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
      layers: ["local", "ai"],
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
// Walks the actionsQueue, resolving one player per ~600ms tick. Ghost turns
// auto-resolve; user turn pauses and waits for input. ESCUDO interrupt may
// pop a modal mid-resolution.

function stopActionsDriver() {
  if (actionsDriverTimeout) {
    clearTimeout(actionsDriverTimeout);
    actionsDriverTimeout = null;
  }
  actionsDriverBusy = false;
}

function scheduleActionsDriver(delay = 1800) {
  stopActionsDriver();
  actionsDriverTimeout = setTimeout(processNextActionsTurn, delay);
}

function processNextActionsTurn() {
  actionsDriverTimeout = null;
  if (actionsDriverBusy) return;
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
      scheduleActionsDriver(250);
      return;
    }
    if (state.userActionResolved) {
      // Already resolved (shield interrupt or pre-played). Skip turn.
      const next = advanceActionsQueue(state);
      renderTrainingMatch();
      if (next.phase === "actions") scheduleActionsDriver();
      return;
    }
    if (state.userActionIndex != null && !debugMode) {
      // Pre-selected during strategy: play it now. If it needs a target or
      // a board letter, ask the user at this moment (not when they picked
      // the card during strategy).
      const userHand = state.hands[userId];
      const card = userHand !== "<hidden>" ? userHand?.actions?.[state.userActionIndex] : null;
      if (!card) {
        renderTrainingMatch();
        return;
      }
      // Shield pre-selected but no ghost attack arrived — discard and pass.
      if (card.actionId === "shield_total") {
        const allActions = (userHand?.actions ?? []).filter(Boolean);
        let s = { ...state,
          hands: { ...state.hands, [userId]: { ...userHand, actions: [] } },
          discards: { ...state.discards, actions: [...state.discards.actions, ...allActions] },
          userActionResolved: true,
        };
        saveTrainingMatch(s);
        s = advanceActionsQueue(s);
        renderTrainingMatch();
        if (s.phase === "actions") scheduleActionsDriver();
        return;
      }
      actionsDriverBusy = true;
      pickTargetAndPayloadForUser(state, card, (targetId, payload) => {
        actionsDriverBusy = false;
        let s = playUserAction(getTrainingMatch(), state.userActionIndex, targetId, payload);
        showActionToast(s, {
          playerId: userId,
          actionId: card.actionId,
          targetId,
          payload,
        });
        s = advanceActionsQueue(s);
        renderTrainingMatch();
        if (s.phase === "actions") scheduleActionsDriver();
      });
      return;
    }
    // Debug: bypass hand and let user pick any action card
    if (debugMode) {
      const mvpCards = ACTION_CARDS.filter((c) => c.inMVP);
      actionsDriverBusy = true;
      openTrainingPicker({
        titleKey: null,
        context: { label: "🐛 Tú juegas:", kind: "self" },
        options: mvpCards.map((c) => ({ id: c.id, label: humanActionName(c.id) })),
        onPick: (actionId) => {
          actionsDriverBusy = false;
          const cardDef = ACTION_CARDS.find((c) => c.id === actionId);
          const fakeCard = { id: "debug-card", type: "action", ...cardDef, actionId: cardDef.id };
          stopUserTurnTimer();
          pickTargetAndPayloadForUser(state, fakeCard, (targetId, payload) => {
            const fakeLog = { playerId: userId, actionId, targetId, payload };
            let s = applyPlannedGhostAction(getTrainingMatch(), fakeLog);
            showActionToast(s, fakeLog);
            // Clear user action hand (applyPlannedGhostAction skips this unlike playUserAction)
            const userH = s.hands[userId];
            if (userH) {
              const actionCards = (userH.actions ?? []).filter(Boolean);
              s = { ...s,
                hands: { ...s.hands, [userId]: { ...userH, actions: [] } },
                discards: { ...s.discards, actions: [...s.discards.actions, ...actionCards] },
              };
            }
            s = { ...s, userActionResolved: true };
            saveTrainingMatch(s);
            s = advanceActionsQueue(s);
            renderTrainingMatch();
            if (s.phase === "actions") scheduleActionsDriver();
          });
        },
      });
      return;
    }
    // Wait for user input (renderTrainingActions made action cards tappable).
    renderTrainingMatch();
    return;
  }

  // Debug mode: let user choose which card the ghost plays
  if (debugMode) {
    const ghostName = state.players.find((p) => p.id === nextActorId)?.name || nextActorId;
    const mvpCards = ACTION_CARDS.filter((c) => c.inMVP);
    actionsDriverBusy = true;
    openTrainingPicker({
      titleKey: null,
      context: { label: `🐛 ${ghostName} juega:`, kind: "forced" },
      options: mvpCards.map((c) => ({ id: c.id, label: humanActionName(c.id) })),
      onPick: (actionId) => {
        const cardDef = ACTION_CARDS.find((c) => c.id === actionId);
        const fakeCard = { id: "debug-ghost-card", type: "action", ...cardDef, actionId: cardDef.id };

        function applyDebugGhost(targetId, payload = {}) {
          actionsDriverBusy = false;
          const fakeLog = { playerId: nextActorId, actionId, targetId, payload };
          const isAtk = isAttackOnUser(cardDef, targetId, userId);
          if (isAtk && userHasShield(state) && !isUserShieldPreSelected(state)) {
            actionsDriverBusy = true;
            promptShield({ source: nextActorId, card: cardDef }, fakeLog);
          } else {
            let s = applyPlannedGhostAction(state, fakeLog);
            showActionToast(s, fakeLog);
            s = advanceActionsQueue(s);
            renderTrainingMatch();
            if (maybeOfferEmergencyDraw(() => {
              const cur = getTrainingMatch();
              if (cur?.phase === "actions") scheduleActionsDriver();
            })) return;
            if (s.phase === "actions") scheduleActionsDriver();
          }
        }

        pickTargetAndPayloadForUser(state, fakeCard, (targetId, payload) => {
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
    scheduleActionsDriver();
    return;
  }

  saveTrainingMatch(planned.state);

  // Auto-shield: user pre-selected ESCUDO TOTAL during strategy and a
  // ghost just attacked. Block automatically without prompting.
  if (planned.autoShield) {
    let s = useShieldOnAttack(planned.state, planned.autoShield.source);
    s = applyPlannedGhostAction(s, planned.log, { shielded: true });
    showActionToast(s, planned.log, { blocked: true });
    s = advanceActionsQueue(s);
    renderTrainingMatch();
    if (s.phase === "actions") scheduleActionsDriver();
    return;
  }

  // discard_one targeting user → user picks which card to discard
  if (planned.log.actionId === "discard_one" && planned.log.targetId === userId) {
    actionsDriverBusy = true;
    promptDiscardOne(planned.state, planned.log);
    return;
  }

  if (planned.shieldOpportunity) {
    actionsDriverBusy = true;
    promptShield(planned.shieldOpportunity, planned.log);
    return;
  }

  // No shield prompt: apply and advance.
  let s = applyPlannedGhostAction(planned.state, planned.log);
  showActionToast(s, planned.log);
  s = advanceActionsQueue(s);
  renderTrainingMatch();
  if (maybeOfferEmergencyDraw(() => {
    const cur = getTrainingMatch();
    if (cur?.phase === "actions") scheduleActionsDriver();
  })) return;
  if (s.phase === "actions") scheduleActionsDriver();
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
      actionsDriverBusy = false;
      if (choice === "use") {
        let s = getTrainingMatch();
        s = useShieldOnAttack(s, opportunity.source);
        s = applyPlannedGhostAction(s, log, { shielded: true });
        showActionToast(s, log, { blocked: true });
        s = advanceActionsQueue(s);
        renderTrainingMatch();
        if (s.phase === "actions") scheduleActionsDriver();
      } else {
        let s = getTrainingMatch();
        s = applyPlannedGhostAction(s, log);
        showActionToast(s, log);
        s = advanceActionsQueue(s);
        renderTrainingMatch();
        if (maybeOfferEmergencyDraw(() => {
          const cur = getTrainingMatch();
          if (cur?.phase === "actions") scheduleActionsDriver();
        })) return;
        if (s.phase === "actions") scheduleActionsDriver();
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
    actionsDriverBusy = false;
    let s = advanceActionsQueue(state);
    renderTrainingMatch();
    if (s.phase === "actions") scheduleActionsDriver();
    return;
  }
  const attackerName = attacker?.name || log.playerId;
  openTrainingPicker({
    titleKey: "trainingDiscardOneTitle",
    context: { label: `⚡ ${attackerName}: Deshazte de una`, kind: "forced" },
    options: letters.map((c) => ({ id: c.id, label: c.letter })),
    timeoutMs: PICKER_TIMEOUT_MS,
    onPick: (cardId) => {
      actionsDriverBusy = false;
      let s = applyPlannedGhostAction(state, { ...log, payload: { cardId } });
      showActionToast(s, log);
      s = advanceActionsQueue(s);
      renderTrainingMatch();
      if (maybeOfferEmergencyDraw(() => {
        const cur = getTrainingMatch();
        if (cur?.phase === "actions") scheduleActionsDriver();
      })) return;
      if (s.phase === "actions") scheduleActionsDriver();
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
  actionsDriverBusy = true;
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
      actionsDriverBusy = false;
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
    && state.userActionIndex == null
    && !state.userActionResolved
    && !isUserTurnBlockedByActionBubble(state);
  if (isUserTurn) {
    if (!userTurnTimerInterval) startUserTurnTimer();
  } else {
    stopUserTurnTimer();
  }
}

function isUserTurnBlockedByActionBubble(state) {
  if (!state || state.phase !== "actions" || !currentActionBubble) return false;
  const userId = state.players?.[0]?.id;
  return !!userId
    && state.actionsQueue?.[0] === userId
    && currentActionBubble.playerId !== userId;
}

function autoPickUserAction() {
  if (actionsDriverBusy) return;
  const state = getTrainingMatch();
  if (!state || state.phase !== "actions") return;
  const userId = state.players[0].id;
  if (state.actionsQueue?.[0] !== userId) return;
  if (state.userActionIndex != null || state.userActionResolved) return;
  const hand = state.hands[userId];
  if (!hand || hand === "<hidden>") return;
  const firstIdx = hand.actions.findIndex((c) => c != null);
  if (firstIdx < 0) return;
  const card = hand.actions[firstIdx];

  // Pick random target/payload as ghosts do when the action requires one.
  let targetId = null;
  let payload = {};
  if (card.target === "one") {
    const candidates = state.players.filter((p) => p.id !== userId);
    if (candidates.length > 0) {
      targetId = candidates[Math.floor(Math.random() * candidates.length)].id;
    }
  }
  if (["use_vowel", "use_consonant", "use_letter"].includes(card.actionId)) {
    const letters = (state.centralBoard ?? []).filter((c) => {
      if (card.actionId === "use_vowel") return c.kind === "vowel";
      if (card.actionId === "use_consonant") return c.kind === "consonant";
      return true;
    });
    if (letters.length > 0) {
      const picked = letters[Math.floor(Math.random() * letters.length)];
      payload = { letter: picked.letter, cardId: picked.id };
    }
  }

  let s = playUserAction(state, firstIdx, targetId, payload);
  showActionToast(s, { playerId: userId, actionId: card.actionId, targetId, payload });
  s = advanceActionsQueue(s);
  renderTrainingMatch();
  if (s.phase === "actions") scheduleActionsDriver();
}

// ── User action selection ──────────────────────────────────
// Strategy phase: pre-commit, close timer, enter actions phase. The action
// auto-plays when the user's turn arrives (unless interrupted by ESCUDO).
// Actions phase (user's turn): play immediately and advance the queue.
function handleUserPickAction(actionIndex) {
  _shell.playClickFeedback();
  const state = getTrainingMatch();
  if (!state) return;
  const userId = state.players[0].id;
  const card = state.hands[userId]?.actions?.[actionIndex];
  if (!card) return;

  if (state.phase === "strategy") {
    // No target/payload picker here — that's resolved at the user's actual
    // turn in the actions phase. The other action card is discarded.
    stopTrainingTimer();
    const after = selectActionInStrategy(state, actionIndex);
    renderTrainingMatch();
    if (after.phase === "actions") scheduleActionsDriver();
    return;
  }

  if (state.phase === "actions" && state.actionsQueue?.[0] === userId && state.userActionIndex == null) {
    stopUserTurnTimer();
    actionsDriverBusy = true;
    pickTargetAndPayloadForUser(state, card, (targetId, payload) => {
      actionsDriverBusy = false;
      let s = playUserAction(getTrainingMatch(), actionIndex, targetId, payload);
      showActionToast(s, { playerId: userId, actionId: card.actionId, targetId, payload });
      s = advanceActionsQueue(s);
      renderTrainingMatch();
      if (s.phase === "actions") scheduleActionsDriver();
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
    btn.className = "training-picker-option";
    btn.textContent = l.letter;
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

  function dismiss(kind) {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (document.body.contains(overlay)) document.body.removeChild(overlay);
    onPick(kind);
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
        dismiss(backs[0].kind);
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
    btn.addEventListener("click", () => dismiss(b.kind));
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
  return letters.map((c) => ({ kind: c.kind }));
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
      onPick: (kind) => {
        picks.push({ playerId: victim.id, kind });
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
  // Filter out shielded players from attack candidate lists
  const unshielded = (players) => players.filter((p) => !playerHasShield(state, p.id));

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
          onPick: (targetKind) => done(targetId, { targetKind }),
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
          onPick: (targetKind) => done(targetId, { targetKind }),
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
      done(null, { picks });
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
        const letterChar = letters.find((l) => l.id === cId)?.letter || "?";
        openTrainingPicker({
          titleKey: "trainingPickKindTitle",
          context: selfCtx,
          subtitle: letterChar,
          options: [
            { id: "vowel",     label: t("trainingEmergencyDrawVowel")     || "Vocal"       },
            { id: "consonant", label: t("trainingEmergencyDrawConsonant") || "Consonante"  },
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

  // swap_all: pick target then pick which of ACTOR's own letters to give
  if (card.actionId === "swap_all") {
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
        if (letters.length === 0) { done(targetId, { fromIds: [] }); return; }
        openChangeCardsPicker(letters, "trainingSwapAllPickTitle", (fromIds) => {
          done(targetId, { fromIds });
        }, attackCtx);
      },
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
              onPick: (targetKind) => done(targetId, { fromId, targetKind }),
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
    if (letters.length === 0) { done(null, {}); return; }
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
// Pass subtitle (string) to render a body line below the title.
function openTrainingPicker({ titleKey, subtitle, context, options, onPick, timeoutMs = 0 }) {
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
  for (const opt of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "training-picker-option";
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

function triggerAttackBanner(attackerName, actionName) {
  const banner = document.getElementById("trainingAttackBanner");
  if (!banner) return;
  if (attackBannerTimeout) { clearTimeout(attackBannerTimeout); attackBannerTimeout = null; }
  banner.textContent = `⚠ ${attackerName}: ${actionName}`;
  banner.classList.remove("hidden", "is-hiding");
  banner.classList.add("is-visible");
  // Add shake to user pill
  const userPill = document.querySelector(".training-score-pill.is-user");
  if (userPill) {
    userPill.classList.remove("is-under-attack");
    void userPill.offsetWidth; // force reflow to restart animation
    userPill.classList.add("is-under-attack");
    setTimeout(() => userPill.classList.remove("is-under-attack"), 700);
  }
  attackBannerTimeout = setTimeout(() => {
    banner.classList.add("is-hiding");
    setTimeout(() => {
      banner.classList.add("hidden");
      banner.classList.remove("is-visible", "is-hiding");
    }, 300);
    attackBannerTimeout = null;
  }, 3000);
}

function showActionToast(state, log, opts = {}) {
  if (!log) return;
  if (bubbleAutoHideTimeout) clearTimeout(bubbleAutoHideTimeout);
  const userId = state?.players?.[0]?.id;
  const ALL_TARGET_ATTACK_IDS = new Set(["out_one", "great_heist", "swap_all", "two_to_center"]);
  let isAttackTarget = false;
  if (userId && log.playerId !== userId && !opts.blocked) {
    isAttackTarget = log.targetId === userId || ALL_TARGET_ATTACK_IDS.has(log.actionId);
  }
  currentActionBubble = {
    playerId: log.playerId,
    text: humanActionName(log.actionId),
    blocked: !!opts.blocked,
    isAttackOnUser: isAttackTarget,
    isNew: true,
  };
  if (isAttackTarget) {
    const attacker = (state.players ?? []).find((p) => p.id === log.playerId);
    triggerAttackBanner(attacker?.name || log.playerId, humanActionName(log.actionId));
  }
  attachActionBubble();
  bubbleAutoHideTimeout = setTimeout(() => {
    clearActionBanner();
  }, BUBBLE_AUTOHIDE_MS);
}

function clearActionBanner() {
  if (bubbleAutoHideTimeout) {
    clearTimeout(bubbleAutoHideTimeout);
    bubbleAutoHideTimeout = null;
  }
  currentActionBubble = null;
  document.querySelectorAll(".training-action-bubble").forEach((el) => el.remove());
}

function attachActionBubble() {
  const existing = document.querySelector(".training-action-bubble");
  if (!currentActionBubble) {
    if (existing) existing.remove();
    return;
  }
  const targetPill = document.querySelector(
    `.training-score-pill[data-player-id="${currentActionBubble.playerId}"]`,
  );
  if (!targetPill) {
    if (existing) existing.remove();
    return;
  }
  const expectedKey =
    `${currentActionBubble.playerId}|${currentActionBubble.text}|${currentActionBubble.blocked ? 1 : 0}|${currentActionBubble.isAttackOnUser ? 1 : 0}`;
  // Already on the right pill with the right content → leave it (no flicker).
  if (existing && existing.parentElement === targetPill && existing.dataset.key === expectedKey) {
    return;
  }
  if (existing) existing.remove();
  const bubble = document.createElement("div");
  bubble.className = "training-action-bubble"
    + (currentActionBubble.blocked ? " is-blocked" : "")
    + (currentActionBubble.isAttackOnUser && !currentActionBubble.blocked ? " is-attack" : "");
  bubble.dataset.key = expectedKey;
  bubble.textContent = (currentActionBubble.blocked ? "🛡 " : "") + currentActionBubble.text;
  if (!currentActionBubble.isNew) {
    bubble.style.animation = "none";
  }
  currentActionBubble.isNew = false;
  targetPill.appendChild(bubble);
}

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
    } else {
      // Creation phase: tick; if timer ran out, finalize the word with
      // validation/score and transition to result.
      next = tickCreationTimer(current);
      if (current.phase === "creation" && next.phase === "result") {
        next = finalizeUserWord(current, getShellLanguage());
        if (next.userWordResult?.valid && next.userWordResult?.word) {
          // Fire-and-forget; updates UI when the dictionary verdict returns.
          validateAndUpdateUserWord(next);
        }
      }
    }
    if (next.phase !== current.phase) {
      trainingClockPhase = null;
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
  stopActionsDriver();
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

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Buscando…";
  }
  body.innerHTML = '<div class="hint-empty">Buscando…</div>';
  openModal("hints", { closable: true });

  let hints = [];
  const t0 = performance.now();
  try {
    hints = await findHints(state, { count: 5, difficulty: solverDiff });
  } catch (err) {
    logger.warn("[hints] solver failed", err);
  }
  const elapsed = Math.round(performance.now() - t0);

  if (btn) {
    btn.disabled = false;
    btn.textContent = "💡 Sugerir";
  }

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
  return `<li><span class="hint-word">${letters}</span><span class="hint-score">${hint.score}</span></li>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
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
};

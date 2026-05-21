// Training match controller. Owns the lifecycle of a single training match:
// initial state from a difficulty preset, persistence, phase transitions.
//
// State is persisted to stateStore.training.active so the match survives
// page reloads (same approach as scoreboard matchState).

import {
  TRAINING_DIFFICULTY_PRESETS,
  TRAINING_HAND_LETTERS,
  TRAINING_HAND_ACTIONS,
  MATCH_TYPE_TRAINING,
} from "./constants.js";
import {
  buildInitialDecks,
  dealCentralBoard,
  drawActions,
  drawLetterOfKind,
} from "./trainingDeck.js";
import { applyActionEffect } from "./actionEffects.js";
import {
  generateGhostScore,
  pickRandomTarget,
  pickRandomBoardCardId,
  pickGhostActionIndex,
} from "./ghostScores.js";
import { loadState, updateState } from "./stateStore.js";

// Action ids that count as "attacks" blockable by ESCUDO TOTAL.
// USE_VOWEL/CONSONANT/ANY_SAY are global rules and NOT blockable.
const SHIELDABLE_ATTACK_IDS = new Set([
  "steal_letter", "explosion", "out_one", "great_heist",
  "swap_all", "swap_one", "discard_one", "two_to_center",
  "philologist", "brain_squeeze",
]);

export function isAttackOnUser(action, targetId, userId) {
  if (!action || !SHIELDABLE_ATTACK_IDS.has(action.actionId)) return false;
  if (action.target === "all") return true; // affects everyone including user
  return targetId === userId;
}

export function userHasShield(state) {
  const userId = state.players[0].id;
  const hand = state.hands[userId];
  if (!hand || hand === "<hidden>") return false;
  return hand.actions.some((a) => a && a.actionId === "shield_total");
}

function makeId() {
  return `tm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function buildPlayers(opponents, userNickname) {
  // Player ids: p1 = user, p2..pN = ghosts. Names: configurable later.
  const players = [
    { id: "p1", name: userNickname || "Tú", score: 0, rounds: [], isGhost: false },
  ];
  for (let i = 0; i < opponents; i += 1) {
    players.push({
      id: `p${i + 2}`,
      name: `Op${i + 1}`,
      score: 0,
      rounds: [],
      isGhost: true,
    });
  }
  return players;
}

function buildEmptyHands(players) {
  const hands = {};
  for (const p of players) {
    hands[p.id] = p.isGhost
      ? "<hidden>"
      : {
          // 3 empty letter slots; user picks vowel/consonant per slot during deal.
          letters: Array.from({ length: TRAINING_HAND_LETTERS }, () => null),
          actions: Array.from({ length: TRAINING_HAND_ACTIONS }, () => null),
        };
  }
  return hands;
}

export function createTrainingMatch(difficulty, { userNickname } = {}) {
  const preset = TRAINING_DIFFICULTY_PRESETS[difficulty];
  if (!preset) throw new Error(`Unknown difficulty: ${difficulty}`);

  const players = buildPlayers(preset.opponents, userNickname);
  const decksAndDiscards = buildInitialDecks();

  const state = {
    matchType: MATCH_TYPE_TRAINING,
    matchId: makeId(),
    difficulty,
    ghostLevel: preset.ghostLevel,
    strategySeconds: preset.strategySeconds,
    creationSeconds: preset.creationSeconds,
    roundsTarget: preset.roundsTarget,
    round: 1,
    phase: "dealing", // dealing | strategy | actions | creation | result | done
    remaining: preset.strategySeconds,
    players,
    centralBoard: [], // dealt at start of each trick
    hands: buildEmptyHands(players),
    dealerId: "p1",
    decks: {
      vowelDeck: decksAndDiscards.vowelDeck,
      consonantDeck: decksAndDiscards.consonantDeck,
      actionDeck: decksAndDiscards.actionDeck,
    },
    discards: decksAndDiscards.discards,
    trickActions: [],
    pendingEffectsOnUser: [],
    forcedRules: {},
    scoreModifiers: {},
    userWord: [],
    matchOver: false,
    winnerIds: [],
    updatedAt: Date.now(),
  };

  saveTrainingMatch(state);
  return state;
}

export function getTrainingMatch() {
  return loadState().training?.active ?? null;
}

export function saveTrainingMatch(state) {
  if (!state) return;
  updateState({ training: { active: { ...state, updatedAt: Date.now() } } });
}

export function clearTrainingMatch() {
  updateState({ training: { active: null } });
}

// Deal central board (5 cards) and action hand (2 cards) at the start of a
// trick. Letter slots stay empty — the user fills them by tapping V/C.
// Idempotent: only deals if the round hasn't been initialized yet.
export function initializeRound(state) {
  if (state.centralBoard.length > 0) return state; // already dealt

  // Board
  const boardResult = dealCentralBoard(
    state.decks.vowelDeck,
    state.decks.consonantDeck,
    state.discards,
  );

  // Actions for the user
  const actionsResult = drawActions(
    state.decks.actionDeck,
    state.discards.actions,
    TRAINING_HAND_ACTIONS,
  );

  const userId = state.players[0].id;
  const userHand = state.hands[userId];
  const newHands = {
    ...state.hands,
    [userId]: {
      letters: Array.from({ length: TRAINING_HAND_LETTERS }, () => null),
      actions: actionsResult.drawn,
    },
  };

  const next = {
    ...state,
    centralBoard: boardResult.board,
    decks: {
      vowelDeck: boardResult.vowelDeck,
      consonantDeck: boardResult.consonantDeck,
      actionDeck: actionsResult.deck,
    },
    discards: {
      ...boardResult.discards,
      actions: actionsResult.discard,
    },
    hands: newHands,
    updatedAt: Date.now(),
  };
  saveTrainingMatch(next);
  return next;
}

// Compute turn order for the actions phase: starts to the right of the
// dealer and wraps around back to the dealer last. "Right" = next index
// in the players array.
export function getTurnOrder(state) {
  const players = state.players;
  const idx = players.findIndex((p) => p.id === state.dealerId);
  const start = idx >= 0 ? idx : 0;
  const n = players.length;
  const order = [];
  for (let i = 0; i < n; i += 1) {
    order.push(players[(start + 1 + i) % n].id);
  }
  return order;
}

// Transition from strategy → actions. If the user tapped an action card
// during strategy (pre-selection), userActionIndex/Target/Payload are
// preserved; otherwise they remain null and the user picks at their turn.
export function enterActionsPhase(state) {
  const next = {
    ...state,
    phase: "actions",
    remaining: 0,
    actionsQueue: getTurnOrder(state),
    actionsLog: [],
    userActionIndex: state.userActionIndex ?? null,
    userActionTarget: state.userActionTarget ?? null,
    userActionPayload: state.userActionPayload ?? null,
    userActionResolved: state.userActionResolved ?? false,
    updatedAt: Date.now(),
  };
  saveTrainingMatch(next);
  return next;
}

// Pre-commit the user's action during strategy. The strategy timer is
// closed and the actions phase begins. The OTHER (non-chosen) action card
// is discarded immediately so it disappears from the hand. Target/payload
// is NOT asked here — it's resolved when the user's turn arrives.
export function selectActionInStrategy(state, actionIndex) {
  const userId = state.players[0].id;
  const hand = state.hands[userId];
  if (!hand || hand === "<hidden>") return state;
  if (actionIndex < 0 || actionIndex >= hand.actions.length) return state;
  const selectedCard = hand.actions[actionIndex];
  if (!selectedCard) return state;

  // Discard every other action card (the one not chosen). The selected card
  // stays in hand and will be discarded when it actually plays at user's turn.
  const others = hand.actions.filter((c, idx) => c && idx !== actionIndex);
  const newActions = [selectedCard];

  const pre = {
    ...state,
    hands: {
      ...state.hands,
      [userId]: { ...hand, actions: newActions },
    },
    discards: {
      ...state.discards,
      actions: [...state.discards.actions, ...others],
    },
    userActionIndex: 0, // selected card is now the only one, at index 0
    userActionTarget: null,
    userActionPayload: null,
    userActionResolved: false,
  };
  return enterActionsPhase(pre);
}

// Whether the user has pre-selected ESCUDO TOTAL during strategy (still
// pending to be played).
export function isUserShieldPreSelected(state) {
  const userId = state.players[0].id;
  if (state.userActionResolved) return false;
  if (state.userActionIndex == null) return false;
  const hand = state.hands[userId];
  if (!hand || hand === "<hidden>") return false;
  const card = hand.actions?.[state.userActionIndex];
  return card?.actionId === "shield_total";
}

// Decrement the remaining timer by 1 second. Returns new state.
// When remaining hits 0 during strategy phase, transitions to actions.
export function tickStrategyTimer(state) {
  if (state.phase !== "strategy") return state;
  const newRemaining = Math.max(0, (state.remaining || 0) - 1);
  if (newRemaining === 0) {
    return enterActionsPhase(state);
  }
  const next = { ...state, remaining: newRemaining, updatedAt: Date.now() };
  return next;
}

// Manual rule: "Ningún jugador puede quedarse sin letras. Si, como
// resultado de robos, un jugador se queda sin letras, tendrá derecho a
// coger una letra de los mazos." Caller picks vowel or consonant.
export function drawEmergencyLetter(state, kind) {
  const userId = state.players[0].id;
  const hand = state.hands[userId];
  if (!hand || hand === "<hidden>") return state;
  const result = drawLetterOfKind(
    state.decks.vowelDeck,
    state.decks.consonantDeck,
    state.discards,
    kind,
  );
  if (!result.card) return state;
  const next = {
    ...state,
    decks: {
      ...state.decks,
      vowelDeck: result.vowelDeck,
      consonantDeck: result.consonantDeck,
    },
    discards: result.discards,
    hands: {
      ...state.hands,
      [userId]: { ...hand, letters: [...hand.letters, result.card] },
    },
    updatedAt: Date.now(),
  };
  saveTrainingMatch(next);
  return next;
}

export function userHandHasNoLetters(state) {
  const userId = state.players[0].id;
  const hand = state.hands[userId];
  if (!hand || hand === "<hidden>") return false;
  return (hand.letters?.filter(Boolean).length ?? 0) === 0;
}

// ── Action resolution ───────────────────────────────────────

function discardActions(state, playerId, idsToDiscard) {
  const hand = state.hands[playerId];
  if (!hand || hand === "<hidden>") return state;
  const toMove = hand.actions.filter((a) => a && idsToDiscard.has(a.id));
  const remaining = hand.actions.filter((a) => !a || !idsToDiscard.has(a.id));
  return {
    ...state,
    hands: { ...state.hands, [playerId]: { ...hand, actions: remaining } },
    discards: { ...state.discards, actions: [...state.discards.actions, ...toMove] },
  };
}

// User accepted to play ESCUDO TOTAL as an interrupt. ESCUDO becomes the
// played action, the other action card is discarded. The triggering attack
// effect is NOT applied by caller (caller checks return.shielded).
export function useShieldOnAttack(state, source) {
  const userId = state.players[0].id;
  const hand = state.hands[userId];
  if (!hand || hand === "<hidden>") return state;
  const shieldCard = hand.actions.find((a) => a && a.actionId === "shield_total");
  const otherCard  = hand.actions.find((a) => a && a.actionId !== "shield_total");
  if (!shieldCard) return state;

  const idsToDiscard = new Set([shieldCard.id]);
  if (otherCard) idsToDiscard.add(otherCard.id);
  let next = discardActions(state, userId, idsToDiscard);
  next = {
    ...next,
    userActionIndex: 0,
    userActionPayload: null,
    userActionTarget: null,
    userActionResolved: true,
    actionsLog: [
      ...(state.actionsLog ?? []),
      { playerId: userId, actionId: "shield_total", blocked: true, source },
    ],
    updatedAt: Date.now(),
  };
  saveTrainingMatch(next);
  return next;
}

// Resolve a single ghost action (random card, random target, etc.).
// Returns { state, log, shieldOpportunity } where shieldOpportunity is set
// if the action triggers an ESCUDO prompt (caller must handle UI).
export function planGhostAction(state, ghostId, rng = Math.random) {
  // For ghosts (hidden hand) we don't track their actual action cards.
  // We just pick a random action from the MVP-available pool by category.
  // For simplicity: use the action deck and draw 1 (already shuffled).
  // The chosen card is consumed from the deck pile.
  const userId = state.players[0].id;
  const deck = state.decks.actionDeck;
  const discard = state.discards.actions;

  // Draw a card from the deck (or reshuffle discard if empty)
  let d = deck.slice();
  let p = discard.slice();
  if (d.length === 0 && p.length > 0) {
    d = p.slice().sort(() => rng() - 0.5);
    p = [];
  }
  if (d.length === 0) {
    return { state, log: null, shieldOpportunity: null };
  }
  const card = d.shift();

  // Pick target (if action requires one) and payload (if any)
  let targetId = null;
  let payload = {};
  if (card.target === "one") {
    targetId = pickRandomTarget(state.players.map((pl) => pl.id), ghostId, rng);
  }
  // use_vowel / use_consonant / use_letter need a board letter
  if (["use_vowel", "use_consonant", "use_letter"].includes(card.actionId)) {
    const id = pickRandomBoardCardId(state.centralBoard, rng);
    const boardCard = state.centralBoard.find((c) => c.id === id);
    payload = { letter: boardCard?.letter };
  }

  const nextState = {
    ...state,
    decks: { ...state.decks, actionDeck: d },
    discards: { ...state.discards, actions: [...p, card] },
  };

  const isAttack = isAttackOnUser(card, targetId, userId);
  const shieldPreSelected = isUserShieldPreSelected(nextState);
  const canPromptShield =
    isAttack
    && userHasShield(nextState)
    && !nextState.userActionResolved
    && !shieldPreSelected;
  const autoShield = isAttack && shieldPreSelected;

  return {
    state: nextState,
    log: { playerId: ghostId, actionId: card.actionId, targetId, payload },
    shieldOpportunity: canPromptShield ? { source: ghostId, card, targetId, payload } : null,
    autoShield: autoShield ? { source: ghostId, card, targetId, payload } : null,
  };
}

// Apply the previously-planned ghost action effect (skips if shielded).
export function applyPlannedGhostAction(state, log, opts = {}) {
  if (opts.shielded) {
    const newLog = { ...log, blocked: true };
    const next = {
      ...state,
      actionsLog: [...(state.actionsLog ?? []), newLog],
      updatedAt: Date.now(),
    };
    saveTrainingMatch(next);
    return next;
  }
  const fakeCard = { actionId: log.actionId };
  const after = applyActionEffect(state, fakeCard, log.playerId, log.targetId, log.payload ?? {});
  const next = {
    ...after,
    actionsLog: [...(after.actionsLog ?? state.actionsLog ?? []), log],
    updatedAt: Date.now(),
  };
  saveTrainingMatch(next);
  return next;
}

// User plays their action at their turn. actionIndex = 0|1, targetId/payload
// per action requirements. Returns new state.
export function playUserAction(state, actionIndex, targetId, payload) {
  const userId = state.players[0].id;
  const hand = state.hands[userId];
  if (!hand || hand === "<hidden>") return state;
  const card = hand.actions[actionIndex];
  if (!card) return state;

  // Apply effect
  let after = applyActionEffect(state, card, userId, targetId, payload ?? {});

  // Discard both action cards (used + unused) per manual rule (block 5+ will
  // also discard letters at end of trick)
  const idsToDiscard = new Set(hand.actions.filter(Boolean).map((a) => a.id));
  after = discardActions(after, userId, idsToDiscard);

  const next = {
    ...after,
    userActionIndex: actionIndex,
    userActionTarget: targetId ?? null,
    userActionPayload: payload ?? null,
    userActionResolved: true,
    actionsLog: [
      ...(after.actionsLog ?? state.actionsLog ?? []),
      { playerId: userId, actionId: card.actionId, targetId, payload },
    ],
    updatedAt: Date.now(),
  };
  saveTrainingMatch(next);
  return next;
}

// Advance the actions queue past the player whose turn just resolved.
// If the queue becomes empty, transition to creation phase.
export function advanceActionsQueue(state) {
  const queue = (state.actionsQueue ?? []).slice(1);
  if (queue.length === 0) {
    const next = {
      ...state,
      actionsQueue: [],
      phase: "creation",
      remaining: state.creationSeconds,
      updatedAt: Date.now(),
    };
    saveTrainingMatch(next);
    return next;
  }
  const next = { ...state, actionsQueue: queue, updatedAt: Date.now() };
  saveTrainingMatch(next);
  return next;
}

// ── Word strip (creation phase) ─────────────────────────────
// userWord is an ordered list of slot entries: { cardId, source, tilde, chosen }
//   source: "board" | "hand"
//   tilde: boolean (only meaningful for tilde-capable cards)
//   chosen: letter for wildcards (user picks at insertion)

export function addToWord(state, cardId, source, opts = {}) {
  const word = (state.userWord ?? []).slice();
  if (word.some((s) => s.cardId === cardId)) return state; // already in word
  word.push({
    cardId,
    source,
    tilde: opts.tilde ?? false,
    chosen: opts.chosenLetter ?? null,
  });
  const next = { ...state, userWord: word, updatedAt: Date.now() };
  saveTrainingMatch(next);
  return next;
}

export function removeFromWord(state, cardId) {
  const word = (state.userWord ?? []).filter((s) => s.cardId !== cardId);
  const next = { ...state, userWord: word, updatedAt: Date.now() };
  saveTrainingMatch(next);
  return next;
}

export function reorderWord(state, fromIdx, toIdx) {
  const word = (state.userWord ?? []).slice();
  if (fromIdx < 0 || fromIdx >= word.length || toIdx < 0 || toIdx >= word.length) {
    return state;
  }
  const [moved] = word.splice(fromIdx, 1);
  word.splice(toIdx, 0, moved);
  const next = { ...state, userWord: word, updatedAt: Date.now() };
  saveTrainingMatch(next);
  return next;
}

export function toggleTildeInWord(state, cardId) {
  const word = (state.userWord ?? []).map((s) =>
    s.cardId === cardId ? { ...s, tilde: !s.tilde } : s,
  );
  const next = { ...state, userWord: word, updatedAt: Date.now() };
  saveTrainingMatch(next);
  return next;
}

export function setWildcardLetterInWord(state, cardId, letter) {
  const word = (state.userWord ?? []).map((s) =>
    s.cardId === cardId ? { ...s, chosen: letter } : s,
  );
  const next = { ...state, userWord: word, updatedAt: Date.now() };
  saveTrainingMatch(next);
  return next;
}

export function tickCreationTimer(state) {
  if (state.phase !== "creation") return state;
  const newRemaining = Math.max(0, (state.remaining || 0) - 1);
  if (newRemaining === 0) {
    return { ...state, remaining: 0, phase: "result", updatedAt: Date.now() };
  }
  return { ...state, remaining: newRemaining, updatedAt: Date.now() };
}

export function submitUserWord(state) {
  const next = { ...state, phase: "result", remaining: 0, updatedAt: Date.now() };
  saveTrainingMatch(next);
  return next;
}

// Reveal one letter slot of the user's hand by drawing from the requested
// deck ('vowel' or 'consonant'). When all 3 slots are filled, transitions
// to the strategy phase (timer arming is the caller's responsibility).
export function revealLetterSlot(state, slotIndex, kind) {
  const userId = state.players[0].id;
  const hand = state.hands[userId];
  if (!hand || hand === "<hidden>") return state;
  if (hand.letters[slotIndex] != null) return state; // already filled

  const result = drawLetterOfKind(
    state.decks.vowelDeck,
    state.decks.consonantDeck,
    state.discards,
    kind,
  );
  if (!result.card) return state;

  const newLetters = hand.letters.slice();
  newLetters[slotIndex] = result.card;
  const allFilled = newLetters.every((c) => c != null);

  const next = {
    ...state,
    decks: {
      ...state.decks,
      vowelDeck: result.vowelDeck,
      consonantDeck: result.consonantDeck,
    },
    discards: result.discards,
    hands: { ...state.hands, [userId]: { ...hand, letters: newLetters } },
    phase: allFilled ? "strategy" : state.phase,
    remaining: allFilled ? state.strategySeconds : state.remaining,
    updatedAt: Date.now(),
  };
  saveTrainingMatch(next);
  return next;
}

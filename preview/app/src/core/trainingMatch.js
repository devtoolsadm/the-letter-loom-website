// Training match controller. Owns the lifecycle of a single training match:
// initial state from a difficulty preset, persistence, phase transitions.
//
// State is persisted to stateStore.training.active so the match survives
// page reloads (same approach as scoreboard matchState).

import {
  TRAINING_DIFFICULTY_PRESETS,
  TRAINING_HAND_LETTERS,
  TRAINING_HAND_ACTIONS,
  TRAINING_CENTRAL_BOARD_SIZE,
  TRAINING_MIN_WORD_LETTERS,
  MATCH_TYPE_TRAINING,
  ACTION_POINTS,
} from "./constants.js";
import {
  buildWordFromCards,
  usesAtLeastOneFromBoardAndHand,
  validateForcedRules,
  computeWordScore,
  computeWordScoreDetailed,
} from "./wordRules.js";
import {
  buildInitialDecks,
  drawActions,
  drawLetterOfKind,
  discardAllForNewTrick,
} from "./trainingDeck.js";
import { applyActionEffect } from "./actionEffects.js";
import {
  generateGhostScore,
  generateGhostScores,
  pickRandomTarget,
  pickRandomBoardCardId,
  pickGhostActionIndex,
} from "./ghostScores.js";
import { loadState, updateState } from "./stateStore.js";

// Action ids that count as "attacks" blockable by ESCUDO TOTAL.
// Per the manual ESCUDO TOTAL says "un ataque contra ti o contra todos no
// te afectará en esta baza" — so global rule-forcing cards (use_vowel/
// use_consonant/use_letter) are also blockable, since they affect every
// other player.
const SHIELDABLE_ATTACK_IDS = new Set([
  "steal_letter", "explosion", "out_one", "great_heist",
  "swap_all", "swap_one", "discard_one", "two_to_center",
  "philologist", "brain_squeeze",
  "use_vowel", "use_consonant", "use_letter",
  "one_for_all",
]);

export function isAttackOnUser(action, targetId, userId) {
  if (!action || !SHIELDABLE_ATTACK_IDS.has(action.actionId)) return false;
  if (action.target === "all") return true; // affects everyone including user
  return targetId === userId;
}

export function playerHasShield(state, playerId) {
  if ((state.shieldedPlayers ?? []).includes(playerId)) return true;
  const hand = state.hands[playerId];
  if (!hand) return false;
  return (hand.actions ?? []).some((a) => a && a.actionId === "shield_total");
}

export function userHasShield(state) {
  return playerHasShield(state, state.players[0].id);
}

function makeId() {
  return `tm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeLanguage(value) {
  const lang = String(value || "").trim().toLowerCase().slice(0, 2);
  return lang === "en" ? "en" : "es";
}

function getLanguageBonusForSelection(effects = [], selectedLanguage = "es") {
  const lang = normalizeLanguage(selectedLanguage);
  const effect = (effects ?? []).find((e) =>
    ["in_english", "in_spanish"].includes(e.actionId)
      && normalizeLanguage(e.payload?.language || (e.actionId === "in_english" ? "en" : "es")) === lang
  );
  return effect ? (ACTION_POINTS[effect.actionId] ?? 0) : 0;
}

const PLAYER_COLORS = ["#e05555", "#4a90d9", "#9b59b6", "#e67e22", "#27ae60", "#e91e8c"];

function buildPlayers(opponents, userNickname) {
  // Player ids: p1 = user, p2..pN = ghosts. Names: configurable later.
  const players = [
    { id: "p1", name: userNickname || "Tú", score: 0, rounds: [], isGhost: false, color: PLAYER_COLORS[0] },
  ];
  for (let i = 0; i < opponents; i += 1) {
    players.push({
      id: `p${i + 2}`,
      name: `Op${i + 1}`,
      score: 0,
      rounds: [],
      isGhost: true,
      color: PLAYER_COLORS[(i + 1) % PLAYER_COLORS.length],
    });
  }
  return players;
}

function buildEmptyHands(players) {
  const hands = {};
  for (const p of players) {
    hands[p.id] = {
      letters: Array.from({ length: TRAINING_HAND_LETTERS }, () => null),
      actions: Array.from({ length: TRAINING_HAND_ACTIONS }, () => null),
    };
  }
  return hands;
}

export function createTrainingMatch(difficulty, { userNickname, language } = {}) {
  const preset = TRAINING_DIFFICULTY_PRESETS[difficulty];
  if (!preset) throw new Error(`Unknown difficulty: ${difficulty}`);

  const players = buildPlayers(preset.opponents, userNickname);
  const gameLanguage = normalizeLanguage(language ?? "es");
  const decksAndDiscards = buildInitialDecks(gameLanguage);

  const state = {
    matchType: MATCH_TYPE_TRAINING,
    matchId: makeId(),
    language: gameLanguage,
    difficulty,
    ghostLevel: preset.ghostLevel,
    strategySeconds: preset.strategySeconds,
    creationSeconds: preset.creationSeconds,
    roundsTarget: preset.roundsTarget,
    skipStrategy: !!preset.skipStrategy,
    skipActions: !!preset.skipActions,
    untimedCreation: !!preset.untimedCreation,
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
    shieldedPlayers: [],
    forcedRules: {},
    scoreModifiers: {},
    userWord: [],
    userWord2: [],
    sharedCardId: null,
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

// Set up the trick: deal action cards, prepare empty board + user hand slots
// for the user to pick composition (V/C) for each, and auto-deal ghosts.
// Real-game rule: the dealer chooses the composition of the central board
// the same way they pick their hand — so we expose 5 V/C pickers instead of
// dealing the board randomly.
// Idempotent: only initializes once per round (sets `roundInitialized`).
export function initializeRound(state) {
  if (state.roundInitialized) return state;

  const userId = state.players[0].id;
  const userIsDealer = state.dealerId === userId;

  let vDeck = state.decks.vowelDeck;
  let cDeck = state.decks.consonantDeck;
  let aDeck = state.decks.actionDeck;
  let dDiscards = { ...state.discards };

  // Central board: if the user deals, leave slots empty so they can pick
  // composition. If a ghost deals, that ghost picks for us (random for
  // now — future: bias by intelligence/aggressiveness profile and by the
  // letters already on the board / in their hand).
  let board;
  if (userIsDealer) {
    board = Array.from({ length: TRAINING_CENTRAL_BOARD_SIZE }, () => null);
  } else {
    const targetV = sampleBoardTargetVowels(state.language);
    const kinds = planFillKinds(Array(TRAINING_CENTRAL_BOARD_SIZE).fill(null), targetV, 0);
    board = [];
    for (let i = 0; i < TRAINING_CENTRAL_BOARD_SIZE; i++) {
      const r = drawLetterOfKind(vDeck, cDeck, dDiscards, kinds[i]);
      vDeck = r.vowelDeck;
      cDeck = r.consonantDeck;
      dDiscards = r.discards;
      board.push(r.card ?? null);
    }
  }

  // Action cards for the user: when the user is the dealer they're drawn
  // later (after the board is fully dealt). Otherwise we draw them now.
  let userActions;
  if (state.skipActions) {
    userActions = [];
  } else if (userIsDealer) {
    userActions = Array.from({ length: TRAINING_HAND_ACTIONS }, () => null);
  } else {
    const r = drawActions(aDeck, dDiscards.actions, TRAINING_HAND_ACTIONS);
    aDeck = r.deck;
    dDiscards = { ...dDiscards, actions: r.discard };
    userActions = r.drawn;
  }

  const newHands = {
    ...state.hands,
    [userId]: {
      letters: Array.from({ length: TRAINING_HAND_LETTERS }, () => null),
      actions: userActions,
    },
  };

  // Auto-deal letters to ghost players (~35% vowels, 65% consonants).
  for (const p of state.players.filter((pl) => pl.isGhost)) {
    const letters = [];
    for (let i = 0; i < TRAINING_HAND_LETTERS; i++) {
      const kind = Math.random() < 0.35 ? "vowel" : "consonant";
      const r = drawLetterOfKind(vDeck, cDeck, dDiscards, kind);
      vDeck = r.vowelDeck;
      cDeck = r.consonantDeck;
      dDiscards = r.discards;
      if (r.card) letters.push(r.card);
    }
    newHands[p.id] = { letters, actions: [] };
  }

  const next = {
    ...state,
    centralBoard: board,
    decks: {
      ...state.decks,
      vowelDeck: vDeck,
      consonantDeck: cDeck,
      actionDeck: aDeck,
    },
    discards: dDiscards,
    hands: newHands,
    roundInitialized: true,
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
// closed and the actions phase begins. BOTH action cards stay in the hand —
// the user can still tap either one when their turn arrives. The preselected
// index marks the default that auto-plays if the turn timer expires.
//
// (Cards are reactively discarded only when the user accepts a shield prompt
// — that discards both cards by design — or when the user actually plays a
// card on their turn, which discards the rest as usual.)
export function selectActionInStrategy(state, actionIndex) {
  const userId = state.players[0].id;
  const hand = state.hands[userId];
  if (!hand || hand === "<hidden>") return state;
  if (actionIndex < 0 || actionIndex >= hand.actions.length) return state;
  const selectedCard = hand.actions[actionIndex];
  if (!selectedCard) return state;

  const pre = {
    ...state,
    userActionIndex: actionIndex,
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

// Draw 1 emergency letter for any ghost player whose hand is empty (auto-pick kind).
// Returns updated state. Call after every action effect resolves.
export function autoDrawForEmptyGhosts(state, rng = Math.random) {
  let s = state;
  for (const p of s.players.filter((pl) => pl.isGhost)) {
    const hand = s.hands[p.id];
    if (!hand) continue;
    const count = (hand.letters ?? []).filter(Boolean).length;
    if (count > 0) continue;
    const kind = rng() < 0.4 ? "vowel" : "consonant";
    const r = drawLetterOfKind(s.decks.vowelDeck, s.decks.consonantDeck, s.discards, kind);
    if (!r.card) continue;
    s = {
      ...s,
      decks: { ...s.decks, vowelDeck: r.vowelDeck, consonantDeck: r.consonantDeck },
      discards: r.discards,
      hands: { ...s.hands, [p.id]: { ...hand, letters: [...(hand.letters ?? []), r.card] } },
    };
  }
  return s;
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
  const prevShielded = next.shieldedPlayers ?? [];
  next = {
    ...next,
    userActionIndex: 0,
    userActionPayload: null,
    userActionTarget: null,
    userActionResolved: true,
    // Register the user in shieldedPlayers so EVERY remaining attack in this
    // trick skips them — not only the one that just triggered the prompt.
    shieldedPlayers: prevShielded.includes(userId) ? prevShielded : [...prevShielded, userId],
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

  // Pick target (if action requires one) and payload (if any).
  // Even the dumbest ghost won't waste an attack on a player whose shield is
  // already visibly active — those are excluded from the candidate pool.
  // Shields still IN HAND (preselected or not) are hidden information, so
  // those players remain valid targets.
  // If EVERY opponent is visibly shielded, the ghost still picks one (random
  // among all others); the action then runs but is short-circuited by the
  // shield check in applyActionEffect — same "wasted card" pattern as
  // use_consonant with no consonants on the board.
  let targetId = null;
  let payload = {};
  if (card.target === "one") {
    const activeShields = new Set(state.shieldedPlayers ?? []);
    const allIds = state.players.map((pl) => pl.id);
    const unshieldedIds = allIds.filter((id) => !activeShields.has(id));
    const pool = unshieldedIds.length > 0 ? unshieldedIds : allIds;
    targetId = pickRandomTarget(pool, ghostId, rng);
  }
  // use_vowel / use_consonant / use_letter need a board letter. Filter the
  // pool by the action's kind so use_vowel can never force a consonant (and
  // vice versa). If no board card matches (e.g. use_vowel with an all-
  // consonant board), payload.letter stays undefined and the effect ends
  // up as a no-op via the guard in applyActionEffect.
  if (["use_vowel", "use_consonant", "use_letter"].includes(card.actionId)) {
    const allBoard = state.centralBoard ?? [];
    const pool = card.actionId === "use_vowel"
      ? allBoard.filter((c) => c && c.kind === "vowel")
      : card.actionId === "use_consonant"
        ? allBoard.filter((c) => c && c.kind === "consonant")
        : allBoard.filter(Boolean);
    const id = pickRandomBoardCardId(pool, rng);
    const boardCard = pool.find((c) => c.id === id);
    payload = { letter: boardCard?.letter, cardId: boardCard?.id };
  }

  const nextState = {
    ...state,
    decks: { ...state.decks, actionDeck: d },
    discards: { ...state.discards, actions: [...p, card] },
  };

  // Shield is always REACTIVE: if the attack hits the user and they have a
  // shield_total card in hand (and the action hasn't been resolved yet), we
  // surface a prompt so they decide whether to spend it.
  const isAttack = isAttackOnUser(card, targetId, userId);
  const alreadyShielded = (nextState.shieldedPlayers ?? []).includes(userId);
  const canPromptShield =
    isAttack
    && userHasShield(nextState)
    && !nextState.userActionResolved
    && !alreadyShielded;

  return {
    state: nextState,
    log: { playerId: ghostId, actionId: card.actionId, targetId, payload },
    shieldOpportunity: canPromptShield ? { source: ghostId, card, targetId, payload } : null,
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

// wordIndex: 0 = P1 (default), 1 = P2. For P2, the first card taken from P1
// is marked as sharedCardId; only that one card can appear in both words.
export function addToWord(state, cardId, source, opts = {}) {
  const wordIndex = opts.wordIndex ?? 0;
  const p1 = (state.userWord ?? []).slice();
  const p2 = (state.userWord2 ?? []).slice();
  let sharedCardId = state.sharedCardId ?? null;

  if (wordIndex === 1) {
    // P2 path
    if (p2.some((s) => s.cardId === cardId)) return state; // already in P2
    const inP1 = p1.some((s) => s.cardId === cardId);
    if (inP1) {
      // Card is in P1 — only allowed if it becomes the shared card.
      if (sharedCardId !== null && sharedCardId !== cardId) return state; // another shared already
      sharedCardId = cardId;
    }
    p2.push({ cardId, source, tilde: opts.tilde ?? false, chosen: opts.chosenLetter ?? null });
    const next = { ...state, userWord2: p2, sharedCardId, updatedAt: Date.now() };
    saveTrainingMatch(next);
    return next;
  }

  // P1 path
  if (p1.some((s) => s.cardId === cardId)) return state;
  p1.push({ cardId, source, tilde: opts.tilde ?? false, chosen: opts.chosenLetter ?? null });
  const next = { ...state, userWord: p1, updatedAt: Date.now() };
  saveTrainingMatch(next);
  return next;
}

export function removeFromWord(state, cardId, opts = {}) {
  const wordIndex = opts.wordIndex ?? 0;
  if (wordIndex === 1) {
    const p2 = (state.userWord2 ?? []).filter((s) => s.cardId !== cardId);
    // If removing the shared card from P2, unmark it.
    const sharedCardId = state.sharedCardId === cardId ? null : state.sharedCardId;
    const next = { ...state, userWord2: p2, sharedCardId, updatedAt: Date.now() };
    saveTrainingMatch(next);
    return next;
  }
  const word = (state.userWord ?? []).filter((s) => s.cardId !== cardId);
  // If the removed card was shared and was in P1, it can no longer be shared.
  const p2 = (state.userWord2 ?? []).filter((s) => s.cardId !== cardId);
  const sharedCardId = state.sharedCardId === cardId ? null : state.sharedCardId;
  const next = { ...state, userWord: word, userWord2: p2, sharedCardId, updatedAt: Date.now() };
  saveTrainingMatch(next);
  return next;
}

export function reorderWord(state, fromIdx, toIdx, opts = {}) {
  const wordIndex = opts.wordIndex ?? 0;
  const key = wordIndex === 1 ? "userWord2" : "userWord";
  const word = (state[key] ?? []).slice();
  if (fromIdx < 0 || fromIdx >= word.length || toIdx < 0 || toIdx >= word.length) {
    return state;
  }
  const [moved] = word.splice(fromIdx, 1);
  word.splice(toIdx, 0, moved);
  const next = { ...state, [key]: word, updatedAt: Date.now() };
  saveTrainingMatch(next);
  return next;
}

export function toggleTildeInWord(state, cardId, opts = {}) {
  const wordIndex = opts.wordIndex ?? 0;
  const key = wordIndex === 1 ? "userWord2" : "userWord";
  const word = (state[key] ?? []).map((s) =>
    s.cardId === cardId ? { ...s, tilde: !s.tilde } : s,
  );
  // If shared card, sync tilde to the other word too.
  let extra = {};
  if (state.sharedCardId === cardId) {
    const otherKey = wordIndex === 1 ? "userWord" : "userWord2";
    extra[otherKey] = (state[otherKey] ?? []).map((s) =>
      s.cardId === cardId ? { ...s, tilde: !s.tilde } : s,
    );
  }
  const next = { ...state, [key]: word, ...extra, updatedAt: Date.now() };
  saveTrainingMatch(next);
  return next;
}

export function setWildcardLetterInWord(state, cardId, letter, opts = {}) {
  const wordIndex = opts.wordIndex ?? 0;
  const key = wordIndex === 1 ? "userWord2" : "userWord";
  const word = (state[key] ?? []).map((s) =>
    s.cardId === cardId ? { ...s, chosen: letter } : s,
  );
  // If shared card, sync chosen letter to the other word too.
  let extra = {};
  if (state.sharedCardId === cardId) {
    const otherKey = wordIndex === 1 ? "userWord" : "userWord2";
    extra[otherKey] = (state[otherKey] ?? []).map((s) =>
      s.cardId === cardId ? { ...s, chosen: letter } : s,
    );
  }
  const next = { ...state, [key]: word, ...extra, updatedAt: Date.now() };
  saveTrainingMatch(next);
  return next;
}

// Whether the user has an active palabra_extra effect this trick.
export function userHasPalabraExtra(state) {
  const userId = state?.players?.[0]?.id;
  if (!userId) return false;
  return (state.forcedRules?.[userId] ?? []).some((e) => e.actionId === "palabra_extra");
}

export function tickCreationTimer(state) {
  if (state.phase !== "creation") return state;
  if (state.untimedCreation) return state;
  const newRemaining = Math.max(0, (state.remaining || 0) - 1);
  if (newRemaining === 0) {
    return { ...state, remaining: 0, phase: "creation-timeup", updatedAt: Date.now() };
  }
  return { ...state, remaining: newRemaining, updatedAt: Date.now() };
}

export function submitUserWord(state) {
  return finalizeUserWord(state, state?.language || "es");
}

// Override the dictionary lookup words after finalizeUserWord has run.
// Used by the philologist picker to inject a tilde-augmented wordForDict.
export function setDictWords(state, wordForDict, word2ForDict) {
  if (!state?.userWordResult) return state;
  const next = {
    ...state,
    userWordResult: {
      ...state.userWordResult,
      wordForDict: wordForDict ?? state.userWordResult.wordForDict,
      word2ForDict: word2ForDict !== undefined ? word2ForDict : state.userWordResult.word2ForDict,
    },
    updatedAt: Date.now(),
  };
  saveTrainingMatch(next);
  return next;
}

// Validate the user's word locally (no AI yet), compute its score and
// transition to the result phase. Sets `userWordResult` with the outcome.
// When palabra_extra is active and userWord2 is non-empty, both words are
// validated; either failing invalidates the whole turn.
export function finalizeUserWord(state, language = "es", opts = {}) {
  const userId = state.players[0].id;
  const selectedLanguage = normalizeLanguage(language);
  const hand = state.hands[userId];
  const handLetters = hand && hand !== "<hidden>" ? hand.letters ?? [] : [];

  const cardIndex = new Map();
  for (const c of state.centralBoard ?? []) if (c) cardIndex.set(c.id, c);
  for (const c of handLetters) if (c) cardIndex.set(c.id, c);

  function resolveCards(slots) {
    return (slots ?? [])
      .map((slot) => {
        const card = cardIndex.get(slot.cardId);
        if (!card) return null;
        return {
          ...card,
          usingTilde: !!(slot.tilde && card.tildeValue != null),
          tildeChar: card.tildeForm,
          chosenLetter: slot.chosen,
        };
      })
      .filter(Boolean);
  }

  const selectedCards = resolveCards(state.userWord ?? []);
  const boardIds = new Set((state.centralBoard ?? []).map((c) => c.id));
  const handLetterIds = new Set(handLetters.filter(Boolean).map((c) => c.id));
  const wordStr = buildWordFromCards(selectedCards);
  const forcedEffects = state.forcedRules?.[userId] ?? [];
  // Exclude palabra_extra from forced-rule validation — it's a capability marker, not a word constraint.
  const wordForcedEffects = forcedEffects.filter((e) => e.actionId !== "palabra_extra");
  const languageBonusPoints = getLanguageBonusForSelection(wordForcedEffects, selectedLanguage);
  const languageBonusAttempted = languageBonusPoints > 0;

  // ── Validate P1 ──────────────────────────────────────────────
  let valid = true;
  let reason = null;
  let violations = [];

  if (selectedCards.length < TRAINING_MIN_WORD_LETTERS) {
    valid = false;
    reason = "too_short";
  } else if (!usesAtLeastOneFromBoardAndHand(selectedCards, boardIds, handLetterIds)) {
    valid = false;
    reason = "missing_source";
  } else {
    // Forced rules are checked against the union of P1+P2 words.
    // We defer the union-check to after P2 is resolved; for now validate
    // structural rules only (length, source). Full rule check happens below.
  }

  let score = 0;
  let breakdown = null;
  const allUserLetters = handLetters.filter(Boolean).map((c) => c.id);
  const allBoardLetters = (state.centralBoard ?? []).map((c) => c.id);

  // ── P2 (palabra_extra) ───────────────────────────────────────
  const hasPalabraExtra = forcedEffects.some((e) => e.actionId === "palabra_extra");
  const p2Slots = state.userWord2 ?? [];
  const hasP2 = hasPalabraExtra && p2Slots.length > 0;
  let selectedCards2 = [];
  let wordStr2 = "";
  let valid2 = true;
  let reason2 = null;
  let violations2 = [];
  let score2 = 0;
  let breakdown2 = null;

  if (hasP2) {
    selectedCards2 = resolveCards(p2Slots);
    wordStr2 = buildWordFromCards(selectedCards2);
    if (selectedCards2.length < TRAINING_MIN_WORD_LETTERS) {
      valid2 = false;
      reason2 = "too_short";
    } else if (!usesAtLeastOneFromBoardAndHand(selectedCards2, boardIds, handLetterIds)) {
      valid2 = false;
      reason2 = "missing_source";
    }
  }

  // ── Forced rules checked over union of P1+P2 ────────────────
  // opts.philoWord: virtual-tilde variant from the philologist picker.
  // When provided, used instead of the raw word for the philologist check.
  // opts.skipForcedRules: skip this block entirely (used for picker preview).
  if (!opts?.skipForcedRules && valid && (valid2 || !hasP2)) {
    const unionCards = hasP2
      ? [...selectedCards, ...selectedCards2.filter((c) => c.id !== state.sharedCardId)]
      : selectedCards;
    const rawUnionWord = buildWordFromCards(unionCards);
    const unionWord = opts?.philoWord ?? rawUnionWord;
    const forcedCheck = validateForcedRules({
      word: unionWord,
      selectedCards: unionCards,
      effects: wordForcedEffects,
      lang: selectedLanguage,
    });
    if (!forcedCheck.ok) {
      valid = false;
      reason = "forced_rule";
      violations = forcedCheck.violations;
    }
  }

  // ── Score P1 ────────────────────────────────────────────────
  if (valid) {
    const plusMinus = (state.scoreModifiers?.[userId] ?? 0) + languageBonusPoints;
    const detail = computeWordScoreDetailed({
      selectedCards,
      allUserLetters,
      allBoardLetters,
      plusMinus,
    });
    score = detail.score;
    breakdown = detail.parts;
  }

  // ── Score P2 ────────────────────────────────────────────────
  if (hasP2 && valid2) {
    const detail2 = computeWordScoreDetailed({
      selectedCards: selectedCards2,
      allUserLetters,
      allBoardLetters,
      plusMinus: 0, // modifiers already counted in P1
    });
    score2 = detail2.score;
    breakdown2 = detail2.parts;
  }

  // If P1 or P2 invalid → entire turn invalid (score = 0).
  const overallValid = valid && (!hasP2 || valid2);
  const totalScore = overallValid ? score + score2 : 0;

  // Persist round entries: user gets validated score, ghosts get generated scores.
  const ghostScoreList = generateGhostScores(
    state.players.filter((p) => p.isGhost).length,
    state.ghostLevel,
  );
  let ghostIdx = 0;
  const players = state.players.map((p) => {
    if (!p.isGhost) {
      const newRounds = [
        ...(p.rounds ?? []),
        { round: state.round, points: totalScore, tieBreak: false },
      ];
      return { ...p, rounds: newRounds, score: (p.score ?? 0) + totalScore };
    }
    const gScore = ghostScoreList[ghostIdx++] ?? 0;
    const newRounds = [
      ...(p.rounds ?? []),
      { round: state.round, points: gScore },
    ];
    return { ...p, rounds: newRounds, score: (p.score ?? 0) + gScore };
  });

  const next = {
    ...state,
    players,
    phase: "result",
    remaining: 0,
    userWordResult: {
      word: wordStr,
      valid: overallValid,
      reason: overallValid ? null : (valid ? reason2 : reason),
      violations: overallValid ? [] : (valid ? violations2 : violations),
      invalidWord: overallValid ? null : (valid ? "p2" : "p1"),
      score: totalScore,
      score1: overallValid ? score : 0,
      score2: overallValid ? score2 : 0,
      breakdown,
      breakdown2: hasP2 ? breakdown2 : null,
      word2: hasP2 ? wordStr2 : null,
      // wordForDict / word2ForDict: the strings to send to the dictionary
      // (may differ from word/word2 when a virtual tilde was applied by the
      // philologist picker). Callers can override via opts.dictWords.
      wordForDict: wordStr,
      word2ForDict: hasP2 ? wordStr2 : null,
      language: selectedLanguage,
      languageBonusAttempted,
      // Locally-valid words always start as "checking" so the result screen
      // shows a spinner until the dictionary verdict arrives.
      checking: overallValid,
    },
    updatedAt: Date.now(),
  };
  saveTrainingMatch(next);
  return next;
}

// Reveal one letter slot of the user's hand by drawing from the requested
// deck ('vowel' or 'consonant'). Phase transitions to strategy/creation only
// when BOTH the user's hand and the central board are fully filled — the
// dealer picks both compositions during the dealing phase.
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
  const next = applyDealPhaseAdvance(
    {
      ...state,
      decks: {
        ...state.decks,
        vowelDeck: result.vowelDeck,
        consonantDeck: result.consonantDeck,
      },
      discards: result.discards,
      hands: { ...state.hands, [userId]: { ...hand, letters: newLetters } },
    },
    newLetters,
    state.centralBoard,
  );
  saveTrainingMatch(next);
  return next;
}

// Reveal one slot of the central board the same way: the dealer picks V/C
// for each of the 5 board slots. Phase only transitions once hand + board
// are both fully filled.
export function revealBoardSlot(state, slotIndex, kind) {
  const board = state.centralBoard ?? [];
  if (board[slotIndex] != null) return state; // already filled

  const result = drawLetterOfKind(
    state.decks.vowelDeck,
    state.decks.consonantDeck,
    state.discards,
    kind,
  );
  if (!result.card) return state;

  const newBoard = board.slice();
  newBoard[slotIndex] = result.card;
  const userId = state.players[0].id;
  const userHand = state.hands[userId];

  let nextDecks = {
    ...state.decks,
    vowelDeck: result.vowelDeck,
    consonantDeck: result.consonantDeck,
  };
  let nextDiscards = result.discards;
  let nextHands = state.hands;

  // When the board becomes fully dealt, draw the user's action cards too —
  // they were left as `?` placeholders during initializeRound so the user
  // could pick the board composition first (matches real-game order).
  const boardJustFilled = newBoard.every((c) => c != null);
  if (boardJustFilled && !state.skipActions && userHand) {
    const actionsAlreadyDealt = (userHand.actions ?? []).some((c) => c != null);
    if (!actionsAlreadyDealt) {
      const actionsResult = drawActions(
        nextDecks.actionDeck,
        nextDiscards.actions,
        TRAINING_HAND_ACTIONS,
      );
      nextDecks = { ...nextDecks, actionDeck: actionsResult.deck };
      nextDiscards = { ...nextDiscards, actions: actionsResult.discard };
      nextHands = {
        ...state.hands,
        [userId]: { ...userHand, actions: actionsResult.drawn },
      };
    }
  }

  const next = applyDealPhaseAdvance(
    {
      ...state,
      decks: nextDecks,
      discards: nextDiscards,
      hands: nextHands,
      centralBoard: newBoard,
    },
    nextHands[userId]?.letters ?? [],
    newBoard,
  );
  saveTrainingMatch(next);
  return next;
}

// Fill any remaining null slots (in the central board or user hand) with a
// random V/C pick — same 35/65 ratio used for ghosts. Lets the user skip
// the rest of the dealing when they don't care about composition.
export function fillRemainingBoardRandomly(state) {
  const board = state.centralBoard ?? [];
  let v = state.decks.vowelDeck;
  let c = state.decks.consonantDeck;
  let d = state.discards;
  const next = board.slice();
  // Pick the kinds smartly (mid-level player heuristic) so the auto-fill
  // doesn't produce extreme distributions like 5 consonants.
  const language = state.language || "es";
  const currentV = next.filter((card) => card && card.kind === "vowel").length;
  const targetV = sampleBoardTargetVowels(language);
  const kindsToAssign = planFillKinds(next, targetV, currentV);
  let idx = 0;
  for (let i = 0; i < next.length; i++) {
    if (next[i] != null) continue;
    const kind = kindsToAssign[idx++];
    const r = drawLetterOfKind(v, c, d, kind);
    v = r.vowelDeck;
    c = r.consonantDeck;
    d = r.discards;
    if (r.card) next[i] = r.card;
  }
  const userId = state.players[0].id;
  const userHand = state.hands[userId];

  let nextDecks = { ...state.decks, vowelDeck: v, consonantDeck: c };
  let nextDiscards = d;
  let nextHands = state.hands;

  // Draw the user's action cards once the board has just become fully dealt
  // (same trigger as revealBoardSlot's last pick).
  const boardJustFilled = next.every((c) => c != null);
  if (boardJustFilled && !state.skipActions && userHand) {
    const actionsAlreadyDealt = (userHand.actions ?? []).some((c) => c != null);
    if (!actionsAlreadyDealt) {
      const r = drawActions(nextDecks.actionDeck, nextDiscards.actions, TRAINING_HAND_ACTIONS);
      nextDecks = { ...nextDecks, actionDeck: r.deck };
      nextDiscards = { ...nextDiscards, actions: r.discard };
      nextHands = { ...state.hands, [userId]: { ...userHand, actions: r.drawn } };
    }
  }

  const out = applyDealPhaseAdvance(
    {
      ...state,
      decks: nextDecks,
      discards: nextDiscards,
      hands: nextHands,
      centralBoard: next,
    },
    nextHands[userId]?.letters ?? [],
    next,
  );
  saveTrainingMatch(out);
  return out;
}

export function fillRemainingHandRandomly(state) {
  const userId = state.players[0].id;
  const hand = state.hands[userId];
  if (!hand || hand === "<hidden>") return state;
  let v = state.decks.vowelDeck;
  let c = state.decks.consonantDeck;
  let d = state.discards;
  const letters = hand.letters.slice();
  // Mid-level player heuristic: target depends on what's already on the
  // central board. With a consonant-heavy board, the player wants more
  // vowels in their hand to be able to form words.
  const language = state.language || "es";
  const board = state.centralBoard ?? [];
  const boardVowels = board.filter((card) => card && card.kind === "vowel").length;
  const boardConsonants = board.filter((card) => card && card.kind === "consonant").length;
  const currentV = letters.filter((card) => card && card.kind === "vowel").length;
  const targetV = sampleHandTargetVowels(boardVowels, boardConsonants, language);
  const kindsToAssign = planFillKinds(letters, targetV, currentV);
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    if (letters[i] != null) continue;
    const kind = kindsToAssign[idx++];
    const r = drawLetterOfKind(v, c, d, kind);
    v = r.vowelDeck;
    c = r.consonantDeck;
    d = r.discards;
    if (r.card) letters[i] = r.card;
  }
  const out = applyDealPhaseAdvance(
    {
      ...state,
      decks: { ...state.decks, vowelDeck: v, consonantDeck: c },
      discards: d,
      hands: { ...state.hands, [userId]: { ...hand, letters } },
    },
    letters,
    state.centralBoard ?? [],
  );
  saveTrainingMatch(out);
  return out;
}

// ─── Mid-level player heuristics for the 🎲 buttons ───────────────────────
// The auto-fill buttons should approximate what a moderately-skilled player
// would do, not pure 35/65 randomness. A real player avoids extremes (no
// "5 consonants in the central board") and considers what's already on the
// board when choosing their own hand.

// Sample the TOTAL vowel count the player aims for on the 5-slot central
// board. Distribution peaks at 2 (the comfortable "2V+3C" balance for
// forming words) and tails off toward 0 and 5. ES tolerates a bit more
// vowel-heavy boards than EN.
function sampleBoardTargetVowels(language = "es") {
  // Index = vowel count (0..5). Values sum to 1.
  const dist = language === "en"
    ? [0.04, 0.22, 0.40, 0.24, 0.08, 0.02]
    : [0.02, 0.13, 0.40, 0.32, 0.10, 0.03];
  let r = Math.random();
  for (let i = 0; i < dist.length; i++) {
    r -= dist[i];
    if (r < 0) return i;
  }
  return 2;
}

// Sample the TOTAL vowel count the player aims for in their 3-slot hand,
// given what's already on the central board. The combined "useful" pool is
// 5 board + 3 hand = 8 cards; a mid-level player aims for ~3-4 vowels in
// total. So if the board is consonant-heavy, the hand picks more vowels,
// and vice versa.
function sampleHandTargetVowels(boardVowels, boardConsonants, language = "es") {
  const totalIdealVowels = language === "en" ? 3 : 3.5;
  let target = Math.round(totalIdealVowels - boardVowels);
  // 12% chance the player deviates from the obvious choice — keeps the
  // auto-fill from feeling deterministic.
  if (Math.random() < 0.12) {
    target += Math.random() < 0.5 ? -1 : 1;
  }
  return Math.max(0, Math.min(3, target));
}

// Given an array of slots (some already filled), a target total of vowels,
// and the current vowel count, return a shuffled list of kinds ("vowel" /
// "consonant") to assign to the remaining NULL slots so that the final
// composition lands on the target (or as close as possible).
function planFillKinds(slots, targetVowels, currentVowels) {
  const empty = slots.filter((s) => s == null).length;
  let vowelsToAdd = targetVowels - currentVowels;
  vowelsToAdd = Math.max(0, Math.min(empty, vowelsToAdd));
  const consonantsToAdd = empty - vowelsToAdd;
  const kinds = [
    ...Array(vowelsToAdd).fill("vowel"),
    ...Array(consonantsToAdd).fill("consonant"),
  ];
  // Fisher-Yates shuffle so the kinds are sprinkled across slots, not all
  // vowels first then all consonants.
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  return kinds;
}

function applyDealPhaseAdvance(state, userLetters, board) {
  const handFilled = userLetters.length > 0 && userLetters.every((c) => c != null);
  const boardFilled = board.length > 0 && board.every((c) => c != null);
  const allFilled = handFilled && boardFilled;
  const nextPhase = allFilled
    ? (state.skipStrategy ? "creation" : "strategy")
    : state.phase;
  const nextRemaining = allFilled
    ? (state.skipStrategy ? state.creationSeconds : state.strategySeconds)
    : state.remaining;
  return {
    ...state,
    phase: nextPhase,
    remaining: nextRemaining,
    updatedAt: Date.now(),
  };
}

// Discard all trick cards, reset per-baza state, advance the round counter.
// If the last baza was just played → phase "done". Otherwise → phase "dealing".
export function advanceToNextBaza(state) {
  const deckResult = discardAllForNewTrick({
    vowelDeck: state.decks.vowelDeck,
    consonantDeck: state.decks.consonantDeck,
    actionDeck: state.decks.actionDeck,
    discards: state.discards,
    hands: state.hands,
    centralBoard: state.centralBoard,
  });

  const nextRound = (state.round ?? 1) + 1;
  const isMatchOver = nextRound > (state.roundsTarget ?? 1);

  const players = state.players;
  const dealerIdx = players.findIndex((p) => p.id === state.dealerId);
  const nextDealerId = players[(dealerIdx >= 0 ? dealerIdx + 1 : 1) % players.length].id;

  const newHands = {};
  for (const p of players) {
    newHands[p.id] = {
      letters: Array.from({ length: TRAINING_HAND_LETTERS }, () => null),
      actions: Array.from({ length: TRAINING_HAND_ACTIONS }, () => null),
    };
  }

  const next = {
    ...state,
    decks: {
      vowelDeck: deckResult.vowelDeck,
      consonantDeck: deckResult.consonantDeck,
      actionDeck: deckResult.actionDeck,
    },
    discards: deckResult.discards,
    hands: newHands,
    centralBoard: [],
    roundInitialized: false,
    round: isMatchOver ? state.round : nextRound,
    phase: isMatchOver ? "done" : "dealing",
    remaining: 0,
    dealerId: nextDealerId,
    trickActions: [],
    pendingEffectsOnUser: [],
    shieldedPlayers: [],
    forcedRules: {},
    scoreModifiers: {},
    userWord: [],
    userWord2: [],
    sharedCardId: null,
    userWordResult: null,
    actionsQueue: [],
    actionsLog: [],
    userActionIndex: null,
    userActionTarget: null,
    userActionPayload: null,
    userActionResolved: false,
    matchOver: isMatchOver,
    winnerIds: isMatchOver ? computeWinnerIds(players) : [],
    updatedAt: Date.now(),
  };
  saveTrainingMatch(next);
  return next;
}

function computeWinnerIds(players) {
  const maxScore = Math.max(...players.map((p) => p.score ?? 0));
  return players.filter((p) => (p.score ?? 0) === maxScore).map((p) => p.id);
}

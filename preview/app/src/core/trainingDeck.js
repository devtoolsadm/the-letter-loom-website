// Pure functions for managing training mode decks (vowels, consonants, actions).
// Cards have stable IDs so they can be referenced across the state.

import {
  getVowelDeckDef,
  getConsonantDeckDef,
  getActionCardDefsForLanguage,
  TRAINING_VOWEL_WILDCARDS,
  TRAINING_CONSONANT_WILDCARDS,
  TRAINING_HAND_LETTERS,
  TRAINING_HAND_ACTIONS,
  TRAINING_CENTRAL_BOARD_SIZE,
} from "./constants.js";

let _cardCounter = 0;
function nextCardId(prefix) {
  _cardCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${_cardCounter}`;
}

export function buildVowelDeck(language = "es") {
  const cards = [];
  for (const def of getVowelDeckDef(language)) {
    for (let i = 0; i < def.count; i += 1) {
      cards.push({
        id: nextCardId("v"),
        type: "letter",
        kind: "vowel",
        letter: def.letter,
        value: def.value,
        tildeValue: def.tildeValue ?? null,
        tildeForm: def.tildeForm ?? null,
        tildeKind: def.tildeKind ?? null,
        color: def.color,
        isWildcard: false,
      });
    }
  }
  for (let i = 0; i < TRAINING_VOWEL_WILDCARDS; i += 1) {
    cards.push({
      id: nextCardId("vw"),
      type: "letter",
      kind: "vowel",
      letter: "*",
      value: 0,
      color: "none",
      isWildcard: true,
    });
  }
  return cards;
}

export function buildConsonantDeck(language = "es") {
  const cards = [];
  for (const def of getConsonantDeckDef(language)) {
    for (let i = 0; i < def.count; i += 1) {
      cards.push({
        id: nextCardId("c"),
        type: "letter",
        kind: "consonant",
        letter: def.letter,
        value: def.value,
        color: def.color,
        isWildcard: false,
      });
    }
  }
  for (let i = 0; i < TRAINING_CONSONANT_WILDCARDS; i += 1) {
    cards.push({
      id: nextCardId("cw"),
      type: "letter",
      kind: "consonant",
      letter: "*",
      value: 0,
      color: "none",
      isWildcard: true,
    });
  }
  return cards;
}

export function buildActionDeck({ excludeDeferred = true, language = "es" } = {}) {
  const cards = [];
  for (const def of getActionCardDefsForLanguage(language)) {
    if (excludeDeferred && def.inMVP === false) continue;
    for (let i = 0; i < (def.count ?? 0); i += 1) {
      cards.push({
        id: nextCardId("a"),
        type: "action",
        actionId: def.id,
        kind: def.kind,
        target: def.target,
      });
    }
  }
  return cards;
}

// Fisher-Yates shuffle. Returns a new array, never mutates input.
export function shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Draw n cards off the top of the deck. Auto-reshuffles discard pile when needed.
// Returns { drawn, deck, discard }.
export function drawFromDeck(deck, discard, n) {
  let d = deck.slice();
  let pile = discard.slice();
  const drawn = [];
  for (let i = 0; i < n; i += 1) {
    if (d.length === 0) {
      if (pile.length === 0) break;
      d = shuffle(pile);
      pile = [];
    }
    drawn.push(d.shift());
  }
  return { drawn, deck: d, discard: pile };
}

// Draw a single letter card from the requested type ('vowel' or 'consonant').
// Used during interactive hand dealing where the user picks the type per slot.
export function drawLetterOfKind(vowelDeck, consonantDeck, discards, kind) {
  if (kind === "vowel") {
    const { drawn, deck, discard } = drawFromDeck(vowelDeck, discards.vowels, 1);
    return { card: drawn[0] ?? null, vowelDeck: deck, consonantDeck, discards: { ...discards, vowels: discard } };
  }
  const { drawn, deck, discard } = drawFromDeck(consonantDeck, discards.consonants, 1);
  return { card: drawn[0] ?? null, vowelDeck, consonantDeck: deck, discards: { ...discards, consonants: discard } };
}

// Draw the initial central board: TRAINING_CENTRAL_BOARD_SIZE cards from
// the combined letter pool (random — manual rule).
export function dealCentralBoard(vowelDeck, consonantDeck, discards) {
  const combined = shuffle(vowelDeck.concat(consonantDeck));
  const boardCards = combined.slice(0, TRAINING_CENTRAL_BOARD_SIZE);
  const boardIds = new Set(boardCards.map((c) => c.id));
  return {
    board: boardCards,
    vowelDeck: vowelDeck.filter((c) => !boardIds.has(c.id)),
    consonantDeck: consonantDeck.filter((c) => !boardIds.has(c.id)),
    discards,
  };
}

// Draw n action cards
export function drawActions(actionDeck, actionDiscard, n) {
  return drawFromDeck(actionDeck, actionDiscard, n);
}

// Build the initial decks for a fresh training match.
export function buildInitialDecks(language = "es") {
  const vowels = shuffle(buildVowelDeck(language));
  const consonants = shuffle(buildConsonantDeck(language));
  const actions = shuffle(buildActionDeck({ language }));
  return {
    vowelDeck: vowels,
    consonantDeck: consonants,
    actionDeck: actions,
    discards: { vowels: [], consonants: [], actions: [] },
  };
}

// At the start of every trick (manual rule: "se empieza de 0 cada baza"),
// all cards in hands and on the board go to the discard piles, and decks
// are refreshed for a clean deal.
export function discardAllForNewTrick({ vowelDeck, consonantDeck, actionDeck, discards, hands, centralBoard }) {
  const newDiscards = {
    vowels: discards.vowels.slice(),
    consonants: discards.consonants.slice(),
    actions: discards.actions.slice(),
  };

  // Central board → letter discards
  for (const card of centralBoard ?? []) {
    if (card.kind === "vowel") newDiscards.vowels.push(card);
    else newDiscards.consonants.push(card);
  }

  // Each hand → respective discard
  for (const playerId of Object.keys(hands ?? {})) {
    const h = hands[playerId];
    if (!h || h === "<hidden>") continue;
    for (const card of h.letters ?? []) {
      if (!card) continue;
      if (card.kind === "vowel") newDiscards.vowels.push(card);
      else newDiscards.consonants.push(card);
    }
    for (const card of h.actions ?? []) {
      if (!card) continue;
      newDiscards.actions.push(card);
    }
  }

  return {
    vowelDeck,
    consonantDeck,
    actionDeck,
    discards: newDiscards,
  };
}

// Sizes of the hands used in the game; centralized for tests/UI.
export const HAND_SIZES = {
  letters: TRAINING_HAND_LETTERS,
  actions: TRAINING_HAND_ACTIONS,
};

// Apply the effect of a single action card to the training match state.
// All effects produce a new state (no mutation of the input), and may return
// auxiliary info (e.g. which cards moved, which forced rules now apply).
//
// State shape (subset used here):
//   {
//     hands: { [playerId]: { letters, actions } | '<hidden>' },
//     centralBoard: [letterCard],
//     decks: { vowelDeck, consonantDeck, actionDeck },
//     discards: { vowels, consonants, actions },
//     pendingEffectsOnUser: [{ actionId, source, payload? }],
//     scoreModifiers: { [playerId]: number },  // pts to add/subtract this trick
//     forcedRules: { [playerId]: [{ actionId, source, payload? }] },
//   }

import {
  drawFromDeck,
  shuffle,
} from "./trainingDeck.js";
import { ACTION_POINTS } from "./constants.js";

function ensureHand(state, playerId) {
  const h = state.hands[playerId];
  if (!h) return { letters: [], actions: [] };
  return h;
}

function addForcedRule(state, targetPlayerId, actionId, source, payload) {
  const prev = state.forcedRules?.[targetPlayerId] ?? [];
  return {
    ...state,
    forcedRules: {
      ...(state.forcedRules ?? {}),
      [targetPlayerId]: [...prev, { actionId, source, payload }],
    },
  };
}

function addScoreModifier(state, targetPlayerId, delta) {
  const prev = state.scoreModifiers?.[targetPlayerId] ?? 0;
  return {
    ...state,
    scoreModifiers: { ...(state.scoreModifiers ?? {}), [targetPlayerId]: prev + delta },
  };
}

function takeRandomLetter(hand, rng) {
  if (!hand?.letters?.length) return { taken: null, hand };
  const idx = Math.floor(rng() * hand.letters.length);
  const taken = hand.letters[idx];
  const next = { ...hand, letters: hand.letters.filter((_, i) => i !== idx) };
  return { taken, hand: next };
}

function takeLetterByKind(hand, kind, rng) {
  const letters = (hand?.letters ?? []).filter(Boolean);
  const candidates = kind ? letters.filter((c) => c.kind === kind) : letters;
  if (candidates.length === 0) return { taken: null, hand };
  const taken = candidates[Math.floor(rng() * candidates.length)];
  return {
    taken,
    hand: { ...hand, letters: (hand.letters ?? []).filter((c) => c?.id !== taken.id) },
  };
}

// ── Effect dispatcher ─────────────────────────────────────────
// action: the action card (with actionId)
// sourcePlayerId, targetPlayerId, payload (optional, depends on action)
export function applyActionEffect(state, action, sourcePlayerId, targetPlayerId, payload = {}, rng = Math.random) {
  switch (action.actionId) {
    // ── Self-bonus (point modifiers) ─────────────────────────
    case "in_english":
      return addForcedRule(
        addScoreModifier(state, sourcePlayerId, ACTION_POINTS.in_english),
        sourcePlayerId,
        action.actionId,
        sourcePlayerId,
        { language: "en" },
      );
    case "boost_total":
      return addScoreModifier(state, sourcePlayerId, ACTION_POINTS.boost_total);
    case "wildcard": {
      // Adds a special "action wildcard" letter card to the source player's
      // hand. The +6 score modifier applies when the user includes this card
      // in their word (MVP: always granted on play; can refine later).
      const hand = ensureHand(state, sourcePlayerId);
      const wildcardCard = {
        id: `wc-act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: "letter",
        kind: "wildcard",
        letter: "*",
        value: 0,
        tildeValue: null,
        color: "none",
        isWildcard: true,
        isActionWildcard: true,
      };
      const next = addScoreModifier(state, sourcePlayerId, ACTION_POINTS.wildcard);
      return {
        ...next,
        hands: {
          ...next.hands,
          [sourcePlayerId]: { ...hand, letters: [...hand.letters, wildcardCard] },
        },
      };
    }

    // ── Self-bonus (card manipulation) ───────────────────────
    case "extra_card": {
      // Draw one extra letter of chosen kind (payload.kind: 'vowel'|'consonant').
      const kind = payload.kind === "consonant" ? "consonant" : "vowel";
      const deckKey = kind === "vowel" ? "vowelDeck" : "consonantDeck";
      const discardKey = kind === "vowel" ? "vowels" : "consonants";
      const { drawn, deck, discard } = drawFromDeck(
        state.decks[deckKey],
        state.discards[discardKey],
        1,
      );
      if (!drawn.length) return state;
      const hand = ensureHand(state, sourcePlayerId);
      return {
        ...state,
        decks: { ...state.decks, [deckKey]: deck },
        discards: { ...state.discards, [discardKey]: discard },
        hands: {
          ...state.hands,
          [sourcePlayerId]: { ...hand, letters: [...hand.letters, ...drawn] },
        },
      };
    }

    case "change_cards": {
      // User-driven: payload.cardIds = letter ids to swap. For ghosts: swap all.
      const hand = ensureHand(state, sourcePlayerId);
      const toSwapIds = new Set(payload.cardIds ?? hand.letters.map((c) => c.id));
      const toReturn = hand.letters.filter((c) => toSwapIds.has(c.id));
      const keep = hand.letters.filter((c) => !toSwapIds.has(c.id));
      // Return to respective discards
      const newVowelDiscard = state.discards.vowels.slice();
      const newConsonantDiscard = state.discards.consonants.slice();
      for (const c of toReturn) {
        if (c.kind === "vowel") newVowelDiscard.push(c);
        else newConsonantDiscard.push(c);
      }
      // Draw replacements of the same kind, in the same proportion
      let vowelDeck = state.decks.vowelDeck;
      let consonantDeck = state.decks.consonantDeck;
      let vowelDiscard = newVowelDiscard;
      let consonantDiscard = newConsonantDiscard;
      const drawn = [];
      for (const c of toReturn) {
        const wantKind = (payload.kinds ?? {})[c.id] ?? c.kind;
        if (wantKind === "vowel") {
          const r = drawFromDeck(vowelDeck, vowelDiscard, 1);
          vowelDeck = r.deck;
          vowelDiscard = r.discard;
          if (r.drawn[0]) drawn.push(r.drawn[0]);
        } else {
          const r = drawFromDeck(consonantDeck, consonantDiscard, 1);
          consonantDeck = r.deck;
          consonantDiscard = r.discard;
          if (r.drawn[0]) drawn.push(r.drawn[0]);
        }
      }
      return {
        ...state,
        decks: { ...state.decks, vowelDeck, consonantDeck },
        discards: { ...state.discards, vowels: vowelDiscard, consonants: consonantDiscard },
        hands: { ...state.hands, [sourcePlayerId]: { ...hand, letters: [...keep, ...drawn] } },
      };
    }

    // ── Shield: register in shieldedPlayers so pill and attack filter work ───
    case "shield_total": {
      const already = state.shieldedPlayers ?? [];
      if (already.includes(sourcePlayerId)) return state;
      return { ...state, shieldedPlayers: [...already, sourcePlayerId] };
    }

    // ── Board modifiers ──────────────────────────────────────
    case "two_to_center": {
      if (payload.picks && payload.picks.length > 0) {
        let st = state;
        const drawn = [];
        for (const pick of payload.picks) {
          const h = ensureHand(st, pick.playerId);
          const { taken, hand } = takeLetterByKind(h, pick.kind, rng);
          if (taken) {
            drawn.push(taken);
            st = { ...st, hands: { ...st.hands, [pick.playerId]: hand } };
          }
        }
        const toBoard = drawn.slice(0, 2);
        const toDiscard = drawn.slice(2);
        const newDiscards = { ...st.discards };
        newDiscards.vowels = newDiscards.vowels.slice();
        newDiscards.consonants = newDiscards.consonants.slice();
        for (const c of toDiscard) {
          if (c.kind === "vowel") newDiscards.vowels.push(c);
          else newDiscards.consonants.push(c);
        }
        return {
          ...st,
          centralBoard: [...st.centralBoard, ...toBoard],
          discards: newDiscards,
        };
      }
      // Ghost plays: take 1 letter from each other player, place 2 in central board.
      let st = state;
      const taken = [];
      for (const pid of Object.keys(state.hands)) {
        if (pid === sourcePlayerId) continue;
        const h = ensureHand(st, pid);
        const { taken: card, hand } = takeRandomLetter(h, rng);
        if (card) taken.push(card);
        st = { ...st, hands: { ...st.hands, [pid]: hand } };
      }
      const toBoard = taken.slice(0, 2);
      const toDiscard = taken.slice(2);
      const newDiscards = { ...st.discards };
      newDiscards.vowels = newDiscards.vowels.slice();
      newDiscards.consonants = newDiscards.consonants.slice();
      for (const c of toDiscard) {
        if (c.kind === "vowel") newDiscards.vowels.push(c);
        else newDiscards.consonants.push(c);
      }
      return {
        ...st,
        centralBoard: [...st.centralBoard, ...toBoard],
        discards: newDiscards,
      };
    }

    case "renew_board": {
      // Discard all board, draw 5 new from combined letter pool.
      const oldBoard = state.centralBoard ?? [];
      const newVowelDiscard = state.discards.vowels.slice();
      const newConsonantDiscard = state.discards.consonants.slice();
      for (const c of oldBoard) {
        if (c.kind === "vowel") newVowelDiscard.push(c);
        else newConsonantDiscard.push(c);
      }
      const combined = shuffle(state.decks.vowelDeck.concat(state.decks.consonantDeck));
      const newBoard = combined.slice(0, 5);
      const boardIds = new Set(newBoard.map((c) => c.id));
      return {
        ...state,
        centralBoard: newBoard,
        decks: {
          ...state.decks,
          vowelDeck: state.decks.vowelDeck.filter((c) => !boardIds.has(c.id)),
          consonantDeck: state.decks.consonantDeck.filter((c) => !boardIds.has(c.id)),
        },
        discards: {
          ...state.discards,
          vowels: newVowelDiscard,
          consonants: newConsonantDiscard,
        },
      };
    }

    case "solo_mia": {
      // Take a letter from the central board into the source player's hand.
      // payload.cardId = specific board card to take (random for ghosts).
      const board = state.centralBoard ?? [];
      if (board.length === 0) return state;
      const cardId = payload.cardId ?? board[Math.floor(rng() * board.length)]?.id;
      const card = board.find((c) => c.id === cardId);
      if (!card) return state;
      const hand = ensureHand(state, sourcePlayerId);
      return {
        ...state,
        centralBoard: board.filter((c) => c.id !== card.id),
        hands: {
          ...state.hands,
          [sourcePlayerId]: { ...hand, letters: [...hand.letters, card] },
        },
      };
    }

    // ── Attacks (letter theft / point reduction) ─────────────
    case "out_one": {
      if (payload.picks && payload.picks.length > 0) {
        let st = state;
        const newVowels = st.decks.vowelDeck.slice();
        const newConsonants = st.decks.consonantDeck.slice();
        for (const pick of payload.picks) {
          const h = ensureHand(st, pick.playerId);
          const { taken, hand } = takeLetterByKind(h, pick.kind, rng);
          if (taken) {
            if (taken.kind === "vowel") newVowels.push(taken);
            else newConsonants.push(taken);
            st = { ...st, hands: { ...st.hands, [pick.playerId]: hand } };
          }
        }
        return {
          ...st,
          decks: { ...st.decks, vowelDeck: shuffle(newVowels), consonantDeck: shuffle(newConsonants) },
        };
      }
      // Ghost plays: take 1 card from each other player, send to deck.
      let st = state;
      const newVowels = st.decks.vowelDeck.slice();
      const newConsonants = st.decks.consonantDeck.slice();
      for (const pid of Object.keys(state.hands)) {
        if (pid === sourcePlayerId) continue;
        const h = ensureHand(st, pid);
        const { taken, hand } = takeRandomLetter(h, rng);
        if (taken) {
          if (taken.kind === "vowel") newVowels.push(taken);
          else newConsonants.push(taken);
        }
        st = { ...st, hands: { ...st.hands, [pid]: hand } };
      }
      return {
        ...st,
        decks: { ...st.decks, vowelDeck: shuffle(newVowels), consonantDeck: shuffle(newConsonants) },
      };
    }

    case "great_heist": {
      if (payload.picks && payload.picks.length > 0) {
        let st = state;
        const stolen = [];
        for (const pick of payload.picks) {
          const h = ensureHand(st, pick.playerId);
          const { taken, hand } = takeLetterByKind(h, pick.kind, rng);
          if (taken) {
            stolen.push(taken);
            st = { ...st, hands: { ...st.hands, [pick.playerId]: hand } };
          }
        }
        const srcHand = ensureHand(st, sourcePlayerId);
        return {
          ...st,
          hands: { ...st.hands, [sourcePlayerId]: { ...srcHand, letters: [...srcHand.letters, ...stolen] } },
        };
      }
      // Ghost plays: take 1 card from each other player, give to source.
      let st = state;
      const stolen = [];
      for (const pid of Object.keys(state.hands)) {
        if (pid === sourcePlayerId) continue;
        const h = ensureHand(st, pid);
        const { taken, hand } = takeRandomLetter(h, rng);
        if (taken) stolen.push(taken);
        st = { ...st, hands: { ...st.hands, [pid]: hand } };
      }
      const sourceHand = ensureHand(st, sourcePlayerId);
      return {
        ...st,
        hands: { ...st.hands, [sourcePlayerId]: { ...sourceHand, letters: [...sourceHand.letters, ...stolen] } },
      };
    }

    case "steal_letter": {
      const targetHand = ensureHand(state, targetPlayerId);
      let taken, restLetters;
      if (payload.cardId) {
        taken = targetHand.letters.find((c) => c && c.id === payload.cardId);
        restLetters = targetHand.letters.filter((c) => c?.id !== payload.cardId);
      } else {
        const { taken: t, hand: h } = takeLetterByKind(targetHand, payload.targetKind ?? null, rng);
        taken = t;
        restLetters = h.letters;
      }
      if (!taken) return state;
      const sourceHand = ensureHand(state, sourcePlayerId);
      return {
        ...state,
        hands: {
          ...state.hands,
          [targetPlayerId]: { ...targetHand, letters: restLetters },
          [sourcePlayerId]: { ...sourceHand, letters: [...sourceHand.letters, taken] },
        },
      };
    }

    case "swap_all": {
      const sourceHand = ensureHand(state, sourcePlayerId);
      const targetHand = ensureHand(state, targetPlayerId);
      if (payload.fromIds && payload.fromIds.length > 0) {
        const fromIdSet = new Set(payload.fromIds);
        const givenAway = sourceHand.letters.filter((c) => c && fromIdSet.has(c.id));
        const keptBySource = sourceHand.letters.filter((c) => c && !fromIdSet.has(c.id));
        const received = targetHand.letters.filter(Boolean);
        return {
          ...state,
          hands: {
            ...state.hands,
            [sourcePlayerId]: { ...sourceHand, letters: [...keptBySource, ...received] },
            [targetPlayerId]: { ...targetHand, letters: givenAway },
          },
        };
      }
      return {
        ...state,
        hands: {
          ...state.hands,
          [sourcePlayerId]: { ...sourceHand, letters: targetHand.letters },
          [targetPlayerId]: { ...targetHand, letters: sourceHand.letters },
        },
      };
    }

    case "swap_one": {
      const sourceHand = ensureHand(state, sourcePlayerId);
      const targetHand = ensureHand(state, targetPlayerId);
      const fromCard = payload.fromId
        ? sourceHand.letters.find((c) => c?.id === payload.fromId)
        : sourceHand.letters.find(Boolean);
      let toCard;
      if (payload.toId) {
        toCard = targetHand.letters.find((c) => c?.id === payload.toId);
      } else if (payload.targetKind) {
        const { taken } = takeLetterByKind(targetHand, payload.targetKind, rng);
        toCard = taken;
      } else {
        toCard = targetHand.letters.find(Boolean);
      }
      if (!fromCard || !toCard) return state;
      return {
        ...state,
        hands: {
          ...state.hands,
          [sourcePlayerId]: {
            ...sourceHand,
            letters: sourceHand.letters.map((c) => (c?.id === fromCard.id ? toCard : c)),
          },
          [targetPlayerId]: {
            ...targetHand,
            letters: targetHand.letters.map((c) => (c?.id === toCard.id ? fromCard : c)),
          },
        },
      };
    }

    case "explosion":
      return addScoreModifier(state, targetPlayerId, ACTION_POINTS.explosion);

    case "discard_one": {
      // Target must put 1 letter back in the deck (random if no payload).
      const targetHand = ensureHand(state, targetPlayerId);
      const cardId = payload.cardId
        ?? targetHand.letters[Math.floor(rng() * targetHand.letters.length)]?.id;
      const card = targetHand.letters.find((c) => c.id === cardId);
      if (!card) return state;
      const rest = targetHand.letters.filter((c) => c.id !== card.id);
      const deckKey = card.kind === "vowel" ? "vowelDeck" : "consonantDeck";
      return {
        ...state,
        decks: { ...state.decks, [deckKey]: shuffle([...state.decks[deckKey], card]) },
        hands: { ...state.hands, [targetPlayerId]: { ...targetHand, letters: rest } },
      };
    }

    // ── Rule forcing ─────────────────────────────────────────
    case "use_vowel":
    case "use_consonant":
    case "use_letter": {
      // Forces every other player to include payload.letter in their word.
      let st = state;
      for (const pid of Object.keys(state.hands)) {
        if (pid === sourcePlayerId) continue;
        st = addForcedRule(st, pid, action.actionId, sourcePlayerId, { letter: payload.letter, cardId: payload.cardId });
      }
      return st;
    }
    case "philologist":
    case "brain_squeeze":
      return addForcedRule(state, targetPlayerId, action.actionId, sourcePlayerId, {});

    case "one_for_all": {
      const targetHand = ensureHand(state, targetPlayerId);
      const letters = targetHand.letters.filter(Boolean);
      if (letters.length === 0) return state;
      let card;
      if (payload.cardId) {
        card = letters.find((c) => c.id === payload.cardId);
      } else if (payload.targetKind) {
        const { taken } = takeLetterByKind(targetHand, payload.targetKind, rng);
        card = taken;
      } else {
        card = letters[Math.floor(rng() * letters.length)];
      }
      if (!card) return state;
      return {
        ...state,
        centralBoard: [...(state.centralBoard ?? []), card],
        hands: {
          ...state.hands,
          [targetPlayerId]: { ...targetHand, letters: targetHand.letters.filter((c) => c?.id !== card.id) },
        },
      };
    }

    default:
      // Unknown / deferred action: no effect.
      return state;
  }
}

// Helper to compute the pending forced rules + score modifier for one player.
export function getActiveEffectsFor(state, playerId) {
  return {
    forcedRules: state.forcedRules?.[playerId] ?? [],
    scoreModifier: state.scoreModifiers?.[playerId] ?? 0,
  };
}

// Clear per-trick state (forced rules, score modifiers). Call at end of trick.
export function clearTrickState(state) {
  return { ...state, forcedRules: {}, scoreModifiers: {} };
}

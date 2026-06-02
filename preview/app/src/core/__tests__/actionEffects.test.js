import { describe, it, expect, beforeEach } from 'vitest'
import { applyActionEffect, getActiveEffectsFor, clearTrickState } from '../actionEffects.js'
import { makeLetter, makeConsonant, makeActionCard, makeState, resetIds } from './helpers.js'

// Deterministic rng: returns values from a sequence, cycling if needed.
function seqRng(...values) {
  let i = 0
  return () => values[i++ % values.length]
}
const rng0 = () => 0   // always picks index 0
const rng1 = () => 0.99 // always picks last index

beforeEach(() => resetIds())

// ── Self-bonus ──────────────────────────────────────────────────────────────

describe('in_english', () => {
  it('registers optional English bonus for source', () => {
    const state = makeState()
    const action = makeActionCard({ actionId: 'in_english' })
    const next = applyActionEffect(state, action, 'p1', null, {})
    expect(next.scoreModifiers?.p1).toBeUndefined()
    expect(next.forcedRules.p1).toHaveLength(1)
    expect(next.forcedRules.p1[0].actionId).toBe('in_english')
    expect(next.forcedRules.p1[0].payload).toEqual({ language: 'en' })
  })

  it('does not alter existing modifiers', () => {
    const state = makeState({ scoreModifiers: { p1: 5 } })
    const action = makeActionCard({ actionId: 'in_english' })
    const next = applyActionEffect(state, action, 'p1', null, {})
    expect(next.scoreModifiers.p1).toBe(5)
  })
})

describe('in_spanish', () => {
  it('registers optional Spanish bonus for source', () => {
    const state = makeState()
    const action = makeActionCard({ actionId: 'in_spanish' })
    const next = applyActionEffect(state, action, 'p1', null, {})
    expect(next.scoreModifiers?.p1).toBeUndefined()
    expect(next.forcedRules.p1).toHaveLength(1)
    expect(next.forcedRules.p1[0].actionId).toBe('in_spanish')
    expect(next.forcedRules.p1[0].payload).toEqual({ language: 'es' })
  })
})

describe('boost_total', () => {
  it('adds +6 score modifier to source', () => {
    const state = makeState()
    const action = makeActionCard({ actionId: 'boost_total' })
    const next = applyActionEffect(state, action, 'p1', null, {})
    expect(next.scoreModifiers.p1).toBe(6)
  })

  it('does not affect other players', () => {
    const state = makeState()
    const action = makeActionCard({ actionId: 'boost_total' })
    const next = applyActionEffect(state, action, 'p1', null, {})
    expect(next.scoreModifiers.p2).toBeUndefined()
    expect(next.scoreModifiers.p3).toBeUndefined()
  })
})

describe('wildcard', () => {
  it('adds the wildcard letter to source hand but no points yet (the +6 is granted only when the card is actually used in a word)', () => {
    const state = makeState({ hands: { p1: { letters: [], actions: [] }, p2: { letters: [], actions: [] }, p3: { letters: [], actions: [] } } })
    const action = makeActionCard({ actionId: 'wildcard' })
    const next = applyActionEffect(state, action, 'p1', null, {})
    expect(next.scoreModifiers?.p1 ?? 0).toBe(0)
    expect(next.hands.p1.letters).toHaveLength(1)
    const wc = next.hands.p1.letters[0]
    expect(wc.isWildcard).toBe(true)
    expect(wc.isActionWildcard).toBe(true)
    expect(wc.kind).toBe('wildcard')
    expect(wc.letter).toBe('*')
  })
})

describe('extra_card', () => {
  it('draws a vowel and adds to source hand (kind=vowel)', () => {
    const vowel = makeLetter({ letter: 'E', kind: 'vowel' })
    const state = makeState({
      hands: { p1: { letters: [], actions: [] }, p2: { letters: [], actions: [] }, p3: { letters: [], actions: [] } },
      decks: { vowelDeck: [vowel], consonantDeck: [], actionDeck: [] },
    })
    const action = makeActionCard({ actionId: 'extra_card' })
    const next = applyActionEffect(state, action, 'p1', null, { kind: 'vowel' })
    expect(next.hands.p1.letters).toHaveLength(1)
    expect(next.hands.p1.letters[0].letter).toBe('E')
    expect(next.decks.vowelDeck).toHaveLength(0)
  })

  it('draws a consonant when kind=consonant', () => {
    const cons = makeConsonant({ letter: 'R' })
    const state = makeState({
      hands: { p1: { letters: [], actions: [] }, p2: { letters: [], actions: [] }, p3: { letters: [], actions: [] } },
      decks: { vowelDeck: [], consonantDeck: [cons], actionDeck: [] },
    })
    const action = makeActionCard({ actionId: 'extra_card' })
    const next = applyActionEffect(state, action, 'p1', null, { kind: 'consonant' })
    expect(next.hands.p1.letters[0].letter).toBe('R')
    expect(next.decks.consonantDeck).toHaveLength(0)
  })

  it('defaults to vowel when kind is unspecified', () => {
    const vowel = makeLetter({ letter: 'I' })
    const state = makeState({
      hands: { p1: { letters: [], actions: [] }, p2: { letters: [], actions: [] }, p3: { letters: [], actions: [] } },
      decks: { vowelDeck: [vowel], consonantDeck: [], actionDeck: [] },
    })
    const action = makeActionCard({ actionId: 'extra_card' })
    const next = applyActionEffect(state, action, 'p1', null, {})
    expect(next.hands.p1.letters).toHaveLength(1)
  })

  it('returns state unchanged when deck and discard are empty', () => {
    const state = makeState({ hands: { p1: { letters: [], actions: [] }, p2: { letters: [], actions: [] }, p3: { letters: [], actions: [] } } })
    const action = makeActionCard({ actionId: 'extra_card' })
    const next = applyActionEffect(state, action, 'p1', null, { kind: 'vowel' })
    expect(next.hands.p1.letters).toHaveLength(0)
    expect(next).toBe(state)
  })
})

describe('change_cards', () => {
  it('swaps specified card with a fresh one of same kind', () => {
    const old = makeLetter({ id: 'old-v', letter: 'A', kind: 'vowel' })
    const replacement = makeLetter({ id: 'new-v', letter: 'E', kind: 'vowel' })
    const state = makeState({
      hands: { p1: { letters: [old], actions: [] }, p2: { letters: [], actions: [] }, p3: { letters: [], actions: [] } },
      decks: { vowelDeck: [replacement], consonantDeck: [], actionDeck: [] },
      discards: { vowels: [], consonants: [], actions: [] },
    })
    const action = makeActionCard({ actionId: 'change_cards' })
    const next = applyActionEffect(state, action, 'p1', null, { cardIds: ['old-v'] })
    expect(next.hands.p1.letters).toHaveLength(1)
    expect(next.hands.p1.letters[0].id).toBe('new-v')
    expect(next.discards.vowels).toHaveLength(1)
    expect(next.discards.vowels[0].id).toBe('old-v')
  })

  it('swaps all when no cardIds in payload', () => {
    const v1 = makeLetter({ id: 'v1', kind: 'vowel' })
    const c1 = makeConsonant({ id: 'c1', kind: 'consonant' })
    const newV = makeLetter({ id: 'v2', kind: 'vowel', letter: 'O' })
    const newC = makeConsonant({ id: 'c2', kind: 'consonant', letter: 'R' })
    const state = makeState({
      hands: { p1: { letters: [v1, c1], actions: [] }, p2: { letters: [], actions: [] }, p3: { letters: [], actions: [] } },
      decks: { vowelDeck: [newV], consonantDeck: [newC], actionDeck: [] },
      discards: { vowels: [], consonants: [], actions: [] },
    })
    const action = makeActionCard({ actionId: 'change_cards' })
    const next = applyActionEffect(state, action, 'p1', null, {})
    expect(next.hands.p1.letters).toHaveLength(2)
    const ids = next.hands.p1.letters.map(c => c.id)
    expect(ids).not.toContain('v1')
    expect(ids).not.toContain('c1')
  })
})

// ── Shield ──────────────────────────────────────────────────────────────────

describe('shield_total', () => {
  it('registers the source player in shieldedPlayers', () => {
    const state = makeState()
    const action = makeActionCard({ actionId: 'shield_total' })
    const next = applyActionEffect(state, action, 'p1', null, {})
    expect(next.shieldedPlayers).toContain('p1')
  })

  it('is idempotent — re-applying does not add a duplicate', () => {
    const state = { ...makeState(), shieldedPlayers: ['p1'] }
    const action = makeActionCard({ actionId: 'shield_total' })
    const next = applyActionEffect(state, action, 'p1', null, {})
    expect(next).toBe(state)
  })

  it('shields a target from explosion (no score modifier applied)', () => {
    const state = { ...makeState(), shieldedPlayers: ['p1'] }
    const action = makeActionCard({ actionId: 'explosion' })
    const next = applyActionEffect(state, action, 'p2', 'p1', {})
    expect(next).toBe(state)
    expect(next.scoreModifiers?.p1 ?? 0).toBe(0)
  })

  it('shields a target from steal_letter', () => {
    const state = {
      ...makeState({
        hands: {
          p1: { letters: [makeLetter({ id: 'l1', letter: 'A' })], actions: [] },
          p2: { letters: [], actions: [] },
        },
      }),
      shieldedPlayers: ['p1'],
    }
    const action = makeActionCard({ actionId: 'steal_letter' })
    const next = applyActionEffect(state, action, 'p2', 'p1', {})
    expect(next.hands.p1.letters).toHaveLength(1) // unchanged
    expect(next.hands.p2.letters).toHaveLength(0)
  })

  it('shields a target from philologist (no forced rule added)', () => {
    const state = { ...makeState(), shieldedPlayers: ['p1'] }
    const action = makeActionCard({ actionId: 'philologist' })
    const next = applyActionEffect(state, action, 'p2', 'p1', {})
    expect(next.forcedRules?.p1 ?? []).toHaveLength(0)
  })

  it('shielded players are skipped by great_heist (per-player attack)', () => {
    const state = {
      ...makeState({
        hands: {
          p1: { letters: [makeLetter({ id: 'l1' })], actions: [] },
          p2: { letters: [], actions: [] },
          p3: { letters: [makeLetter({ id: 'l3' })], actions: [] },
        },
      }),
      shieldedPlayers: ['p1'],
    }
    const action = makeActionCard({ actionId: 'great_heist' })
    const next = applyActionEffect(state, action, 'p2', null, {})
    // p1 is shielded → keeps its letter
    expect(next.hands.p1.letters).toHaveLength(1)
    // p3 is not shielded → loses its letter
    expect(next.hands.p3.letters).toHaveLength(0)
  })

  it('shielded player is not affected by use_vowel forced rule', () => {
    const state = { ...makeState(), shieldedPlayers: ['p1'] }
    const action = makeActionCard({ actionId: 'use_vowel' })
    const next = applyActionEffect(state, action, 'p2', null, { letter: 'A' })
    // p1 (shielded) → no forced rule
    expect(next.forcedRules?.p1 ?? []).toHaveLength(0)
    // p3 (not shielded) → forced rule applied
    expect(next.forcedRules?.p3 ?? []).toHaveLength(1)
    expect(next.forcedRules.p3[0].actionId).toBe('use_vowel')
  })

  it('shielded player is not affected by use_letter forced rule', () => {
    const state = { ...makeState(), shieldedPlayers: ['p1'] }
    const action = makeActionCard({ actionId: 'use_letter' })
    const next = applyActionEffect(state, action, 'p2', null, { letter: 'X' })
    expect(next.forcedRules?.p1 ?? []).toHaveLength(0)
    expect(next.forcedRules?.p3 ?? []).toHaveLength(1)
  })

  it('shielded target is unaffected by one_for_all (card stays in hand)', () => {
    const state = {
      ...makeState({
        hands: {
          p1: { letters: [makeLetter({ id: 'l1' })], actions: [] },
          p2: { letters: [], actions: [] },
        },
      }),
      shieldedPlayers: ['p1'],
    }
    const action = makeActionCard({ actionId: 'one_for_all' })
    const next = applyActionEffect(state, action, 'p2', 'p1', {})
    expect(next).toBe(state)
    expect(next.hands.p1.letters).toHaveLength(1)
    expect(next.centralBoard ?? []).toHaveLength(0)
  })

  it('shielded target is unaffected by swap_all', () => {
    const state = {
      ...makeState({
        hands: {
          p1: { letters: [makeLetter({ id: 'l1', letter: 'A' })], actions: [] },
          p2: { letters: [makeLetter({ id: 'l2', letter: 'B' })], actions: [] },
        },
      }),
      shieldedPlayers: ['p1'],
    }
    const action = makeActionCard({ actionId: 'swap_all' })
    const next = applyActionEffect(state, action, 'p2', 'p1', {})
    expect(next).toBe(state)
    // Hands remain intact
    expect(next.hands.p1.letters[0].id).toBe('l1')
    expect(next.hands.p2.letters[0].id).toBe('l2')
  })

  it('shielded target is unaffected by swap_one', () => {
    const state = {
      ...makeState({
        hands: {
          p1: { letters: [makeLetter({ id: 'l1', letter: 'A' })], actions: [] },
          p2: { letters: [makeLetter({ id: 'l2', letter: 'B' })], actions: [] },
        },
      }),
      shieldedPlayers: ['p1'],
    }
    const action = makeActionCard({ actionId: 'swap_one' })
    const next = applyActionEffect(state, action, 'p2', 'p1', { fromId: 'l2', toId: 'l1' })
    expect(next).toBe(state)
  })

  it('shielded target is unaffected by discard_one', () => {
    const state = {
      ...makeState({
        hands: {
          p1: { letters: [makeLetter({ id: 'l1' })], actions: [] },
          p2: { letters: [], actions: [] },
        },
      }),
      shieldedPlayers: ['p1'],
    }
    const action = makeActionCard({ actionId: 'discard_one' })
    const next = applyActionEffect(state, action, 'p2', 'p1', { cardId: 'l1' }, rng0)
    expect(next).toBe(state)
    expect(next.hands.p1.letters).toHaveLength(1)
  })

  it('shielded target is unaffected by brain_squeeze', () => {
    const state = { ...makeState(), shieldedPlayers: ['p1'] }
    const action = makeActionCard({ actionId: 'brain_squeeze' })
    const next = applyActionEffect(state, action, 'p2', 'p1', {})
    expect(next).toBe(state)
    expect(next.forcedRules?.p1 ?? []).toHaveLength(0)
  })

  it('shielded players are skipped by out_one (per-player attack)', () => {
    const state = {
      ...makeState({
        hands: {
          p1: { letters: [makeLetter({ id: 'l1', kind: 'vowel' })], actions: [] },
          p2: { letters: [], actions: [] },
          p3: { letters: [makeLetter({ id: 'l3', kind: 'vowel' })], actions: [] },
        },
      }),
      shieldedPlayers: ['p1'],
    }
    const action = makeActionCard({ actionId: 'out_one' })
    const next = applyActionEffect(state, action, 'p2', null, {}, rng0)
    expect(next.hands.p1.letters).toHaveLength(1) // shielded → keeps
    expect(next.hands.p3.letters).toHaveLength(0) // not shielded → loses
  })

  it('shielded players are skipped by two_to_center (per-player attack)', () => {
    const state = {
      ...makeState({
        hands: {
          p1: { letters: [makeLetter({ id: 'l1', kind: 'vowel' })], actions: [] },
          p2: { letters: [], actions: [] },
          p3: { letters: [makeLetter({ id: 'l3', kind: 'vowel' })], actions: [] },
        },
      }),
      shieldedPlayers: ['p1'],
    }
    const action = makeActionCard({ actionId: 'two_to_center' })
    const next = applyActionEffect(state, action, 'p2', null, {}, rng0)
    expect(next.hands.p1.letters).toHaveLength(1) // shielded
    expect(next.hands.p3.letters).toHaveLength(0) // not shielded
  })

  it('shielded player is not affected by use_consonant forced rule', () => {
    const state = { ...makeState(), shieldedPlayers: ['p1'] }
    const action = makeActionCard({ actionId: 'use_consonant' })
    const next = applyActionEffect(state, action, 'p2', null, { letter: 'S' })
    expect(next.forcedRules?.p1 ?? []).toHaveLength(0)
    expect(next.forcedRules?.p3 ?? []).toHaveLength(1)
    expect(next.forcedRules.p3[0].actionId).toBe('use_consonant')
  })
})

// ── Forced-rule pruning when the required board card disappears ─────────────

describe('forced rule pruning', () => {
  it('drops a use_vowel forced rule when the referenced board card is later stolen', () => {
    // p2 plays USA VOCAL referencing board card 'b-a' (the 'A' on the board).
    const boardA = makeLetter({ id: 'b-a', letter: 'A', kind: 'vowel' })
    let state = {
      ...makeState({
        hands: {
          p1: { letters: [makeLetter({ id: 'h1' })], actions: [] },
          p2: { letters: [], actions: [] },
          p3: { letters: [], actions: [] },
        },
      }),
      centralBoard: [boardA],
    }
    state = applyActionEffect(state, makeActionCard({ actionId: 'use_vowel' }), 'p2', null, {
      letter: 'A',
      cardId: 'b-a',
    })
    // p1 was forced to use 'A'
    expect(state.forcedRules?.p1?.length).toBe(1)

    // Now p2 plays SOLO MÍA stealing the 'A' from the board into their hand.
    state = applyActionEffect(state, makeActionCard({ actionId: 'solo_mia' }), 'p2', null, {
      cardId: 'b-a',
    })
    // The board no longer has the 'A' → the forced rule is gone.
    expect(state.forcedRules?.p1 ?? []).toHaveLength(0)
  })

  it('discards use_vowel with no payload (no letter to point at) without forcing any rule', () => {
    const state = makeState({
      hands: {
        p1: { letters: [], actions: [] },
        p2: { letters: [], actions: [] },
        p3: { letters: [], actions: [] },
      },
      centralBoard: [], // no vowels available
    })
    const next = applyActionEffect(state, makeActionCard({ actionId: 'use_vowel' }), 'p2', null, {})
    expect(next.forcedRules ?? {}).toEqual({})
  })

  it('discards use_vowel with empty payload object', () => {
    const state = makeState()
    const next = applyActionEffect(state, makeActionCard({ actionId: 'use_vowel' }), 'p2', null, {})
    expect(next.forcedRules?.p1 ?? []).toHaveLength(0)
    expect(next.forcedRules?.p3 ?? []).toHaveLength(0)
  })

  it('keeps a use_vowel rule while the card is still on the board', () => {
    const boardA = makeLetter({ id: 'b-a', letter: 'A', kind: 'vowel' })
    const state0 = {
      ...makeState({
        hands: {
          p1: { letters: [makeLetter({ id: 'h1' })], actions: [] },
          p2: { letters: [], actions: [] },
          p3: { letters: [], actions: [] },
        },
      }),
      centralBoard: [boardA, makeLetter({ id: 'b-b', letter: 'B' })],
    }
    const state1 = applyActionEffect(state0, makeActionCard({ actionId: 'use_vowel' }), 'p2', null, {
      letter: 'A',
      cardId: 'b-a',
    })
    // Some other action that does NOT touch the 'A' on the board.
    const state2 = applyActionEffect(state1, makeActionCard({ actionId: 'boost_total' }), 'p2', null, {})
    expect(state2.forcedRules?.p1?.length).toBe(1)
    expect(state2.forcedRules.p1[0].actionId).toBe('use_vowel')
  })
})

// ── Board modifiers ─────────────────────────────────────────────────────────

describe('action wildcards are never stolen by attacks', () => {
  // Wildcards GENERATED by the WILDCARD action card (kind:"wildcard",
  // isActionWildcard:true) are NOT stealable. Regular vowel/consonant
  // wildcards from the deck (kind:"vowel"/"consonant", isWildcard:true)
  // ARE stealable like any other letter.

  it('two_to_center skips action wildcards in opponents hands', () => {
    const actionWild = makeLetter({ id: 'awc', kind: 'wildcard', isWildcard: true, isActionWildcard: true, value: 0 })
    const realLetter = makeLetter({ id: 'p3l', letter: 'E', kind: 'vowel' })
    const state = makeState({
      hands: {
        p1: { letters: [], actions: [] },
        p2: { letters: [actionWild], actions: [] },
        p3: { letters: [realLetter], actions: [] },
      },
      centralBoard: [],
    })
    const action = makeActionCard({ actionId: 'two_to_center' })
    const next = applyActionEffect(state, action, 'p1', null, {}, rng0)
    expect(next.centralBoard.map((c) => c.id)).not.toContain('awc')
    expect(next.hands.p2.letters.map((c) => c.id)).toContain('awc')
    expect(next.hands.p3.letters).toHaveLength(0)
  })

  it('two_to_center DOES steal a regular deck vowel-wildcard', () => {
    // Deck wildcard: kind is vowel/consonant, isWildcard:true (no isActionWildcard).
    const deckWild = makeLetter({ id: 'dwc', kind: 'vowel', letter: '*', isWildcard: true, value: 0 })
    const state = makeState({
      hands: {
        p1: { letters: [], actions: [] },
        p2: { letters: [deckWild], actions: [] },
        p3: { letters: [], actions: [] },
      },
      centralBoard: [],
    })
    const action = makeActionCard({ actionId: 'two_to_center' })
    const next = applyActionEffect(state, action, 'p1', null, {}, rng0)
    // Deck wildcard is treated like any other letter → moved to the board.
    expect(next.centralBoard.map((c) => c.id)).toContain('dwc')
    expect(next.hands.p2.letters).toHaveLength(0)
  })

  it('great_heist does not steal action wildcards', () => {
    const actionWild = makeLetter({ id: 'awc', kind: 'wildcard', isWildcard: true, isActionWildcard: true, value: 0 })
    const realLetter = makeLetter({ id: 'p3l', letter: 'A' })
    const state = makeState({
      hands: {
        p1: { letters: [], actions: [] },
        p2: { letters: [actionWild], actions: [] },
        p3: { letters: [realLetter], actions: [] },
      },
    })
    const action = makeActionCard({ actionId: 'great_heist' })
    const next = applyActionEffect(state, action, 'p1', null, {}, rng0)
    expect(next.hands.p2.letters.map((c) => c.id)).toContain('awc')
    expect(next.hands.p1.letters.map((c) => c.id)).not.toContain('awc')
  })

  it('steal_letter does not pick an action wildcard when target only has one', () => {
    const actionWild = makeLetter({ id: 'awc', kind: 'wildcard', isWildcard: true, isActionWildcard: true, value: 0 })
    const state = makeState({
      hands: {
        p1: { letters: [], actions: [] },
        p2: { letters: [actionWild], actions: [] },
      },
    })
    const action = makeActionCard({ actionId: 'steal_letter', target: 'one' })
    const next = applyActionEffect(state, action, 'p1', 'p2', {}, rng0)
    expect(next.hands.p2.letters.map((c) => c.id)).toContain('awc')
    expect(next.hands.p1.letters).toHaveLength(0)
  })

  it('discard_one does not pick an action wildcard randomly', () => {
    const actionWild = makeLetter({ id: 'awc', kind: 'wildcard', isWildcard: true, isActionWildcard: true, value: 0 })
    const realLetter = makeLetter({ id: 'real', kind: 'vowel', letter: 'A' })
    const state = makeState({
      hands: {
        p1: { letters: [], actions: [] },
        p2: { letters: [actionWild, realLetter], actions: [] },
      },
    })
    const action = makeActionCard({ actionId: 'discard_one' })
    const next = applyActionEffect(state, action, 'p1', 'p2', {}, rng0)
    expect(next.hands.p2.letters.map((c) => c.id)).toContain('awc')
    expect(next.hands.p2.letters.map((c) => c.id)).not.toContain('real')
  })
})

describe('two_to_center', () => {
  it('takes one letter from each other player and places them on the board', () => {
    const p2Letter = makeLetter({ id: 'p2l', letter: 'E', kind: 'vowel' })
    const p3Letter = makeConsonant({ id: 'p3l', letter: 'N' })
    const state = makeState({
      hands: {
        p1: { letters: [makeLetter()], actions: [] },
        p2: { letters: [p2Letter], actions: [] },
        p3: { letters: [p3Letter], actions: [] },
      },
      centralBoard: [],
    })
    const action = makeActionCard({ actionId: 'two_to_center' })
    const next = applyActionEffect(state, action, 'p1', null, {}, rng0)
    expect(next.centralBoard).toHaveLength(2)
    const boardIds = next.centralBoard.map(c => c.id)
    expect(boardIds).toContain('p2l')
    expect(boardIds).toContain('p3l')
    expect(next.hands.p2.letters).toHaveLength(0)
    expect(next.hands.p3.letters).toHaveLength(0)
    // Source hand unchanged
    expect(next.hands.p1.letters).toHaveLength(1)
  })

  it('sends excess cards (beyond 2) to discard when 3+ other players', () => {
    const players = [
      { id: 'p1', name: 'Tú', score: 0, rounds: [], isGhost: false },
      { id: 'p2', name: 'Op1', score: 0, rounds: [], isGhost: true },
      { id: 'p3', name: 'Op2', score: 0, rounds: [], isGhost: true },
      { id: 'p4', name: 'Op3', score: 0, rounds: [], isGhost: true },
    ]
    const l2 = makeLetter({ id: 'l2', kind: 'vowel' })
    const l3 = makeConsonant({ id: 'l3' })
    const l4 = makeLetter({ id: 'l4', kind: 'vowel' })
    const state = makeState({
      players,
      hands: {
        p1: { letters: [], actions: [] },
        p2: { letters: [l2], actions: [] },
        p3: { letters: [l3], actions: [] },
        p4: { letters: [l4], actions: [] },
      },
      centralBoard: [],
      discards: { vowels: [], consonants: [], actions: [] },
    })
    const action = makeActionCard({ actionId: 'two_to_center' })
    const next = applyActionEffect(state, action, 'p1', null, {}, rng0)
    // At most 2 on board
    expect(next.centralBoard).toHaveLength(2)
    // The 3rd card goes to discard
    const totalDiscarded = next.discards.vowels.length + next.discards.consonants.length
    expect(totalDiscarded).toBe(1)
  })
})

describe('renew_board', () => {
  it('discards old board and replaces with 5 new cards', () => {
    const old1 = makeLetter({ id: 'ob1', kind: 'vowel' })
    const old2 = makeConsonant({ id: 'ob2' })
    const newCards = Array.from({ length: 10 }, (_, i) =>
      makeLetter({ id: `nb${i}`, letter: 'O', kind: 'vowel' })
    )
    const state = makeState({
      centralBoard: [old1, old2],
      decks: { vowelDeck: newCards, consonantDeck: [], actionDeck: [] },
      discards: { vowels: [], consonants: [], actions: [] },
    })
    const action = makeActionCard({ actionId: 'renew_board' })
    const next = applyActionEffect(state, action, 'p1', null, {})
    expect(next.centralBoard).toHaveLength(5)
    const boardIds = next.centralBoard.map(c => c.id)
    expect(boardIds).not.toContain('ob1')
    expect(boardIds).not.toContain('ob2')
    // Old board cards go to discard
    expect(next.discards.vowels).toContain(old1)
    expect(next.discards.consonants).toContain(old2)
  })
})

describe('solo_mia', () => {
  it('moves specified board card to source hand', () => {
    const target = makeLetter({ id: 'bc1', letter: 'U', kind: 'vowel' })
    const other = makeLetter({ id: 'bc2', letter: 'I', kind: 'vowel' })
    const state = makeState({
      centralBoard: [target, other],
      hands: { p1: { letters: [], actions: [] }, p2: { letters: [], actions: [] }, p3: { letters: [], actions: [] } },
    })
    const action = makeActionCard({ actionId: 'solo_mia' })
    const next = applyActionEffect(state, action, 'p1', null, { cardId: 'bc1' })
    expect(next.centralBoard).toHaveLength(1)
    expect(next.centralBoard[0].id).toBe('bc2')
    expect(next.hands.p1.letters).toHaveLength(1)
    expect(next.hands.p1.letters[0].id).toBe('bc1')
  })

  it('picks a random card when no cardId in payload', () => {
    const bc = makeLetter({ id: 'bc1', letter: 'A', kind: 'vowel' })
    const state = makeState({
      centralBoard: [bc],
      hands: { p1: { letters: [], actions: [] }, p2: { letters: [], actions: [] }, p3: { letters: [], actions: [] } },
    })
    const action = makeActionCard({ actionId: 'solo_mia' })
    const next = applyActionEffect(state, action, 'p1', null, {}, rng0)
    expect(next.centralBoard).toHaveLength(0)
    expect(next.hands.p1.letters[0].id).toBe('bc1')
  })

  it('returns state unchanged when board is empty', () => {
    const state = makeState({ centralBoard: [] })
    const action = makeActionCard({ actionId: 'solo_mia' })
    const next = applyActionEffect(state, action, 'p1', null, {})
    expect(next).toBe(state)
  })
})

// ── Attacks ─────────────────────────────────────────────────────────────────

describe('out_one', () => {
  it('takes one letter from each other player and sends to shuffled deck', () => {
    const p2l = makeLetter({ id: 'p2l', kind: 'vowel' })
    const p3l = makeConsonant({ id: 'p3l' })
    const state = makeState({
      hands: {
        p1: { letters: [makeLetter()], actions: [] },
        p2: { letters: [p2l], actions: [] },
        p3: { letters: [p3l], actions: [] },
      },
      decks: { vowelDeck: [], consonantDeck: [], actionDeck: [] },
    })
    const action = makeActionCard({ actionId: 'out_one' })
    const next = applyActionEffect(state, action, 'p1', null, {}, rng0)
    expect(next.hands.p2.letters).toHaveLength(0)
    expect(next.hands.p3.letters).toHaveLength(0)
    expect(next.hands.p1.letters).toHaveLength(1) // source unchanged
    expect(next.decks.vowelDeck.length + next.decks.consonantDeck.length).toBe(2)
  })

  it('ignores players with empty hands', () => {
    const state = makeState({
      hands: {
        p1: { letters: [makeLetter()], actions: [] },
        p2: { letters: [], actions: [] },
        p3: { letters: [], actions: [] },
      },
    })
    const action = makeActionCard({ actionId: 'out_one' })
    const next = applyActionEffect(state, action, 'p1', null, {}, rng0)
    expect(next.hands.p1.letters).toHaveLength(1)
  })
})

describe('great_heist', () => {
  it('steals one letter from each other player into source hand', () => {
    const p2l = makeLetter({ id: 'p2l', kind: 'vowel' })
    const p3l = makeConsonant({ id: 'p3l' })
    const state = makeState({
      hands: {
        p1: { letters: [], actions: [] },
        p2: { letters: [p2l], actions: [] },
        p3: { letters: [p3l], actions: [] },
      },
    })
    const action = makeActionCard({ actionId: 'great_heist' })
    const next = applyActionEffect(state, action, 'p1', null, {}, rng0)
    expect(next.hands.p1.letters).toHaveLength(2)
    const ids = next.hands.p1.letters.map(c => c.id)
    expect(ids).toContain('p2l')
    expect(ids).toContain('p3l')
    expect(next.hands.p2.letters).toHaveLength(0)
    expect(next.hands.p3.letters).toHaveLength(0)
  })
})

describe('steal_letter', () => {
  it('moves specific card from target to source', () => {
    const stolen = makeLetter({ id: 'stolen', letter: 'U' })
    const other = makeLetter({ id: 'other', letter: 'I' })
    const state = makeState({
      hands: {
        p1: { letters: [], actions: [] },
        p2: { letters: [stolen, other], actions: [] },
        p3: { letters: [], actions: [] },
      },
    })
    const action = makeActionCard({ actionId: 'steal_letter' })
    const next = applyActionEffect(state, action, 'p1', 'p2', { cardId: 'stolen' })
    expect(next.hands.p1.letters[0].id).toBe('stolen')
    expect(next.hands.p2.letters).toHaveLength(1)
    expect(next.hands.p2.letters[0].id).toBe('other')
  })

  it('takes a random card when no cardId specified', () => {
    const card = makeLetter({ id: 'only' })
    const state = makeState({
      hands: {
        p1: { letters: [], actions: [] },
        p2: { letters: [card], actions: [] },
        p3: { letters: [], actions: [] },
      },
    })
    const action = makeActionCard({ actionId: 'steal_letter' })
    const next = applyActionEffect(state, action, 'p1', 'p2', {}, rng0)
    expect(next.hands.p1.letters[0].id).toBe('only')
    expect(next.hands.p2.letters).toHaveLength(0)
  })

  it('returns state unchanged when target hand is empty', () => {
    const state = makeState({
      hands: {
        p1: { letters: [], actions: [] },
        p2: { letters: [], actions: [] },
        p3: { letters: [], actions: [] },
      },
    })
    const action = makeActionCard({ actionId: 'steal_letter' })
    const next = applyActionEffect(state, action, 'p1', 'p2', {}, rng0)
    expect(next).toBe(state)
  })
})

describe('swap_all', () => {
  it('swaps all letters between source and target', () => {
    const srcLetter = makeLetter({ id: 'src', letter: 'A', kind: 'vowel' })
    const tgtLetter = makeConsonant({ id: 'tgt', letter: 'N' })
    const state = makeState({
      hands: {
        p1: { letters: [srcLetter], actions: [] },
        p2: { letters: [tgtLetter], actions: [] },
        p3: { letters: [], actions: [] },
      },
    })
    const action = makeActionCard({ actionId: 'swap_all' })
    const next = applyActionEffect(state, action, 'p1', 'p2', {})
    expect(next.hands.p1.letters[0].id).toBe('tgt')
    expect(next.hands.p2.letters[0].id).toBe('src')
  })

  it('payload is ignored: always full swap, never partial', () => {
    const v1 = makeLetter({ id: 'v1', kind: 'vowel' })
    const c1 = makeConsonant({ id: 'c1' })
    const tgtLetter = makeConsonant({ id: 'tgt', letter: 'R' })
    const state = makeState({
      hands: {
        p1: { letters: [v1, c1], actions: [] },
        p2: { letters: [tgtLetter], actions: [] },
        p3: { letters: [], actions: [] },
      },
    })
    const action = makeActionCard({ actionId: 'swap_all' })
    const next = applyActionEffect(state, action, 'p1', 'p2', { fromIds: ['v1'] })
    // Manual rule: no per-card selection. Even with fromIds, all letters swap.
    expect(next.hands.p1.letters.map(c => c.id)).toEqual(['tgt'])
    expect(next.hands.p2.letters.map(c => c.id).sort()).toEqual(['c1', 'v1'])
  })
})

describe('swap_one', () => {
  it('swaps one letter by targetKind from target real hand', () => {
    const fromCard = makeLetter({ id: 'from', kind: 'vowel' })
    const toCard = makeConsonant({ id: 'to', letter: 'R' })
    const state = makeState({
      hands: {
        p1: { letters: [fromCard], actions: [] },
        p2: { letters: [toCard], actions: [] },
        p3: { letters: [], actions: [] },
      },
    })
    const action = makeActionCard({ actionId: 'swap_one' })
    const next = applyActionEffect(state, action, 'p1', 'p2', { fromId: 'from', targetKind: 'consonant' }, rng0)
    expect(next.hands.p1.letters).toHaveLength(1)
    expect(next.hands.p1.letters[0].id).toBe('to')
    expect(next.hands.p2.letters).toHaveLength(1)
    expect(next.hands.p2.letters[0].id).toBe('from')
  })

  it('swaps specific cards between two hands using explicit toId', () => {
    const fromCard = makeLetter({ id: 'from', letter: 'A', kind: 'vowel' })
    const toCard = makeConsonant({ id: 'to', letter: 'N' })
    const state = makeState({
      hands: {
        p1: { letters: [fromCard], actions: [] },
        p2: { letters: [toCard], actions: [] },
        p3: { letters: [], actions: [] },
      },
    })
    const action = makeActionCard({ actionId: 'swap_one' })
    const next = applyActionEffect(state, action, 'p1', 'p2', { fromId: 'from', toId: 'to' })
    expect(next.hands.p1.letters[0].id).toBe('to')
    expect(next.hands.p2.letters[0].id).toBe('from')
  })
})

describe('explosion', () => {
  it('applies -4 score modifier to target, not source', () => {
    const state = makeState()
    const action = makeActionCard({ actionId: 'explosion' })
    const next = applyActionEffect(state, action, 'p1', 'p2', {})
    expect(next.scoreModifiers.p2).toBe(-4)
    expect(next.scoreModifiers.p1).toBeUndefined()
  })

  it('accumulates with existing target modifier', () => {
    const state = makeState({ scoreModifiers: { p2: 6 } })
    const action = makeActionCard({ actionId: 'explosion' })
    const next = applyActionEffect(state, action, 'p1', 'p2', {})
    expect(next.scoreModifiers.p2).toBe(2)
  })
})

describe('discard_one', () => {
  it('removes specific card from target and sends it to deck', () => {
    const toDiscard = makeLetter({ id: 'disc', letter: 'A', kind: 'vowel' })
    const keep = makeLetter({ id: 'keep', letter: 'I', kind: 'vowel' })
    const state = makeState({
      hands: {
        p1: { letters: [makeLetter()], actions: [] },
        p2: { letters: [toDiscard, keep], actions: [] },
        p3: { letters: [], actions: [] },
      },
      decks: { vowelDeck: [], consonantDeck: [], actionDeck: [] },
    })
    const action = makeActionCard({ actionId: 'discard_one' })
    const next = applyActionEffect(state, action, 'p1', 'p2', { cardId: 'disc' })
    expect(next.hands.p2.letters).toHaveLength(1)
    expect(next.hands.p2.letters[0].id).toBe('keep')
    expect(next.decks.vowelDeck).toHaveLength(1)
    expect(next.decks.vowelDeck[0].id).toBe('disc')
  })

  it('discards random card when no cardId specified', () => {
    const only = makeLetter({ id: 'only', kind: 'vowel' })
    const state = makeState({
      hands: {
        p1: { letters: [], actions: [] },
        p2: { letters: [only], actions: [] },
        p3: { letters: [], actions: [] },
      },
      decks: { vowelDeck: [], consonantDeck: [], actionDeck: [] },
    })
    const action = makeActionCard({ actionId: 'discard_one' })
    const next = applyActionEffect(state, action, 'p1', 'p2', {}, rng0)
    expect(next.hands.p2.letters).toHaveLength(0)
    expect(next.decks.vowelDeck).toHaveLength(1)
  })
})

// ── Rule forcing ─────────────────────────────────────────────────────────────

describe('use_vowel / use_consonant / use_letter', () => {
  it('adds forced rule to ALL other players, not to source', () => {
    const state = makeState()
    const action = makeActionCard({ actionId: 'use_vowel', target: 'all' })
    const next = applyActionEffect(state, action, 'p1', null, { letter: 'A' })
    // p2 and p3 get the rule
    expect(next.forcedRules.p2).toHaveLength(1)
    expect(next.forcedRules.p3).toHaveLength(1)
    expect(next.forcedRules.p2[0].actionId).toBe('use_vowel')
    expect(next.forcedRules.p2[0].payload).toEqual({ letter: 'A' })
    // Source (p1) does NOT get the rule
    expect(next.forcedRules.p1).toBeUndefined()
  })

  it('use_consonant works the same as use_vowel', () => {
    const state = makeState()
    const action = makeActionCard({ actionId: 'use_consonant', target: 'all' })
    const next = applyActionEffect(state, action, 'p1', null, { letter: 'S' })
    expect(next.forcedRules.p2[0].actionId).toBe('use_consonant')
    expect(next.forcedRules.p1).toBeUndefined()
  })

  it('use_letter applies to all others', () => {
    const state = makeState()
    const action = makeActionCard({ actionId: 'use_letter', target: 'all' })
    const next = applyActionEffect(state, action, 'p1', null, { letter: 'N' })
    expect(next.forcedRules.p2[0].payload.letter).toBe('N')
  })
})

describe('philologist', () => {
  it('adds forced rule only to target player', () => {
    const state = makeState()
    const action = makeActionCard({ actionId: 'philologist', target: 'one' })
    const next = applyActionEffect(state, action, 'p1', 'p2', {})
    expect(next.forcedRules.p2).toHaveLength(1)
    expect(next.forcedRules.p2[0].actionId).toBe('philologist')
    expect(next.forcedRules.p3).toBeUndefined()
    expect(next.forcedRules.p1).toBeUndefined()
  })
})

describe('brain_squeeze', () => {
  it('adds forced rule only to target player', () => {
    const state = makeState()
    const action = makeActionCard({ actionId: 'brain_squeeze', target: 'one' })
    const next = applyActionEffect(state, action, 'p1', 'p3', {})
    expect(next.forcedRules.p3).toHaveLength(1)
    expect(next.forcedRules.p3[0].actionId).toBe('brain_squeeze')
    expect(next.forcedRules.p2).toBeUndefined()
    expect(next.forcedRules.p1).toBeUndefined()
  })
})

describe('one_for_all', () => {
  it('moves specified card from TARGET hand to central board', () => {
    const tCard = makeLetter({ id: 'tcard1', letter: 'A', kind: 'vowel' })
    const tOther = makeLetter({ id: 'tcard2', letter: 'E' })
    const state = makeState({
      hands: {
        p1: { letters: [], actions: [] },
        p2: { letters: [tCard, tOther], actions: [] },
        p3: { letters: [], actions: [] },
      },
      centralBoard: [],
    })
    const action = makeActionCard({ actionId: 'one_for_all', target: 'one' })
    const next = applyActionEffect(state, action, 'p1', 'p2', { cardId: 'tcard1' })
    expect(next.centralBoard).toHaveLength(1)
    expect(next.centralBoard[0].id).toBe('tcard1')
    expect(next.hands.p2.letters).toHaveLength(1)
    expect(next.hands.p2.letters[0].id).toBe('tcard2')
    // Source hand unchanged
    expect(next.hands.p1.letters).toHaveLength(0)
  })

  it('picks random card from target hand when no cardId specified', () => {
    const tCard = makeLetter({ id: 'only', letter: 'A' })
    const state = makeState({
      hands: {
        p1: { letters: [], actions: [] },
        p2: { letters: [tCard], actions: [] },
        p3: { letters: [], actions: [] },
      },
      centralBoard: [],
    })
    const action = makeActionCard({ actionId: 'one_for_all' })
    const next = applyActionEffect(state, action, 'p1', 'p2', {}, rng0)
    expect(next.centralBoard[0].id).toBe('only')
    expect(next.hands.p2.letters).toHaveLength(0)
  })

  it('returns state unchanged when target hand is empty', () => {
    const state = makeState({
      hands: {
        p1: { letters: [], actions: [] },
        p2: { letters: [], actions: [] },
        p3: { letters: [], actions: [] },
      },
    })
    const action = makeActionCard({ actionId: 'one_for_all' })
    const next = applyActionEffect(state, action, 'p1', 'p2', {}, rng0)
    expect(next).toBe(state)
  })

  it('picks a card by targetKind from target real hand when no cardId specified', () => {
    const vowel = makeLetter({ id: 'dv1', letter: 'A', kind: 'vowel' })
    const cons = makeConsonant({ id: 'dc1', letter: 'R' })
    const state = makeState({
      hands: {
        p1: { letters: [], actions: [] },
        p2: { letters: [vowel, cons], actions: [] },
        p3: { letters: [], actions: [] },
      },
      centralBoard: [],
    })
    const action = makeActionCard({ actionId: 'one_for_all' })
    const next = applyActionEffect(state, action, 'p1', 'p2', { targetKind: 'vowel' }, rng0)
    expect(next.centralBoard).toHaveLength(1)
    expect(next.centralBoard[0].id).toBe('dv1')
    expect(next.hands.p2.letters).toHaveLength(1)
    expect(next.hands.p2.letters[0].id).toBe('dc1')
  })
})


// ── Unknown action ───────────────────────────────────────────────────────────

describe('unknown / deferred action', () => {
  it('returns state unchanged', () => {
    const state = makeState()
    const action = makeActionCard({ actionId: 'inventa_tu_regla' })
    const next = applyActionEffect(state, action, 'p1', null, {})
    expect(next).toBe(state)
  })
})

// ── Helpers ──────────────────────────────────────────────────────────────────

describe('getActiveEffectsFor', () => {
  it('returns empty arrays/zero when player has no effects', () => {
    const state = makeState()
    const { forcedRules, scoreModifier } = getActiveEffectsFor(state, 'p1')
    expect(forcedRules).toEqual([])
    expect(scoreModifier).toBe(0)
  })

  it('returns active forced rules and score modifier', () => {
    const state = makeState({
      forcedRules: { p1: [{ actionId: 'philologist', source: 'p2', payload: {} }] },
      scoreModifiers: { p1: -4 },
    })
    const { forcedRules, scoreModifier } = getActiveEffectsFor(state, 'p1')
    expect(forcedRules).toHaveLength(1)
    expect(scoreModifier).toBe(-4)
  })
})

describe('clearTrickState', () => {
  it('resets forcedRules and scoreModifiers to empty objects', () => {
    const state = makeState({
      forcedRules: { p1: [{ actionId: 'philologist' }] },
      scoreModifiers: { p1: 6, p2: -4 },
    })
    const next = clearTrickState(state)
    expect(next.forcedRules).toEqual({})
    expect(next.scoreModifiers).toEqual({})
  })
})

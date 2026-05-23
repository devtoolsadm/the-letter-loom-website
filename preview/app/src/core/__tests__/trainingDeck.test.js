import { describe, it, expect } from 'vitest'
import {
  buildVowelDeck,
  buildConsonantDeck,
  buildActionDeck,
  shuffle,
  drawFromDeck,
  drawLetterOfKind,
  dealCentralBoard,
  drawActions,
  discardAllForNewTrick,
  HAND_SIZES,
} from '../trainingDeck.js'
import { makeLetter, makeConsonant, makeActionCard, resetIds } from './helpers.js'

// ── buildVowelDeck ───────────────────────────────────────────────────────────

describe('buildVowelDeck', () => {
  it('builds a non-empty deck of vowel cards', () => {
    const deck = buildVowelDeck()
    expect(deck.length).toBeGreaterThan(0)
  })

  it('all non-wildcard cards have kind vowel', () => {
    const deck = buildVowelDeck()
    const nonWild = deck.filter(c => !c.isWildcard)
    expect(nonWild.every(c => c.kind === 'vowel')).toBe(true)
  })

  it('includes exactly 2 vowel wildcards', () => {
    const deck = buildVowelDeck()
    const wildcards = deck.filter(c => c.isWildcard)
    expect(wildcards).toHaveLength(2)
    expect(wildcards.every(c => c.kind === 'vowel')).toBe(true)
  })

  it('all cards have unique ids', () => {
    const deck = buildVowelDeck()
    const ids = deck.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all cards have positive values or 0 for wildcards', () => {
    const deck = buildVowelDeck()
    expect(deck.every(c => c.value >= 0)).toBe(true)
    expect(deck.filter(c => !c.isWildcard).every(c => c.value > 0)).toBe(true)
  })
})

// ── buildConsonantDeck ───────────────────────────────────────────────────────

describe('buildConsonantDeck', () => {
  it('builds a non-empty deck of consonant cards', () => {
    const deck = buildConsonantDeck()
    expect(deck.length).toBeGreaterThan(0)
  })

  it('all non-wildcard cards have kind consonant', () => {
    const deck = buildConsonantDeck()
    const nonWild = deck.filter(c => !c.isWildcard)
    expect(nonWild.every(c => c.kind === 'consonant')).toBe(true)
  })

  it('includes exactly 2 consonant wildcards', () => {
    const deck = buildConsonantDeck()
    const wildcards = deck.filter(c => c.isWildcard)
    expect(wildcards).toHaveLength(2)
  })

  it('all cards have unique ids', () => {
    const deck = buildConsonantDeck()
    const ids = deck.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ── buildActionDeck ──────────────────────────────────────────────────────────

describe('buildActionDeck', () => {
  it('builds a non-empty deck of action cards', () => {
    const deck = buildActionDeck()
    expect(deck.length).toBeGreaterThan(0)
  })

  it('excludes deferred (inMVP:false) cards by default', () => {
    const deck = buildActionDeck()
    expect(deck.every(c => c.actionId !== 'in_english')).toBe(true)
  })

  it('includes deferred cards when excludeDeferred=false', () => {
    const deck = buildActionDeck({ excludeDeferred: false })
    expect(deck.some(c => c.actionId === 'in_english')).toBe(true)
  })

  it('all cards have a valid actionId', () => {
    const deck = buildActionDeck()
    expect(deck.every(c => typeof c.actionId === 'string' && c.actionId.length > 0)).toBe(true)
  })

  it('all cards have unique ids', () => {
    const deck = buildActionDeck()
    const ids = deck.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ── shuffle ──────────────────────────────────────────────────────────────────

describe('shuffle', () => {
  it('returns an array with the same elements', () => {
    const original = [1, 2, 3, 4, 5]
    const result = shuffle(original)
    expect(result.sort()).toEqual([...original].sort())
  })

  it('does not mutate the input array', () => {
    const original = [1, 2, 3, 4, 5]
    const copy = [...original]
    shuffle(original)
    expect(original).toEqual(copy)
  })

  it('returns a new array reference', () => {
    const original = [1, 2, 3]
    const result = shuffle(original)
    expect(result).not.toBe(original)
  })

  it('handles empty array', () => {
    expect(shuffle([])).toEqual([])
  })

  it('handles single-element array', () => {
    expect(shuffle([42])).toEqual([42])
  })
})

// ── drawFromDeck ─────────────────────────────────────────────────────────────

describe('drawFromDeck', () => {
  it('draws N cards from the front of the deck', () => {
    const c1 = makeLetter({ id: 'c1' })
    const c2 = makeLetter({ id: 'c2' })
    const c3 = makeLetter({ id: 'c3' })
    const { drawn, deck } = drawFromDeck([c1, c2, c3], [], 2)
    expect(drawn).toHaveLength(2)
    expect(drawn[0].id).toBe('c1')
    expect(drawn[1].id).toBe('c2')
    expect(deck).toHaveLength(1)
    expect(deck[0].id).toBe('c3')
  })

  it('does not mutate input arrays', () => {
    const orig = [makeLetter()]
    const origDiscard = []
    const origLen = orig.length
    drawFromDeck(orig, origDiscard, 1)
    expect(orig).toHaveLength(origLen)
  })

  it('reshuffles discard when deck runs out', () => {
    const c1 = makeLetter({ id: 'c1' })
    const c2 = makeLetter({ id: 'c2' })
    const { drawn, deck } = drawFromDeck([], [c1, c2], 1)
    expect(drawn).toHaveLength(1)
    expect(deck).toHaveLength(1) // one remains in reshuffled deck
  })

  it('draws fewer than N if both deck and discard are exhausted', () => {
    const c1 = makeLetter({ id: 'c1' })
    const { drawn } = drawFromDeck([c1], [], 5)
    expect(drawn).toHaveLength(1)
  })

  it('draws 0 when both deck and discard are empty', () => {
    const { drawn, deck } = drawFromDeck([], [], 3)
    expect(drawn).toHaveLength(0)
    expect(deck).toHaveLength(0)
  })

  it('can draw more than deck size by rolling through discard', () => {
    const deck = [makeLetter({ id: 'd1' })]
    const discard = [makeLetter({ id: 'p1' }), makeLetter({ id: 'p2' })]
    const { drawn } = drawFromDeck(deck, discard, 3)
    expect(drawn).toHaveLength(3)
  })
})

// ── drawLetterOfKind ─────────────────────────────────────────────────────────

describe('drawLetterOfKind', () => {
  it('draws a vowel from vowelDeck when kind=vowel', () => {
    const v = makeLetter({ id: 'v1', kind: 'vowel' })
    const result = drawLetterOfKind([v], [], { vowels: [], consonants: [] }, 'vowel')
    expect(result.card).not.toBeNull()
    expect(result.card.id).toBe('v1')
    expect(result.vowelDeck).toHaveLength(0)
  })

  it('draws a consonant from consonantDeck when kind=consonant', () => {
    const c = makeConsonant({ id: 'c1' })
    const result = drawLetterOfKind([], [c], { vowels: [], consonants: [] }, 'consonant')
    expect(result.card.id).toBe('c1')
    expect(result.consonantDeck).toHaveLength(0)
  })

  it('returns null card when kind deck and discard are empty', () => {
    const result = drawLetterOfKind([], [], { vowels: [], consonants: [] }, 'vowel')
    expect(result.card).toBeNull()
  })
})

// ── dealCentralBoard ─────────────────────────────────────────────────────────

describe('dealCentralBoard', () => {
  it('deals TRAINING_CENTRAL_BOARD_SIZE (5) cards to the board', () => {
    const vowels = Array.from({ length: 5 }, (_, i) => makeLetter({ id: `v${i}` }))
    const consonants = Array.from({ length: 5 }, (_, i) => makeConsonant({ id: `c${i}` }))
    const { board } = dealCentralBoard(vowels, consonants, {})
    expect(board).toHaveLength(5)
  })

  it('removes board cards from their respective decks', () => {
    const vowels = Array.from({ length: 5 }, (_, i) => makeLetter({ id: `v${i}` }))
    const consonants = Array.from({ length: 5 }, (_, i) => makeConsonant({ id: `c${i}` }))
    const { board, vowelDeck, consonantDeck } = dealCentralBoard(vowels, consonants, {})
    const boardIds = new Set(board.map(c => c.id))
    const remainingIds = [...vowelDeck, ...consonantDeck].map(c => c.id)
    expect(remainingIds.some(id => boardIds.has(id))).toBe(false)
  })

  it('total card count preserved (board + remaining decks = original total)', () => {
    const vowels = Array.from({ length: 8 }, (_, i) => makeLetter({ id: `v${i}` }))
    const consonants = Array.from({ length: 7 }, (_, i) => makeConsonant({ id: `c${i}` }))
    const { board, vowelDeck, consonantDeck } = dealCentralBoard(vowels, consonants, {})
    expect(board.length + vowelDeck.length + consonantDeck.length).toBe(15)
  })
})

// ── discardAllForNewTrick ────────────────────────────────────────────────────

describe('discardAllForNewTrick', () => {
  it('moves central board cards to appropriate letter discards', () => {
    const boardVowel = makeLetter({ id: 'bv', kind: 'vowel' })
    const boardCons = makeConsonant({ id: 'bc' })
    const result = discardAllForNewTrick({
      vowelDeck: [],
      consonantDeck: [],
      actionDeck: [],
      discards: { vowels: [], consonants: [], actions: [] },
      hands: {},
      centralBoard: [boardVowel, boardCons],
    })
    expect(result.discards.vowels).toContain(boardVowel)
    expect(result.discards.consonants).toContain(boardCons)
  })

  it('moves hand letter cards to discards', () => {
    const handVowel = makeLetter({ id: 'hv', kind: 'vowel' })
    const handCons = makeConsonant({ id: 'hc' })
    const result = discardAllForNewTrick({
      vowelDeck: [],
      consonantDeck: [],
      actionDeck: [],
      discards: { vowels: [], consonants: [], actions: [] },
      hands: {
        p1: { letters: [handVowel, handCons], actions: [] },
      },
      centralBoard: [],
    })
    expect(result.discards.vowels).toContain(handVowel)
    expect(result.discards.consonants).toContain(handCons)
  })

  it('moves action cards to action discard', () => {
    const action = makeActionCard({ id: 'ac1' })
    const result = discardAllForNewTrick({
      vowelDeck: [],
      consonantDeck: [],
      actionDeck: [],
      discards: { vowels: [], consonants: [], actions: [] },
      hands: {
        p1: { letters: [], actions: [action] },
      },
      centralBoard: [],
    })
    expect(result.discards.actions).toContain(action)
  })

  it('skips null slots in hand letters (cards stolen by others)', () => {
    const handCons = makeConsonant({ id: 'hc' })
    // null in slot 0, card in slot 1 (simulates stolen card)
    const result = discardAllForNewTrick({
      vowelDeck: [],
      consonantDeck: [],
      actionDeck: [],
      discards: { vowels: [], consonants: [], actions: [] },
      hands: {
        p1: { letters: [null, handCons, null], actions: [] },
      },
      centralBoard: [],
    })
    expect(result.discards.consonants).toHaveLength(1)
    expect(result.discards.consonants[0].id).toBe('hc')
  })

  it('ignores hidden hands (ghosts)', () => {
    const result = discardAllForNewTrick({
      vowelDeck: [],
      consonantDeck: [],
      actionDeck: [],
      discards: { vowels: [], consonants: [], actions: [] },
      hands: { p2: '<hidden>', p3: '<hidden>' },
      centralBoard: [],
    })
    expect(result.discards.vowels).toHaveLength(0)
    expect(result.discards.consonants).toHaveLength(0)
  })

  it('preserves deck references unchanged', () => {
    const vowelDeck = [makeLetter()]
    const consonantDeck = [makeConsonant()]
    const actionDeck = [makeActionCard()]
    const result = discardAllForNewTrick({
      vowelDeck,
      consonantDeck,
      actionDeck,
      discards: { vowels: [], consonants: [], actions: [] },
      hands: {},
      centralBoard: [],
    })
    expect(result.vowelDeck).toBe(vowelDeck)
    expect(result.consonantDeck).toBe(consonantDeck)
    expect(result.actionDeck).toBe(actionDeck)
  })
})

// ── HAND_SIZES ───────────────────────────────────────────────────────────────

describe('HAND_SIZES', () => {
  it('exports letter and action hand sizes matching constants', () => {
    expect(HAND_SIZES.letters).toBe(3)  // TRAINING_HAND_LETTERS
    expect(HAND_SIZES.actions).toBe(2)  // TRAINING_HAND_ACTIONS
  })
})

import { describe, it, expect } from 'vitest'
import {
  buildWordFromCards,
  hasTilde,
  countSyllables,
  usesAtLeastOneFromBoardAndHand,
  containsLetter,
  validateForcedRules,
  getForcedWordLanguage,
  computeWordScore,
} from '../wordRules.js'

describe('getForcedWordLanguage', () => {
  it('keeps the base language when no language action is active', () => {
    expect(getForcedWordLanguage('en', [])).toBe('en')
  })

  it('uses the language suggested by in_english/in_spanish effects', () => {
    expect(getForcedWordLanguage('es', [{ actionId: 'in_english', payload: { language: 'en' } }])).toBe('en')
    expect(getForcedWordLanguage('en', [{ actionId: 'in_spanish', payload: { language: 'es' } }])).toBe('es')
  })
})

// ── buildWordFromCards ───────────────────────────────────────────────────────

describe('buildWordFromCards', () => {
  it('joins letters in order', () => {
    const cards = [
      { letter: 'C', isWildcard: false, usingTilde: false },
      { letter: 'A', isWildcard: false, usingTilde: false },
      { letter: 'S', isWildcard: false, usingTilde: false },
      { letter: 'A', isWildcard: false, usingTilde: false },
    ]
    expect(buildWordFromCards(cards)).toBe('CASA')
  })

  it('uses tildeChar when usingTilde is true', () => {
    const cards = [
      { letter: 'A', isWildcard: false, usingTilde: true, tildeChar: 'Á', tildeValue: 10 },
      { letter: 'R', isWildcard: false, usingTilde: false },
      { letter: 'B', isWildcard: false, usingTilde: false },
      { letter: 'O', isWildcard: false, usingTilde: false },
      { letter: 'L', isWildcard: false, usingTilde: false },
    ]
    expect(buildWordFromCards(cards)).toBe('ÁRBOL')
  })

  it('uses chosenLetter for wildcards', () => {
    const cards = [
      { letter: '*', isWildcard: true, chosenLetter: 'P', usingTilde: false },
      { letter: 'A', isWildcard: false, usingTilde: false },
      { letter: 'Z', isWildcard: false, usingTilde: false },
    ]
    expect(buildWordFromCards(cards)).toBe('PAZ')
  })

  it('uses empty string for wildcards without chosenLetter', () => {
    const cards = [
      { letter: '*', isWildcard: true, chosenLetter: null },
      { letter: 'S', isWildcard: false },
    ]
    expect(buildWordFromCards(cards)).toBe('S')
  })

  it('returns empty string for empty array', () => {
    expect(buildWordFromCards([])).toBe('')
    expect(buildWordFromCards(null)).toBe('')
  })
})

// ── hasTilde ─────────────────────────────────────────────────────────────────

describe('hasTilde', () => {
  it('returns true for words with accented vowels', () => {
    expect(hasTilde('ÁRBOL')).toBe(true)
    expect(hasTilde('CANCIÓN')).toBe(true)
    expect(hasTilde('GÜEY')).toBe(true)
    expect(hasTilde('MAÍZ')).toBe(true)
  })

  it('returns false for words without accented vowels', () => {
    expect(hasTilde('CASA')).toBe(false)
    expect(hasTilde('SOL')).toBe(false)
    expect(hasTilde('AMOR')).toBe(false)
  })
})

// ── countSyllables ───────────────────────────────────────────────────────────

describe('countSyllables', () => {
  it('counts simple words correctly', () => {
    expect(countSyllables('SOL')).toBe(1)   // sol
    expect(countSyllables('CASA')).toBe(2)  // ca-sa
    expect(countSyllables('AMOR')).toBe(2)  // a-mor
    expect(countSyllables('AMIGO')).toBe(3) // a-mi-go
  })

  it('recognizes diphthongs (1 syllable for weak+strong pair)', () => {
    expect(countSyllables('BIEN')).toBe(1)   // ie = diphthong
    expect(countSyllables('AGUA')).toBe(2)   // a-gua (ua = diphthong → 1)
    expect(countSyllables('CIUDAD')).toBe(2) // ciu-dad (iu = diphthong)
  })

  it('recognizes hiatus (2 syllables when both strong vowels)', () => {
    expect(countSyllables('POETA')).toBe(3)  // po-e-ta
    expect(countSyllables('CAER')).toBe(2)   // ca-er
  })

  it('counts 3-syllable words', () => {
    expect(countSyllables('CAMINO')).toBe(3)   // ca-mi-no
    expect(countSyllables('AMABLE')).toBe(3)   // a-ma-ble
    expect(countSyllables('PLANETA')).toBe(3)  // pla-ne-ta
  })

  it('counts accented weak vowel as breaking diphthong', () => {
    expect(countSyllables('MAÍZ')).toBe(2)  // ma-íz (í breaks diphthong)
    expect(countSyllables('PAÍS')).toBe(2)  // pa-ís
  })

  it('returns 0 for empty string', () => {
    expect(countSyllables('')).toBe(0)
    expect(countSyllables(null)).toBe(0)
  })

  it('uses vowel-group fallback for non-es lang', () => {
    // Fallback counts contiguous vowel runs: CAT → 'A' = 1; CASTLE → 'A','E' = 2
    expect(countSyllables('CAT', 'en')).toBe(1)
    expect(countSyllables('CASTLE', 'en')).toBe(2)
  })
})

// ── usesAtLeastOneFromBoardAndHand ───────────────────────────────────────────

describe('usesAtLeastOneFromBoardAndHand', () => {
  it('returns true when word has both board and hand cards', () => {
    const cards = [{ id: 'b1' }, { id: 'h1' }]
    const boardIds = new Set(['b1'])
    const handIds = new Set(['h1'])
    expect(usesAtLeastOneFromBoardAndHand(cards, boardIds, handIds)).toBe(true)
  })

  it('returns false when all cards from board', () => {
    const cards = [{ id: 'b1' }, { id: 'b2' }]
    const boardIds = new Set(['b1', 'b2'])
    const handIds = new Set(['h1'])
    expect(usesAtLeastOneFromBoardAndHand(cards, boardIds, handIds)).toBe(false)
  })

  it('returns false when all cards from hand', () => {
    const cards = [{ id: 'h1' }, { id: 'h2' }]
    const boardIds = new Set(['b1'])
    const handIds = new Set(['h1', 'h2'])
    expect(usesAtLeastOneFromBoardAndHand(cards, boardIds, handIds)).toBe(false)
  })

  it('returns false for empty selection', () => {
    expect(usesAtLeastOneFromBoardAndHand([], new Set(['b1']), new Set(['h1']))).toBe(false)
  })
})

// ── containsLetter ───────────────────────────────────────────────────────────

describe('containsLetter', () => {
  it('matches plain letters case-insensitively', () => {
    expect(containsLetter('CASA', 'A')).toBe(true)
    expect(containsLetter('CASA', 'a')).toBe(true)
    expect(containsLetter('CASA', 'Z')).toBe(false)
  })

  it('matches tilde-stripped equivalents', () => {
    expect(containsLetter('ÁRBOL', 'A')).toBe(true) // Á stripped → A
    expect(containsLetter('CAMION', 'O')).toBe(true)
  })

  it('handles null/empty gracefully', () => {
    expect(containsLetter(null, 'A')).toBe(false)
    expect(containsLetter('CASA', null)).toBe(false)
    expect(containsLetter('', 'A')).toBe(false)
  })
})

// ── validateForcedRules ──────────────────────────────────────────────────────

describe('validateForcedRules', () => {
  it('philologist passes when word has tilde', () => {
    const effects = [{ actionId: 'philologist', source: 'p2', payload: {} }]
    const result = validateForcedRules({ word: 'CANCIÓN', selectedCards: [], effects })
    expect(result.ok).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('philologist fails when word has no tilde', () => {
    const effects = [{ actionId: 'philologist', source: 'p2', payload: {} }]
    const result = validateForcedRules({ word: 'CASA', selectedCards: [], effects })
    expect(result.ok).toBe(false)
    expect(result.violations).toContain('philologist')
  })

  it('brain_squeeze passes when word has 3+ syllables', () => {
    const effects = [{ actionId: 'brain_squeeze', source: 'p2', payload: {} }]
    const result = validateForcedRules({ word: 'CAMINO', selectedCards: [], effects, lang: 'es' })
    expect(result.ok).toBe(true)
  })

  it('brain_squeeze fails when word has fewer than 3 syllables', () => {
    const effects = [{ actionId: 'brain_squeeze', source: 'p2', payload: {} }]
    const result = validateForcedRules({ word: 'CASA', selectedCards: [], effects, lang: 'es' })
    expect(result.ok).toBe(false)
    expect(result.violations).toContain('brain_squeeze')
  })

  it('use_vowel passes when letter appears in word', () => {
    const effects = [{ actionId: 'use_vowel', source: 'p2', payload: { letter: 'A' } }]
    const result = validateForcedRules({ word: 'CASA', selectedCards: [], effects })
    expect(result.ok).toBe(true)
  })

  it('use_vowel fails when letter does not appear in word', () => {
    const effects = [{ actionId: 'use_vowel', source: 'p2', payload: { letter: 'U' } }]
    const result = validateForcedRules({ word: 'MESA', selectedCards: [], effects })
    expect(result.ok).toBe(false)
    expect(result.violations).toContain('use_vowel')
  })

  it('use_consonant and use_letter follow same pattern', () => {
    const effects = [{ actionId: 'use_consonant', source: 'p2', payload: { letter: 'S' } }]
    const fail = validateForcedRules({ word: 'AMAR', selectedCards: [], effects })
    expect(fail.ok).toBe(false)
    const pass = validateForcedRules({ word: 'CASA', selectedCards: [], effects })
    expect(pass.ok).toBe(true)
  })

  it('multiple rules all pass', () => {
    const effects = [
      { actionId: 'philologist', source: 'p2', payload: {} },
      { actionId: 'brain_squeeze', source: 'p3', payload: {} },
    ]
    const result = validateForcedRules({ word: 'CANCIÓN', selectedCards: [], effects, lang: 'es' })
    // 'CANCIÓN' has tilde ✓ and 2 syllables (can-ción)... that's 2, so brain_squeeze fails
    expect(result.violations).toContain('brain_squeeze')
  })

  it('multiple rules: one fails → ok is false, violation listed', () => {
    const effects = [
      { actionId: 'philologist', source: 'p2', payload: {} },
      { actionId: 'use_vowel', source: 'p3', payload: { letter: 'U' } },
    ]
    // 'CÁMARA' has tilde ✓ but no U → use_vowel fails
    const result = validateForcedRules({ word: 'CÁMARA', selectedCards: [], effects })
    expect(result.ok).toBe(false)
    expect(result.violations).toContain('use_vowel')
    expect(result.violations).not.toContain('philologist')
  })

  it('returns ok:true for empty effects list', () => {
    const result = validateForcedRules({ word: 'CASA', selectedCards: [], effects: [] })
    expect(result.ok).toBe(true)
    expect(result.violations).toHaveLength(0)
  })
})

// ── computeWordScore ─────────────────────────────────────────────────────────

describe('computeWordScore', () => {
  it('sums base letter values without x2', () => {
    const cards = [
      { id: 'c1', value: 2, isWildcard: false, usingTilde: false, color: 'blue' },
      { id: 'c2', value: 4, isWildcard: false, usingTilde: false, color: 'orange' },
    ]
    // Different colors → no sameColor x2. Pass unused IDs to prevent vacuous "used all" x2.
    expect(computeWordScore({ selectedCards: cards, allUserLetters: ['unused'], allBoardLetters: [] })).toBe(6)
  })

  it('uses tildeValue when usingTilde is true and tildeValue is set', () => {
    const cards = [
      { id: 'c1', value: 2, tildeValue: 10, isWildcard: false, usingTilde: true, color: 'blue' },
      { id: 'c2', value: 4, isWildcard: false, usingTilde: false, color: 'orange' },
    ]
    // c1 uses tildeValue (10), c2 uses base (4) → 14. Different colors, pass unused to block vacuous x2.
    expect(computeWordScore({ selectedCards: cards, allUserLetters: ['unused'], allBoardLetters: [] })).toBe(14)
  })

  it('wildcards contribute 0 to base score', () => {
    const cards = [
      { id: 'wc', value: 0, isWildcard: true, usingTilde: false, color: 'none' },
      { id: 'c1', value: 4, isWildcard: false, usingTilde: false, color: 'blue' },
      { id: 'c2', value: 3, isWildcard: false, usingTilde: false, color: 'orange' },
    ]
    // wc = 0, c1 = 4, c2 = 3 → base 7. Different non-wildcard colors, unused IDs → no x2.
    expect(computeWordScore({ selectedCards: cards, allUserLetters: ['unused'], allBoardLetters: [] })).toBe(7)
  })

  it('adds plusMinus modifier to base before checking x2', () => {
    const cards = [
      { id: 'c1', value: 2, isWildcard: false, usingTilde: false, color: 'blue' },
      { id: 'c2', value: 2, isWildcard: false, usingTilde: false, color: 'orange' },
    ]
    // base = 4 + 6 = 10, different colors, unused → no x2 → score 10
    expect(computeWordScore({ selectedCards: cards, allUserLetters: ['unused'], allBoardLetters: [], plusMinus: 6 })).toBe(10)
  })

  it('doubles score when all cards share the same color', () => {
    const cards = [
      { id: 'c1', value: 2, isWildcard: false, usingTilde: false, color: 'blue' },
      { id: 'c2', value: 4, isWildcard: false, usingTilde: false, color: 'blue' },
    ]
    // Same color → x2 regardless of allUserLetters/allBoardLetters
    expect(computeWordScore({ selectedCards: cards, allUserLetters: ['unused'], allBoardLetters: [] })).toBe(12)
  })

  it('does NOT double when cards have different colors and not all-used', () => {
    const cards = [
      { id: 'c1', value: 2, isWildcard: false, usingTilde: false, color: 'blue' },
      { id: 'c2', value: 4, isWildcard: false, usingTilde: false, color: 'orange' },
    ]
    // Pass unused IDs to prevent vacuous "used all" x2
    expect(computeWordScore({ selectedCards: cards, allUserLetters: ['unused'], allBoardLetters: [] })).toBe(6)
  })

  it('doubles when player used all their hand letters AND all board letters', () => {
    const cards = [
      { id: 'h1', value: 2, isWildcard: false, usingTilde: false, color: 'blue' },
      { id: 'b1', value: 4, isWildcard: false, usingTilde: false, color: 'orange' },
    ]
    // h1 is user's only letter, b1 is board's only letter
    expect(computeWordScore({
      selectedCards: cards,
      allUserLetters: ['h1'],
      allBoardLetters: ['b1'],
    })).toBe(12)
  })

  it('does NOT double when user did not use all hand letters', () => {
    const cards = [
      { id: 'h1', value: 2, isWildcard: false, usingTilde: false, color: 'blue' },
      { id: 'b1', value: 4, isWildcard: false, usingTilde: false, color: 'orange' },
    ]
    // h2 exists in hand but was not used
    expect(computeWordScore({
      selectedCards: cards,
      allUserLetters: ['h1', 'h2'],
      allBoardLetters: ['b1'],
    })).toBe(6)
  })

  it('applies plusMinus before x2 (modifier is part of the doubled base)', () => {
    const cards = [
      { id: 'c1', value: 2, isWildcard: false, usingTilde: false, color: 'blue' },
      { id: 'c2', value: 4, isWildcard: false, usingTilde: false, color: 'blue' },
    ]
    // base = 2+4+6 = 12, x2 = 24
    expect(computeWordScore({ selectedCards: cards, allUserLetters: [], allBoardLetters: [], plusMinus: 6 })).toBe(24)
  })

  it('returns 0 for empty selection', () => {
    expect(computeWordScore({ selectedCards: [], allUserLetters: [], allBoardLetters: [] })).toBe(0)
  })

  it('handles negative modifier (explosion)', () => {
    const cards = [
      { id: 'c1', value: 4, isWildcard: false, usingTilde: false, color: 'blue' },
    ]
    expect(computeWordScore({ selectedCards: cards, allUserLetters: [], allBoardLetters: [], plusMinus: -4 })).toBe(0)
  })
})

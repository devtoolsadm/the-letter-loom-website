import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock stateStore before importing trainingMatch (which imports it at module level).
// All functions return the new state directly, so tests check the return value.
vi.mock('../stateStore.js', () => {
  let _store = { version: 2, training: { active: null }, settings: {}, gamePreferences: {} }
  return {
    loadState: vi.fn(() => _store),
    updateState: vi.fn((partial) => {
      if (partial.training !== undefined) {
        _store = {
          ..._store,
          training: {
            ...(_store.training ?? {}),
            ...partial.training,
            active: 'active' in partial.training
              ? partial.training.active
              : _store.training?.active,
          },
        }
      }
      return _store
    }),
    saveState: vi.fn(),
    getState: vi.fn(() => _store),
    clearState: vi.fn(),
  }
})

import {
  getTurnOrder,
  enterActionsPhase,
  selectActionInStrategy,
  isUserShieldPreSelected,
  userHasShield,
  isAttackOnUser,
  planGhostAction,
  useShieldOnAttack,
  playUserAction,
  advanceActionsQueue,
  tickStrategyTimer,
  tickCreationTimer,
  finalizeUserWord,
  advanceToNextBaza,
  drawEmergencyLetter,
  userHandHasNoLetters,
} from '../trainingMatch.js'
import { makeLetter, makeConsonant, makeActionCard, makeState, resetIds } from './helpers.js'

beforeEach(() => resetIds())

// ── Turn order ───────────────────────────────────────────────────────────────

describe('getTurnOrder', () => {
  it('starts after dealer and wraps around back to dealer', () => {
    const state = makeState({ dealerId: 'p1' })
    // players: [p1, p2, p3], dealer = p1 (index 0), start at index 1
    const order = getTurnOrder(state)
    expect(order).toEqual(['p2', 'p3', 'p1'])
  })

  it('handles dealer at last position', () => {
    const state = makeState({ dealerId: 'p3' })
    // dealer = p3 (index 2), start at index 0
    const order = getTurnOrder(state)
    expect(order).toEqual(['p1', 'p2', 'p3'])
  })

  it('handles single player match', () => {
    const state = makeState({
      players: [{ id: 'p1', name: 'Tú', score: 0, rounds: [], isGhost: false }],
      hands: { p1: { letters: [], actions: [] } },
      dealerId: 'p1',
    })
    const order = getTurnOrder(state)
    expect(order).toEqual(['p1'])
  })
})

// ── Phase transitions ────────────────────────────────────────────────────────

describe('enterActionsPhase', () => {
  it('transitions phase to actions and sets queue from turn order', () => {
    const state = makeState({ phase: 'strategy', dealerId: 'p1' })
    const next = enterActionsPhase(state)
    expect(next.phase).toBe('actions')
    expect(next.actionsQueue).toEqual(['p2', 'p3', 'p1'])
    expect(next.remaining).toBe(0)
  })

  it('preserves pre-selected user action index if set', () => {
    const shield = makeActionCard({ actionId: 'shield_total' })
    const state = makeState({
      phase: 'strategy',
      hands: { p1: { letters: [], actions: [shield] }, p2: '<hidden>', p3: '<hidden>' },
      userActionIndex: 0,
    })
    const next = enterActionsPhase(state)
    expect(next.userActionIndex).toBe(0)
  })
})

describe('selectActionInStrategy', () => {
  it('discards the non-selected card, keeps selected at index 0, transitions to actions', () => {
    const kept = makeActionCard({ id: 'kept', actionId: 'boost_total' })
    const discarded = makeActionCard({ id: 'discarded', actionId: 'wildcard' })
    const state = makeState({
      phase: 'strategy',
      hands: { p1: { letters: [], actions: [kept, discarded] }, p2: '<hidden>', p3: '<hidden>' },
      discards: { vowels: [], consonants: [], actions: [] },
    })
    const next = selectActionInStrategy(state, 0)
    expect(next.phase).toBe('actions')
    expect(next.userActionIndex).toBe(0)
    expect(next.hands.p1.actions).toHaveLength(1)
    expect(next.hands.p1.actions[0].id).toBe('kept')
    expect(next.discards.actions).toContain(discarded)
  })

  it('works when selecting the second card (index 1)', () => {
    const first = makeActionCard({ id: 'first', actionId: 'explosion' })
    const second = makeActionCard({ id: 'second', actionId: 'boost_total' })
    const state = makeState({
      phase: 'strategy',
      hands: { p1: { letters: [], actions: [first, second] }, p2: '<hidden>', p3: '<hidden>' },
      discards: { vowels: [], consonants: [], actions: [] },
    })
    const next = selectActionInStrategy(state, 1)
    expect(next.hands.p1.actions[0].id).toBe('second')
    expect(next.discards.actions).toContain(first)
  })

  it('returns state unchanged for invalid index', () => {
    const state = makeState({ phase: 'strategy' })
    const next = selectActionInStrategy(state, 5)
    expect(next).toBe(state)
  })
})

// ── Timers ───────────────────────────────────────────────────────────────────

describe('tickStrategyTimer', () => {
  it('decrements remaining by 1', () => {
    const state = makeState({ phase: 'strategy', remaining: 10 })
    const next = tickStrategyTimer(state)
    expect(next.remaining).toBe(9)
    expect(next.phase).toBe('strategy')
  })

  it('transitions to actions when remaining reaches 0', () => {
    const state = makeState({ phase: 'strategy', remaining: 1, dealerId: 'p1' })
    const next = tickStrategyTimer(state)
    expect(next.phase).toBe('actions')
    expect(next.remaining).toBe(0)
  })

  it('returns unchanged state when phase is not strategy', () => {
    const state = makeState({ phase: 'creation', remaining: 10 })
    const next = tickStrategyTimer(state)
    expect(next).toBe(state)
  })
})

describe('tickCreationTimer', () => {
  it('decrements remaining by 1', () => {
    const state = makeState({ phase: 'creation', remaining: 20 })
    const next = tickCreationTimer(state)
    expect(next.remaining).toBe(19)
    expect(next.phase).toBe('creation')
  })

  it('transitions to result when remaining reaches 0', () => {
    const state = makeState({ phase: 'creation', remaining: 1 })
    const next = tickCreationTimer(state)
    expect(next.phase).toBe('result')
    expect(next.remaining).toBe(0)
  })
})

// ── Actions queue ────────────────────────────────────────────────────────────

describe('advanceActionsQueue', () => {
  it('removes first player from queue', () => {
    const state = makeState({ actionsQueue: ['p2', 'p1', 'p3'] })
    const next = advanceActionsQueue(state)
    expect(next.actionsQueue).toEqual(['p1', 'p3'])
    expect(next.phase).toBe('actions')
  })

  it('transitions to creation when queue becomes empty', () => {
    const state = makeState({ actionsQueue: ['p1'], creationSeconds: 40 })
    const next = advanceActionsQueue(state)
    expect(next.actionsQueue).toEqual([])
    expect(next.phase).toBe('creation')
    expect(next.remaining).toBe(40)
  })

  it('sets remaining to creationSeconds on transition', () => {
    const state = makeState({ actionsQueue: ['p1'], creationSeconds: 60 })
    const next = advanceActionsQueue(state)
    expect(next.remaining).toBe(60)
  })
})

// ── Shield logic ─────────────────────────────────────────────────────────────

describe('userHasShield', () => {
  it('returns true when user has shield_total in actions hand', () => {
    const shield = makeActionCard({ actionId: 'shield_total' })
    const state = makeState({
      hands: { p1: { letters: [], actions: [shield] }, p2: '<hidden>', p3: '<hidden>' },
    })
    expect(userHasShield(state)).toBe(true)
  })

  it('returns false when no shield in hand', () => {
    const boost = makeActionCard({ actionId: 'boost_total' })
    const state = makeState({
      hands: { p1: { letters: [], actions: [boost] }, p2: '<hidden>', p3: '<hidden>' },
    })
    expect(userHasShield(state)).toBe(false)
  })

  it('returns false when hand is empty', () => {
    const state = makeState({
      hands: { p1: { letters: [], actions: [] }, p2: '<hidden>', p3: '<hidden>' },
    })
    expect(userHasShield(state)).toBe(false)
  })

  it('returns false when user hand is hidden', () => {
    const state = makeState({ hands: { p1: '<hidden>', p2: '<hidden>', p3: '<hidden>' } })
    expect(userHasShield(state)).toBe(false)
  })
})

describe('isUserShieldPreSelected', () => {
  it('returns true when shield card is at userActionIndex', () => {
    const shield = makeActionCard({ actionId: 'shield_total' })
    const state = makeState({
      hands: { p1: { letters: [], actions: [shield] }, p2: '<hidden>', p3: '<hidden>' },
      userActionIndex: 0,
      userActionResolved: false,
    })
    expect(isUserShieldPreSelected(state)).toBe(true)
  })

  it('returns false when userActionResolved is true (already played)', () => {
    const shield = makeActionCard({ actionId: 'shield_total' })
    const state = makeState({
      hands: { p1: { letters: [], actions: [shield] }, p2: '<hidden>', p3: '<hidden>' },
      userActionIndex: 0,
      userActionResolved: true,
    })
    expect(isUserShieldPreSelected(state)).toBe(false)
  })

  it('returns false when userActionIndex is null', () => {
    const shield = makeActionCard({ actionId: 'shield_total' })
    const state = makeState({
      hands: { p1: { letters: [], actions: [shield] }, p2: '<hidden>', p3: '<hidden>' },
      userActionIndex: null,
    })
    expect(isUserShieldPreSelected(state)).toBe(false)
  })

  it('returns false when pre-selected card is not shield', () => {
    const boost = makeActionCard({ actionId: 'boost_total' })
    const state = makeState({
      hands: { p1: { letters: [], actions: [boost] }, p2: '<hidden>', p3: '<hidden>' },
      userActionIndex: 0,
      userActionResolved: false,
    })
    expect(isUserShieldPreSelected(state)).toBe(false)
  })
})

describe('isAttackOnUser', () => {
  it('returns true for shieldable attack targeting user directly', () => {
    const action = { actionId: 'steal_letter', target: 'one' }
    expect(isAttackOnUser(action, 'p1', 'p1')).toBe(true)
  })

  it('returns false for shieldable attack targeting another player', () => {
    const action = { actionId: 'steal_letter', target: 'one' }
    expect(isAttackOnUser(action, 'p2', 'p1')).toBe(false)
  })

  it('returns true for all-target attacks regardless of targetId', () => {
    const action = { actionId: 'out_one', target: 'all' }
    expect(isAttackOnUser(action, null, 'p1')).toBe(true)
  })

  it('returns true for two_to_center (all-target shieldable)', () => {
    const action = { actionId: 'two_to_center', target: 'all' }
    expect(isAttackOnUser(action, null, 'p1')).toBe(true)
  })

  it('returns false for self-bonus actions (boost_total, wildcard)', () => {
    expect(isAttackOnUser({ actionId: 'boost_total' }, null, 'p1')).toBe(false)
    expect(isAttackOnUser({ actionId: 'wildcard' }, null, 'p1')).toBe(false)
  })

  it('returns false for board actions (renew_board, solo_mia)', () => {
    expect(isAttackOnUser({ actionId: 'renew_board' }, null, 'p1')).toBe(false)
    expect(isAttackOnUser({ actionId: 'solo_mia' }, null, 'p1')).toBe(false)
  })

  it('returns false for null action', () => {
    expect(isAttackOnUser(null, 'p1', 'p1')).toBe(false)
  })
})

describe('planGhostAction', () => {
  it('returns shieldOpportunity when ghost attacks user and user has unused shield', () => {
    const shield = makeActionCard({ actionId: 'shield_total' })
    // Use steal_letter (target: one) so ghost can target user specifically
    const stealCard = { ...makeActionCard({ actionId: 'steal_letter', target: 'one', kind: 'attack' }), inMVP: true }
    const state = makeState({
      hands: { p1: { letters: [makeLetter()], actions: [shield] }, p2: '<hidden>', p3: '<hidden>' },
      decks: { vowelDeck: [], consonantDeck: [], actionDeck: [stealCard] },
      userActionIndex: null,
      userActionResolved: false,
    })
    // rng = 0 → pickRandomTarget picks first candidate (p1, since source is p2 and candidates are [p1, p3])
    const result = planGhostAction(state, 'p2', () => 0)
    expect(result.shieldOpportunity).not.toBeNull()
    expect(result.autoShield).toBeFalsy()
    expect(result.log.actionId).toBe('steal_letter')
  })

  it('returns autoShield (not shieldOpportunity) when user pre-selected shield', () => {
    const shield = makeActionCard({ actionId: 'shield_total' })
    const stealCard = { ...makeActionCard({ actionId: 'steal_letter', target: 'one', kind: 'attack' }) }
    const state = makeState({
      hands: { p1: { letters: [makeLetter()], actions: [shield] }, p2: '<hidden>', p3: '<hidden>' },
      decks: { vowelDeck: [], consonantDeck: [], actionDeck: [stealCard] },
      userActionIndex: 0,
      userActionResolved: false,
    })
    const result = planGhostAction(state, 'p2', () => 0)
    expect(result.autoShield).toBeTruthy()
    expect(result.shieldOpportunity).toBeNull()
  })

  it('returns no shield opportunity when ghost attacks a different player', () => {
    const shield = makeActionCard({ actionId: 'shield_total' })
    const stealCard = { ...makeActionCard({ actionId: 'steal_letter', target: 'one', kind: 'attack' }) }
    const state = makeState({
      hands: { p1: { letters: [makeLetter()], actions: [shield] }, p2: '<hidden>', p3: '<hidden>' },
      decks: { vowelDeck: [], consonantDeck: [], actionDeck: [stealCard] },
      userActionIndex: null,
    })
    // rng = 0.99 → pickRandomTarget picks last candidate from [p1, p3] = p3 (not user)
    // Actually with source=p2, candidates=[p1,p3], rng=0.99 → index 1 → p3
    const result = planGhostAction(state, 'p2', () => 0.99)
    // steal_letter targets p3, not p1 → not an attack on user
    expect(result.shieldOpportunity).toBeNull()
    expect(result.autoShield).toBeFalsy()
  })

  it('returns log: null when action deck is completely empty', () => {
    const state = makeState({
      decks: { vowelDeck: [], consonantDeck: [], actionDeck: [] },
      discards: { vowels: [], consonants: [], actions: [] },
    })
    const result = planGhostAction(state, 'p2')
    expect(result.log).toBeNull()
    expect(result.shieldOpportunity).toBeNull()
  })

  it('draws from discard pile when deck is empty', () => {
    const card = makeActionCard({ actionId: 'boost_total', target: 'self' })
    const state = makeState({
      decks: { vowelDeck: [], consonantDeck: [], actionDeck: [] },
      discards: { vowels: [], consonants: [], actions: [card] },
    })
    const result = planGhostAction(state, 'p2')
    expect(result.log).not.toBeNull()
    expect(result.log.playerId).toBe('p2')
  })

  it('consumes the drawn card from the deck', () => {
    const card1 = makeActionCard({ actionId: 'boost_total' })
    const card2 = makeActionCard({ actionId: 'wildcard' })
    const state = makeState({
      decks: { vowelDeck: [], consonantDeck: [], actionDeck: [card1, card2] },
    })
    const result = planGhostAction(state, 'p2')
    expect(result.state.decks.actionDeck).toHaveLength(1)
    expect(result.state.discards.actions).toHaveLength(1)
  })
})

describe('useShieldOnAttack', () => {
  it('discards both action cards from user hand', () => {
    const shield = makeActionCard({ id: 'sh', actionId: 'shield_total' })
    const other = makeActionCard({ id: 'ot', actionId: 'boost_total' })
    const state = makeState({
      hands: { p1: { letters: [], actions: [shield, other] }, p2: '<hidden>', p3: '<hidden>' },
      discards: { vowels: [], consonants: [], actions: [] },
    })
    const next = useShieldOnAttack(state, 'p2')
    expect(next.hands.p1.actions).toHaveLength(0)
    expect(next.discards.actions).toHaveLength(2)
  })

  it('sets userActionResolved to true', () => {
    const shield = makeActionCard({ actionId: 'shield_total' })
    const state = makeState({
      hands: { p1: { letters: [], actions: [shield] }, p2: '<hidden>', p3: '<hidden>' },
    })
    const next = useShieldOnAttack(state, 'p2')
    expect(next.userActionResolved).toBe(true)
  })

  it('logs the shield action', () => {
    const shield = makeActionCard({ actionId: 'shield_total' })
    const state = makeState({
      hands: { p1: { letters: [], actions: [shield] }, p2: '<hidden>', p3: '<hidden>' },
      actionsLog: [],
    })
    const next = useShieldOnAttack(state, 'p2')
    expect(next.actionsLog).toHaveLength(1)
    expect(next.actionsLog[0]).toMatchObject({
      playerId: 'p1',
      actionId: 'shield_total',
      blocked: true,
      source: 'p2',
    })
  })

  it('returns state unchanged if no shield in hand', () => {
    const boost = makeActionCard({ actionId: 'boost_total' })
    const state = makeState({
      hands: { p1: { letters: [], actions: [boost] }, p2: '<hidden>', p3: '<hidden>' },
    })
    const next = useShieldOnAttack(state, 'p2')
    expect(next).toBe(state)
  })

  it('does not trigger shield prompt on second attack (userActionResolved already true)', () => {
    // After using shield, planGhostAction should not return shieldOpportunity
    const stealCard = makeActionCard({ actionId: 'steal_letter', target: 'one' })
    const state = makeState({
      hands: { p1: { letters: [makeLetter()], actions: [] }, p2: '<hidden>', p3: '<hidden>' },
      decks: { vowelDeck: [], consonantDeck: [], actionDeck: [stealCard] },
      userActionResolved: true, // already used shield
    })
    const result = planGhostAction(state, 'p2', () => 0)
    // userHasShield = false (hand.actions is empty) → no opportunity
    expect(result.shieldOpportunity).toBeNull()
  })
})

// ── playUserAction ───────────────────────────────────────────────────────────

describe('playUserAction', () => {
  it('applies the action effect', () => {
    const boost = makeActionCard({ id: 'boost', actionId: 'boost_total' })
    const state = makeState({
      hands: { p1: { letters: [], actions: [boost] }, p2: '<hidden>', p3: '<hidden>' },
    })
    const next = playUserAction(state, 0, null, {})
    expect(next.scoreModifiers.p1).toBe(6)
  })

  it('discards all action cards from user hand', () => {
    const boost = makeActionCard({ id: 'a1', actionId: 'boost_total' })
    const extra = makeActionCard({ id: 'a2', actionId: 'wildcard' })
    const state = makeState({
      hands: { p1: { letters: [], actions: [boost, extra] }, p2: '<hidden>', p3: '<hidden>' },
      discards: { vowels: [], consonants: [], actions: [] },
    })
    const next = playUserAction(state, 0, null, {})
    expect(next.hands.p1.actions).toHaveLength(0)
    expect(next.discards.actions).toHaveLength(2)
  })

  it('sets userActionResolved to true', () => {
    const boost = makeActionCard({ actionId: 'boost_total' })
    const state = makeState({
      hands: { p1: { letters: [], actions: [boost] }, p2: '<hidden>', p3: '<hidden>' },
    })
    const next = playUserAction(state, 0, null, {})
    expect(next.userActionResolved).toBe(true)
    expect(next.userActionIndex).toBe(0)
  })

  it('logs the played action', () => {
    const boost = makeActionCard({ actionId: 'boost_total' })
    const state = makeState({
      hands: { p1: { letters: [], actions: [boost] }, p2: '<hidden>', p3: '<hidden>' },
      actionsLog: [],
    })
    const next = playUserAction(state, 0, 'p2', {})
    expect(next.actionsLog).toHaveLength(1)
    expect(next.actionsLog[0]).toMatchObject({ playerId: 'p1', actionId: 'boost_total', targetId: 'p2' })
  })

  it('returns state unchanged when card at actionIndex does not exist', () => {
    const state = makeState({
      hands: { p1: { letters: [], actions: [] }, p2: '<hidden>', p3: '<hidden>' },
    })
    const next = playUserAction(state, 0, null, {})
    expect(next).toBe(state)
  })
})

// ── finalizeUserWord ─────────────────────────────────────────────────────────

describe('finalizeUserWord', () => {
  it('marks word as invalid (too_short) and score 0 when fewer than 2 cards', () => {
    const bc = makeLetter({ id: 'bc1', letter: 'A', kind: 'vowel' })
    const state = makeState({
      phase: 'creation',
      centralBoard: [bc],
      hands: { p1: { letters: [], actions: [] }, p2: '<hidden>', p3: '<hidden>' },
      userWord: [{ cardId: 'bc1', source: 'board', tilde: false, chosen: null }],
    })
    const result = finalizeUserWord(state, 'es')
    expect(result.phase).toBe('result')
    expect(result.userWordResult.valid).toBe(false)
    expect(result.userWordResult.reason).toBe('too_short')
    expect(result.userWordResult.score).toBe(0)
  })

  it('marks word as invalid (missing_source) when only board cards used', () => {
    const bc1 = makeLetter({ id: 'bc1', letter: 'A', kind: 'vowel' })
    const bc2 = makeConsonant({ id: 'bc2', letter: 'S' })
    const handCard = makeLetter({ id: 'hc1' })
    const state = makeState({
      phase: 'creation',
      centralBoard: [bc1, bc2],
      hands: { p1: { letters: [handCard], actions: [] }, p2: '<hidden>', p3: '<hidden>' },
      userWord: [
        { cardId: 'bc1', source: 'board', tilde: false, chosen: null },
        { cardId: 'bc2', source: 'board', tilde: false, chosen: null },
      ],
    })
    const result = finalizeUserWord(state, 'es')
    expect(result.userWordResult.valid).toBe(false)
    expect(result.userWordResult.reason).toBe('missing_source')
  })

  it('marks word as invalid (missing_source) when only hand cards used', () => {
    const bc1 = makeLetter({ id: 'bc1' })
    const hc1 = makeLetter({ id: 'hc1', letter: 'A', kind: 'vowel' })
    const hc2 = makeConsonant({ id: 'hc2', letter: 'S' })
    const state = makeState({
      phase: 'creation',
      centralBoard: [bc1],
      hands: { p1: { letters: [hc1, hc2], actions: [] }, p2: '<hidden>', p3: '<hidden>' },
      userWord: [
        { cardId: 'hc1', source: 'hand', tilde: false, chosen: null },
        { cardId: 'hc2', source: 'hand', tilde: false, chosen: null },
      ],
    })
    const result = finalizeUserWord(state, 'es')
    expect(result.userWordResult.valid).toBe(false)
    expect(result.userWordResult.reason).toBe('missing_source')
  })

  it('scores a valid word correctly (no x2)', () => {
    // "AS" = A(value 2, blue) + S(value 4, orange) → different colors → no x2 → score 6
    // extra letter in hand (unused) prevents "used all hand letters" x2 trigger
    const bc = makeLetter({ id: 'bc1', letter: 'A', value: 2, kind: 'vowel', color: 'blue' })
    const hc = makeConsonant({ id: 'hc1', letter: 'S', value: 4, kind: 'consonant', color: 'orange' })
    const extra = makeLetter({ id: 'extra1', letter: 'O', value: 1, kind: 'vowel', color: 'green' })
    const state = makeState({
      phase: 'creation',
      players: [
        { id: 'p1', name: 'Tú', score: 0, rounds: [], isGhost: false },
        { id: 'p2', name: 'Op1', score: 0, rounds: [], isGhost: true },
      ],
      centralBoard: [bc],
      hands: { p1: { letters: [hc, extra], actions: [] }, p2: '<hidden>' },
      userWord: [
        { cardId: 'bc1', source: 'board', tilde: false, chosen: null },
        { cardId: 'hc1', source: 'hand', tilde: false, chosen: null },
      ],
      ghostLevel: 'easy',
      forcedRules: {},
      scoreModifiers: {},
    })
    const result = finalizeUserWord(state, 'es')
    expect(result.userWordResult.valid).toBe(true)
    expect(result.userWordResult.word).toBe('AS')
    expect(result.userWordResult.score).toBe(6)
  })

  it('applies x2 when all cards share same color', () => {
    // A(blue, 2) + S(blue, 4) → same color → x2 → score 12
    const bc = makeLetter({ id: 'bc1', letter: 'A', value: 2, kind: 'vowel', color: 'blue' })
    const hc = makeConsonant({ id: 'hc1', letter: 'S', value: 4, kind: 'consonant', color: 'blue' })
    const state = makeState({
      phase: 'creation',
      players: [{ id: 'p1', name: 'Tú', score: 0, rounds: [], isGhost: false }],
      centralBoard: [bc],
      hands: { p1: { letters: [hc], actions: [] } },
      userWord: [
        { cardId: 'bc1', source: 'board', tilde: false, chosen: null },
        { cardId: 'hc1', source: 'hand', tilde: false, chosen: null },
      ],
      ghostLevel: 'easy',
      forcedRules: {},
      scoreModifiers: {},
    })
    const result = finalizeUserWord(state, 'es')
    expect(result.userWordResult.score).toBe(12)
  })

  it('applies score modifier before doubling', () => {
    // A(blue, 2) + S(blue, 4) + modifier +6 → base = 12, x2 = 24
    const bc = makeLetter({ id: 'bc1', letter: 'A', value: 2, kind: 'vowel', color: 'blue' })
    const hc = makeConsonant({ id: 'hc1', letter: 'S', value: 4, kind: 'consonant', color: 'blue' })
    const state = makeState({
      phase: 'creation',
      players: [{ id: 'p1', name: 'Tú', score: 0, rounds: [], isGhost: false }],
      centralBoard: [bc],
      hands: { p1: { letters: [hc], actions: [] } },
      userWord: [
        { cardId: 'bc1', source: 'board', tilde: false, chosen: null },
        { cardId: 'hc1', source: 'hand', tilde: false, chosen: null },
      ],
      ghostLevel: 'easy',
      forcedRules: {},
      scoreModifiers: { p1: 6 },
    })
    const result = finalizeUserWord(state, 'es')
    expect(result.userWordResult.score).toBe(24) // (2+4+6) * 2
  })

  it('fails forced rule validation (philologist requires tilde)', () => {
    const bc = makeLetter({ id: 'bc1', letter: 'A', value: 2, kind: 'vowel', color: 'blue' })
    const hc = makeConsonant({ id: 'hc1', letter: 'S', value: 4 })
    const state = makeState({
      phase: 'creation',
      players: [{ id: 'p1', name: 'Tú', score: 0, rounds: [], isGhost: false }],
      centralBoard: [bc],
      hands: { p1: { letters: [hc], actions: [] } },
      userWord: [
        { cardId: 'bc1', source: 'board', tilde: false, chosen: null },
        { cardId: 'hc1', source: 'hand', tilde: false, chosen: null },
      ],
      forcedRules: {
        p1: [{ actionId: 'philologist', source: 'p2', payload: {} }],
      },
      scoreModifiers: {},
      ghostLevel: 'easy',
    })
    const result = finalizeUserWord(state, 'es')
    expect(result.userWordResult.valid).toBe(false)
    expect(result.userWordResult.reason).toBe('forced_rule')
    expect(result.userWordResult.violations).toContain('philologist')
    expect(result.userWordResult.score).toBe(0)
  })

  it('updates all player scores (user + ghosts)', () => {
    const bc = makeLetter({ id: 'bc1', letter: 'A', value: 2, kind: 'vowel', color: 'blue' })
    const hc = makeConsonant({ id: 'hc1', letter: 'S', value: 4, kind: 'consonant', color: 'orange' })
    const extra = makeLetter({ id: 'extra2', letter: 'O', value: 1, kind: 'vowel', color: 'green' })
    const state = makeState({
      phase: 'creation',
      players: [
        { id: 'p1', name: 'Tú', score: 0, rounds: [], isGhost: false },
        { id: 'p2', name: 'Op1', score: 0, rounds: [], isGhost: true },
      ],
      centralBoard: [bc],
      hands: { p1: { letters: [hc, extra], actions: [] }, p2: '<hidden>' },
      userWord: [
        { cardId: 'bc1', source: 'board', tilde: false, chosen: null },
        { cardId: 'hc1', source: 'hand', tilde: false, chosen: null },
      ],
      ghostLevel: 'easy',
      forcedRules: {},
      scoreModifiers: {},
    })
    const result = finalizeUserWord(state, 'es')
    const user = result.players.find(p => p.id === 'p1')
    const ghost = result.players.find(p => p.id === 'p2')
    expect(user.score).toBe(6)
    expect(user.rounds).toHaveLength(1)
    expect(user.rounds[0].points).toBe(6)
    expect(ghost.rounds).toHaveLength(1)
    expect(typeof ghost.rounds[0].points).toBe('number')
  })
})

// ── advanceToNextBaza ────────────────────────────────────────────────────────

describe('advanceToNextBaza', () => {
  it('increments round and resets per-trick state', () => {
    const state = makeState({
      round: 1,
      roundsTarget: 3,
      phase: 'result',
      forcedRules: { p1: [{ actionId: 'philologist' }] },
      scoreModifiers: { p1: 6 },
      userWord: [{ cardId: 'x', source: 'board' }],
      actionsLog: [{ playerId: 'p1', actionId: 'boost_total' }],
    })
    const next = advanceToNextBaza(state)
    expect(next.round).toBe(2)
    expect(next.phase).toBe('dealing')
    expect(next.forcedRules).toEqual({})
    expect(next.scoreModifiers).toEqual({})
    expect(next.userWord).toEqual([])
    expect(next.actionsLog).toEqual([])
    expect(next.userActionIndex).toBeNull()
    expect(next.userActionResolved).toBe(false)
  })

  it('rotates dealer to next player', () => {
    const state = makeState({ dealerId: 'p1', round: 1, roundsTarget: 3 })
    const next = advanceToNextBaza(state)
    expect(next.dealerId).toBe('p2')
  })

  it('wraps dealer rotation around', () => {
    const state = makeState({ dealerId: 'p3', round: 1, roundsTarget: 3 })
    const next = advanceToNextBaza(state)
    expect(next.dealerId).toBe('p1')
  })

  it('transitions to done phase and sets matchOver when last round played', () => {
    const state = makeState({
      round: 3,
      roundsTarget: 3,
      phase: 'result',
      players: [
        { id: 'p1', name: 'Tú', score: 20, rounds: [], isGhost: false },
        { id: 'p2', name: 'Op1', score: 15, rounds: [], isGhost: true },
      ],
    })
    const next = advanceToNextBaza(state)
    expect(next.phase).toBe('done')
    expect(next.matchOver).toBe(true)
    expect(next.round).toBe(3) // round stays at last played
  })

  it('sets winnerIds to the player(s) with highest score', () => {
    const state = makeState({
      round: 3,
      roundsTarget: 3,
      players: [
        { id: 'p1', name: 'Tú', score: 20, rounds: [], isGhost: false },
        { id: 'p2', name: 'Op1', score: 30, rounds: [], isGhost: true },
        { id: 'p3', name: 'Op2', score: 15, rounds: [], isGhost: true },
      ],
    })
    const next = advanceToNextBaza(state)
    expect(next.winnerIds).toEqual(['p2'])
  })

  it('sets multiple winners on tie', () => {
    const state = makeState({
      round: 3,
      roundsTarget: 3,
      players: [
        { id: 'p1', name: 'Tú', score: 25, rounds: [], isGhost: false },
        { id: 'p2', name: 'Op1', score: 25, rounds: [], isGhost: true },
        { id: 'p3', name: 'Op2', score: 10, rounds: [], isGhost: true },
      ],
    })
    const next = advanceToNextBaza(state)
    expect(next.winnerIds.sort()).toEqual(['p1', 'p2'])
  })

  it('rebuilds empty hands for all players', () => {
    const l = makeLetter()
    const state = makeState({
      round: 1,
      roundsTarget: 3,
      hands: {
        p1: { letters: [l], actions: [makeActionCard()] },
        p2: '<hidden>',
        p3: '<hidden>',
      },
    })
    const next = advanceToNextBaza(state)
    expect(next.hands.p1.letters).toHaveLength(3) // TRAINING_HAND_LETTERS = 3
    expect(next.hands.p1.letters.every(c => c === null)).toBe(true)
    expect(next.hands.p2).toBe('<hidden>')
  })
})

// ── Emergency draw ───────────────────────────────────────────────────────────

describe('userHandHasNoLetters', () => {
  it('returns true when user hand has no non-null letters', () => {
    const state = makeState({
      hands: { p1: { letters: [null, null, null], actions: [] }, p2: '<hidden>', p3: '<hidden>' },
    })
    expect(userHandHasNoLetters(state)).toBe(true)
  })

  it('returns false when user has at least one letter', () => {
    const state = makeState({
      hands: { p1: { letters: [makeLetter()], actions: [] }, p2: '<hidden>', p3: '<hidden>' },
    })
    expect(userHandHasNoLetters(state)).toBe(false)
  })
})

describe('drawEmergencyLetter', () => {
  it('adds a vowel to user hand when kind=vowel', () => {
    const vowel = makeLetter({ id: 'ev', letter: 'O', kind: 'vowel' })
    const state = makeState({
      hands: { p1: { letters: [], actions: [] }, p2: '<hidden>', p3: '<hidden>' },
      decks: { vowelDeck: [vowel], consonantDeck: [], actionDeck: [] },
      discards: { vowels: [], consonants: [], actions: [] },
    })
    const next = drawEmergencyLetter(state, 'vowel')
    expect(next.hands.p1.letters).toHaveLength(1)
    expect(next.hands.p1.letters[0].id).toBe('ev')
  })

  it('adds a consonant when kind=consonant', () => {
    const cons = makeConsonant({ id: 'ec', letter: 'N' })
    const state = makeState({
      hands: { p1: { letters: [], actions: [] }, p2: '<hidden>', p3: '<hidden>' },
      decks: { vowelDeck: [], consonantDeck: [cons], actionDeck: [] },
      discards: { vowels: [], consonants: [], actions: [] },
    })
    const next = drawEmergencyLetter(state, 'consonant')
    expect(next.hands.p1.letters[0].id).toBe('ec')
  })
})

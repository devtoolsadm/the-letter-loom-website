// Shared test state builders. All IDs are deterministic via counter.

let _counter = 0
export function freshId(prefix = 'x') { return `${prefix}-${++_counter}` }
export function resetIds() { _counter = 0 }

export function makeLetter(overrides = {}) {
  return {
    id: freshId('l'),
    type: 'letter',
    kind: 'vowel',
    letter: 'A',
    value: 2,
    color: 'blue',
    isWildcard: false,
    tildeValue: null,
    tildeForm: null,
    tildeKind: null,
    ...overrides,
  }
}

export function makeConsonant(overrides = {}) {
  return makeLetter({ kind: 'consonant', letter: 'S', value: 4, color: 'blue', ...overrides })
}

export function makeActionCard(overrides = {}) {
  return {
    id: freshId('a'),
    type: 'action',
    actionId: 'boost_total',
    kind: 'self_bonus',
    target: 'self',
    ...overrides,
  }
}

// Minimal match state with p1 (user) + p2, p3 (ghosts).
export function makeState(overrides = {}) {
  const { hands, players, ...rest } = overrides
  const defaultPlayers = [
    { id: 'p1', name: 'Tú',  score: 0, rounds: [], isGhost: false },
    { id: 'p2', name: 'Op1', score: 0, rounds: [], isGhost: true  },
    { id: 'p3', name: 'Op2', score: 0, rounds: [], isGhost: true  },
  ]
  const defaultHands = {
    p1: { letters: [], actions: [] },
    p2: { letters: [], actions: [] },
    p3: { letters: [], actions: [] },
  }
  return {
    matchType: 'training',
    matchId: 'test',
    difficulty: 'normal',
    ghostLevel: 'normal',
    strategySeconds: 20,
    creationSeconds: 40,
    roundsTarget: 3,
    round: 1,
    phase: 'actions',
    remaining: 20,
    players: players ?? defaultPlayers,
    centralBoard: [],
    hands: hands ? { ...defaultHands, ...hands } : { ...defaultHands },
    dealerId: 'p1',
    decks: { vowelDeck: [], consonantDeck: [], actionDeck: [] },
    discards: { vowels: [], consonants: [], actions: [] },
    trickActions: [],
    pendingEffectsOnUser: [],
    forcedRules: {},
    scoreModifiers: {},
    userWord: [],
    matchOver: false,
    winnerIds: [],
    actionsQueue: ['p2', 'p1', 'p3'],
    actionsLog: [],
    userActionIndex: null,
    userActionTarget: null,
    userActionPayload: null,
    userActionResolved: false,
    updatedAt: 0,
    ...rest,
  }
}

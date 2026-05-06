import {
  DEFAULT_PLAYER_COUNT,
  DEFAULT_STRATEGY_SECONDS,
  DEFAULT_CREATION_SECONDS,
  DEFAULT_ROUNDS_TARGET,
  DEFAULT_POINTS_TARGET,
  MATCH_MODE_ROUNDS,
} from "./constants.js";

const STATE_KEY = "letterloom_state";
const STATE_VERSION = 2;

const defaultState = () => ({
  version: STATE_VERSION,
  settings: {
    language: null,
    sound: true,
    music: true,
    soundVolume: 50,
    musicVolume: 50,
    validationRules: null, // can be string or map per language
    knownPlayerNames: [],
  },
  gamePreferences: {
    playersCount: DEFAULT_PLAYER_COUNT,
    strategySeconds: DEFAULT_STRATEGY_SECONDS,
    creationSeconds: DEFAULT_CREATION_SECONDS,
    mode: MATCH_MODE_ROUNDS,
    roundsTarget: DEFAULT_ROUNDS_TARGET,
    pointsTarget: DEFAULT_POINTS_TARGET,
    scoringEnabled: true,
    validateRecordWords: true,
    players: [],
  },
  matchState: null,
  meta: {
    lastUpdated: Date.now(),
  },
});

let cachedState = null;

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function loadState() {
  if (cachedState) return cachedState;
  try {
    const raw = localStorage.getItem(STATE_KEY);
    const parsed = safeParse(raw);
    if (parsed && parsed.version === STATE_VERSION) {
      cachedState = { ...defaultState(), ...parsed };
      return cachedState;
    }
  } catch {
    // ignore
  }
  cachedState = defaultState();
  return cachedState;
}

export function getState() {
  return loadState();
}

export function saveState(nextState) {
  cachedState = nextState;
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(nextState));
  } catch {
    // ignore storage errors
  }
}

function mergeShallow(base, partial) {
  return { ...base, ...partial };
}

export function updateState(partial = {}) {
  const current = loadState();
  const next = {
    ...current,
    settings: mergeShallow(current.settings, partial.settings || {}),
    gamePreferences: mergeShallow(current.gamePreferences, partial.gamePreferences || {}),
    matchState:
      partial.matchState !== undefined ? partial.matchState : current.matchState,
    meta: { ...current.meta, lastUpdated: Date.now() },
  };
  saveState(next);
  return next;
}

export function clearState() {
  saveState(defaultState());
}

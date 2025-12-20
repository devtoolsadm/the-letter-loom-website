const STATE_KEY = "letterloom_state";
const STATE_VERSION = 1;

const defaultState = () => ({
  version: STATE_VERSION,
  settings: {
    language: null,
    sound: true,
    music: true,
  },
  gamePreferences: {},
  lastSession: null,
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
    lastSession:
      partial.lastSession !== undefined ? partial.lastSession : current.lastSession,
    meta: { ...current.meta, lastUpdated: Date.now() },
  };
  saveState(next);
  return next;
}

export function clearState() {
  saveState(defaultState());
}

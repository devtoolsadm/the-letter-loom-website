// All events are proxied through the Worker — no PostHog key on the client.
// Uses its own fetch (not workerFetch) because it manages a local queue with silent retry.
// A 401 here is swallowed intentionally — analytics must never force a logout.
// Call initAnon(workerBase) at app start; initAuth(getTokenFn) after login.
// Call flush() at natural checkpoints (app open, match end, share, etc.).

const ANON_QUEUE_KEY = 'll_anon_queue'
const AUTH_QUEUE_KEY = 'll_auth_queue'
const ANON_ID_KEY    = 'll_anon_id'
const MAX_QUEUE_SIZE = 200

let _workerBase = null
let _getToken   = null

function getAnonId() {
  let id = localStorage.getItem(ANON_ID_KEY)
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(ANON_ID_KEY, id) }
  return id
}

// ── Init ──────────────────────────────────────────────────────

export function initAnon(workerBase) {
  _workerBase = workerBase.replace(/\/$/, '')
}

export function initAuth(getTokenFn) {
  _getToken = getTokenFn
}

// ── Identity ──────────────────────────────────────────────────

// Links the anon session to the authenticated user in PostHog.
// Call once right after login/signup.
export function identify() {
  if (!_workerBase || !_getToken?.()) return
  fetch(`${_workerBase}/analytics/identify`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${_getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ anon_id: getAnonId() }),
  }).catch(() => {})
}

export function resetIdentity() {
  _getToken = null
}

// ── Capture ───────────────────────────────────────────────────

export function capture(event, properties = {}) {
  const entry = {
    event,
    timestamp: new Date().toISOString(),
    properties: { ...properties, $lib: 'letter-loom-app' },
  }
  if (_getToken) {
    _pushQueue(AUTH_QUEUE_KEY, entry)
  } else {
    _pushQueue(ANON_QUEUE_KEY, { ...entry, anon_id: getAnonId() })
  }
}

// ── Flush ─────────────────────────────────────────────────────

// Call at natural checkpoints: app open, match end, match abandoned, share.
export async function flush() {
  if (!_workerBase) return
  await Promise.all([_flushAnon(), _flushAuth()])
}

async function _flushAnon() {
  const queue = _loadQueue(ANON_QUEUE_KEY)
  if (!queue.length) return
  try {
    const batch = queue.slice(0, 50)
    const res = await fetch(`${_workerBase}/analytics/capture-anon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    })
    if (res.ok) _saveQueue(ANON_QUEUE_KEY, queue.slice(50))
  } catch {}
}

async function _flushAuth() {
  const token = _getToken?.()
  if (!token) return
  const queue = _loadQueue(AUTH_QUEUE_KEY)
  if (!queue.length) return
  try {
    const batch = queue.slice(0, 50)
    const res = await fetch(`${_workerBase}/analytics/capture`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    })
    if (res.ok) _saveQueue(AUTH_QUEUE_KEY, queue.slice(50))
  } catch {}
}

// ── Queue helpers ─────────────────────────────────────────────

function _pushQueue(key, entry) {
  try {
    const q = JSON.parse(localStorage.getItem(key) || '[]')
    q.push(entry)
    if (q.length > MAX_QUEUE_SIZE) q.splice(0, q.length - MAX_QUEUE_SIZE)
    localStorage.setItem(key, JSON.stringify(q))
  } catch {}
}

function _loadQueue(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] }
}

function _saveQueue(key, queue) {
  try {
    if (queue.length === 0) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(queue))
  } catch {}
}

// Central fetch wrapper for all Worker calls (except analytics, which has its own queue).
// Attaches the JWT automatically. A 401 throws 'unauthorized' but does NOT force logout —
// real session expiry is handled by Supabase's onAuthStateChange.
// All new Worker endpoints must use this — never fetch the Worker URL directly.
import { WORKER_BASE } from './config.js'
import { getAccessToken } from './auth.js'

export async function workerFetch(path, options = {}) {
  const token = getAccessToken()
  const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${WORKER_BASE}${path}`, { ...options, headers })

  if (res.status === 401) throw new Error('unauthorized')

  return res
}

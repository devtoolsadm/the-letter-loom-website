import { createClient } from '../../assets/js/supabase.min.js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── Session ───────────────────────────────────────────────────

let _cachedToken = null

// Keep token in sync — Supabase v2 has no synchronous session getter
supabase.auth.onAuthStateChange((_event, session) => {
  _cachedToken = session?.access_token ?? null
})

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  _cachedToken = session?.access_token ?? null
  return session
}

export function getAccessToken() {
  return _cachedToken
}

export function onAuthStateChange(callback) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session)
  })
  return () => subscription.unsubscribe()
}

// ── OTP flow ──────────────────────────────────────────────────

export async function requestOtp(email, turnstileToken, language) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      captchaToken: turnstileToken,
      shouldCreateUser: true,
      data: language ? { language } : undefined,
    },
  })
  return { error }
}

export async function verifyOtp(email, code) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: 'email',
  })
  return { session: data?.session ?? null, error }
}

export async function signOut() {
  clearStoredEmail()
  const { error } = await supabase.auth.signOut()
  return { error }
}

// ── Stored email (session-expiry detection) ───────────────────

const LAST_EMAIL_KEY = 'll_last_email'
export function getStoredEmail() { return localStorage.getItem(LAST_EMAIL_KEY) ?? null }
export function saveStoredEmail(email) { localStorage.setItem(LAST_EMAIL_KEY, email) }
export function clearStoredEmail() { localStorage.removeItem(LAST_EMAIL_KEY) }

// ── Profile ───────────────────────────────────────────────────

export async function getProfile() {
  const { data, error } = await supabase
    .from('profiles')
    .select('nickname, language, email_opt_in, otp_verified_at')
    .single()
  return { profile: data ?? null, error }
}

export async function checkFirstSignup() {
  const { profile, error } = await getProfile()
  if (error) throw error
  return { isFirstSignup: profile?.otp_verified_at == null }
}

const OPT_IN_VERSION = 'v1'

export async function updateProfile({ nickname, emailOptIn, language }) {
  const updates = {}
  if (nickname) updates.nickname = nickname
  if (language) updates.language = language
  if (emailOptIn !== undefined) {
    updates.email_opt_in = emailOptIn
    if (emailOptIn) {
      updates.email_opt_in_at = new Date().toISOString()
      updates.email_opt_in_version = OPT_IN_VERSION
    }
  }
  if (!Object.keys(updates).length) return { error: null }
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.id) return { error: new Error('no_session') }
  const { error } = await supabase.from('profiles').update(updates).eq('id', user.id)
  return { error }
}

export async function saveOnboarding({ nickname, emailOptIn, language }) {
  const updates = { otp_verified_at: new Date().toISOString() }
  if (nickname) updates.nickname = nickname
  if (language) updates.language = language
  if (emailOptIn) {
    updates.email_opt_in = true
    updates.email_opt_in_at = new Date().toISOString()
    updates.email_opt_in_version = OPT_IN_VERSION
  }
  const session = await getSession()
  if (!session?.user?.id) return { error: new Error('no_session') }
  const { error } = await supabase.from('profiles').update(updates).eq('id', session.user.id)
  return { error }
}

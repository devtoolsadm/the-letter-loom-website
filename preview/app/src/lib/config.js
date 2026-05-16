// Runtime config — values injected by CI via deploy-to-pages.yml.
// For local development, create app/src/lib/config.local.js (gitignored)
// with the same exports using real dev values.

let _local = {}
try {
  const m = await import('./config.local.js')
  _local = m
} catch {}

export const WORKER_BASE        = _local.WORKER_BASE        ?? 'https://the-letter-loom-dev.the-letter-loom.workers.dev'
export const SUPABASE_URL       = _local.SUPABASE_URL       ?? ''
export const SUPABASE_ANON_KEY  = _local.SUPABASE_ANON_KEY  ?? ''
export const TURNSTILE_SITE_KEY = _local.TURNSTILE_SITE_KEY ?? ''

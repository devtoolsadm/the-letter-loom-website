/**
 * core/wordValidator.js — Multi-layer linguistic word existence validator.
 *
 * This module ONLY answers "does this word exist in language X?" — it does
 * NOT check game rules (forced effects, hand/board source, scoring). Game
 * rules live in wordRules.js and finalizeUserWord.
 *
 * Layers (each layer is independent and returns one of three results):
 *   - "local"   Local dictionary lookup. Instant, offline.
 *               accepted if found, otherwise unknown (never rejects).
 *   - "public"  Public language-specific API (rae-api.com for ES,
 *               api.dictionaryapi.dev for EN). Free, browser-callable.
 *               accepted on 200, rejected on 404, unknown on network error.
 *   - "ai"      The remote AI validator (worker). Authoritative.
 *               accepted / rejected based on the worker's verdict;
 *               unknown only if the call itself fails.
 *
 * Callers select which layers to run by passing { layers } in order. The
 * first layer to return accepted or rejected wins; unknown falls through.
 *
 * Example usages:
 *   - Practice mode:        layers: ["local"]
 *   - Training (local-first AI fallback):  layers: ["local", "ai"]
 *   - Offline mode:         layers: ["local", "public"]
 *   - Multiplayer (authoritative): layers: ["ai"]
 */

const DICT_BASE_PATH = "assets/dict";
const dictCache = new Map(); // lang -> { set: Set<string>, ready: Promise }

// Public API endpoints per language.
const PUBLIC_ENDPOINTS = {
  es: (word) => `https://rae-api.com/api/words/${encodeURIComponent(word.toLowerCase())}`,
  en: (word) => `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`,
};

// Injected by the host app (e.g. main.js) so this module does not import the
// worker directly — keeps it testable. If the consumer never sets one, the
// "ai" layer always returns unknown.
let _aiValidator = null;

/**
 * Inject the AI validator function. It must return a Promise resolving to
 * either { valid: true } or { valid: false } (or null on error).
 */
export function setAiValidator(fn) {
  _aiValidator = typeof fn === "function" ? fn : null;
}

/**
 * Inject a fetch implementation (useful for tests). Defaults to global fetch.
 */
let _fetch = (typeof fetch === "function") ? fetch.bind(globalThis) : null;
export function setFetchImpl(fn) {
  _fetch = fn;
}

// ─── Local dictionary loading ───────────────────────────────────────────────

async function loadLocalDict(lang) {
  if (dictCache.has(lang)) return dictCache.get(lang).ready;
  const entry = { set: null, ready: null };
  entry.ready = (async () => {
    if (!_fetch) throw new Error("No fetch implementation");
    const res = await _fetch(`${DICT_BASE_PATH}/${lang}.txt`, { cache: "force-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${lang} dict`);
    const text = await res.text();
    entry.set = new Set(text.split("\n").map((w) => w.trim().toLowerCase()).filter(Boolean));
    return entry.set;
  })();
  dictCache.set(lang, entry);
  return entry.ready;
}

// Test/internal helper to clear the cache.
export function _resetCache() {
  dictCache.clear();
}

// ─── Layer implementations ──────────────────────────────────────────────────

async function tryLocal(word, lang) {
  try {
    const set = await loadLocalDict(lang);
    if (set.has(word.toLowerCase())) return { result: "accepted", source: "local" };
    return { result: "unknown", source: "local" };
  } catch (err) {
    return { result: "unknown", source: "local", error: err.message };
  }
}

async function tryPublic(word, lang) {
  const builder = PUBLIC_ENDPOINTS[lang];
  if (!builder) return { result: "unknown", source: "public", error: "no endpoint" };
  if (!_fetch) return { result: "unknown", source: "public", error: "no fetch" };
  if (!isOnline()) return { result: "unknown", source: "public", error: "offline" };
  try {
    const res = await _fetch(builder(word), { cache: "no-store" });
    if (res.status === 200) return { result: "accepted", source: "public" };
    if (res.status === 404) return { result: "rejected", source: "public" };
    return { result: "unknown", source: "public", error: `HTTP ${res.status}` };
  } catch (err) {
    return { result: "unknown", source: "public", error: err.message };
  }
}

async function tryAi(word, lang, ctx) {
  if (!_aiValidator) return { result: "unknown", source: "ai", error: "no validator" };
  if (!isOnline()) return { result: "unknown", source: "ai", error: "offline" };
  try {
    const out = await _aiValidator(word, lang, ctx);
    if (out && out.valid === true) return { result: "accepted", source: "ai", raw: out };
    if (out && out.valid === false) return { result: "rejected", source: "ai", raw: out };
    return { result: "unknown", source: "ai", error: "invalid response" };
  } catch (err) {
    return { result: "unknown", source: "ai", error: err.message };
  }
}

function isOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

const LAYERS = { local: tryLocal, public: tryPublic, ai: tryAi };

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Validate a word's existence using the requested layers in order.
 *
 * @param {string} word
 * @param {object} [opts]
 * @param {"es"|"en"} [opts.language="es"]
 * @param {Array<"local"|"public"|"ai">} [opts.layers=["local","ai"]]
 * @returns {Promise<{ valid: boolean, source: string, elapsedMs: number, traces: object[] }>}
 *          valid=true if any layer accepted; valid=false if any layer rejected
 *          before another accepted; valid=false also if all layers returned unknown.
 *          source = which layer produced the verdict ("local"|"public"|"ai"|"none").
 *          traces = per-layer outcomes for debugging.
 */
export async function validateWord(word, opts = {}) {
  const { language = "es", layers = ["local", "ai"], aiContext = null } = opts;
  const start = Date.now();
  const traces = [];

  if (!word || typeof word !== "string") {
    return { valid: false, source: "none", elapsedMs: 0, traces, reason: "empty" };
  }

  for (const layerName of layers) {
    const layer = LAYERS[layerName];
    if (!layer) {
      traces.push({ layer: layerName, result: "skipped", error: "unknown layer" });
      continue;
    }
    const out = await layer(word, language, aiContext);
    traces.push({ layer: layerName, ...out });
    if (out.result === "accepted") {
      return { valid: true, source: out.source, elapsedMs: Date.now() - start, traces, raw: out.raw };
    }
    if (out.result === "rejected") {
      return { valid: false, source: out.source, elapsedMs: Date.now() - start, traces, raw: out.raw };
    }
    // unknown → try next layer
  }

  // All layers returned unknown → conservatively reject.
  return { valid: false, source: "none", elapsedMs: Date.now() - start, traces };
}

// Exported for tests / advanced usage.
export const _internals = { tryLocal, tryPublic, tryAi, loadLocalDict };

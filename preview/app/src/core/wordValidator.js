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

import { decodeDict } from "./dictCodec.js";

const DICT_BASE_PATH = "assets/dict";
const dictCache = new Map(); // lang -> { set: Set<string>, ready: Promise }

// Centralised layer presets, picked by call-site context. Change them here to
// adjust validator behaviour globally without touching every caller.
// All app presets currently use only the local dictionary. Public/AI layers
// remain implemented for diagnostics or future modes, but are not part of
// normal validation presets.
export const LAYER_PRESETS = Object.freeze({
  training: ["local"],
  match:    ["local"],
  debug:    ["local"],
});

// Public API endpoints per language.
//   check(word) → fetches the endpoint and returns one of
//                 "accepted" | "rejected" | "unknown".
//
// We use Wiktionary's MediaWiki API (NOT the REST API which blocks browsers):
//   https://es.wiktionary.org/w/api.php?action=query&titles=WORD&format=json&origin=*
// The "&origin=*" param activates CORS for browsers. The response always
// returns HTTP 200; we determine existence by checking whether the page id
// is positive (found) or -1 with a "missing" field (not found).
//
// Wiktionary covers BOTH languages with the same API shape and includes
// inflected/conjugated forms (was, be, estaba, papá, corriendo, etc.).
// License: content is CC-BY-SA/GFDL, commercial use permitted.

// Wiktionary is case-sensitive AND accent-sensitive: "halito" ≠ "hálito".
// To honour the asymmetric accent rule (user without accents accepts either
// form), we do two queries when needed:
//   1. exact title query — fast path.
//   2. If user typed no accents and exact query is missing → opensearch
//      (Wiktionary's autocomplete is accent-tolerant). Accept if any single-
//      word suggestion matches the query once both are accent-stripped.
async function wiktionaryCheck(word, langPrefix) {
  if (!_fetch) return "unknown";
  const baseUrl = `https://${langPrefix}.wiktionary.org/w/api.php`;

  // 1. Exact title query.
  const url1 = `${baseUrl}?action=query&titles=${encodeURIComponent(word)}&format=json&origin=*`;
  const r1 = await _fetch(url1, { cache: "no-store" });
  if (!r1.ok) return "unknown";
  const d1 = await r1.json();
  const pages = d1?.query?.pages;
  if (pages && typeof pages === "object") {
    for (const key of Object.keys(pages)) {
      if (key !== "-1" && !("missing" in (pages[key] || {}))) return "accepted";
    }
  }

  // If user typed accents → exact match is required by rule.
  if (hasAccentChar(word)) return "rejected";

  // 2. User typed no accents → ask opensearch for accent-tolerant suggestions.
  const url2 = `${baseUrl}?action=opensearch&search=${encodeURIComponent(word)}&limit=10&format=json&origin=*`;
  const r2 = await _fetch(url2, { cache: "no-store" });
  if (!r2.ok) return "unknown";
  const d2 = await r2.json();
  const titles = Array.isArray(d2) ? d2[1] : null;
  if (!Array.isArray(titles)) return "unknown";
  const normQuery = normalizeForLookup(word);
  for (const t of titles) {
    if (typeof t !== "string") continue;
    if (t.includes(" ")) continue; // skip multi-word locutions
    if (normalizeForLookup(t) === normQuery) return "accepted";
  }
  return "rejected";
}

const PUBLIC_ENDPOINTS = {
  es: { check: (word) => wiktionaryCheck(word, "es") },
  en: { check: (word) => wiktionaryCheck(word, "en") },
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

// Normalise for accent-insensitive lookup: lowercase + strip accents from
// vowels, keep ñ. "Hálito" → "halito", "vergüenza" → "verguenza", "España"
// stays "españa". Used for the asymmetric lookup rule:
//   - user typed WITH accents  → exact match only against the original set
//   - user typed WITHOUT accents → match against the normalised set
function normalizeForLookup(word) {
  return (word || "")
    .toLowerCase()
    .replace(/[áàâä]/g, "a")
    .replace(/[éèêë]/g, "e")
    .replace(/[íìîï]/g, "i")
    .replace(/[óòôö]/g, "o")
    .replace(/[úùûü]/g, "u");
}

function hasAccentChar(word) {
  return /[áéíóúüàèìòùâêîôûäëïö]/i.test(word);
}

async function loadLocalDict(lang) {
  if (dictCache.has(lang)) return dictCache.get(lang).ready;
  const entry = { exact: null, normalized: null, ready: null };
  entry.ready = (async () => {
    if (!_fetch) throw new Error("No fetch implementation");
    const res = await _fetch(`${DICT_BASE_PATH}/${lang}.bin`, { cache: "force-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${lang} dict`);
    const buf = await res.arrayBuffer();
    const text = await decodeDict(buf);
    const lines = text.split("\n").map((w) => w.trim().toLowerCase()).filter(Boolean);
    entry.exact = new Set(lines);
    entry.normalized = new Set(lines.map(normalizeForLookup));
    return entry;
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
    const { exact, normalized } = await loadLocalDict(lang);
    const lower = word.toLowerCase();
    if (hasAccentChar(lower)) {
      // User wrote accents → require an exact match against the dictionary.
      if (exact.has(lower)) return { result: "accepted", source: "local" };
    } else {
      // No accents typed → accept any dictionary entry whose accent-less form
      // matches (so "halito" finds "hálito", "PAPA" finds "papá" or "papa").
      if (normalized.has(lower)) return { result: "accepted", source: "local" };
    }
    return { result: "unknown", source: "local" };
  } catch (err) {
    return { result: "unknown", source: "local", error: err.message };
  }
}

async function tryPublic(word, lang) {
  const endpoint = PUBLIC_ENDPOINTS[lang];
  if (!endpoint) return { result: "unknown", source: "public", error: "no endpoint" };
  if (!_fetch) return { result: "unknown", source: "public", error: "no fetch" };
  if (!isOnline()) return { result: "unknown", source: "public", error: "offline" };
  try {
    const result = await endpoint.check(word);
    return { result, source: "public" };
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

/**
 * Debug variant: run every requested layer independently and return the per-
 * layer outcome without short-circuiting. Useful for the dev/help inspector
 * where you want to see what each engine says about the same word.
 *
 * @returns {Promise<{ language, layers: Array<{ layer, result, source, error, elapsedMs }> }>}
 */
export async function validateWordDebug(word, opts = {}) {
  const { language = "es", layers = ["local", "public", "ai"], aiContext = null } = opts;
  if (!word || typeof word !== "string") {
    return { language, layers: layers.map((l) => ({ layer: l, result: "skipped", error: "empty" })) };
  }
  const runs = await Promise.all(
    layers.map(async (layerName) => {
      const layer = LAYERS[layerName];
      if (!layer) return { layer: layerName, result: "skipped", error: "unknown layer" };
      const t0 = Date.now();
      const out = await layer(word, language, aiContext);
      return { layer: layerName, ...out, elapsedMs: Date.now() - t0 };
    }),
  );
  return { language, layers: runs };
}

// Exported for tests / advanced usage.
export const _internals = { tryLocal, tryPublic, tryAi, loadLocalDict };

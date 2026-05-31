/**
 * core/hintSolver.js — Word suggestion engine for training mode.
 *
 * Given a training match state, returns N words the player could form using
 * their hand + the central board, respecting the same rules as finalizeUserWord:
 *   - must include at least one card from hand AND one from the central board
 *   - must satisfy any forced rules (philologist, brain_squeeze, use_vowel,
 *     use_consonant, use_letter, in_english, in_spanish)
 *   - wildcards (vowel/consonant/any) may substitute missing letters
 *
 * Each returned hint includes the candidate word, the cards that compose it
 * (so the UI can lay them out), and the score that finalizeUserWord would
 * compute for that exact composition.
 *
 * Dictionaries are loaded lazily from /assets/dict/<lang>.txt and cached in
 * module scope. Lines at the top of each file are the most frequent words —
 * the solver scans from the top so common words surface first.
 */

import {
  buildWordFromCards,
  computeWordScore,
  computeWordScoreDetailed,
  countSyllables,
  hasTilde,
  containsLetter,
  getForcedWordLanguage,
} from "./wordRules.js";
import { decodeDict } from "./dictCodec.js";

const DICT_BASE_PATH = "assets/dict";
const dictCache = new Map(); // lang -> { words: string[], ready: Promise }

const VOWEL_RE = /[aeiouáéíóúü]/i;
const ACCENTED_RE = /[áéíóúüÁÉÍÓÚÜ]/;

function hasAccentedChar(word) { return ACCENTED_RE.test(word); }

function stripAccents(word) {
  return word
    .replace(/[áÁ]/g, (c) => c === "á" ? "a" : "A")
    .replace(/[éÉ]/g, (c) => c === "é" ? "e" : "E")
    .replace(/[íÍ]/g, (c) => c === "í" ? "i" : "I")
    .replace(/[óÓ]/g, (c) => c === "ó" ? "o" : "O")
    .replace(/[úüÚÜ]/g, (c) => (c === "ú" || c === "ü") ? "u" : "U");
}

// Default scan limits per difficulty profile.
const SCAN_LIMITS = {
  easy:   10_000,
  normal: 30_000,
  hard:   Infinity, // scan whole dictionary
};

// ─── Dictionary loading ─────────────────────────────────────────────────────

async function loadDict(lang) {
  if (dictCache.has(lang)) return dictCache.get(lang).ready;
  const entry = { words: null, ready: null };
  entry.ready = (async () => {
    const res = await fetch(`${DICT_BASE_PATH}/${lang}.bin`, { cache: "force-cache" });
    if (!res.ok) throw new Error(`Could not load dictionary for ${lang}: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const text = await decodeDict(buf);
    entry.words = text.split("\n").filter(Boolean);
    return entry.words;
  })();
  dictCache.set(lang, entry);
  return entry.ready;
}

// ─── Context extracted from training state ──────────────────────────────────

function buildContext(state) {
  const userId = state.players?.[0]?.id;
  if (!userId) return null;
  const hand = state.hands?.[userId];
  const handLetters = hand && hand !== "<hidden>" ? (hand.letters ?? []) : [];
  const board = state.centralBoard ?? [];
  const forcedEffects = state.forcedRules?.[userId] ?? [];
  const plusMinus = state.scoreModifiers?.[userId] ?? 0;
  const baseLang = state.language || "es";
  const effectiveLang = getForcedWordLanguage(baseLang, forcedEffects);

  // Split source cards by origin to enforce "≥1 from hand AND ≥1 from board".
  const handCards = handLetters.filter(Boolean);
  const boardCards = board.filter(Boolean);

  // Build per-letter pools indexed by uppercase plain letter.
  // Each entry holds a list of card candidates (with their score-relevant attrs)
  // so we can later pick the best-scoring composition.
  const handPool = indexCardsByLetter(handCards, "hand");
  const boardPool = indexCardsByLetter(boardCards, "board");

  // Wildcards available (by kind). These can substitute any letter that fits
  // their kind: vowel-wildcard for vowels, consonant-wildcard for consonants,
  // action-generated wildcard for any letter.
  const wildcardsHand = handCards.filter((c) => c.isWildcard).map((c) => ({
    ...c,
    source: "hand",
    wildKind: c.kind, // "vowel" | "consonant" | "wildcard"
  }));
  const wildcardsBoard = boardCards.filter((c) => c.isWildcard).map((c) => ({
    ...c,
    source: "board",
    wildKind: c.kind,
  }));

  // Pre-collect forced letters that the word MUST contain (use_vowel / use_consonant
  // / use_letter). Stored uppercased for fast filtering later.
  const requiredLetters = [];
  let mustHaveTilde = false;
  let minSyllables = 0;
  for (const e of forcedEffects) {
    if (e.actionId === "philologist") mustHaveTilde = true;
    if (e.actionId === "brain_squeeze") minSyllables = Math.max(minSyllables, 3);
    if (["use_vowel", "use_consonant", "use_letter"].includes(e.actionId)) {
      if (e.payload?.letter) requiredLetters.push(e.payload.letter.toUpperCase());
    }
  }

  return {
    userId,
    handPool,
    boardPool,
    wildcardsHand,
    wildcardsBoard,
    handCards,
    boardCards,
    forcedEffects,
    plusMinus,
    requiredLetters,
    mustHaveTilde,
    minSyllables,
    effectiveLang,
    baseLang,
  };
}

// Build Map<letter, Array<card>> for all non-wildcard cards.
// Each card is normalised to include the score-relevant properties.
function indexCardsByLetter(cards, source) {
  const map = new Map();
  for (const c of cards) {
    if (c.isWildcard) continue;
    const letter = (c.letter || "").toUpperCase();
    if (!letter) continue;
    const entry = { ...c, source };
    if (!map.has(letter)) map.set(letter, []);
    map.get(letter).push(entry);
    // Letters that have a tilde variant can ALSO satisfy the tilde-form letter
    // (e.g. card "A" can satisfy "Á" via usingTilde).
    if (c.tildeForm) {
      const t = c.tildeForm.toUpperCase();
      if (!map.has(t)) map.set(t, []);
      map.get(t).push({ ...entry, _matchesViaTilde: true });
    }
  }
  return map;
}

// ─── Word composition ────────────────────────────────────────────────────────

// Try to build the word from available cards. Returns a composition
// { selectedCards, score, usedHand, usedBoard, wordStr } or null if impossible.
//
// Strategy: greedy left-to-right consumption of letters. For each letter in
// the target word we try to consume (in priority order):
//   1. A real card matching the letter (prefer the one with highest score
//      and from the source we need more of, to balance hand/board usage).
//   2. A wildcard matching the letter's kind (vowel/consonant/any).
//
// Because the greedy approach can fail to balance "≥1 from hand AND ≥1 from
// board", we re-run with a balanced strategy if the first pass succeeds but
// fails the hand/board constraint.
function tryComposeWord(targetWord, ctx) {
  if (!targetWord) return null;

  // Quick pre-filter: every letter in the word must be either available
  // somewhere (hand or board, real or wildcard) — cheap early exit.
  const upper = targetWord.toUpperCase();

  // Pool copies (we'll consume from these). Cards stay in original arrays;
  // we track usage by index.
  const handAvail = clonePool(ctx.handPool);
  const boardAvail = clonePool(ctx.boardPool);
  const handWilds = ctx.wildcardsHand.map((w) => ({ ...w, _used: false }));
  const boardWilds = ctx.wildcardsBoard.map((w) => ({ ...w, _used: false }));

  const selected = [];
  for (const ch of upper) {
    const pickedReal = consumeRealLetter(ch, handAvail, boardAvail);
    if (pickedReal) {
      selected.push(pickedReal);
      continue;
    }
    const pickedWild = consumeWildcardFor(ch, handWilds, boardWilds);
    if (pickedWild) {
      selected.push(pickedWild);
      continue;
    }
    return null; // letter not satisfiable
  }

  // Enforce: must use ≥1 card from hand AND ≥1 from board.
  const usedHand = selected.some((c) => c.source === "hand");
  const usedBoard = selected.some((c) => c.source === "board");
  if (!usedHand || !usedBoard) return null;

  // Build the score-shaped card list for the scoring helper.
  const scoreCards = selected.map(toScoreCard);
  const allUserLetterIds = ctx.handCards.map((c) => c.id);
  const allBoardLetterIds = ctx.boardCards.map((c) => c.id);
  const detail = computeWordScoreDetailed({
    selectedCards: scoreCards,
    allUserLetters: allUserLetterIds,
    allBoardLetters: allBoardLetterIds,
    plusMinus: ctx.plusMinus,
  });

  return {
    word: buildWordFromCards(scoreCards),
    score: detail.score,
    breakdown: detail.parts,
    cards: scoreCards,
    usedWildcard: scoreCards.some((c) => c.isWildcard),
  };
}

function clonePool(pool) {
  const next = new Map();
  for (const [k, arr] of pool) {
    next.set(k, arr.map((c) => ({ ...c, _used: false })));
  }
  return next;
}

// Pick the highest-value real card that matches `ch` from either pool.
// Prefers cards that, when used together, can leave at least one of each source
// for the rest of the word. We use a simple heuristic: if hand has matches but
// hasn't been touched yet AND board has many matches → pick from hand to
// guarantee the hand-source requirement. Otherwise pick the highest-value.
function consumeRealLetter(ch, handAvail, boardAvail) {
  const handArr = handAvail.get(ch) || [];
  const boardArr = boardAvail.get(ch) || [];
  const handFree = handArr.filter((c) => !c._used);
  const boardFree = boardArr.filter((c) => !c._used);
  if (handFree.length === 0 && boardFree.length === 0) return null;

  // Pick the card with the higher effective value (considering tilde if it
  // matches via tilde).
  let best = null;
  for (const c of handFree.concat(boardFree)) {
    const val = effectiveValue(c, ch);
    if (!best || val > best._val) best = { ...c, _val: val };
  }
  // Mark used.
  if (best.source === "hand") {
    const list = handAvail.get(ch);
    const idx = list.findIndex((c) => c.id === best.id && !c._used);
    list[idx]._used = true;
  } else {
    const list = boardAvail.get(ch);
    const idx = list.findIndex((c) => c.id === best.id && !c._used);
    list[idx]._used = true;
  }
  return best;
}

function consumeWildcardFor(ch, handWilds, boardWilds) {
  const isVowel = VOWEL_RE.test(ch);
  // Try any-kind first, then matching kind (vowel for vowel, consonant for consonant).
  const all = handWilds.concat(boardWilds).filter((w) => !w._used);
  // Prefer the most permissive ("wildcard" kind) so vowel/consonant ones stay.
  all.sort((a, b) => kindPriority(a.wildKind) - kindPriority(b.wildKind));
  for (const w of all) {
    if (canWildcardCover(w.wildKind, isVowel)) {
      w._used = true;
      return { ...w, chosenLetter: ch };
    }
  }
  return null;
}

function kindPriority(kind) {
  if (kind === "wildcard") return 0;
  if (kind === "vowel") return 1;
  if (kind === "consonant") return 2;
  return 3;
}

function canWildcardCover(kind, isVowel) {
  if (kind === "wildcard") return true;
  if (kind === "vowel" && isVowel) return true;
  if (kind === "consonant" && !isVowel) return true;
  return false;
}

function effectiveValue(card, ch) {
  // If the card was indexed via its tilde-form and the target letter is the
  // accented version, use tildeValue.
  if (card._matchesViaTilde && card.tildeValue != null) return card.tildeValue;
  return card.value ?? 0;
}

function toScoreCard(card) {
  // Shape the card the way computeWordScore / buildWordFromCards expects.
  return {
    id: card.id,
    letter: card.letter,
    value: card.value,
    tildeValue: card.tildeValue ?? null,
    tildeForm: card.tildeForm,
    color: card.color,
    isWildcard: !!card.isWildcard,
    chosenLetter: card.chosenLetter,
    usingTilde: !!card._matchesViaTilde,
    tildeChar: card._matchesViaTilde ? card.tildeForm : undefined,
    source: card.source,
  };
}

// ─── Pre-filters ─────────────────────────────────────────────────────────────

// Check whether a candidate word could possibly be formed without doing the
// (more expensive) full composition. Fast checks first.
function preFilter(word, ctx) {
  if (word.length < 2) return false;

  // Forced letters must appear in the word.
  for (const req of ctx.requiredLetters) {
    if (!containsLetter(word, req)) return false;
  }
  // Philologist: word must have at least one tilde character.
  if (ctx.mustHaveTilde && !hasTilde(word)) return false;
  // Brain squeeze: syllable count.
  if (ctx.minSyllables > 0) {
    if (countSyllables(word, ctx.effectiveLang) < ctx.minSyllables) return false;
  }
  return true;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Find up to `count` hint words for the current training state.
 *
 * @param {object} state Training match state (same shape as finalizeUserWord).
 * @param {object} [options]
 * @param {number} [options.count=5]            How many hints to return.
 * @param {"easy"|"normal"|"hard"} [options.difficulty="normal"]
 *                                              Scan depth and sorting strategy.
 * @param {string} [options.language]           Override the effective language.
 * @param {number} [options.maxScan]            Override the scan limit explicitly.
 * @returns {Promise<Array<{word:string,score:number,cards:object[],usedWildcard:boolean}>>}
 *          Sorted best-first. Empty array if no candidates found.
 */
export async function findHints(state, options = {}) {
  const {
    count = 5,
    difficulty = "normal",
    language,
    maxScan,
  } = options;

  const ctx = buildContext(state);
  if (!ctx) return [];

  const lang = language || ctx.effectiveLang;
  let dict;
  try {
    dict = await loadDict(lang);
  } catch (err) {
    console.warn("[hintSolver] dict load failed", err);
    return [];
  }

  const scanLimit = maxScan ?? (SCAN_LIMITS[difficulty] ?? SCAN_LIMITS.normal);
  const limit = Math.min(scanLimit, dict.length);

  const found = [];
  for (let i = 0; i < limit; i++) {
    const word = dict[i].toUpperCase();
    if (!preFilter(word, ctx)) continue;
    // First try the exact word (with whatever accents the dictionary has).
    let composition = tryComposeWord(word, ctx);
    // If the user can't form the accented version but the word is real, also
    // accept the non-accented form (rule: real dictionary word counts, even
    // if the player can't or doesn't include the accent).
    if (!composition && hasAccentedChar(word)) {
      const stripped = stripAccents(word);
      // Re-check pre-filter against the stripped form: philologist requires
      // a tilde, so the stripped form would not pass that check.
      if (preFilter(stripped, ctx)) {
        composition = tryComposeWord(stripped, ctx);
      }
    }
    if (!composition) continue;
    found.push({ ...composition, _rank: i });
    // For easy/normal we can early-exit once we have enough candidates of
    // sufficient quality. For hard we must keep scanning to find max score.
    if (difficulty !== "hard" && found.length >= count * 4) break;
  }

  if (found.length === 0) return [];

  // Sort according to difficulty.
  if (difficulty === "hard") {
    // Highest score wins; tiebreak by frequency rank (lower _rank = more common).
    found.sort((a, b) => (b.score - a.score) || (a._rank - b._rank));
  } else if (difficulty === "easy") {
    // Common, short, with decent score: rank score-per-letter and prefer
    // top-frequency entries (low _rank).
    found.sort((a, b) => {
      const aDensity = a.score / Math.max(1, a.word.length);
      const bDensity = b.score / Math.max(1, b.word.length);
      if (bDensity !== aDensity) return bDensity - aDensity;
      return a._rank - b._rank;
    });
  } else {
    // normal: balanced — score desc, then frequency rank asc.
    found.sort((a, b) => (b.score - a.score) || (a._rank - b._rank));
  }

  return found.slice(0, count).map(({ _rank, ...rest }) => rest);
}

// Test helpers — allow injecting a fake dictionary so tests don't need network.
export function _injectDict(lang, words) {
  dictCache.set(lang, {
    words,
    ready: Promise.resolve(words),
  });
}

export function _resetCache() {
  dictCache.clear();
}

// Exported for tests.
export const _internals = {
  buildContext,
  tryComposeWord,
  preFilter,
  loadDict,
};

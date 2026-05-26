// Local validators for "forced rules" imposed by action cards in training mode.
// These run BEFORE the AI validator. If any forced rule fails, the word
// scores 0 — see manual §6 "Reglas forzadas".

const TILDE_CHARS = /[áéíóúüÁÉÍÓÚÜ]/;

// Word in this codebase is always uppercase, no diacritics-stripped.
// Build the plain word from the cards selected by the user (in order).
export function buildWordFromCards(selectedCards) {
  return (selectedCards ?? [])
    .map((c) => {
      if (c.isWildcard) return c.chosenLetter || "";
      if (c.usingTilde && c.tildeChar) return c.tildeChar;
      return c.letter;
    })
    .join("");
}

export function hasTilde(word) {
  return TILDE_CHARS.test(word);
}

// Spanish syllable counter — approximation by counting vowel groups,
// honoring diphthongs and tildes (which break diphthongs).
const STRONG_VOWELS = new Set(["A", "E", "O", "Á", "É", "Í", "Ó", "Ú"]);
const WEAK_VOWELS = new Set(["I", "U", "Ü"]);
const ACCENTED_WEAK = new Set(["Í", "Ú"]);

function isVowelChar(ch) {
  const u = ch.toUpperCase();
  return STRONG_VOWELS.has(u) || WEAK_VOWELS.has(u);
}

export function countSyllables(word, lang = "es") {
  if (!word) return 0;
  if (lang === "en") return countEnglishSyllables(word);
  if (lang !== "es") {
    // Generic fallback: count vowel groups including accented vowels.
    const groups = word.toUpperCase().match(/[AEIOUYÁÉÍÓÚÜÀÈÌÒÙÂÊÎÔÛÄËÏÖÜ]+/g);
    return groups ? Math.max(1, groups.length) : 0;
  }
  const w = word.toUpperCase();
  let count = 0;
  let i = 0;
  while (i < w.length) {
    if (!isVowelChar(w[i])) { i += 1; continue; }
    // Collect contiguous vowels and decide how many syllables they form.
    let group = "";
    while (i < w.length && isVowelChar(w[i])) {
      group += w[i];
      i += 1;
    }
    count += syllableCountForVowelGroup(group);
  }
  return count;
}

// English syllable count — heuristic that handles the most common patterns:
//   1. Words ending in consonant+"le" treat the "le" as one syllable, separately.
//   2. Otherwise drop a silent trailing "e".
//   3. Count vowel groups (consecutive aeiouy as 1 group) in what remains.
function countEnglishSyllables(word) {
  if (!word) return 0;
  let w = word.toLowerCase();
  const endsLe = w.length > 2 && /[^aeiouy]le$/.test(w);
  if (endsLe) {
    // Drop the trailing "e" (the "le" becomes its own syllable, added below).
    w = w.slice(0, -1);
  } else if (w.length > 2 && w.endsWith("e")) {
    // Silent trailing "e" (e.g. "make", "house").
    w = w.slice(0, -1);
  }
  const groups = w.match(/[aeiouy]+/g);
  let count = groups ? groups.length : 0;
  if (endsLe) count += 1;
  return Math.max(1, count);
}

function syllableCountForVowelGroup(group) {
  if (group.length === 1) return 1;
  // Two-vowel group: diphthong if (strong+weak) or (weak+weak) and weak is NOT accented;
  // otherwise hiatus (2 syllables).
  if (group.length === 2) {
    const [a, b] = group;
    const aStrong = STRONG_VOWELS.has(a);
    const bStrong = STRONG_VOWELS.has(b);
    const aAccentedWeak = ACCENTED_WEAK.has(a);
    const bAccentedWeak = ACCENTED_WEAK.has(b);
    if (aAccentedWeak || bAccentedWeak) return 2;
    if (aStrong && bStrong) return 2;
    return 1;
  }
  // 3+ vowels: triphthong (strong in middle, weak on sides) = 1 syllable,
  // otherwise split conservatively (count distinct strong vowels).
  let strongs = 0;
  for (const ch of group) if (STRONG_VOWELS.has(ch)) strongs += 1;
  return Math.max(1, strongs);
}

// Check that the selected cards include at least one from the central board
// AND at least one from the user's hand. Manual §7 "Formación de palabra".
export function usesAtLeastOneFromBoardAndHand(selectedCards, boardIds, handLetterIds) {
  let fromBoard = false;
  let fromHand = false;
  for (const c of selectedCards ?? []) {
    if (boardIds.has(c.id)) fromBoard = true;
    if (handLetterIds.has(c.id)) fromHand = true;
  }
  return fromBoard && fromHand;
}

// Whether the word contains the given letter (case-insensitive, tilde-insensitive).
export function containsLetter(word, letter) {
  if (!word || !letter) return false;
  const w = word.toUpperCase();
  const l = letter.toUpperCase();
  // Strip tildes for comparison
  const stripped = w.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const lStripped = l.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return stripped.includes(lStripped);
}

// Aggregate validation against the active pending effects on the user.
// effects: [{ actionId, source, payload? }]
//   - philologist:    word must have a tilde
//   - brain_squeeze:  word must have 3+ syllables
//   - use_vowel / use_consonant / use_letter:
//        payload.letter (the central-board letter chosen by the caster) must appear
//   - in_english:     handled by the AI validator (language switch), not here
//
// Returns { ok: boolean, violations: string[] }.
export function validateForcedRules({ word, selectedCards, effects, lang = "es" }) {
  const violations = [];
  for (const e of effects ?? []) {
    switch (e.actionId) {
      case "philologist":
        if (!hasTilde(word)) violations.push("philologist");
        break;
      case "brain_squeeze":
        if (countSyllables(word, lang) < 3) violations.push("brain_squeeze");
        break;
      case "use_vowel":
      case "use_consonant":
      case "use_letter":
        if (e.payload?.letter && !containsLetter(word, e.payload.letter)) {
          violations.push(e.actionId);
        }
        break;
      default:
        break;
    }
  }
  return { ok: violations.length === 0, violations };
}

// Compute the word's score given the selected cards and any active modifiers.
// Manual §7:
//   1. Sum letter values (use tildeValue if usingTilde and tildeValue != null).
//   2. Apply +/- from action cards (e.g. boost_total +6, explosion -4, in_english +10).
//   3. Apply x2 if all selected cards share color OR if the user used all of
//      their own letters AND all the central board letters.
// Forced-rule violations: caller is responsible for short-circuiting to 0.
export function computeWordScore({ selectedCards, allUserLetters, allBoardLetters, plusMinus = 0 }) {
  if (!selectedCards || selectedCards.length === 0) return 0;
  let base = 0;
  for (const c of selectedCards) {
    if (c.isWildcard) continue; // wildcards add 0 (the boost is via wildcard action card)
    base += c.usingTilde && c.tildeValue != null ? c.tildeValue : c.value;
  }
  base += plusMinus;

  // x2 conditions
  const colors = new Set(selectedCards.filter((c) => !c.isWildcard).map((c) => c.color));
  const sameColor = colors.size === 1 && colors.has([...colors][0]);
  const usedAllUserLetters = (allUserLetters ?? []).every((id) =>
    selectedCards.some((c) => c.id === id),
  );
  const usedAllBoardLetters = (allBoardLetters ?? []).every((id) =>
    selectedCards.some((c) => c.id === id),
  );
  const doubled = sameColor || (usedAllUserLetters && usedAllBoardLetters);
  return doubled ? base * 2 : base;
}

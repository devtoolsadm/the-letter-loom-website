import { describe, it, expect, beforeEach } from "vitest";
import { findHints, _injectDict, _resetCache } from "../hintSolver.js";
import { makeLetter, makeConsonant, makeState, resetIds } from "./helpers.js";

// ─── Helpers to build training-state shapes for the solver ──────────────────

function withHandAndBoard({ hand = [], board = [], forced = [], plusMinus = 0, language = "es" } = {}) {
  return makeState({
    language,
    hands: { p1: { letters: hand, actions: [] } },
    centralBoard: board,
    forcedRules: { p1: forced },
    scoreModifiers: { p1: plusMinus },
  });
}

beforeEach(() => {
  _resetCache();
  resetIds();
});

// ─── Basic composition ──────────────────────────────────────────────────────

describe("findHints - basic composition", () => {
  it("returns a hint when a dictionary word can be formed using ≥1 hand + ≥1 board letter", async () => {
    _injectDict("es", ["casa", "perro"]);
    const state = withHandAndBoard({
      hand: [makeLetter({ letter: "C", value: 3, color: "red" })],
      board: [
        makeLetter({ letter: "A", value: 2, color: "blue" }),
        makeConsonant({ letter: "S", value: 4, color: "blue" }),
        makeLetter({ letter: "A", value: 2, color: "blue" }),
      ],
    });
    const hints = await findHints(state, { count: 5, difficulty: "hard" });
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0].word).toBe("CASA");
    expect(hints[0].score).toBeGreaterThan(0);
  });

  it("returns empty array when no word can be formed", async () => {
    _injectDict("es", ["casa"]);
    const state = withHandAndBoard({
      hand: [makeLetter({ letter: "X" })],
      board: [makeLetter({ letter: "Z" })],
    });
    const hints = await findHints(state, { count: 5 });
    expect(hints).toEqual([]);
  });

  it("rejects a word that uses only hand letters (no board letter)", async () => {
    _injectDict("es", ["cas"]);
    const state = withHandAndBoard({
      hand: [
        makeLetter({ letter: "C" }),
        makeLetter({ letter: "A" }),
        makeConsonant({ letter: "S" }),
      ],
      board: [makeLetter({ letter: "O" })],
    });
    const hints = await findHints(state, { count: 5 });
    expect(hints).toEqual([]);
  });

  it("rejects a word that uses only board letters (no hand letter)", async () => {
    _injectDict("es", ["cas"]);
    const state = withHandAndBoard({
      hand: [makeLetter({ letter: "O" })],
      board: [
        makeLetter({ letter: "C" }),
        makeLetter({ letter: "A" }),
        makeConsonant({ letter: "S" }),
      ],
    });
    const hints = await findHints(state, { count: 5 });
    expect(hints).toEqual([]);
  });

  it("respects count parameter", async () => {
    _injectDict("es", ["sa", "as", "casa", "asa", "sas"]);
    const state = withHandAndBoard({
      hand: [makeConsonant({ letter: "S" }), makeLetter({ letter: "C" })],
      board: [makeLetter({ letter: "A" }), makeLetter({ letter: "A" })],
    });
    const hints = await findHints(state, { count: 2, difficulty: "hard" });
    expect(hints.length).toBeLessThanOrEqual(2);
  });
});

// ─── Wildcards ───────────────────────────────────────────────────────────────

describe("findHints - wildcards", () => {
  it("uses a vowel wildcard to substitute a missing vowel", async () => {
    _injectDict("es", ["casa"]);
    // Hand has C and a vowel wildcard, board has S+A.
    const state = withHandAndBoard({
      hand: [
        makeLetter({ letter: "C", kind: "consonant", color: "red" }),
        makeLetter({ letter: "*", isWildcard: true, kind: "vowel", value: 0, color: "none" }),
      ],
      board: [
        makeConsonant({ letter: "S" }),
        makeLetter({ letter: "A" }),
      ],
    });
    const hints = await findHints(state, { count: 5, difficulty: "hard" });
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0].word).toBe("CASA");
    expect(hints[0].usedWildcard).toBe(true);
  });

  it("does NOT use a consonant wildcard for a vowel slot", async () => {
    _injectDict("es", ["ana"]);
    // Hand has A + consonant wildcard. Board has N. Missing 2nd A.
    // Consonant wildcard cannot fill an A slot.
    const state = withHandAndBoard({
      hand: [
        makeLetter({ letter: "A" }),
        makeLetter({ letter: "*", isWildcard: true, kind: "consonant", value: 0, color: "none" }),
      ],
      board: [makeConsonant({ letter: "N" })],
    });
    const hints = await findHints(state, { count: 5 });
    expect(hints).toEqual([]);
  });

  it("uses an any-kind wildcard for any letter", async () => {
    _injectDict("es", ["sol"]);
    // Hand has S and action-wildcard (kind:"wildcard"), board has O.
    // Wildcard substitutes the L.
    const state = withHandAndBoard({
      hand: [
        makeConsonant({ letter: "S" }),
        makeLetter({ letter: "*", isWildcard: true, kind: "wildcard", value: 0, color: "none" }),
      ],
      board: [makeLetter({ letter: "O" })],
    });
    const hints = await findHints(state, { count: 5, difficulty: "hard" });
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0].word).toBe("SOL");
    expect(hints[0].usedWildcard).toBe(true);
  });
});

// ─── Forced rules ────────────────────────────────────────────────────────────

describe("findHints - forced rules", () => {
  it("filters out words without tilde when philologist is active", async () => {
    _injectDict("es", ["casa", "papá"]);
    const stateNoForce = withHandAndBoard({
      hand: [makeLetter({ letter: "P" }), makeLetter({ letter: "P" })],
      board: [
        makeLetter({ letter: "A", tildeForm: "Á", tildeValue: 10, tildeKind: "vowel" }),
        makeLetter({ letter: "A" }),
      ],
    });
    const stateWithForce = withHandAndBoard({
      hand: [makeLetter({ letter: "P" }), makeLetter({ letter: "P" })],
      board: [
        makeLetter({ letter: "A", tildeForm: "Á", tildeValue: 10, tildeKind: "vowel" }),
        makeLetter({ letter: "A" }),
      ],
      forced: [{ actionId: "philologist" }],
    });
    const noForce = await findHints(stateNoForce, { count: 5, difficulty: "hard" });
    const withForce = await findHints(stateWithForce, { count: 5, difficulty: "hard" });
    // Without forcing, "CASA" is irrelevant here (no C/S), so we mainly test PAPÁ.
    expect(withForce.every((h) => /[ÁÉÍÓÚÜ]/.test(h.word))).toBe(true);
    // Sanity: at least one philologist-compatible result should exist
    expect(withForce.some((h) => h.word === "PAPÁ")).toBe(true);
    // No-force should also include PAPÁ but might include others too.
    expect(noForce.some((h) => h.word === "PAPÁ")).toBe(true);
  });

  it("requires the forced letter when use_letter is active", async () => {
    _injectDict("es", ["casa", "sopa"]);
    const state = withHandAndBoard({
      hand: [makeConsonant({ letter: "S" }), makeConsonant({ letter: "P" })],
      board: [
        makeLetter({ letter: "O" }),
        makeLetter({ letter: "A" }),
        makeLetter({ letter: "C" }),
      ],
      forced: [{ actionId: "use_letter", payload: { letter: "P" } }],
    });
    const hints = await findHints(state, { count: 5, difficulty: "hard" });
    // SOPA contains P ✓, CASA does not.
    expect(hints.some((h) => h.word === "SOPA")).toBe(true);
    expect(hints.some((h) => h.word === "CASA")).toBe(false);
  });

  it("flips language when in_english is active", async () => {
    _injectDict("es", ["casa"]);
    _injectDict("en", ["house"]);
    const state = withHandAndBoard({
      hand: [
        makeLetter({ letter: "H" }),
        makeLetter({ letter: "O" }),
        makeLetter({ letter: "U" }),
      ],
      board: [
        makeConsonant({ letter: "S" }),
        makeLetter({ letter: "E" }),
      ],
      forced: [{ actionId: "in_english" }],
      language: "es",
    });
    const hints = await findHints(state, { count: 5, difficulty: "hard" });
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0].word).toBe("HOUSE");
  });
});

// ─── Difficulty ordering ─────────────────────────────────────────────────────

describe("findHints - difficulty ordering", () => {
  it("hard difficulty ranks by total score desc", async () => {
    _injectDict("es", ["sa", "casa"]);
    const state = withHandAndBoard({
      hand: [
        makeConsonant({ letter: "C", value: 3 }),
        makeConsonant({ letter: "S", value: 4 }),
      ],
      board: [
        makeLetter({ letter: "A", value: 2 }),
        makeLetter({ letter: "A", value: 2 }),
      ],
    });
    const hints = await findHints(state, { count: 5, difficulty: "hard" });
    expect(hints[0].score).toBeGreaterThanOrEqual(hints[hints.length - 1].score);
    // CASA (3+2+4+2) should outrank SA (4+2) by total score.
    if (hints.length > 1) {
      expect(hints[0].word.length).toBeGreaterThanOrEqual(hints[1].word.length);
    }
  });

  it("returns hints sorted best-first", async () => {
    _injectDict("es", ["sa", "casa", "sas"]);
    const state = withHandAndBoard({
      hand: [
        makeConsonant({ letter: "C" }),
        makeConsonant({ letter: "S" }),
        makeConsonant({ letter: "S" }),
      ],
      board: [
        makeLetter({ letter: "A" }),
        makeLetter({ letter: "A" }),
      ],
    });
    const hints = await findHints(state, { count: 5, difficulty: "hard" });
    for (let i = 1; i < hints.length; i++) {
      expect(hints[i - 1].score).toBeGreaterThanOrEqual(hints[i].score);
    }
  });
});

// ─── Scoring details ─────────────────────────────────────────────────────────

describe("findHints - scoring", () => {
  it("applies same-color x2 multiplier", async () => {
    _injectDict("es", ["sa"]);
    // All-blue word "SA" — extra unused cards so the "used all" x2 doesn't
    // also kick in (we want to isolate the same-color condition).
    const state = withHandAndBoard({
      hand: [
        makeConsonant({ letter: "S", value: 4, color: "blue" }),
        makeConsonant({ letter: "X", value: 8, color: "red" }),
      ],
      board: [
        makeLetter({ letter: "A", value: 2, color: "blue" }),
        makeLetter({ letter: "U", value: 3, color: "red" }),
      ],
    });
    const hints = await findHints(state, { count: 1, difficulty: "hard" });
    expect(hints[0].word).toBe("SA");
    expect(hints[0].score).toBe((4 + 2) * 2); // same-color → x2
  });

  it("applies plusMinus modifier from scoreModifiers", async () => {
    _injectDict("es", ["sa"]);
    const state = withHandAndBoard({
      // Extra unused cards so "all hand + all board" x2 condition doesn't trigger.
      hand: [
        makeConsonant({ letter: "S", value: 4, color: "red" }),
        makeConsonant({ letter: "X", value: 8, color: "yellow" }),
      ],
      board: [
        makeLetter({ letter: "A", value: 2, color: "blue" }),
        makeLetter({ letter: "U", value: 3, color: "green" }),
      ],
      plusMinus: 6, // boost_total
    });
    const hints = await findHints(state, { count: 1, difficulty: "hard" });
    // Different colors → no same-color x2.
    // Not all letters used → no all-cards x2.
    // Total = 4 + 2 + 6 = 12
    expect(hints[0].score).toBe(12);
  });

  it("returns a card composition that can rebuild the word", async () => {
    _injectDict("es", ["sa"]);
    const state = withHandAndBoard({
      hand: [makeConsonant({ letter: "S" })],
      board: [makeLetter({ letter: "A" })],
    });
    const hints = await findHints(state, { count: 1 });
    expect(hints[0].cards).toHaveLength(2);
    expect(hints[0].cards[0].letter).toBe("S");
    expect(hints[0].cards[1].letter).toBe("A");
  });
});

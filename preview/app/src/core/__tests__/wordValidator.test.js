import { describe, it, expect, beforeEach } from "vitest";
import {
  validateWord,
  setAiValidator,
  setFetchImpl,
  _resetCache,
} from "../wordValidator.js";
import { encodeDict } from "../dictCodec.js";

// ─── Test helpers ────────────────────────────────────────────────────────────

// Build a fake fetch that responds to known URLs and falls through to 404.
// `wiktionary[lang]` is an object with:
//   { "<word>": "found" } for exact-title hits, and
//   { _open: { "<query>": ["title1","title2"] } } for opensearch suggestions.
function makeFakeFetch({ dicts = {}, wiktionary = {} } = {}) {
  // Pre-encode dictionaries so the fake fetch can serve them as the real
  // wordValidator expects (binary, gzip+xor).
  const encodedDicts = {};
  return async (url) => {
    // Local dictionary file (binary, encoded)
    for (const lang of Object.keys(dicts)) {
      if (url.endsWith(`/${lang}.bin`)) {
        if (!encodedDicts[lang]) encodedDicts[lang] = await encodeDict(dicts[lang]);
        const bytes = encodedDicts[lang];
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        };
      }
    }
    // Wiktionary — exact title
    const exact = url.match(/https:\/\/(es|en)\.wiktionary\.org\/w\/api\.php\?action=query&titles=([^&]+)/);
    if (exact) {
      const lang = exact[1];
      const title = decodeURIComponent(exact[2]);
      const found = wiktionary[lang]?.[title] === "found";
      if (found) {
        return { ok: true, status: 200, json: async () => ({ query: { pages: { "42": { pageid: 42, title } } } }) };
      }
      return { ok: true, status: 200, json: async () => ({ query: { pages: { "-1": { ns: 0, title, missing: "" } } } }) };
    }
    // Wiktionary — opensearch (used as accent-tolerant fallback)
    const open = url.match(/https:\/\/(es|en)\.wiktionary\.org\/w\/api\.php\?action=opensearch&search=([^&]+)/);
    if (open) {
      const lang = open[1];
      const q = decodeURIComponent(open[2]);
      const suggestions = wiktionary[lang]?._open?.[q] ?? [];
      return { ok: true, status: 200, json: async () => [q, suggestions, [], []] };
    }
    return { ok: false, status: 404, text: async () => "" };
  };
}

beforeEach(() => {
  _resetCache();
  setAiValidator(null);
  setFetchImpl(null);
});

// ─── Local layer ─────────────────────────────────────────────────────────────

describe("validateWord - local layer", () => {
  it("accepts a word present in the local dict", async () => {
    setFetchImpl(makeFakeFetch({ dicts: { es: "casa\nperro\ngato\n" } }));
    const r = await validateWord("casa", { layers: ["local"] });
    expect(r.valid).toBe(true);
    expect(r.source).toBe("local");
  });

  it("rejects (final) when local does not find and no other layer is enabled", async () => {
    setFetchImpl(makeFakeFetch({ dicts: { es: "casa\n" } }));
    const r = await validateWord("xyzqwerty", { layers: ["local"] });
    expect(r.valid).toBe(false);
    expect(r.source).toBe("none");
    expect(r.traces[0].result).toBe("unknown");
  });

  it("is case-insensitive", async () => {
    setFetchImpl(makeFakeFetch({ dicts: { es: "casa\n" } }));
    const r = await validateWord("CASA", { layers: ["local"] });
    expect(r.valid).toBe(true);
  });

  it("accepts an accent-less query against an accented dict entry", async () => {
    setFetchImpl(makeFakeFetch({ dicts: { es: "hálito\ncasa\n" } }));
    const r = await validateWord("halito", { layers: ["local"] });
    expect(r.valid).toBe(true);
    expect(r.source).toBe("local");
  });

  it("accepts uppercase accented query", async () => {
    setFetchImpl(makeFakeFetch({ dicts: { es: "hálito\n" } }));
    const r = await validateWord("HÁLITO", { layers: ["local"] });
    expect(r.valid).toBe(true);
  });

  it("preserves ñ (does not collapse with n)", async () => {
    setFetchImpl(makeFakeFetch({ dicts: { es: "año\n" } }));
    const ok = await validateWord("año", { layers: ["local"] });
    const ko = await validateWord("ano", { layers: ["local"] });
    expect(ok.valid).toBe(true);
    expect(ko.valid).toBe(false);
  });

  it("rejects accented query that does not exist exactly, even if accent-less form exists", async () => {
    // Dictionary has "papa" (only). User types "papá" → not in dict → rejected.
    setFetchImpl(makeFakeFetch({ dicts: { es: "papa\n" } }));
    const r = await validateWord("papá", { layers: ["local"] });
    expect(r.valid).toBe(false);
  });

  it("accepts accent-less query against either accented or non-accented dict entry", async () => {
    setFetchImpl(makeFakeFetch({ dicts: { es: "papa\npapá\n" } }));
    expect((await validateWord("papa", { layers: ["local"] })).valid).toBe(true);
    expect((await validateWord("papá", { layers: ["local"] })).valid).toBe(true);
  });

  it("falls through to next layer when local returns unknown", async () => {
    setFetchImpl(makeFakeFetch({ dicts: { es: "casa\n" } }));
    setAiValidator(async () => ({ valid: true }));
    const r = await validateWord("inventada", { layers: ["local", "ai"] });
    expect(r.valid).toBe(true);
    expect(r.source).toBe("ai");
    expect(r.traces.map((t) => t.layer)).toEqual(["local", "ai"]);
  });
});

// ─── Public layer ────────────────────────────────────────────────────────────

describe("validateWord - public layer (Wiktionary)", () => {
  it("accepts when Wiktionary returns a positive pageid (es)", async () => {
    setFetchImpl(makeFakeFetch({ wiktionary: { es: { estaba: "found" } } }));
    const r = await validateWord("estaba", { layers: ["public"], language: "es" });
    expect(r.valid).toBe(true);
    expect(r.source).toBe("public");
  });

  it("rejects when Wiktionary returns a missing page", async () => {
    setFetchImpl(makeFakeFetch({ wiktionary: { es: {} } }));
    const r = await validateWord("xyzqwerty", { layers: ["public"], language: "es" });
    expect(r.valid).toBe(false);
    expect(r.source).toBe("public");
    expect(r.traces[0].result).toBe("rejected");
  });

  it("accepts inflected English forms (was, be)", async () => {
    setFetchImpl(makeFakeFetch({ wiktionary: { en: { was: "found", be: "found" } } }));
    expect((await validateWord("was", { layers: ["public"], language: "en" })).valid).toBe(true);
    expect((await validateWord("be",  { layers: ["public"], language: "en" })).valid).toBe(true);
  });

  it("uses the es.wiktionary endpoint for Spanish", async () => {
    let capturedUrl = null;
    setFetchImpl(async (url) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => ({ query: { pages: { "1": { pageid: 1 } } } }) };
    });
    await validateWord("casa", { layers: ["public"], language: "es" });
    expect(capturedUrl).toContain("es.wiktionary.org");
    expect(capturedUrl).toContain("origin=*");
  });

  it("uses the en.wiktionary endpoint for English", async () => {
    let capturedUrl = null;
    setFetchImpl(async (url) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => ({ query: { pages: { "1": { pageid: 1 } } } }) };
    });
    await validateWord("house", { layers: ["public"], language: "en" });
    expect(capturedUrl).toContain("en.wiktionary.org");
  });

  it("returns unknown (falls through) on network error", async () => {
    setFetchImpl(async () => { throw new Error("network down"); });
    setAiValidator(async () => ({ valid: true }));
    const r = await validateWord("test", { layers: ["public", "ai"] });
    expect(r.valid).toBe(true);
    expect(r.source).toBe("ai");
    expect(r.traces[0].error).toContain("network");
  });

  it("accent-less query falls back to opensearch and accepts an accented suggestion", async () => {
    // exact "halito" missing, but opensearch returns "hálito"
    setFetchImpl(makeFakeFetch({
      wiktionary: {
        es: {
          _open: { halito: ["halitosis", "hálito", "halitos"] },
        },
      },
    }));
    const r = await validateWord("halito", { layers: ["public"], language: "es" });
    expect(r.valid).toBe(true);
    expect(r.source).toBe("public");
  });

  it("accent-less query rejects when no opensearch suggestion matches", async () => {
    setFetchImpl(makeFakeFetch({
      wiktionary: { es: { _open: { xyz: ["xyzwords", "xyzy"] } } },
    }));
    const r = await validateWord("xyz", { layers: ["public"], language: "es" });
    expect(r.valid).toBe(false);
  });

  it("accented query does NOT fall back to opensearch (exact match required)", async () => {
    // User typed "papá" but only "papa" exists in Wiktionary — must reject.
    setFetchImpl(makeFakeFetch({
      wiktionary: {
        es: {
          papa: "found",
          _open: { "papá": ["papa", "papaya"] },
        },
      },
    }));
    const r = await validateWord("papá", { layers: ["public"], language: "es" });
    expect(r.valid).toBe(false);
  });
});

// ─── AI layer ────────────────────────────────────────────────────────────────

describe("validateWord - ai layer", () => {
  it("accepts when AI returns valid:true", async () => {
    setAiValidator(async () => ({ valid: true }));
    const r = await validateWord("inventadísima", { layers: ["ai"] });
    expect(r.valid).toBe(true);
    expect(r.source).toBe("ai");
  });

  it("rejects when AI returns valid:false", async () => {
    setAiValidator(async () => ({ valid: false }));
    const r = await validateWord("xyzqwerty", { layers: ["ai"] });
    expect(r.valid).toBe(false);
    expect(r.source).toBe("ai");
  });

  it("returns unknown when AI throws", async () => {
    setAiValidator(async () => { throw new Error("worker down"); });
    const r = await validateWord("test", { layers: ["ai"] });
    expect(r.valid).toBe(false);
    expect(r.source).toBe("none");
    expect(r.traces[0].error).toContain("worker");
  });

  it("returns unknown when AI validator is not configured", async () => {
    setAiValidator(null);
    const r = await validateWord("test", { layers: ["ai"] });
    expect(r.valid).toBe(false);
    expect(r.traces[0].error).toBe("no validator");
  });
});

// ─── Layer ordering / short-circuit ──────────────────────────────────────────

describe("validateWord - layer ordering", () => {
  it("short-circuits on first acceptance", async () => {
    let aiCalled = false;
    setFetchImpl(makeFakeFetch({ dicts: { es: "casa\n" } }));
    setAiValidator(async () => { aiCalled = true; return { valid: false }; });
    const r = await validateWord("casa", { layers: ["local", "ai"] });
    expect(r.valid).toBe(true);
    expect(r.source).toBe("local");
    expect(aiCalled).toBe(false);
  });

  it("short-circuits on first rejection", async () => {
    let aiCalled = false;
    setFetchImpl(makeFakeFetch({
      publicResponses: { "rae-api.com": { ok: false, status: 404, text: async () => "" } },
    }));
    setAiValidator(async () => { aiCalled = true; return { valid: true }; });
    const r = await validateWord("xyzqwerty", { layers: ["public", "ai"] });
    expect(r.valid).toBe(false);
    expect(r.source).toBe("public");
    expect(aiCalled).toBe(false);
  });

  it("handles empty input", async () => {
    const r = await validateWord("", { layers: ["local"] });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("empty");
  });

  it("skips unknown layer names without crashing", async () => {
    setFetchImpl(makeFakeFetch({ dicts: { es: "casa\n" } }));
    const r = await validateWord("casa", { layers: ["bogus", "local"] });
    expect(r.valid).toBe(true);
    expect(r.traces[0].result).toBe("skipped");
    expect(r.traces[1].layer).toBe("local");
  });

  it("returns elapsedMs >= 0", async () => {
    setFetchImpl(makeFakeFetch({ dicts: { es: "casa\n" } }));
    const r = await validateWord("casa", { layers: ["local"] });
    expect(typeof r.elapsedMs).toBe("number");
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

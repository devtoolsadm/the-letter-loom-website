import { describe, it, expect, beforeEach } from "vitest";
import {
  validateWord,
  setAiValidator,
  setFetchImpl,
  _resetCache,
} from "../wordValidator.js";

// ─── Test helpers ────────────────────────────────────────────────────────────

// Build a fake fetch that responds to known URLs and falls through to 404.
function makeFakeFetch({ dicts = {}, publicResponses = {} } = {}) {
  return async (url) => {
    // Local dictionary file
    for (const [lang, content] of Object.entries(dicts)) {
      if (url.endsWith(`/${lang}.txt`)) {
        return { ok: true, status: 200, text: async () => content };
      }
    }
    // Public API
    for (const [pattern, resp] of Object.entries(publicResponses)) {
      if (url.includes(pattern)) {
        if (typeof resp === "function") return resp();
        return resp;
      }
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

describe("validateWord - public layer", () => {
  it("accepts on HTTP 200 (rae-api.com for es)", async () => {
    setFetchImpl(makeFakeFetch({
      publicResponses: {
        "rae-api.com": { ok: true, status: 200, text: async () => "{}" },
      },
    }));
    const r = await validateWord("casa", { layers: ["public"], language: "es" });
    expect(r.valid).toBe(true);
    expect(r.source).toBe("public");
  });

  it("rejects on HTTP 404", async () => {
    setFetchImpl(makeFakeFetch({
      publicResponses: {
        "rae-api.com": { ok: false, status: 404, text: async () => "" },
      },
    }));
    const r = await validateWord("xyzqwerty", { layers: ["public"], language: "es" });
    expect(r.valid).toBe(false);
    expect(r.source).toBe("public");
    expect(r.traces[0].result).toBe("rejected");
  });

  it("uses dictionaryapi.dev endpoint for English", async () => {
    let capturedUrl = null;
    setFetchImpl(async (url) => {
      capturedUrl = url;
      return { ok: true, status: 200, text: async () => "[]" };
    });
    await validateWord("house", { layers: ["public"], language: "en" });
    expect(capturedUrl).toContain("dictionaryapi.dev");
    expect(capturedUrl).toContain("house");
  });

  it("returns unknown (falls through) on network error", async () => {
    setFetchImpl(async () => { throw new Error("network down"); });
    setAiValidator(async () => ({ valid: true }));
    const r = await validateWord("test", { layers: ["public", "ai"] });
    expect(r.valid).toBe(true);
    expect(r.source).toBe("ai");
    expect(r.traces[0].error).toContain("network");
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

import { describe, it, expect } from "vitest";
import {
  buildRankMathMetaPayload,
  detectRankMath,
  RANK_MATH_META_KEYS,
  RANK_MATH_LIMITATIONS,
  type RankMathProbe,
} from "@/server/rankmath.service";
import { isSafeOutboundUrl, assertSafeOutboundUrl } from "@/lib/ssrf";

describe("Rank Math compatibility", () => {
  it("maps our SEO fields to Rank Math meta keys", () => {
    const payload = buildRankMathMetaPayload({
      seoTitle: "My Title",
      metaDescription: "Desc",
      focusKeyword: "rafting",
      canonical: "https://x.com/c",
    });
    expect(payload[RANK_MATH_META_KEYS.seoTitle]).toBe("My Title");
    expect(payload[RANK_MATH_META_KEYS.focusKeyword]).toBe("rafting");
    expect(payload[RANK_MATH_META_KEYS.canonical]).toBe("https://x.com/c");
    // No key fabricates a score.
    expect(Object.keys(payload)).not.toContain("score");
  });

  it("detects Rank Math when post meta contains rank_math_* keys", async () => {
    const probe: RankMathProbe = {
      async get() {
        return { status: 200, body: [{ id: 1, meta: { rank_math_title: "X", rank_math_description: "Y" } }] };
      },
    };
    const r = await detectRankMath(probe);
    expect(r.installed).toBe(true);
  });

  it("reports unknown (not false) when no rank_math meta is visible", async () => {
    const probe: RankMathProbe = {
      async get() {
        return { status: 200, body: [{ id: 1, meta: { _edit_lock: "x" } }] };
      },
    };
    const r = await detectRankMath(probe);
    expect(r.installed).toBe("unknown");
    expect(r.note).toContain("unknown");
  });

  it("reports unknown when the WordPress API is unreachable", async () => {
    const probe: RankMathProbe = {
      async get() {
        throw new Error("ECONNREFUSED");
      },
    };
    const r = await detectRankMath(probe);
    expect(r.installed).toBe("unknown");
  });

  it("never fabricates a Rank Math score or full-integration claim", () => {
    expect(RANK_MATH_LIMITATIONS.some((l) => /internal analyzer/i.test(l))).toBe(true);
    expect(RANK_MATH_LIMITATIONS.some((l) => /fabricated/i.test(l))).toBe(true);
  });
});

describe("SSRF guard", () => {
  it("blocks localhost, private ranges, and cloud metadata", () => {
    expect(isSafeOutboundUrl("http://localhost:3000/x")).toBe(false);
    expect(isSafeOutboundUrl("http://127.0.0.1/x")).toBe(false);
    expect(isSafeOutboundUrl("http://10.0.0.5/x")).toBe(false);
    expect(isSafeOutboundUrl("http://192.168.1.1/x")).toBe(false);
    expect(isSafeOutboundUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafeOutboundUrl("http://metadata.google.internal/x")).toBe(false);
    expect(isSafeOutboundUrl("ftp://example.com/x")).toBe(false);
  });

  it("allows public https destinations", () => {
    expect(isSafeOutboundUrl("https://whiterafting.com/wp-json/")).toBe(true);
    expect(isSafeOutboundUrl("https://api.openverse.org/v1/images")).toBe(true);
    expect(() => assertSafeOutboundUrl("https://example.com/x")).not.toThrow();
  });
});

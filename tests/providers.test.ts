import { describe, it, expect, beforeEach } from "vitest";
import {
  getGscProvider,
  listGscProviders,
  register as registerGsc,
} from "@/providers/gsc-providers";
import {
  getKeywordProvider,
  listKeywordProviders,
  register as registerKeyword,
} from "@/providers/keyword-providers";
import type { GscProvider, GscRequest, GscResponse, KeywordSourceProvider, KeywordSourceRequest, KeywordSourceResponse } from "@/providers/types";

// Provider registries must be honest: the default providers explain that no
// automated source is configured instead of fabricating data, and the CSV
// keyword provider validates/normalizes rows without inventing metrics.

describe("Google Search Console provider registry", () => {
  it("defaults to the unavailable provider with an honest explanation", () => {
    const p = getGscProvider(undefined);
    expect(p.id).toBe("unavailable");
    expect(p.capabilities).toContain("OAuth2");
    expect(listGscProviders().some((x) => x.id === "unavailable")).toBe(true);
  });

  it("unavailable provider returns ok:false and never fabricates records", async () => {
    const res = await getGscProvider("").fetch({ startDate: "2026-01-01" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("No reliable automated Google Search Console provider");
    }
  });

  it("returns a registered provider when selected", async () => {
    class Fake implements GscProvider {
      readonly id = "fake-gsc";
      readonly name = "Fake GSC";
      readonly capabilities = "test-only";
      async fetch(req: GscRequest): Promise<GscResponse> {
        return {
          ok: true,
          provider: "fake-gsc",
          records: [
            { query: "rafting", clicks: 10, impressions: 100, ctr: 0.1, position: 5.5, date: req.startDate },
          ],
        };
      }
    }
    registerGsc(new Fake());
    const p = getGscProvider("fake-gsc");
    expect(p.id).toBe("fake-gsc");
    const res = await p.fetch({ startDate: "2026-01-01" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.records).toHaveLength(1);
  });
});

describe("keyword source provider registry", () => {
  it("defaults to the unavailable provider", async () => {
    const p = getKeywordProvider("missing-id");
    expect(p.id).toBe("unavailable");
    const res = await p.fetchRows({});
    expect(res.ok).toBe(false);
  });

  it("CSV provider validates rows, normalizes queries and reports issues", async () => {
    const p = getKeywordProvider("csv");
    const csv = [
      "Keyword,Search Volume,CPC,Difficulty",
      "  whitewater   rafting  ,12000,2.50,30",
      ",50,1.00,10", // missing keyword
      "kayak trips,nope,0.90,,", // unparseable volume stays null
    ].join("\n");
    const res = (await p.fetchRows({ content: csv })) as Extract<KeywordSourceResponse, { ok: true }>;
    expect(res.ok).toBe(true);
    expect(res.totalRows).toBe(3);
    // invalid row reported, not fabricated
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].message).toBe("Missing keyword");
    expect(res.rows).toHaveLength(2);
    // normalized keyword: trimmed + inner whitespace collapsed, case preserved
    expect(res.rows[0].keyword).toBe("whitewater rafting");
    expect(res.rows[0].searchVolume).toBe(12000);
    expect(res.rows[0].cpc).toBe(2.5);
    // unparseable metric stays null (never zero-invented)
    expect(res.rows[1].searchVolume).toBeNull();
    expect(res.rows[1].difficulty).toBeNull();
  });

  it("CSV provider requires a keyword column", async () => {
    const p = getKeywordProvider("csv");
    const res = await p.fetchRows({ content: "foo,bar\n1,2\n" });
    expect(res.ok).toBe(false);
  });

  it("CSV provider honors an explicit mapping", async () => {
    const p = getKeywordProvider("csv");
    const res = (await p.fetchRows({
      content: "Term,Vol\nkayak trips,300\n",
      mapping: { keyword: 0, searchVolume: 1 },
    })) as Extract<KeywordSourceResponse, { ok: true }>;
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].keyword).toBe("kayak trips");
    expect(res.rows[0].searchVolume).toBe(300);
  });

  it("supports replacing providers via the registry", () => {
    class Fake implements KeywordSourceProvider {
      readonly id = "fake-kw";
      readonly name = "Fake KW";
      readonly capabilities = "test-only";
      async fetchRows(_req: KeywordSourceRequest): Promise<KeywordSourceResponse> {
        return { ok: true, rows: [], issues: [], totalRows: 0, provider: "fake-kw" };
      }
    }
    registerKeyword(new Fake());
    expect(listKeywordProviders().some((x) => x.id === "fake-kw")).toBe(true);
    expect(getKeywordProvider("fake-kw").id).toBe("fake-kw");
  });
});
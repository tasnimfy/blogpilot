import { describe, it, expect } from "vitest";
import {
  normalizeTopicText,
  tokenize,
  jaccardTokens,
  similarityOfTopics,
  detectIntent,
  clusterCandidates,
  detectCoverage,
  decideAction,
  scoreOpportunityCandidate,
  titleCaseTopic,
  type DiscoveryCandidate,
  type ExistingPage,
  type ScoreContext,
  type IntentInfo,
} from "@/server/opportunity-discovery";

function makeCtx(overrides: Partial<ScoreContext> = {}): ScoreContext {
  return {
    keyword: "kayak tours",
    searchVolume: null,
    difficulty: null,
    cpcCents: null,
    gscImpressions: null,
    gscClicks: null,
    gscPosition: null,
    gscDate: null,
    trendsValue: null,
    trendsChangePct: null,
    trendsObservedOn: null,
    sourceCount: 1,
    intent: { intent: "INFORMATIONAL", contentType: "BLOG_POST", commercial: false, seasonal: false, reasons: [] },
    coverage: { covered: false, partial: false, ratio: 0, page: null },
    siteNiche: null,
    siteDescription: null,
    siteCountry: null,
    ...overrides,
  };
}

function cand(key: string, source: DiscoveryCandidate["source"], extra: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return { key, keyword: key, source, ...extra };
}

describe("normalization & tokenization", () => {
  it("normalizes case, punctuation and whitespace deterministically", () => {
    expect(normalizeTopicText("  Best White-Water Rafting, Trips!  ")).toBe("best white water rafting trips");
    expect(normalizeTopicText("KAYAK TOURS")).toBe("kayak tours");
  });

  it("tokenizes deterministically: stopwords dropped, plurals stripped, short tokens ignored", () => {
    expect(tokenize("How to kayak tours")).toEqual(["kayak", "tour"]);
    expect(tokenize("best top guide")).toEqual([]); // all stopwords/short
    expect(tokenize("kayak")).toEqual(["kayak"]);
  });

  it("computes Jaccard similarity between token sets", () => {
    expect(jaccardTokens(["kayak"], ["kayak"])).toBe(1);
    expect(jaccardTokens(["kayak", "tour"], ["canoe"])).toBe(0);
    expect(jaccardTokens(["kayak", "tour"], ["kayak", "rental"])).toBeCloseTo(1 / 3);
    expect(jaccardTokens([], [])).toBe(1);
  });

  it("similarityOfTopics treats identical and plural variants as equal", () => {
    expect(similarityOfTopics("kayak tours", "kayak tours")).toBe(1);
    expect(similarityOfTopics("kayak tour", "kayak tours")).toBe(1);
    expect(similarityOfTopics("kayak tours", "canoe rental")).toBe(0);
  });
});

describe("intent detection", () => {
  const expectIntent = (kw: string, intent: string, contentType: string, commercial: boolean) => {
    const info: IntentInfo = detectIntent(kw);
    expect(info.intent).toBe(intent);
    expect(info.contentType).toBe(contentType);
    expect(info.commercial).toBe(commercial);
    return info;
  };

  it("maps transactional modifiers to product pages", () => {
    expectIntent("buy kayak paddle", "TRANSACTIONAL", "PRODUCT_PAGE", true);
  });

  it("maps commercial-investigation modifiers to lists and comparisons", () => {
    expectIntent("best kayak", "COMMERCIAL_INVESTIGATION", "COMMERCIAL_LIST", true);
    expectIntent("kayak vs canoe", "COMMERCIAL_INVESTIGATION", "COMPARISON", true);
    expectIntent("best kayak review", "COMMERCIAL_INVESTIGATION", "REVIEW", true);
  });

  it("maps informational modifiers to guides, tutorials, FAQs and listicles", () => {
    expectIntent("how to kayak", "INFORMATIONAL", "TUTORIAL", false);
    expectIntent("what is kayaking", "INFORMATIONAL", "GUIDE", false);
    expectIntent("kayak faq", "INFORMATIONAL", "FAQ", false);
    expectIntent("kayak trip ideas", "INFORMATIONAL", "LISTICLE", false);
  });

  it("flags news/year topics as seasonal", () => {
    const info = expectIntent("kayak trends 2025", "INFORMATIONAL", "NEWS", false);
    expect(info.seasonal).toBe(true);
  });

  it("defaults to informational blog content with an honest reason", () => {
    const info = expectIntent("kayak tours", "INFORMATIONAL", "BLOG_POST", false);
    expect(info.reasons[0]).toContain("defaulted");
  });
});

describe("clustering (deterministic)", () => {
  it("orders clusters by demand descending, ties broken alphabetically", () => {
    const clusters = clusterCandidates([
      cand("beta idea", "KEYWORD", { searchVolume: 100 }),
      cand("alpha idea", "KEYWORD", { searchVolume: 100 }),
      cand("huge demand", "KEYWORD", { searchVolume: 9000 }),
    ]);
    expect(clusters.map((c) => c.topic)).toEqual(["huge demand", "alpha idea", "beta idea"]);
  });

  it("merges closely related queries into one topic", () => {
    const clusters = clusterCandidates([
      cand("kayak tours", "KEYWORD", { searchVolume: 1000 }),
      cand("best kayak tours", "GSC", { gscImpressions: 800 }),
      cand("kayak tour", "KEYWORD", { searchVolume: 500 }),
      cand("white water rafting", "KEYWORD", { searchVolume: 9000 }),
    ]);
    expect(clusters).toHaveLength(2);
    const kayak = clusters.find((c) => c.topic === "kayak tours");
    expect(kayak).toBeTruthy();
    expect(kayak?.members).toHaveLength(3);
    expect(kayak?.members).toContain("best kayak tours");
    // primarySource = most common source (KEYWORD 2 vs GSC 1)
    expect(kayak?.primarySource).toBe("KEYWORD");
    const rafting = clusters.find((c) => c.topic === "white water rafting");
    expect(rafting?.members).toEqual(["white water rafting"]);
  });

  it("keeps unrelated topics in separate clusters", () => {
    const clusters = clusterCandidates([
      cand("kayak tours", "KEYWORD", { searchVolume: 500 }),
      cand("canoe rental", "KEYWORD", { searchVolume: 400 }),
    ]);
    expect(clusters).toHaveLength(2);
  });

  it("produces identical clusters for identical input (determinism)", () => {
    const input = [
      cand("kayak tours", "KEYWORD", { searchVolume: 1000 }),
      cand("white water rafting", "TRENDS", { trendsValue: 80 }),
    ];
    const a = clusterCandidates(input);
    const b = clusterCandidates([...input].reverse());
    expect(a.map((c) => c.topic)).toEqual(b.map((c) => c.topic));
  });
});

describe("coverage & action", () => {
  const pages: ExistingPage[] = [
    { id: "draft:1", type: "draft", title: "Complete Guide to White Water Rafting" },
    { id: "receipt:2", type: "receipt", title: "kayak basics" },
  ];

  it("detects adequate coverage above the threshold", () => {
    const cov = detectCoverage("white water rafting", pages);
    expect(cov.covered).toBe(true);
    expect(cov.ratio).toBeGreaterThanOrEqual(0.6);
    expect(cov.page?.type).toBe("draft");
    expect(decideAction(cov)).toBe("UPDATE_EXISTING");
  });

  it("detects partial coverage between 0.3 and 0.6", () => {
    const cov = detectCoverage("kayak tours", pages);
    expect(cov.covered).toBe(false);
    expect(cov.partial).toBe(true);
    expect(decideAction(cov)).toBe("NEW_ARTICLE");
  });

  it("reports no coverage for unrelated pages", () => {
    const cov = detectCoverage("canoe rental", pages);
    expect(cov.covered).toBe(false);
    expect(cov.partial).toBe(false);
    expect(cov.page).toBeNull();
    expect(decideAction(cov)).toBe("NEW_ARTICLE");
  });
});

describe("scoring (deterministic)", () => {
  it("scores a fully-evidenced commercial opportunity deterministically", () => {
    const ctx = makeCtx({
      keyword: "kayak tours",
      searchVolume: 5000,
      difficulty: 15,
      cpcCents: 250,
      gscImpressions: 10000,
      sourceCount: 3,
      intent: { intent: "COMMERCIAL_INVESTIGATION", contentType: "COMMERCIAL_LIST", commercial: true, seasonal: false, reasons: [] },
      siteNiche: "kayak rafting tours",
    });
    const s = scoreOpportunityCandidate(ctx);
    // demand: volume 5000 -> 4, GSC 10000 -> 5 (higher wins)
    expect(s.demandScore).toBe(5);
    // competition: difficulty 15 -> 4
    expect(s.competitionScore).toBe(4);
    // value: commercial -> 5 (CPC push already at cap)
    expect(s.valueScore).toBe(5);
    // originality: 1+3=4 sources, no coverage -> +1 = clamp 5
    expect(s.originalScore).toBe(5);
    // relevance: shared tokens kayak/tour -> >=0.4 overlap -> 5
    expect(s.relevanceScore).toBe(5);
    expect(s.total).toBe(24);
    expect(s.confidence).toBe("HIGH");
    expect(s.missingData).toEqual([]);
    expect(s.sources).toEqual(expect.arrayContaining(["KEYWORD", "GSC"]));
  });

  it("names missing evidence instead of fabricating it", () => {
    const s = scoreOpportunityCandidate(makeCtx());
    expect(s.missingData).toContain("No search demand signal: keyword volume, GSC impressions and trend interest all absent");
    expect(s.missingData).toContain("No competition signal: keyword difficulty and GSC position unavailable");
    expect(s.missingData).toContain("Only one data source contributed evidence — originality estimate is provisional");
    expect(s.missingData).toContain("No site niche/description profile to measure topic relevance");
    expect(s.confidence).toBe("LOW");
    expect(s.total).toBe(11); // demand 1 + competition 2 + value 3 + original 3 + relevance 2
    // The stored justifications explain the gap, they never invent a number.
    expect(s.demandJustification).toContain("no sources");
    expect(s.competitionJustification).toContain("no difficulty/position data");
  });

  it("maps keyword difficulty bands to competition scores", () => {
    const score = (d: number | null) => scoreOpportunityCandidate(makeCtx({ difficulty: d })).competitionScore;
    expect(score(10)).toBe(5);
    expect(score(25)).toBe(4);
    expect(score(40)).toBe(3);
    expect(score(60)).toBe(2);
    expect(score(80)).toBe(1);
    expect(score(95)).toBe(0);
    expect(score(null)).toBe(2);
  });

  it("uses GSC position as a fallback competition signal", () => {
    expect(scoreOpportunityCandidate(makeCtx({ gscPosition: 22 })).competitionScore).toBe(4);
    expect(scoreOpportunityCandidate(makeCtx({ gscPosition: 12 })).competitionScore).toBe(3);
  });

  it("derives demand from volume, GSC impressions and trends deterministically", () => {
    expect(scoreOpportunityCandidate(makeCtx({ searchVolume: 100 })).demandScore).toBe(3); // log10(100)+1
    expect(scoreOpportunityCandidate(makeCtx({ searchVolume: 0 })).demandScore).toBe(0);
    expect(scoreOpportunityCandidate(makeCtx({ gscImpressions: 100000 })).demandScore).toBe(5);
    expect(scoreOpportunityCandidate(makeCtx({ trendsValue: 80 })).demandScore).toBe(4); // 1 + floor(80/25)
  });

  it("caps the value of seasonal/news content", () => {
    const seasonal = makeCtx({
      intent: { intent: "INFORMATIONAL", contentType: "NEWS", commercial: false, seasonal: true, reasons: [] },
    });
    expect(scoreOpportunityCandidate(seasonal).valueScore).toBeLessThanOrEqual(2);
  });

  it("sets confidence MEDIUM when few signals are missing", () => {
    const ctx = makeCtx({ searchVolume: 100, difficulty: 30, sourceCount: 2 });
    const s = scoreOpportunityCandidate(ctx);
    expect(s.missingData).toHaveLength(1); // only the niche profile
    expect(s.confidence).toBe("MEDIUM");
  });

  it("records data freshness from dated signals", () => {
    const s = scoreOpportunityCandidate(
      makeCtx({ gscDate: "2026-10-01", trendsObservedOn: new Date("2026-10-05T00:00:00Z") })
    );
    expect(s.dataFreshness).toContain("GSC data through 2026-10-01");
    expect(s.dataFreshness).toContain("Trends observed 2026-10-05");
  });
});

describe("title generation", () => {
  it("title-cases topics while preserving short connectives", () => {
    expect(titleCaseTopic("best white water rafting trips")).toBe("Best White Water Rafting Trips");
    // "to" is capitalized (headline style); listed connectives are preserved lower-case.
    expect(titleCaseTopic("how to kayak")).toBe("How To Kayak");
    expect(titleCaseTopic("kayaking for beginners")).toBe("Kayaking for Beginners");
  });

  it("truncates overlong titles deterministically", () => {
    const long = "a very long topic ".repeat(12).trim();
    const t = titleCaseTopic(long);
    expect(t.length).toBeLessThanOrEqual(120);
    expect(t.endsWith("…")).toBe(true);
  });
});
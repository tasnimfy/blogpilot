// ---------------------------------------------------------------------------
// Automated content opportunity discovery — deterministic analysis engine.
//
// All functions in this module are pure and rule-based so that scoring,
// clustering, duplicate/coverage detection and intent mapping are fully
// deterministic and unit-testable. Missing signals are recorded in
// missingData/justifications — never fabricated. No DB access here.
// ---------------------------------------------------------------------------

export type DiscoverySource = "KEYWORD" | "GSC" | "TRENDS";

export interface DiscoveryCandidate {
  key: string; // normalized topic text
  keyword: string; // display text
  source: DiscoverySource;
  searchVolume?: number | null;
  difficulty?: number | null;
  cpcCents?: number | null;
  searchIntent?: string | null;
  gscClicks?: number;
  gscImpressions?: number;
  gscPosition?: number | null;
  gscDate?: string | null;
  trendsValue?: number | null;
  trendsChangePct?: number | null;
  trendsObservedOn?: Date | null;
  demand?: number; // precomputed rough demand for deterministic ordering
}

export interface TopicCluster {
  topic: string; // display text of the highest-demand member
  members: string[]; // original queries forming this topic
  candidates: DiscoveryCandidate[];
  primarySource: DiscoverySource;
}

export interface IntentInfo {
  intent: string; // INFORMATIONAL | COMMERCIAL | TRANSACTIONAL | NAVIGATIONAL
  contentType: string; // BLOG_POST | LISTICLE | GUIDE | REVIEW | COMPARISON | NEWS | FAQ | TUTORIAL | PRODUCT_PAGE
  commercial: boolean;
  seasonal: boolean;
  reasons: string[];
}

export interface CoverageInfo {
  covered: boolean; // adequately covered by an existing page (ratio >= 0.6)
  partial: boolean; // some overlap (0.3 <= ratio < 0.6)
  ratio: number; // best token-overlap ratio
  page: { type: "draft" | "receipt"; id: string; title: string } | null;
}

export interface ScoreContext {
  keyword: string;
  searchVolume: number | null;
  difficulty: number | null;
  cpcCents: number | null;
  gscImpressions: number | null;
  gscClicks: number | null;
  gscPosition: number | null;
  gscDate: string | null;
  trendsValue: number | null;
  trendsChangePct: number | null;
  trendsObservedOn: Date | null;
  sourceCount: number; // distinct data sources contributing evidence
  intent: IntentInfo;
  coverage: CoverageInfo;
  siteNiche: string | null;
  siteDescription: string | null;
  siteCountry: string | null; // primaryCountry
}

export interface OpportunityScoreInput {
  demandScore: number;
  demandJustification: string;
  competitionScore: number;
  competitionJustification: string;
  valueScore: number;
  valueJustification: string;
  originalScore: number;
  originalJustification: string;
  relevanceScore: number;
  relevanceJustification: string;
  total: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  evidence: string[];
  sources: string[];
  missingData: string[];
  dataFreshness: string;
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "for", "with", "without", "of", "on", "in",
  "at", "to", "from", "by", "is", "are", "was", "were", "be", "been", "what", "how",
  "why", "when", "where", "which", "who", "as", "it", "its", "your", "you", "my",
  "our", "their", "them", "this", "that", "these", "those", "do", "does", "did",
  "can", "will", "should", "best", "top", "new", "guide", "tips", "vs", "over",
]);

// Normalize a topic/query: lowercase, collapse whitespace, strip punctuation.
export function normalizeTopicText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Tokenize for matching: normalize, drop stopwords and a light plural 's'.
export function tokenize(s: string): string[] {
  return normalizeTopicText(s)
    .split(" ")
    .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function jaccardTokens(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1 : inter / union;
}

export function similarityOfTopics(a: string, b: string): number {
  return jaccardTokens(tokenize(a), tokenize(b));
}

// --- Search intent + likely content type -----------------------------------

const INTENT_RULES: { pattern: RegExp; intent: string; contentType: string; commercial: boolean; seasonal?: boolean }[] = [
  { pattern: /\bbuy\b|\bbest price|\bcheap\b|\bcost\b|\bprice\b|\bdeal\b|\bdiscount\b|\bshop\b/, intent: "TRANSACTIONAL", contentType: "PRODUCT_PAGE", commercial: true },
  { pattern: /\bbest\b|\btop\b|\brating\b|\breview\b|\bvs\b|\bcompare\b|\bcomparison\b|\balternative\b/, intent: "COMMERCIAL_INVESTIGATION", contentType: "COMMERCIAL_LIST", commercial: true },
  { pattern: /\bhow to\b|\bhow do i\b|\bstep by step\b|\btutorial\b|\bguide\b|\bwalkthrough\b/, intent: "INFORMATIONAL", contentType: "TUTORIAL", commercial: false },
  { pattern: /\bwhat is\b|\bwhat are\b|\bdefinition\b|\bmeaning\b|\bexplain\b/, intent: "INFORMATIONAL", contentType: "GUIDE", commercial: false },
  { pattern: /\bfaq\b|\bquestions?\b|\banswers?\b/, intent: "INFORMATIONAL", contentType: "FAQ", commercial: false },
  { pattern: /\b(19|20)\d{2}\b|\bupdate\b|\bnews\b|\bnew\b/, intent: "INFORMATIONAL", contentType: "NEWS", commercial: false, seasonal: true },
  { pattern: /\bexample\b|\bideas\b|\blist\b|\bthings\b|\btypes\b|\bkinds\b/, intent: "INFORMATIONAL", contentType: "LISTICLE", commercial: false },
];

const REVIEW_PATTERN = /\breview\b/;
const COMPARE_PATTERN = /\bvs\b|\bcompare\b|\bcomparison\b|\balternative\b/;

export function detectIntent(keyword: string): IntentInfo {
  const lower = keyword.toLowerCase();
  const reasons: string[] = [];
  for (const rule of INTENT_RULES) {
    if (rule.pattern.test(lower)) {
      reasons.push(`Intent signal "${rule.pattern.source}" matched`);
      return {
        intent: rule.intent,
        contentType: REVIEW_PATTERN.test(lower) ? "REVIEW" : COMPARE_PATTERN.test(lower) && rule.contentType === "COMMERCIAL_LIST" ? "COMPARISON" : rule.contentType,
        commercial: rule.commercial,
        seasonal: rule.seasonal === true || /(19|20)\d{2}/.test(lower),
        reasons,
      };
    }
  }
  reasons.push("No explicit intent modifier; defaulted to informational blog content");
  return { intent: "INFORMATIONAL", contentType: "BLOG_POST", commercial: false, seasonal: /(19|20)\d{2}/.test(lower), reasons };
}

// --- Clustering ------------------------------------------------------------

function roughDemand(c: DiscoveryCandidate): number {
  const values = [
    c.searchVolume != null && c.searchVolume > 0 ? c.searchVolume : 0,
    c.gscImpressions && c.gscImpressions > 0 ? c.gscImpressions : 0,
    c.trendsValue && c.trendsValue > 0 ? c.trendsValue : 0,
  ];
  return Math.max(...values);
}

// Greedy, deterministic clustering: candidates are processed in demand order
// (ties broken alphabetically) and join the most similar existing cluster when
// Jaccard similarity of tokens >= threshold; otherwise they start a new one.
export function clusterCandidates(candidates: DiscoveryCandidate[], threshold = 0.55): TopicCluster[] {
  const ordered = [...candidates]
    .map((c) => ({ ...c, demand: c.demand ?? roughDemand(c) }))
    .sort((a, b) => b.demand - a.demand || a.keyword.localeCompare(b.keyword));

  const clusters: TopicCluster[] = [];
  for (const cand of ordered) {
    const tokens = tokenize(cand.key);
    let best: { index: number; sim: number } | null = null;
    for (let i = 0; i < clusters.length; i++) {
      const sim = jaccardTokens(tokens, tokenize(clusters[i].topic));
      if (sim >= threshold && (best === null || sim > best.sim)) best = { index: i, sim };
    }
    if (best === null) {
      clusters.push({ topic: cand.keyword, members: [cand.keyword], candidates: [cand], primarySource: cand.source });
    } else {
      const cl = clusters[best.index];
      cl.members.push(cand.keyword);
      cl.candidates.push(cand);
      const counts: Record<string, number> = {};
      for (const m of cl.candidates) counts[m.source] = (counts[m.source] ?? 0) + 1;
      cl.primarySource = (["KEYWORD", "GSC", "TRENDS"] as DiscoverySource[]).sort(
        (a, b) => (counts[b] ?? 0) - (counts[a] ?? 0)
      )[0] ?? cand.source;
    }
  }
  return clusters;
}

// --- Coverage / duplicate detection ----------------------------------------

export interface ExistingPage {
  id: string; // `draft:<id>` or `receipt:<id>`
  type: "draft" | "receipt";
  title: string;
}

// Compare a topic against existing site pages (draft titles, receipt
// permalinks extracted as slug tokens).
export function detectCoverage(topic: string, pages: ExistingPage[]): CoverageInfo {
  const tTokens = tokenize(topic);
  if (tTokens.length === 0) return { covered: false, partial: false, ratio: 0, page: null };
  let bestRatio = 0;
  let best: CoverageInfo["page"] = null;
  for (const p of pages) {
    const pTokens = tokenize(p.title.replace(/[-_/]/g, " "));
    if (pTokens.length === 0) continue;
    const ratio = jaccardTokens(tTokens, pTokens);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = { type: p.type, id: p.id, title: p.title };
    }
  }
  return {
    covered: bestRatio >= 0.6,
    partial: bestRatio >= 0.3 && bestRatio < 0.6,
    ratio: bestRatio,
    page: best,
  };
}

export function decideAction(coverage: CoverageInfo): "NEW_ARTICLE" | "UPDATE_EXISTING" {
  return coverage.covered ? "UPDATE_EXISTING" : "NEW_ARTICLE";
}

// --- Scoring (deterministic; missing evidence is named, never invented) ----

function clamp(v: number, min = 0, max = 5): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

export function scoreOpportunityCandidate(ctx: ScoreContext): OpportunityScoreInput {
  const evidence: string[] = [];
  const sources = new Set<string>();
  const missingData: string[] = [];

  // 1) Demand — evidence of actual search demand.
  let demand = 1;
  const vol = ctx.searchVolume;
  if (vol !== null && vol !== undefined) {
    sources.add("KEYWORD");
    if (vol <= 0) {
      demand = 0;
      evidence.push(`Search volume is zero for "${ctx.keyword}"`);
    } else {
      demand = clamp(1 + Math.floor(Math.log10(vol)), 1, 5);
      evidence.push(`Search volume ${vol}`);
    }
  }
  if (ctx.gscImpressions !== null && ctx.gscImpressions !== undefined && ctx.gscImpressions > 0) {
    sources.add("GSC");
    const gscDemand = clamp(1 + Math.floor(Math.log10(ctx.gscImpressions)), 1, 5);
    if (gscDemand > demand) {
      demand = gscDemand;
      evidence.push(`GSC impressions ${ctx.gscImpressions} (${ctx.gscClicks ?? 0} clicks)`);
    }
  }
  if (ctx.trendsValue !== null && ctx.trendsValue !== undefined && ctx.trendsValue > 0) {
    sources.add("TRENDS");
    const trendDemand = clamp(1 + Math.floor(ctx.trendsValue / 25), 1, 5);
    if (trendDemand > demand) {
      demand = trendDemand;
      evidence.push(`Trend interest ${ctx.trendsValue}`);
    }
    if (ctx.trendsChangePct !== null && ctx.trendsChangePct !== undefined && ctx.trendsChangePct >= 30) {
      demand = clamp(demand + 1);
      evidence.push(`Rising trend +${Math.round(ctx.trendsChangePct)}%`);
    }
  }
  if (sources.size === 0) {
    missingData.push("No search demand signal: keyword volume, GSC impressions and trend interest all absent");
  }
  const demandJustification =
    demand === 0 ? "Stored volume is zero — treat as no demand" : `Demand ${demand}/5 from ${[...sources].join(", ") || "no sources"}.`;

  // 2) Competition — higher = more realistic for a NEWER site.
  let competition = 2;
  let compSrc = "";
  if (ctx.difficulty !== null && ctx.difficulty !== undefined) {
    sources.add("KEYWORD");
    competition =
      ctx.difficulty <= 10 ? 5 : ctx.difficulty <= 25 ? 4 : ctx.difficulty <= 40 ? 3 : ctx.difficulty <= 60 ? 2 : ctx.difficulty <= 80 ? 1 : 0;
    compSrc = `Keyword difficulty ${ctx.difficulty}`;
    evidence.push(compSrc);
  } else if (ctx.gscPosition !== null && ctx.gscPosition !== undefined) {
    sources.add("GSC");
    competition = ctx.gscPosition >= 20 ? 4 : ctx.gscPosition >= 10 ? 3 : ctx.gscPosition >= 5 ? 2 : 1;
    compSrc = `GSC position ${ctx.gscPosition}`;
    evidence.push(compSrc);
  } else {
    missingData.push("No competition signal: keyword difficulty and GSC position unavailable");
  }
  const competitionJustification = `Competition ${competition}/5 (${compSrc || "no difficulty/position data"}) — higher is more realistic for a newer site.`;

  // 3) Value — commercial or practical value.
  let value = 3;
  const vReasons: string[] = [];
  if (ctx.intent.commercial) {
    value = 5;
    vReasons.push(`Commercial intent (${ctx.intent.intent})`);
  } else if (ctx.intent.contentType === "GUIDE" || ctx.intent.contentType === "TUTORIAL" || ctx.intent.contentType === "FAQ") {
    value = 4;
    vReasons.push(`Practical evergreen format (${ctx.intent.contentType})`);
  }
  if (ctx.intent.seasonal || ctx.intent.contentType === "NEWS") {
    value = Math.min(value, 2);
    vReasons.push("Seasonal/news content has shorter practical value");
  }
  if (ctx.cpcCents !== null && ctx.cpcCents !== undefined && ctx.cpcCents >= 150) {
    value = clamp(value + 1);
    sources.add("KEYWORD");
    vReasons.push(`CPC $${(ctx.cpcCents / 100).toFixed(2)} signals commercial value`);
    evidence.push(`CPC ${ctx.cpcCents} cents`);
  }
  value = clamp(value);
  evidence.push(...vReasons);
  const valueJustification = `Value ${value}/5 — ${vReasons.join("; ") || "generic informational content"}.`;

  // 4) Originality — capacity for original, useful content.
  let original = clamp(1 + ctx.sourceCount, 1, 4); // 1 source=2, 2=3, 3+=4
  if (ctx.coverage.ratio < 0.3) original = clamp(original + 1); // little existing content
  if (ctx.coverage.covered) original = clamp(original - 1);
  if (ctx.sourceCount < 2) missingData.push("Only one data source contributed evidence — originality estimate is provisional");
  const originalJustification = `Originality ${original}/5 — ${ctx.sourceCount} source(s), ${Math.round(ctx.coverage.ratio * 100)}% overlap with existing pages.`;

  // 5) Relevance — fit with the selected website.
  let relevance = 2;
  const nicheText = [ctx.siteNiche, ctx.siteDescription].filter(Boolean).join(" ");
  if (nicheText.trim().length > 0) {
    const overlap = jaccardTokens(tokenize(nicheText), tokenize(ctx.keyword));
    relevance = overlap >= 0.4 ? 5 : overlap >= 0.25 ? 4 : overlap >= 0.12 ? 3 : 2;
    evidence.push(`Topic–site profile overlap ${Math.round(overlap * 100)}%`);
  } else {
    missingData.push("No site niche/description profile to measure topic relevance");
  }
  const relevanceJustification =
    relevance >= 3
      ? `Relevance ${relevance}/5 — matches site profile${ctx.siteCountry ? ` (${ctx.siteCountry})` : ""}.`
      : `Relevance ${relevance}/5 — weak overlap with the site profile.`;

  const total = demand + competition + value + original + relevance;
  const confidence: "LOW" | "MEDIUM" | "HIGH" =
    missingData.length === 0 ? "HIGH" : missingData.length <= 2 ? "MEDIUM" : "LOW";

  // Data freshness summary from dated signals.
  const freshnessParts: string[] = [];
  if (ctx.gscDate) freshnessParts.push(`GSC data through ${ctx.gscDate}`);
  if (ctx.trendsObservedOn) freshnessParts.push(`Trends observed ${ctx.trendsObservedOn.toISOString().slice(0, 10)}`);

  return {
    demandScore: demand,
    demandJustification,
    competitionScore: competition,
    competitionJustification,
    valueScore: value,
    valueJustification,
    originalScore: original,
    originalJustification,
    relevanceScore: relevance,
    relevanceJustification,
    total,
    confidence,
    evidence,
    sources: [...sources],
    missingData,
    dataFreshness: freshnessParts.join("; ") || "No dated source data available",
  };
}

// Build a human title from a cluster topic (title case, stopwords preserved).
export function titleCaseTopic(topic: string): string {
  const keep = new Set(["and", "or", "the", "a", "an", "for", "of", "with", "vs"]);
  const words = topic.split(" ");
  const out = words.map((w, i) => {
    if (i > 0 && keep.has(w)) return w;
    return w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w;
  });
  const joined = out.join(" ");
  return joined.length > 120 ? `${joined.slice(0, 117).trimEnd()}…` : joined;
}
import { fromJsonString } from "@/lib/json";
import type { ResearchBrief } from "@/server/research.service";

export interface PromptSite {
  id: string;
  name: string;
  domain: string;
  niche: string | null;
  targetAudience: string | null;
  primaryCountry: string | null;
  primaryLanguage: string;
}

export interface PromptGuidelines {
  brandVoice: string | null;
  writingStyle: string | null;
  spellingVariant: string | null;
  formalityLevel: string | null;
  targetReader: string | null;
  readingComplexity: string | null;
  contentDepth: string | null;
  articleStructure: string | null;
  introStyle: string | null;
  avoidPhrases: string | null;
  verifyClaims: string | null;
  internalLinking: string | null;
  externalLinking: string | null;
  brandInstructions: string | null;
  editorialChecklist: string | null;
  customInstructions: string | null;
}

export interface DraftMeta {
  title: string;
  keyword: string | null;
  searchIntent: string | null;
  articleType: string | null;
  targetLength: number | null;
  language: string | null;
  outline: string | null; // JSON outline or null
  notes: string | null;
}

function list(v: string | null): string[] {
  return fromJsonString<string[]>(v, []);
}

function buildSystemGuidelines(site: PromptSite, g: PromptGuidelines): string {
  const lines: string[] = [];
  lines.push(`You are a professional content writer for the website "${site.name}" (${site.domain}).`);
  if (site.niche) lines.push(`Site niche: ${site.niche}.`);
  if (site.targetAudience) lines.push(`Target audience: ${site.targetAudience}.`);
  if (site.primaryCountry) lines.push(`Primary market: ${site.primaryCountry}.`);
  lines.push(`Write in ${site.primaryLanguage || "English"}.`);
  const out: string[] = [];
  out.push(lines.join("\n"));
  if (g.brandVoice) out.push(`Brand voice: ${g.brandVoice}`);
  if (g.writingStyle) out.push(`Writing style: ${g.writingStyle}`);
  if (g.formalityLevel) out.push(`Formality level: ${g.formalityLevel}`);
  if (g.targetReader) out.push(`Target reader: ${g.targetReader}`);
  if (g.readingComplexity) out.push(`Reading complexity: ${g.readingComplexity}`);
  if (g.contentDepth) out.push(`Content depth: ${g.contentDepth}`);
  if (g.articleStructure) out.push(`Preferred article structure: ${g.articleStructure}`);
  if (g.introStyle) out.push(`Preferred introduction style: ${g.introStyle}`);
  if (g.spellingVariant) out.push(`Use spelling variant: ${g.spellingVariant}`);
  const avoid = list(g.avoidPhrases);
  if (avoid.length > 0) out.push(`Avoid these phrases/expressions: ${avoid.join("; ")}.`);
  const verify = list(g.verifyClaims);
  if (verify.length > 0) out.push(`Verify before asserting: ${verify.join("; ")}. Do not invent unsupported claims.`);
  if (g.internalLinking) out.push(`Internal linking: ${g.internalLinking}`);
  if (g.externalLinking) out.push(`External linking: ${g.externalLinking}`);
  if (g.brandInstructions) out.push(`Brand instructions: ${g.brandInstructions}`);
  const checklist = list(g.editorialChecklist);
  if (checklist.length > 0) out.push(`Editorial checklist to satisfy: ${checklist.join("; ")}.`);
  if (g.customInstructions) out.push(`Additional instructions: ${g.customInstructions}`);
  return out.join("\n");
}

function researchSection(brief: ResearchBrief | null, site: PromptSite): string {
  if (!brief || brief.findings.length === 0) {
    return (
      "Research evidence: none available. Do NOT invent community feedback, quotes, " +
      "statistics, or first-hand experiences. Keep claims general and clearly limited " +
      "to what is knowable, or mark uncertainty."
    );
  }
  const lines = [
    `Research evidence (${brief.independentSourceCount} independent source(s), generated ${brief.generatedAt}):`,
  ];
  for (const f of brief.findings) {
    lines.push(`- [${f.category}] ${f.claim}${f.evidence ? ` (${f.evidence})` : ""}${f.source ? ` — ${f.source}` : ""}`);
  }
  if (brief.disagreements.length > 0) lines.push(`Disagreements to represent fairly: ${brief.disagreements.join("; ")}`);
  if (brief.missingEvidence.length > 0) lines.push(`Unverified claims (present with uncertainty, not as fact): ${brief.missingEvidence.join("; ")}`);
  lines.push(
    "Use this research as the basis for any community feedback or factual claims. " +
    "Never invent findings that are not listed here."
  );
  return lines.join("\n");
}

export function buildOutlinePrompt(
  site: PromptSite,
  g: PromptGuidelines,
  meta: DraftMeta,
  brief: ResearchBrief | null
): { system: string; user: string } {
  const system = buildSystemGuidelines(site, g);
  const user = [
    `Create a detailed article outline for the topic: "${meta.title}".`,
    meta.keyword ? `Primary keyword: ${meta.keyword}` : null,
    meta.searchIntent ? `Search intent: ${meta.searchIntent}` : null,
    meta.articleType ? `Article type: ${meta.articleType}` : null,
    meta.targetLength ? `Target length: ~${meta.targetLength} words` : null,
    researchSection(brief, site),
    "The outline must include an H1 (the working title), logical H2 and H3 sections that answer " +
      "actual reader questions, and, where relevant, an FAQ. Return the outline as JSON with " +
      'a "sections" array: [{"heading": "...", "level": 2, "points": ["..."]}]. Do not invent research findings.',
  ]
    .filter((x): x is string => Boolean(x))
    .join("\n");
  return { system, user };
}

export function buildArticlePrompt(
  site: PromptSite,
  g: PromptGuidelines,
  meta: DraftMeta,
  brief: ResearchBrief | null
): { system: string; user: string } {
  const system = buildSystemGuidelines(site, g);
  const outline = parseOutline(meta.outline);
  const user = [
    `Write the full article for the topic: "${meta.title}".`,
    meta.keyword ? `Primary keyword to use naturally: ${meta.keyword}` : null,
    meta.searchIntent ? `Search intent: ${meta.searchIntent}` : null,
    meta.articleType ? `Article type: ${meta.articleType}` : null,
    meta.targetLength ? `Target length: ~${meta.targetLength} words (depth over filler; length is a guide, not a quality metric)` : null,
    researchSection(brief, site),
  ]
    .filter((x): x is string => Boolean(x))
    .join("\n");

  const outlineBlock = outline
    ? `Follow this approved outline (you may refine sub-points):\n${outline.map((s) => `${"#".repeat(s.level)} ${s.heading}\n${s.points.map((p) => `- ${p}`).join("\n")}`).join("\n\n")}`
    : "Structure the article with clear headings that reflect reader questions.";

  const userFull = `${user}\n\n${outlineBlock}\n\n` +
    "Requirements:\n" +
    "- Answer the reader's primary question early.\n" +
    "- Use clear, natural language; avoid repetitive AI-style intros/conclusions.\n" +
    "- Do not keyword-stuff or pad with generic filler.\n" +
    "- Distinguish personal opinions from verified facts; do not invent first-hand experiences or statistics.\n" +
    "- Where research is missing, keep the article appropriately limited and mark uncertainty.\n" +
    "- Return the full article as plain markdown (## for H2, ### for H3). Do not include a separate outline JSON.";
  return { system, user };
}

function parseOutline(outline: string | null): { heading: string; level: number; points: string[] }[] {
  if (!outline) return [];
  try {
    const data = JSON.parse(outline);
    if (data?.sections && Array.isArray(data.sections)) {
      return data.sections.map((s: { heading?: string; level?: number; points?: string[] }) => ({
        heading: s.heading ?? "",
        level: s.level ?? 2,
        points: Array.isArray(s.points) ? s.points.map((p: unknown) => String(p)) : [],
      }));
    }
  } catch {
    /* not JSON */
  }
  return [];
}

export { parseOutline };

// SEO metadata generation for the scheduled AI pipeline. Related keywords are
// passed in as VERIFIED search-data clusters; the model must not invent more.
// Dynamic date tags ([year], [month], [date]) are produced for dated/seasonal
// topics and expanded at save time — a specific year or month is never
// hardcoded.
export function buildMetaPrompt(
  site: PromptSite,
  g: PromptGuidelines,
  meta: DraftMeta,
  relatedQueries: string[]
): { system: string; user: string } {
  const system = buildSystemGuidelines(site, g);
  const user = [
    `Write SEO metadata for the article titled "${meta.title}".`,
    meta.keyword ? `Primary keyword: ${meta.keyword}` : null,
    meta.articleType ? `Article type: ${meta.articleType}` : null,
    relatedQueries.length > 0
      ? `Related queries already identified from search data (use these; do not invent additional related keywords): ${relatedQueries.join("; ")}`
      : null,
    "Return ONLY a JSON object with two string fields:",
    '{"metaTitle": "...", "metaDescription": "..."}',
    "Rules:",
    "- metaTitle: 30-60 characters, includes the primary keyword naturally, no brand stuffing.",
    "- metaDescription: 120-160 characters, a compelling summary, includes the primary keyword once.",
    "- No URLs, HTML, or markdown inside either field.",
    "- Do not invent statistics, prices, dates, or facts not present in the article.",
    "- For dated or seasonal topics use [year], [month], or [date] tags instead of a hardcoded year or month; the platform expands them at save time.",
  ]
    .filter((x): x is string => Boolean(x))
    .join("\n");
  return { system, user };
}

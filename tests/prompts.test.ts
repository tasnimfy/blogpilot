import { describe, it, expect } from "vitest";
import { buildOutlinePrompt, buildArticlePrompt, parseOutline } from "@/server/prompts";

const site = {
  id: "a",
  name: "White Rafting",
  domain: "whiterafting.com",
  niche: "whitewater rafting",
  targetAudience: "adventure travellers",
  primaryCountry: "USA",
  primaryLanguage: "en",
};

const guidelines = {
  brandVoice: "Adventurous and safety-conscious",
  writingStyle: "Conversational",
  spellingVariant: "en-US",
  formalityLevel: "Casual",
  targetReader: "First-time rafters",
  readingComplexity: "Simple",
  contentDepth: "Beginner guide",
  articleStructure: "H2 sections answering reader questions",
  introStyle: "Hook with a vivid scene",
  avoidPhrases: '["elevate","game-changer"]',
  verifyClaims: '["river difficulty ratings"]',
  internalLinking: "Link to related trip guides",
  externalLinking: "Cite official park pages",
  brandInstructions: "Never invent statistics",
  editorialChecklist: '["Include safety section","Cite at least one source"]',
  customInstructions: "Mention local guides where relevant",
};

describe("site-specific prompts", () => {
  it("includes the site's brand voice and guidelines in the outline prompt", () => {
    const p = buildOutlinePrompt(site, guidelines as never, { title: "Best rafting rivers", keyword: "rafting", searchIntent: null, articleType: null, targetLength: 1200, language: "en", outline: null, notes: null }, null);
    expect(p.system).toContain("White Rafting");
    expect(p.system).toContain("Adventurous and safety-conscious");
    expect(p.system).toContain("elevate");
    expect(p.system).toContain("river difficulty ratings");
    expect(p.user).toContain("Best rafting rivers");
  });

  it("does not include another site's guidelines (isolation)", () => {
    const otherSite = { ...site, name: "Web Hosting Blog", domain: "webhosting.com" };
    const otherGuidelines = { ...guidelines, brandVoice: "Technical and precise" };
    const a = buildOutlinePrompt(site, guidelines as never, { title: "T", keyword: null, searchIntent: null, articleType: null, targetLength: null, language: "en", outline: null, notes: null }, null);
    const b = buildOutlinePrompt(otherSite, otherGuidelines as never, { title: "T", keyword: null, searchIntent: null, articleType: null, targetLength: null, language: "en", outline: null, notes: null }, null);
    expect(a.system).toContain("White Rafting");
    expect(a.system).toContain("Adventurous and safety-conscious");
    expect(a.system).not.toContain("Web Hosting Blog");
    expect(b.system).toContain("Technical and precise");
    expect(b.system).not.toContain("White Rafting");
  });

  it("tells the model not to invent research when evidence is missing", () => {
    const p = buildArticlePrompt(site, guidelines as never, { title: "T", keyword: "k", searchIntent: null, articleType: null, targetLength: null, language: "en", outline: null, notes: null }, null);
    expect(p.user).toContain("Do NOT invent");
    expect(p.user.toLowerCase()).toContain("none available");
  });

  it("injects research findings into the article prompt", () => {
    const brief = {
      topic: "rafting",
      providerLimitation: null,
      questionCount: 2,
      independentSourceCount: 1,
      findings: [
        { category: "FIRST_HAND", claim: "Guides mention wet suits", evidence: "Reddit thread", source: "https://reddit.com/r/x" },
      ],
      themes: [],
      disagreements: [],
      missingEvidence: [],
      generatedAt: new Date().toISOString(),
    };
    const p = buildArticlePrompt(site, guidelines as never, { title: "T", keyword: "k", searchIntent: null, articleType: null, targetLength: null, language: "en", outline: null, notes: null }, brief);
    expect(p.user).toContain("Guides mention wet suits");
    expect(p.user).toContain("Never invent findings");
  });

  it("parses a JSON outline", () => {
    const parsed = parseOutline('{"sections":[{"heading":"Intro","level":2,"points":["a"]},{"heading":"Safety","level":2,"points":["b","c"]}]}');
    expect(parsed).toHaveLength(2);
    expect(parsed[1].heading).toBe("Safety");
    expect(parsed[0].points).toEqual(["a"]);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { analyzeDraft, SeoServiceError } from "@/server/seo.service";
import { createDraft, updateDraft } from "@/server/article.service";
import { resetDb, createTestAdmin, createTestSite } from "./helpers";

const GOOD_BODY = [
  "# Best Rafting Rivers in Idaho",
  "",
  "Planning a rafting trip? This guide covers the best rivers for every skill level.",
  "",
  "## Choosing a River",
  "Consider the difficulty rating and season.",
  "",
  "## Safety Gear",
  "Always wear a helmet and [read our gear guide](/gear).",
  "",
  "## Local Guides",
  "Check [the official park site](https://parks.example.gov/rivers) for permits.",
  "",
  "## FAQ",
  "When is the best season? Late spring.",
].join("\n");

describe("internal SEO analyzer", () => {
  let admin: { id: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
  });

  it("passes a well-structured article with a high score", async () => {
    const draft = await createDraft(siteId, { title: "Best Rafting Rivers", keyword: "rafting" }, admin.id);
    await updateDraft(siteId, draft.id, { body: GOOD_BODY, slug: "best-rafting-rivers" }, admin.id);
    const r = await analyzeDraft(siteId, draft.id, { metaDescription: "A practical guide to the best rafting rivers and safety gear." });
    expect(r.overall).toBeGreaterThanOrEqual(70);
    expect(r.mandatoryFailed).toBe(false);
    const h1 = r.checks.find((c) => c.id === "single_h1");
    expect(h1?.status).toBe("pass");
    // score is an internal indicator, not a ranking guarantee
    expect(r.overall).toBeLessThanOrEqual(100);
  });

  it("fails mandatory checks when there is no H1 or body", async () => {
    const draft = await createDraft(siteId, { title: "Untitled article", keyword: "rafting" }, admin.id);
    await updateDraft(siteId, draft.id, { body: "no headings here" }, admin.id);
    const r = await analyzeDraft(siteId, draft.id, {});
    expect(r.mandatoryFailed).toBe(true);
    expect(r.checks.find((c) => c.id === "single_h1")?.status).toBe("fail");
    expect(r.critical.length).toBeGreaterThan(0);
  });

  it("warns about duplicate titles within the site", async () => {
    await createDraft(siteId, { title: "Rafting Safety Tips" }, admin.id);
    const draft = await createDraft(siteId, { title: "Rafting Safety Tips", keyword: "rafting" }, admin.id);
    await updateDraft(siteId, draft.id, { body: GOOD_BODY }, admin.id);
    const r = await analyzeDraft(siteId, draft.id, {});
    expect(r.checks.find((c) => c.id === "duplicate_title")?.status).toBe("warn");
  });

  it("detects keyword usage and marks missing keyword", async () => {
    const draft = await createDraft(siteId, { title: "River Guide", keyword: "whitewater" }, admin.id);
    await updateDraft(siteId, draft.id, { body: GOOD_BODY }, admin.id); // body has no "whitewater"
    const r = await analyzeDraft(siteId, draft.id, {});
    expect(r.checks.find((c) => c.id === "keyword_usage")?.status).toBe("warn");
  });

  it("distinguishes local from live checks", async () => {
    const draft = await createDraft(siteId, { title: "T", keyword: "rafting" }, admin.id);
    await updateDraft(siteId, draft.id, { body: GOOD_BODY }, admin.id);
    const r = await analyzeDraft(siteId, draft.id, {});
    expect(r.liveChecksRequired).toBe(true);
    expect(r.checks.find((c) => c.id === "broken_links")?.live).toBe(true);
  });

  it("persists the analysis and explains every deduction", async () => {
    const draft = await createDraft(siteId, { title: "Short title", keyword: "rafting" }, admin.id);
    await updateDraft(siteId, draft.id, { body: "A very short body." }, admin.id);
    await analyzeDraft(siteId, draft.id, {});
    const saved = await prisma.sEOAnalysis.findUnique({ where: { draftId: draft.id } });
    expect(saved?.overallScore).toBeTypeOf("number");
    expect(saved?.warnings).toContain("length");
  });

  it("is scoped to the site (isolation)", async () => {
    const other = (await createTestSite("Other", "other.com")).id;
    const draft = await createDraft(siteId, { title: "X", keyword: "k" }, admin.id);
    await expect(analyzeDraft(other, draft.id, {})).rejects.toThrow(SeoServiceError);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  runResearch,
  addResearchSource,
  addResearchFinding,
  getResearchJob,
  buildResearchBrief,
  serializeBrief,
  ResearchServiceError,
} from "@/server/research.service";
import { resetDb, createTestAdmin, createTestSite } from "./helpers";

describe("research workflow & provenance", () => {
  let admin: { id: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
  });

  it("runs research, records questions and the honest provider limitation", async () => {
    const job = (await runResearch(siteId, { topic: "whitewater rafting safety" }, admin.id))!;
    expect(job.status).toBe("COMPLETED");
    expect(job.questions).toContain("safety");
    expect(job.error).toContain("No automated research search provider");
    expect(job.sources).toHaveLength(0);
  });

  it("fails on a missing site", async () => {
    await expect(runResearch("missing", { topic: "x" }, admin.id)).rejects.toThrow(ResearchServiceError);
  });

  it("adds manual sources with findings (provenance) and builds a brief", async () => {
    const job = (await runResearch(siteId, { topic: "best rafting rivers" }, admin.id))!;
    const source = await addResearchSource(
      siteId,
      job.id,
      {
        url: "https://reddit.com/r/rafting/thread",
        title: "Rafting thread",
        sourceType: "REDDIT",
        excerpt: "A short excerpt.",
        findings: [
          { category: "FIRST_HAND", claim: "User describes Class III rapids experience" },
          { category: "THEME", claim: "Several users mention needing a wetsuit" },
          { category: "UNVERIFIED", claim: "One user claims a river is 'the wildest in the state'" },
        ],
      },
      admin.id
    );
    expect(source.findings).toHaveLength(3);

    const brief = await buildResearchBrief(job.id);
    expect(brief.independentSourceCount).toBe(1);
    expect(brief.findings).toHaveLength(3);
    expect(brief.themes).toContain("Several users mention needing a wetsuit");
    expect(brief.missingEvidence).toContain("One user claims a river is 'the wildest in the state'");
    expect(brief.findings[0].source).toBe("https://reddit.com/r/rafting/thread");

    const loaded = await getResearchJob(job.id);
    expect(serializeBrief(loaded?.brief ?? null)).not.toBeNull();
  });

  it("aggregates disagreements and never fabricates", async () => {
    const job = (await runResearch(siteId, { topic: "rafting permits" }, admin.id))!;
    await addResearchFinding(siteId, job.id, { category: "DISAGREEMENT", claim: "Permit needed vs not needed" }, admin.id);
    const brief = await buildResearchBrief(job.id);
    expect(brief.disagreements).toContain("Permit needed vs not needed");
    // No automated sources were fetched, so counts are honest.
    expect(brief.independentSourceCount).toBe(0);
  });

  it("links a finding to its source", async () => {
    const job = (await runResearch(siteId, { topic: "kayak tours" }, admin.id))!;
    const src = await addResearchSource(siteId, job.id, { url: "https://example.com/a", title: "A" }, admin.id);
    const f = await addResearchFinding(siteId, job.id, { sourceId: src.id, category: "EXPERT", claim: "Official guidance" }, admin.id);
    expect(f.sourceId).toBe(src.id);
  });

  it("deletes a source and rebuilds the brief", async () => {
    const job = (await runResearch(siteId, { topic: "gear" }, admin.id))!;
    const src = await addResearchSource(siteId, job.id, { url: "https://example.com/g", title: "G" }, admin.id);
    await addResearchSource(siteId, job.id, { url: "https://example.com/h", title: "H" }, admin.id);
    // delete via prisma to keep this test focused
    await prisma.researchSource.delete({ where: { id: src.id } });
    const brief = await buildResearchBrief(job.id);
    expect(brief.independentSourceCount).toBe(1);
  });
});

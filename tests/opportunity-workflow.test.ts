import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createOpportunity, scoreOpportunity, listOpportunities } from "@/server/opportunity.service";
import {
  approveOpportunity,
  rejectOpportunity,
  transitionOpportunityStatus,
  canTransition,
  availableTransitions,
  OPPORTUNITY_TRANSITIONS,
  OpportunityWorkflowError,
  WORKFLOW_DISPLAY,
} from "@/server/opportunity-workflow.service";
import { toJsonString, fromJsonString } from "@/lib/json";
import { resetDb, createTestAdmin, createTestSite } from "./helpers";

describe("content opportunity approval workflow", () => {
  let admin: { id: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
  });

  const fullScore = {
    demandScore: 4,
    demandJustification: "Search volume 5000 observed",
    competitionScore: 4,
    competitionJustification: "Difficulty 15 - realistic for a newer site",
    valueScore: 5,
    valueJustification: "Strong commercial intent",
    originalScore: 4,
    originalJustification: "Supports original research",
    relevanceScore: 4,
    relevanceJustification: "Matches the site niche",
    confidence: "HIGH",
    evidence: ["Search volume 5000", "GSC impressions 1000"],
    sources: ["KEYWORD", "GSC"],
  };

  // Simulate a discovery-engine opportunity (clustered queries, intent,
  // content type, evidence, freshness, missing data).
  async function createDiscoveryOpportunity() {
    const opp = await prisma.contentOpportunity.create({
      data: {
        websiteId: siteId,
        title: "Best Kayak Tours",
        keyword: "kayak tours",
        source: "KEYWORD",
        status: "NEW",
        reviewStatus: "NEW",
        searchIntent: "COMMERCIAL_INVESTIGATION",
        contentType: "COMMERCIAL_LIST",
        action: "NEW_ARTICLE",
        keywords: toJsonString(["best kayak tours", "kayak tours", "kayak tour"]),
        notes: "Discovered from 2 sources. Missing: No site niche profile.",
        score: {
          create: {
            demandScore: fullScore.demandScore,
            demandJustification: fullScore.demandJustification,
            competitionScore: fullScore.competitionScore,
            competitionJustification: fullScore.competitionJustification,
            valueScore: fullScore.valueScore,
            valueJustification: fullScore.valueJustification,
            originalScore: fullScore.originalScore,
            originalJustification: fullScore.originalJustification,
            relevanceScore: fullScore.relevanceScore,
            relevanceJustification: fullScore.relevanceJustification,
            total: fullScore.demandScore + fullScore.competitionScore + fullScore.valueScore + fullScore.originalScore + fullScore.relevanceScore,
            confidence: fullScore.confidence,
            evidence: toJsonString(fullScore.evidence),
            sources: toJsonString(fullScore.sources),
            missingData: toJsonString(["No site niche/description profile to measure topic relevance"]),
            dataFreshness: "GSC data through 2026-10-10",
          },
        },
      },
    });
    return opp;
  }

  it("declares the workflow states and valid transitions explicitly", () => {
    expect(WORKFLOW_DISPLAY).toMatchObject({
      NEW: "New",
      APPROVED: "Approved",
      QUEUED_FOR_ARTICLE_STUDIO: "Queued for Article Studio",
      GENERATING: "Generating",
      DRAFT_READY: "Draft ready",
      FAILED: "Failed",
    });
    expect(canTransition("NEW", "REVIEWED")).toBe(true);
    expect(canTransition("NEW", "APPROVED")).toBe(true);
    expect(canTransition("NEW", "REJECTED")).toBe(true);
    expect(canTransition("NEW", "DRAFT_READY")).toBe(false); // no skipping
    expect(canTransition("NEW", "GENERATING")).toBe(false);
    expect(canTransition("REJECTED", "APPROVED")).toBe(false);
    expect(canTransition("GENERATING", "DRAFT_READY")).toBe(true);
    expect(canTransition("GENERATING", "FAILED")).toBe(true);
    expect(canTransition("FAILED", "QUEUED_FOR_ARTICLE_STUDIO")).toBe(true); // retry allowed
    expect(canTransition("APPROVED", "QUEUED_FOR_ARTICLE_STUDIO")).toBe(true);
    expect(availableTransitions("NEW").sort()).toEqual(["APPROVED", "REJECTED", "REVIEWED"]);
  });

  it("moves through the full chain with explicit transitions only", async () => {
    const opp = await createOpportunity(siteId, { title: "Chain topic", source: "MANUAL" }, admin.id);

    // Invalid jump rejected.
    await expect(transitionOpportunityStatus(siteId, opp.id, "GENERATING", admin.id)).rejects.toThrow(OpportunityWorkflowError);

    // NEW -> REVIEWED -> APPROVED (records who + when) -> QUEUED -> GENERATING -> DRAFT_READY
    await transitionOpportunityStatus(siteId, opp.id, "REVIEWED", admin.id);
    const approved = await transitionOpportunityStatus(siteId, opp.id, "APPROVED", admin.id);
    expect(approved.reviewStatus).toBe("APPROVED");
    expect(approved.approvedById).toBe(admin.id);
    expect(approved.approvedAt).not.toBeNull();

    await transitionOpportunityStatus(siteId, opp.id, "QUEUED_FOR_ARTICLE_STUDIO", admin.id);
    await transitionOpportunityStatus(siteId, opp.id, "GENERATING", admin.id);
    const ready = await transitionOpportunityStatus(siteId, opp.id, "DRAFT_READY", admin.id);
    expect(ready.reviewStatus).toBe("DRAFT_READY");

    // DRAFT_READY is terminal; GENERATING -> FAILED and FAILED retry still work on another instance.
    await expect(transitionOpportunityStatus(siteId, opp.id, "FAILED", admin.id)).rejects.toThrow(OpportunityWorkflowError);
    expect(OPPORTUNITY_TRANSITIONS.DRAFT_READY).toEqual([]);
  });

  it("approves: creates the Article Studio item preserving keyword, evidence, scores and intent", async () => {
    const opp = await createDiscoveryOpportunity();
    const res = await approveOpportunity(siteId, opp.id, admin.id);

    expect(res.ok).toBe(true);
    expect(res.draftCreated).toBe(true);

    // Approver + timestamp recorded.
    const loaded = await prisma.contentOpportunity.findUnique({ where: { id: opp.id } });
    expect(loaded?.reviewStatus).toBe("APPROVED");
    expect(loaded?.approvedById).toBe(admin.id);
    expect(loaded?.approvedAt).not.toBeNull();

    // Article Studio item preserves the opportunity data.
    const draft = res.draft;
    expect(draft.title).toBe("Best Kayak Tours");
    expect(draft.keyword).toBe("kayak tours");
    expect(draft.articleType).toBe("COMMERCIAL_LIST");
    expect(draft.opportunityId).toBe(opp.id);
    expect(draft.notes).toContain("Intent: COMMERCIAL_INVESTIGATION");
    expect(draft.notes).toContain("Related queries: best kayak tours");
    expect(draft.notes).toContain("Opportunity score: 21/25");
    expect(draft.notes).toContain("Evidence: Search volume 5000");

    // Eligible for the daily generation queue — exactly one QUEUED job.
    const jobs = await prisma.backgroundJob.findMany({ where: { websiteId: siteId, type: "ARTICLE_GENERATE" } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("QUEUED");
    expect(fromJsonString<{ draftId: string }>(jobs[0].payload, { draftId: "" }).draftId).toBe(draft.id);
    expect(jobs[0].scheduledFor).not.toBeNull();

    // Audit trail.
    const audit = await prisma.auditLog.findFirst({ where: { websiteId: siteId, action: "OPPORTUNITY_APPROVED" } });
    expect(audit?.entityId).toBe(opp.id);
  });

  it("is idempotent: a second approval never duplicates the draft or the queue job", async () => {
    const opp = await createDiscoveryOpportunity();
    const first = await approveOpportunity(siteId, opp.id, admin.id);
    const second = await approveOpportunity(siteId, opp.id, admin.id);

    expect(second.draftCreated).toBe(false);
    expect(second.draft.id).toBe(first.draft.id);
    expect(second.jobEnqueued).toBe(false);
    expect(await prisma.articleDraft.count({ where: { websiteId: siteId } })).toBe(1);
    expect(await prisma.backgroundJob.count({ where: { websiteId: siteId, type: "ARTICLE_GENERATE" } })).toBe(1);
  });

  it("links the existing page for an UPDATE_EXISTING opportunity instead of creating a duplicate", async () => {
    const page = await prisma.articleDraft.create({
      data: { websiteId: siteId, title: "Kayaking Basics", status: "PUBLISHED", slug: "kayaking-basics" },
    });
    const opp = await prisma.contentOpportunity.create({
      data: {
        websiteId: siteId,
        title: "Kayaking Basics Update",
        keyword: "kayaking basics",
        source: "KEYWORD",
        status: "NEW",
        reviewStatus: "NEW",
        action: "UPDATE_EXISTING",
        searchIntent: "INFORMATIONAL",
        contentType: "GUIDE",
        existingDraftId: page.id,
        score: {
          create: {
            demandScore: 3, demandJustification: "Volume 800", competitionScore: 3, competitionJustification: "Difficulty 25",
            valueScore: 3, valueJustification: "Practical evergreen", originalScore: 3, originalJustification: "Fresh angle",
            relevanceScore: 3, relevanceJustification: "On niche", total: 15, confidence: "MEDIUM",
            evidence: toJsonString(["Search volume 800"]), sources: toJsonString(["KEYWORD"]),
            missingData: toJsonString([]), dataFreshness: "No dated source data available",
          },
        },
      },
    });

    const res = await approveOpportunity(siteId, opp.id, admin.id);
    expect(res.draftCreated).toBe(false);
    expect(res.draft.id).toBe(page.id);
    expect((await prisma.articleDraft.findUnique({ where: { id: page.id } }))?.opportunityId).toBe(opp.id);
    expect(await prisma.articleDraft.count({ where: { websiteId: siteId } })).toBe(1);
  });

  it("rejects an opportunity with an optional recorded reason", async () => {
    const opp = await createOpportunity(siteId, { title: "Reject me", source: "MANUAL" }, admin.id);
    const rejected = await rejectOpportunity(siteId, opp.id, admin.id, "Already covered by an existing pillar post");
    expect(rejected.reviewStatus).toBe("REJECTED");
    expect(rejected.rejectedById).toBe(admin.id);
    expect(rejected.rejectedAt).not.toBeNull();
    expect(rejected.rejectionReason).toBe("Already covered by an existing pillar post");

    // Rejecting again is not a valid transition.
    await expect(rejectOpportunity(siteId, opp.id, admin.id)).rejects.toThrow(OpportunityWorkflowError);
    // Approving a rejected opportunity is not allowed.
    await expect(approveOpportunity(siteId, opp.id, admin.id)).rejects.toThrow(/Cannot approve an opportunity in state REJECTED/);
  });

  it("rejects with no reason by default (reason stays null)", async () => {
    const opp = await createOpportunity(siteId, { title: "Quiet reject", source: "MANUAL" }, admin.id);
    const rejected = await rejectOpportunity(siteId, opp.id, admin.id);
    expect(rejected.reviewStatus).toBe("REJECTED");
    expect(rejected.rejectionReason).toBeNull();
  });

  it("refuses to approve an opportunity that was already rejected", async () => {
    const opp = await createOpportunity(siteId, { title: "No re-approve", source: "MANUAL" }, admin.id);
    await rejectOpportunity(siteId, opp.id, admin.id, "Not a fit");
    await expect(approveOpportunity(siteId, opp.id, admin.id)).rejects.toThrow(OpportunityWorkflowError);
  });

  it("keeps the lifecycle status untouched by workflow transitions", async () => {
    const opp = await createDiscoveryOpportunity();
    await scoreOpportunity(siteId, opp.id, fullScore, admin.id); // lifecycle -> SCORED
    await approveOpportunity(siteId, opp.id, admin.id);
    const loaded = await prisma.contentOpportunity.findUnique({ where: { id: opp.id } });
    expect(loaded?.status).toBe("SCORED"); // lifecycle unchanged
    expect(loaded?.reviewStatus).toBe("APPROVED"); // workflow advanced
  });

  it("filters and sorts opportunities by workflow state, intent and score", async () => {
    const a = await createOpportunity(siteId, { title: "Alpha topic", source: "MANUAL" }, admin.id);
    await scoreOpportunity(siteId, a.id, { ...fullScore, demandScore: 5, demandJustification: "Huge volume" }, admin.id);
    await approveOpportunity(siteId, a.id, admin.id);

    const b = await createOpportunity(siteId, { title: "Beta topic", source: "MANUAL" }, admin.id);
    await scoreOpportunity(siteId, b.id, { ...fullScore, demandScore: 1, demandJustification: "Tiny volume" }, admin.id);

    const approvedOnly = await listOpportunities(siteId, { reviewStatus: "APPROVED" });
    expect(approvedOnly.total).toBe(1);
    expect(approvedOnly.items[0].id).toBe(a.id);

    const topFirst = await listOpportunities(siteId, { sort: "total", order: "desc" });
    expect(topFirst.items[0].id).toBe(a.id);
    expect(topFirst.items[1].id).toBe(b.id);
  });
});
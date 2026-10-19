import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { toJsonString, fromJsonString } from "@/lib/json";
import { createDraft } from "@/server/article.service";
import { encryptSecret } from "@/lib/crypto";
import { AccessDeniedError } from "@/lib/access";
import {
  runGenerationForWebsite,
  runDueGeneration,
  isGenerationDue,
  scheduleTimezone,
  updateGenerationSchedule,
  retryGenerationJob,
  claimQueuedJob,
  listGenerationJobs,
  type GenerationAI,
} from "@/server/generation.service";
import { OpenRouterError, type OpenRouterCall, type OpenRouterCallResult } from "@/server/openrouter";
import { resetDb, createTestAdmin, createTestSite, createTestUser } from "./helpers";

// Deterministic in-memory AI for tests. Inspects the user prompt to decide
// which task to answer; can be configured to fail specific tasks.
function makeFakeAI(opts: { failArticleTimes?: number; alwaysFailArticle?: boolean } = {}): GenerationAI & { calls: OpenRouterCall[] } {
  let articleFails = opts.failArticleTimes ?? 0;
  const calls: OpenRouterCall[] = [];
  return {
    calls,
    call: async (input: OpenRouterCall): Promise<OpenRouterCallResult> => {
      calls.push(input);
      const tail = input.messages[input.messages.length - 1]?.content ?? "";
      if (tail.includes("Write the full article")) {
        if (opts.alwaysFailArticle) throw new OpenRouterError("provider outage", 503);
        if (articleFails > 0) {
          articleFails--;
          throw new OpenRouterError("provider outage", 503);
        }
        return {
          content: "# Best Kayak Tours\n\nAn honest, evidence-led introduction.\n\n## What to expect\nA useful section with practical details.",
          model: input.model,
          usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
          costCents: 2,
        };
      }
      if (tail.includes("SEO metadata")) {
        return {
          content: '{"metaTitle": "Best Kayak Tours for [year]", "metaDescription": "Discover top kayak tours with real reviews and honest pricing for [year]."}',
          model: input.model,
          usage: { promptTokens: 50, completionTokens: 80, totalTokens: 130 },
          costCents: 1,
        };
      }
      // Outline task
      return {
        content: JSON.stringify({
          sections: [
            { heading: "Best Kayak Tours", level: 1, points: [] },
            { heading: "Top rated tours", level: 2, points: ["Compare real options"] },
          ],
        }),
        model: input.model,
        usage: { promptTokens: 40, completionTokens: 60, totalTokens: 100 },
        costCents: 1,
      };
    },
  };
}

describe("scheduled AI article generation pipeline", () => {
  let admin: { id: string };
  let site: { id: string; timezone: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    site = await createTestSite();
    siteId = site.id;
    // Pipeline requires a configured (encrypted) OpenRouter key to run.
    await prisma.aIProviderConfiguration.update({
      where: { websiteId: siteId },
      data: {
        apiKeyEncrypted: encryptSecret("sk-test"),
        preferredModel: "gpt-4o-mini",
        fallbackModel: null,
        maxRetries: 2,
        monthlyBudgetCents: null,
        maxCostPerArticleCents: null,
      },
    });
  });

  async function setupOpportunity(title = "Best Kayak Tours") {
    const opp = await prisma.contentOpportunity.create({
      data: {
        websiteId: siteId,
        title,
        keyword: "kayak tours",
        source: "KEYWORD",
        status: "NEW",
        reviewStatus: "APPROVED",
        approvedById: admin.id,
        approvedAt: new Date(),
        searchIntent: "COMMERCIAL_INVESTIGATION",
        contentType: "COMMERCIAL_LIST",
        action: "NEW_ARTICLE",
        keywords: toJsonString(["best kayak tours", "kayak tours"]),
        notes: "Verified evidence: search volume 5000 observed.",
      },
    });
    const draft = await createDraft(
      siteId,
      { opportunityId: opp.id, title, keyword: "kayak tours", notes: "Verified evidence: search volume 5000 observed." },
      admin.id
    );
    const job = await prisma.backgroundJob.create({
      data: {
        websiteId: siteId,
        type: "ARTICLE_GENERATE",
        status: "QUEUED",
        payload: toJsonString({ draftId: draft.id }),
        scheduledFor: new Date(),
      },
    });
    return { opp, draft, job };
  }

  async function enableSchedule(overrides: Record<string, unknown> = {}) {
    await updateGenerationSchedule(
      siteId,
      {
        enabled: true,
        schedule: "03:00",
        dailyLimit: 1,
        maxPerRun: 1,
        maxRetries: 2,
        timeoutMinutes: 30,
        timezone: null,
        weekdayMask: null,
        ...overrides,
      },
      admin.id
    );
  }

  describe("scheduling and timezones", () => {
    it("computes due instants per website timezone and weekday mask", () => {
      const sched = { enabled: true, schedule: "03:00", timezone: "America/New_York", weekdayMask: null };
      // 07:00Z = 03:00 EDT (UTC-4) -> due
      expect(isGenerationDue(sched, "UTC", new Date("2026-10-18T07:00:00Z"))).toBe(true);
      // 03:00Z = 23:00 EDT previous day -> not due
      expect(isGenerationDue(sched, "UTC", new Date("2026-10-18T03:00:00Z"))).toBe(false);
      // Site timezone fallback (no schedule tz) -> UTC schedule 03:00
      const utc = { enabled: true, schedule: "03:00", timezone: null, weekdayMask: null };
      expect(isGenerationDue(utc, "UTC", new Date("2026-10-18T03:00:00Z"))).toBe(true);
      expect(isGenerationDue(utc, "UTC", new Date("2026-10-18T04:00:00Z"))).toBe(false);
      // Disabled never due
      expect(isGenerationDue({ ...sched, enabled: false }, "UTC", new Date("2026-10-18T07:00:00Z"))).toBe(false);
      expect(scheduleTimezone(sched, "UTC")).toBe("America/New_York");
      expect(scheduleTimezone({ timezone: null }, "UTC")).toBe("UTC");
    });

    it("weekday mask restricts which days run", () => {
      const now = new Date("2026-10-18T03:00:00Z"); // 03:00 UTC Sunday
      const weekdayShort = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(now); // "Sun"
      const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayShort);
      const otherDay = (dayIndex + 1) % 7;
      const sched = { enabled: true, schedule: "03:00", timezone: null, weekdayMask: toJsonString([otherDay]) };
      expect(isGenerationDue(sched, "UTC", now)).toBe(false);
      const include = { ...sched, weekdayMask: toJsonString([dayIndex]) };
      expect(isGenerationDue(include, "UTC", now)).toBe(true);
    });

    it("runDueGeneration processes only websites whose local time is due", async () => {
      const now = new Date("2026-10-18T03:00:00Z");
      // Site A: UTC -> 03:00 due. Site B: New York (UTC-4) -> not due.
      const siteB = await createTestSite("Other Rafting", "otherrafting.com");
      await prisma.website.update({ where: { id: siteB.id }, data: { timezone: "America/New_York" } });
      await prisma.aIProviderConfiguration.update({
        where: { websiteId: siteB.id },
        data: { apiKeyEncrypted: encryptSecret("sk-test"), preferredModel: "gpt-4o-mini" },
      });
      await updateGenerationSchedule(siteId, { enabled: true, schedule: "03:00" }, admin.id);
      await updateGenerationSchedule(siteB.id, { enabled: true, schedule: "03:00" }, admin.id);

      const a = await setupOpportunity("A Due");
      const b = await setupOpportunity("B Not Due");
      // Re-point B's job/draft to siteB.
      await prisma.articleDraft.update({ where: { id: b.draft.id }, data: { websiteId: siteB.id } });
      await prisma.backgroundJob.update({ where: { id: b.job.id }, data: { websiteId: siteB.id } });
      await prisma.contentOpportunity.update({ where: { id: b.opp.id }, data: { websiteId: siteB.id } });

      const ai = makeFakeAI();
      const summary = await runDueGeneration(now, ai);

      expect(summary.due).toBe(1);
      expect(summary.ran).toBe(1);
      const finishedA = await prisma.backgroundJob.findUnique({ where: { id: a.job.id } });
      expect(finishedA?.status).toBe("SUCCEEDED");
      const untouchedB = await prisma.backgroundJob.findUnique({ where: { id: b.job.id } });
      expect(untouchedB?.status).toBe("QUEUED"); // still eligible tomorrow
    });
  });

  describe("daily limits", () => {
    it("respects the daily generation limit (conservative default 1)", async () => {
      await enableSchedule({ dailyLimit: 1, maxPerRun: 1 });
      const one = await setupOpportunity("Topic One");
      const two = await setupOpportunity("Topic Two");

      const ai = makeFakeAI();
      const first = await runGenerationForWebsite(siteId, { ai });
      expect(first.remaining).toBe(0);

      const second = await runGenerationForWebsite(siteId, { ai });
      expect(second.ok).toBe(false);
      expect(second.error).toContain("Daily generation limit");

      const done = await prisma.backgroundJob.findUnique({ where: { id: one.job.id } });
      expect(done?.status).toBe("SUCCEEDED");
      const pending = await prisma.backgroundJob.findUnique({ where: { id: two.job.id } });
      expect(pending?.status).toBe("QUEUED");
      // Only one draft was written.
      const drafts = await prisma.articleDraft.findMany({ where: { websiteId: siteId } });
      expect(drafts.filter((d) => d.body).length).toBe(1);
    });

    it("allows a configured higher limit and stops once reached the same day", async () => {
      await enableSchedule({ dailyLimit: 2, maxPerRun: 2 });
      await Promise.all([
        setupOpportunity("Topic A"),
        setupOpportunity("Topic B"),
        setupOpportunity("Topic C"),
      ]);
      const ai = makeFakeAI();
      const first = await runGenerationForWebsite(siteId, { ai });
      expect(first.outcomes?.filter((o) => o.ok === true && !o.skipped).length).toBe(2);

      const second = await runGenerationForWebsite(siteId, { ai });
      expect(second.error).toContain("Daily generation limit");

      const statuses = await prisma.backgroundJob.findMany({ where: { websiteId: siteId, type: "ARTICLE_GENERATE" } });
      expect(statuses.filter((j) => j.status === "SUCCEEDED")).toHaveLength(2);
      expect(statuses.filter((j) => j.status === "QUEUED")).toHaveLength(1); // one stays eligible for tomorrow
    });
  });

  describe("permissions", () => {
    it("re-check website permission when initiated by a user", async () => {
      await enableSchedule();
      const { job } = await setupOpportunity();
      const member = await createTestUser();
      // MEMBER with no membership on the site -> denied (deny by default).
      await expect(runGenerationForWebsite(siteId, { actorId: member.id, ai: makeFakeAI() })).rejects.toThrow(AccessDeniedError);
      const untouched = await prisma.backgroundJob.findUnique({ where: { id: job.id } });
      expect(untouched?.status).toBe("QUEUED");

      // Grant ADMIN -> allowed.
      await prisma.websiteUserRole.create({
        data: { userId: member.id, websiteId: siteId, role: "ADMIN", canPublish: true },
      });
      const res = await runGenerationForWebsite(siteId, { actorId: member.id, ai: makeFakeAI() });
      expect(res.ok).toBe(true);
      const done = await prisma.backgroundJob.findUnique({ where: { id: job.id } });
      expect(done?.status).toBe("SUCCEEDED");
    });

    it("manual retry of a failed job is permission-gated", async () => {
      await enableSchedule();
      const { job } = await setupOpportunity();
      const member = await createTestUser();
      await expect(retryGenerationJob(siteId, job.id, member.id)).rejects.toThrow(AccessDeniedError);
    });
  });

  describe("reliability and idempotency", () => {
    it("transient failures are safely retried and then succeed", async () => {
      await enableSchedule({ maxRetries: 2, maxPerRun: 1 });
      const { job, draft } = await setupOpportunity();
      // Fail the article call once; outline + meta succeed.
      const ai = makeFakeAI({ failArticleTimes: 3 });

      const first = await runGenerationForWebsite(siteId, { ai });
      expect(first.outcomes?.[0]?.retried).toBe(true);

      const requeued = await prisma.backgroundJob.findUnique({ where: { id: job.id } });
      expect(requeued?.status).toBe("QUEUED");
      expect(requeued?.attempts).toBe(1);
      expect(requeued?.error).toContain("provider outage");

      const second = await runGenerationForWebsite(siteId, { ai });
      expect(second.outcomes?.[0]?.ok).toBe(true);

      const done = await prisma.backgroundJob.findUnique({ where: { id: job.id } });
      expect(done?.status).toBe("SUCCEEDED");
      expect(done?.attempts).toBe(2);
      expect(done?.error).toBeNull();
      const content = await prisma.articleDraft.findUnique({ where: { id: draft.id } });
      expect(content?.body).toContain("Best Kayak Tours");
    });

    it("fails permanently after the retry budget and records the reason", async () => {
      await enableSchedule({ maxRetries: 1, maxPerRun: 1 });
      const { job, opp } = await setupOpportunity();
      const ai = makeFakeAI({ alwaysFailArticle: true });

      await runGenerationForWebsite(siteId, { ai });
      const afterFirst = await prisma.backgroundJob.findUnique({ where: { id: job.id } });
      expect(afterFirst?.status).toBe("QUEUED"); // 1st attempt -> retried once

      await runGenerationForWebsite(siteId, { ai });
      const failed = await prisma.backgroundJob.findUnique({ where: { id: job.id } });
      expect(failed?.status).toBe("FAILED");
      expect(failed?.error).toContain("provider outage");
      expect(failed?.attempts).toBe(2);
      // Opportunity workflow state reflects the failure; job stays inspectable.
      const oppAfter = await prisma.contentOpportunity.findUnique({ where: { id: opp.id } });
      expect(oppAfter?.reviewStatus).toBe("FAILED");

      // Inspectable via the listing endpoint service.
      const listing = await listGenerationJobs(siteId);
      expect(listing.jobs.some((j) => j.id === job.id && j.status === "FAILED" && j.error)).toBe(true);
    });

    it("failed jobs are retryable and succeed on a manual retry", async () => {
      await enableSchedule({ maxRetries: 0, maxPerRun: 1 });
      const { job } = await setupOpportunity();
      const failing = makeFakeAI({ alwaysFailArticle: true });
      await runGenerationForWebsite(siteId, { ai: failing });
      expect((await prisma.backgroundJob.findUnique({ where: { id: job.id } }))?.status).toBe("FAILED");

      const res = await retryGenerationJob(siteId, job.id, admin.id);
      expect(res.ok).toBe(true);
      expect((await prisma.backgroundJob.findUnique({ where: { id: job.id } }))?.status).toBe("QUEUED");

      const good = makeFakeAI();
      await runGenerationForWebsite(siteId, { ai: good });
      expect((await prisma.backgroundJob.findUnique({ where: { id: job.id } }))?.status).toBe("SUCCEEDED");
    });

    it("prevents two workers from claiming the same job", async () => {
      const { job } = await setupOpportunity();
      const [a, b] = await Promise.all([claimQueuedJob(job.id), claimQueuedJob(job.id)]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
      expect([a, b].filter((x) => !x)).toHaveLength(1);
    });

    it("re-running a completed job never duplicates the draft", async () => {
      await enableSchedule({ dailyLimit: 2, maxPerRun: 2 });
      const { job, draft, opp } = await setupOpportunity();
      const ai = makeFakeAI();
      await runGenerationForWebsite(siteId, { ai });
      const succeeded = await prisma.backgroundJob.findUnique({ where: { id: job.id } });
      expect(succeeded?.status).toBe("SUCCEEDED");

      // Simulate a double worker: force the job back to QUEUED and run again.
      await prisma.backgroundJob.update({ where: { id: job.id }, data: { status: "QUEUED", completedAt: null } });
      const again = await runGenerationForWebsite(siteId, { ai });
      expect(again.outcomes?.[0]?.skipped).toBe(true);

      const drafts = await prisma.articleDraft.findMany({ where: { websiteId: siteId } });
      expect(drafts).toHaveLength(1);
      expect(drafts[0].id).toBe(draft.id);
      const oppAfter = await prisma.contentOpportunity.findUnique({ where: { id: opp.id } });
      expect(oppAfter?.reviewStatus).toBe("DRAFT_READY");
    });
  });

  describe("output safety and evidence", () => {
    it("saves an unpublished draft with metadata, dynamic tags expanded, and opportunity association", async () => {
      await enableSchedule();
      const { job, draft, opp } = await setupOpportunity();
      const ai = makeFakeAI();
      const res = await runGenerationForWebsite(siteId, { ai });
      expect(res.ok).toBe(true);

      const saved = await prisma.articleDraft.findUnique({ where: { id: draft.id } });
      expect(saved?.status).toBe("DRAFT"); // never READY/PUBLISHED
      expect(saved?.opportunityId).toBe(opp.id); // associated with the opportunity
      expect(saved?.metaTitle).toBeTruthy();
      expect(saved?.metaTitle).not.toContain("[year]"); // dynamic tags expanded
      expect(saved?.metaTitle).toContain("20"); // expanded current year fragment
      expect(saved?.metaDescription).toContain("20");
      const related = fromJsonString<string[]>(saved?.relatedKeywords ?? null, []);
      expect(related).toContain("best kayak tours"); // verified cluster preserved, not invented
      const outline = fromJsonString<{ heading: string }[]>(saved?.outline ?? null, []);
      expect(outline.length).toBeGreaterThanOrEqual(2);
      expect(outline[0].heading).toBe("Best Kayak Tours");
      expect(res.outcomes?.[0]?.draftId).toBe(draft.id);

      // Workflow reached DRAFT_READY; job recorded usage metrics.
      const oppAfter = await prisma.contentOpportunity.findUnique({ where: { id: opp.id } });
      expect(oppAfter?.reviewStatus).toBe("DRAFT_READY");
      const usage = await prisma.usageRecord.findMany({ where: { websiteId: siteId } });
      expect(usage.map((u) => u.task).sort()).toEqual(["ARTICLE_GENERATE", "META_GENERATE", "OUTLINE_GENERATE"]);
      expect(usage.every((u) => u.model === "gpt-4o-mini" && u.jobId === job.id && u.totalTokens > 0)).toBe(true);
      expect(usage.reduce((s, u) => s + u.costCents, 0)).toBeGreaterThan(0);
    });

    it("never auto-publishes and leaves no publication attempts", async () => {
      await enableSchedule();
      const { draft } = await setupOpportunity();
      await runGenerationForWebsite(siteId, { ai: makeFakeAI() });
      const saved = await prisma.articleDraft.findUnique({ where: { id: draft.id } });
      expect(saved?.status).toBe("DRAFT");
      const attempts = await prisma.publicationAttempt.count({ where: { draftId: draft.id } });
      expect(attempts).toBe(0);
      const receipts = await prisma.publicationReceipt.count();
      expect(receipts).toBe(0);
    });

    it("does not generate for a rejected opportunity even if a job is queued", async () => {
      await enableSchedule();
      const { opp, draft, job } = await setupOpportunity();
      // Reject after approval (valid explicit transition).
      const { rejectOpportunity } = await import("@/server/opportunity-workflow.service");
      await rejectOpportunity(siteId, opp.id, admin.id, "Changed direction");
      expect((await prisma.contentOpportunity.findUnique({ where: { id: opp.id } }))?.reviewStatus).toBe("REJECTED");

      const res = await runGenerationForWebsite(siteId, { ai: makeFakeAI() });
      expect(res.outcomes?.[0]?.ok).toBe(false);
      const jobAfter = await prisma.backgroundJob.findUnique({ where: { id: job.id } });
      expect(jobAfter?.status).toBe("FAILED");
      expect(jobAfter?.error).toContain("rejected");
      const draftAfter = await prisma.articleDraft.findUnique({ where: { id: draft.id } });
      expect(draftAfter?.body).toBeNull();
      expect(draftAfter?.status).not.toBe("DRAFT");
    });

    it("enforces the monthly usage limit before generating", async () => {
      await enableSchedule();
      await prisma.aIProviderConfiguration.update({
        where: { websiteId: siteId },
        data: { monthlyBudgetCents: 2 },
      });
      await prisma.usageRecord.create({
        data: { websiteId: siteId, task: "ARTICLE_GENERATE", model: "gpt-4o-mini", totalTokens: 500, costCents: 2 },
      });
      const { job, draft } = await setupOpportunity();
      const ai = makeFakeAI();
      const callsBefore = ai.calls.length;
      const res = await runGenerationForWebsite(siteId, { ai });
      expect(res.outcomes?.[0]?.ok).toBe(false);
      expect(res.outcomes?.[0]?.error).toContain("budget");
      const jobAfter = await prisma.backgroundJob.findUnique({ where: { id: job.id } });
      expect(jobAfter?.status).toBe("FAILED");
      expect(ai.calls.length).toBe(callsBefore); // no AI calls consumed
      expect((await prisma.articleDraft.findUnique({ where: { id: draft.id } }))?.body).toBeNull();
    });
  });
});
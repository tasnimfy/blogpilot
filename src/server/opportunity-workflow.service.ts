// ---------------------------------------------------------------------------
// Content opportunity approval workflow.
//
// The workflow state lives on ContentOpportunity.reviewStatus and ONLY moves
// through the explicit transitions declared in OPPORTUNITY_TRANSITIONS below —
// arbitrary status edits are rejected. Approval creates (or links) the
// Article Studio draft, preserves the opportunity's keyword/evidence/scores/
// intent in that draft, and makes the item eligible for the daily generation
// queue (a QUEUED ARTICLE_GENERATE background job). Every approval/rejection
// is idempotent so a double click or a retry can never duplicate items.
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { toJsonString, fromJsonString } from "@/lib/json";
import { createDraft } from "@/server/article.service";

export class OpportunityWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpportunityWorkflowError";
  }
}

export const OPPORTUNITY_WORKFLOW_STATES = [
  "NEW",
  "REVIEWED",
  "APPROVED",
  "REJECTED",
  "QUEUED_FOR_ARTICLE_STUDIO",
  "GENERATING",
  "DRAFT_READY",
  "FAILED",
] as const;

export type OpportunityWorkflowState = (typeof OPPORTUNITY_WORKFLOW_STATES)[number];

export const WORKFLOW_DISPLAY: Record<OpportunityWorkflowState, string> = {
  NEW: "New",
  REVIEWED: "Reviewed",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  QUEUED_FOR_ARTICLE_STUDIO: "Queued for Article Studio",
  GENERATING: "Generating",
  DRAFT_READY: "Draft ready",
  FAILED: "Failed",
};

// Explicit, valid transitions. Everything else is rejected server-side.
export const OPPORTUNITY_TRANSITIONS: Record<OpportunityWorkflowState, readonly OpportunityWorkflowState[]> = {
  NEW: ["REVIEWED", "APPROVED", "REJECTED"],
  REVIEWED: ["APPROVED", "REJECTED"],
  APPROVED: ["QUEUED_FOR_ARTICLE_STUDIO", "REJECTED", "FAILED"],
  REJECTED: [],
  QUEUED_FOR_ARTICLE_STUDIO: ["GENERATING", "FAILED"],
  GENERATING: ["DRAFT_READY", "FAILED"],
  DRAFT_READY: [],
  FAILED: ["QUEUED_FOR_ARTICLE_STUDIO"], // allow retrying a failed item
};

export function isWorkflowState(value: string): value is OpportunityWorkflowState {
  return (OPPORTUNITY_WORKFLOW_STATES as readonly string[]).includes(value);
}

export function canTransition(from: string, to: string): boolean {
  if (!isWorkflowState(from) || !isWorkflowState(to)) return false;
  return OPPORTUNITY_TRANSITIONS[from].includes(to);
}

export function availableTransitions(state: string): OpportunityWorkflowState[] {
  if (!isWorkflowState(state)) return [];
  return [...OPPORTUNITY_TRANSITIONS[state]];
}

async function getOwnedOpportunity(websiteId: string, opportunityId: string) {
  const opp = await prisma.contentOpportunity.findFirst({
    where: { id: opportunityId, websiteId },
    include: { score: true },
  });
  if (!opp) throw new OpportunityWorkflowError("Opportunity not found");
  return opp;
}

// Link a draft to an opportunity (dedupe helper). Returns null when nothing
// is linked yet so the caller can create one.
async function findLinkedDraft(websiteId: string, opportunityId: string) {
  return prisma.articleDraft.findFirst({ where: { websiteId, opportunityId } });
}

// Idempotent: a website may hold at most one live ARTICLE_GENERATE job per
// draft. The daily generation queue consumes QUEUED ARTICLE_GENERATE jobs.
async function enqueueDraftForGeneration(websiteId: string, draftId: string) {
  const live = await prisma.backgroundJob.findMany({
    where: { websiteId, type: "ARTICLE_GENERATE", status: { in: ["QUEUED", "RUNNING"] } },
    select: { payload: true },
  });
  const already = live.some((j) => fromJsonString<{ draftId?: string }>(j.payload, {}).draftId === draftId);
  if (already) return false;
  await prisma.backgroundJob.create({
    data: {
      websiteId,
      type: "ARTICLE_GENERATE",
      status: "QUEUED",
      payload: toJsonString({ draftId }),
      scheduledFor: new Date(),
    },
  });
  return true;
}

function buildDraftNotes(opp: {
  title: string;
  keyword: string | null;
  contentType: string | null;
  searchIntent: string | null;
  action: string | null;
  notes: string | null;
  score?: { total: number | null; confidence: string | null; evidence: string | null; missingData: string | null } | null;
  keywords: string | null;
}): string {
  const parts: string[] = [];
  if (opp.keywords) {
    const related = fromJsonString<string[]>(opp.keywords, []);
    if (related.length > 1) parts.push(`Related queries: ${related.join("; ")}.`);
  }
  if (opp.searchIntent) parts.push(`Intent: ${opp.searchIntent}.`);
  if (opp.action) parts.push(`Action: ${opp.action}.`);
  if (opp.contentType) parts.push(`Content type: ${opp.contentType}.`);
  if (opp.score) {
    if (opp.score.total !== null && opp.score.total !== undefined) parts.push(`Opportunity score: ${opp.score.total}/25.`);
    if (opp.score.confidence) parts.push(`Confidence: ${opp.score.confidence}.`);
    const evidence = fromJsonString<string[]>(opp.score.evidence ?? null, []);
    if (evidence.length) parts.push(`Evidence: ${evidence.join(" | ")}.`);
  }
  if (opp.notes) parts.push(opp.notes);
  const joined = parts.join(" ").trim();
  return joined.length > 4800 ? `${joined.slice(0, 4797).trimEnd()}…` : joined;
}

// --- Approval --------------------------------------------------------------
// Idempotent. Approving again (double click / retry) returns the already
// linked draft and never duplicates the Article Studio item or the queue job.
export async function approveOpportunity(websiteId: string, opportunityId: string, userId: string) {
  const opp = await getOwnedOpportunity(websiteId, opportunityId);

  const alreadyHandled = ["APPROVED", "QUEUED_FOR_ARTICLE_STUDIO", "GENERATING", "DRAFT_READY", "FAILED"] as const;
  if (!canTransition(opp.reviewStatus, "APPROVED") && !(alreadyHandled as readonly string[]).includes(opp.reviewStatus)) {
    throw new OpportunityWorkflowError(`Cannot approve an opportunity in state ${opp.reviewStatus}`);
  }

  const linked = await findLinkedDraft(websiteId, opp.id);

  // 1) Create or link the Article Studio item.
  let draft = linked;
  let draftCreated = false;
  if (!draft) {
    if (opp.action === "UPDATE_EXISTING" && opp.existingDraftId) {
      // Update the page that already covers this topic: link, don't create.
      draft = await prisma.articleDraft.update({
        where: { id: opp.existingDraftId },
        data: { opportunityId: opp.id },
      });
    } else {
      draft = await createDraft(
        websiteId,
        {
          opportunityId: opp.id,
          title: opp.title,
          keyword: opp.keyword,
          articleType: opp.contentType,
          notes: buildDraftNotes(opp),
        },
        userId
      );
      draftCreated = true;
    }
  }

  // 2) Make the resulting content item eligible for the daily generation queue.
  const jobEnqueued = await enqueueDraftForGeneration(websiteId, draft.id);

  // 3) Record who approved it and when (idempotent — keep first approver).
  const updated = await prisma.contentOpportunity.update({
    where: { id: opp.id },
    data:
      opp.reviewStatus === "APPROVED" || (alreadyHandled as readonly string[]).includes(opp.reviewStatus)
        ? {}
        : { reviewStatus: "APPROVED", approvedById: userId, approvedAt: new Date() },
  });

  await auditLog({
    userId,
    websiteId,
    action: "OPPORTUNITY_APPROVED",
    entity: "ContentOpportunity",
    entityId: opp.id,
    detail: { draftId: draft.id, draftCreated, jobEnqueued, from: opp.reviewStatus },
  }).catch(() => undefined);

  return {
    opportunity: updated,
    draft,
    draftCreated,
    jobEnqueued,
    ok: true,
  };
}

// --- Rejection -------------------------------------------------------------
export async function rejectOpportunity(websiteId: string, opportunityId: string, userId: string, reason?: string | null) {
  const opp = await getOwnedOpportunity(websiteId, opportunityId);
  if (!canTransition(opp.reviewStatus, "REJECTED")) {
    throw new OpportunityWorkflowError(`Cannot reject an opportunity in state ${opp.reviewStatus}`);
  }
  const updated = await prisma.contentOpportunity.update({
    where: { id: opp.id },
    data: {
      reviewStatus: "REJECTED",
      rejectedById: userId,
      rejectedAt: new Date(),
      rejectionReason: reason?.trim() ? reason.trim().slice(0, 2000) : null,
    },
  });
  await auditLog({
    userId,
    websiteId,
    action: "OPPORTUNITY_REJECTED",
    entity: "ContentOpportunity",
    entityId: opp.id,
    detail: { reason: reason ?? null, from: opp.reviewStatus },
  }).catch(() => undefined);
  return updated;
}

// Generic explicit transition for the remaining states (REVIEWED,
// QUEUED_FOR_ARTICLE_STUDIO, GENERATING, DRAFT_READY, FAILED, …).
export async function transitionOpportunityStatus(
  websiteId: string,
  opportunityId: string,
  to: string,
  userId: string | null,
  opts: { reason?: string | null } = {}
) {
  if (!isWorkflowState(to)) throw new OpportunityWorkflowError(`Unknown workflow state "${to}"`);
  const opp = await getOwnedOpportunity(websiteId, opportunityId);
  if (!canTransition(opp.reviewStatus, to)) {
    throw new OpportunityWorkflowError(`Invalid transition ${opp.reviewStatus} -> ${to}`);
  }
  const data: Record<string, unknown> = { reviewStatus: to };
  if (to === "APPROVED") {
    data.approvedById = userId;
    data.approvedAt = new Date();
  }
  if (to === "REJECTED") {
    data.rejectedById = userId;
    data.rejectedAt = new Date();
    data.rejectionReason = opts.reason?.trim() ? opts.reason.trim().slice(0, 2000) : null;
  }
  const updated = await prisma.contentOpportunity.update({ where: { id: opp.id }, data });
  await auditLog({
    userId: userId ?? null,
    websiteId,
    action: "OPPORTUNITY_TRANSITIONED",
    entity: "ContentOpportunity",
    entityId: opp.id,
    detail: { from: opp.reviewStatus, to },
  }).catch(() => undefined);
  return updated;
}

// Convenience: workflow summary used by the UI.
export function workflowSummary(opp: { reviewStatus: string }) {
  return { state: opp.reviewStatus, allowed: availableTransitions(opp.reviewStatus) };
}
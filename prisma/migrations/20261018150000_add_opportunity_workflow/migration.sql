-- AddOpportunityWorkflow
-- Additive columns for the human review / approval workflow on content
-- opportunities: explicit workflow state + approver / rejection provenance.
-- The lifecycle `status` column is intentionally left untouched (legacy
-- NEW -> SCORED -> ... lifecycle driven by the scoring services).

-- AlterTable (ContentOpportunity: workflow state + provenance)
ALTER TABLE "ContentOpportunity" ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'NEW';
ALTER TABLE "ContentOpportunity" ADD COLUMN "approvedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentOpportunity" ADD COLUMN "approvedAt" DATETIME;
ALTER TABLE "ContentOpportunity" ADD COLUMN "rejectedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentOpportunity" ADD COLUMN "rejectedAt" DATETIME;
ALTER TABLE "ContentOpportunity" ADD COLUMN "rejectionReason" TEXT;

-- CreateIndex (fast per-site workflow filtering)
CREATE INDEX "ContentOpportunity_websiteId_reviewStatus_idx" ON "ContentOpportunity"("websiteId", "reviewStatus");
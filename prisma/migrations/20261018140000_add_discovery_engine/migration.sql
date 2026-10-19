-- AddDiscoveryEngine
-- Backward-compatible: additive tables + nullable columns for the automated
-- content opportunity discovery engine.

-- CreateTable (DiscoverySettings)
CREATE TABLE "DiscoverySettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "region" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "timeRange" TEXT NOT NULL DEFAULT '90d',
    "minScore" INTEGER NOT NULL DEFAULT 12,
    "maxCandidates" INTEGER NOT NULL DEFAULT 50,
    "includeKeywords" BOOLEAN NOT NULL DEFAULT true,
    "includeGsc" BOOLEAN NOT NULL DEFAULT true,
    "includeTrends" BOOLEAN NOT NULL DEFAULT true,
    "autoBucketId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DiscoverySettings_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoverySettings_websiteId_key" ON "DiscoverySettings"("websiteId");

-- CreateTable (DiscoveryRun)
CREATE TABLE "DiscoveryRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "triggeredBy" TEXT NOT NULL DEFAULT 'MANUAL',
    "settings" TEXT,
    "candidatesTotal" INTEGER NOT NULL DEFAULT 0,
    "opportunitiesCreated" INTEGER NOT NULL DEFAULT 0,
    "opportunitiesUpdated" INTEGER NOT NULL DEFAULT 0,
    "skippedBelowThreshold" INTEGER NOT NULL DEFAULT 0,
    "skippedCovered" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DiscoveryRun_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DiscoveryRun_websiteId_status_idx" ON "DiscoveryRun"("websiteId", "status");

-- AlterTable (ContentOpportunity: discovery fields)
ALTER TABLE "ContentOpportunity" ADD COLUMN "contentType" TEXT;
ALTER TABLE "ContentOpportunity" ADD COLUMN "keywords" TEXT;
ALTER TABLE "ContentOpportunity" ADD COLUMN "action" TEXT;
ALTER TABLE "ContentOpportunity" ADD COLUMN "discoveryRunId" TEXT REFERENCES "DiscoveryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentOpportunity" ADD COLUMN "existingDraftId" TEXT REFERENCES "ArticleDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ContentOpportunity_discoveryRunId_idx" ON "ContentOpportunity"("discoveryRunId");

-- AlterTable (OpportunityScore: freshness + explicit missing data)
ALTER TABLE "OpportunityScore" ADD COLUMN "dataFreshness" TEXT;
ALTER TABLE "OpportunityScore" ADD COLUMN "missingData" TEXT;
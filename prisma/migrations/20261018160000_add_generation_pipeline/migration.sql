-- Scheduled AI article-generation pipeline.
-- Additive only: generated metadata on drafts, retry fields on jobs, and three
-- new tables (generation schedule, usage ledger, notifications).

-- ArticleDraft: generated metadata (never auto-published)
ALTER TABLE "ArticleDraft" ADD COLUMN "metaTitle" TEXT;
ALTER TABLE "ArticleDraft" ADD COLUMN "metaDescription" TEXT;
ALTER TABLE "ArticleDraft" ADD COLUMN "relatedKeywords" TEXT;

-- BackgroundJob: retry + stale-job recovery tracking
ALTER TABLE "BackgroundJob" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BackgroundJob" ADD COLUMN "lockedAt" DATETIME;

-- GenerationSchedule
CREATE TABLE "GenerationSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "schedule" TEXT NOT NULL DEFAULT '03:00',
    "timezone" TEXT,
    "dailyLimit" INTEGER NOT NULL DEFAULT 1,
    "maxPerRun" INTEGER NOT NULL DEFAULT 1,
    "maxRetries" INTEGER NOT NULL DEFAULT 2,
    "timeoutMinutes" INTEGER NOT NULL DEFAULT 30,
    "weekdayMask" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GenerationSchedule_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GenerationSchedule_websiteId_key" ON "GenerationSchedule"("websiteId");

-- UsageRecord
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "draftId" TEXT,
    "opportunityId" TEXT,
    "jobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsageRecord_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "UsageRecord_websiteId_createdAt_idx" ON "UsageRecord"("websiteId", "createdAt");
CREATE INDEX "UsageRecord_websiteId_task_idx" ON "UsageRecord"("websiteId", "task");

-- Notification
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
CREATE INDEX "Notification_websiteId_createdAt_idx" ON "Notification"("websiteId", "createdAt");
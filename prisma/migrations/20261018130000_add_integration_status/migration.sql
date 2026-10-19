-- AddIntegrationStatus
-- Backward-compatible: additive table for the content research data
-- collection layer (integration status/sync registry per website + source).

-- CreateTable
CREATE TABLE "IntegrationStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "refreshIntervalMinutes" INTEGER NOT NULL DEFAULT 1440,
    "providerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "lastAttemptAt" DATETIME,
    "lastSuccessAt" DATETIME,
    "nextAttemptAt" DATETIME,
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastSyncCount" INTEGER,
    "lastDurationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IntegrationStatus_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationStatus_websiteId_source_key" ON "IntegrationStatus"("websiteId", "source");

-- CreateIndex
CREATE INDEX "IntegrationStatus_websiteId_idx" ON "IntegrationStatus"("websiteId");
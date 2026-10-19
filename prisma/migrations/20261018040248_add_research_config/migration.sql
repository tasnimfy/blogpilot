-- CreateTable
CREATE TABLE "ResearchConfiguration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "researchInstructions" TEXT,
    "permittedDomains" TEXT,
    "preferredSourceTypes" TEXT,
    "communityPlatforms" TEXT,
    "excludedDomains" TEXT,
    "requiredOfficialSources" TEXT,
    "minIndependentSources" INTEGER NOT NULL DEFAULT 3,
    "researchDepth" INTEGER NOT NULL DEFAULT 2,
    "researchLanguage" TEXT NOT NULL DEFAULT 'en',
    "countryScope" TEXT,
    "minSourceQuality" TEXT NOT NULL DEFAULT 'MEDIUM',
    "communityEvidenceMandatory" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResearchConfiguration_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ResearchConfiguration_websiteId_key" ON "ResearchConfiguration"("websiteId");

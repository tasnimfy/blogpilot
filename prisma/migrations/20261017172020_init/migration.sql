-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Website" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "niche" TEXT,
    "targetAudience" TEXT,
    "primaryCountry" TEXT,
    "targetCountries" TEXT,
    "primaryLanguage" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WebsiteSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "defaultPostType" TEXT DEFAULT 'post',
    "defaultCategory" TEXT,
    "defaultTags" TEXT,
    "defaultAuthor" TEXT,
    "workflow" TEXT NOT NULL DEFAULT 'DRAFT_FIRST',
    "autoSeoMetadata" BOOLEAN NOT NULL DEFAULT true,
    "dynamicTags" BOOLEAN NOT NULL DEFAULT true,
    "imageInsertion" TEXT NOT NULL DEFAULT 'MANUAL',
    "researchEnabled" BOOLEAN NOT NULL DEFAULT true,
    "minSources" INTEGER NOT NULL DEFAULT 3,
    "minEditorialScore" INTEGER,
    "defaultArticleLanguage" TEXT NOT NULL DEFAULT 'en',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebsiteSettings_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EditorialGuidelines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "brandVoice" TEXT,
    "writingStyle" TEXT,
    "spellingVariant" TEXT,
    "formalityLevel" TEXT,
    "targetReader" TEXT,
    "readingComplexity" TEXT,
    "contentDepth" TEXT,
    "articleStructure" TEXT,
    "introStyle" TEXT,
    "avoidPhrases" TEXT,
    "verifyClaims" TEXT,
    "internalLinking" TEXT,
    "externalLinking" TEXT,
    "brandInstructions" TEXT,
    "editorialChecklist" TEXT,
    "customInstructions" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EditorialGuidelines_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AIProviderConfiguration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT,
    "preferredModel" TEXT,
    "fallbackModel" TEXT,
    "researchModel" TEXT,
    "writingModel" TEXT,
    "seoModel" TEXT,
    "maxOutputTokens" INTEGER,
    "temperature" REAL,
    "perTaskOverrides" TEXT,
    "monthlyBudgetCents" INTEGER,
    "maxCostPerArticleCents" INTEGER,
    "maxRetries" INTEGER NOT NULL DEFAULT 2,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AIProviderConfiguration_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WordPressConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "appPasswordEncrypted" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastTestedAt" DATETIME,
    "lastError" TEXT,
    "supportedPostTypes" TEXT,
    "defaultAuthor" TEXT,
    "availableCategories" TEXT,
    "availableTags" TEXT,
    "mediaCapable" BOOLEAN NOT NULL DEFAULT false,
    "restMetaFields" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WordPressConnection_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KeywordBucket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KeywordBucket_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KeywordRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "bucketId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "searchIntent" TEXT,
    "country" TEXT,
    "language" TEXT,
    "searchVolume" INTEGER,
    "competition" TEXT,
    "cpcCents" INTEGER,
    "difficulty" INTEGER,
    "dateRange" TEXT,
    "source" TEXT,
    "sourceUrl" TEXT,
    "importBatchId" TEXT,
    "notes" TEXT,
    "researchStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "opportunityScore" INTEGER,
    "relatedArticleIds" TEXT,
    "evidence" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KeywordRecord_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KeywordRecord_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "KeywordBucket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KeywordRecord_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "bucketId" TEXT,
    "source" TEXT NOT NULL,
    "fileName" TEXT,
    "totalRows" INTEGER NOT NULL,
    "importedRows" INTEGER NOT NULL,
    "skippedRows" INTEGER NOT NULL,
    "failedRows" INTEGER NOT NULL,
    "duplicatesSkipped" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportBatch_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SearchConsoleRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "page" TEXT,
    "clicks" INTEGER,
    "impressions" INTEGER,
    "ctr" REAL,
    "position" REAL,
    "date" DATETIME,
    "country" TEXT,
    "device" TEXT,
    "source" TEXT NOT NULL DEFAULT 'CSV',
    "importBatchId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SearchConsoleRecord_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrendMonitoringConfiguration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "searchTerms" TEXT,
    "topicGroups" TEXT,
    "countries" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'DAILY',
    "timeRange" TEXT NOT NULL DEFAULT '90d',
    "category" INTEGER,
    "searchType" TEXT NOT NULL DEFAULT 'WEB',
    "changeThreshold" REAL NOT NULL DEFAULT 30,
    "autoBucketId" TEXT,
    "timezone" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrendMonitoringConfiguration_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrendObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "configId" TEXT,
    "term" TEXT NOT NULL,
    "region" TEXT,
    "timeRange" TEXT,
    "observedOn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "value" INTEGER,
    "previousValue" INTEGER,
    "changePct" REAL,
    "provider" TEXT,
    "source" TEXT NOT NULL DEFAULT 'TRENDS',
    "raw" TEXT,
    "notable" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "TrendObservation_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentOpportunity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "keyword" TEXT,
    "bucketId" TEXT,
    "source" TEXT NOT NULL,
    "searchIntent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "commercialIntent" BOOLEAN NOT NULL DEFAULT false,
    "seasonal" BOOLEAN NOT NULL DEFAULT false,
    "existingPageOverlap" BOOLEAN NOT NULL DEFAULT false,
    "recommendedAction" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContentOpportunity_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OpportunityScore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunityId" TEXT NOT NULL,
    "demandScore" INTEGER NOT NULL,
    "demandJustification" TEXT NOT NULL,
    "competitionScore" INTEGER NOT NULL,
    "competitionJustification" TEXT NOT NULL,
    "valueScore" INTEGER NOT NULL,
    "valueJustification" TEXT NOT NULL,
    "originalScore" INTEGER NOT NULL,
    "originalJustification" TEXT NOT NULL,
    "relevanceScore" INTEGER NOT NULL,
    "relevanceJustification" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "confidence" TEXT NOT NULL,
    "evidence" TEXT,
    "sources" TEXT,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "originalAiScore" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OpportunityScore_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "ContentOpportunity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "questions" TEXT,
    "brief" TEXT,
    "error" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResearchJob_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchJob_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "ContentOpportunity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "researchJobId" TEXT,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "sourceType" TEXT,
    "accessedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "excerpt" TEXT,
    "notes" TEXT,
    CONSTRAINT "ResearchSource_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchSource_researchJobId_fkey" FOREIGN KEY ("researchJobId") REFERENCES "ResearchJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchFinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "researchJobId" TEXT,
    "sourceId" TEXT,
    "category" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "evidence" TEXT,
    CONSTRAINT "ResearchFinding_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchFinding_researchJobId_fkey" FOREIGN KEY ("researchJobId") REFERENCES "ResearchJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchFinding_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ResearchSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArticleDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WRITING',
    "title" TEXT NOT NULL,
    "keyword" TEXT,
    "slug" TEXT,
    "articleType" TEXT,
    "targetLength" INTEGER,
    "language" TEXT,
    "body" TEXT,
    "outline" TEXT,
    "outlineApproved" BOOLEAN NOT NULL DEFAULT false,
    "researchBrief" TEXT,
    "notes" TEXT,
    "publishedReceiptId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArticleDraft_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArticleDraft_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "ContentOpportunity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DraftRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DraftRevision_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ArticleDraft" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SEOAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "categories" TEXT,
    "critical" TEXT,
    "warnings" TEXT,
    "suggestions" TEXT,
    "mandatoryFailed" BOOLEAN NOT NULL DEFAULT false,
    "checks" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SEOAnalysis_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ArticleDraft" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImageAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerId" TEXT,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "title" TEXT,
    "creator" TEXT,
    "attributionRequired" BOOLEAN NOT NULL DEFAULT true,
    "license" TEXT,
    "licenseUrl" TEXT,
    "commercialUse" BOOLEAN NOT NULL DEFAULT false,
    "width" INTEGER,
    "height" INTEGER,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "altText" TEXT,
    "wpMediaId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImageAsset_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DraftImageAssociation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'BODY',
    "position" INTEGER,
    "altText" TEXT,
    CONSTRAINT "DraftImageAssociation_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ArticleDraft" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DraftImageAssociation_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "ImageAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublicationAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STARTED',
    "wpPostId" INTEGER,
    "requestSent" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PublicationAttempt_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublicationAttempt_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ArticleDraft" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublicationReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "wpPostId" INTEGER NOT NULL,
    "permalink" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublicationReceipt_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "payload" TEXT,
    "result" TEXT,
    "error" TEXT,
    "scheduledFor" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "websiteId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "detail" TEXT,
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Website_domain_key" ON "Website"("domain");

-- CreateIndex
CREATE INDEX "Website_status_idx" ON "Website"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteSettings_websiteId_key" ON "WebsiteSettings"("websiteId");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialGuidelines_websiteId_key" ON "EditorialGuidelines"("websiteId");

-- CreateIndex
CREATE UNIQUE INDEX "AIProviderConfiguration_websiteId_key" ON "AIProviderConfiguration"("websiteId");

-- CreateIndex
CREATE UNIQUE INDEX "WordPressConnection_websiteId_key" ON "WordPressConnection"("websiteId");

-- CreateIndex
CREATE INDEX "KeywordBucket_websiteId_idx" ON "KeywordBucket"("websiteId");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordBucket_websiteId_name_key" ON "KeywordBucket"("websiteId", "name");

-- CreateIndex
CREATE INDEX "KeywordRecord_websiteId_bucketId_idx" ON "KeywordRecord"("websiteId", "bucketId");

-- CreateIndex
CREATE INDEX "KeywordRecord_websiteId_researchStatus_idx" ON "KeywordRecord"("websiteId", "researchStatus");

-- CreateIndex
CREATE INDEX "ImportBatch_websiteId_idx" ON "ImportBatch"("websiteId");

-- CreateIndex
CREATE INDEX "SearchConsoleRecord_websiteId_query_idx" ON "SearchConsoleRecord"("websiteId", "query");

-- CreateIndex
CREATE INDEX "TrendMonitoringConfiguration_websiteId_enabled_idx" ON "TrendMonitoringConfiguration"("websiteId", "enabled");

-- CreateIndex
CREATE INDEX "TrendObservation_websiteId_term_observedOn_idx" ON "TrendObservation"("websiteId", "term", "observedOn");

-- CreateIndex
CREATE INDEX "ContentOpportunity_websiteId_status_idx" ON "ContentOpportunity"("websiteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityScore_opportunityId_key" ON "OpportunityScore"("opportunityId");

-- CreateIndex
CREATE INDEX "OpportunityScore_total_idx" ON "OpportunityScore"("total");

-- CreateIndex
CREATE INDEX "ResearchJob_websiteId_status_idx" ON "ResearchJob"("websiteId", "status");

-- CreateIndex
CREATE INDEX "ResearchSource_websiteId_idx" ON "ResearchSource"("websiteId");

-- CreateIndex
CREATE INDEX "ResearchFinding_websiteId_idx" ON "ResearchFinding"("websiteId");

-- CreateIndex
CREATE INDEX "ArticleDraft_websiteId_status_idx" ON "ArticleDraft"("websiteId", "status");

-- CreateIndex
CREATE INDEX "DraftRevision_draftId_idx" ON "DraftRevision"("draftId");

-- CreateIndex
CREATE UNIQUE INDEX "SEOAnalysis_draftId_key" ON "SEOAnalysis"("draftId");

-- CreateIndex
CREATE INDEX "ImageAsset_websiteId_idx" ON "ImageAsset"("websiteId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftImageAssociation_draftId_imageId_role_key" ON "DraftImageAssociation"("draftId", "imageId", "role");

-- CreateIndex
CREATE INDEX "PublicationAttempt_websiteId_status_idx" ON "PublicationAttempt"("websiteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationAttempt_draftId_idempotencyKey_key" ON "PublicationAttempt"("draftId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PublicationReceipt_websiteId_idx" ON "PublicationReceipt"("websiteId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationReceipt_websiteId_wpPostId_key" ON "PublicationReceipt"("websiteId", "wpPostId");

-- CreateIndex
CREATE INDEX "BackgroundJob_status_scheduledFor_idx" ON "BackgroundJob"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "AuditLog_websiteId_idx" ON "AuditLog"("websiteId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

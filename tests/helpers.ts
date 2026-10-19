import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

// Deletes all rows so each test starts clean. Order avoids FK conflicts.
const DELETE_ORDER: string[] = [
  "auditLog",
  "backgroundJob",
  "usageRecord",
  "notification",
  "generationSchedule",
  "publicationReceipt",
  "publicationAttempt",
  "draftImageAssociation",
  "imageAsset",
  "sEOAnalysis",
  "draftRevision",
  "articleDraft",
  "researchFinding",
  "researchSource",
  "researchJob",
  "opportunityScore",
  "contentOpportunity",
  "trendObservation",
  "trendMonitoringConfiguration",
  "searchConsoleRecord",
  "importBatch",
  "keywordRecord",
  "keywordBucket",
  "discoveryRun",
  "discoverySettings",
  "wordPressConnection",
  "aIProviderConfiguration",
  "editorialGuidelines",
  "websiteSettings",
  "integrationStatus",
  "websiteUserRole",
  "website",
  "user",
];

export async function resetDb() {
  for (const model of DELETE_ORDER) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any)[model].deleteMany({});
  }
}

export async function createTestAdmin() {
  const user = await prisma.user.create({
    data: {
      email: "admin@test.local",
      passwordHash: hashPassword("password123"),
      globalRole: "OPERATOR",
    },
  });
  return user;
}

// Creates a site-scoped (MEMBER) account; memberships are granted separately.
export async function createTestUser(email = "member@test.local") {
  const user = await prisma.user.create({
    data: { email, passwordHash: hashPassword("password123"), globalRole: "MEMBER" },
  });
  return user;
}

export async function createTestSite(name = "White Rafting", domain = "whiterafting.com") {
  return prisma.website.create({
    data: {
      name,
      domain,
      url: `https://${domain}`,
      settings: { create: {} },
      guidelines: { create: {} },
      aiConfiguration: { create: {} },
    },
  });
}

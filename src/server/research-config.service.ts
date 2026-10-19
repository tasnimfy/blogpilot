import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { toJsonString, fromJsonString } from "@/lib/json";
import { z } from "zod";

export class ResearchConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchConfigError";
  }
}

export const researchConfigSchema = z.object({
  enabled: z.boolean().optional(),
  researchInstructions: z.string().max(10000).optional().nullable(),
  permittedDomains: z.array(z.string()).optional(),
  preferredSourceTypes: z.array(z.string()).optional(),
  communityPlatforms: z.array(z.string()).optional(),
  excludedDomains: z.array(z.string()).optional(),
  requiredOfficialSources: z.array(z.string()).optional(),
  minIndependentSources: z.number().int().min(0).max(100).optional(),
  researchDepth: z.number().int().min(0).max(10).optional(),
  researchLanguage: z.string().max(20).optional(),
  countryScope: z.string().max(100).optional().nullable(),
  minSourceQuality: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  communityEvidenceMandatory: z.boolean().optional(),
});

export type ResearchConfigInput = z.infer<typeof researchConfigSchema>;

export async function getResearchConfig(websiteId: string) {
  const row = await prisma.researchConfiguration.findUnique({ where: { websiteId } });
  return serializeConfig(row);
}

export async function updateResearchConfig(websiteId: string, raw: unknown, userId: string) {
  const site = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!site) throw new ResearchConfigError("Website not found");
  const data = researchConfigSchema.parse(raw);
  const existing = await prisma.researchConfiguration.upsert({
    where: { websiteId },
    update: {},
    create: { websiteId },
  });
  const updated = await prisma.researchConfiguration.update({
    where: { id: existing.id },
    data: {
      enabled: data.enabled,
      researchInstructions: data.researchInstructions ?? null,
      permittedDomains: data.permittedDomains !== undefined ? toJsonString(data.permittedDomains) : existing.permittedDomains,
      preferredSourceTypes: data.preferredSourceTypes !== undefined ? toJsonString(data.preferredSourceTypes) : existing.preferredSourceTypes,
      communityPlatforms: data.communityPlatforms !== undefined ? toJsonString(data.communityPlatforms) : existing.communityPlatforms,
      excludedDomains: data.excludedDomains !== undefined ? toJsonString(data.excludedDomains) : existing.excludedDomains,
      requiredOfficialSources: data.requiredOfficialSources !== undefined ? toJsonString(data.requiredOfficialSources) : existing.requiredOfficialSources,
      minIndependentSources: data.minIndependentSources,
      researchDepth: data.researchDepth,
      researchLanguage: data.researchLanguage,
      countryScope: data.countryScope ?? null,
      minSourceQuality: data.minSourceQuality,
      communityEvidenceMandatory: data.communityEvidenceMandatory,
    },
  });
  await auditLog({ userId, websiteId, action: "RESEARCH_CONFIG_UPDATED", entity: "ResearchConfiguration", entityId: websiteId });
  return serializeConfig(updated);
}

function serializeConfig(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null;
  const arr = (k: string) => fromJsonString<string[]>(row[k] as string | null | undefined, []);
  return {
    ...row,
    permittedDomains: arr("permittedDomains"),
    preferredSourceTypes: arr("preferredSourceTypes"),
    communityPlatforms: arr("communityPlatforms"),
    excludedDomains: arr("excludedDomains"),
    requiredOfficialSources: arr("requiredOfficialSources"),
  };
}

export { serializeConfig as serializeResearchConfig };

// Source presets the operator can toggle (legitimate/accessible platforms only).
export const SOURCE_PRESETS = [
  { key: "REDDIT", label: "Reddit" },
  { key: "FACEBOOK_PUBLIC", label: "Facebook (public, legitimately accessible)" },
  { key: "FORUM", label: "Specialist rafting / outdoor forums" },
  { key: "TRIPADVISOR", label: "Tripadvisor" },
  { key: "VIATOR", label: "Viator" },
  { key: "GETYOURGUIDE", label: "GetYourGuide" },
  { key: "GOOGLE_REVIEWS", label: "Google reviews (permitted access)" },
  { key: "REVIEW_SITE", label: "Outdoor equipment review sites" },
  { key: "OFFICIAL", label: "Official tourism & park websites" },
  { key: "GOVERNMENT", label: "Government sources" },
  { key: "INDUSTRY", label: "Industry publications" },
  { key: "MANUAL", label: "Manually supplied URLs" },
] as const;

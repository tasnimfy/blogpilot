import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { toJsonString } from "@/lib/json";
import { z } from "zod";
import {
  createWebsiteSchema,
  updateWebsiteSchema,
  type CreateWebsiteInput,
  type UpdateWebsiteInput,
} from "@/lib/validation";

export class WebsiteServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebsiteServiceError";
  }
}

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const res = schema.safeParse(input);
  if (!res.success) {
    throw new WebsiteServiceError(res.error.issues[0]?.message ?? "Validation failed");
  }
  return res.data;
}

export async function listSites(userId?: string | null) {
  const where = userId ? await listSitesForUser(userId) : undefined;
  return prisma.website.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      domain: true,
      url: true,
      niche: true,
      primaryLanguage: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          keywordRecords: true,
          drafts: true,
          opportunities: true,
        },
      },
    },
  });
}

export async function getSite(id: string) {
  const site = await prisma.website.findUnique({
    where: { id },
    include: { settings: true, guidelines: true, aiConfiguration: true, wordpressConnection: true },
  });
  return site;
}

export async function createSite(input: unknown, userId: string) {
  const data = parseOrThrow(createWebsiteSchema, input);
  try {
    const site = await prisma.website.create({
      data: {
        name: data.name.trim(),
        domain: data.domain.toLowerCase().trim(),
        url: data.url.trim(),
        description: data.description ?? null,
        niche: data.niche ?? null,
        targetAudience: data.targetAudience ?? null,
        primaryCountry: data.primaryCountry ?? null,
        targetCountries: toJsonString(data.targetCountries ?? []),
        primaryLanguage: data.primaryLanguage ?? "en",
        timezone: data.timezone ?? "UTC",
        status: data.status ?? "ACTIVE",
        settings: { create: {} },
        guidelines: { create: {} },
        aiConfiguration: { create: {} },
      },
      include: { settings: true, guidelines: true, aiConfiguration: true },
    });
    await auditLog({
      userId,
      websiteId: site.id,
      action: "SITE_CREATED",
      entity: "Website",
      entityId: site.id,
    });
    return site;
  } catch (e: unknown) {
    if (isUniqueError(e)) throw new WebsiteServiceError("A website with that domain already exists");
    throw e;
  }
}

export async function updateSite(id: string, input: unknown, userId: string) {
  const site = await prisma.website.findUnique({ where: { id } });
  if (!site) throw new WebsiteServiceError("Website not found");

  const data = parseOrThrow(updateWebsiteSchema, input);
  const payload: Record<string, unknown> = {};
  if (data.name !== undefined) payload.name = data.name.trim();
  if (data.domain !== undefined) payload.domain = data.domain.toLowerCase().trim();
  if (data.url !== undefined) payload.url = data.url.trim();
  if (data.description !== undefined) payload.description = data.description ?? null;
  if (data.niche !== undefined) payload.niche = data.niche ?? null;
  if (data.targetAudience !== undefined) payload.targetAudience = data.targetAudience ?? null;
  if (data.primaryCountry !== undefined) payload.primaryCountry = data.primaryCountry ?? null;
  if (data.targetCountries !== undefined)
    payload.targetCountries = toJsonString(data.targetCountries ?? []);
  if (data.primaryLanguage !== undefined) payload.primaryLanguage = data.primaryLanguage;
  if (data.timezone !== undefined) payload.timezone = data.timezone;
  if (data.status !== undefined) payload.status = data.status;

  try {
    const updated = await prisma.website.update({ where: { id }, data: payload });
    await auditLog({
      userId,
      websiteId: id,
      action: "SITE_UPDATED",
      entity: "Website",
      entityId: id,
    });
    return updated;
  } catch (e: unknown) {
    if (isUniqueError(e)) throw new WebsiteServiceError("A website with that domain already exists");
    throw e;
  }
}

export async function setSiteStatus(id: string, status: string, userId: string) {
  if (!["ACTIVE", "DISABLED", "ARCHIVED"].includes(status)) {
    throw new WebsiteServiceError("Invalid status");
  }
  const site = await prisma.website.findUnique({ where: { id } });
  if (!site) throw new WebsiteServiceError("Website not found");
  const updated = await prisma.website.update({ where: { id }, data: { status } });
  await auditLog({
    userId,
    websiteId: id,
    action: "SITE_STATUS_CHANGED",
    entity: "Website",
    entityId: id,
    detail: { to: status },
  });
  return updated;
}

export async function deleteSite(id: string, userId: string) {
  const site = await prisma.website.findUnique({ where: { id } });
  if (!site) throw new WebsiteServiceError("Website not found");
  await auditLog({
    userId,
    websiteId: id,
    action: "SITE_DELETED",
    entity: "Website",
    entityId: id,
  });
  // Cascade deletes all site-owned records.
  await prisma.website.delete({ where: { id } });
}

// Async filter used by listSites: returns undefined (all sites) for OPERATORs,
// or an id-in filter for members. Exported for the API layer.
export async function listSitesForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { globalRole: true, isActive: true },
  });
  if (!user || !user.isActive) return { id: { in: [] } };
  if (user.globalRole === "OPERATOR") return undefined;
  const memberships = await prisma.websiteUserRole.findMany({
    where: { userId },
    select: { websiteId: true },
  });
  return { id: { in: memberships.map((m) => m.websiteId) } };
}

function isUniqueError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "P2002"
  );
}

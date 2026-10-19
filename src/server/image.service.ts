import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { z } from "zod";
import { getImageProvider, listImageProviders, type ImageResult } from "@/providers/image-providers";

export class ImageServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageServiceError";
  }
}

export async function searchImages(websiteId: string, providerId: string | null | undefined, query: string, limit = 20) {
  await requireSite(websiteId);
  if (!query.trim()) throw new ImageServiceError("A search query is required");
  const provider = getImageProvider(providerId);
  const res = await provider.search({ query: query.trim(), limit });
  if (!res.ok) throw new ImageServiceError(res.error);
  return { provider: provider.name, items: res.items };
}

export function providerCapabilities() {
  return listImageProviders().map((p) => ({ id: p.id, name: p.name, capabilities: p.capabilities }));
}

const saveSchema = z.object({
  provider: z.enum(["openverse", "wikimedia"]),
  providerId: z.string().optional().nullable(),
  url: z.string().url("Image URL is required and must be valid"),
  thumbnailUrl: z.string().optional().nullable(),
  title: z.string().max(500).optional().nullable(),
  creator: z.string().max(500).optional().nullable(),
  attribution: z.string().max(2000).optional().nullable(),
  license: z.string().max(200).optional().nullable(),
  licenseUrl: z.string().max(2000).optional().nullable(),
  attributionRequired: z.boolean().optional().default(true),
  commercialUse: z.boolean().optional().default(false),
  width: z.number().int().optional().nullable(),
  height: z.number().int().optional().nullable(),
  mimeType: z.string().max(100).optional().nullable(),
  altText: z.string().max(1000).optional().nullable(),
});

export async function saveImage(websiteId: string, raw: unknown, userId: string) {
  await requireSite(websiteId);
  const data = saveSchema.parse(raw);
  const image = await prisma.imageAsset.create({
    data: {
      websiteId,
      provider: data.provider,
      providerId: data.providerId ?? null,
      url: data.url,
      thumbnailUrl: data.thumbnailUrl ?? null,
      title: data.title ?? null,
      creator: data.creator ?? null,
      attributionRequired: data.attributionRequired,
      license: data.license ?? null,
      licenseUrl: data.licenseUrl ?? null,
      commercialUse: data.commercialUse,
      width: data.width ?? null,
      height: data.height ?? null,
      mimeType: data.mimeType ?? null,
      altText: data.altText ?? null,
    },
  });
  await auditLog({ userId, websiteId, action: "IMAGE_SAVED", entity: "ImageAsset", entityId: image.id });
  return image;
}

export function listImages(websiteId: string) {
  return prisma.imageAsset.findMany({ where: { websiteId }, orderBy: { createdAt: "desc" }, take: 200 });
}

export async function deleteImage(websiteId: string, imageId: string, userId: string) {
  const img = await prisma.imageAsset.findFirst({ where: { id: imageId, websiteId } });
  if (!img) throw new ImageServiceError("Image not found");
  await prisma.imageAsset.delete({ where: { id: imageId } });
  await auditLog({ userId, websiteId, action: "IMAGE_DELETED", entity: "ImageAsset", entityId: imageId });
}

// Human-readable attribution line for an image result.
export function attributionLine(item: ImageResult): string {
  const parts = [item.creator ? `Photo by ${item.creator}` : null, item.license ? `(${item.license})` : null].filter(Boolean);
  return parts.join(" ");
}

async function requireSite(websiteId: string) {
  const site = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!site) throw new ImageServiceError("Website not found");
  return site;
}

import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { z } from "zod";

export class BucketServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BucketServiceError";
  }
}

export const createBucketSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional().nullable(),
  color: z.string().max(50).optional().nullable(),
});

export const updateBucketSchema = createBucketSchema.partial();

async function requireSite(websiteId: string) {
  const site = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!site) throw new BucketServiceError("Website not found");
}

function isUniqueError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

export function listBuckets(websiteId: string) {
  return prisma.keywordBucket.findMany({
    where: { websiteId },
    orderBy: { name: "asc" },
    include: { _count: { select: { keywordRecords: true } } },
  });
}

export async function createBucket(websiteId: string, input: unknown, userId: string) {
  await requireSite(websiteId);
  const data = createBucketSchema.parse(input);
  try {
    const bucket = await prisma.keywordBucket.create({
      data: {
        websiteId,
        name: data.name.trim(),
        description: data.description ?? null,
        color: data.color ?? null,
      },
    });
    await auditLog({ userId, websiteId, action: "BUCKET_CREATED", entity: "KeywordBucket", entityId: bucket.id });
    return bucket;
  } catch (e) {
    if (isUniqueError(e)) throw new BucketServiceError("A bucket with that name already exists for this website");
    throw e;
  }
}

export async function updateBucket(websiteId: string, bucketId: string, input: unknown, userId: string) {
  await requireSite(websiteId);
  const bucket = await prisma.keywordBucket.findFirst({ where: { id: bucketId, websiteId } });
  if (!bucket) throw new BucketServiceError("Bucket not found");
  const data = updateBucketSchema.parse(input);
  const payload: Record<string, unknown> = {};
  if (data.name !== undefined) payload.name = data.name.trim();
  if (data.description !== undefined) payload.description = data.description ?? null;
  if (data.color !== undefined) payload.color = data.color ?? null;
  try {
    const updated = await prisma.keywordBucket.update({ where: { id: bucketId }, data: payload });
    await auditLog({ userId, websiteId, action: "BUCKET_UPDATED", entity: "KeywordBucket", entityId: bucketId });
    return updated;
  } catch (e) {
    if (isUniqueError(e)) throw new BucketServiceError("A bucket with that name already exists for this website");
    throw e;
  }
}

export async function deleteBucket(websiteId: string, bucketId: string, userId: string) {
  await requireSite(websiteId);
  const bucket = await prisma.keywordBucket.findFirst({ where: { id: bucketId, websiteId } });
  if (!bucket) throw new BucketServiceError("Bucket not found");
  await auditLog({ userId, websiteId, action: "BUCKET_DELETED", entity: "KeywordBucket", entityId: bucketId });
  // Cascade deletes the bucket's keyword records.
  await prisma.keywordBucket.delete({ where: { id: bucketId } });
}

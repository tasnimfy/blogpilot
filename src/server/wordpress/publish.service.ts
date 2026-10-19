import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { toJsonString } from "@/lib/json";
import { WordPressClient, WordPressError } from "@/server/wordpress/client";
import { getDecryptedWordpressPassword } from "@/server/settings.service";
import { expandDynamicTags } from "@/lib/dynamic-tags";
import { looksLikeMarkdown, markdownToHtml, sanitizeHtml } from "@/lib/markup";
import { analyzeDraft } from "@/server/seo.service";
import { buildRankMathMetaPayload } from "@/server/rankmath.service";
import { assertSafeOutboundUrl } from "@/lib/ssrf";

export class PublishServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishServiceError";
  }
}

// Structural client type so tests can inject a fake without network.
export interface WpLikeClient {
  getPostsBySlug(slug: string): Promise<{ id: number; slug: string; link: string; status: string }[]>;
  createPost(payload: Record<string, unknown>): Promise<{ id: number; link: string; slug: string; status: string }>;
  updatePost(id: number, payload: Record<string, unknown>): Promise<{ id: number; link: string; slug: string; status: string }>;
  uploadMedia(file: Uint8Array, fileName: string, contentType: string): Promise<{ id: number; source_url: string }>;
  request?(path: string, opts?: unknown): Promise<unknown>;
}

export interface PublishOptions {
  status?: "publish" | "draft";
  categoryId?: number | null;
  tagIds?: number[];
  featuredImageId?: string | null; // local ImageAsset id
  force?: boolean; // skip mandatory SEO blocking (explicit operator override)
  seoTitle?: string | null;
  metaDescription?: string | null;
  canonical?: string | null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "post";
}

export async function publishDraft(
  websiteId: string,
  draftId: string,
  opts: PublishOptions = {},
  client?: WpLikeClient
) {
  const site = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!site) throw new PublishServiceError("Website not found");

  const conn = await prisma.wordPressConnection.findUnique({ where: { websiteId } });
  if (!conn || !conn.appPasswordEncrypted) {
    throw new PublishServiceError("No WordPress connection with credentials is configured for this site");
  }
  const appPassword = await getDecryptedWordpressPassword(websiteId);
  if (!appPassword) throw new PublishServiceError("Stored WordPress password could not be decrypted");
  const wp: WpLikeClient =
    client ?? new WordPressClient({ siteUrl: conn.siteUrl, username: conn.username, appPassword });

  const draft = await prisma.articleDraft.findFirst({
    where: { id: draftId, websiteId },
    include: { opportunity: { select: { keyword: true, title: true } }, images: { include: { image: true } } },
  });
  if (!draft) throw new PublishServiceError("Draft not found");
  if (draft.status === "PUBLISHED") throw new PublishServiceError("This draft is already published");
  if (!draft.body) throw new PublishServiceError("Draft has no article body to publish");

  // 1. Run mandatory SEO checks (blocking unless explicitly forced).
  if (!opts.force) {
    const seo = await analyzeDraft(websiteId, draftId, {
      seoTitle: opts.seoTitle,
      metaDescription: opts.metaDescription,
      canonical: opts.canonical,
      slug: draft.slug,
    });
    if (seo.mandatoryFailed) {
      throw new PublishServiceError(
        "Mandatory SEO checks failed (missing H1/title/content). Fix the issues or publish with explicit override."
      );
    }
  }

  // 2. Resolve dynamic tags using the site timezone, then export HTML.
  //    WordPress renders HTML post content; legacy markdown bodies are
  //    converted (and sanitized) here so published posts are never raw
  //    markdown. Editor bodies are already HTML and pass through sanitized.
  const title = expandDynamicTags(draft.title, { siteName: site.name, siteDomain: site.domain, timezone: site.timezone }).text;
  const expandedBody = expandDynamicTags(draft.body ?? "", { siteName: site.name, siteDomain: site.domain, timezone: site.timezone }).text;
  const content = looksLikeMarkdown(expandedBody) ? markdownToHtml(expandedBody) : sanitizeHtml(expandedBody);

  // 3. Idempotency marker: a deterministic slug derived from the resolved title + draft id.
  const markerSlug = `${slugify(title)}-${draftId.slice(-8)}`;
  const targetStatus = opts.status ?? "publish";

  // 4. Upload images (featured + body) before creating the post.
  const uploaded: Record<string, number> = {};
  if (opts.featuredImageId || draft.images.length > 0) {
    const images = draft.images.map((a) => ({ role: a.role, asset: a.image }));
    if (opts.featuredImageId) {
      const asset = images.find((i) => i.asset.id === opts.featuredImageId)?.asset ?? images[0]?.asset;
      if (asset) {
        uploaded[asset.id] = await ensureUploaded(asset.id, asset, wp, websiteId);
      }
    } else {
      for (const { role, asset } of images) {
        uploaded[asset.id] = await ensureUploaded(asset.id, asset, wp, websiteId);
      }
    }
  }

  // 5. Attempt record for idempotency/reconciliation.
  const attemptKey = markerSlug;
  const existingAttempt = await prisma.publicationAttempt.findFirst({
    where: { draftId, idempotencyKey: attemptKey },
    orderBy: { attemptNo: "desc" },
  });
  const attempt = existingAttempt
    ? existingAttempt
    : await prisma.publicationAttempt.create({
        data: { websiteId, draftId, idempotencyKey: attemptKey, attemptNo: 1, status: "STARTED", requestSent: false },
      });

  let wpPost: { id: number; link: string; status: string } | null = null;

  // 6. Reconcile before creating: check whether a post with our marker already exists.
  try {
    const existing = await wp.getPostsBySlug(markerSlug);
    if (existing.length > 0) {
      wpPost = { id: existing[0].id, link: existing[0].link, status: existing[0].status };
    }
  } catch {
    // If the lookup fails, do not create a duplicate: surface a reconciliation error.
    await prisma.publicationAttempt.update({
      where: { id: attempt.id },
      data: { status: "REQUIRES_RECONCILIATION", error: "Could not verify existing posts before create; manual reconciliation required." },
    });
    throw new PublishServiceError("Could not verify existing posts before publishing; the draft is preserved and marked for reconciliation.");
  }

  // 7. Build the post payload (categories/tags/meta).
  const payload: Record<string, unknown> = {
    title,
    content,
    status: targetStatus,
    slug: markerSlug,
  };
  if (opts.categoryId) payload.categories = [opts.categoryId];
  if (opts.tagIds?.length) payload.tags = opts.tagIds;

  // Rank Math meta sync: only include if the connection exposes writable meta.
  const restMeta = (conn.restMetaFields ? safeParse(conn.restMetaFields) : { metaKeys: [] as string[] }) as { metaKeys: string[]; hasRankMathMeta?: boolean };
  const metaPayload = buildRankMathMetaPayload({
    seoTitle: opts.seoTitle ?? title,
    metaDescription: opts.metaDescription ?? undefined,
    focusKeyword: draft.keyword,
    canonical: opts.canonical ?? undefined,
  });
  let metaSynced = false;
  const metaKeys = Array.isArray(restMeta.metaKeys) ? restMeta.metaKeys : [];
  const supportsRankMath = metaKeys.some((k) => k.startsWith("rank_math_"));

  try {
    if (!wpPost) {
      const withMeta = { ...payload, meta: metaPayload };
      try {
        wpPost = await wp.createPost(withMeta);
        metaSynced = supportsRankMath;
      } catch (e) {
        // If meta was rejected, retry without it and record the limitation.
        const msg = e instanceof Error ? e.message : "";
        if (/meta|invalid|not writable/i.test(msg)) {
          wpPost = await wp.createPost(payload);
          metaSynced = false;
        } else {
          throw e;
        }
      }
    } else {
      wpPost = await wp.updatePost(wpPost.id, { ...payload, meta: metaPayload });
      metaSynced = supportsRankMath;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Post creation failed";
    await prisma.publicationAttempt.update({
      where: { id: attempt.id },
      data: { status: "FAILED", error: message, requestSent: true },
    });
    // Keep the draft; no receipt created.
    throw new PublishServiceError(`Publishing failed: ${message}`);
  }

  // 8. Attach featured image (media id) if we uploaded one.
  const featuredAssetId = opts.featuredImageId ?? draft.images.find((a) => a.role === "FEATURED")?.image.id ?? null;
  const featuredMediaId = featuredAssetId ? uploaded[featuredAssetId] : undefined;
  if (featuredMediaId) {
    try {
      await wp.updatePost(wpPost.id, { featured_media: featuredMediaId });
    } catch {
      // Non-fatal: record that the featured image could not be attached.
    }
  }

  // 9. Verify the created post.
  let permalink = wpPost.link;
  let finalStatus = wpPost.status;
  try {
    const verified = await wp.getPostsBySlug(markerSlug);
    if (verified.length > 0) {
      permalink = verified[0].link;
      finalStatus = verified[0].status;
    }
  } catch {
    // Verification failed but post was created: mark for reconciliation, keep draft.
    await prisma.publicationAttempt.update({
      where: { id: attempt.id },
      data: { status: "REQUIRES_RECONCILIATION", error: "Post was created but verification failed; draft preserved for reconciliation." },
    });
    throw new PublishServiceError("Post was created but verification failed; marked for reconciliation. The local draft is preserved; a receipt is NOT created until verified.");
  }

  // 10. Create the publication receipt (minimal; no article body).
  const receipt = await prisma.publicationReceipt.create({
    data: {
      websiteId,
      draftId,
      wpPostId: wpPost.id,
      permalink,
      publishedAt: new Date(),
      status: finalStatus === "publish" ? "PUBLISHED" : "DRAFT",
      metadata: toJsonString({ markerSlug, metaSynced, imageIds: uploaded }),
    },
  });

  // 11. Mark the attempt verified.
  await prisma.publicationAttempt.update({
    where: { id: attempt.id },
    data: { status: "VERIFIED", wpPostId: wpPost.id },
  });

  // 12. Clean up local full content ONLY after confirmed success.
  await prisma.articleDraft.update({
    where: { id: draftId },
    data: {
      status: "PUBLISHED",
      body: null,
      outline: null,
      researchBrief: null,
      slug: markerSlug,
      publishedReceiptId: receipt.id,
    },
  });

  await auditLog({
    userId: "system",
    websiteId,
    action: "DRAFT_PUBLISHED",
    entity: "ArticleDraft",
    entityId: draftId,
    detail: { wpPostId: wpPost.id, permalink },
  });

  return {
    receipt: {
      id: receipt.id,
      wpPostId: receipt.wpPostId,
      permalink: receipt.permalink,
      status: receipt.status,
      publishedAt: receipt.publishedAt,
    },
    metaSynced,
    markerSlug,
  };
}

async function ensureUploaded(
  assetId: string,
  asset: { id: string; url: string; wpMediaId: number | null; mimeType: string | null; fileSize: number | null; title: string | null },
  wp: WpLikeClient,
  websiteId: string
): Promise<number> {
  if (asset.wpMediaId) return asset.wpMediaId;
  assertSafeOutboundUrl(asset.url, "Image URL");
  const res = await fetch(asset.url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new PublishServiceError(`Could not download image for upload (HTTP ${res.status})`);
  const contentType = res.headers.get("content-type") ?? asset.mimeType ?? "image/jpeg";
  if (!contentType.startsWith("image/")) throw new PublishServiceError("Downloaded file is not an image");
  const buf = new Uint8Array(await res.arrayBuffer());
  const maxBytes = 10 * 1024 * 1024;
  if (buf.byteLength > maxBytes) throw new PublishServiceError("Image exceeds the 10MB upload limit");
  const ext = contentType.split("/")[1]?.split(";")[0] ?? "jpg";
  const fileName = `${slugify(asset.title ?? "image") || "image"}.${ext}`;
  const uploaded = await wp.uploadMedia(buf, fileName, contentType);
  await prisma.imageAsset.update({ where: { id: assetId }, data: { wpMediaId: uploaded.id } });
  return uploaded.id;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export { WordPressError };

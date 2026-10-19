import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { publishDraft, PublishServiceError, type WpLikeClient } from "@/server/wordpress/publish.service";
import { createDraft, updateDraft } from "@/server/article.service";
import { updateWordpress } from "@/server/settings.service";
import { resetDb, createTestAdmin, createTestSite } from "./helpers";

interface FakeWpOptions {
  preexistingSlug?: boolean;
  throwOnCreate?: boolean;
  recordOnCreateDespiteError?: boolean;
  throwOnVerifyCall?: number; // 1-based index of getPostsBySlug call to throw on
}
type WpPost = { id: number; slug: string; link: string; status: string };
function fakeWp(opts: FakeWpOptions = {}, shared?: Record<string, WpPost>) {
  const posts: Record<string, WpPost> = shared ?? {};
  let nextId = 1000;
  let getCalls = 0;
  const state = { createCalls: 0, updateCalls: 0, uploadCalls: 0 };
  const client: WpLikeClient & { state: typeof state } = {
    state,
    async getPostsBySlug(slug) {
      getCalls++;
      if (opts.throwOnVerifyCall && getCalls === opts.throwOnVerifyCall) throw new Error("verify down");
      return posts[slug] ? [posts[slug]] : [];
    },
    async createPost(payload) {
      state.createCalls++;
      const post: WpPost = { id: nextId++, slug: payload.slug as string, link: `https://example.com/${payload.slug}/`, status: payload.status as string };
      posts[payload.slug as string] = post;
      if (opts.throwOnCreate) throw new Error("connection reset"); // post created server-side but client saw an error
      return post;
    },
    async updatePost(id, payload) {
      state.updateCalls++;
      const post = posts[payload.slug as string] ?? { id, slug: payload.slug as string, link: "", status: payload.status as string };
      post.status = payload.status as string;
      posts[payload.slug as string] = post;
      return post;
    },
    async uploadMedia() {
      state.uploadCalls++;
      return { id: 500, source_url: "https://example.com/wp-content/x.jpg" };
    },
  };
  return client;
}

describe("WordPress publishing", () => {
  let admin: { id: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
    await updateWordpress(siteId, { siteUrl: "https://example.com", username: "u", appPassword: "secret-pass" }, admin.id);
  });

  async function makeDraft(title = "Best Rafting Rivers") {
    const draft = await createDraft(siteId, { title, keyword: "rafting" }, admin.id);
    await updateDraft(siteId, draft.id, { body: "# Best Rafting Rivers\n\nIntro about rafting.\n\n## Safety\nWear a helmet." }, admin.id);
    return draft.id;
  }

  it("publishes, creates a receipt, and cleans up local content after success", async () => {
    const draftId = await makeDraft();
    const wp = fakeWp();
    const res = await publishDraft(siteId, draftId, { force: true, status: "publish" }, wp);

    expect(res.receipt.wpPostId).toBe(1000);
    expect(res.receipt.permalink).toContain("best-rafting-rivers");
    const draft = await prisma.articleDraft.findUnique({ where: { id: draftId } });
    expect(draft?.status).toBe("PUBLISHED");
    expect(draft?.body).toBeNull(); // full content removed locally
    expect(draft?.outline).toBeNull();
    expect(draft?.publishedReceiptId).toBe(res.receipt.id);
    const receipt = await prisma.publicationReceipt.findUnique({ where: { id: res.receipt.id } });
    expect(receipt?.wpPostId).toBe(1000);
    expect(receipt?.status).toBe("PUBLISHED");
    const attempt = await prisma.publicationAttempt.findFirst({ where: { draftId } });
    expect(attempt?.status).toBe("VERIFIED");
  });

  it("does not re-publish an already-published draft", async () => {
    const draftId = await makeDraft();
    await publishDraft(siteId, draftId, { force: true }, fakeWp());
    await expect(publishDraft(siteId, draftId, { force: true }, fakeWp())).rejects.toThrow(/already published/);
  });

  it("reconciles with an existing post instead of creating a duplicate", async () => {
    const draftId = await makeDraft();
    const marker = `${"best-rafting-rivers"}-${draftId.slice(-8)}`;
    const client = fakeWp();
    // Simulate an existing post by recording it under the marker before publishing.
    await client.createPost({ slug: marker, status: "draft" });
    client.state.createCalls = 0;
    const res = await publishDraft(siteId, draftId, { force: true }, client);
    expect(client.state.createCalls).toBe(0); // no duplicate post created
    expect(client.state.updateCalls).toBe(1); // updated the existing post
    expect(res.receipt.wpPostId).toBe(1000);
  });

  it("recovers from a timeout without duplicating the post", async () => {
    const draftId = await makeDraft();
    const sharedStore: Record<string, WpPost> = {};

    // First attempt: createPost throws (as if the connection reset), but the
    // post actually got created server-side (recorded in the shared store).
    const first = fakeWp({ throwOnCreate: true, recordOnCreateDespiteError: true }, sharedStore);
    await expect(publishDraft(siteId, draftId, { force: true }, first)).rejects.toThrow(PublishServiceError);

    // Draft must be preserved (not published, body intact, no receipt).
    let draft = await prisma.articleDraft.findUnique({ where: { id: draftId } });
    expect(draft?.status).not.toBe("PUBLISHED");
    expect(draft?.body).toContain("helmet");
    expect(await prisma.publicationReceipt.count({ where: { draftId } })).toBe(0);

    // Retry shares the same store: reconciliation finds the existing post and
    // updates it (no new create).
    const retry = fakeWp({}, sharedStore);
    const res = await publishDraft(siteId, draftId, { force: true }, retry);
    expect(retry.state.createCalls).toBe(0); // no duplicate created
    expect(retry.state.updateCalls).toBe(1);
    expect(res.receipt.wpPostId).toBe(1000);
    draft = await prisma.articleDraft.findUnique({ where: { id: draftId } });
    expect(draft?.status).toBe("PUBLISHED");
    expect(draft?.body).toBeNull();
  });

  it("marks verification failure as REQUIRES_RECONCILIATION and preserves the draft", async () => {
    const draftId = await makeDraft();
    // First getPostsBySlug (reconcile) returns []; createPost succeeds; the
    // second getPostsBySlug (verification) throws.
    const wp = fakeWp({ throwOnVerifyCall: 2 });
    await expect(publishDraft(siteId, draftId, { force: true }, wp)).rejects.toThrow(/reconciliation/i);
    const draft = await prisma.articleDraft.findUnique({ where: { id: draftId } });
    expect(draft?.status).not.toBe("PUBLISHED");
    expect(draft?.body).toContain("helmet"); // preserved
    expect(await prisma.publicationReceipt.count({ where: { draftId } })).toBe(0);
    const attempt = await prisma.publicationAttempt.findFirst({ where: { draftId } });
    expect(attempt?.status).toBe("REQUIRES_RECONCILIATION");
  });

  it("blocks publishing when mandatory SEO checks fail (unless forced)", async () => {
    const created = await createDraft(siteId, { title: "No structure", keyword: "k" }, admin.id);
    const draftId = created.id;
    await updateDraft(siteId, draftId, { body: "no headings here" }, admin.id); // no H1
    const wp = fakeWp();
    await expect(publishDraft(siteId, draftId, {}, wp)).rejects.toThrow(/Mandatory SEO/);
    // No post created, no receipt.
    expect(wp.state.createCalls).toBe(0);
    expect(await prisma.publicationReceipt.count()).toBe(0);
    // Forcing bypasses the block.
    const res = await publishDraft(siteId, draftId, { force: true }, fakeWp());
    expect(res.receipt.wpPostId).toBeTruthy();
  });

  it("synchronizes Rank Math meta when the site exposes it", async () => {
    await prisma.wordPressConnection.update({
      where: { websiteId: siteId },
      data: { restMetaFields: JSON.stringify({ metaKeys: ["rank_math_title", "rank_math_description"] }) },
    });
    const draftId = await makeDraft();
    const wp = fakeWp();
    const res = await publishDraft(siteId, draftId, { force: true, seoTitle: "Rank Math Title", metaDescription: "Desc" }, wp);
    expect(res.metaSynced).toBe(true);
  });

  it("recovers when meta is rejected, retrying without it", async () => {
    await prisma.wordPressConnection.update({
      where: { websiteId: siteId },
      data: { restMetaFields: JSON.stringify({ metaKeys: ["rank_math_title"] }) },
    });
    const draftId = await makeDraft();
    // Custom client that rejects posts whose payload includes meta.
    const base = fakeWp();
    const client = {
      ...base,
      async createPost(payload: Record<string, unknown>) {
        if (payload.meta) throw new Error("Sorry, you are not allowed to create this post with meta");
        return base.createPost(payload);
      },
      async updatePost(id: number, payload: Record<string, unknown>) {
        if (payload.meta) throw new Error("meta not writable");
        return base.updatePost(id, payload);
      },
    };
    const res = await publishDraft(siteId, draftId, { force: true, seoTitle: "T" }, client);
    expect(res.metaSynced).toBe(false);
    expect(res.receipt.wpPostId).toBeTruthy();
  });

  it("is scoped to the site (isolation)", async () => {
    const other = (await createTestSite("Other", "other.com")).id;
    await updateWordpress(other, { siteUrl: "https://example.org", username: "u", appPassword: "p" }, admin.id);
    const draftId = await makeDraft(); // on siteId, no connection on siteId? siteId has one
    await expect(publishDraft(other, draftId, { force: true }, fakeWp())).rejects.toThrow(/Draft not found|connection/i);
  });
});

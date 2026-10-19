import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createDraft,
  getDraft,
  listDrafts,
  updateDraft,
  deleteDraft,
  generateOutline,
  generateArticle,
  ArticleServiceError,
  type AIClient,
} from "@/server/article.service";
import { updateAiConfig, updateGuidelines } from "@/server/settings.service";
import { OpenRouterError } from "@/server/openrouter";
import { resetDb, createTestAdmin, createTestSite } from "./helpers";

// Fake AI client: returns outline JSON or article markdown without network.
function fakeAI(): AIClient & { calls: { model: string; system: string; user: string }[] } {
  const calls: { model: string; system: string; user: string }[] = [];
  const client: AIClient = {
    async call(input) {
      calls.push({ model: input.model, system: input.messages[0].content, user: input.messages[1].content });
      const user = input.messages[1].content;
      if (user.includes("Create a detailed article outline")) {
        return '{"sections":[{"heading":"Intro","level":2,"points":["Hook"]},{"heading":"Safety","level":2,"points":["Gear"]}]}';
      }
      return "## Intro\nGreat content here.\n\n## Safety\nWear a helmet.\n";
    },
  };
  return { ...client, calls };
}

describe("article studio & drafts", () => {
  let admin: { id: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
    await updateGuidelines(siteId, { brandVoice: "Adventurous", customInstructions: "Never invent stats" }, admin.id);
    await updateAiConfig(siteId, { apiKey: "sk-or-test-key", preferredModel: "openai/gpt-4o", writingModel: "openai/gpt-4o", fallbackModel: "openai/gpt-4o-mini" }, admin.id);
  });

  it("creates, lists, updates and deletes a draft", async () => {
    const draft = await createDraft(siteId, { title: "Best rafting rivers", keyword: "rafting" }, admin.id);
    expect(draft.title).toBe("Best rafting rivers");
    expect((await listDrafts(siteId, {})).total).toBe(1);
    const updated = await updateDraft(siteId, draft.id, { body: "Hello world" }, admin.id);
    expect(updated.body).toBe("Hello world");
    await deleteDraft(siteId, draft.id, admin.id);
    expect((await listDrafts(siteId, {})).total).toBe(0);
  });

  it("captures revisions on body edits", async () => {
    const draft = await createDraft(siteId, { title: "T" }, admin.id);
    await updateDraft(siteId, draft.id, { body: "v1" }, admin.id);
    await updateDraft(siteId, draft.id, { body: "v2" }, admin.id);
    const loaded = await getDraft(siteId, draft.id);
    expect(loaded?.revisions).toHaveLength(2);
    expect(loaded?.revisions[0].body).toBe("v2");
  });

  it("generates an outline via the AI client and stores it", async () => {
    const draft = await createDraft(siteId, { title: "Rafting safety", keyword: "rafting safety" }, admin.id);
    const ai = fakeAI();
    const { outline } = await generateOutline(siteId, draft.id, admin.id, ai);
    expect(outline).toHaveLength(2);
    expect(outline[1].heading).toBe("Safety");
    const stored = await getDraft(siteId, draft.id);
    expect(stored?.status).toBe("OUTLINE");
    expect(stored?.outline).toContain("Safety");
    // The prompt carried the site's guidelines.
    expect(ai.calls[0].system).toContain("Adventurous");
    expect(ai.calls[0].system).toContain("White Rafting");
  });

  it("generates an article (ensuring an outline first) and saves the body as DRAFT", async () => {
    const draft = await createDraft(siteId, { title: "Rafting guide", keyword: "rafting" }, admin.id);
    const ai = fakeAI();
    const { body } = await generateArticle(siteId, draft.id, admin.id, ai);
    expect(body).toContain("helmet");
    const stored = await getDraft(siteId, draft.id);
    expect(stored?.status).toBe("DRAFT");
    expect(stored?.body).toContain("helmet");
    expect(stored?.outline).toContain("Safety");
  });

  it("fails clearly when no API key is configured", async () => {
    const other = (await createTestSite("Other", "other.com")).id;
    await updateAiConfig(other, { preferredModel: "openai/gpt-4o" }, admin.id); // no apiKey
    const draft = await createDraft(other, { title: "X", keyword: "x" }, admin.id);
    await expect(generateOutline(other, draft.id, admin.id, fakeAI())).rejects.toThrow(OpenRouterError);
  });

  it("enforces site isolation for drafts", async () => {
    const a = (await createTestSite("A", "a.com")).id;
    const b = (await createTestSite("B", "b.com")).id;
    const draft = await createDraft(a, { title: "Secret A draft", keyword: "a" }, admin.id);
    // B cannot read, update, or delete A's draft.
    expect(await getDraft(b, draft.id)).toBeNull();
    await expect(updateDraft(b, draft.id, { title: "x" }, admin.id)).rejects.toThrow(ArticleServiceError);
    await expect(deleteDraft(b, draft.id, admin.id)).rejects.toThrow(ArticleServiceError);
    // A still sees it.
    expect(await getDraft(a, draft.id)).not.toBeNull();
  });

  it("draft data is not shared between sites (isolation of content)", async () => {
    const a = (await createTestSite("A", "a.com")).id;
    const b = (await createTestSite("B", "b.com")).id;
    await createDraft(a, { title: "A-only", keyword: "a", body: "body A" } as never, admin.id);
    const listB = await listDrafts(b, {});
    expect(listB.total).toBe(0);
    const listA = await listDrafts(a, {});
    expect(listA.total).toBe(1);
  });
});

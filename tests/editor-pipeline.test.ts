import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createDraft, getDraft, updateDraft, generateArticle, improveText, type AIClientDetailed } from "@/server/article.service";
import { updateAiConfig, updateWordpress } from "@/server/settings.service";
import { publishDraft, type WpLikeClient } from "@/server/wordpress/publish.service";
import { requireSitePermission, AccessDeniedError } from "@/lib/access";
import { analyzeDraft } from "@/server/seo.service";
import { debounce } from "@/lib/debounce";
import {
  looksLikeMarkdown,
  looksLikeHtml,
  markdownToHtml,
  sanitizeHtml,
  toEditorHtml,
  htmlToText,
} from "@/lib/markup";
import { resetDb, createTestAdmin, createTestSite, createTestUser } from "./helpers";

// ---------------------------------------------------------------------------
// Markup conversion + sanitization (free, open-source: marked + sanitize-html)
// ---------------------------------------------------------------------------

describe("markup conversion and sanitization", () => {
  it("detects legacy markdown vs HTML bodies", () => {
    expect(looksLikeMarkdown("# H1\n\nBody.\n\n## H2")).toBe(true);
    expect(looksLikeMarkdown("**bold** and [link](https://x.com)")).toBe(true);
    expect(looksLikeMarkdown("- item\n- item")).toBe(true);
    expect(looksLikeMarkdown("1. one\n2. two")).toBe(true);
    expect(looksLikeMarkdown("> quote")).toBe(true);
    expect(looksLikeMarkdown("```\ncode\n```")).toBe(true);
    expect(looksLikeMarkdown("<h1>Hi</h1><p>Body</p>")).toBe(false);
    expect(looksLikeMarkdown("plain text only")).toBe(false);
    expect(looksLikeMarkdown("")).toBe(false);
    expect(looksLikeHtml("<h1>Hi</h1><p>Body</p>")).toBe(true);
    expect(looksLikeHtml("## Not html")).toBe(false);
  });

  it("converts markdown to sanitized HTML (headings, bold, links, lists, code, quotes)", () => {
    const md = [
      "# Best Rivers",
      "",
      "An **honest** intro with [a link](https://example.com/gear).",
      "",
      "## Safety",
      "- Wear a helmet",
      "- Check the weather",
      "",
      "> Plan ahead.",
      "",
      "```ts\nconst x = 1;\n```",
    ].join("\n");
    const html = markdownToHtml(md);
    expect(html).toContain("<h1>Best Rivers</h1>");
    expect(html).toContain("<h2>Safety</h2>");
    expect(html).toContain("<p>An <strong>honest</strong> intro with");
    expect(html).toContain('href="https://example.com/gear"');
    expect(html).toContain(">a link</a>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>Wear a helmet</li>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<pre><code>");
  });

  it("never lets dangerous markup survive markdown conversion", () => {
    const html = markdownToHtml("Hello <script>alert(1)</script>\n\n<img src=x onerror=alert(2)>");
    expect(html).not.toContain("alert");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });

  it("strips scripts, iframes and event handlers on sanitize", () => {
    const dirty =
      '<p onclick="steal()">Safe text</p><script>alert(1)</script><iframe src="https://evil.example"></iframe>' +
      '<a href="javascript:alert(1)">bad link</a><img src="https://x/y.png" onerror="x()">';
    const clean = sanitizeHtml(dirty);
    expect(clean).toContain("Safe text");
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("alert");
    expect(clean).not.toContain("<iframe");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("steal");
    expect(clean).not.toContain("javascript:");
    expect(clean).toContain("<img");
  });

  it("normalizes any body shape for the editor (toEditorHtml)", () => {
    expect(toEditorHtml("## Legacy\n\n**md**")).toContain("<h2>Legacy</h2>");
    expect(toEditorHtml("<h2>Already html</h2>")).toBe("<h2>Already html</h2>");
    expect(toEditorHtml("plain text")).toBe("plain text");
    expect(toEditorHtml(null)).toBe("");
  });

  it("extracts readable text from HTML for stats", () => {
    const t = htmlToText("<h1>Title</h1><p>Two words.</p>");
    expect(t.replace(/\s+/g, " ").trim()).toContain("Two words");
  });
});

// ---------------------------------------------------------------------------
// Content persistence: HTML bodies, revisions, legacy markdown migration
// ---------------------------------------------------------------------------

describe("editor content persistence", () => {
  let admin: { id: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
    await updateAiConfig(siteId, { apiKey: "sk-or-test-key", preferredModel: "openai/gpt-4o", writingModel: "openai/gpt-4o" }, admin.id);
  });

  it("persists sanitized HTML bodies and captures a revision", async () => {
    const draft = await createDraft(siteId, { title: "Persistence" }, admin.id);
    const html = "<h1>Persistence</h1><p>Body <script>alert(1)</script>saved.</p>";
    await updateDraft(siteId, draft.id, { body: html }, admin.id);

    const stored = await prisma.articleDraft.findUnique({ where: { id: draft.id } });
    expect(stored?.body).toContain("<h1>Persistence</h1>");
    expect(stored?.body).not.toContain("<script");
    expect(stored?.body).not.toContain("alert");

    const loaded = await getDraft(siteId, draft.id);
    expect(loaded?.body).toContain("<h1>Persistence</h1>");
    expect(loaded?.revisions).toHaveLength(1);
    expect(loaded?.revisions[0].body).toContain("<h1>Persistence</h1>");
  });

  it("converts legacy markdown bodies to HTML on read without mutating the database", async () => {
    const draft = await createDraft(siteId, { title: "Legacy" }, admin.id);
    // Simulate a draft stored before the editor upgrade (raw markdown).
    await prisma.articleDraft.update({ where: { id: draft.id }, data: { body: "# Legacy Title\n\nOld **markdown** body.\n\n## Section\nText." } });

    const loaded = await getDraft(siteId, draft.id);
    expect(loaded?.body).toContain("<h1>Legacy Title</h1>");
    expect(loaded?.body).toContain("<h2>Section</h2>");
    expect(loaded?.body).toContain("<strong>markdown</strong>");

    // Database copy is untouched until the user saves.
    const stillRaw = await prisma.articleDraft.findUnique({ where: { id: draft.id } });
    expect(stillRaw?.body).toContain("# Legacy Title");
  });

  it("saves AI-generated articles as sanitized HTML (editor-ready)", async () => {
    const draft = await createDraft(siteId, { title: "Rafting guide", keyword: "rafting" }, admin.id);
    const ai: AIClientDetailed = {
      async call() {
        return "## Intro\nGreat content here.\n\n## Safety\nWear a helmet.\n";
      },
      async callDetailed() {
        return { content: "## Intro\nGreat content here.\n\n## Safety\nWear a helmet.\n", model: "openai/gpt-4o", usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }, costCents: 1 };
      },
    };
    const { body } = await generateArticle(siteId, draft.id, admin.id, ai as never);
    expect(body).toContain("<h2>Intro</h2>");
    expect(body).toContain("helmet");

    const stored = await getDraft(siteId, draft.id);
    expect(stored?.status).toBe("DRAFT");
    expect(stored?.body).toContain("<h2>Safety</h2>");
    expect(stored?.body).toContain("helmet");
  });

  it("keeps plain-text bodies working (no regression)", async () => {
    const draft = await createDraft(siteId, { title: "Plain" }, admin.id);
    await updateDraft(siteId, draft.id, { body: "Hello world" }, admin.id);
    const loaded = await getDraft(siteId, draft.id);
    expect(loaded?.body).toBe("Hello world");
  });
});

// ---------------------------------------------------------------------------
// Autosave debounce (data-loss protection)
// ---------------------------------------------------------------------------

describe("autosave debounce", () => {
  it("coalesces rapid changes into a single trailing save", () => {
    vi.useFakeTimers();
    try {
      const saves: string[] = [];
      const d = debounce((x: string) => saves.push(x), 250);
      d.run("a");
      d.run("b");
      d.run("c");
      expect(saves).toHaveLength(0);
      vi.advanceTimersByTime(249);
      expect(saves).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(saves).toEqual(["c"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("can be cancelled (draft switch during a pending save)", () => {
    vi.useFakeTimers();
    try {
      const saves: string[] = [];
      const d = debounce((x: string) => saves.push(x), 250);
      d.run("stale");
      d.cancel();
      vi.advanceTimersByTime(500);
      expect(saves).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Permission re-checks for editing and AI actions
// ---------------------------------------------------------------------------

describe("editor permission enforcement", () => {
  let admin: { id: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
  });

  it("denies members without a membership (deny by default)", async () => {
    const member = await createTestUser();
    await expect(requireSitePermission(member.id, siteId, "drafts.edit")).rejects.toThrow(AccessDeniedError);
    await expect(requireSitePermission(member.id, siteId, "drafts.generate")).rejects.toThrow(AccessDeniedError);
  });

  it("allows after an ADMIN role is granted", async () => {
    const member = await createTestUser();
    await prisma.websiteUserRole.create({ data: { userId: member.id, websiteId: siteId, role: "ADMIN", canPublish: true } });
    await expect(requireSitePermission(member.id, siteId, "drafts.edit")).resolves.toBeTruthy();
    await expect(requireSitePermission(member.id, siteId, "drafts.generate")).resolves.toBeTruthy();
  });

  it("scopes AI text actions to the draft's website", async () => {
    const other = (await createTestSite("Other", "other.com")).id;
    const draft = await createDraft(siteId, { title: "Isolated", keyword: "k" }, admin.id);
    await expect(improveText(other, draft.id, { mode: "improve", selection: "abc" }, admin.id)).rejects.toThrow(/not found|No OpenRouter/i);
  });
});

// ---------------------------------------------------------------------------
// In-editor AI action: selection-only, never whole-article replacement
// ---------------------------------------------------------------------------

describe("in-editor AI text actions", () => {
  let admin: { id: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
    await updateAiConfig(siteId, { apiKey: "sk-or-test-key", preferredModel: "openai/gpt-4o", writingModel: "openai/gpt-4o" }, admin.id);
  });

  it("returns replacement text for the selection only and never touches the draft body", async () => {
    const draft = await createDraft(siteId, { title: "AI edit", keyword: "rafting" }, admin.id);
    await updateDraft(siteId, draft.id, { body: "<h1>Title</h1><p>Original selection worth keeping.</p>" }, admin.id);

    const ai: AIClientDetailed = {
      async call() {
        return "";
      },
      async callDetailed() {
        return { content: "Polished selection.", model: "openai/gpt-4o", usage: { promptTokens: 40, completionTokens: 8, totalTokens: 48 }, costCents: 2 };
      },
    };
    const res = await improveText(siteId, draft.id, { mode: "improve", selection: "Original selection worth keeping." }, admin.id, ai as never);
    expect(res.text).toBe("Polished selection.");
    expect(res.mode).toBe("improve");

    // The service never rewrites the article; the client replaces only the
    // selected range.
    const after = await prisma.articleDraft.findUnique({ where: { id: draft.id } });
    expect(after?.body).toContain("Original selection worth keeping.");

    // Usage is recorded (model + tokens + cost; no content/secrets).
    const usage = await prisma.usageRecord.findFirst({ where: { draftId: draft.id, task: "AI_TEXT_IMPROVE" } });
    expect(usage?.model).toBe("openai/gpt-4o");
    expect(usage?.totalTokens).toBe(48);
    expect(usage?.costCents).toBe(2);
  });

  it("rejects empty selections", async () => {
    const draft = await createDraft(siteId, { title: "AI edit 2" }, admin.id);
    await expect(improveText(siteId, draft.id, { mode: "regenerate", selection: "   " }, admin.id)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SEO analysis on HTML bodies (editor format)
// ---------------------------------------------------------------------------

describe("SEO analysis on HTML bodies", () => {
  let admin: { id: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
  });

  it("analyzes HTML bodies (headings, links, word count)", async () => {
    const draft = await createDraft(siteId, { title: "Best Rafting Rivers", keyword: "rafting" }, admin.id);
    const html =
      "<h1>Best Rafting Rivers in Idaho</h1>" +
      "<p>Planning a rafting trip? This guide covers the best rivers.</p>" +
      "<h2>Safety Gear</h2><p>Wear a helmet and <a href=\"/gear\">read our gear guide</a>.</p>" +
      "<h2>Local Guides</h2><p>Check <a href=\"https://parks.example.gov\">the park site</a>.</p>";
    await updateDraft(siteId, draft.id, { body: html, slug: "best-rafting-rivers" }, admin.id);
    const r = await analyzeDraft(siteId, draft.id, { metaDescription: "A practical guide." });
    expect(r.checks.find((c) => c.id === "single_h1")?.status).toBe("pass");
    expect(r.checks.find((c) => c.id === "h2_structure")?.status).toBe("pass");
    expect(r.checks.find((c) => c.id === "internal_links")?.status).toBe("pass");
    expect(r.mandatoryFailed).toBe(false);
  });

  it("fails mandatory H1 check for HTML without an H1", async () => {
    const draft = await createDraft(siteId, { title: "No structure", keyword: "k" }, admin.id);
    await updateDraft(siteId, draft.id, { body: "<p>Plain paragraph body with no headings.</p>" }, admin.id);
    const r = await analyzeDraft(siteId, draft.id, {});
    expect(r.checks.find((c) => c.id === "single_h1")?.status).toBe("fail");
    expect(r.mandatoryFailed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WordPress export compatibility
// ---------------------------------------------------------------------------

describe("WordPress output compatibility", () => {
  let admin: { id: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
    await updateWordpress(siteId, { siteUrl: "https://example.com", username: "u", appPassword: "secret-pass" }, admin.id);
  });

  function recorderWp() {
    const payloads: Record<string, unknown>[] = [];
    const client: WpLikeClient & { payloads: typeof payloads } = {
      payloads,
      async getPostsBySlug() {
        return [];
      },
      async createPost(payload) {
        payloads.push(payload);
        return { id: 900, link: "https://example.com/p/", slug: payload.slug as string, status: payload.status as string };
      },
      async updatePost(id, payload) {
        payloads.push(payload);
        return { id, link: "https://example.com/p/", slug: payload.slug as string, status: payload.status as string };
      },
      async uploadMedia() {
        return { id: 1, source_url: "https://example.com/x.jpg" };
      },
    };
    return client;
  }

  it("sends editor HTML bodies to WordPress verbatim (no raw markdown)", async () => {
    const draft = await createDraft(siteId, { title: "Best Rivers", keyword: "rafting" }, admin.id);
    await updateDraft(siteId, draft.id, { body: "<h1>Best Rivers</h1><p>Intro.</p><h2>Safety</h2><p>Wear a helmet.</p>" }, admin.id);
    const wp = recorderWp();
    await publishDraft(siteId, draft.id, { force: true }, wp);
    const content = String(wp.payloads[0]?.content ?? "");
    expect(content).toContain("<h2>Safety</h2>");
    expect(content).not.toMatch(/^#\s/);
  });

  it("converts legacy markdown bodies to HTML before sending", async () => {
    const draft = await createDraft(siteId, { title: "Legacy Rivers", keyword: "rafting" }, admin.id);
    await updateDraft(siteId, draft.id, { body: "# Legacy Rivers\n\nIntro paragraph.\n\n## Safety\nWear a helmet." }, admin.id);
    const wp = recorderWp();
    await publishDraft(siteId, draft.id, { force: true }, wp);
    const content = String(wp.payloads[0]?.content ?? "");
    expect(content).toContain("<h1>Legacy Rivers</h1>");
    expect(content).toContain("<h2>Safety</h2>");
    expect(content).not.toContain("\n# Legacy Rivers");
  });

  it("never exports unsanitized markup even if stored data is dirty", async () => {
    const draft = await createDraft(siteId, { title: "Dirty", keyword: "k" }, admin.id);
    // Bypass the sanitizing service layer to simulate legacy/imported data.
    await prisma.articleDraft.update({
      where: { id: draft.id },
      data: { body: "<h1>Dirty</h1><p>Fine.</p><script>alert(1)</script>" },
    });
    const wp = recorderWp();
    await publishDraft(siteId, draft.id, { force: true }, wp);
    const content = String(wp.payloads[0]?.content ?? "");
    expect(content).not.toContain("<script");
    expect(content).not.toContain("alert");
  });
});
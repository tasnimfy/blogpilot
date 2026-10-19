"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Button, Card, Input, Badge, EmptyState, Alert, Textarea } from "@/components/ui";
import { SiteSelect } from "@/components/SiteSelect";
import { useAutosave } from "@/components/editor/useAutosave";
import type { AiEditRequest, AiEditResponse } from "@/components/editor/RichTextEditor";

// The rich-text editor and preview are client-only (Tiptap needs a DOM).
const RichTextEditor = dynamic(() => import("@/components/editor/RichTextEditor").then((m) => m.RichTextEditor), { ssr: false });
const ArticlePreview = dynamic(() => import("@/components/editor/ArticlePreview").then((m) => m.ArticlePreview), { ssr: false });

interface Site {
  id: string;
  name: string;
  domain: string;
}
interface DraftRow {
  id: string;
  title: string;
  keyword: string | null;
  status: string;
  outlineApproved: boolean;
  updatedAt: string;
  language: string | null;
  _count: { revisions: number };
}
interface Draft {
  id: string;
  title: string;
  keyword: string | null;
  slug: string | null;
  status: string;
  articleType: string | null;
  targetLength: number | null;
  language: string | null;
  body: string | null;
  outline: string | null;
  outlineApproved: boolean;
  notes: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  relatedKeywords: string | null;
  opportunity: { id: string; title: string; keyword: string | null } | null;
  revisions: { id: string; version: number; body: string }[];
}

type EditorView = "edit" | "preview";

const AUTOSAVE_DELAY_MS = 1200;

export default function ArticleStudioPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [view, setView] = useState<EditorView>("edit");
  const [newTitle, setNewTitle] = useState("");
  const [newKeyword, setNewKeyword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [tagPreview, setTagPreview] = useState<{ text: string; warnings: string[] } | null>(null);
  const [publishResult, setPublishResult] = useState<string | null>(null);

  // Autosave targets the draft that was open when the save fires (a draft may
  // change while a debounced save is pending).
  const draftIdRef = useRef<string | null>(null);
  useEffect(() => {
    draftIdRef.current = draft?.id ?? null;
  }, [draft]);

  const autosave = useAutosave<{ body: string }>({
    delayMs: AUTOSAVE_DELAY_MS,
    onSave: async (patch) => {
      const id = draftIdRef.current;
      if (!id || !siteId) return;
      const res = await fetch(`/api/websites/${siteId}/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Draft could not be saved");
      }
      // Refresh the list so ordering reflects the save time.
      loadDrafts(siteId);
    },
  });

  async function publish(force = false) {
    if (!draft) return;
    if (!confirm(force ? "Publish despite mandatory SEO failures? This is an explicit override." : "Publish this draft to WordPress? This sends the resolved content to the connected site.")) return;
    setError(null); setPublishResult(null); setBusy(true);
    const res = await fetch(`/api/websites/${siteId}/drafts/${draft.id}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "publish", force }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) setError(data.error);
    else {
      setPublishResult(`Published to WordPress (post #${data.receipt.wpPostId}): ${data.receipt.permalink}`);
      openDraft(draft.id);
      loadDrafts(siteId!);
    }
  }

  const loadSites = useCallback(async () => {
    const res = await fetch("/api/websites");
    const data = await res.json();
    setSites(data.sites || []);
    if (data.sites?.length && !siteId) setSiteId(data.sites[0].id);
  }, [siteId]);
  useEffect(() => { loadSites(); }, [loadSites]);

  const loadDrafts = useCallback(async (id: string) => {
    const res = await fetch(`/api/websites/${id}/drafts`);
    const data = await res.json();
    setDrafts(data.items || []);
  }, []);
  useEffect(() => {
    if (siteId) {
      loadDrafts(siteId!);
      setActiveId(null);
      setDraft(null);
      setView("edit");
    }
  }, [siteId, loadDrafts]);

  const openDraft = useCallback(async (id: string) => {
    setActiveId(id);
    setView("edit");
    const res = await fetch(`/api/websites/${siteId}/drafts/${id}`);
    const data = await res.json();
    setDraft(data.draft || null);
  }, [siteId]);
  useEffect(() => {
    if (activeId) openDraft(activeId);
  }, [activeId, openDraft]);

  async function create() {
    if (!newTitle.trim()) return;
    setError(null);
    const res = await fetch(`/api/websites/${siteId}/drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle, keyword: newKeyword || null }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error);
    else {
      setNewTitle("");
      setNewKeyword("");
      loadDrafts(siteId!);
      setActiveId(data.draft.id);
    }
  }

  async function saveDraft(patch: Record<string, unknown>) {
    if (!draft) return;
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/websites/${siteId}/drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error);
    else {
      setNotice("Draft saved.");
      setDraft(data.draft);
      loadDrafts(siteId!);
    }
  }

  async function generate(kind: "outline" | "article") {
    if (!draft) return;
    setBusy(true); setError(null); setNotice(null);
    const res = await fetch(`/api/websites/${siteId}/drafts/${draft.id}/${kind}`, { method: "POST" });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) setError(data.error);
    else {
      setNotice(kind === "outline" ? "Outline generated." : "Article generated.");
      openDraft(draft.id);
      loadDrafts(siteId!);
    }
  }

  // In-editor AI action: server replaces ONLY the selected range; the rest of
  // the article is never silently touched.
  const handleAiEdit = useCallback(async (req: AiEditRequest): Promise<AiEditResponse> => {
    if (!draft) return { error: "No draft open" };
    const res = await fetch(`/api/websites/${siteId}/drafts/${draft.id}/ai-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error ?? "AI action failed" };
    return { text: data.text };
  }, [draft, siteId]);

  function saveSeo() {
    if (!draft) return;
    saveDraft({
      title: draft.title,
      keyword: draft.keyword,
      metaTitle: draft.metaTitle,
      metaDescription: draft.metaDescription,
      relatedKeywords: draft.relatedKeywords,
    });
  }

  async function previewTags() {
    if (!draft) return;
    const res = await fetch(`/api/websites/${siteId}/dynamic-tags/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: tagInput || draft.title }),
    });
    const data = await res.json();
    setTagPreview(data);
  }

  if (!siteId) return <EmptyState title="Select a website" body="Choose a website to open the Article Studio." />;

  const siteName = sites.find((s) => s.id === siteId)?.name ?? "";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Article Studio</h1>
          <p className="mt-1 text-sm text-slate-500">Research → outline → article → edit. Drafts are stored locally until you publish.</p>
        </div>
        <SiteSelect sites={sites} value={siteId} onChange={setSiteId} />
      </div>

      {error && <Alert tone="red">{error}</Alert>}
      {notice && <Alert tone="green">{notice}</Alert>}
      {publishResult && <Alert tone="blue">{publishResult}</Alert>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4">
          <Card title="New draft">
            <div className="space-y-2">
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Working title" />
              <Input value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} placeholder="Primary keyword (optional)" />
              <Button onClick={create} className="w-full">Create draft</Button>
            </div>
          </Card>
          <Card title="Drafts">
            {drafts.length === 0 ? (
              <EmptyState title="No drafts" body="Create a draft to begin." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {drafts.map((d) => (
                  <li key={d.id}>
                    <button onClick={() => setActiveId(d.id)} className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${activeId === d.id ? "bg-blue-50" : ""}`}>
                      <div className="font-medium text-slate-900">{d.title}</div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Badge>{d.status}</Badge>
                        {d._count.revisions > 0 && <span>{d._count.revisions} rev</span>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="lg:col-span-2">
          {!draft ? (
            <EmptyState title="Select a draft" body="Choose a draft from the list to edit it." />
          ) : (
            <div className="space-y-4">
              <Card
                title="Draft"
                description={siteName ? `Website: ${siteName} · Status: ${draft.status}` : `Status: ${draft.status}`}
                actions={<Badge tone={draft.outlineApproved ? "green" : "slate"}>{draft.status}</Badge>}
              >
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                    <Button variant="secondary" onClick={() => saveDraft({ title: draft.title })}>Save title</Button>
                  </div>
                  <div className="flex gap-2">
                    <Input value={draft.keyword ?? ""} placeholder="Target keyword" onChange={(e) => setDraft({ ...draft, keyword: e.target.value })} />
                    <Input type="number" value={draft.targetLength ?? ""} placeholder="Target words" onChange={(e) => setDraft({ ...draft, targetLength: e.target.value === "" ? null : Number(e.target.value) })} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => generate("outline")} disabled={busy}>Generate outline</Button>
                    <Button variant="secondary" onClick={() => generate("article")} disabled={busy}>Generate article</Button>
                    <Button variant="secondary" onClick={() => saveDraft({ body: draft.body, outlineApproved: true })} disabled={busy}>Approve outline & save</Button>
                    <Button onClick={() => publish()} disabled={busy}>Publish to WordPress</Button>
                    <Button variant="danger" onClick={async () => { if (confirm("Delete this unpublished draft?")) { await fetch(`/api/websites/${siteId}/drafts/${draft.id}`, { method: "DELETE" }); setActiveId(null); loadDrafts(siteId!); } }}>
                      Delete
                    </Button>
                  </div>
                  <div className="text-xs text-slate-400">
                    Publishing runs mandatory SEO checks, resolves dynamic tags, uploads images, creates the post, verifies it, then removes local content only after confirmed success.
                    {draft.status === "PUBLISHED" && <span className="ml-1 text-emerald-600">This draft is published.</span>}
                  </div>
                </div>
              </Card>

              <Card
                title="Editor"
                description="Autosaves as you type. Select text and use the AI actions to improve or regenerate just that selection."
                actions={
                  <div className="flex items-center gap-2">
                    {autosave.state === "saving" && <span className="text-xs text-slate-500" data-testid="autosave-state">Saving…</span>}
                    {autosave.state === "saved" && <span className="text-xs text-emerald-600" data-testid="autosave-state">Saved ✓</span>}
                    {autosave.state === "error" && (
                      <span className="flex items-center gap-1 text-xs text-red-600" data-testid="autosave-state">
                        Save failed
                        <button type="button" className="underline hover:text-red-800" onClick={() => autosave.retry()}>Retry</button>
                      </span>
                    )}
                    <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden="true" />
                    <Button variant={view === "edit" ? "primary" : "secondary"} onClick={() => setView("edit")}>Edit</Button>
                    <Button variant={view === "preview" ? "primary" : "secondary"} onClick={() => setView("preview")}>Preview</Button>
                  </div>
                }
              >
                {view === "edit" ? (
                  <RichTextEditor
                    key={draft.id}
                    initialContent={draft.body ?? ""}
                    placeholder="Start writing…"
                    onChange={(html) => {
                      setDraft((cur) => (cur ? { ...cur, body: html } : cur));
                      autosave.schedule({ body: html });
                    }}
                    onAiEdit={handleAiEdit}
                  />
                ) : (
                  <ArticlePreview html={draft.body ?? ""} title={draft.title} />
                )}
              </Card>

              <Card title="SEO fields" description="SEO title and meta description are shown to search engines; target keyword guides analysis. Related keywords form the verified topic cluster.">
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="metaTitle">SEO title (meta title)</label>
                    <Input id="metaTitle" value={draft.metaTitle ?? ""} placeholder="SEO title (falls back to article title)" onChange={(e) => setDraft({ ...draft, metaTitle: e.target.value })} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="metaDescription">Meta description</label>
                    <Textarea id="metaDescription" rows={3} value={draft.metaDescription ?? ""} placeholder="120–160 characters recommended" onChange={(e) => setDraft({ ...draft, metaDescription: e.target.value })} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="relatedKeywords">Related keywords (comma-separated)</label>
                    <Input id="relatedKeywords" value={(() => { try { const arr = draft.relatedKeywords ? JSON.parse(draft.relatedKeywords) : []; return Array.isArray(arr) ? arr.join(", ") : ""; } catch { return ""; } })()} placeholder="related term, cluster term" onChange={(e) => {
                      const terms = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                      setDraft({ ...draft, relatedKeywords: JSON.stringify(terms) });
                    }} />
                  </div>
                  <Button variant="secondary" onClick={saveSeo}>Save SEO fields</Button>
                </div>
              </Card>

              <Card title="Dynamic tags preview" description="Tags like [year], [site_name], [current_year_plus_1] expand using the site's timezone. Unknown tags warn instead of being replaced.">
                <div className="flex gap-2">
                  <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="Text with tags (defaults to title)" />
                  <Button variant="secondary" onClick={previewTags}>Preview</Button>
                </div>
                {tagPreview && (
                  <div className="mt-3 space-y-2">
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">{tagPreview.text}</div>
                    {tagPreview.warnings.length > 0 && (
                      <div className="text-xs text-amber-600">{tagPreview.warnings.join("; ")}</div>
                    )}
                  </div>
                )}
              </Card>

              {draft.revisions.length > 0 && (
                <Card title="Recent revisions">
                  <ul className="divide-y divide-slate-100">
                    {draft.revisions.slice(0, 5).map((r) => (
                      <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                        <span className="text-slate-500">v{r.version}</span>
                        <button className="text-xs text-blue-600 hover:underline" onClick={() => setDraft({ ...draft, body: r.body })}>Load revision</button>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
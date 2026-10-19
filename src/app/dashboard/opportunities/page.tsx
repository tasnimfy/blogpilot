"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, Input, Badge, EmptyState, Alert, Textarea, workflowTone } from "@/components/ui";
import { SiteSelect } from "@/components/SiteSelect";

interface Site {
  id: string;
  name: string;
  domain: string;
}
interface Score {
  demandScore: number;
  demandJustification: string;
  competitionScore: number;
  competitionJustification: string;
  valueScore: number;
  valueJustification: string;
  originalScore: number;
  originalJustification: string;
  relevanceScore: number;
  relevanceJustification: string;
  total: number;
  confidence: string;
  isOverride: boolean;
  originalAiScore: unknown;
}
interface Opp {
  id: string;
  title: string;
  keyword: string | null;
  source: string;
  status: string;
  reviewStatus: string;
  searchIntent: string | null;
  contentType: string | null;
  action: string | null;
  commercialIntent: boolean;
  seasonal: boolean;
  recommendedAction: string | null;
  createdAt: string;
  score: Score | null;
}

const WORKFLOW_STATES = [
  "NEW",
  "REVIEWED",
  "APPROVED",
  "REJECTED",
  "QUEUED_FOR_ARTICLE_STUDIO",
  "GENERATING",
  "DRAFT_READY",
  "FAILED",
] as const;

const INTENTS = ["INFORMATIONAL", "COMMERCIAL_INVESTIGATION", "TRANSACTIONAL", "NAVIGATIONAL"] as const;
const SOURCES = ["KEYWORD", "GSC", "TRENDS", "COMMUNITY", "MANUAL"] as const;

const CRITERIA: { key: keyof Score; label: string; hint: string }[] = [
  { key: "demandScore", label: "Search demand", hint: "Evidence of actual search demand (0-5)" },
  { key: "competitionScore", label: "Competition (realistic)", hint: "Higher = more realistic for a NEW site (0-5)" },
  { key: "valueScore", label: "Commercial / practical value", hint: "Booking intent, affiliate potential, lead gen (0-5)" },
  { key: "originalScore", label: "Original content potential", hint: "Supports original research, expert input, insight (0-5)" },
  { key: "relevanceScore", label: "Website relevance", hint: "Match with the site's niche, audience, language (0-5)" },
];
const JUST_KEY: Record<string, string> = {
  demandScore: "demandJustification",
  competitionScore: "competitionJustification",
  valueScore: "valueJustification",
  originalScore: "originalJustification",
  relevanceScore: "relevanceJustification",
};

const emptyScore = {
  demandScore: 3, demandJustification: "",
  competitionScore: 3, competitionJustification: "",
  valueScore: 3, valueJustification: "",
  originalScore: 3, originalJustification: "",
  relevanceScore: 3, relevanceJustification: "",
  confidence: "MEDIUM",
};

export default function OpportunitiesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [items, setItems] = useState<Opp[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [search, setSearch] = useState("");
  const [reviewStatus, setReviewStatus] = useState("");
  const [source, setSource] = useState("");
  const [intent, setIntent] = useState("");
  const [minScore, setMinScore] = useState("");
  const [sort, setSort] = useState("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [scoring, setScoring] = useState<Opp | null>(null);

  const loadSites = useCallback(async () => {
    const res = await fetch("/api/websites");
    const data = await res.json();
    setSites(data.sites || []);
    if (data.sites?.length && !siteId) setSiteId(data.sites[0].id);
  }, [siteId]);
  useEffect(() => { loadSites(); }, [loadSites]);

  const load = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: "50", sort, order });
      if (search) p.set("search", search);
      if (reviewStatus) p.set("reviewStatus", reviewStatus);
      if (source) p.set("source", source);
      if (intent) p.set("searchIntent", intent);
      if (minScore) p.set("minScore", minScore);
      const res = await fetch(`/api/websites/${siteId}/opportunities?${p}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load opportunities");
      setItems(data.items || []);
      setTotal(data.total || 0);
      setPageCount(data.pageCount || 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load opportunities");
    } finally {
      setLoading(false);
    }
  }, [siteId, page, search, reviewStatus, source, intent, minScore, sort, order]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !siteId) return;
    const res = await fetch(`/api/websites/${siteId}/opportunities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, source: "MANUAL" }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error);
    else { setTitle(""); setShowCreate(false); load(); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Content Opportunities</h1>
          <p className="mt-1 text-sm text-slate-500">Review, score, approve and queue article ideas. Five-part framework, 0-25.</p>
        </div>
        <div className="flex items-center gap-3">
          <SiteSelect sites={sites} value={siteId} onChange={setSiteId} />
          <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? "Cancel" : "New opportunity"}</Button>
        </div>
      </div>

      {error && <Alert tone="red">{error}</Alert>}

      {showCreate && (
        <Card title="New opportunity">
          <form onSubmit={create} className="flex gap-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Article topic / working title" required />
            <Button type="submit">Create</Button>
          </form>
        </Card>
      )}

      {!siteId ? (
        <EmptyState title="Select a website" body="Choose a website to review its content opportunities." />
      ) : (
        <Card
          title={`Opportunities (${total})`}
          actions={
            <div className="flex flex-wrap gap-2">
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Topic / keyword." className="max-w-44" />
              <select value={reviewStatus} onChange={(e) => { setReviewStatus(e.target.value); setPage(1); }} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="">All workflow states</option>
                {WORKFLOW_STATES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}
              </select>
              <select value={intent} onChange={(e) => { setIntent(e.target.value); setPage(1); }} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="">All intents</option>
                {INTENTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="">All sources</option>
                {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <Input type="number" min={0} max={25} value={minScore} onChange={(e) => { setMinScore(e.target.value); setPage(1); }} placeholder="Min score" className="max-w-24" />
              <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="createdAt">Sort: newest</option>
                <option value="total">Sort: score</option>
                <option value="title">Sort: topic</option>
                <option value="reviewStatus">Sort: status</option>
                <option value="searchIntent">Sort: intent</option>
                <option value="source">Sort: source</option>
                <option value="updatedAt">Sort: updated</option>
              </select>
              <Button variant="secondary" onClick={() => setOrder(order === "desc" ? "asc" : "desc")}>
                {order === "desc" ? "Desc" : "Asc"}
              </Button>
            </div>
          }
        >
          {loading ? (
            <EmptyState title="Loading opportunities…" body="Fetching from the server." />
          ) : items.length === 0 ? (
            <EmptyState title="No opportunities match" body="Adjust the filters, or create one to build the pipeline." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400">
                  <th className="py-2 pr-4">Opportunity</th>
                  <th className="py-2 pr-4">Intent / Type</th>
                  <th className="py-2 pr-4">Score</th>
                  <th className="py-2 pr-4">Breakdown</th>
                  <th className="py-2 pr-4">Action</th>
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-4">
                      <Link href={`/dashboard/opportunities/${o.id}?site=${siteId}`} className="font-medium text-blue-700 hover:underline">
                        {o.title}
                      </Link>
                      {o.keyword && <div className="text-xs text-slate-400">kw: {o.keyword}</div>}
                      {o.action && o.action !== "NEW_ARTICLE" && (
                        <div className="text-xs text-amber-600">{o.action}</div>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="text-xs text-slate-600">{o.searchIntent ?? "-"}</div>
                      {o.contentType && <div className="text-xs text-slate-400">{o.contentType}</div>}
                    </td>
                    <td className="py-3 pr-4">
                      {o.score ? (
                        <div>
                          <span className={`text-lg font-bold ${scoreTone(o.score.total)}`}>{o.score.total}</span>
                          <span className="text-xs text-slate-400">/25</span>
                          {o.score.isOverride && <div className="text-xs text-amber-600">editor override</div>}
                        </div>
                      ) : <span className="text-slate-400">-</span>}
                    </td>
                    <td className="py-3 pr-4">
                      {o.score ? (
                        <div className="text-xs text-slate-500">
                          D{o.score.demandScore} C{o.score.competitionScore} V{o.score.valueScore} O{o.score.originalScore} R{o.score.relevanceScore}
                        </div>
                      ) : <span className="text-slate-400">-</span>}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge tone={o.action === "UPDATE_EXISTING" ? "amber" : "blue"}>{o.action ?? "NEW_ARTICLE"}</Badge>
                    </td>
                    <td className="py-3 pr-4"><Badge>{o.source}</Badge></td>
                    <td className="py-3 pr-4"><Badge tone={workflowTone(o.reviewStatus)}>{o.reviewStatus.replace(/_/g, " ").toLowerCase()}</Badge></td>
                    <td className="py-3">
                      <div className="flex gap-2">
                        <Link href={`/dashboard/opportunities/${o.id}?site=${siteId}`}>
                          <Button variant="secondary">View</Button>
                        </Link>
                        <Button variant="ghost" onClick={() => setScoring(o)}>{o.score ? "Rescore" : "Score"}</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {pageCount > 1 && (
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-slate-500">Page {page} of {pageCount}</span>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
                <Button variant="secondary" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {scoring && siteId && (
        <ScoreDialog siteId={siteId} opp={scoring} onClose={() => setScoring(null)} onSaved={() => load()} />
      )}
    </div>
  );
}

function scoreTone(total: number) {
  if (total >= 20) return "text-emerald-600";
  if (total >= 15) return "text-blue-600";
  if (total >= 10) return "text-amber-600";
  return "text-slate-400";
}

function ScoreDialog({
  siteId,
  opp,
  onClose,
  onSaved,
}: {
  siteId: string;
  opp: Opp;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Record<string, number | string>>(() => {
    if (opp.score) {
      return {
        demandScore: opp.score.demandScore, demandJustification: opp.score.demandJustification,
        competitionScore: opp.score.competitionScore, competitionJustification: opp.score.competitionJustification,
        valueScore: opp.score.valueScore, valueJustification: opp.score.valueJustification,
        originalScore: opp.score.originalScore, originalJustification: opp.score.originalJustification,
        relevanceScore: opp.score.relevanceScore, relevanceJustification: opp.score.relevanceJustification,
        confidence: opp.score.confidence,
      };
    }
    return { ...emptyScore };
  });
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const total = [form.demandScore, form.competitionScore, form.valueScore, form.originalScore, form.relevanceScore]
    .map(Number).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

  async function save() {
    setBusy(true); setError(null); setSavedMsg(null);
    const res = await fetch(`/api/websites/${siteId}/opportunities/${opp.id}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) setError(data.error);
    else {
      setSavedMsg(data.isOverride ? `Saved (override). Original proposal preserved.` : "Score saved.");
      onSaved();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Score opportunity</h2>
          <span className="text-2xl font-bold text-slate-900">{total}<span className="text-base text-slate-400">/25</span></span>
        </div>
        <p className="mt-1 text-sm text-slate-500">{opp.title}</p>

        {opp.score?.isOverride && (
          <div className="mt-3">
            <Alert tone="amber">This score is an editor override. The original proposal is preserved in the record.</Alert>
          </div>
        )}

        <div className="mt-4 space-y-4">
          {CRITERIA.map((c) => (
            <div key={c.key}>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">{c.label}</label>
                <span className="text-sm font-bold text-blue-600">{Number(form[c.key])}</span>
              </div>
              <input
                type="range" min={0} max={5} step={1}
                value={Number(form[c.key])}
                onChange={(e) => setForm({ ...form, [c.key]: Number(e.target.value) })}
                className="mt-1 w-full"
              />
              <div className="mt-1 text-xs text-slate-400">{c.hint}</div>
              <Textarea
                rows={2}
                placeholder="Justification (required) - why this score?"
                value={String(form[JUST_KEY[c.key]] ?? "")}
                onChange={(e) => setForm({ ...form, [JUST_KEY[c.key]]: e.target.value })}
                className="mt-1"
              />
            </div>
          ))}
          <div>
            <label className="text-sm font-medium text-slate-700">Confidence</label>
            <select
              value={String(form.confidence)}
              onChange={(e) => setForm({ ...form, confidence: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
            </select>
          </div>
        </div>

        {error && <div className="mt-3"><Alert tone="red">{error}</Alert></div>}
        {savedMsg && <div className="mt-3"><Alert tone="green">{savedMsg}</Alert></div>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving." : "Save score"}</Button>
        </div>
      </div>
    </div>
  );
}
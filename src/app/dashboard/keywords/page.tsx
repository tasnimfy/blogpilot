"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Badge, EmptyState, Alert } from "@/components/ui";
import { SiteSelect } from "@/components/SiteSelect";

interface Site {
  id: string;
  name: string;
  domain: string;
}
interface Bucket {
  id: string;
  name: string;
  color: string | null;
  _count: { keywordRecords: number };
}
interface Kw {
  id: string;
  keyword: string;
  searchIntent: string | null;
  country: string | null;
  searchVolume: number | null;
  competition: string | null;
  difficulty: number | null;
  researchStatus: string;
  createdAt: string;
  bucket: { id: string; name: string };
}

export default function KeywordsPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [activeBucket, setActiveBucket] = useState<string | "ALL">("ALL");
  const [rows, setRows] = useState<Kw[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [search, setSearch] = useState("");
  const [intent, setIntent] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("searchVolume");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newBucket, setNewBucket] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const loadSites = useCallback(async () => {
    const res = await fetch("/api/websites");
    const data = await res.json();
    setSites(data.sites || []);
    if (data.sites?.length && !siteId) setSiteId(data.sites[0].id);
  }, [siteId]);
  useEffect(() => {
    loadSites();
  }, [loadSites]);

  const loadBuckets = useCallback(async (id: string) => {
    const res = await fetch(`/api/websites/${id}/buckets`);
    const data = await res.json();
    setBuckets(data.buckets || []);
    setActiveBucket("ALL");
  }, []);
  useEffect(() => {
    if (siteId) loadBuckets(siteId);
  }, [siteId, loadBuckets]);

  const loadKeywords = useCallback(async () => {
    if (!siteId) return;
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "50",
      sort,
      order,
    });
    if (activeBucket !== "ALL") params.set("bucketId", activeBucket);
    if (search) params.set("search", search);
    if (intent) params.set("searchIntent", intent);
    if (status) params.set("researchStatus", status);
    const res = await fetch(`/api/websites/${siteId}/keywords?${params}`);
    const data = await res.json();
    setRows(data.records || []);
    setTotal(data.total || 0);
    setPageCount(data.pageCount || 1);
  }, [siteId, page, sort, order, activeBucket, search, intent, status]);

  useEffect(() => {
    loadKeywords();
  }, [loadKeywords]);

  async function createBucket(e: React.FormEvent) {
    e.preventDefault();
    if (!siteId || !newBucket.trim()) return;
    const res = await fetch(`/api/websites/${siteId}/buckets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newBucket }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error);
    else {
      setNewBucket("");
      setError(null);
      loadBuckets(siteId);
    }
  }

  async function bulk(action: string, extra?: Record<string, unknown>) {
    const ids = [...selected];
    if (ids.length === 0) return;
    const res = await fetch(`/api/websites/${siteId}/keywords/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action, ...extra }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error);
    else {
      setSelected(new Set());
      loadKeywords();
    }
  }

  async function toOpportunities() {
    const ids = [...selected];
    if (ids.length === 0) return;
    for (const id of ids) {
      await fetch(`/api/websites/${siteId}/opportunities/from-keyword`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywordId: id }),
      });
    }
    setSelected(new Set());
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Keyword Library</h1>
          <p className="mt-1 text-sm text-slate-500">Organize keywords in per-site buckets and import from CSV or Search Console.</p>
        </div>
        <div className="flex items-center gap-3">
          <SiteSelect sites={sites} value={siteId} onChange={setSiteId} />
          <Button onClick={() => setImportOpen(true)}>Import</Button>
        </div>
      </div>

      {error && <Alert tone="red">{error}</Alert>}

      {!siteId ? (
        <EmptyState title="Select a website" body="Choose a website to manage its keyword library." />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          <div className="space-y-4">
            <Card title="Buckets">
              <form onSubmit={createBucket} className="mb-3 flex gap-2">
                <Input value={newBucket} onChange={(e) => setNewBucket(e.target.value)} placeholder="New bucket…" />
                <Button type="submit" variant="secondary">Add</Button>
              </form>
              <button
                onClick={() => setActiveBucket("ALL")}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm ${activeBucket === "ALL" ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}
              >
                <span>All keywords</span>
                <Badge tone={activeBucket === "ALL" ? "blue" : "slate"}>{total}</Badge>
              </button>
              <div className="mt-1 space-y-0.5">
                {buckets.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setActiveBucket(b.id)}
                    className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm ${activeBucket === b.id ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}
                  >
                    <span className="truncate">{b.name}</span>
                    <Badge tone={activeBucket === b.id ? "blue" : "slate"}>{b._count.keywordRecords}</Badge>
                  </button>
                ))}
              </div>
            </Card>
          </div>

          <div className="lg:col-span-3">
            <Card
              title={`Keywords (${total})`}
              actions={
                selected.size > 0 ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{selected.size} selected</span>
                    <Button variant="secondary" onClick={() => bulk("DELETE")}>Delete</Button>
                    <Button variant="secondary" onClick={() => bulk("SET_RESEARCH_STATUS", { researchStatus: "QUEUED" })}>Mark queued</Button>
                    <Button variant="secondary" onClick={toOpportunities}>→ Opportunities</Button>
                    <select
                      value=""
                      onChange={(e) => e.target.value && bulk("MOVE", { targetBucketId: e.target.value })}
                      className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                    >
                      <option value="">Move to bucket…</option>
                      {buckets.filter((b) => b.id !== activeBucket).map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                ) : null
              }
            >
              <div className="mb-3 flex flex-wrap gap-2">
                <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search keywords…" className="max-w-xs" />
                <select value={intent} onChange={(e) => { setIntent(e.target.value); setPage(1); }} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option value="">All intents</option>
                  {["INFORMATIONAL", "COMMERCIAL", "NAVIGATIONAL", "TRANSACTIONAL"].map((i) => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
                <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option value="">All research statuses</option>
                  {["NOT_STARTED", "QUEUED", "RESEARCHING", "READY"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option value="searchVolume">Sort: Volume</option>
                  <option value="keyword">Sort: Keyword</option>
                  <option value="difficulty">Sort: Difficulty</option>
                  <option value="createdAt">Sort: Created</option>
                </select>
                <Button variant="secondary" onClick={() => setOrder(order === "desc" ? "asc" : "desc")}>
                  {order === "desc" ? "Desc ↓" : "Asc ↑"}
                </Button>
              </div>

              {rows.length === 0 ? (
                <EmptyState title="No keywords" body="Import a CSV or create keywords to get started." />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400">
                      <th className="w-8 py-2 pr-2"></th>
                      <th className="py-2 pr-4">Keyword</th>
                      <th className="py-2 pr-4">Intent</th>
                      <th className="py-2 pr-4 text-right">Volume</th>
                      <th className="py-2 pr-4">Competition</th>
                      <th className="py-2 pr-4 text-right">Difficulty</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((k) => (
                      <tr key={k.id} className="hover:bg-slate-50">
                        <td className="py-2 pr-2">
                          <input type="checkbox" checked={selected.has(k.id)} onChange={() => toggle(k.id)} />
                        </td>
                        <td className="py-2 pr-4">
                          <div className="font-medium text-slate-900">{k.keyword}</div>
                          <div className="text-xs text-slate-400">{k.bucket.name}{k.country ? ` · ${k.country}` : ""}</div>
                        </td>
                        <td className="py-2 pr-4 text-slate-600">{k.searchIntent || "—"}</td>
                        <td className="py-2 pr-4 text-right text-slate-600">{k.searchVolume ?? "—"}</td>
                        <td className="py-2 pr-4">
                          <Badge tone={compTone(k.competition)}>{k.competition || "—"}</Badge>
                        </td>
                        <td className="py-2 pr-4 text-right text-slate-600">{k.difficulty ?? "—"}</td>
                        <td className="py-2"><Badge>{k.researchStatus}</Badge></td>
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
          </div>
        </div>
      )}

      {importOpen && siteId && (
        <ImportDialog
          siteId={siteId}
          buckets={buckets}
          onClose={() => setImportOpen(false)}
          onImported={() => { loadKeywords(); loadBuckets(siteId); }}
        />
      )}
    </div>
  );
}

function compTone(c: string | null) {
  if (c === "High") return "red";
  if (c === "Medium") return "amber";
  if (c === "Low") return "green";
  return "slate";
}

function ImportDialog({
  siteId,
  buckets,
  onClose,
  onImported,
}: {
  siteId: string;
  buckets: Bucket[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [kind, setKind] = useState<"KEYWORD" | "GSC">("KEYWORD");
  const [text, setText] = useState("");
  const [bucketId, setBucketId] = useState("");
  const [dupPolicy, setDupPolicy] = useState<"SKIP" | "MERGE">("SKIP");
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<{ header: string[] | null; totalRows: number; detectedMapping: Record<string, number>; errors: { row: number; message: string }[] } | null>(null);
  const [summary, setSummary] = useState<{ imported: number; duplicatesSkipped: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (buckets.length) setBucketId(buckets[0].id);
  }, [buckets]);

  async function onFile(f: File | null) {
    if (!f) return;
    setError(null);
    setSummary(null);
    const content = await f.text();
    setText(content);
    const res = await fetch(`/api/websites/${siteId}/imports/${kind === "KEYWORD" ? "csv/preview" : "gsc"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileContent: content }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error);
    else {
      setPreview(data.preview);
      setMapping(data.preview.detectedMapping || {});
    }
  }

  async function doImport() {
    if (!text) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    const body =
      kind === "KEYWORD"
        ? { fileContent: text, bucketId, duplicatePolicy: dupPolicy, mapping }
        : { fileContent: text };
    const res = await fetch(`/api/websites/${siteId}/imports/${kind === "KEYWORD" ? "csv" : "gsc"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) setError(data.error);
    else {
      setSummary({ imported: data.summary.imported, duplicatesSkipped: data.summary.duplicatesSkipped, failed: data.summary.failed });
      onImported();
    }
  }

  const fieldLabels: Record<string, string> = {
    keyword: "Keyword", searchVolume: "Search volume", competition: "Competition",
    cpc: "CPC", difficulty: "Difficulty", country: "Country", language: "Language",
    intent: "Intent", dateRange: "Date range", sourceUrl: "Source URL", notes: "Notes", source: "Source",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-slate-900">Import keywords</h2>
        <div className="mt-3 flex gap-2">
          {(["KEYWORD", "GSC"] as const).map((k) => (
            <Button key={k} variant={kind === k ? "primary" : "secondary"} onClick={() => { setKind(k); setPreview(null); setText(""); setSummary(null); }}>
              {k === "KEYWORD" ? "Keyword CSV" : "Search Console"}
            </Button>
          ))}
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-slate-700">
            {kind === "KEYWORD" ? "Google Keyword Planner / keyword CSV" : "Search Console performance export (.csv)"}
          </label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm"
          />
        </div>

        {preview && kind === "KEYWORD" && (
          <div className="mt-4 space-y-3">
            <div className="text-sm text-slate-600">
              Detected {preview.totalRows} data rows.
              {preview.errors.length > 0 && (
                <span className="ml-2 text-amber-600">{preview.errors.length} row(s) with missing keyword will be skipped.</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.keys(fieldLabels).map((field) => (
                <label key={field} className="flex flex-col text-xs">
                  <span className="mb-1 text-slate-500">{fieldLabels[field]}</span>
                  <select
                    value={mapping[field] ?? ""}
                    onChange={(e) =>
                      setMapping((m) => {
                        const next = { ...m };
                        if (e.target.value === "") delete next[field];
                        else next[field] = Number(e.target.value);
                        return next;
                      })
                    }
                    className="rounded-md border border-slate-300 px-2 py-1.5"
                  >
                    <option value="">— not mapped —</option>
                    {preview.header?.map((h, i) => (
                      <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                Destination bucket:
                <select value={bucketId} onChange={(e) => setBucketId(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                  {buckets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                Duplicates:
                <select value={dupPolicy} onChange={(e) => setDupPolicy(e.target.value as "SKIP" | "MERGE")} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                  <option value="SKIP">Skip</option>
                  <option value="MERGE">Merge</option>
                </select>
              </label>
            </div>
          </div>
        )}

        {preview && kind === "GSC" && (
          <div className="mt-3 text-sm text-slate-600">
            Detected {preview.totalRows} Search Console rows. Opportunity candidates will be computed after import.
          </div>
        )}

        {error && <div className="mt-3"><Alert tone="red">{error}</Alert></div>}
        {summary && (
          <div className="mt-3">
            <Alert tone="green">
              Imported {summary.imported}; {summary.duplicatesSkipped} duplicate(s) skipped; {summary.failed} row(s) failed.
            </Alert>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {text && (
            <Button onClick={doImport} disabled={busy || (kind === "KEYWORD" && !bucketId)}>
              {busy ? "Importing…" : "Import"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

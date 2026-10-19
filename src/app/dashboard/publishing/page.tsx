"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, Input, Badge, EmptyState, Alert } from "@/components/ui";
import { SiteSelect } from "@/components/SiteSelect";

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
  bodyLength?: number;
  _count: { revisions: number };
}
interface Receipt {
  id: string;
  wpPostId: number;
  permalink: string;
  status: string;
  publishedAt: string;
}

export default function PublishingPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  const loadSites = useCallback(async () => {
    const res = await fetch("/api/websites");
    const data = await res.json();
    setSites(data.sites || []);
    if (data.sites?.length && !siteId) setSiteId(data.sites[0].id);
  }, [siteId]);
  useEffect(() => { loadSites(); }, [loadSites]);

  useEffect(() => {
    if (!siteId) return;
    fetch(`/api/websites/${siteId}/drafts`).then((r) => r.json()).then((d) => setDrafts(d.items || []));
    fetch(`/api/websites/${siteId}/receipts`).then((r) => r.json()).then((r) => setReceipts(r.receipts || []));
  }, [siteId]);

  const filtered = drafts.filter(
    (d) => (!status || d.status === status) && (!search || d.title.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Publishing Queue</h1>
          <p className="mt-1 text-sm text-slate-500">Track drafts toward publication and confirmed receipts. Local content is removed only after confirmed success.</p>
        </div>
        <SiteSelect sites={sites} value={siteId} onChange={setSiteId} />
      </div>

      {!siteId ? (
        <EmptyState title="Select a website" body="Choose a website to review its publishing queue." />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title={`Drafts (${filtered.length})`}>
            <div className="mb-3 flex flex-wrap gap-2">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="max-w-48" />
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="">All statuses</option>
                {["OUTLINE", "WRITING", "DRAFT", "SEO_REVIEW", "READY", "PUBLISHED", "FAILED"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {filtered.length === 0 ? (
              <EmptyState title="No drafts" body="Create drafts in the Article Studio." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {filtered.map((d) => (
                  <li key={d.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="font-medium text-slate-900">{d.title}</div>
                      <div className="text-xs text-slate-500">{d.keyword || "no keyword"} · {d._count.revisions} rev(s)</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={d.status === "PUBLISHED" ? "green" : d.status === "FAILED" ? "red" : "slate"}>{d.status}</Badge>
                      <Link href={`/dashboard/articles`} className="text-xs text-blue-600 hover:underline">Open</Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Publication receipts (${receipts.length})`}>
            {receipts.length === 0 ? (
              <EmptyState title="No published posts yet" body="Confirmed publications appear here as minimal receipts (no article body stored locally)." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {receipts.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">Post #{r.wpPostId}</div>
                      <a href={r.permalink} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">{r.permalink}</a>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={r.status === "PUBLISHED" ? "green" : "slate"}>{r.status}</Badge>
                      <span className="text-xs text-slate-400">{new Date(r.publishedAt).toLocaleDateString()}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

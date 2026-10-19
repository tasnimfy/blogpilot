"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Badge, EmptyState, Alert, Textarea } from "@/components/ui";
import { SiteSelect } from "@/components/SiteSelect";

interface Site {
  id: string;
  name: string;
  domain: string;
}
interface DraftRow {
  id: string;
  title: string;
  status: string;
}
interface Check {
  id: string;
  category: string;
  status: "pass" | "warn" | "fail" | "info" | "suggestion";
  label: string;
  detail: string;
  mandatory: boolean;
  live: boolean;
}
interface Analysis {
  overall: number;
  categories: Record<string, { score: number; max: number }>;
  checks: Check[];
  critical: string[];
  warnings: string[];
  suggestions: string[];
  mandatoryFailed: boolean;
  liveChecksRequired: boolean;
}

const statusTone: Record<string, string> = { pass: "green", warn: "amber", fail: "red", info: "slate", suggestion: "blue" };

export default function SeoPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [draftId, setDraftId] = useState<string>("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seoTitle, setSeoTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [slug, setSlug] = useState("");
  const [canonical, setCanonical] = useState("");

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
  }, [siteId]);

  async function run() {
    if (!draftId) return;
    setBusy(true); setError(null);
    const res = await fetch(`/api/websites/${siteId}/drafts/${draftId}/seo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seoTitle: seoTitle || null, metaDescription: metaDescription || null, slug: slug || null, canonical: canonical || null }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) setError(data.error);
    else setAnalysis(data.analysis);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">SEO Analyzer</h1>
          <p className="mt-1 text-sm text-slate-500">Internal editorial-quality analysis (not a Google ranking prediction). Works without Rank Math.</p>
        </div>
        <SiteSelect sites={sites} value={siteId} onChange={setSiteId} />
      </div>

      {!siteId ? (
        <EmptyState title="Select a website" body="Choose a website to analyze its drafts." />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card title="Draft + metadata">
            <div className="space-y-3">
              <select value={draftId} onChange={(e) => setDraftId(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="">Select a draft…</option>
                {drafts.map((d) => <option key={d.id} value={d.id}>{d.title} ({d.status})</option>)}
              </select>
              <Input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} placeholder="SEO title (optional)" />
              <Textarea rows={2} value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} placeholder="Meta description (optional)" />
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="Slug (optional)" />
              <Input value={canonical} onChange={(e) => setCanonical(e.target.value)} placeholder="Canonical URL (optional)" />
              <Button onClick={run} disabled={busy || !draftId} className="w-full">{busy ? "Analyzing…" : "Run analysis"}</Button>
              {error && <Alert tone="red">{error}</Alert>}
            </div>
          </Card>

          <div className="lg:col-span-2">
            {!analysis ? (
              <EmptyState title="No analysis yet" body="Select a draft and run the analysis." />
            ) : (
              <div className="space-y-4">
                <Card title={`Overall score: ${analysis.overall}/100`} actions={<Badge tone={analysis.mandatoryFailed ? "red" : "green"}>{analysis.mandatoryFailed ? "Mandatory checks failed" : "Mandatory checks pass"}</Badge>}>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {Object.entries(analysis.categories).map(([cat, v]) => (
                      <div key={cat} className="rounded-md border border-slate-200 px-3 py-2">
                        <div className="text-xs uppercase text-slate-400">{cat}</div>
                        <div className="text-xl font-bold text-slate-900">{v.score}<span className="text-xs text-slate-400">/{v.max}</span></div>
                      </div>
                    ))}
                  </div>
                  {analysis.liveChecksRequired && (
                    <div className="mt-3"><Alert tone="blue">Some checks (broken links, indexability) require a live URL and were not performed automatically.</Alert></div>
                  )}
                </Card>

                <Card title="Checks">
                  <ul className="divide-y divide-slate-100">
                    {analysis.checks.map((c) => (
                      <li key={c.id} className="flex items-start gap-3 py-2">
                        <Badge tone={statusTone[c.status] ?? "slate"}>{c.status}</Badge>
                        <div>
                          <div className="text-sm font-medium text-slate-900">
                            {c.label}{c.mandatory && <span className="ml-1 text-xs text-red-600">(mandatory)</span>}{c.live && <span className="ml-1 text-xs text-slate-400">(live)</span>}
                          </div>
                          <div className="text-sm text-slate-500">{c.detail}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>

                {analysis.critical.length > 0 && (
                  <Card title="Critical issues">
                    <ul className="list-inside list-disc text-sm text-red-700">{analysis.critical.map((m) => <li key={m}>{m}</li>)}</ul>
                  </Card>
                )}
                {analysis.warnings.length > 0 && (
                  <Card title="Warnings">
                    <ul className="list-inside list-disc text-sm text-amber-700">{analysis.warnings.map((m) => <li key={m}>{m}</li>)}</ul>
                  </Card>
                )}
                {analysis.suggestions.length > 0 && (
                  <Card title="Suggestions">
                    <ul className="list-inside list-disc text-sm text-slate-600">{analysis.suggestions.map((m) => <li key={m}>{m}</li>)}</ul>
                  </Card>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Badge, EmptyState, Alert, Field } from "@/components/ui";
import { SiteSelect } from "@/components/SiteSelect";

interface Site {
  id: string;
  name: string;
  domain: string;
}
interface TrendCfg {
  id: string;
  enabled: boolean;
  searchTerms: string | null;
  countries: string | null;
  frequency: string;
  timeRange: string;
  changeThreshold: number;
  autoBucketId: string | null;
}
interface Observation {
  id: string;
  term: string;
  region: string | null;
  timeRange: string | null;
  value: number | null;
  previousValue: number | null;
  changePct: number | null;
  notable: boolean;
  observedOn: string;
  provider: string | null;
}
interface Job {
  id: string;
  type: string;
  status: string;
  error: string | null;
  createdAt: string;
}

interface GenSchedule {
  id?: string;
  enabled: boolean;
  schedule: string;
  timezone: string | null;
  dailyLimit: number;
  maxPerRun: number;
  maxRetries: number;
  timeoutMinutes: number;
  weekdayMask: string | null;
}
interface GenJob {
  id: string;
  status: string;
  error: string | null;
  attempts: number;
  createdAt: string;
}

export default function AutomationPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [configs, setConfigs] = useState<TrendCfg[]>([]);
  const [obs, setObs] = useState<Observation[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [providers, setProviders] = useState<{ id: string; name: string; capabilities: string }[]>([]);
  const [newTerms, setNewTerms] = useState("");
  const [newRegions, setNewRegions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [schedDraft, setSchedDraft] = useState<GenSchedule | null>(null);
  const [genJobs, setGenJobs] = useState<GenJob[]>([]);
  const [usageTotal, setUsageTotal] = useState<{ tokens: number; costCents: number; calls: number } | null>(null);

  const loadSites = useCallback(async () => {
    const res = await fetch("/api/websites");
    const data = await res.json();
    setSites(data.sites || []);
    if (data.sites?.length && !siteId) setSiteId(data.sites[0].id);
  }, [siteId]);
  useEffect(() => { loadSites(); }, [loadSites]);

  const loadAll = useCallback(async () => {
    if (!siteId) return;
    const [c, o, j] = await Promise.all([
      fetch(`/api/websites/${siteId}/trends`).then((r) => r.json()),
      fetch(`/api/websites/${siteId}/trends/observations`).then((r) => r.json()),
      fetch(`/api/websites/${siteId}/jobs`).then((r) => r.json()),
    ]);
    setConfigs(c.configs || []);
    setProviders(c.providers || []);
    setObs(o.observations || []);
    setJobs(j.jobs || []);
  }, [siteId]);
  useEffect(() => { loadAll(); }, [loadAll]);

  const loadGen = useCallback(async () => {
    if (!siteId) return;
    const [s, j] = await Promise.all([
      fetch(`/api/websites/${siteId}/automation/generation/settings`).then((r) => r.json()),
      fetch(`/api/websites/${siteId}/automation/generation/jobs`).then((r) => r.json()),
    ]);
    const base: GenSchedule = {
      enabled: false,
      schedule: "03:00",
      timezone: null,
      dailyLimit: 1,
      maxPerRun: 1,
      maxRetries: 2,
      timeoutMinutes: 30,
      weekdayMask: null,
    };
    const sc = s.schedule ? { ...base, ...s.schedule } : base;
    setSchedDraft(sc);
    setGenJobs(j.jobs || []);
    setUsageTotal(j.usage?.totals || null);
  }, [siteId]);
  useEffect(() => { loadGen(); }, [loadGen]);

  async function saveSched() {
    if (!siteId || !schedDraft) return;
    setError(null);
    const res = await fetch(`/api/websites/${siteId}/automation/generation/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(schedDraft),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error || "Failed to save schedule");
    else {
      setResult(`Generation schedule saved (${data.schedule?.enabled ? "enabled" : "disabled"}).`);
      loadGen();
    }
  }

  async function runGen() {
    if (!siteId) return;
    setResult(null);
    const res = await fetch(`/api/websites/${siteId}/automation/generation/run`, { method: "POST" });
    const data = await res.json();
    setResult(data.error || `Generation run complete: ${data.outcomes?.length ?? 0} job(s) attempted.`);
    loadGen();
  }

  async function retryGen(jobId: string) {
    if (!siteId) return;
    setError(null);
    const res = await fetch(`/api/websites/${siteId}/automation/generation/jobs/${jobId}/retry`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) setError(data.error || "Retry failed");
    else {
      setResult("Job re-queued for retry.");
      loadGen();
    }
  }

  async function runDueGen() {
    setResult(null);
    const res = await fetch("/api/automation/generation/run-due", { method: "POST" });
    const data = await res.json();
    setResult(`Due websites processed: ${data.ran ?? data.due ?? 0}.`);
    loadGen();
  }

  async function createConfig() {
    const terms = newTerms.split(",").map((s) => s.trim()).filter(Boolean);
    if (terms.length === 0) return;
    const countries = newRegions.split(",").map((s) => s.trim()).filter(Boolean);
    const res = await fetch(`/api/websites/${siteId}/trends`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ searchTerms: terms, countries, frequency: "DAILY", changeThreshold: 30 }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error);
    else {
      setNewTerms("");
      setNewRegions("");
      loadAll();
    }
  }

  async function runConfig(id: string) {
    setResult(null);
    const res = await fetch(`/api/websites/${siteId}/trends/${id}/run`, { method: "POST" });
    const data = await res.json();
    setResult(data.error || (data.ok ? `Check completed: ${data.notable} notable change(s)` : "Check failed"));
    loadAll();
  }

  async function runDue() {
    setResult(null);
    const res = await fetch("/api/trends/run-due", { method: "POST" });
    const data = await res.json();
    setResult(`Checked ${data.checked} due configuration(s)`);
    loadAll();
  }

  async function onTrendCsv(file: File | null) {
    if (!file) return;
    setError(null);
    const content = await file.text();
    const res = await fetch(`/api/websites/${siteId}/trends/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileContent: content }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error);
    else {
      setResult(`Imported ${data.summary.imported} observations (${data.summary.failed} failed)`);
      loadAll();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Automation & Jobs</h1>
          <p className="mt-1 text-sm text-slate-500">Google Trends monitoring, scheduled jobs, and manual fallback imports.</p>
        </div>
        <div className="flex items-center gap-3">
          <SiteSelect sites={sites} value={siteId} onChange={setSiteId} />
          <Button onClick={runDue}>Run due checks</Button>
        </div>
      </div>

      {error && <Alert tone="red">{error}</Alert>}
      {result && <Alert tone="green">{result}</Alert>}

      {providers.length > 0 && (
        <Alert tone="amber">
          <strong>Trends access limitation:</strong> {providers[0]?.capabilities}
        </Alert>
      )}

      {!siteId ? (
        <EmptyState title="Select a website" body="Choose a website to configure Trends monitoring." />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="Trends monitoring configurations">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row">
              <Input value={newTerms} onChange={(e) => setNewTerms(e.target.value)} placeholder="Terms (comma separated)" className="flex-1" />
              <Input value={newRegions} onChange={(e) => setNewRegions(e.target.value)} placeholder="Regions (e.g. US)" className="sm:w-40" />
              <Button onClick={createConfig}>Add</Button>
            </div>
            {configs.length === 0 ? (
              <EmptyState title="No monitoring configs" body="Add terms to begin daily monitoring." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {configs.map((c) => {
                  const terms = safeArr(c.searchTerms);
                  return (
                    <li key={c.id} className="flex items-center justify-between py-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900">{terms.join(", ")}</span>
                          <Badge tone={c.enabled ? "green" : "slate"}>{c.enabled ? "enabled" : "disabled"}</Badge>
                        </div>
                        <div className="text-xs text-slate-500">
                          {c.frequency} · {c.timeRange} · threshold {c.changeThreshold}% · {(safeArr(c.countries)).join(", ") || "all regions"}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="secondary" onClick={() => runConfig(c.id)}>Run</Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Manual Trends CSV import" description="Preserved fallback when automated access is unavailable.">
            <p className="mb-2 text-sm text-slate-600">Columns: term, region, time range, value, date (date optional).</p>
            <input type="file" accept=".csv,text/csv" onChange={(e) => onTrendCsv(e.target.files?.[0] ?? null)} className="text-sm" />
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Recent observations">
          {obs.length === 0 ? (
            <EmptyState title="No observations yet" body="Run a check or import a Trends CSV." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400">
                  <th className="py-2 pr-4">Term</th>
                  <th className="py-2 pr-4 text-right">Value</th>
                  <th className="py-2 pr-4 text-right">Δ</th>
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {obs.slice(0, 20).map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="py-2 pr-4">
                      <span className="font-medium text-slate-900">{o.term}</span>
                      {o.notable && <Badge tone="amber">notable</Badge>}
                    </td>
                    <td className="py-2 pr-4 text-right text-slate-600">{o.value ?? "—"}</td>
                    <td className={`py-2 pr-4 text-right ${o.changePct !== null && o.changePct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {o.changePct !== null ? `${o.changePct >= 0 ? "+" : ""}${o.changePct.toFixed(0)}%` : "—"}
                    </td>
                    <td className="py-2 pr-4 text-slate-500">{o.provider || "—"}</td>
                    <td className="py-2 text-xs text-slate-400">{new Date(o.observedOn).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Background jobs">
          {jobs.length === 0 ? (
            <EmptyState title="No jobs yet" body="Jobs (e.g. Trends checks) appear here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {jobs.slice(0, 20).map((j) => (
                <li key={j.id} className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm font-medium text-slate-900">{j.type}</span>
                    {j.error && <div className="text-xs text-amber-600">{j.error}</div>}
                  </div>
                  <Badge tone={j.status === "SUCCEEDED" ? "green" : j.status === "FAILED" ? "red" : "slate"}>{j.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Scheduled article generation" description="Approved opportunities queued for Article Studio are generated on this schedule. Generated articles are saved as unpublished drafts in Article Studio and are never auto-published.">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={!!schedDraft?.enabled}
              onChange={(e) => setSchedDraft((s) => (s ? { ...s, enabled: e.target.checked } : s))}
            />
            Enabled (opt-in)
          </label>
          <Button variant="secondary" onClick={runGen} disabled={!siteId}>Run now</Button>
          <Button variant="secondary" onClick={runDueGen}>Run due sweep</Button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Field label="Local time">
            <Input type="time" value={schedDraft?.schedule ?? "03:00"} onChange={(e) => setSchedDraft((s) => (s ? { ...s, schedule: e.target.value } : s))} />
          </Field>
          <Field label="Timezone (IANA)">
            <Input value={schedDraft?.timezone ?? ""} placeholder="e.g. America/New_York" onChange={(e) => setSchedDraft((s) => (s ? { ...s, timezone: e.target.value.trim() || null } : s))} />
          </Field>
          <Field label="Daily limit" hint="Conservative default: 1">
            <Input type="number" min={0} max={100} value={schedDraft?.dailyLimit ?? 1} onChange={(e) => setSchedDraft((s) => (s ? { ...s, dailyLimit: Number(e.target.value) } : s))} />
          </Field>
          <Field label="Max per run">
            <Input type="number" min={1} max={100} value={schedDraft?.maxPerRun ?? 1} onChange={(e) => setSchedDraft((s) => (s ? { ...s, maxPerRun: Number(e.target.value) } : s))} />
          </Field>
          <Field label="Max retries">
            <Input type="number" min={0} max={10} value={schedDraft?.maxRetries ?? 2} onChange={(e) => setSchedDraft((s) => (s ? { ...s, maxRetries: Number(e.target.value) } : s))} />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={saveSched} disabled={!siteId}>Save schedule</Button>
          {usageTotal && (
            <div className="text-xs text-slate-500">
              Usage: {usageTotal.calls} AI call(s), {usageTotal.tokens} tokens, ${(usageTotal.costCents / 100).toFixed(2)} estimated
            </div>
          )}
        </div>

        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Generation jobs</h3>
          {genJobs.length === 0 ? (
            <EmptyState title="No generation jobs" body="Approving an opportunity queues an ARTICLE_GENERATE job here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {genJobs.slice(0, 15).map((job) => (
                <li key={job.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">{job.id.slice(0, 8)}</span>
                      <Badge tone={job.status === "SUCCEEDED" ? "green" : job.status === "FAILED" ? "red" : "slate"}>{job.status}</Badge>
                      {job.attempts > 1 && <span className="text-xs text-slate-400">{job.attempts} attempt(s)</span>}
                    </div>
                    {job.error && <div className="mt-0.5 text-xs text-red-600">{job.error}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-slate-400">{new Date(job.createdAt).toLocaleString()}</span>
                    {job.status === "FAILED" && <Button variant="secondary" onClick={() => retryGen(job.id)}>Retry</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}

function safeArr(v: string | null): string[] {
  try {
    const p = JSON.parse(v ?? "[]");
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

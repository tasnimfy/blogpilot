"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Button, Card, Badge, Alert } from "@/components/ui";
import { SiteTabs } from "@/components/SiteTabs";

const SOURCES = [
  { key: "KEYWORDS", label: "Keyword data", description: "Imported keywords from CSV files into buckets (on-demand import)." },
  { key: "GSC", label: "Google Search Console", description: "Queries, clicks, impressions, CTR, position, page, date range. Manual CSV import today; automated refresh requires an authorized provider." },
  { key: "TRENDS", label: "Google Trends", description: "Topics, regions, time ranges, trend direction, relative interest. Daily checks per config; manual CSV fallback." },
] as const;

interface StatusRow {
  id: string;
  source: string;
  enabled: boolean;
  refreshIntervalMinutes: number;
  providerId: string | null;
  status: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextAttemptAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  lastSyncCount: number | null;
}

interface ProviderInfo {
  id: string;
  name: string;
  capabilities: string;
}

export default function SiteIntegrationsPage() {
  const { id } = useParams<{ id: string }>();
  const [statuses, setStatuses] = useState<StatusRow[]>([]);
  const [providers, setProviders] = useState<Record<string, ProviderInfo[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/websites/${id}/integrations`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "You do not have access to view integrations for this website");
        return;
      }
      setStatuses(data.statuses ?? []);
      setProviders(data.providers ?? {});
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(source: string, patchBody: object) {
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/websites/${id}/integrations`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, ...patchBody }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to update integration settings");
      return;
    }
    setMessage("Integration settings updated.");
    await load();
  }

  async function runNow(source: string) {
    setError(null);
    setMessage(null);
    setSyncing(source);
    try {
      const res = await fetch(`/api/websites/${id}/integrations/${source}/sync`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Sync failed");
        return;
      }
      if (data.skipped) {
        setMessage(`${source} sync skipped: ${data.error || "nothing due"}`);
      } else if (data.ok) {
        setMessage(`${source} sync completed successfully.`);
      } else {
        setError(`${source} sync failed: ${data.error || "unknown error"}`);
      }
    } catch {
      setError("Network error");
    } finally {
      setSyncing(null);
      await load();
    }
  }

  function fmt(d: string | null): string {
    if (!d) return "—";
    return new Date(d).toLocaleString();
  }

  const toneFor = (s: string): "green" | "red" | "amber" | "slate" =>
    s === "OK" ? "green" : s === "ERROR" ? "red" : s === "RUNNING" ? "amber" : "slate";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Data sources</h1>
        <p className="mt-1 text-sm text-slate-500">
          Status and configuration for the content research data collection layer.
          Provider capabilities are shown for transparency; credentials are never exposed.
        </p>
      </div>

      {error && <Alert tone="red">{error}</Alert>}
      {message && <Alert tone="green">{message}</Alert>}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : (
        <div className="space-y-4">
          {statuses.map((s) => {
            const def = SOURCES.find((x) => x.key === s.source);
            const catalog = providers[s.source] ?? [];
            const current = catalog.find((p) => p.id === s.providerId) ?? catalog[0];
            const canManage = s.source !== "TRENDS"; // enforced server-side; UI is cosmetic only
            return (
              <Card key={s.source} title={def?.label ?? s.source} description={def?.description}>
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                    <span>
                      Status <Badge tone={toneFor(s.status)}>{s.status}</Badge>
                    </span>
                    <span className="text-slate-500">
                      Last success: <span className="text-slate-800">{fmt(s.lastSuccessAt)}</span>
                    </span>
                    <span className="text-slate-500">
                      Last attempt: <span className="text-slate-800">{fmt(s.lastAttemptAt)}</span>
                    </span>
                    <span className="text-slate-500">
                      Next retry: <span className="text-slate-800">{fmt(s.nextAttemptAt)}</span>
                    </span>
                    <span className="text-slate-500">
                      Records: <span className="text-slate-800">{s.lastSyncCount ?? "—"}</span>
                    </span>
                    <span className="text-slate-500">
                      Failures: <span className="text-slate-800">{s.consecutiveFailures}</span>
                    </span>
                  </div>

                  {s.lastError && (
                    <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{s.lastError}</div>
                  )}

                  {canManage && (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <label className="text-sm">
                        <span className="mb-1 block text-xs font-medium text-slate-500">Refresh interval (minutes)</span>
                        <input
                          type="number"
                          min={5}
                          max={43200}
                          defaultValue={s.refreshIntervalMinutes}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isFinite(v) && v !== s.refreshIntervalMinutes) {
                              patch(s.source, { refreshIntervalMinutes: v });
                            }
                          }}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block text-xs font-medium text-slate-500">Provider</span>
                        <select
                          value={s.providerId ?? ""}
                          onChange={(e) => patch(s.source, { providerId: e.target.value || null })}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">Default</option>
                          {catalog.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </label>
                      <div className="flex items-end gap-2">
                        <Button onClick={() => patch(s.source, { enabled: !s.enabled })} variant="secondary">
                          {s.enabled ? "Disable" : "Enable"}
                        </Button>
                        <Button onClick={() => runNow(s.source)} disabled={syncing === s.source}>
                          {syncing === s.source ? "Running…" : "Run now"}
                        </Button>
                      </div>
                    </div>
                  )}

                  {current && (
                    <details className="text-xs text-slate-500">
                      <summary className="cursor-pointer text-slate-600">Provider: {current.name}</summary>
                      <p className="mt-1 whitespace-pre-line">{current.capabilities}</p>
                    </details>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
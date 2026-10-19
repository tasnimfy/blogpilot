import { prisma } from "@/lib/prisma";

// Integration status registry: one row per website per data source.
// This module owns the IntegrationStatus model (config + status combined)
// and the safe-retry/backoff bookkeeping. It performs no external IO.

export const SYNC_SOURCES = ["KEYWORDS", "GSC", "TRENDS"] as const;
export type SyncSource = (typeof SYNC_SOURCES)[number];

export function isSyncSource(value: string): value is SyncSource {
  return (SYNC_SOURCES as readonly string[]).includes(value);
}

const DEFAULT_INTERVAL: Record<SyncSource, number> = {
  KEYWORDS: 1440, // on-demand import; interval informational
  GSC: 1440, // daily, configurable
  TRENDS: 1440, // daily; actual cadence follows each config's frequency
};

// Regex used to scrub credential-like fragments from error messages stored
// for administrators. Providers already return sanitized messages; this is a
// defense-in-depth layer so secrets can never reach the status registry,
// browser responses, or logs.
const KEY_VALUE_FRAGMENT =
  /((?:api[_-]?key|secret|token|password|credential)\s*[=:]\s*)[^\s,;]+/gi;
const AUTHORIZATION_HEADER = /\bauthorization\s*:\s*(?:bearer\s+)?[^\s,;]+/gi;
const BEARER_TOKEN = /\bbearer\s+[^\s,;]+/gi;
const ENCRYPTED_PAYLOAD = /enc:v1:[a-f0-9:]+/gi;

export function sanitizeSyncError(message: string): string {
  const s = (message ?? "").slice(0, 500);
  const scrubbed = s
    .replace(AUTHORIZATION_HEADER, "authorization: [REDACTED]")
    .replace(BEARER_TOKEN, "bearer [REDACTED]")
    .replace(KEY_VALUE_FRAGMENT, "$1[REDACTED]")
    .replace(ENCRYPTED_PAYLOAD, "[REDACTED]");
  return scrubbed.trim() || "Unknown sync error";
}

// Exponential backoff for failed syncs: 5m, 10m, 20m, ... capped at 24h and
// at 3x the configured refresh interval (so a daily refresh never backs off
// past the next scheduled window).
export function nextRetryDelayMs(consecutiveFailures: number, refreshIntervalMinutes: number): number {
  const base = 5 * 60_000;
  const factor = Math.pow(2, Math.min(Math.max(consecutiveFailures - 1, 0), 8)); // 1..256
  const cap = Math.min(24 * 3600_000, Math.max(refreshIntervalMinutes * 60_000, base) * 3);
  return Math.min(base * factor, cap);
}

export async function ensureIntegrationStatus(websiteId: string, source: SyncSource) {
  const existing = await prisma.integrationStatus.findUnique({
    where: { websiteId_source: { websiteId, source } },
  });
  if (existing) return existing;
  return prisma.integrationStatus.create({
    data: {
      websiteId,
      source,
      refreshIntervalMinutes: DEFAULT_INTERVAL[source],
      providerId: null,
      status: "IDLE",
    },
  });
}

// Mark a sync as in-flight. Used to prevent overlapping scheduled runs.
export async function markSyncRunning(websiteId: string, source: SyncSource): Promise<void> {
  await ensureIntegrationStatus(websiteId, source);
  await prisma.integrationStatus.update({
    where: { websiteId_source: { websiteId, source } },
    data: { status: "RUNNING", lastAttemptAt: new Date() },
  });
}

export interface SyncResultInput {
  ok: boolean;
  error?: string | null;
  count?: number | null;
  durationMs?: number | null;
}

// Record the outcome of a collection run. On success the failure counter and
// backoff gate reset; on failure consecutiveFailures increments and
// nextAttemptAt is set so retries are safe and rate-limit friendly.
export async function recordSyncResult(
  websiteId: string,
  source: SyncSource,
  input: SyncResultInput
): Promise<void> {
  await ensureIntegrationStatus(websiteId, source);
  const now = new Date();
  if (input.ok) {
    await prisma.integrationStatus.update({
      where: { websiteId_source: { websiteId, source } },
      data: {
        status: "OK",
        lastAttemptAt: now,
        lastSuccessAt: now,
        nextAttemptAt: null,
        lastError: null,
        consecutiveFailures: 0,
        lastSyncCount: input.count ?? null,
        lastDurationMs: input.durationMs ?? null,
        updatedAt: now,
      },
    });
    return;
  }

  const row = await prisma.integrationStatus.findUnique({
    where: { websiteId_source: { websiteId, source } },
  });
  const failures = (row?.consecutiveFailures ?? 0) + 1;
  const interval = row?.refreshIntervalMinutes ?? 1440;
  await prisma.integrationStatus.update({
    where: { websiteId_source: { websiteId, source } },
    data: {
      status: "ERROR",
      lastAttemptAt: now,
      nextAttemptAt: new Date(now.getTime() + nextRetryDelayMs(failures, interval)),
      lastError: sanitizeSyncError(input.error ?? "Sync failed"),
      consecutiveFailures: failures,
      lastDurationMs: input.durationMs ?? null,
      updatedAt: now,
    },
  });
}

// Whether a scheduled sync may run now for this row. Respects: disabled,
// already running (overlap), backoff (nextAttemptAt), and refresh interval
// since the last success.
export function isDue(row: {
  enabled: boolean;
  status: string;
  refreshIntervalMinutes: number;
  lastSuccessAt: Date | null;
  nextAttemptAt: Date | null;
}): boolean {
  if (!row.enabled) return false;
  if (row.status === "RUNNING") return false;
  const now = Date.now();
  if (row.nextAttemptAt && row.nextAttemptAt.getTime() > now) return false;
  if (!row.lastSuccessAt) return true; // never succeeded -> try now
  const intervalMs = Math.max(row.refreshIntervalMinutes, 1) * 60_000;
  return now - row.lastSuccessAt.getTime() >= intervalMs;
}

export async function listIntegrationStatus(websiteId: string) {
  return Promise.all(
    (SYNC_SOURCES as readonly SyncSource[]).map((s) => ensureIntegrationStatus(websiteId, s))
  );
}

// Update the administrator-facing configuration for a source. providerId is
// validated by callers against the matching provider registry.
export async function updateIntegrationConfig(
  websiteId: string,
  source: SyncSource,
  input: { enabled?: boolean; refreshIntervalMinutes?: number; providerId?: string | null }
) {
  const row = await ensureIntegrationStatus(websiteId, source);
  const data: Record<string, unknown> = {};
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.refreshIntervalMinutes !== undefined) {
    const v = Number(input.refreshIntervalMinutes);
    if (!Number.isFinite(v) || v < 5 || v > 43200) {
      throw new Error("refreshIntervalMinutes must be between 5 and 43200");
    }
    data.refreshIntervalMinutes = Math.round(v);
  }
  if (input.providerId !== undefined) {
    // null clears the override (registry default applies); empty string too.
    data.providerId = input.providerId ? input.providerId : null;
  }
  if (Object.keys(data).length > 0) {
    // Disabling keeps the last status for display but gates scheduling.
    if (input.enabled === false) data.status = row.status === "OK" ? "OK" : "DISABLED";
    if (input.enabled === true) data.status = row.status === "DISABLED" ? "IDLE" : row.status;
    data.updatedAt = new Date();
    await prisma.integrationStatus.update({ where: { id: row.id }, data });
  }
  return (await prisma.integrationStatus.findUnique({ where: { id: row.id } }))!;
}
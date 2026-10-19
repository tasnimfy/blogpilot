# Content Research Data Collection Layer

This phase adds a unified **data collection layer** on top of the existing
research integrations. It provides a clean provider interface per data source,
a per-website integration status registry with safe retry, and applies the
site-level RBAC permissions to every new endpoint. It reuses the existing
database, credential handling (AES-256-GCM encryption, `src/lib/crypto.ts`),
site configuration and provider registries — no new third-party runtime
dependency was introduced.

## Data sources

| Source | Registry / provider interface | Persisted model | Collection mode |
| ------ | ----------------------------- | --------------- | --------------- |
| Keyword data | `src/providers/keyword-providers.ts` (`KeywordSourceProvider`) | `KeywordRecord` (+ `ImportBatch`) | On-demand CSV import into buckets; future API providers plug into the same persistence (`storeKeywordRows`) |
| Google Search Console | `src/providers/gsc-providers.ts` (`GscProvider`) | `SearchConsoleRecord` (+ `ImportBatch`) | Manual CSV import (supported today); automated refresh via a registered API provider |
| Google Trends | `src/providers/trends-providers.ts` (`TrendsProvider`, pre-existing) | `TrendObservation` (+ `BackgroundJob`) | Daily / weekly checks per `TrendMonitoringConfiguration`; manual CSV fallback |

All provider contracts live in `src/providers/types.ts`. Providers are pure
adapters: they return explicit `{ ok: true, ... } | { ok: false, error }`
results, keep missing metrics as `null`/absent (never zero-invented), and are
registered through a `register()`/`getXProvider()`/`listXProviders()` registry
so an implementation can be replaced without touching callers.

## Integrations status registry

New model `IntegrationStatus` (one row per website per source:
`KEYWORDS | GSC | TRENDS`):

- **Configuration**: `enabled`, `refreshIntervalMinutes`, `providerId` (which
  registered provider to use; `null` = registry default).
- **Status**: `status` (`IDLE | RUNNING | OK | ERROR | DISABLED`),
  `lastAttemptAt`, `lastSuccessAt`, `lastSyncCount`, `lastDurationMs`.
- **Error handling**: `lastError` (sanitized, administrator-facing — never
  contains credentials), `consecutiveFailures`, `nextAttemptAt` (exponential
  backoff: 5m, 10m, 20m, … capped at 24h and 3× the refresh interval).

`src/server/sync-status.service.ts` owns this model
(`recordSyncResult`, `isDue`, `updateIntegrationConfig`, `sanitizeSyncError`).

### Scheduling

- **Google Trends**: each `TrendMonitoringConfiguration` keeps its own
  `frequency` (`DAILY | WEEKLY`) and overlap guard; `runDueTrendChecks` /
  `runDueTrendChecksForWebsite` run only due configs.
- **GSC refreshes**: configurable per website via `refreshIntervalMinutes`
  (default 1440 = daily). The scheduler only runs a GSC sync when the interval
  elapsed since the last success AND no retry backoff window is active
  (`IntegrationStatus.isDue`).
- **Scheduler entry point**: `POST /api/integrations/run-due` (authenticated
  session, same pattern as the existing `/api/trends/run-due`). Point any
  cron/scheduler at it (e.g. every 15 minutes). `runDueSyncs()` never runs
  overlapping syncs for the same source/website and honours backoff.

## Google Search Console: honest limitation

Google Search Console exposes data only through the official Search Console
API, which requires a Google Cloud project plus **per-user OAuth2 consent** and
a verified property. No such provider is configured in this deployment, so:

- The default `GscProvider` (`unavailable`) honestly reports that automated
  refresh is not available; the integration status shows `ERROR` with that
  explanation and safe backoff, and **no `SearchConsoleRecord` is fabricated**.
- The supported collection path is **manual CSV import**
  (`Imports → Search Console`), which validates rows, deduplicates by
  (query, page, date), stores `clicks/impressions/ctr/position/date/page` and
  records source provenance (`source = "CSV"`, `importBatchId`).
- To enable automated refresh, implement `GscProvider` against the official
  API (OAuth2, server-side, encrypted credentials — follow the
  `AIProviderConfiguration`/`WordPressConnection` pattern), `register()` it,
  then select it in the website's **Data** page. Do not scrape Google Search
  Console; that is outside this layer's design.

## Google Trends

- Automated checks require a registered `TrendsProvider`; the default provider
  states clearly that none is configured. Manual **CSV import of observations**
  is the supported fallback (`trends/import`).
- Observations store `term`, `region`, `timeRange`, `value` (relative index),
  `previousValue`, `changePct`, `provider`, `source`, `notable` and
  `observedOn` (collection timestamp) — see `TrendObservation`.

## Keyword data

- CSV import (`Imports → Keywords`) validates rows, normalizes queries
  (trim + collapse whitespace for display; lowercased for duplicate
  detection), reports invalid rows and skips/merges duplicates, with an
  `ImportBatch` status record (RUNNING → COMPLETED/FAILED) + summary.
- The parse/validate/normalize stage is now provided by the `csv`
  `KeywordSourceProvider`; persistence goes through the shared
  `storeKeywordRows` so future keyword APIs reuse the same pipeline.

## Provenance and timestamps

- Every collection event writes an `ImportBatch` (source, file name, counts,
  status, error) and an audit log entry (`KEYWORD_IMPORT`, `GSC_IMPORT`,
  `GSC_REFRESH`, `TRENDS_CHECK` via `BackgroundJob`).
- `SearchConsoleRecord.createdAt`, `TrendObservation.observedOn` and
  `KeywordRecord.createdAt` are the collection timestamps; `source` /
  `provider` / `importBatchId` record provenance.

## Role-based access control

New/changed endpoints validate **server-side** with `requireSitePermission`:

| Route | Permission |
| ----- | ---------- |
| `GET /api/websites/[id]/integrations` | `site.view` |
| `PATCH /api/websites/[id]/integrations` | `keywords.manage` (KEYWORDS/GSC), `trends.manage` (TRENDS) — see `permissionForSource` |
| `POST /api/websites/[id]/integrations/[source]/sync` | same per-source mapping |
| `POST /api/integrations/run-due` | authenticated session (operator scheduler) |

The UI hides controls it cannot use, but authorization is always enforced on
the server (deny-by-default).

## Credential safety

- No new credentials are stored by this phase. Existing secrets (OpenRouter
  keys, WordPress application passwords) remain encrypted at rest and are
  never returned to the browser (`serialize*` helpers redact them).
- `sanitizeSyncError` additionally scrubs credential-like fragments
  (`api_key=…`, `Authorization: Bearer …`, `enc:v1:…` payloads) before any
  error is persisted to `IntegrationStatus.lastError` or returned by the API.
- Provider capability strings are informational only; provider registries
  never expose tokens or keys.

## Running the scheduler manually

```bash
# verify status of all sources for a website (authenticated session)
curl -H "Cookie: <session>" http://localhost:3000/api/websites/<id>/integrations

# run everything that is due now (use as the cron target)
curl -X POST -H "Cookie: <session>" http://localhost:3000/api/integrations/run-due
```

## Tests

- `tests/providers.test.ts` — provider registries and CSV keyword provider
  (validation, normalization, honest unavailability).
- `tests/integration-status.test.ts` — status registry, error sanitization,
  backoff/retry gating, GSC/Trends/Keyword orchestration, cross-site
  isolation, RBAC mapping.

## Migration

`prisma/migrations/20261018130000_add_integration_status/migration.sql`
(additive `IntegrationStatus` table; backward compatible).

```bash
npx prisma migrate deploy   # apply
npx prisma generate         # regenerate client
```
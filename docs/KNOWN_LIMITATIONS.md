# Known Limitations & Unsupported Integrations

This reflects the state after **Phase 1 (Foundation)**. Later phases will
remove many of these items.

## Remaining work / not yet implemented

- Background article-generation jobs (automated bulk generation is not enabled;
  publishing always requires an explicit operator action).
- Real WordPress publishing was not exercised against a live WordPress site in
  this environment (no WordPress credentials available). The full pipeline is
  implemented and the connection test, publish, retry/reconciliation, and
  failure-recovery paths are covered by unit tests and an HTTP smoke test that
  confirmed safe behavior (no duplicate posts, draft preserved on failure).

Keyword library, CSV + Search Console imports, duplicate handling, opportunity
scoring (Phase 2), research configuration, source provenance, research briefs,
provider adapters, daily Google Trends monitoring (Phase 3), Article Studio
with OpenRouter generation, site-specific prompts, dynamic tags, draft-only
persistence (Phase 4), internal SEO analyzer, image discovery with license/
attribution handling, Rank Math compatibility (Phase 5), and secure WordPress
publishing with connection testing, verification, retry safety, and confirmed
cleanup (Phase 6) are **complete**.

### Verified vs. not-yet-verified integrations
- **Openverse** image search verified against the live public API (Phase 5).
- **WordPress** connection/publishing implemented and tested with mocks; not
  exercised against a live WordPress site (no credentials).
- **Wikimedia Commons** adapter unit-tested with mocked fetch; not live.
- **Rank Math** detection requires a configured, reachable WordPress site.
- **OpenRouter** article generation requires a valid per-site API key; error
  paths tested with mocks/stubs.

The full normalized database schema already exists for all of the above; only
the application logic and UI are missing.

## Architectural decisions & trade-offs

- **SQLite by default** — chosen because no external database service or
  Docker was available in the development environment. It is provider-
  swappable to PostgreSQL (change the datasource provider + `DATABASE_URL`).
- **JSON stored as text** — SQLite has no native JSON column in this Prisma
  version, so flexible fields are stored as JSON text and parsed in the app
  layer. On PostgreSQL these could become native JSON columns.
- **Status/type fields are strings** — SQLite has no enums; values are
  validated with zod in the application layer.

## Genuine integration caveats

- Google Trends has no stable, officially supported public API for all
  features. The plan is to use a provider adapter with conservative rate
  limits and honest failure reporting; if automated access is unavailable,
  manual CSV import remains supported. Daily measurements are never
  fabricated.
- OpenRouter model support varies (context limits, tools, structured output).
  The integration will validate model capabilities before sending requests.
- Platforms such as Facebook and some forums require authentication or paid
  APIs; the research module will only use authorized/legitimate access and
  will not promise otherwise.
- Rank Math's full analysis engine is not exposed via a public REST endpoint;
  integration is staged (compatibility → metadata sync → optional analysis),
  and the internal SEO analyzer works without Rank Math.

## Not verified here

- Docker Compose deployment was **not executed** (Docker unavailable).
- No real OpenRouter / WordPress / Google / image-provider credentials were
  exercised; all automated tests use mocks or no external calls. See
  `docs/INTEGRATIONS.md`.

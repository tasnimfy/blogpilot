# Implementation Report

## Audit (Phase 7 — hardening & review) — complete

Final audit against every acceptance criterion and testing requirement of the
master specification. See `docs/AUDIT.md` for the full matrix.

- Added linting (`eslint` + `eslint-config-next`, `npm run lint`): **0 errors**
  (2 intentional `<img>` warnings on the external-image library page).
- Implemented Global Settings (operator account: change password, verified by
  `tests/account.service.test.ts`) replacing the previous placeholder.
- Verified: `tsc --noEmit` clean, **141/141 tests passing** (23 files),
  `npm run lint` 0 errors, `npm run build` success.
- Audited all API routes: only `/api/auth/login` and `/api/auth/logout` are
  public; every other route calls `requireUser()`.
- Confirmed credentials are encrypted/redacted and site data is isolated
  across all services (tested).
- Documented which integrations are verified only with mocks (all except
  Openverse) and the remaining hardening items (rate limiting, explicit CSRF
  tokens, Docker not executed, no live WP/OpenRouter credentials).
- Fixed one actual gap found during the audit: Global Settings was a
  placeholder; it is now a functional operator-account page.

## Phase 6 (WordPress Publishing) — complete

Implemented secure per-site WordPress connections, connection testing, post
creation, metadata synchronization where supported, image uploads, explicit
publishing, verification, retry safety, and local draft-content cleanup after
confirmed success only.

### What was added
- **WordPress REST client** (`src/server/wordpress/client.ts`) — SSRF-safe,
  authenticated (Application Passwords over HTTPS), with timeouts and typed
  errors. Supports connection test, post types, categories/tags, posts-by-slug,
  create/update post, and media upload.
- **Connection service** (`src/server/wordpress/connection.service.ts`) —
  server-side `testConnection` that stores status (OK/FAILED), last tested,
  post types, categories, tags, media capability, and exposed meta keys
  (incl. Rank Math detection). Never reports success it did not verify.
- **Publishing service** (`src/server/wordpress/publish.service.ts`) —
  `publishDraft`: validates the destination, runs mandatory SEO checks (blocked
  unless an explicit `force` override), resolves dynamic tags, uploads images,
  creates/updates the post, syncs Rank Math meta when exposed (retrying without
  meta if rejected), attaches the featured image, verifies the post, creates a
  minimal publication receipt, and **only then** removes the local body/outline/
  research payload. Credentials stay encrypted.
- **Retry safety & reconciliation** — an idempotency marker (deterministic slug
  from resolved title + draft id) and `PublicationAttempt` records. Before
  creating, it checks for an existing post with that marker; if the pre-create
  lookup fails it refuses to create and preserves the draft for reconciliation;
  if a post was created but verification fails it marks `REQUIRES_RECONCILIATION`
  and preserves the draft. No duplicate posts; no premature draft deletion.
- **API routes + UI** — connection test, publish, receipts; "Test connection"
  button on the WordPress page, a "Publish to WordPress" action in Article
  Studio, and a Publishing Queue page.
- **Error mapping** — publish/WordPress errors surface as clean 400/5xx
  responses instead of a generic 500.

### Tests added (136 total, all passing)
- `tests/publish.service.test.ts` — happy-path publish + receipt + local
  cleanup; no re-publish of published drafts; reconciliation with an existing
  post (no duplicate create); **timeout recovery without duplicating the post**
  (draft preserved on first failure, reconciled on retry); verification-failure
  → REQUIRES_RECONCILIATION with draft preserved; mandatory-SEO blocking (and
  force override); Rank Math meta sync + meta-rejected retry; site isolation.
- `tests/wordpress-connection.test.ts` — healthy connection stores
  capabilities; auth failure marks FAILED; no-connection error.

### Verified
- `tsc --noEmit` clean, `npm test` 136/136, `npm run build` success.
- End-to-end HTTP smoke test against the dev server (no real WordPress): the
  connection test marked the site FAILED with an honest error; publishing to a
  non-WordPress endpoint returned a clean 400 and **preserved the draft with no
  receipt and no duplicate post** (safe reconciliation path).

## Phase 5 (SEO + Images + Rank Math) — complete

Implemented the internal SEO analyzer, image discovery providers with license
and attribution handling, and optional Rank Math compatibility based on
verified API capabilities. No external integration success is fabricated.

### What was added
- **Internal SEO analyzer** (`src/server/seo.service.ts`) — evaluates draft
  content (title, body, keyword, slug, headings, links, images) across
  metadata, content-structure, on-page, and technical categories. Produces an
  overall score /100 with category scores, per-check pass/warn/fail/suggestion
  results, mandatory pass/fail, critical/warnings/suggestions, and clear
  explanations for every deduction. Distinguishes **local** checks from
  **live** checks (broken links, indexability) that require a URL and are not
  performed automatically. Works without Rank Math; the score is an editorial
  quality indicator, not a ranking prediction.
- **Image providers** (`src/providers/image-providers.ts`) — Openverse and
  Wikimedia Commons adapters with normalized results that preserve license,
  creator, attribution, dimensions, and a commercial-use decision computed
  from a canonicalized license (never assumed). Honest errors when a provider
  is unreachable.
- **Image service** (`src/server/image.service.ts`) — search (not persisted),
  save to the site's ImageAsset library, list, delete, and attribution
  helpers.
- **Rank Math compatibility** (`src/server/rankmath.service.ts`) — staged:
  meta-key mapping (rank_math_title / _description / _focus_keyword /
  _canonical_url), best-effort detection via WordPress post meta, and an honest
  "unknown" result when presence is inconclusive. Never fabricates a Rank Math
  score. SSRF guard (`src/lib/ssrf.ts`) blocks localhost/private/cloud-metadata
  destinations for outbound probes.
- **UI** — SEO Analyzer (select draft, run analysis, per-category scores,
  checks, critical/warnings/suggestions) and Image Library (search Openverse/
  Wikimedia, review license/attribution/commercial, save to library).
- **API routes** — draft SEO analyze/get, image search, image CRUD, Rank Math
  status.

### Tests added (124 total, all passing)
- `tests/seo.service.test.ts` (good/bad structure, mandatory checks, duplicate
  title, keyword usage, local vs live, persistence, site isolation)
- `tests/image-providers.test.ts` (mocked fetch: Openverse/Wikimedia
  normalization, license/commercial/attribution decisions, honest errors)
- `tests/rankmath.test.ts` (meta mapping, detection incl. inconclusive, SSRF
  guard)

### Verified
- `tsc --noEmit` clean, `npm test` 124/124, `npm run build` success.
- End-to-end HTTP smoke test passed: SEO analysis (score 87, mandatory pass,
  live checks flagged), a **live Openverse search returned 20 real results**
  with preserved license metadata (e.g. a `by-nc-nd` image correctly flagged
  non-commercial, attribution required), and Rank Math status reported
  "unknown" honestly when no WordPress connection with credentials was
  configured.

## Phase 4 (Article Studio) — complete

Implemented OpenRouter configuration, site-specific prompts,
research→outline→article generation, draft editing, dynamic tags, and
draft-only content persistence. Credentials stay encrypted; tests cover site
isolation.

### What was added
- **Dynamic tags** (`src/lib/dynamic-tags.ts`) — safe, explicit registry
  (`[year]`, `[month]`, `[month_number]`, `[date]`, `[day]`, `[site_name]`,
  `[site_domain]`, `[current_year_plus_1]`), expanded using the site's timezone.
  Unknown tags produce a warning and are left in place; no code is executed
  from tag strings (prototype-pollution guarded). Preview endpoint provided.
- **Site-specific prompts** (`src/server/prompts.ts`) — outline and article
  prompts built from the site's editorial guidelines, research brief, and SEO
  metadata. When evidence is missing the model is told not to invent it.
- **OpenRouter client** (`src/server/openrouter.ts`) — server-only chat calls
  with the site's decrypted key, timeouts, retry/fallback model support, and
  clean error mapping (401/502/empty), never leaking the key.
- **Article service** (`src/server/article.service.ts`) — create/edit drafts,
  automatic revisions, list/filter/delete, research→outline→article generation
  (with injectable AI client for testing), and draft-only persistence.
- **API routes** for drafts (CRUD, outline, article) and dynamic-tag preview.
- **UI** — Article Studio: create drafts, generate outline/article, edit body
  and title, save/delete, view revisions, and preview dynamic tags.
- **Credentials** — OpenRouter keys remain AES-256-GCM encrypted and are only
  decrypted server-side immediately before use.

### Tests added (106 total, all passing)
- `tests/dynamic-tags.test.ts` (expansion, timezone, unknown-tag warnings, no
  code execution / prototype-pollution guard)
- `tests/prompts.test.ts` (site-specific guidelines, **prompt isolation**
  across sites, research-injection, outline parsing)
- `tests/article.service.test.ts` (draft lifecycle, revisions, mocked
  outline/article generation, no-key error, **site isolation** for drafts)
- `tests/openrouter.test.ts` (stubbed fetch: success, 401 without key leak,
  non-JSON 502, empty response, key/model required)

### Verified
- `tsc --noEmit` clean, `npm test` 106/106, `npm run build` success.
- End-to-end HTTP smoke test (create draft → revisions → dynamic-tag preview
  → outline generation fails gracefully without a real key → no fabricated
  content) passed against the dev server.

## Phase 3 (Research & Trends) — complete

Implemented research-source configuration, source provenance, research briefs,
provider adapters, and daily Google Trends monitoring — with honest access
limitations and preserved manual fallbacks.

### What was added
- **ResearchConfiguration** model (migration `add_research_config`) — per-site
  research settings: instructions, permitted/excluded domains, source-type and
  community-platform presets, required official sources, min independent
  sources, depth, language, country scope, quality, and mandatory community
  evidence.
- **Provider adapters** (`src/providers/`) — typed contracts + registries for
  research search and Trends providers. Default providers honestly report that
  no automated source is configured/verified; they never fabricate data.
- **Research workflow** — run research (generates questions, attempts the
  provider, records limitations), add sources with classified findings
  (VERIFIED_FACT / FIRST_HAND / OPINION / THEME / DISAGREEMENT / EXPERT /
  INFERENCE / UNVERIFIED), and build an evidence-based research brief that
  aggregates themes, disagreements, and missing evidence without inventing
  anything. Manual source/finding addition is always available (fallback).
- **Trends monitoring** — config CRUD, a daily job runner with no-overlap
  protection, previous-value comparison, change % and notability flags, and
  auto-discovery into a configured bucket (deduped). Honest failure when no
  provider is available, plus a **manual CSV import** of observations.
- **API routes** for research config/jobs/sources/findings and trends
  configs/run/run-due/import/observations/jobs.
- **UI** — Research Center (settings + source presets + limitation notice) and
  Automation & Jobs (Trends configs, run, observations, background jobs,
  manual CSV import).

### Access limitations documented
- No automated research search provider is configured/verified; research runs
  record this honestly.
- Google Trends has no stable officially-supported public API for all features;
  automated checks report unavailability and manual CSV import remains the
  supported path.
- Platforms requiring auth/paid access (Facebook, some forums) are only offered
  as legitimate/accessible presets.

### Tests added (82 total, all passing)
- `tests/research-config.test.ts`, `research.service.test.ts`,
  `trends.service.test.ts` (config CRUD, honest failure, successful provider
  comparison + notability + discovery dedupe, manual CSV import).

### Verified
- `tsc --noEmit` clean, `npm test` 82/82, `npm run build` success.
- End-to-end HTTP smoke test (research config → run research → add source →
  brief → trends config → honest run failure → trends CSV import → observations)
  passed against the dev server.

## Phase 2 (Keyword Intelligence) — complete

Implemented keyword buckets, robust CSV imports, Search Console CSV imports,
duplicate handling, keyword filtering/management, and the five-criterion
opportunity scoring system. The schema already covered all entities, so no
migration was required.

### What was added
- **CSV parser** (`src/lib/csv.ts`) — RFC 4180: quoted fields with embedded
  commas/quotes/newlines, BOM, CRLF/LF/CR, blank-row cleanup, null-safe numeric
  parsing (never invents zero).
- **Column mapping** (`src/lib/column-mapping.ts`) — auto-detects keyword and
  Search Console columns from headers; supports explicit manual mapping.
- **Buckets** — site-scoped CRUD, unique name per site, cascade delete.
- **Keyword CSV import** — preview (header detection, mapping, per-row errors),
  import with duplicate **SKIP/MERGE**, import summary, per-batch audit,
  unknown metrics stored as null.
- **Search Console import** — stores performance records and derives
  opportunity candidates: high-impressions/low-CTR, near first page, new
  queries, and content-cannibalization.
- **Keyword records** — search/filter/sort/pagination, create/update/delete,
  bulk delete / move / set status, and merging duplicates into a kept record.
- **Opportunity scoring** — five criteria (demand, competition, value,
  originality, relevance; 0–5 each, total /25) with required justifications,
  confidence, evidence, sources, priority bands, and editor **override that
  preserves the original AI proposal**.
- **API routes** for buckets, keywords (incl. bulk/merge), imports (csv,
  csv/preview, gsc, list), and opportunities (incl. score, from-keyword).
- **UI** — Keyword Library page (site selector, buckets sidebar, filterable/
  sortable/paginated table, bulk actions, import dialog with mapping +
  summary) and Content Opportunities page (list + filters + scoring dialog
  with live total and override notice).

### Tests added (65 total, all passing)
- `tests/csv.test.ts`, `bucket.service.test.ts`, `keyword-import.test.ts`,
  `searchconsole.test.ts`, `keyword.service.test.ts`, `opportunity.test.ts`.

### Verified
- `tsc --noEmit` clean, `npm test` 65/65, `npm run build` success.
- End-to-end HTTP smoke test (bucket → CSV import → keywords → GSC import +
  4 opportunity types → create + score = 21) passed against the dev server.

## Phase 1 (Foundation) — complete

Phase 1 is complete: a working, testable application foundation for BlogPilot
with authentication, a full normalized database, multi-site management, and
secure per-site settings. All Phase 1 automated tests pass, type checking
passes, and the production build succeeds. An end-to-end HTTP smoke test
(login → create site → configure AI/settings → fetch) was executed against the
running dev server and confirmed correct behavior, including encrypted
credential storage that never leaks to the browser.

## Completed

### Application shell
- Next.js 14 (App Router) + TypeScript (strict) + Tailwind CSS.
- Responsive admin layout with the 11 planned navigation sections; later-phase
  sections show a clear "not implemented" empty state backed by the existing
  schema.

### Authentication
- bcrypt password hashing (cost 12), HMAC-signed session cookies (HttpOnly,
  SameSite=Lax, 7-day expiry), server-side `requireUser()` guard on every
  dashboard route and API handler, login/logout/me API endpoints.

### Database (full normalized schema + migration)
- Prisma schema (`prisma/schema.prisma`) covering all expected entities
  (Website, settings, guidelines, AI config, WordPress connection, keyword
  buckets/records, import batches, Search Console, trends, opportunities and
  scoring, research, drafts/revisions, SEO, images, publishing attempts and
  receipts, background jobs, audit log, user).
- Initial migration applied; every site-owned record has a cascade `websiteId`.
- Dev database reset procedure documented (`npm run db:reset`).

### Multi-site management
- API: list / create / update / status / delete websites, with zod validation
  and duplicate-domain rejection.
- UI: website list with live counts, add-website form, per-site detail page
  with edit + enable/disable/delete.

### Per-site settings
- Content policies (post type, workflow, tags, research, minimums, SEO
  metadata, dynamic tags, image insertion).
- Editorial guidelines (voice, style, structure, avoid/verify lists, checklist,
  custom AI instructions).
- AI configuration (OpenRouter models, tokens, temperature, budget, retries).
- WordPress connection (HTTPS site URL, username, application password).
- All secrets encrypted with AES-256-GCM and never returned to the browser.

### Security
- Credential encryption + redaction, site-scoped services, zod input
  validation, safe Prisma usage, audit logging for sensitive actions, secret
  management via env vars. See `docs/SECURITY.md` for details and remaining
  hardening (rate limiting, CSRF tokens, upload validation) planned for later.

### Tests (23 passing)
- `tests/crypto.test.ts` — encryption round-trip, tamper detection, redaction.
- `tests/auth.test.ts` — hashing, token create/verify/tamper/expiry.
- `tests/website.service.test.ts` — multi-site CRUD, isolation, duplicate
  rejection, validation, cascade delete, scoped queries.
- `tests/settings.service.test.ts` — per-site settings/guidelines/AI/WP,
  credential encryption + serialization safety, isolation, HTTPS requirement.

### Verification run
- `tsc --noEmit` — clean.
- `npm test` — 23/23 passed.
- `npm run build` — success (all routes compiled).
- HTTP smoke test against the dev server — passed.

## Changed / created files (key)

```
package.json, tsconfig.json, next.config.mjs, tailwind.config.ts,
postcss.config.mjs, .env.example, .gitignore, vitest.config.ts
prisma/schema.prisma, prisma/migrations/20261017172020_init/
src/lib/{env,prisma,json,crypto,auth,audit,validation,api}.ts
src/server/{website,settings}.service.ts
src/app/api/auth/{login,logout,me}/route.ts
src/app/api/websites/route.ts
src/app/api/websites/[id]/{route,status,settings,guidelines,ai,wordpress}/…
src/app/{layout,page,globals.css,login/page}.tsx
src/app/dashboard/{layout,page}.tsx
src/app/dashboard/websites/… (list + per-site pages)
src/app/dashboard/{keywords,opportunities,research,articles,seo,publishing,images,automation,settings}/page.tsx
src/components/{ui,LogoutButton,SiteTabs,ComingSoon}.tsx
scripts/{seed-admin,reset-db,init-test-db}.mjs
tests/… (helpers + 4 suites)
README.md, docs/{DEPLOYMENT,DATABASE,INTEGRATIONS,SECURITY,KNOWN_LIMITATIONS,IMPLEMENTATION_REPORT}.md
Dockerfile, docker-compose.yml, docker/entrypoint.sh
```

## Remaining work

Phases 2–7: keyword intelligence, research & trends, Article Studio,
SEO/images, publishing, and hardening. The schema, navigation, and service
patterns are already in place to build on without redesign.

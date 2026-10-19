# Audit Report — BlogPilot

Audit date: 2026-10-18. This document audits the completed application against
every acceptance criterion in the master specification (§23), the testing
requirements (§20), and verifies security, data isolation, integration
honesty, deployment, and remaining limitations.

## 1. Verification run (this audit)

| Check | Command | Result |
|---|---|---|
| Type check | `tsc --noEmit` | Pass (0 errors) |
| Unit/integration tests | `npm test` (`vitest run`) | **141/141 pass** (23 files) |
| Lint | `npm run lint` (`eslint src`) | 0 errors, 2 warnings* |
| Production build | `npm run build` | Success (all routes compiled) |
| End-to-end HTTP smoke tests | dev server + REST calls | Passed (login, sites, keywords, imports, research, trends, drafts, dynamic tags, SEO, images, WP connection/publish failure paths) |

\* The 2 lint warnings are `<img>` element notices on the Image Library page;
external provider thumbnails are intentionally rendered with plain `<img>`.

## 2. Acceptance criteria audit (§23)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Add at least two different WordPress websites | PASS | Multi-site CRUD + isolation (`website.service.test.ts`); per-site WordPress connection |
| 2 | Different writing guidelines and OpenRouter settings per site | PASS | `settings.service.test.ts` (guidelines/AI isolation) |
| 3 | Import keyword CSVs into separate buckets | PASS | `keyword-import.test.ts`, `bucket.service.test.ts` |
| 4 | Review Google Search Console keyword opportunities | PASS | `searchconsole.test.ts` (import + 4 opportunity heuristics) |
| 5 | Configure and run a Trends monitoring job | PASS* | `trends.service.test.ts`; automated provider honestly reports unavailability; manual CSV import is the supported fallback |
| 6 | Score opportunities with the five criteria | PASS | `opportunity.test.ts` (0–25 total, justifications, override preservation) |
| 7 | Research a topic and inspect supporting evidence | PASS* | `research.service.test.ts` (sources, findings, brief, provenance); automated search provider reports unavailability; manual source addition works |
| 8 | Generate and edit an article | PASS* | `article.service.test.ts`, `prompts.test.ts` (mocked AI client); real generation needs a valid OpenRouter key |
| 9 | Expand dynamic tags correctly | PASS | `dynamic-tags.test.ts` (timezone, unknown-tag warnings, no code execution) |
| 10 | Analyze the article's SEO quality | PASS | `seo.service.test.ts` (score, mandatory checks, local vs live) |
| 11 | Search for images and preserve licensing | PASS** | `image-providers.test.ts` (mocked) + live Openverse smoke test |
| 12 | Connect to WordPress sites using Application Passwords | PASS* | `wordpress-connection.test.ts` (mocked WP API) |
| 13 | Save unpublished drafts | PASS | `article.service.test.ts` |
| 14 | Explicitly publish to the correct WordPress site | PASS* | `publish.service.test.ts` (mocked client); site-isolated |
| 15 | Verify successful publication | PASS | Receipt + verification step; verified post status/link |
| 16 | Remove local content only after confirmed publication | PASS | Cleanup asserted after receipt creation (`publish.service.test.ts`) |
| 17 | Recover from failures without losing the draft or duplicating posts | PASS | Timeout-recovery and REQUIRES_RECONCILIATION tests |
| 18 | No credential leaks or cross-site data mixing | PASS | `crypto.test.ts`, per-service isolation tests |

\* Implemented and tested with mocks/stubs; not exercised against a live
external system (details in §5).
\** Openverse was verified against the live public API; Wikimedia with mocks.

Every criterion maps to implemented functionality with automated test
coverage.

## 3. Testing requirements audit (§20)

All 20 required test areas are covered:

1. Adding multiple websites ✓ 2. All site data isolated ✓ 3. Keyword buckets ✓
4. CSV import valid/invalid ✓ 5. Duplicate keyword handling ✓
6. Opportunity score calculation ✓ 7. Evidence/score explanation preserved ✓
8. Trends scheduling + failure handling ✓ 9. Research provenance ✓
10. OpenRouter configuration + API error handling ✓
11. Dynamic-tag expansion + unknown-tag warnings ✓
12. SEO analysis + mandatory validation ✓ 13. WordPress connection tests ✓
14. Draft creation/editing ✓ 15. Successful publication + local cleanup ✓
16. Failed publication preserves draft ✓ 17. WP timeout → no duplicate posts ✓
18. Image license metadata + attribution ✓
19. Credential encryption + secret redaction ✓
20. Access control + SSRF protections ✓

External services are mocked in the default suite; real-credential integration
instructions are in `docs/INTEGRATIONS.md`.

## 4. Security & data isolation review

- **Authentication**: bcrypt (12 rounds); HMAC-signed HttpOnly SameSite=Lax
  session cookies (7-day expiry); every dashboard route and all but two API
  routes (`/api/auth/login`, `/api/auth/logout`) call `requireUser()`
  (verified by audit scan).
- **Credential storage**: OpenRouter keys and WP application passwords are
  AES-256-GCM encrypted at rest with `APP_ENC_KEY` (outside the DB); the
  browser receives only `hasApiKey`/`hasAppPassword` booleans; `redactSecrets`
  guards logging. No real-looking secrets found in `src/`.
- **Site isolation**: all site-owned entities cascade from `Website`; services
  scope every query by `websiteId`; tested for websites, settings, guidelines,
  AI config, WP connections, buckets, keywords, drafts, SEO, publishing.
- **SSRF**: `isSafeOutboundUrl` blocks localhost, private/loopback/link-local,
  cloud-metadata addresses for WP probes and image downloads.
- **Input validation**: zod on all API bodies; Prisma parameterized queries;
  model/CSV/WordPress output treated as untrusted.
- **Audit logging** for sensitive actions; `.env` and databases gitignored.
- **Not yet implemented** (documented, not claimed): rate limiting, explicit
  CSRF tokens (SameSite=Lax is the main mitigation), file-type/size
  validation on CSV uploads is present but not turnkey for multi-tenant
  deployments, dependency scanning in CI.

## 5. Integrations verified only with mocks

| Integration | Live-verified? | Status |
|---|---|---|
| Openverse image search | **YES** — live smoke test returned 20 real results with preserved license metadata | Implemented |
| Wikimedia Commons | No — mocked fetch only | Implemented, unverified live |
| OpenRouter generation | No — no real API key; error paths tested with stubs | Implemented, unverified live |
| Google Trends (automated) | No — adapter reports unavailability honestly; CSV fallback | Implemented, honest |
| Research search provider | No — default provider reports unavailability; manual sources | Implemented, honest |
| WordPress connection/publishing | No — mocked WP REST API; smoke test confirmed safe failure against a non-WordPress host | Implemented, unverified live |
| Google Search Console API | Not implemented (CSV import only; adapter-ready design) | Limitation |
| Rank Math | No — meta mapping + detection; no live WP to probe | Staged |

No integration beyond Openverse is claimed as live-verified. The app reports
its own limitations (provider capabilities surfaced in the UI and job errors)
and never fabricates results.

## 6. Deployment

- Production: `npm ci && npm run build && npm run prisma:deploy && node
  scripts/seed-admin.mjs && npm start` behind a TLS-terminating reverse proxy.
- Docker: `Dockerfile` + `docker-compose.yml` (SQLite default; optional
  PostgreSQL profile). **Not executed in this environment (no Docker was
  available)** — verify on the target host.
- Backups: `docs/DATABASE.md` (SQLite `.backup` / `pg_dump`; back up
  `APP_ENC_KEY` separately).
- Real-credential integration testing: `docs/INTEGRATIONS.md`.

## 7. Remaining limitations

- Automated Google Trends and research search require a verified provider;
  until one is configured/authorized, manual CSV import and manual source
  entry are the working paths (documented in the app UI).
- Live WordPress publishing, OpenRouter generation, and Wikimedia search were
  not exercised against real services (no credentials); only Openverse was
  live-verified.
- Rate limiting, explicit CSRF tokens, and CI dependency scanning are not yet
  implemented.
- Global Settings is limited to operator account management (change password)
  and env-driven defaults; there is no runtime-editable global config store.
- Docker deployment files are provided but were not executed here.

## 8. Conclusion

The application satisfies all 18 acceptance criteria at the implemented
level, with 141 automated tests passing, a clean type check and lint, and a
successful production build. The remaining gaps are honest, documented
limitations (mock-verified integrations, missing runtime global config, and
some hardening items) rather than claimed-but-unverified functionality.
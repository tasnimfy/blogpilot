# BlogPilot

A self-hostable, multi-site AI blogging operations platform. Manage multiple
niche WordPress blogs from one dashboard — keyword library, content
opportunity scoring, Google Trends monitoring, research, AI-assisted article
writing, SEO analysis, image discovery, and WordPress publishing.

This repository contains **Phases 1–6 (Foundation + Keyword Intelligence +
Research & Trends + Article Studio + SEO/Images/RankMath + WordPress
Publishing)**, implemented and tested: application shell, authentication, full
database schema + migrations, multi-site management, per-site settings,
encrypted credential storage, keyword buckets, robust CSV + Search Console
imports, duplicate handling, keyword filtering, the five-criterion opportunity
scoring system, research-source configuration, source provenance, research
briefs, provider adapters, daily Google Trends monitoring (with honest access
limitations and manual CSV fallbacks), the Article Studio with OpenRouter
generation, site-specific prompts, dynamic tags, draft-only persistence, an
internal SEO analyzer, image discovery with license/attribution handling,
staged Rank Math compatibility, and secure WordPress publishing with
connection testing, verification, retry safety/reconciliation, and local
draft-content cleanup after confirmed success. Background bulk article
generation is not enabled.

## Tech stack

- **Next.js 14 (App Router)** + **TypeScript** (strict)
- **Tailwind CSS**
- **Prisma ORM** — default **SQLite** (portable single-operator deployment),
  provider-swappable to PostgreSQL
- **Vitest** for automated tests

Why SQLite by default: this is a single-operator tool and the schema is fully
provider-swappable (set `provider = "postgresql"` and change `DATABASE_URL`).
No external database service is required to run or test.

## Quick start (local development)

Prerequisites: Node.js 18+ (developed on Node 24).

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env
#   Then edit .env and set real secrets (see below).

# 3. Create the database and apply migrations
npm run prisma:migrate

# 4. Create the operator account
node scripts/seed-admin.mjs

# 5. Run the dev server
npm run dev
# Open http://localhost:3000 and sign in with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
```

### Generating secrets

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # for AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # for APP_ENC_KEY (must be 64 hex chars)
```

- `AUTH_SECRET` — signs session cookies. Changing it signs everyone out.
- `APP_ENC_KEY` — AES-256 key used to encrypt stored API credentials. If it
  changes, previously stored credentials can no longer be decrypted. Keep it
  out of the database and safe.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Start the production server |
| `npm run typecheck` | TypeScript check |
| `npm test` | Run the automated test suite (uses a separate `prisma/test.db`) |
| `npm run prisma:migrate` | Apply dev migrations |
| `npm run prisma:deploy` | Apply migrations in production |
| `npm run prisma:studio` | Open Prisma Studio |
| `npm run db:reset` | Reset the dev DB and reseed the admin account |
| `npm run test:create-db` | Recreate the test DB |

## Environment variables

See `.env.example` for all variables and comments. Never commit `.env`.

## Database

- Schema: `prisma/schema.prisma`
- Migrations: `prisma/migrations/`
- Dev DB: `prisma/blogpilot.db` (gitignored)

All site-owned records point to `Website` and are deleted via cascade when a
site is removed. Flexible metadata fields are stored as JSON text (SQLite has
no native JSON column in this Prisma version) and parsed in the application
layer.

## Testing

```bash
npm test
```

Tests are isolated and use a separate SQLite file (`prisma/test.db`), created
by the global setup (`tests/setup/global.ts`). External services (OpenRouter,
WordPress, image providers, Google) are mocked — see
`docs/INTEGRATIONS.md` for how to run tests against real credentials.

## Documentation

- [Deployment guide](docs/DEPLOYMENT.md)
- [Database backup & recovery](docs/DATABASE.md)
- [Integrations & real-credential testing](docs/INTEGRATIONS.md)
- [Security notes](docs/SECURITY.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)
- [Implementation report](docs/IMPLEMENTATION_REPORT.md)
- [Audit report (acceptance criteria)](docs/AUDIT.md)

## Project structure

```
src/
  app/            # Next.js App Router: pages + API routes
    api/          # Server-side API (auth, websites, per-site settings)
    dashboard/    # Admin UI (overview, websites, placeholders for later phases)
    login/        # Sign-in page
  components/     # Shared UI primitives
  lib/            # env, prisma, auth, crypto, validation, json, audit, api
  server/         # Business-logic services (site-scoped)
prisma/           # Schema + migrations
scripts/          # seed / db reset / test-db helpers
tests/            # Vitest suite + setup
docs/             # Operator & developer documentation
```

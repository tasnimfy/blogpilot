# Deployment Guide

BlogPilot is a standard Next.js 14 application with a **Prisma-managed database**.
The production image uses Next.js **standalone server output** and runs
migrations + admin seeding automatically on container start.

---

## 1. Production build (local validation)

```bash
npm ci
npx prisma generate
npm run build          # must succeed (Next.js 14 + output: "standalone")
npm run prisma:deploy  # apply pending migrations
node scripts/seed-admin.mjs
npm run start          # = node .next/standalone/server.js  (listens on PORT, default 3000)
```

> **Why not `next start`?** With `output: "standalone"` (required for a clean
> single-container deployment), Next.js 14.2 prints *"next start does not work
> with output: standalone; use node .next/standalone/server.js instead"*. The
> standalone server is the supported entry point and honours the standard
> `PORT` and `HOSTNAME` environment variables.

Run it behind a reverse proxy (Caddy / nginx / Coolify proxy) that terminates
TLS, because login sets a `Secure` cookie only when `NEXT_PUBLIC_APP_URL`
starts with `https`.

---

## 2. Docker image

A multi-stage `Dockerfile` (node:20-alpine) is provided:

- `deps`  → npm ci
- `builder` → prisma generate + next build (standalone output)
- `runner` → full node_modules + .next + prisma + scripts, starts via
  `docker/entrypoint.sh`

`docker/entrypoint.sh` (LF line endings — do not convert to CRLF) does:

1. `mkdir -p /app/data` (SQLite volume mount point)
2. `npx prisma migrate deploy`
3. `node scripts/seed-admin.mjs` (creates/updates the operator login)
4. `exec node .next/standalone/server.js`

Local build/run:

```bash
docker build -t blogpilot .
docker compose up -d --build        # SQLite profile (default)
docker compose --profile postgres up -d --build   # optional PostgreSQL profile
```

---

## 3. Deploying on Coolify (recommended)

### Option A — SQLite (simplest, single operator)

SQLite is the default provider. The app is fully single-operator capable; data
is one file in a persistent volume.

1. Push the repo to GitHub (make sure **`.env` is never committed** — it is in
   `.gitignore`; use `.env.example` as the template).
2. Coolify → **New Resource → Public Repository** → paste the GitHub URL.
3. Build pack: **Dockerfile** (Coolify auto-detects the `Dockerfile`).
4. **General** tab:
   - Base Domain: e.g. `blogpilot.example.com` (proxy + HTTPS auto-enabled)
   - Ports Exposes: `3000`
   - Health Check: path `/login`, or leave Coolify default.
5. **Advanced** tab → **Persistent Storage**: add one volume:

   | Volume | Destination |
   |---|---|
   | any name (e.g. `blogpilot-data`) | `/app/data` |

   This is where the SQLite file lives (`/app/data/blogpilot.db`), so the
   database survives redeploys.
6. **Environment Variables** (set all):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `file:/app/data/blogpilot.db` |
   | `AUTH_SECRET` | 32+ random chars |
   | `APP_ENC_KEY` | exactly 64 hex chars (AES-256 key) |
   | `SEED_ADMIN_EMAIL` | e.g. `admin@example.com` |
   | `SEED_ADMIN_PASSWORD` | initial operator password |
   | `NEXT_PUBLIC_APP_URL` | `https://blogpilot.example.com` (no trailing slash) |
   | `OPENROUTER_API_KEY` | optional — default key for sites without their own |

   Generate secrets:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   # AUTH_SECRET: any 32+ char random string
   # APP_ENC_KEY: the 64-char hex output above
   ```

7. Deploy. On first start the entrypoint creates the schema and seeds the admin,
   then serves the dashboard at your domain.

### Option B — PostgreSQL (multi-operator / heavier use)

1. Start a **PostgreSQL** resource in Coolify (managed database).
2. Copy its internal connection string.
3. **Edit `prisma/schema.prisma`**: change the datasource to
   `provider = "postgresql"`.
4. Regenerate migrations for Postgres (the current migration SQL is SQLite):
   ```bash
   rm -rf prisma/migrations
   DATABASE_URL="postgresql://..." npx prisma migrate dev --name init
   git add prisma/migrations && git commit
   ```
5. Set `DATABASE_URL` to the managed Postgres string (not `file:...`) and
   deploy via the Dockerfile as above. **No volume is needed** for the database;
   Postgres persists in its own volume.

> Migration advisory: schema types are stored as strings (zod-validated in the
> app), so the SQLite → Postgres switch does not require enum rewrites.

---

## 4. Environment in production

Set, at minimum:

- `DATABASE_URL`
- `AUTH_SECRET` (long random)
- `APP_ENC_KEY` (64 hex chars) — **keep a copy privately**; if it changes,
  previously stored API credentials (OpenRouter keys, WordPress app passwords)
  become undecryptable
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`

Validation is strict: the app refuses to start (first API call fails) with an
invalid `APP_ENC_KEY` or a short `AUTH_SECRET`.

---

## 5. Backups

See [docs/DATABASE.md](DATABASE.md).

- SQLite: back up the volume file `/app/data/blogpilot.db` plus the app
  encryption key `APP_ENC_KEY` (store the key separately and securely).
- PostgreSQL: use the provider's dump tooling against the managed database.

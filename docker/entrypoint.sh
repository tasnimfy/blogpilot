#!/bin/sh
set -e

mkdir -p /app/data

echo "Applying database migrations..."
npx prisma migrate deploy

echo "Seeding admin account..."
node scripts/seed-admin.mjs || true

echo "Verifying database connectivity..."
node scripts/db-check.mjs

# Always listen on all interfaces so the proxy/Coolify can reach the app.
export HOSTNAME=${HOSTNAME:-0.0.0.0}

echo "Starting BlogPilot on :${PORT:-3000}..."
exec node .next/standalone/server.js

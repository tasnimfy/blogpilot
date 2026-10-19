#!/bin/sh
set -e

mkdir -p /app/data

echo "Applying database migrations..."
npx prisma migrate deploy

echo "Seeding admin account..."
node scripts/seed-admin.mjs || true

echo "Starting BlogPilot on :${PORT:-3000}..."
exec node .next/standalone/server.js

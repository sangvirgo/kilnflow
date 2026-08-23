#!/bin/sh
set -e

echo "[entrypoint] Waiting for MySQL..."
until node -e "
  const { PrismaClient } = require('@prisma/client');
  new PrismaClient().\$connect().then(() => process.exit(0)).catch(() => process.exit(1));
" 2>/dev/null; do
  sleep 2
done
echo "[entrypoint] MySQL ready."

echo "[entrypoint] Pushing schema to MySQL..."
npx prisma db push --schema=./prisma/schema.prisma --skip-generate

# Seed check: HistoricalBatch count
HCOUNT=$(node -e "
  const { PrismaClient } = require('@prisma/client');
  new PrismaClient().historicalBatch.count()
    .then(c => process.stdout.write(String(c)))
    .catch(() => process.stdout.write('0'))
    .finally(() => process.exit());
" 2>/dev/null || echo "0")

echo "[entrypoint] HistoricalBatch count: $HCOUNT"
if [ "$HCOUNT" = "0" ]; then
  echo "[entrypoint] Seeding database..."
  npx tsx prisma/seed.ts
else
  echo "[entrypoint] Already seeded, skipping."
fi

# Knowledge check: always ingest if empty
KCOUNT=$(node -e "
  const { PrismaClient } = require('@prisma/client');
  new PrismaClient().knowledgeDoc.count()
    .then(c => process.stdout.write(String(c)))
    .catch(() => process.stdout.write('0'))
    .finally(() => process.exit());
" 2>/dev/null || echo "0")

echo "[entrypoint] KnowledgeDoc count: $KCOUNT"
if [ "$KCOUNT" = "0" ]; then
  echo "[entrypoint] Ingesting knowledge base..."
  NODE_OPTIONS="--max-old-space-size=2048" npx tsx src/scripts/ingest-knowledge.ts || true
else
  echo "[entrypoint] Knowledge already ingested, skipping."
fi

echo "[entrypoint] Starting API server..."
exec node dist/src/main.js
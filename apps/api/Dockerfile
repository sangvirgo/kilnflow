# ---- Stage 1: Builder ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/api/package.json ./apps/api/
RUN npm ci --no-audit --no-fund

COPY packages/shared-types/ ./packages/shared-types/
RUN npm run build -w @kilnflow/shared-types

COPY apps/api/ ./apps/api/
RUN cd apps/api && npx prisma generate && npx tsc -p tsconfig.build.json

# ---- Stage 2: Runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache bash

COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared-types ./packages/shared-types
COPY --from=builder /app/apps/api/prisma ./prisma

# Copy ALL src/ for tsx scripts (test-retry-loop, ingest-knowledge)
COPY --from=builder /app/apps/api/src ./src

COPY knowledge-base/ ./knowledge-base/

COPY apps/api/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["./entrypoint.sh"]
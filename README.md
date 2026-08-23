# Kilnflow — Ceramics Manufacturing Pipeline & AI Coordination System

## Problem

A ceramics workshop needs to manage production from order intake through molding, drying, painting, glazing, firing, QC, and packing. Free-text Vietnamese order descriptions must be parsed into structured data, estimated from historical data, risk-reviewed, scheduled into kilns, and tracked through stages with real-time Telegram notifications — all orchestrated by AI agents, not a single monolithic prompt.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                │
│  /order (SSE trace + preview) | / (Kanban) | /kb    │
└────────────────────┬────────────────────────────────┘
                     │ REST + SSE
┌────────────────────▼────────────────────────────────┐
│                   NestJS API (:3001)                 │
│                                                     │
│  ┌──────────────┐                                   │
│  │ Orchestrator  │──→ Parser Agent (Zod + retry)    │
│  │   Service     │──→ Estimator Agent (RAG cosine)  │
│  │              │──→ Risk/QC Agent (review + alert) │
│  └──────────────┘                                   │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │ Orders Svc   │  │ Batches Svc  │──→ State Machine │
│  │ (confirm flow)│  │ (stage log)  │    (no skip)    │
│  └──────────────┘  └──────────────┘                 │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │ Scheduler    │  │ Monitor      │──→ @Interval    │
│  │ Agent (LLM)  │  │ Service      │    (auto-delay) │
│  └──────────────┘  └──────────────┘                 │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │ Knowledge    │  │ Telegram     │──→ Bot API      │
│  │ Agent (RAG)  │  │ Service      │    (no-op if    │
│  └──────────────┘  └──────────────┘     no token)   │
│                                                     │
│  LlmService (Gemini / DeepSeek / Mock)              │
│  EmbeddingService (Gemini / local-hash)             │
│  Prisma + SQLite                                    │
└─────────────────────────────────────────────────────┘
```

### Agent Responsibilities

| Agent | Role | Validation | Self-correction |
|-------|------|-----------|----------------|
| **Parser** | Free-text → structured JSON | Zod schema strict | Up to 2 retries |
| **Estimator** | Improve clay/hours estimates via historical data | Cosine similarity >0.12 threshold | Fallback to formula |
| **Risk/QC** | Pre-production risk review + in-production defect classification | Deterministic fallback if LLM fails | 1 retry then code-based rules |
| **Scheduler** | Assign batches to kilns by priority/deadline/capacity | Sanity re-check + greedy fallback | 1 retry then greedy |
| **Knowledge** | Answer ceramics questions from internal docs | Embedding retrieval + citation | Graceful "no data" message |
| **Monitor** | Detect overdue batches autonomously | Threshold-based (expected × 1.3) | Dedup alerts per stage |

## Quick Start with Docker (Recommended)

```bash
# 1. Copy environment file
cp .env.example .env

# 2. (Optional) Add your Gemini API key for real LLM responses
#    Without it, the system runs in Mock mode (deterministic rule-based)
#    GEMINI_API_KEY=your_key_here

# 3. Start everything
docker compose up --build

# 4. Open in browser
#    Web UI:   http://localhost:3000
#    API:      http://localhost:3001
```

Docker Compose starts 3 services:
- **mysql** (MySQL 8) — persisted via Docker volume `mysql_data`
- **api** (NestJS) — auto-runs migrations + seed on first start, skips on restart
- **web** (Next.js) — connects to API via Docker network

## Manual Setup (Without Docker)
## Setup & Run (Manual)

```bash
# 1. Install dependencies
npm install

# 2. Set up database
npx prisma generate --schema=apps/api/prisma/schema.prisma
npx prisma db push --schema=apps/api/prisma/schema.prisma

# 3. Seed data (12 historical batches + 3 kilns + 4 example batches)
npm run db:seed

# 4. Ingest knowledge base (8 articles about ceramics techniques)
npm run knowledge:ingest

# 5. Start development servers
npm run dev
# → API: http://localhost:3001
# → Web: http://localhost:3000
```

### Environment Variables

Create `apps/api/.env` (or set in root `.env.example`):

```
DATABASE_URL="file:./dev.db"
LLM_PROVIDER=auto          # auto | gemini | deepseek | mock
EMBEDDING_PROVIDER=auto    # auto | gemini | local
# GEMINI_API_KEY=...       # If set, uses Gemini for LLM + embeddings
# DEEPSEEK_API_KEY=...     # If set, uses DeepSeek for LLM
# TELEGRAM_BOT_TOKEN=...   # If missing, Telegram notifications are no-op (logged)
# TELEGRAM_CHAT_ID=...
PORT=3001
WEB_ORIGIN=http://localhost:3000
MONITOR_INTERVAL_MS=300000
MONITOR_ENABLED=true
```

**Without any API key**, the system runs fully in **Mock mode** — all agents produce deterministic rule-based outputs that exercise the complete pipeline (Zod validation, self-correction, error handling, Telegram no-op). Set `GEMINI_API_KEY` to switch to real LLM responses.

## Self-Correction Demo

The Parser Agent retries up to 2 times when LLM output fails Zod validation. Run the proof:

```bash
npm run test:retry-loop
# → 4/4 scenarios pass, including MALFORMED_ONCE (self-correction) and ALWAYS_MALFORMED (clear error)
```

## Key Design Decisions

1. **Human-in-the-loop**: AI output is preview-only; batch is created only after explicit user confirmation.
2. **Business rules in code, not prompts**: Priority derivation (deadline ≤7 → high), stage transitions, and QC severity thresholds are enforced in TypeScript — never delegated to LLM judgment.
3. **Deterministic fallbacks**: Every LLM-dependent agent has a code-based fallback (Parser → rule-based extraction, Estimator → formula, Risk → threshold checks, Scheduler → greedy sort). System works offline.
4. **Single LlmService abstraction**: All agents call one interface; provider swap requires zero agent code changes.
5. **Embeddings consistency**: Seed and query must use the same provider (tracked via `embeddingModel` column) to avoid vector-space mismatch.

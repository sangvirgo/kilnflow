# Kilnflow — Ceramics Manufacturing Pipeline & AI Coordination System

## 1. Project Overview

Kilnflow is a web-based system that helps a ceramics workshop manage and automate its production pipeline. A staff member enters an order description in free-text Vietnamese (e.g. "200 vases, lotus pattern, blue glaze, height 35cm, firing temp 1280°C, deadline 10 days"). The system uses AI agents to parse the order into structured data, estimate material needs based on historical data, flag production risks, schedule kilns, and track each batch through production stages — sending real-time notifications to a Telegram group at every important event.

This is not a simple "call an LLM, get JSON back" tool. The system must demonstrate genuine **multi-agent orchestration**: several specialized AI agents, each with a narrow responsibility, coordinated by an orchestrator, with validation, self-correction, and a human-in-the-loop confirmation step before any AI output becomes committed data.

The system must feel like something that could actually run in a real workshop — not just a tech demo that only works on the happy path.

---

## 2. Tech Stack & Repository Structure

Use a **monorepo**, not two separate repositories:

```
kilnflow/
├── apps/
│   ├── web/              # Next.js (App Router) — frontend only
│   └── api/               # NestJS — all business logic, agents, DB
├── packages/
│   └── shared-types/      # Shared DTOs/interfaces used by both apps
├── package.json           # root, with a "dev" script running both apps concurrently
```

- **Frontend:** Next.js (App Router), TypeScript, Tailwind CSS. Frontend contains NO business logic and NO direct LLM calls — it only renders UI and talks to the NestJS API via REST and SSE (Server-Sent Events).
- **Backend:** NestJS, TypeScript. Owns Prisma, all AI agent logic, Telegram integration, and the autonomous monitoring job.
- **Database:** SQLite via Prisma ORM (simple, file-based, no external DB server required for this project).
- **LLM Provider:** Gemini (Flash-tier model) or DeepSeek, whichever has a working API key available. The LLM client must be abstracted behind a single interface (`LlmService`) so the provider can be swapped without touching agent logic.
- **Embeddings:** Gemini `text-embedding-004` (or equivalent) for the RAG components described below.
- **Chat notifications:** Telegram Bot API (long polling is acceptable for local development; no public webhook required).
- **Validation:** Zod for all AI-generated JSON output. No AI output is trusted or persisted without passing schema validation first.
- **Background jobs:** `@nestjs/schedule` (`@Cron` / `@Interval` decorators) for the autonomous monitor — do not build a separate worker process.
- **Local dev:** a single `npm run dev` at the repo root must start both `apps/web` and `apps/api` concurrently (use the `concurrently` package).

CORS must be enabled on the NestJS side for the Next.js origin.

---

## 3. Production Stage Model

Every batch of ceramics moves through these stages, in this exact order:

```
MOLDING → DRYING_TRIMMING → PAINTING → GLAZING → FIRING → QC_PACKING → DONE
```

A batch can only move forward one stage at a time (no skipping stages) through the normal workflow UI. Each stage transition must be logged and must trigger a Telegram notification.

---

## 4. Data Model (Prisma)

Implement the following models (adjust field types as needed, but keep all fields listed):

```prisma
model Order {
  id          String   @id @default(cuid())
  rawText     String
  parsedJson  Json
  confidence  Float?
  assumptions Json?
  createdAt   DateTime @default(now())
  batches     Batch[]
}

model Batch {
  id             String     @id @default(cuid())
  batchCode      String     @unique
  orderId        String
  order          Order      @relation(fields: [orderId], references: [id])
  productName    String
  currentStage   String     @default("MOLDING")
  priority       String     // "high" | "medium" | "low"
  glazeType      String?
  firingTempC    Int?
  estimatedClayKg Float?
  estimatedFiringHours Float?
  quantity       Int
  deadlineDays   Int?
  defectCount    Int        @default(0)
  kilnId         String?
  scheduledStart DateTime?
  lastStageChangeAt DateTime @default(now())
  createdAt      DateTime   @default(now())
  logs           StageLog[]
  alerts         Alert[]
}

model StageLog {
  id        String   @id @default(cuid())
  batchId   String
  batch     Batch    @relation(fields: [batchId], references: [id])
  stage     String
  enteredAt DateTime @default(now())
  note      String?
}

model Alert {
  id        String   @id @default(cuid())
  batchId   String
  batch     Batch    @relation(fields: [batchId], references: [id])
  level     String   // "info" | "warning" | "critical"
  message   String
  source    String   // which agent/system raised this alert
  createdAt DateTime @default(now())
}

model Kiln {
  id        String   @id @default(cuid())
  name      String
  capacity  Int      @default(1)   // number of batches it can fire at once
}

model HistoricalBatch {
  id             String @id @default(cuid())
  productName    String
  pattern        String?
  heightCm       Float?
  glazeType      String?
  actualClayKg   Float
  actualFiringHours Float
  embedding      Bytes  // stored vector for similarity search
  createdAt      DateTime @default(now())
}

model KnowledgeDoc {
  id        String   @id @default(cuid())
  title     String
  sourceUrl String?
  chunks    KnowledgeChunk[]
}

model KnowledgeChunk {
  id         String   @id @default(cuid())
  docId      String
  doc        KnowledgeDoc @relation(fields: [docId], references: [id])
  content    String
  embedding  Bytes
  chunkIndex Int
}
```

---

## 5. Agent Architecture

There is **one Orchestrator** and **five specialized agents**. The Orchestrator does NOT do any parsing or estimation itself — it only calls the right agent(s) in the right order and assembles the final response.

### 5.1 Parser Agent (mandatory)

**Responsibility:** convert free-text Vietnamese order descriptions into structured JSON.

- Uses a system prompt with explicit rules and a strict output schema (see below).
- Must include at least one few-shot example in the prompt.
- Output is validated with Zod immediately after the LLM call.
- **Self-correction loop:** if validation fails, send the error back to the LLM (include the broken output and the validation error message) and ask it to correct itself. Retry up to 2 times. If it still fails after 2 retries, throw a clear error that the API surfaces to the frontend (do not silently swallow failures).
- Target JSON schema:

```json
{
  "product_name": "string",
  "pattern": "string | null",
  "glaze_color": "string | null",
  "height_cm": "number | null",
  "quantity": "number",
  "firing_temp_c": "number",
  "estimated_clay_kg": "number",
  "glaze_type": "string",
  "estimated_firing_hours": "number",
  "priority": "high | medium | low",
  "deadline_days": "number | null",
  "assumptions": "string[]"
}
```

- `priority` derivation rule: `deadline_days <= 7` → `high`; `8–15` → `medium`; `>15` → `low`.
- Any field the model had to guess (not explicitly present in the input text) must be listed in `assumptions` with a short explanation.
- The Parser Agent call should support streaming/step logging (see Section 7 — Reasoning Trace) so the frontend can show progress instead of a blank loading spinner.

### 5.2 Estimator Agent (mandatory, RAG-based)

**Responsibility:** improve the `estimated_clay_kg` and `estimated_firing_hours` values from the Parser Agent by retrieving similar historical batches instead of relying purely on a static formula.

- On startup (via seed script, see Section 9), the `HistoricalBatch` table must be pre-populated with realistic past batches, each with a precomputed embedding of a text description (`product_name + pattern + height_cm + glaze_type`).
- When estimating a new order:
  1. Compute an embedding of the new order's description.
  2. Retrieve the top-k (k=3) most similar `HistoricalBatch` rows by cosine similarity.
  3. If similar batches are found, compute a weighted estimate from their `actualClayKg` / `actualFiringHours` and return `confidence: "high"` along with which batch codes were used as the basis.
  4. If no similar batches exist (cold start), fall back to a static formula (e.g. `clay_kg ≈ (height_cm / 10) * 0.6 * quantity`) and return `confidence: "low"`.
- This agent's output must be visible to the user (which historical batches it used, or that it fell back to a formula) — this transparency is a functional requirement, not just a nice-to-have.

### 5.3 Risk / QC Agent (mandatory)

**Responsibility:** critically review the Parser Agent's output before it becomes a committed batch, and continuously assess QC issues raised during production.

- **Pre-production review:** given the parsed order JSON and current kiln availability, the agent must evaluate:
  - Is the firing temperature consistent with the chosen glaze type?
  - Is the deadline realistic given current kiln capacity/backlog?
  - Is the estimated clay quantity unusually different from similar historical batches?
  - Output: `{"risks": [{"type": string, "severity": "low"|"medium"|"high", "detail": string}], "recommend_proceed": boolean}`.
  - If `recommend_proceed` is false, an `Alert` must be created and a Telegram message sent BEFORE the batch is allowed into production (the human user can still override and proceed manually — this is not a hard block, just a strong warning).
- **In-production QC review:** when a user reports a defect count/note at the `QC_PACKING` stage (e.g. "10 out of 200 products have glaze cracks"), the agent must:
  - Calculate the defect rate.
  - Classify severity: `critical` if defect rate > 15% (or if certain severe keywords like structural cracking/breakage appear with high counts), `warning` if 5–15%, `info` if below 5%.
  - Generate a ready-to-send Telegram alert message in Vietnamese, appropriately toned to the severity.

### 5.4 Scheduler Agent (mandatory, can be simplified if time-constrained)

**Responsibility:** assign pending batches to available kilns, respecting priority, deadlines, and kiln capacity.

- Input: list of un-scheduled/pending batches + list of `Kiln` records with capacity.
- The agent must produce a proposed schedule: which batch goes to which kiln and roughly when, prioritizing `high` priority and near-deadline batches first.
- If not all batches can be scheduled within their deadlines given kiln capacity, the agent must explicitly identify which batches will be delayed and suggest a mitigation (e.g. combine firing batches, add an extra shift).
- Output: `{"schedule": [{"batchCode": string, "kilnId": string, "startTime": string}], "delayed_batches": [{"batchCode": string, "reason": string, "suggestion": string}]}`.
- If time is short, a simplified deterministic version (sort by priority then deadline, greedily assign to first available kiln) is acceptable, but the LLM-based reasoning version is strongly preferred since it demonstrates real constraint-solving intelligence.

### 5.5 Knowledge Agent (optional / bonus — build only if core features are complete)

**Responsibility:** answer user questions about ceramics craftsmanship, citing sources, using RAG over a small internal knowledge base (not the live web).

- **Ingestion pipeline:** a script that reads a folder of markdown documents (`knowledge-base/*.md`), chunks each document (~500 tokens, ~50 token overlap), computes an embedding per chunk, and stores everything in `KnowledgeDoc` / `KnowledgeChunk`. Each source markdown file should end with a `Nguồn: <title> - <url>` line; the ingestion script must parse this out and store it as `sourceUrl`.
- **Query flow:** embed the user's question → retrieve top-k (k=4) most similar chunks → construct a prompt instructing the model to answer ONLY using the provided chunks, cite `[Source N]` inline, and explicitly say "not found in the documents" if the retrieved context is insufficient.
- **Response must include** the answer text AND a structured list of sources used (title, url, short snippet) so the frontend can render a "References" section — this citation requirement is not optional; an answer with no visible sourcing does not satisfy this feature.
- This chatbot should live on its own page/route and must not interfere with the main order/production workflow if left unbuilt due to time constraints.

### 5.6 Autonomous Monitor (mandatory, not a conversational agent)

**Responsibility:** proactively detect batches that are taking longer than expected at their current stage, without any user asking.

- Implemented as a NestJS scheduled job (`@Interval` every 5 minutes is a reasonable default for a demo — do not hardcode absurdly long intervals that make the feature untestable).
- For each active batch (not `DONE`), compare `lastStageChangeAt` against an expected duration for that stage (expected durations can be reasonable hardcoded constants per stage, or derived from `firingTempC`/`estimatedFiringHours` for the `FIRING` stage specifically).
- If a batch has exceeded its expected duration by a meaningful margin (e.g. 30%+), create a `warning` Alert and send a Telegram notification automatically — this must happen without any user interaction, to demonstrate genuine autonomous behavior rather than a reactive chatbot.

---

## 6. Human-in-the-Loop Requirement (mandatory)

AI output must never silently become committed production data. The required flow is:

1. User submits raw order text.
2. Parser Agent → Estimator Agent → Risk Agent run and produce a combined preview (structured JSON + risk flags + estimation basis).
3. This preview is shown to the user on the frontend BEFORE anything is written to the `Batch` table.
4. Only after the user explicitly confirms (a "Create Batch" button) does the system persist the batch and generate a `batchCode`.

This confirmation step is a hard requirement, not an optional UX nicety — it demonstrates that the system treats AI output as a proposal requiring human review, not ground truth.

---

## 7. Reasoning Trace / Transparency Requirement

For the Parser Agent (and ideally the Estimator Agent), the backend must expose a way for the frontend to see intermediate reasoning steps in near real-time rather than only the final JSON result. Suggested approach: a NestJS SSE endpoint (`@Sse()`) that streams short status messages as the agent works, e.g.:

```
🔍 Parsing order description...
📦 Looking up similar historical batches...
✓ Found 3 similar batches, adjusting estimate...
⚠️ Checking clay inventory / kiln capacity...
✓ Analysis complete — confidence: high
```

The frontend should render these as a live-updating log/timeline rather than a blank spinner. This is an important part of demonstrating "agentic" behavior rather than a single blocking API call.

---

## 8. Telegram Integration

- Use `node-telegram-bot-api` or the official Bot API via HTTP directly — either is acceptable.
- Required notification events:
  - Batch created (after human confirmation).
  - Every stage transition (e.g. "Batch #GOM-88 has entered Firing — target temp 1280°C").
  - Pre-production risk warning (from Risk Agent) when `recommend_proceed` is false.
  - QC defect alert (from Risk Agent's in-production review), styled by severity (info/warning/critical — use different emoji per level).
  - Autonomous monitor delay warnings.
- **Bonus (build only if core is done):** Telegram inline keyboard buttons allowing a staff member to confirm stage completion directly from the chat, with a webhook/callback handler on the NestJS side that advances the batch's stage and re-triggers the normal transition logic (do not duplicate logic — the callback handler should call the same service method the web UI uses).

---

## 9. Seed Data (mandatory — do not skip)

Without seed data, both the Estimator Agent (no historical batches to retrieve) and the Scheduler Agent (no kilns, no pending batches) will have nothing to demonstrate. The seed script must create:

- 10–15 `HistoricalBatch` records with realistic, varied ceramics production data (different products, heights, glazes, clay/firing figures) — each with a precomputed embedding.
- 2–3 `Kiln` records with names and capacities.
- Optionally, 3–5 example `Order`/`Batch` records at various stages, so the Kanban dashboard is not empty on first load.

---

## 10. API Surface (NestJS) — indicative, adjust as needed

- `POST /orders/parse` — runs Parser + Estimator + Risk agents, returns preview (does NOT persist a batch).
- `POST /orders/confirm` — persists the previewed result as an `Order` + `Batch`.
- `GET /orders/parse/stream` (SSE) — reasoning trace for the above.
- `GET /batches` — list all batches (for Kanban board).
- `PATCH /batches/:id/stage` — advance a batch to the next stage (triggers logging + Telegram).
- `POST /batches/:id/qc-report` — submit a QC defect note, triggers Risk Agent QC classification + alert.
- `POST /scheduler/run` — triggers Scheduler Agent over current pending batches and kilns.
- `POST /knowledge/ask` — Knowledge Agent Q&A endpoint (bonus).
- `GET /alerts` — list alerts (for a dashboard alerts panel).

---

## 11. Frontend Requirements (Next.js)

The UI does not need to be visually elaborate — the evaluation explicitly treats UI as a bonus, not the main focus — but it must be functional and clearly show the automation working. Required screens:

1. **New Order form** — textarea for raw order description, submit triggers the parse preview flow with the live reasoning trace, shows the resulting JSON/risk/estimation preview, and a confirm button to create the batch.
2. **Kanban Dashboard** — one column per production stage, batch cards showing batch code, priority, key specs, and a way to advance a batch to the next stage.
3. **Alerts panel** — a simple feed of recent alerts with severity indicators.
4. **(Bonus) Knowledge chat page** — simple Q&A interface with a visible "Sources" section under each answer.

---

## 12. Non-Functional Requirements

- All AI-facing code must be centralized behind a single `LlmService` (or similar) abstraction — no agent should construct its own raw HTTP call to the LLM provider directly.
- All AI JSON output must be schema-validated before use; never trust raw LLM output directly in business logic.
- Errors from the LLM provider (timeouts, malformed output after retries, rate limits) must surface as clear error states in the API response — do not let them crash the server or fail silently.
- Environment variables required: `GEMINI_API_KEY` (or `DEEPSEEK_API_KEY`), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DATABASE_URL`.
- Code should be organized into clear NestJS modules: `agents/` (one file per agent), `orders/`, `batches/`, `telegram/`, `scheduler/`, `knowledge/`, `monitor/`.

---

## 13. Deliverables

1. **GitHub repository** with full source code and a `README.md` that includes:
   - The problem being solved.
   - The system architecture (should include the agent diagram described in Section 5).
   - Setup and run instructions (env vars, seed command, dev command).
   - A short explanation of each agent's role and why it was designed that way.
2. **A 2–3 minute demo video** walking through: submitting an order, watching the reasoning trace, seeing the estimation/risk preview, confirming the batch, advancing stages with live Telegram notifications, triggering a QC alert, running the scheduler with multiple pending batches, and (if built) the knowledge chatbot with visible sources.

---

## 14. What "Good" Looks Like Here

The system should look like a real internal tool a small ceramics workshop could plausibly use — not a toy that only works when the input matches the few-shot example exactly. Prioritize:

1. A parsing pipeline that validates and self-corrects rather than trusting raw LLM output.
2. Agents with clearly separated responsibilities, coordinated by an orchestrator — not one giant prompt doing everything.
3. Historical-data-driven estimation (RAG) that visibly improves as more batches are recorded, with a clear fallback when no history exists.
4. A human confirmation step before AI output becomes committed data.
5. Proactive, autonomous monitoring — not just reactive request/response behavior.
6. Clear, honest handling of failure cases (bad AI output, no historical data, kiln overcapacity) rather than only demonstrating the happy path.

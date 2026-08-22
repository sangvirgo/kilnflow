# Kilnflow — Execution Plan

> Phân bổ theo trọng số chấm điểm: Core Logic 40% > AI Integration 30% > README/Demo 15% = UI 15%.
> Nguyên tắc cắt giảm khi thiếu thời gian: cắt UI trước — KHÔNG cắt validation/error-handling/retry của Core Logic hay chất lượng prompt của AI agents.

## Phase 0 — Planning (hiện tại)
- Xác nhận kiến trúc: 1 Orchestrator + 5 agents (Parser, Estimator, Risk/QC, Scheduler, Knowledge) + Autonomous Monitor.
- Orchestrator KHÔNG parse/tự ước lượng — chỉ điều phối agent đúng thứ tự và lắp response.
- Human-in-the-loop: AI output chỉ là PREVIEW; chỉ persist Batch sau khi user bấm Confirm.

### Modules NestJS (apps/api/src)
| Module | Nội dung |
|---|---|
| llm/ | LlmService interface + GeminiProvider / DeepSeekProvider / MockProvider (offline demo), transport retry + timeout |
| embeddings/ | EmbeddingService: Gemini text-embedding-004 khi có key, fallback local hashed-bow (deterministic, cùng vector-space seed↔query) |
| agents/ | parser.agent, estimator.agent, risk-qc.agent, scheduler.agent, orchestrator.service, schemas (Zod) |
| orders/ | POST /orders/parse, POST /orders/confirm, GET /orders/parse/stream (SSE reasoning trace) |
| batches/ | GET /batches, PATCH /batches/:id/stage (state machine), POST /batches/:id/qc-report |
| telegram/ | TelegramService (no-op có log khi thiếu token), notify mọi event quan trọng |
| scheduler/ | POST /scheduler/run — LLM scheduling + fallback greedy deterministic |
| knowledge/ | POST /knowledge/ask (RAG + citation), ingestion script |
| monitor/ | @Interval job + POST /monitor/tick (trigger tay cho demo) |
| prisma/, config/ | PrismaService, configuration |

### Routes Next.js (apps/web)
| Route | Màn hình |
|---|---|
| / | Kanban dashboard theo stage + Alerts panel + nút chạy Scheduler + QC report |
| /order | Form đơn hàng mới + reasoning trace live (SSE) + preview + Confirm |
| /knowledge | Chatbot hỏi đáp kèm mục Nguồn |

## Phase 1 — Infra & Data Layer
Root package.json (workspaces + concurrently), packages/shared-types (DTO + Zod schema dùng chung), Prisma schema đầy đủ 7 models, migration SQLite, seed 12 HistoricalBatch (embedding thật qua API nếu có key, ngược lại hashed-bow nhất quán) + 3 Kiln + vài Batch mẫu nhiều stage, LlmService abstraction. Commit riêng.

## Phase 2 — Core Logic (40%)
- ParserAgent: system prompt + few-shot + Zod strict; self-correction loop tối đa 2 lần (gửi lại broken output + lỗi validate); derive priority theo rule deadline (<=7 high, 8–15 medium, >15 low) thực hiện trong CODE để đảm bảo đúng luật; field đoán → assumptions[].
- Orchestrator: Parser → Estimator → Risk, lắp PreviewPayload, phát reasoning-trace events.
- Orders flow: parse (không persist) → confirm (persist + StageLog khởi tạo + Telegram).
- Batches state machine: STAGES cố định, chỉ cho tiến 1 bước, cấm nhảy cóc, log + Telegram mỗi transition.
- Error handling: LlmTimeoutError / LlmRateLimitError / AgentValidationError / AgentFailedError -> error envelope thống nhất, HTTP status rõ ràng, không crash server, không nuốt lỗi.
- Bằng chứng retry loop: script chạy 4 scenario (input tốt / thiếu thông tin / LLM trả sai schema 1 lần rồi sửa / sai mãi -> fail rõ ràng) bằng MockProvider.

## Phase 3 — AI Integration (30%)
- EstimatorAgent: embed mô tả mới -> top-3 HistoricalBatch cosine similarity -> trung bình có trọng số, confidence high + liệt kê basis; cold-start -> công thức, confidence low.
- Risk/QCAgent: pre-production review (men vs nhiệt độ, deadline vs backlog, chênh lệch clay vs history) -> {risks, recommend_proceed}; false -> Alert + Telegram trước khi vào sản xuất (user vẫn override được). QC: tính defect-rate + severity THEO NGƯỠNG TRONG CODE (>15% critical, 5–15% warning, <5% info + keyword nghiêm trọng) — LLM chỉ soạn message tiếng Việt, không giao quyền phân loại cho LLM.
- SchedulerAgent: prompt ràng buộc capacity/priority/deadline, output Zod-validate, kiểm tra lại ràng buộc trong code, fallback greedy sort(priority,deadline) nếu LLM hỏng; báo danh sách trễ + mitigation.

## Phase 4 — Frontend (15%, trần ~1 ngày)
3 trang tối giản Tailwind như bảng route ở trên. SSE render timeline trace. Không đầu tư UI framework nặng.

## Phase 5 — Monitor + Knowledge (làm song song từ đầu phần research)
- Monitor: @Interval 5 phút (env override) so lastStageChangeAt vs expected duration từng stage, vượt 30% -> Alert warning + Telegram, chống spam alert trùng; thêm /monitor/tick để demo.
- Knowledge: subagent research 6–8 bài kỹ thuật gốm -> knowledge-base/*.md (kết thúc bằng dòng "Nguồn: title - url"); ingestion chunk ~500 token overlap ~50 -> embed -> KnowledgeChunk; /knowledge/ask trả lời CHỈ dựa context + [Source N] + danh sách nguồn có URL.

## Phase 6 — Deliverables
README.md (bài toán -> sơ đồ mermaid -> cài đặt/chạy -> giải thích từng agent) + docs/demo-script.md kịch bản video 2–3 phút theo trình tự spec.

## Rủi ro kỹ thuật & cách xử lý
1. Không có API key trong môi trường này -> Mock provider offline chạy đủ pipeline demo/test; đặt GEMINI_API_KEY/DEEPSEEK_API_KEY là tự chuyển provider thật, không đổi code agent. (Quyết định kiến trúc bắt buộc bởi môi trường.)
2. Rate limit / timeout LLM -> backoff cấp transport (429/5xx, timeout 45s) + retry cấp agent + error envelope rõ.
3. Embedding trên SQLite -> lưu Bytes (Float32 buffer), cosine tính trong JS (dataset nhỏ); seed và query PHẢI cùng một provider để không lệch vector-space.
4. SSE trên NestJS -> @Sse + Subject, heartbeat định kỳ, tắt compression cho endpoint đó; EventSource chỉ GET nên text truyền bằng query param.
5. LLM JSON méo -> Zod + self-correction <=2 lần -> fail có message rõ cho frontend.
6. Thiếu Telegram token -> no-op + warn log, không chặn luồng chính.
7. Scheduler LLM bất định -> validate Zod + kiểm tra capacity lại trong code + fallback thuật toán tham lam.
8. Monitor báo giả -> margin 30% + dedupe alert theo (batch, stage).

## Song song hoá
- Research knowledge-base: subagent nền, chạy từ Phase 0.
- Viết file: chia cụm độc lập (shared-types <-> prisma/schema <-> llm providers) ghi song song; npm install chạy nền trong lúc viết source.
- Tuần tự bắt buộc: schema -> migrate/seed -> agents -> orders/batches -> frontend gọi contract từ shared-types.

# Kilnflow Video Demo Script (2-3 minutes)

## Scene 1: Submit Order (0:00 - 0:30)
- Navigate to `/order`
- Type: "200 lọ hoa hoa văn sen men xanh ngọc cao 35cm, nung 1280°C, cần gấp 10 ngày"
- Click "Phân tích đơn hàng"
- Watch reasoning trace appear live via SSE:
  - 🔍 Parsing order description...
  - 📦 Looking up similar historical batches...
  - ✓ Found 3 similar batches, adjusting estimate...
  - 🧪 Checking risk...

## Scene 2: Preview & Risk Review (0:30 - 1:00)
- Point out the parsed JSON table (product, quantity, firing temp, priority)
- Highlight the **Estimation** section: "RAG found 3 historical batches, high confidence"
- Show the **Risk** section: green "✅ Recommend proceed" or yellow warnings
- Note: "AI output is a PROPOSAL — not committed data yet"

## Scene 3: Confirm Batch (1:00 - 1:20)
- Click "Xác nhận tạo Batch"
- ✅ Batch GOM-005 created in MOLDING stage
- Navigate to Kanban dashboard (`/`)
- See the new batch card in MOLDING column

## Scene 4: Advance Stages + Telegram (1:20 - 1:50)
- Click "Tiến stage" on GOM-005 several times: MOLDING → DRYING_TRIMMING → PAINTING → GLAZING → FIRING
- Each click triggers a Telegram notification (or log if no token)
- Show the stage transition log on each card

## Scene 5: QC Alert (1:50 - 2:10)
- When batch reaches QC_PACKING, submit a defect report:
  - defectCount: 30, note: "Nứt men trên 30 sản phẩm"
- Risk/QC agent classifies severity (30/200 = 15% → CRITICAL)
- Telegram alert fires with Vietnamese message

## Scene 6: Scheduler (2:10 - 2:30)
- Click "Chạy Scheduler" button
- Shows: "Scheduler: X batches assigned, Y batches delayed"
- Or POST `/scheduler/run` via curl

## Scene 7: Knowledge Chat (2:30 - 2:45) [bonus]
- Navigate to `/knowledge`
- Ask: "Nhiệt độ nung stoneware là bao nhiêu?"
- Answer with inline citations [Source 1], visible sources section at bottom

## Scene 8: Monitor (2:45 - 3:00) [bonus]
- POST `/monitor/tick` — detect GOM-001 (FIRING for 26h, threshold ~21h)
- Alert appears in dashboard: "🐢 BATCH TRỄ TIẾN ĐỘ (tự động phát hiện)"

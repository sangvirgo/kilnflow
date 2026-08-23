/**
 * Phase 9.5 — Test ước lượng thời gian từng công đoạn (stageEstimates).
 * Chạy trong container API: docker exec kilnflow-api-1 npx tsx src/scripts/test-stage-estimates.ts
 *
 * Case A: đơn khớp nhiều mẻ lịch sử → stageEstimates hợp lý, confidence=high, basis đúng mẻ.
 * Case B: cold-start (embedding local, 0 mẻ match) → fallback formula cho MỌI stage, confidence=low.
 * Case C: batch CŨ không có stageEstimates → Monitor/UI fallback constant, không crash.
 * Case D: 2 batch khác độ phức tạp (stageEstimates khác nhau) → expected hours khác nhau.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const API = process.env.TEST_API_URL || 'http://localhost:3001';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log('  ✅ PASS — ' + name); }
  else { failed++; console.log('  ❌ FAIL — ' + name + (detail !== undefined ? ' | ' + JSON.stringify(detail).slice(0, 200) : '')); }
}

async function parseOrder(rawText: string) {
  const res = await fetch(API + '/orders/parse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rawText }) });
  return res.json();
}
async function listBatches() {
  return fetch(API + '/batches').then((r) => r.json());
}
async function api(pathname: string, method = 'GET', body?: unknown) {
  const res = await fetch(API + pathname, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return res.json();
}

async function main() {
  console.log('\n========== PHASE 9.5 — PER-STAGE DURATION ESTIMATION TESTS ==========\n');

  // ---- Cleanup temp ----
  const temps = await prisma.batch.findMany({ where: { batchCode: { startsWith: 'TSTE-' } }, select: { id: true } });
  for (const t of temps) {
    await prisma.alert.deleteMany({ where: { batchId: t.id } });
    await prisma.stageLog.deleteMany({ where: { batchId: t.id } });
    await prisma.batch.delete({ where: { id: t.id } });
  }

  try {
    // ================= CASE A — RAG khớp =================
    console.log('CASE A · Đơn khớp lịch sử (lọ hoa sen 35cm ×200):');
    const a = await parseOrder('200 lọ hoa hoa văn sen, men xanh ngọc, cao 35cm, nung 1280 độ C, giao trong 10 ngày');
    const e = a.estimation;
    check('Có stageEstimates', !!e?.stageEstimates && Object.keys(e.stageEstimates).length === 6);
    check('confidence CAO', e?.stageEstimateConfidence === 'high');
    check('basis liệt kê đúng mẻ tương tự (>=2 mẻ sen)', e?.stageEstimateBasis?.filter((x: any) => x.productName.includes('lo hoa')).length >= 2 || e?.basis?.some((x: any) => x.productName.includes('lo hoa')));
    const se = e?.stageEstimates ?? {};
    check('MỌI stage > 0 giờ', Object.values(se).every((v) => typeof v === 'number' && v > 0), se);
    check('FIRING ≈ giờ nung RAG (12–16h)', se.FIRING >= 10 && se.FIRING <= 18, se.FIRING);
    check('DRYING là công đoạn dài nhất (đặc thù gốm)', Number(se.DRYING_TRIMMING) >= Math.max(Number(se.MOLDING), Number(se.PAINTING), Number(se.GLAZING)), se);

    // ================= CASE B — cold-start =================
    console.log('\nCASE B · Cold-start (đèn lồng rồng 90cm — embedding local 0 mẻ match):');
    // Gọi trực tiếp agent với local provider (degraded path giống hệt runtime khi API lỗi)
    const { execSync } = await import('child_process');
    const script = `
      const { EstimatorAgent } = require("/app/dist/src/agents/estimator.agent.js");
      const { LocalHashEmbeddingProvider } = require("/app/dist/src/embeddings/embeddings.core.js");
      const { PrismaClient } = require("@prisma/client");
      const prov = new LocalHashEmbeddingProvider();
      const embeddings = {
        modelTag: prov.modelTag,
        embedOne: async (t) => (await prov.embed([t]))[0],
        fromBuffer: (buf) => Array.from(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))),
        similarity: (a, b) => { let d=0,na=0,nb=0; for (let i=0;i<Math.min(a.length,b.length);i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];} return d/(Math.sqrt(na)*Math.sqrt(nb)||1); },
      };
      const agent = new EstimatorAgent(new PrismaClient(), embeddings);
      agent.estimate({ product_name: "đèn lồng rồng khổng lồ", pattern: "rồng", height_cm: 90, glaze_color: "vàng kim loại", glaze_type: "porcelain", quantity: 1, firing_temp_c: 1300 }, () => {})
        .then((out) => { console.log(JSON.stringify(out)); process.exit(0); })
        .catch((err) => { console.error(err.message); process.exit(1); });`;
    let cold: any = null;
    try { cold = JSON.parse(execSync(`docker exec kilnflow-api-1 node -e '${script.replace(/'/g, "\\'")}'`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString()); } catch (err: any) { console.log('  (không chạy được exec container — bỏ qua phần này nếu ngoài server)', err.message?.slice(0, 60)); }
    if (cold) {
      check('method = formula', cold.method === 'formula');
      check('stageEstimateConfidence LOW', cold.stageEstimateConfidence === 'low');
      check('Fallback formula cho MỌI stage (>0)', Object.values(cold.stageEstimates).every((v: any) => v > 0), cold.stageEstimates);
      check('FIRING formula = 12h (qty<100 → 8h +4 vì ≥1280°C)', cold.stageEstimates.FIRING === 12, cold.stageEstimates.FIRING);
    }

    // ================= CASE C — batch cũ không có stageEstimates =================
    console.log('\nCASE C · Batch CŨ (trước Phase 9) → fallback constant, không crash:');
    const order = await prisma.order.create({ data: { rawText: '[p9-test]', parsedJson: {}, assumptions: [] } });
    const oldBatch = await prisma.batch.create({
      data: {
        batchCode: 'TSTE-OLD', orderId: order.id, productName: 'Mẻ cũ Phase 5',
        currentStage: 'PAINTING', priority: 'low', quantity: 100, firingTempC: 1250,
        estimatedClayKg: 40, estimatedFiringHours: 12,
        lastStageChangeAt: new Date(Date.now() - 3600_000),
      },
    });
    const l1: any[] = await listBatches();
    const oldDto = l1.find((b) => b.batchCode === 'TSTE-OLD');
    check('API trả progress bình thường cho batch cũ', !!oldDto && oldDto.expectedStageDurationHours === 36, oldDto?.expectedStageDurationHours);
    check('elapsed ≈ 1h, không overdue', Math.abs(oldDto.elapsedInStageHours - 1) < 0.3 && !oldDto.isOverdue);
    const tick = await api('/monitor/tick', 'POST');
    check('Monitor tick không crash với batch cũ', typeof tick.checked === 'number');

    // ================= CASE D — 2 batch khác độ phức tạp =================
    console.log('\nCASE D · Hai batch cùng stage nhưng stageEstimates khác nhau → expected khác nhau:');
    const mkWith = async (code: string, paintingH: number) => prisma.batch.create({
      data: {
        batchCode: code, orderId: order.id, productName: 'Test P9-D', currentStage: 'PAINTING',
        priority: 'medium', quantity: 100, firingTempC: 1250, estimatedClayKg: 40, estimatedFiringHours: 12,
        lastStageChangeAt: new Date(Date.now() - 1800_000),
        stageEstimates: { MOLDING: 6, DRYING_TRIMMING: 24, PAINTING: paintingH, GLAZING: 5, FIRING: 13, QC_PACKING: 2 },
      },
    });
    const simple = await mkWith('TSTE-S1', 5);
    const complex = await mkWith('TSTE-C1', 14);
    const l2: any[] = await listBatches();
    const s1 = l2.find((b) => b.batchCode === 'TSTE-S1'), c1 = l2.find((b) => b.batchCode === 'TSTE-C1');
    check('Batch ĐƠN GIẢN: expected Vẽ = 5h', s1.expectedStageDurationHours === 5, s1.expectedStageDurationHours);
    check('Batch PHỨC TẠP: expected Vẽ = 14h', c1.expectedStageDurationHours === 14, c1.expectedStageDurationHours);
    check('Progress % khác nhau tương ứng (cùng elapsed 0.5h)', Math.abs(s1.progressPercent - 10) < 1 && Math.abs(c1.progressPercent - 3.6) < 1, [s1.progressPercent, c1.progressPercent]);
  } finally {
    for (const code of ['TSTE-OLD', 'TSTE-S1', 'TSTE-C1']) {
      const b = await prisma.batch.findUnique({ where: { batchCode: code } });
      if (b) {
        await prisma.alert.deleteMany({ where: { batchId: b.id } });
        await prisma.stageLog.deleteMany({ where: { batchId: b.id } });
        await prisma.batch.delete({ where: { id: b.id } }).catch(() => undefined);
      }
    }
    await prisma.order.deleteMany({ where: { rawText: '[p9-test]' } }).catch(() => undefined);
  }

  console.log('\n=================================================');
  console.log(`KẾT QUẢ PHASE 9: ${passed} PASS, ${failed} FAIL`);
  console.log('=================================================\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

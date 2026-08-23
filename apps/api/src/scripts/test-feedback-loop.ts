/**
 * Phase 9.6 — Vòng lặp học từ dữ liệu thật:
 * - Mỗi transition ghi durationHours thực vào StageLog
 * - Batch DONE → tự tạo HistoricalBatch (kèm stageDurationsHours đo được) → RAG học
 *
 * Chạy trong container API: docker exec kilnflow-api-1 npx tsx src/scripts/test-feedback-loop.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const API = process.env.TEST_API_URL || 'http://localhost:3001';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log('  ✅ PASS — ' + name); }
  else { failed++; console.log('  ❌ FAIL — ' + name + (detail !== undefined ? ' | ' + JSON.stringify(detail).slice(0, 180) : '')); }
}
async function advance(id: string) {
  return fetch(API + '/batches/' + id + '/stage', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json());
}

async function main() {
  console.log('\n========== PHASE 9.6 — FEEDBACK LOOP (học từ thời gian thật) ==========\n');

  await prisma.batch.deleteMany({ where: { batchCode: { startsWith: 'TSTF-' } } });
  const order = await prisma.order.create({ data: { rawText: '[p96-test]', parsedJson: {}, assumptions: [] } });

  try {
    // Tạo mẻ test ở GLAZING, lastStageChangeAt = 2h trước (GLAZING thực tế mất ~2h)
    const histBefore = await prisma.historicalBatch.count();
    const b = await prisma.batch.create({
      data: {
        batchCode: 'TSTF-01', orderId: order.id, productName: 'Lo hoa feedback loop',
        currentStage: 'GLAZING', priority: 'high', quantity: 60, glazeType: 'men xanh ngọc',
        firingTempC: 1260, estimatedClayKg: 25.5, estimatedFiringHours: 11,
        stageEstimates: { MOLDING: 3, DRYING_TRIMMING: 15, PAINTING: 4, GLAZING: 3.5, FIRING: 11, QC_PACKING: 1.5 },
        lastStageChangeAt: new Date(Date.now() - 2 * 3600_000),
      },
    });
    // Log giả lập các bước trước đó (MOLDING 4h, DRYING 16h, PAINTING 5h)
    const base = Date.now() - (2 + 16 + 5 + 4) * 3600_000;
    for (const [i, s] of ['MOLDING', 'DRYING_TRIMMING', 'PAINTING'].entries()) {
      await prisma.stageLog.create({ data: { batchId: b.id, stage: s, enteredAt: new Date(base + i * 0), stageCompleted: s, durationHours: [4, 16, 5][i] } });
    }

    console.log('CASE 1 · Transition GLAZING → FIRING ghi durationHours thực:');
    await advance(b.id);
    const glazingDone = await prisma.stageLog.findFirstOrThrow({
      where: { batchId: b.id, stageCompleted: 'GLAZING' }, orderBy: { enteredAt: 'desc' },
    });
    check('StageLog có durationHours ≈ 2h', glazingDone.durationHours != null && Math.abs(glazingDone.durationHours - 2) < 0.2, glazingDone.durationHours);
    check('stageCompleted = GLAZING', glazingDone.stageCompleted === 'GLAZING');

    console.log('\nCASE 2 · Chuỗi advance đến DONE (backdate giữa các bước):');
    // FIRING: backdate 12h rồi advance
    await prisma.batch.update({ where: { id: b.id }, data: { lastStageChangeAt: new Date(Date.now() - 12 * 3600_000) } });
    await advance(b.id); // FIRING → QC_PACKING (ghi 12h)
    await prisma.batch.update({ where: { id: b.id }, data: { lastStageChangeAt: new Date(Date.now() - 2.5 * 3600_000) } });
    const done = await advance(b.id); // QC_PACKING → DONE (ghi 2.5h) + ARCHIVE
    check('Batch đạt DONE', done.currentStage === 'DONE', done.currentStage);

    const archived = await prisma.historicalBatch.findFirstOrThrow({
      where: { productName: 'Lo hoa feedback loop' }, orderBy: { createdAt: 'desc' },
    });
    check('HistoricalBatch TỰ ĐỘNG tạo khi DONE', !!archived);
    check('hist count tăng đúng (+1)', (await prisma.historicalBatch.count()) === histBefore + 1);
    const sd = archived.stageDurationsHours as Record<string, number>;
    check('stageDurationsHours có GLAZING ≈ 2h (thực tế)', Math.abs(sd.GLAZING - 2) < 0.2, sd);
    check('stageDurationsHours có FIRING ≈ 12h', Math.abs(sd.FIRING - 12) < 0.2, sd);
    check('stageDurationsHours có QC ≈ 2.5h', Math.abs(sd.QC_PACKING - 2.5) < 0.2, sd);
    check('glazeType kế thừa cho RAG', archived.glazeType === 'men xanh ngọc');
    check('embeddingModel khớp runtime (cùng vector-space)', typeof archived.embeddingModel === 'string' && archived.embeddingModel.length > 0, archived.embeddingModel);

    console.log('\nCASE 3 · Estimator giờ tham chiếu được mẻ vừa học:');
    const preview = await parseOrder('60 lo hoa men xanh ngoc cao 30cm nung 1260 do giao trong 20 ngay');
    const basisNames = JSON.stringify(preview.estimation.basis.map((x: any) => x.productName));
    check('Basis chứa mẻ vừa archive (loop khép kín!)', basisNames.includes('feedback loop'), basisNames.slice(0, 120));
  } finally {
    const temps = await prisma.batch.findMany({ where: { batchCode: { startsWith: 'TSTF-' } }, select: { id: true } });
    for (const t of temps) {
      await prisma.alert.deleteMany({ where: { batchId: t.id } });
      await prisma.stageLog.deleteMany({ where: { batchId: t.id } });
      await prisma.batch.delete({ where: { id: t.id } }).catch(() => undefined);
    }
    await prisma.historicalBatch.deleteMany({ where: { productName: 'Lo hoa feedback loop' } });
    await prisma.order.deleteMany({ where: { rawText: '[p96-test]' } }).catch(() => undefined);
  }

  console.log('\n=================================================');
  console.log(`KẾT QUẢ PHASE 9.6: ${passed} PASS, ${failed} FAIL`);
  console.log('=================================================\n');
  process.exit(failed > 0 ? 1 : 0);

  async function parseOrder(rawText: string) {
    return fetch(API + '/orders/parse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rawText }) }).then((r) => r.json());
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

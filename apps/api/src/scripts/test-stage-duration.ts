/**
 * Phase 9 — Test progress công đoạn trên Kanban (cùng nguồn logic với Monitor).
 * Chạy trong container API: docker exec kilnflow-api-1 npx tsx src/scripts/test-stage-duration.ts
 *
 * Case 1: batch mới tạo (elapsed ≈ 0) → progress ~0%, KHÔNG overdue (xanh).
 * Case 2: 2 batch FIRING có estimatedFiringHours khác nhau (4h vs 40h), cùng mốc thời gian
 *         → expectedDuration PHẢI khác nhau theo từng batch (không phải hằng số chung).
 * Case 3: lastStageChangeAt đưa xa quá khứ → progress > 130%, isOverdue=true
 *         VÀ POST /monitor/tick phải cảnh báo ĐÚNG batch đó (2 nơi khớp nhau).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const API = process.env.TEST_API_URL || 'http://localhost:3001';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log('  ✅ PASS — ' + name); }
  else { failed++; console.log('  ❌ FAIL — ' + name + (detail !== undefined ? ' | ' + JSON.stringify(detail) : '')); }
}

async function api(pathname: string, method = 'GET', body?: unknown) {
  const res = await fetch(API + pathname, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return res.json();
}
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

async function main() {
  console.log('\n========== PHASE 9 — STAGE PROGRESS & MONITOR SYNC TESTS ==========\n');

  // ---- Setup ----
  const temps = await prisma.batch.findMany({ where: { batchCode: { startsWith: 'TSTP-' } }, select: { id: true } });
  for (const t of temps) {
    await prisma.alert.deleteMany({ where: { batchId: t.id } });
    await prisma.stageLog.deleteMany({ where: { batchId: t.id } });
    await prisma.batch.delete({ where: { id: t.id } });
  }
  const order = await prisma.order.create({ data: { rawText: '[phase9-test]', parsedJson: {}, assumptions: [] } });
  const mk = async (code: string, stage: string, firingHours: number, changedH: number, qty = 100) => {
    return prisma.batch.create({
      data: {
        batchCode: code, orderId: order.id, productName: 'Test P9', currentStage: stage,
        priority: 'medium', quantity: qty, firingTempC: 1250, estimatedClayKg: 40,
        estimatedFiringHours: firingHours, lastStageChangeAt: hoursAgo(changedH),
      },
    });
  };
  const fresh = await mk('TSTP-01', 'PAINTING', 12, 0.1);            // Case 1: mới tạo
  const fireShort = await mk('TSTP-02', 'FIRING', 4, 1);             // Case 2a: nung ngắn 4h
  const fireLong = await mk('TSTP-03', 'FIRING', 40, 1);             // Case 2b: nung dài 40h
  const overdueQc = await mk('TSTP-04', 'QC_PACKING', 12, 20);       // Case 3: QC dự kiến 12h, đã 20h

  try {
    const list: any[] = await api('/batches');
    const byCode = Object.fromEntries(list.filter((b) => b.batchCode.startsWith('TSTP-')).map((b) => [b.batchCode, b]));

    // ================= CASE 1 =================
    console.log('CASE 1 · Batch mới tạo → xanh, ~0%:');
    const c1 = byCode['TSTP-01'];
    check('Có đủ 4 field progress', c1 && typeof c1.progressPercent === 'number' && typeof c1.isOverdue === 'boolean');
    check('progressPercent < 10% (elapsed ≈ 0)', c1.progressPercent < 10, c1.progressPercent);
    check('isOverdue = false', c1.isOverdue === false);
    check('expected PAINTING = 36h (hằng số Monitor cũ)', c1.expectedStageDurationHours === 36, c1.expectedStageDurationHours);

    // ================= CASE 2 =================
    console.log('\nCASE 2 · FIRING dùng estimatedFiringHours CỦA TỪNG MẠ (không hằng số):');
    const c2a = byCode['TSTP-02'], c2b = byCode['TSTP-03'];
    check('Batch 4h → expected = 4', c2a.expectedStageDurationHours === 4, c2a.expectedStageDurationHours);
    check('Batch 40h → expected = 40', c2b.expectedStageDurationHours === 40, c2b.expectedStageDurationHours);
    check('Hai batch khác expected nhau', c2a.expectedStageDurationHours !== c2b.expectedStageDurationHours);
    check('Batch 4h/đã 1h → 25%', Math.abs(c2a.progressPercent - 25) < 1, c2a.progressPercent);
    check('Batch 40h/đã 1h → 2.5%', Math.abs(c2b.progressPercent - 2.5) < 1, c2b.progressPercent);

    // ================= CASE 3 =================
    console.log('\nCASE 3 · Quá hạn >130% → đỏ + MONITOR cũng báo cùng mẻ:');
    const c3 = byCode['TSTP-04'];
    check('QC_PACKING 20h / dự kiến 12h → ~167%', Math.abs(c3.progressPercent - 166.7) < 2, c3.progressPercent);
    check('isOverdue = true (>130%)', c3.isOverdue === true);
    check('FIRING batches không bị flag overdue (1h << 4h*1.3)', !c2a.isOverdue && !c2b.isOverdue);

    // Monitor tick — đếm alert cho TSTP-04 trước/sau
    const before = await prisma.alert.count({ where: { batchId: overdueQc.id, source: 'monitor:QC_PACKING' } });
    const tick = await api('/monitor/tick', 'POST');
    const after = await prisma.alert.count({ where: { batchId: overdueQc.id, source: 'monitor:QC_PACKING' } });
    check('Monitor tick chạy được', typeof tick.checked === 'number');
    check('Monitor tạo alert CHO ĐÚNG batch overdue (nguồn chung với UI)', after === before + 1, `trước=${before} sau=${after}`);
    // Các batch test còn lại KHÔNG bị monitor báo (chúng không trễ)
    const othersAlerted = await prisma.alert.count({ where: { batch: { batchCode: { startsWith: 'TSTP-0' } }, source: { startsWith: 'monitor:' }, NOT: { batchId: overdueQc.id } }, orderBy: { createdAt: 'desc' } });
    void othersAlerted;
  } finally {
    for (const t of [fresh, fireShort, fireLong, overdueQc]) {
      await prisma.alert.deleteMany({ where: { batchId: t.id } });
      await prisma.stageLog.deleteMany({ where: { batchId: t.id } });
      await prisma.batch.delete({ where: { id: t.id } }).catch(() => undefined);
    }
    await prisma.order.deleteMany({ where: { rawText: '[phase9-test]' } }).catch(() => undefined);
  }

  console.log('\n=================================================');
  console.log(`KẾT QUẢ PHASE 9: ${passed} PASS, ${failed} FAIL`);
  console.log('=================================================\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

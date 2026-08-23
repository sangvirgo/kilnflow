/**
 * Phase 8.6.6 — Test bắt buộc cho Personal Worker Menu (DM).
 * Chạy khi API container đang chạy bản mới: npx tsx src/scripts/test-phase86.ts
 *
 * Case 1: Tài khoản KHÔNG có trong AuthorizedWorker DM bot → từ chối đúng câu, không lộ menu.
 * Case 2: 2 thợ cùng gán 1 công đoạn → cả 2 thấy đúng danh sách mẻ của công đoạn đó.
 * Case 3: Thợ hoàn thành mẻ qua DM → DB advance đúng 1 bước + GROUP nhận broadcast.
 * Case 4: Đổi công đoạn giữa chừng → "Mẻ tôi đang làm" cập nhật theo assignedStage mới.
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const API = process.env.TEST_API_URL || 'http://localhost:3001';

function loadRootEnv(): Record<string, string> {
  const p = path.resolve(__dirname, '../../../../.env');
  const out: Record<string, string> = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) out[m[1]] = m[2];
  }
  return out;
}

async function api(pathname: string, body: unknown): Promise<any> {
  const res = await fetch(API + pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log('  ✅ PASS — ' + name); }
  else { failed++; console.log('  ❌ FAIL — ' + name + (detail ? ' | ' + JSON.stringify(detail).slice(0, 160) : '')); }
}

const A = { uid: 9001, name: 'Thợ A (test)' };
const B = { uid: 9002, name: 'Thợ B (test)' };

async function dmCallback(data: string, uid: number, username: string, messageId: number, messageText?: string) {
  return api('/telegram/test/callback', { data, userId: uid, username, messageId, messageText, chatType: 'private' });
}
async function dmMessage(text: string, uid: number, username: string) {
  return api('/telegram/test/message', { text, userId: uid, username, chatType: 'private' });
}

async function main() {
  console.log('\n========== PHASE 8.6.6 — PERSONAL WORKER MENU (DM) TESTS ==========\n');

  // ---------- Chuẩn bị ----------
  await prisma.authorizedWorker.deleteMany({ where: { telegramUserId: { in: [String(A.uid), String(B.uid)] } } });
  const temps = await prisma.batch.findMany({ where: { batchCode: { startsWith: 'TST86-' } }, select: { id: true } });
  for (const t of temps) {
    await prisma.alert.deleteMany({ where: { batchId: t.id } });
    await prisma.stageLog.deleteMany({ where: { batchId: t.id } });
    await prisma.batch.delete({ where: { id: t.id } });
  }
  const order = await prisma.order.create({ data: { rawText: '[phase86-test]', parsedJson: {}, assumptions: [] } });
  const mk = (code: string, stage: string, product: string) => prisma.batch.create({
    data: { batchCode: code, orderId: order.id, productName: product, currentStage: stage, priority: 'high', quantity: 50, firingTempC: 1250, estimatedClayKg: 30, estimatedFiringHours: 9 },
  });
  await mk('TST86-05', 'GLAZING', 'Lo hoa test A');
  await mk('TST86-06', 'GLAZING', 'Bo am test B');
  await mk('TST86-07', 'FIRING', 'Chen su test C');

  try {
    // ================= CASE 1 — TÀI KHOẢN CHƯA CẤP QUYỀN =================
    console.log('CASE 1 · Người lạ DM bot → bị từ chối, không lộ menu:');
    const stranger = await api('/telegram/test/message', { text: 'cho tôi làm việc với', userId: 666666, username: 'nguoi_la', chatType: 'private' });
    check('Bị từ chối (unauthorized_worker)', stranger.outcome === 'unauthorized_worker', stranger.outcome);
    check('Đúng thông điệp cấp quyền (kèm ID)', (stranger.dm || '').startsWith('Tài khoản chưa được cấp quyền (Telegram ID của bạn: 666666)'), stranger.dm);
    check('KHÔNG lộ nút menu nào', !stranger.buttons || stranger.buttons.length === 0, stranger.buttons);
    const strangerCb = await api('/telegram/test/callback', { data: 'pick_stage:FIRING', userId: 666666, username: 'nguoi_la', messageId: 700001, chatType: 'private' });
    check('Callback từ người lạ cũng bị chặn', strangerCb.outcome === 'unauthorized_dm', strangerCb.outcome);
    const stillNone = await prisma.authorizedWorker.findUnique({ where: { telegramUserId: '666666' } });
    check('Không tự tạo AuthorizedWorker cho người lạ', stillNone === null);

    // ================= CASE 2 — 2 THỢ CÙNG CÔNG ĐOẠN GLAZING =================
    console.log('\nCASE 2 · Hai thợ cùng gán Tráng men → cùng thấy đúng danh sách mẻ:');
    await prisma.authorizedWorker.createMany({
      data: [
        { telegramUserId: String(A.uid), displayName: A.name },
        { telegramUserId: String(B.uid), displayName: B.name },
      ],
    });
    // Menu lần đầu
    const aMenu = await dmMessage('/start', A.uid, 'tho_a');
    check('Thợ A nhận persistent menu (menu_sent)', aMenu.outcome === 'menu_sent', aMenu.outcome);
    const bMenu = await dmMessage('xin chào', B.uid, 'tho_b');
    check('Thợ B tin nhắn đầu cũng được gửi menu', bMenu.outcome === 'menu_sent', bMenu.outcome);

    const aPickMsg = await dmMessage('🧑‍🏭 Công đoạn của tôi', A.uid, 'tho_a');
    check('A mở bảng chọn công đoạn', aPickMsg.outcome === 'station_picker', aPickMsg.outcome);
    const bPickMsg = await dmMessage('/congdoan', B.uid, 'tho_b');
    check('B mở bảng chọn công đoạn (qua lệnh /congdoan)', bPickMsg.outcome === 'station_picker', bPickMsg.outcome);

    const aAssign = await dmCallback('pick_stage:GLAZING', A.uid, 'tho_a', 700010);
    const bAssign = await dmCallback('pick_stage:GLAZING', B.uid, 'tho_b', 700011);
    check('A gán GLAZING thành công', aAssign.outcome === 'stage_assigned', aAssign.outcome);
    check('B gán GLAZING thành công (không đụng A)', bAssign.outcome === 'stage_assigned', bAssign.outcome);

    const aList = await dmMessage('📦 Mẻ tôi đang làm', A.uid, 'tho_a');
    const bList = await dmMessage('/me', B.uid, 'tho_b');
    check('A thấy danh sách mẻ GLAZING', aList.outcome === 'my_batches', aList.outcome);
    check('B cũng thấy danh sách mẻ GLAZING', bList.outcome === 'my_batches', bList.outcome);
    const codesA = JSON.stringify(aList.buttons || []);
    const codesB = JSON.stringify(bList.buttons || []);
    check('Danh sách của A có đủ 2 mẻ GLAZING test', codesA.includes('TST86-05') && codesA.includes('TST86-06'), codesA);
    check('Danh sách của B có đủ 2 mẻ GLAZING test', codesB.includes('TST86-05') && codesB.includes('TST86-06'), codesB);

    // ================= CASE 3 — THỢ A HOÀN THÀNH MỂ QUA DM → GROUP NHẬN BROADCAST =================
    console.log('\nCASE 3 · Thợ A hoàn thành mẻ qua DM → group vẫn nhận broadcast:');
    const glazing = await prisma.batch.findUniqueOrThrow({ where: { batchCode: 'TST86-05' } });
    const logsBefore = await prisma.stageLog.count({ where: { batchId: glazing.id } });
    const adv = await dmCallback('my_advance:' + glazing.id + ':GLAZING', A.uid, 'tho_a', 700020, '🧾 #TST86-05 chi tiết');
    check('Advance qua DM thành công (dm_advanced)', adv.outcome === 'dm_advanced', adv.outcome);
    const after = await prisma.batch.findUniqueOrThrow({ where: { id: glazing.id } });
    check('DB: GLAZING → FIRING đúng 1 bước', after.currentStage === 'FIRING', after.currentStage);
    const logsAfter = await prisma.stageLog.count({ where: { batchId: glazing.id } });
    check('DB: đúng 1 StageLog mới (không double)', logsAfter - logsBefore === 1);
    // Bấm lại nút cũ → race blocked
    const advAgain = await dmCallback('my_advance:' + glazing.id + ':GLAZING', B.uid, 'tho_b', 700021);
    check('Người khác bấm nút cũ bị chặn race', advAgain.outcome === 'race_blocked', advAgain.outcome);
    // Group broadcast — đọc qua endpoint trạng thái TelegramService
    const bc = await fetch(API + '/telegram/broadcast-last').then((r) => r.json());
    check('GROUP nhận broadcast chuyển stage', !!bc.text && bc.text.includes('TST86-05') && bc.text.includes('chuyển giai đoạn'), bc.text);

    // ================= CASE 4 — ĐỔI CÔNG ĐOẠN GIỮA CHỪNG =================
    console.log('\nCASE 4 · Thợ B đổi từ Tráng men sang Nung lò → danh sách cập nhật:');
    await dmCallback('pick_stage:FIRING', B.uid, 'tho_b', 700030);
    const bAfterSwitch = await dmMessage('📦 Mẻ tôi đang làm', B.uid, 'tho_b');
    check('B mở danh sách sau khi đổi (my_batches)', bAfterSwitch.outcome === 'my_batches', bAfterSwitch.outcome);
    const btnB = JSON.stringify(bAfterSwitch.buttons || []);
    check('Giờ B thấy mẻ ở Nung lò (TST86-07)', btnB.includes('TST86-07'), btnB);
    // TST86-05 đã được advance lên FIRING ở Case 3 nên vẫn đúng khi xuất hiện;
    // mẻ PHẢI biến mất khỏi danh sách là TST86-06 (vẫn kẹt ở GLAZING)
    check('Không còn thấy mẻ GLAZING cũ (TST86-06)', !btnB.includes('TST86-06'), btnB);
    const dbB = await prisma.authorizedWorker.findUniqueOrThrow({ where: { telegramUserId: String(B.uid) } });
    check('DB: assignedStage đã ghi đè = FIRING', dbB.assignedStage === 'FIRING', dbB.assignedStage);

    // ================= DM báo lỗi tái dùng PendingReport =================
    console.log('\nBONUS · Báo lỗi từ DM tái dùng luồng severity → mô tả → Alert:');
    const firingBatch = await prisma.batch.findUniqueOrThrow({ where: { batchCode: 'TST86-07' } });
    const open = await dmCallback('my_batch:' + firingBatch.id, A.uid, 'tho_a', 700040);
    check('Mở chi tiết mẻ (batch_detail)', open.outcome === 'batch_detail', open.outcome);
    const rep = await dmCallback('my_report:' + firingBatch.id, A.uid, 'tho_a', 700041);
    check('Báo lỗi mẻ này → hỏi severity (severity_prompted)', rep.outcome === 'severity_prompted', rep.outcome);
    const sev = await dmCallback('select_severity:' + firingBatch.id + ':critical', A.uid, 'tho_a', 700042);
    check('Chọn severity trong DM (severity_saved)', sev.outcome === 'severity_saved', sev.outcome);
    const desc = await dmMessage('5/50 sản phẩm bị cong đáy, đề nghị kiểm tra nhiệt sấy', A.uid, 'tho_a');
    check('Mô tả trong DM được ghi nhận (report_recorded)', desc.outcome === 'report_recorded', desc.outcome);
    const alert = await prisma.alert.findFirst({ where: { batchId: firingBatch.id, source: 'telegram:@tho_a' }, orderBy: { createdAt: 'desc' } });
    check('Alert tạo đúng level=critical từ DM', !!alert && alert.level === 'critical');

    // ================= Cleanup =================
    await prisma.pendingReport.deleteMany({});
    await prisma.authorizedWorker.deleteMany({ where: { telegramUserId: { in: [String(A.uid), String(B.uid)] } } });
    for (const code of ['TST86-05', 'TST86-06', 'TST86-07']) {
      const b = await prisma.batch.findUnique({ where: { batchCode: code } });
      if (b) {
        await prisma.alert.deleteMany({ where: { batchId: b.id } });
        await prisma.stageLog.deleteMany({ where: { batchId: b.id } });
        await prisma.batch.delete({ where: { id: b.id } });
      }
    }
    await prisma.order.deleteMany({ where: { rawText: '[phase86-test]' } }).catch(() => undefined);
  } finally {
    console.log('');
  }

  console.log('=================================================');
  console.log('KẾT QUẢ PHASE 8.6: ' + passed + ' PASS, ' + failed + ' FAIL');
  console.log('=================================================\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

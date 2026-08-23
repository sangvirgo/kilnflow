/**
 * Phase 8.5 — Test bắt buộc cho Telegram Interactive Bot.
 * Chạy SAU khi API container đang chạy bản mới: npx tsx src/scripts/test-phase8.ts
 * (từ thư mục apps/api, cần DATABASE_URL trỏ về MySQL host-reachable)
 *
 * Case 1: RACE CONDITION — 2 "người" bấm nút xác nhận cùng lúc → đúng 1 lần advance.
 * Case 2: PENDINGREPORT HẾT HẠN — tin nhắn muộn KHÔNG bị hiểu là mô tả lỗi.
 * Case 3: /BAOCAO — chỉ liệt kê batch active, không hiện batch DONE.
 * Case 4: VÒNG BÁO LỖI ĐẦY ĐỦ — chọn mẻ → severity → mô tả → Alert ghi nhận đúng mức độ.
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
const ENV = loadRootEnv();
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || ENV.TELEGRAM_CHAT_ID || '';

async function api(pathname: string, body: unknown): Promise<any> {
  const res = await fetch(API + pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log('  ✅ PASS — ' + name); }
  else { failed++; console.log('  ❌ FAIL — ' + name + (detail ? ' | ' + detail : '')); }
}

async function cleanupTemp(prefix: string) {
  const temps = await prisma.batch.findMany({ where: { batchCode: { startsWith: prefix } }, select: { id: true } });
  for (const t of temps) {
    await prisma.alert.deleteMany({ where: { batchId: t.id } });
    await prisma.stageLog.deleteMany({ where: { batchId: t.id } });
    await prisma.batch.delete({ where: { id: t.id } });
  }
  await prisma.pendingReport.deleteMany({});
}

async function main() {
  console.log('\n========== PHASE 8.5 — TELEGRAM INTERACTIVE BOT TESTS ==========\n');
  if (!CHAT_ID) console.log('⚠️  Không đọc được TELEGRAM_CHAT_ID từ .env — case 2 có thể sai chatId.');
  const chatKey = CHAT_ID;

  // ---------- Chuẩn bị dữ liệu thử nghiệm tạm thời ----------
  await cleanupTemp('TST9');
  const order = await prisma.order.create({
    data: { rawText: '[phase8-test] dữ liệu thử', parsedJson: {}, assumptions: [] },
  });
  const mkBatch = (code: string, stage: string) => prisma.batch.create({
    data: {
      batchCode: code, orderId: order.id, productName: 'Batch test phase 8', currentStage: stage,
      priority: 'medium', quantity: 100, firingTempC: 1250, estimatedClayKg: 40, estimatedFiringHours: 10,
    },
  });
  const raceBatch = await mkBatch('TST9-01', 'PAINTING');   // dùng cho case 1
  await mkBatch('TST9-02', 'DONE');                          // batch DONE (kiểm tra loại DONE)

  try {
    // ================= CASE 1 — RACE CONDITION =================
    console.log('CASE 1 · Hai người bấm "✅ Xác nhận hoàn thành" gần như đồng thời:');
    const logsBefore = await prisma.stageLog.count({ where: { batchId: raceBatch.id } });
    const [r1, r2] = await Promise.all([
      api('/telegram/test/callback', { data: 'advance:' + raceBatch.id + ':PAINTING', userId: 101, username: 'tho_a', messageId: 555001, messageText: 'giả lập message gốc A' }),
      api('/telegram/test/callback', { data: 'advance:' + raceBatch.id + ':PAINTING', userId: 102, username: 'tho_b', messageId: 555002, messageText: 'giả lập message gốc B' }),
    ]);
    const outcomes = [r1.outcome, r2.outcome].sort();
    check('Đúng 1 request advance thành công', outcomes.filter((o: string) => o === 'advanced').length === 1, JSON.stringify(outcomes));
    check('Request còn lại bị chặn (race_blocked)', outcomes.includes('race_blocked'), JSON.stringify(outcomes));
    const after = await prisma.batch.findUnique({ where: { id: raceBatch.id } });
    check('DB: batch tiến đúng 1 bước (PAINTING → GLAZING)', after?.currentStage === 'GLAZING', 'hiện tại: ' + after?.currentStage);
    const logsAfter = await prisma.stageLog.count({ where: { batchId: raceBatch.id } });
    check('DB: chỉ tạo ĐÚNG 1 StageLog mới', logsAfter - logsBefore === 1, 'trước=' + logsBefore + ' sau=' + logsAfter);

    // Bấm lại nút CŨ lần nữa → phải bị chặn (stale)
    const r3 = await api('/telegram/test/callback', { data: 'advance:' + raceBatch.id + ':PAINTING', userId: 103, username: 'tho_c', messageId: 555003 });
    check('Bấm lại nút cũ lần 3 vẫn bị chặn', r3.outcome === 'race_blocked', r3.outcome);

    // ================= CASE 2 — PENDINGREPORT HẾT HẠN =================
    console.log('\nCASE 2 · Phiên báo lỗi hết hạn → tin nhắn muộn KHÔNG bị hiểu là mô tả lỗi:');
    const alertsBeforeCase2 = await prisma.alert.count();
    await prisma.pendingReport.create({
      data: { chatId: chatKey, userId: '777', username: 'tho_muon', batchId: raceBatch.id, severity: 'critical', expiresAt: new Date(Date.now() - 60_000) },
    });
    const lateMsg = await api('/telegram/test/message', { text: 'xin chào, tôi gõ muộn quá', userId: 777, username: 'tho_muon' });
    check('Bot nhận diện phiên đã hết hạn (expired_cancelled)', lateMsg.outcome === 'expired_cancelled', lateMsg.outcome);
    const pendLeft = await prisma.pendingReport.count({ where: { userId: '777' } });
    check('Phiên chờ đã được dọn khỏi DB', pendLeft === 0, 'còn ' + pendLeft);
    const alertsAfterCase2 = await prisma.alert.count();
    check('KHÔNG tạo Alert nào từ tin nhắn muộn', alertsAfterCase2 === alertsBeforeCase2, 'alerts ' + alertsBeforeCase2 + '→' + alertsAfterCase2);

    // Tin nhắn bình thường của user KHÔNG có phiên chờ → bot bỏ qua, không nhầm
    const plain = await api('/telegram/test/message', { text: 'alo mọi người ăn trưa chưa', userId: 778, username: 'tho_thuong' });
    check('Tin nhắn thường của user khác bị bỏ qua (ignored)', plain.outcome === 'ignored', plain.outcome);

    // ================= CASE 3 — GROUP /BAOCAO GIỜ CHỈ HƯỚNG DẪN (Phase 8.6) =================
    console.log('\nCASE 3 · /baocao trong group → hướng dẫn nhắn riêng bot (Phase 8.6):');
    const listing = await api('/telegram/test/message', { text: '/baocao', userId: 101, username: 'tho_a', resetThrottle: true });
    check('Group /baocao trả lời hướng dẫn (report_guidance)', listing.outcome === 'report_guidance', listing.outcome);
    const guide = await fetch(API + '/telegram/broadcast-last').then((r) => r.json());
    check('Hướng dẫn có nội dung dẫn về chat riêng với bot', !!guide.text && guide.text.includes('CÁ NHÂN') && guide.text.includes('riêng với bot'), guide.text);

    // ================= CASE 4 — VÒNG BÁO LỖI ĐẦY ĐỦ (qua group, legacy Phase 8.3) =================
    console.log('\nCASE 4 · Vòng báo lỗi đầy đủ: chọn mẻ → severity → mô tả → Alert:');
    const target = await prisma.batch.findFirstOrThrow({ where: { currentStage: { not: 'DONE' }, batchCode: { startsWith: 'GOM-' } } });
    const pick = await api('/telegram/test/callback', { data: 'select_batch:' + target.id, userId: 888, username: 'quan_ly', messageId: 555010 });
    check('Chọn mẻ OK (severity_prompted)', pick.outcome === 'severity_prompted', pick.outcome);
    const sev = await api('/telegram/test/callback', { data: 'select_severity:' + target.id + ':warning', userId: 888, username: 'quan_ly', messageId: 555011 });
    check('Chọn mức độ OK (severity_saved)', sev.outcome === 'severity_saved', sev.outcome);
    const pendRow = await prisma.pendingReport.findFirst({ where: { userId: '888' } });
    check('PendingReport persist trong DB (sống sót qua restart)', !!pendRow && pendRow.severity === 'warning' && pendRow.chatId === chatKey);
    const desc = 'Phát hiện 15/200 sản phẩm bị nứt men ở phần miệng chén';
    const rec = await api('/telegram/test/message', { text: desc, userId: 888, username: 'quan_ly' });
    check('Mô tả được ghi nhận (report_recorded)', rec.outcome === 'report_recorded', rec.outcome);
    check('Tóm tắt đúng severity/mô tả', rec.recorded?.severity === 'warning' && rec.recorded?.description === desc, JSON.stringify(rec.recorded));
    const alert = await prisma.alert.findFirst({ where: { batchId: target.id, source: { startsWith: 'telegram:@quan_ly' } }, orderBy: { createdAt: 'desc' } });
    check('Alert tạo đúng: level=warning, nguồn telegram:@quan_ly', !!alert && alert.level === 'warning');
    const pendLeft2 = await prisma.pendingReport.count({ where: { userId: '888' } });
    check('Phiên chờ đã xóa sau khi ghi nhận', pendLeft2 === 0);

    // ================= BẢO MẬT 8.4 — chat lạ bị từ chối =================
    console.log('\nSECURITY · Callback/tin nhắn từ chat KHÁC phải bị bỏ qua:');
    if (CHAT_ID) {
      const rogueChat = String(Number(CHAT_ID) ? Number(CHAT_ID) - 1 : 'rogue-chat-x');
      const rogueCb = await api('/telegram/test/callback', { data: 'advance:' + target.id + ':' + target.currentStage, userId: 999, username: 'hack_er', messageId: 555099, chatId: rogueChat });
      check('Callback từ chat lạ bị từ chối', rogueCb.outcome === 'unknown_callback', rogueCb.outcome);
      const rogueMsg = await api('/telegram/test/message', { text: '/baocao', userId: 999, username: 'hack_er', chatId: rogueChat });
      check('Tin nhắn/lệnh từ chat lạ bị từ chối', rogueMsg.outcome === 'untrusted_chat', rogueMsg.outcome);
    } else {
      console.log('  ⚠️ Bỏ qua (không có TELEGRAM_CHAT_ID)');
    }
  } finally {
    await cleanupTemp('TST9');
    await prisma.order.deleteMany({ where: { rawText: '[phase8-test] dữ liệu thử' } }).catch(() => undefined);
  }

  console.log('\n=================================================');
  console.log('KẾT QUẢ: ' + passed + ' PASS, ' + failed + ' FAIL');
  console.log('=================================================\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

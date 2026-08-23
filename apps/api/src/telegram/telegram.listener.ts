import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { PrismaService } from '../prisma/prisma.service';
import { BatchesService } from '../batches/batches.service';
import { RiskQcAgent } from '../agents/risk-qc.agent';
import { TelegramService } from './telegram.service';
import { STAGES, Stage } from '@kilnflow/shared-types';
import { StageTransitionError } from '../common/errors';

const PENDING_TTL_MINUTES = 5;

interface InlineButton { text: string; callback_data: string }

/** Phase 8.6.2 — bàn phím cố định dưới ô nhập (persistent ReplyKeyboard). */
const WORKER_REPLY_KEYBOARD = {
  keyboard: [
    [{ text: '🧑‍🏭 Công đoạn của tôi' }],
    [{ text: '📦 Mẻ tôi đang làm' }],
    [{ text: '⚠️ Báo lỗi' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

const BOT_COMMANDS = [
  { command: 'start', description: 'Bắt đầu / hiện lại menu' },
  { command: 'congdoan', description: '🧑‍🏭 Chọn công đoạn phụ trách' },
  { command: 'me', description: '📦 Các mẻ tôi đang làm' },
  { command: 'baoloi', description: '⚠️ Báo lỗi một mẻ' },
];

/** 6 công đoạn cho thợ chọn (Phase 8.6.3). */
const STATION_CHOICES: { stage: Stage; label: string }[] = [
  { stage: 'MOLDING', label: 'Tạo hình' },
  { stage: 'DRYING_TRIMMING', label: 'Sấy & sửa mộc' },
  { stage: 'PAINTING', label: 'Vẽ' },
  { stage: 'GLAZING', label: 'Tráng men' },
  { stage: 'FIRING', label: 'Nung lò' },
  { stage: 'QC_PACKING', label: 'Kiểm tra & đóng gói (QC)' },
];

export type CallbackOutcome =
  | 'advanced'
  | 'race_blocked'
  | 'stale_button'
  | 'batch_not_found'
  | 'invalid_stage'
  | 'done_batch'
  | 'severity_prompted'
  | 'severity_saved'
  | 'invalid_severity'
  | 'claim_saved'
  | 'need_station'
  | 'my_batches'
  | 'my_batches_listed'
  | 'unknown_callback'
  // Phase 8.6
  | 'unauthorized_dm'
  | 'stage_assigned'
  | 'station_listed'
  | 'need_station'
  | 'my_batches'
  | 'my_batches_listed'
  | 'my_batches_listed'
  | 'batch_detail'
  | 'dm_advanced'
  | 'guidance_reply';

export type MessageOutcome =
  | 'report_listed'
  | 'no_active_batches'
  | 'severity_prompted'
  | 'report_recorded'
  | 'expired_cancelled'
  | 'ignored'
  | 'untrusted_chat'
  // Phase 8.6
  | 'unauthorized_worker'
  | 'menu_sent'
  | 'station_picker'
  | 'need_station_first'
  | 'my_batches_listed'
  | 'my_batches'
  | 'report_guidance'
  | 'dm_report_recorded';

/**
 * Phase 8 — Telegram Interactive Bot (long polling).
 * - Group (TELEGRAM_CHAT_ID): CHỈ broadcast thông báo + nút xác nhận nhanh (Phase 8.2/8.3).
 * - DM riêng (Phase 8.6): thợ trong AuthorizedWorker được chọn công đoạn, xem mẻ của mình,
 *   hoàn thành bước / báo lỗi ngay trong luồng cá nhân.
 * - QUAN TRỌNG: mọi tác động đều đi qua service nghiệp vụ có sẵn
 *   (BatchesService.advanceStage, RiskQcAgent.qcComposeFreeform) — KHÔNG có logic riêng
 *   cho Telegram, tránh 2 nguồn sự thật.
 */
@Injectable()
export class TelegramListenerService implements OnModuleInit {
  private readonly logger = new Logger(TelegramListenerService.name);
  private bot: TelegramBot | null = null;
  private allowedChatId = '';

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private batches: BatchesService,
    private riskQc: RiskQcAgent,
    private telegram: TelegramService,
  ) {}

  onModuleInit() {
    const token = this.config.get('telegram.botToken', '');
    this.allowedChatId = String(this.config.get('telegram.chatId', '') || '').trim();
    if (!token || !this.allowedChatId) {
      this.logger.warn('Thiếu TELEGRAM_BOT_TOKEN/CHAT_ID → interactive bot KHÔNG khởi động.');
      return;
    }
    if (process.env.TELEGRAM_LISTEN === 'false') {
      this.logger.log('TELEGRAM_LISTEN=false → tắt polling (tránh xung đột khi chạy 2 bản API).');
      return;
    }
    try {
      this.bot = new TelegramBot(token, { polling: { interval: 1500, autoStart: true, params: { timeout: 25 } } });
      this.bot.on('callback_query', (cq) => this.handleCallbackQuery(cq).catch((e) => this.logger.error('callback_query lỗi: ' + (e?.message || e))));
      this.bot.on('message', (msg) => this.handleMessage(msg).catch((e) => this.logger.error('message lỗi: ' + (e?.message || e))));
      this.bot.on('polling_error', (err: any) => {
        const m = String(err?.message || err);
        if (!m.includes('409')) this.logger.warn('polling_error: ' + m.slice(0, 120));
      });
      this.bot.setMyCommands(BOT_COMMANDS).catch(() => undefined);
      if (!this.allowedChatId.startsWith('-')) {
        this.logger.warn('TELEGRAM_CHAT_ID="' + this.masked() + '" trông như ID CÁ NHÂN (không âm). ' +
          'Nếu muốn cả đội cùng xem thông báo, hãy tạo 1 group và dùng chat_id của group (dạng -100...). ' +
          'Còn nếu bạn dùng chat này như kênh cá nhân thì mọi thứ vẫn hoạt động bình thường.');
      }
      this.logger.log('Interactive bot BẬT (long polling) — group: ' + this.masked() + ' · DM cho thợ đã cấp quyền (Phase 8.6)');
    } catch (err: any) {
      this.logger.error('Không khởi động được bot: ' + (err?.message || err));
    }
  }

  private masked(): string {
    const c = this.allowedChatId;
    return c.length > 4 ? c.slice(0, 3) + '***' + c.slice(-2) : c;
  }

  private isGroupChat(chatId?: number | string): boolean {
    return chatId != null && String(chatId).trim() === this.allowedChatId;
  }

  private async answer(cq: TelegramBot.CallbackQuery, text: string, showAlert = false): Promise<void> {
    try {
      await this.bot?.answerCallbackQuery(cq.id, { text, show_alert: showAlert });
    } catch (err: any) {
      this.logger.debug('answerCallbackQuery bị từ chối (bình thường với callback giả lập): ' + String(err?.message || err).slice(0, 80));
    }
  }

  /** Gửi tin nhắn vào DM của thợ (ghi nhớ nội dung dự kiến NGAY cả khi Telegram từ chối — phục vụ kiểm thử). */
  private async dmSend(chatId: number | string, html: string, inlineKeyboard?: { inline_keyboard: InlineButton[][] }, replyKeyboard?: typeof WORKER_REPLY_KEYBOARD): Promise<void> {
    this.lastDmReply = html.replace(/<[^>]+>/g, '');
    this.lastDmButtons = inlineKeyboard ? inlineKeyboard.inline_keyboard.flat().map((b) => b.text) : null;
    try {
      await this.bot?.sendMessage(chatId as any, html, {
        parse_mode: 'HTML',
        ...(inlineKeyboard ? { reply_markup: inlineKeyboard } : {}),
        ...(replyKeyboard ? { reply_markup: replyKeyboard } : {}),
      });
    } catch (err: any) {
      // User giả lập trong test → bot không DM được (403) — bình thường, capture ở trên vẫn có giá trị
      this.logger.debug('dmSend bị từ chối (bình thường với user test): ' + String(err?.message || err).slice(0, 80));
    }
  }

  lastDmReply: string | null = null;
  lastDmButtons: string[] | null = null;

  // ============================================================
  // ROUTING TỔNG — Phase 8.6: group = broadcast, DM = cá nhân
  // ============================================================

  async handleCallbackQuery(cq: TelegramBot.CallbackQuery): Promise<CallbackOutcome> {
    const chatId = cq.message?.chat?.id;
    const data = cq.data || '';
    const isPrivate = (cq.message?.chat as any)?.type === 'private';

    // Phase 8.6-fix: DM (type=private) LUÔN được xử lý trước — kể cả khi TELEGRAM_CHAT_ID
    // vô tình trùng với user-id cá nhân (cấu hình sai phổ biến).
    if (isPrivate) {
      const worker = await this.prisma.authorizedWorker.findUnique({ where: { telegramUserId: String(cq.from.id) } });
      if (!worker) {
        this.logger.warn('[BẢO MẬT][DM] Callback từ tài khoản chưa cấp quyền: ' + cq.from.id);
        await this.answer(cq, 'Tài khoản chưa được cấp quyền.', true);
        return 'unauthorized_dm';
      }
      this.logger.log('[TG-DM-CALLBACK] ' + JSON.stringify({ who: worker.displayName, data }));
      if (data.startsWith('pick_stage:')) return this.onStationPicked(cq, worker.telegramUserId, data.slice('pick_stage:'.length));
      if (data.startsWith('my_batch:')) return this.onMyBatchOpened(cq, worker, data.slice('my_batch:'.length));
      if (data.startsWith('claim:')) return this.onClaimBatch(cq, worker, data.slice('claim:'.length));
      if (data === 'refresh_my_batches') {
        if (!worker.assignedStage) {
          await this.answer(cq, 'Bạn chưa chọn công đoạn.', true);
          return 'need_station';
        }
        const rows = await this.listMyBatches(worker.assignedStage);
        if (cq.message) {
          await this.editWithKeyboard(
            cq.message.chat.id, cq.message.message_id,
            rows.length
              ? '📦 Các mẻ đang ở <b>' + this.stationLabel(worker.assignedStage) + '</b>:'
              : '📭 Vẫn chưa có mẻ ở <b>' + this.stationLabel(worker.assignedStage) + '</b>. Bot sẽ tự nhắn khi có mẻ mới!',
            rows.length ? rows : [],
          );
        }
        return rows.length ? 'my_batches' : 'my_batches_listed';
      }
      if (data.startsWith('my_advance:')) {
        const [, batchId, expectedStage] = data.split(':');
        return this.onMyAdvancePressed(cq, worker, batchId, expectedStage);
      }
      if (data.startsWith('my_report:')) return this.onMyReportStart(cq, worker, data.slice('my_report:'.length));
      // select_severity:* tạo từ luồng DM cũng rơi xuống đây khi chat là private
      if (data.startsWith('select_severity:')) {
        const [, batchId, severity] = data.split(':');
        return this.onSeverityPicked(cq, batchId, severity);
      }
      await this.answer(cq, 'Lệnh không rõ.');
      return 'unknown_callback';
    }

    if (this.isGroupChat(chatId)) {
      this.logger.log('[TG-CALLBACK] ' + JSON.stringify({ from: cq.from.username || cq.from.first_name, data }));
      if (data.startsWith('advance:')) {
        const [, batchId, expectedStage] = data.split(':');
        return this.onAdvancePressed(cq, batchId, expectedStage);
      }
      if (data.startsWith('select_batch:')) {
        return this.onBatchPickedForReport(cq, data.slice('select_batch:'.length));
      }
      if (data.startsWith('select_severity:')) {
        const [, batchId, severity] = data.split(':');
        return this.onSeverityPicked(cq, batchId, severity);
      }
      await this.answer(cq, 'Lệnh không rõ.');
      return 'unknown_callback';
    }

    this.logger.warn('[BẢO MẬT] Bỏ qua callback từ chat lạ: ' + String(chatId));
    return 'unknown_callback';
  }

  /** Chống spam hướng dẫn trong group: tối đa 1 lần / 30 giây. */
  private lastGuidanceAt = 0;

  /** Test/demo dùng: bỏ qua throttle cho lần xử lý kế tiếp. */
  resetGuidanceThrottle(): void {
    this.lastGuidanceAt = 0;
  }

  async handleMessage(msg: TelegramBot.Message): Promise<MessageOutcome> {
    const chatId = msg.chat?.id;
    const isPrivate = msg.chat?.type === 'private';

    // Phase 8.6-fix: DM (type=private) ưu tiên trước — người dùng nhắn riêng 1-1 với bot
    // phải luôn vào luồng cá nhân, bất kể TELEGRAM_CHAT_ID có trùng user-id hay không.
    if (isPrivate) {
      const worker = await this.prisma.authorizedWorker.findUnique({ where: { telegramUserId: String(msg.from?.id ?? '') } });
      if (!worker) {
        // Phase 8.6.1 — từ chối đúng 1 câu (kèm ID để quản lý cấp quyền nhanh), không lộ menu
        this.logger.warn('[BẢO MẬT][DM] Từ chối tài khoản chưa cấp quyền: ' + (msg.from?.username || msg.from?.id));
        await this.dmSend(chatId!, 'Tài khoản chưa được cấp quyền (Telegram ID của bạn: <code>' + msg.from?.id + '</code>). Liên hệ quản lý để đăng ký.');
        return 'unauthorized_worker';
      }
      this.logger.log('[TG-DM] ' + JSON.stringify({ who: worker.displayName, text: (msg.text || '').slice(0, 50) }));

      // Phase 8.6.2 — lần đầu tương tác: gửi persistent keyboard + setMyCommands
      let outcome: MessageOutcome = 'ignored';
      if (!worker.menuReady || (msg.text && msg.text.startsWith('/start'))) {
        await this.dmSend(chatId!,
          '👋 Chào <b>' + worker.displayName + '</b>! Đây là menu cá nhân của bạn tại xưởng gốm.\n' +
          'Dùng 3 nút bên dưới ô nhập (hoặc lệnh /):\n' +
          '• 🧑‍🏭 Công đoạn của tôi — chọn nơi bạn phụ trách\n' +
          '• 📦 Mẻ tôi đang làm — xem & hoàn thành mẻ\n' +
          '• ⚠️ Báo lỗi — hướng dẫn báo sự cố');
        outcome = 'menu_sent';
        if (!worker.menuReady) {
          await this.prisma.authorizedWorker.update({ where: { id: worker.id }, data: { menuReady: true } });
          if (!msg.text?.startsWith('/start') && msg.text) return outcome;
        }
        if (msg.text?.startsWith('/start')) return outcome;
      }

      const t = msg.text || '';
      if (t === '🧑‍🏭 Công đoạn của tôi' || t === '/congdoan') return this.onStationPicker(msg, worker.telegramUserId);
      if (t === '📦 Mẻ tôi đang làm' || t === '/me') return this.onMyBatches(msg, worker.telegramUserId);
      if (t === '⚠️ Báo lỗi' || t === '/baoloi') {
        await this.dmSend(chatId!, '⚠️ Để báo lỗi: bấm <b>📦 Mẻ tôi đang làm</b> → chọn mẻ → bấm <b>⚠️ Báo lỗi mẻ này</b>. Hệ thống sẽ hỏi mức độ rồi bạn gõ mô tả.');
        outcome = 'report_guidance';
        return outcome;
      }
      if (t.startsWith('/') && !t.startsWith('/start')) {
        await this.dmSend(chatId!, 'Lệnh không rõ. Dùng các nút bên dưới hoặc /congdoan · /me · /baoloi.');
        return 'ignored';
      }
      // Text tự do → mô tả lỗi đang chờ (nếu có)
      return this.onFreeTextMessage(msg, chatId);
    }

    if (this.isGroupChat(chatId)) {
      if (!msg.text) return 'ignored';
      this.logger.log('[TG-MESSAGE] ' + JSON.stringify({ from: msg.from?.username || msg.from?.first_name, text: msg.text.slice(0, 60) }));
      const t = msg.text;
      const isCommand = t.startsWith('/');
      const isMenuButton = t === '🧑‍🏭 Công đoạn của tôi' || t === '📦 Mẻ tôi đang làm' || t === '⚠️ Báo lỗi';
      if (isCommand || isMenuButton) {
        // Phase 8.6 — mọi lệnh/nút cá nhân gõ trong group đều được dẫn về DM (có chống spam)
        if (Date.now() - this.lastGuidanceAt > 30_000) {
          this.lastGuidanceAt = Date.now();
          const name = msg.from?.username ? '@' + msg.from.username : (msg.from?.first_name || 'bạn');
          await this.telegram.send(
            'ℹ️ <a href="tg://user?id=' + msg.from?.id + '">' + name + '</a>, lệnh <b>' + (isCommand ? t.split(' ')[0] : t) +
            '</b> là thao tác CÁ NHÂN — hãy mở chat <b>riêng với bot</b> (bấm vào tên bot ➜ Start) rồi dùng nhé.\nGroup này chỉ nhận thông báo chung của xưởng.',
          );
        }
        return 'report_guidance';
      }
      // Hoàn tất nốt phiên mô tả lỗi cũ nếu còn treo (tương thích ngược Phase 8.3)
      return this.onFreeTextMessage(msg);
    }

    this.logger.warn('[BẢO MẬT] Bỏ qua tin nhắn từ chat lạ: ' + String(chatId));
    return 'untrusted_chat';
  }

  // ================= PHASE 8.2 — XÁC NHẬN HOÀN THÀNH CÔNG ĐOẠN (GROUP) =================

  private async onAdvancePressed(cq: TelegramBot.CallbackQuery, batchId: string, expectedStage: string): Promise<CallbackOutcome> {
    if (!STAGES.includes(expectedStage as Stage)) {
      await this.answer(cq, 'Dữ liệu nút không hợp lệ.', true);
      return 'invalid_stage';
    }

    // (1) Đọc lại batch và đối chiếu currentStage nhúng trong nút với DB NGAY LÚC NÀY
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) {
      await this.answer(cq, '❌ Không tìm thấy mẻ trong hệ thống.', true);
      return 'batch_not_found';
    }

    if (batch.currentStage !== expectedStage) {
      // (2) Ai đó đã bấm/đổi qua web trước rồi → KHÔNG advance thêm lần nữa
      this.logger.warn('[TG-RACE] Nút cũ cho #' + batch.batchCode + ' (mong đợi ' + expectedStage + ', thực tế ' + batch.currentStage + ') — CHẶN double-advance.');
      void this.removeStaleKeyboard(cq);
      await this.answer(
        cq,
        '⚠️ Mẻ này đã chuyển sang bước khác rồi (' + (TelegramService.STAGE_VN[batch.currentStage] ?? batch.currentStage) + '), vui lòng kiểm tra lại trên dashboard.',
        true,
      );
      return 'race_blocked';
    }

    // (3) Khớp → gọi ĐÚNG service nghiệp vụ mà web đang dùng (atomic updateMany chống race ở mức DB)
    let updated;
    try {
      updated = await this.batches.advanceStage(batchId, undefined, expectedStage as Stage);
    } catch (err: any) {
      const friendly = err instanceof StageTransitionError ? err.message : '❌ Không advance được: ' + (err?.message || err);
      await this.answer(cq, friendly, true);
      return 'race_blocked';
    }

    const who = '@' + (cq.from.username || cq.from.first_name || 'người dùng');
    const hhmm = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    await this.answer(cq, '✔ Đã ghi nhận xác nhận của ' + who);
    await this.telegram.send(
      '✅ ' + who + ' đã xác nhận hoàn thành bước <b>' + (TelegramService.STAGE_VN[expectedStage] ?? expectedStage) +
      '</b> — mẻ #' + updated.batchCode + ' chuyển sang <b>' + (TelegramService.STAGE_VN[updated.currentStage] ?? updated.currentStage) + '</b>. ' +
      'Nút mới để xác nhận bước tiếp theo đã đính kèm ở thông báo bên trên ☝️',
    );
    // (4) Sửa message gốc: xóa nút cũ, thay bằng dòng xác nhận
    await this.markOriginalConfirmed(cq, who, hhmm);
    return 'advanced';
  }

  private async markOriginalConfirmed(cq: TelegramBot.CallbackQuery, who: string, hhmm: string): Promise<void> {
    const msg = cq.message;
    if (!msg || !this.bot) return;
    try {
      const baseText = (msg as any).text ? String((msg as any).text) : null;
      if (baseText) {
        await this.bot.editMessageText(baseText + '\n\n✅ Đã xác nhận bởi <b>' + who + '</b> lúc ' + hhmm, {
          chat_id: msg.chat.id,
          message_id: msg.message_id,
          parse_mode: 'HTML',
        });
      } else {
        throw new Error('no-text');
      }
    } catch {
      try {
        await this.bot!.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: msg.chat.id, message_id: msg.message_id });
      } catch { /* bỏ qua */ }
    }
  }

  private async removeStaleKeyboard(cq: TelegramBot.CallbackQuery): Promise<void> {
    const msg = cq.message;
    if (!msg || !this.bot) return;
    try {
      await this.bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: msg.chat.id, message_id: msg.message_id });
    } catch { /* message cũ/không sửa được — bỏ qua */ }
  }

  // ================= PHASE 8.3 — LUỒNG PENDINGREPORT (dùng chung group/DM) =================

  private async onBatchPickedForReport(cq: TelegramBot.CallbackQuery, batchId: string): Promise<CallbackOutcome> {
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId }, select: { batchCode: true, currentStage: true } });
    if (!batch) {
      await this.answer(cq, '❌ Không tìm thấy mẻ.', true);
      return 'batch_not_found';
    }
    if (batch.currentStage === 'DONE') {
      await this.answer(cq, '⚠️ Mẻ này đã hoàn thành rồi.', true);
      return 'done_batch';
    }

    const sevButtons: InlineButton[][] = [
      [
        { text: '🟢 Nhẹ', callback_data: 'select_severity:' + batchId + ':info' },
        { text: '🟡 Trung bình', callback_data: 'select_severity:' + batchId + ':warning' },
        { text: '🔴 Nghiêm trọng', callback_data: 'select_severity:' + batchId + ':critical' },
      ],
    ];
    await this.answer(cq, 'Đã chọn mẻ #' + batch.batchCode);
    if (cq.message) {
      await this.editWithKeyboard(cq.message.chat.id, cq.message.message_id,
        '🛠 Mẻ <b>#' + batch.batchCode + '</b> (' + (TelegramService.STAGE_VN[batch.currentStage] ?? batch.currentStage) + ') — chọn mức độ nghiêm trọng:', sevButtons);
    } else {
      await this.sendKeyboard('Mẻ #' + batch.batchCode + ' — chọn mức độ nghiêm trọng:', sevButtons, this.allowedChatId);
    }
    return 'severity_prompted';
  }

  private async onSeverityPicked(cq: TelegramBot.CallbackQuery, batchId: string, severity: string): Promise<CallbackOutcome> {
    if (!['info', 'warning', 'critical'].includes(severity)) {
      await this.answer(cq, 'Mức độ không hợp lệ.', true);
      return 'invalid_severity';
    }
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId }, select: { batchCode: true, currentStage: true } });
    if (!batch || batch.currentStage === 'DONE') {
      await this.answer(cq, '⚠️ Mẻ không còn hợp lệ để báo lỗi.', true);
      return 'done_batch';
    }

    // Phase 8.3.4 — state persist xuống DB (KHÔNG biến in-memory), sống sót qua restart container.
    // chatId là ngữ cảnh nơi luồng bắt đầu (group HOẶC DM Phase 8.6).
    const chatKey = String(cq.message?.chat?.id ?? '');
    await this.prisma.pendingReport.deleteMany({ where: { chatId: chatKey, userId: String(cq.from.id) } });
    await this.prisma.pendingReport.create({
      data: {
        chatId: chatKey,
        userId: String(cq.from.id),
        username: cq.from.username || cq.from.first_name || null,
        batchId,
        severity,
        expiresAt: new Date(Date.now() + PENDING_TTL_MINUTES * 60_000),
      },
    });
    const sevLabel = severity === 'critical' ? '🔴 Nghiêm trọng' : severity === 'warning' ? '🟡 Trung bình' : '🟢 Nhẹ';
    await this.answer(cq, 'Đang chờ mô tả lỗi...');
    const prompt = '📝 Mẻ <b>#' + batch.batchCode + '</b> · mức độ: <b>' + sevLabel + '</b>\n' +
      'Bạn có <b>' + PENDING_TTL_MINUTES + ' phút</b> để gõ mô tả sự cố (gửi tin nhắn thường).\nVí dụ: "10/200 sản phẩm bị nứt men ở đáy".';
    if (cq.message) {
      await this.editWithKeyboard(cq.message.chat.id, cq.message.message_id, prompt, []);
    } else {
      await this.telegram.send(prompt.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    }
    return 'severity_saved';
  }

  private async sendKeyboard(text: string, keyboard: InlineButton[][], chatId: number | string): Promise<void> {
    try {
      await this.bot?.sendMessage(chatId as any, text, { reply_markup: { inline_keyboard: keyboard } });
    } catch (err: any) {
      this.logger.error('Gửi keyboard thất bại: ' + String(err?.message || err).slice(0, 100));
    }
  }

  private async editWithKeyboard(chatId: number | string, messageId: number, text: string, keyboard: InlineButton[][]): Promise<void> {
    try {
      await this.bot?.editMessageText(text, {
        chat_id: chatId as any,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (err: any) {
      this.logger.warn('editMessageText thất bại, gửi message mới thay thế: ' + String(err?.message || err).slice(0, 80));
      await this.sendKeyboard(text.replace(/<[^>]+>/g, ''), keyboard, chatId);
    }
  }

  private async onFreeTextMessage(msg: TelegramBot.Message, chatContext?: number | string): Promise<MessageOutcome> {
    const contextChat = String(chatContext ?? msg.chat.id);
    const pending = await this.consumePending(contextChat, String(msg.from?.id ?? ''));
    if (pending.status === 'none') return 'ignored'; // tin nhắn thường — bot không làm gì

    if (pending.status === 'expired') {
      // Phase 8.5 — hết hạn thì HỦY, tuyệt đối không hiểu nhầm là mô tả lỗi
      this.logger.warn('[TG-PENDING] Phiên báo lỗi hết hạn của user ' + msg.from?.username + ' → tự hủy.');
      await this.dmSend(msg.chat.id, '⌛ Phiên báo lỗi trước đó của bạn đã hết hạn (>' + PENDING_TTL_MINUTES + ' phút) nên tôi đã hủy. Gõ lại để bắt đầu từ đầu.');
      return 'expired_cancelled';
    }

    // Phase 8.3.5 — coi tin nhắn này là mô tả lỗi
    const report = pending.report!;
    const username = report.username || msg.from?.username || String(msg.from?.id ?? '');
    const batch = await this.prisma.batch.findUnique({ where: { id: report.batchId }, select: { batchCode: true, currentStage: true } });
    if (!batch) {
      await this.prisma.pendingReport.delete({ where: { id: report.id } });
      await this.dmSend(msg.chat.id, '⚠️ Mẻ bạn đang báo lỗi không còn tồn tại. Phiên báo đã hủy.');
      return 'ignored';
    }

    const severity = report.severity as 'info' | 'warning' | 'critical';
    const composed = await this.riskQc.qcComposeFreeform({
      batchCode: batch.batchCode,
      description: msg.text!,
      severity,
      reporter: username,
    });

    // Tạo Alert đúng như luồng QC trên web (nguồn ghi rõ đến từ Telegram)
    await this.prisma.alert.create({
      data: { batchId: report.batchId, level: severity, source: 'telegram:@' + username, message: composed },
    });
    // Broadcast cảnh báo chính thức vào GROUP chung (ai không dùng DM vẫn thấy)
    await this.telegram.send(composed + '\n<i>(nguồn: báo lỗi Telegram @' + username + ')</i>');
    // Xóa phiên chờ + xác nhận tóm tắt ngay nơi user đang chat
    await this.prisma.pendingReport.delete({ where: { id: report.id } });

    const sevLabel = severity === 'critical' ? '🔴 Nghiêm trọng' : severity === 'warning' ? '🟡 Trung bình' : '🟢 Nhẹ';
    await this.dmSend(
      msg.chat.id,
      '✅ <b>Đã ghi nhận báo lỗi</b>\n' +
      '🧾 Mẻ: <b>#' + batch.batchCode + '</b> (' + (TelegramService.STAGE_VN[batch.currentStage] ?? batch.currentStage) + ')\n' +
      'Mức độ: ' + sevLabel + '\n📝 Mô tả: "' + msg.text + '"\n<i>Đã lưu vào bảng cảnh báo trên dashboard.</i>',
    );
    this.lastRecordedReport = { batchCode: batch.batchCode, severity, description: msg.text! };
    return 'report_recorded';
  }

  /** Kết quả lần ghi nhận gần nhất (phục vụ kiểm thử tự động). */
  lastRecordedReport: { batchCode: string; severity: string; description: string } | null = null;

  /** Trạng thái phiên chờ của 1 user: none / expired (tự hủy) / valid. */
  async consumePending(chatId: string, userId: string): Promise<{ status: 'none' | 'expired' | 'valid'; report?: { id: string; batchId: string; severity: string; username: string | null } }> {
    const row = await this.prisma.pendingReport.findFirst({ where: { chatId, userId }, orderBy: { createdAt: 'desc' } });
    if (!row) return { status: 'none' };
    if (row.expiresAt.getTime() <= Date.now()) {
      await this.prisma.pendingReport.deleteMany({ where: { chatId, userId, expiresAt: { lte: new Date() } } });
      return { status: 'expired' };
    }
    return { status: 'valid', report: { id: row.id, batchId: row.batchId, severity: row.severity, username: row.username } };
  }

  // ============================================================
  // PHASE 8.6.3 + 8.6.4 — MENU CÁ NHÂN CHO THỢ (DM)
  // ============================================================

  /** 8.6.3 — liệt kê 6 công đoạn để thợ gán себя. */
  private async onStationPicker(msg: TelegramBot.Message, telegramUserId: string): Promise<MessageOutcome> {
    const current = (await this.prisma.authorizedWorker.findUnique({ where: { telegramUserId } }))?.assignedStage;
    const rows: InlineButton[][] = STATION_CHOICES.map((s) => [{
      text: (current === s.stage ? '✔ ' : '') + s.label,
      callback_data: 'pick_stage:' + s.stage,
    }]);
    await this.dmSend(msg.chat.id, '🧑‍🏭 <b>Bạn phụ trách công đoạn nào?</b>' + (current ? '\nHiện tại: <b>' + this.stationLabel(current) + '</b>' : ''), { inline_keyboard: rows });
    return 'station_picker';
  }

  private stationLabel(stage: string): string {
    return STATION_CHOICES.find((s) => s.stage === stage)?.label ?? (TelegramService.STAGE_VN[stage] ?? stage);
  }

  private async onStationPicked(cq: TelegramBot.CallbackQuery, telegramUserId: string, stage: string): Promise<CallbackOutcome> {
    if (!STATION_CHOICES.some((s) => s.stage === stage)) {
      await this.answer(cq, 'Công đoạn không hợp lệ.', true);
      return 'invalid_stage';
    }
    await this.prisma.authorizedWorker.update({ where: { telegramUserId }, data: { assignedStage: stage } });
    await this.answer(cq, 'Đã gán: ' + this.stationLabel(stage));
    if (cq.message) {
      await this.dmSend(
        cq.message.chat.id,
        '✅ Đã gán bạn vào công đoạn: <b>' + this.stationLabel(stage) + '</b>.\nBấm <b>📦 Mẻ tôi đang làm</b> để xem các mẻ đang ở công đoạn này.',
      );
    }
    return 'stage_assigned';
  }

  /** 8.6.4 — danh sách mẻ theo công đoạn thợ phụ trách. */
  private async onMyBatches(msg: TelegramBot.Message, telegramUserId: string): Promise<MessageOutcome> {
    const worker = await this.prisma.authorizedWorker.findUnique({ where: { telegramUserId } });
    if (!worker?.assignedStage) {
      await this.dmSend(msg.chat.id, '📌 Bạn chưa chọn công đoạn. Bấm <b>🧑‍🏭 Công đoạn của tôi</b> trước nhé.');
      return 'need_station_first';
    }
    const listed = await this.listMyBatches(worker.assignedStage);
    if (!listed.length) {
      await this.dmSend(msg.chat.id,
        '📭 Hiện <b>chưa có mẻ nào</b> ở công đoạn <b>' + this.stationLabel(worker.assignedStage) +
        '</b>.\n🔔 Đừng lo — ngay khi có mẻ mới chuyển vào, bot sẽ tự nhắn thông báo cho bạn kèm nút nhận mẻ.',
        { inline_keyboard: [[{ text: '🔄 Kiểm tra lại', callback_data: 'refresh_my_batches' }]] });
      return 'my_batches_listed';
    }
    await this.dmSend(msg.chat.id, '📦 Các mẻ đang ở <b>' + this.stationLabel(worker.assignedStage) + '</b> — bấm để mở chi tiết & 🙋 nhận mẻ:', { inline_keyboard: listed });
    return 'my_batches';
  }

  private static PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

  private async listMyBatches(stage: string): Promise<InlineButton[][]> {
    const batches = await this.prisma.batch.findMany({
      where: { currentStage: stage }, // stage ∈ 6 công đoạn nên DONE tự loại
      take: 20,
      select: { id: true, batchCode: true, productName: true, quantity: true, priority: true, claimedByName: true },
    });
    return batches
      .sort((a, b) => (TelegramListenerService.PRIORITY_RANK[a.priority] ?? 1) - (TelegramListenerService.PRIORITY_RANK[b.priority] ?? 1))
      .map((b) => [{
        text: '#' + b.batchCode + ' · ' + b.productName + ' ×' + b.quantity +
          (b.claimedByName ? ' · 👤' + b.claimedByName : ' · 🟢 trống'),
        callback_data: 'my_batch:' + b.id,
      }]);
  }

  /**
   * Phase 8.7 — thợ "nhận mẻ": ghi nhận người phụ trách ngay trên Batch.
   * Nếu đã có người khác nhận → vẫn cho nhận đè (thực tế xưởng: người vắng phải có người gánh),
   * nhưng báo rõ để cả hai biết.
   */
  private async onClaimBatch(cq: TelegramBot.CallbackQuery, worker: { displayName: string; telegramUserId: string }, batchId: string): Promise<CallbackOutcome> {
    const b = await this.prisma.batch.findUnique({ where: { id: batchId }, select: { id: true, batchCode: true, claimedByUserId: true, claimedByName: true, currentStage: true } });
    if (!b) {
      await this.answer(cq, '❌ Không tìm thấy mẻ.', true);
      return 'batch_not_found';
    }
    if (b.currentStage === 'DONE') {
      await this.answer(cq, '⚠️ Mẻ đã hoàn thành.', true);
      return 'done_batch';
    }
    const previous = b.claimedByUserId && b.claimedByUserId !== worker.telegramUserId ? b.claimedByName : null;
    await this.prisma.batch.update({
      where: { id: batchId },
      data: { claimedByUserId: worker.telegramUserId, claimedByName: worker.displayName },
    });
    this.lastClaim = { batchCode: b.batchCode, workerName: worker.displayName };
    if (previous) {
      await this.answer(cq, 'Bạn đã NHẬN ĐÈ mẻ #' + b.batchCode + ' (trước đó: ' + previous + ')', true);
    } else {
      await this.answer(cq, '✔ Bạn đã nhận mẻ #' + b.batchCode);
    }
    if (cq.message) {
      await this.dmSend(
        cq.message.chat.id,
        '🙋 <b>' + worker.displayName + '</b> đã nhận mẻ <b>#' + b.batchCode + '</b>' +
        (previous ? '\n<i>(nhận đè từ ' + previous + ')</i>' : '') +
        '\n📍 Công đoạn: ' + this.stationLabel(b.currentStage) +
        '\nBấm <b>📦 Mẻ tôi đang làm</b> để thao tác tiếp.',
      );
    }
    return 'claim_saved';
  }

  /** Lần claim gần nhất (phục vụ kiểm thử). */
  lastClaim: { batchCode: string; workerName: string } | null = null;

  private async onMyBatchOpened(cq: TelegramBot.CallbackQuery, worker: { displayName: string; assignedStage: string | null }, batchId: string): Promise<CallbackOutcome> {
    const b = await this.prisma.batch.findUnique({
      where: { id: batchId },
      select: { id: true, batchCode: true, productName: true, quantity: true, priority: true, deadlineDays: true, defectCount: true, currentStage: true, claimedByName: true },
    });
    if (!b) {
      await this.answer(cq, '❌ Không tìm thấy mẻ.', true);
      return 'batch_not_found';
    }
    const priVn = b.priority === 'high' ? 'CAO' : b.priority === 'medium' ? 'TRUNG BÌNH' : 'THẤP';
    const detail =
      '🧾 <b>#' + b.batchCode + '</b> — ' + b.productName + ' ×' + b.quantity + '\n' +
      '📍 Công đoạn: <b>' + this.stationLabel(b.currentStage) + '</b>\n' +
      '⚡ Ưu tiên: <b>' + priVn + '</b>\n' +
      '🗓 Hạn giao: ' + (b.deadlineDays != null ? 'còn <b>' + b.deadlineDays + ' ngày</b>' : 'không có') + '\n' +
      '🔍 Lỗi ghi nhận tới nay: <b>' + b.defectCount + '</b>\n' +
      '👤 Người nhận: <b>' + (b.claimedByName || 'chưa ai — bấm 🙋 để nhận') + '</b>';
    const buttons: InlineButton[][] = [
      [
        { text: '✅ Hoàn thành bước này', callback_data: 'my_advance:' + b.id + ':' + b.currentStage },
        { text: '⚠️ Báo lỗi mẻ này', callback_data: 'my_report:' + b.id },
      ],
      [{ text: b.claimedByName ? '🙋 Nhận đè mẻ này' : '🙋 Nhận mẻ này', callback_data: 'claim:' + b.id }],
    ];
    await this.answer(cq, 'Mở mẻ #' + b.batchCode);
    if (cq.message) {
      await this.editWithKeyboard(cq.message.chat.id, cq.message.message_id, detail, buttons);
    } else {
      await this.sendKeyboard(detail.replace(/<[^>]+>/g, ''), buttons, this.allowedChatId);
    }
    return 'batch_detail';
  }

  /**
   * 8.6.4 — "Hoàn thành bước này" từ DM: TÁI SỬ DỤNG NGUYÊN VẸN advanceStage có điều kiện
   * chống double-advance (Phase 8.2). Broadcast vào group do advanceStage tự phát;
   * ở đây chỉ thêm xác nhận riêng trong DM cho thợ.
   */
  private async onMyAdvancePressed(cq: TelegramBot.CallbackQuery, worker: { displayName: string }, batchId: string, expectedStage: string): Promise<CallbackOutcome> {
    if (!STAGES.includes(expectedStage as Stage)) {
      await this.answer(cq, 'Dữ liệu nút không hợp lệ.', true);
      return 'invalid_stage';
    }
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) {
      await this.answer(cq, '❌ Không tìm thấy mẻ.', true);
      return 'batch_not_found';
    }
    if (batch.currentStage !== expectedStage) {
      await this.answer(cq, '⚠️ Mẻ này vừa được người khác chuyển bước (' + this.stationLabel(batch.currentStage) + ').', true);
      return 'race_blocked';
    }
    try {
      const updated = await this.batches.advanceStage(batchId, undefined, expectedStage as Stage);
      await this.answer(cq, '✔ Đã ghi nhận!');
      if (cq.message) {
        await this.dmSend(
          cq.message.chat.id,
          '✅ <b>' + worker.displayName + '</b> đã hoàn thành bước <b>' + this.stationLabel(expectedStage) + '</b> cho mẻ <b>#' + updated.batchCode +
          '</b>.\n📍 Mẻ chuyển sang: <b>' + this.stationLabel(updated.currentStage) + '</b>\n<i>(Group chung đã được thông báo.)</i>',
        );
      }
      return 'dm_advanced';
    } catch (err: any) {
      const friendly = err instanceof StageTransitionError ? err.message : '❌ Không advance được: ' + (err?.message || err);
      await this.answer(cq, friendly, true);
      return 'race_blocked';
    }
  }

  /** 8.6.4 — "Báo lỗi mẻ này": bỏ bước chọn mẻ, vào thẳng chọn severity (tái dùng PendingReport). */
  private async onMyReportStart(cq: TelegramBot.CallbackQuery, worker: { displayName: string }, batchId: string): Promise<CallbackOutcome> {
    // Tái sử dụng đúng handler severity của Phase 8.3 bằng cách mô phỏng lựa chọn batch đã biết
    const fakeSelect: TelegramBot.CallbackQuery = { ...cq, data: 'select_batch:' + batchId } as unknown as TelegramBot.CallbackQuery;
    const res = await this.onBatchPickedForReport(fakeSelect, batchId);
    return res === 'severity_prompted' ? 'severity_prompted' : res;
  }

  // ================= DEMO/TEST HELPERS (cùng đường xử lý thật 100%) =================

  get allowedChat(): string {
    return this.allowedChatId;
  }

  async simulateCallback(data: string, userId: number, username: string | null, messageId?: number, messageText?: string, opts?: { chatType?: 'group' | 'private'; chatIdOverride?: number | string }): Promise<{ ok: boolean; outcome: CallbackOutcome; info?: string }> {
    const chatType = opts?.chatType ?? 'group';
    const chatId = opts?.chatIdOverride ?? (chatType === 'private' ? userId : (Number(this.allowedChatId) || this.allowedChatId));
    const cq = {
      id: 'sim-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      data,
      from: { id: userId, is_bot: false, first_name: username || 'tester', ...(username ? { username } : {}) },
      message: {
        message_id: messageId ?? 999999,
        chat: { id: chatId, type: chatType },
        ...(messageText ? { text: messageText } : {}),
      },
    } as unknown as TelegramBot.CallbackQuery;
    try {
      const outcome = await this.handleCallbackQuery(cq);
      return { ok: true, outcome };
    } catch (err: any) {
      return { ok: false, outcome: 'unknown_callback', info: String(err?.message || err) };
    }
  }

  /** Giả lập tin nhắn; chatType: 'group' (mặc định = group chính) | 'private' (DM). */
  async simulateMessage(text: string, userId: number, username: string | null, opts?: { chatType?: 'group' | 'private'; chatIdOverride?: number | string }): Promise<{ ok: boolean; outcome: MessageOutcome; recorded?: { batchCode: string; severity: string; description: string }; dm?: string | null; buttons?: string[]; info?: string }> {
    const chatType = opts?.chatType ?? 'group';
    const chatId = opts?.chatIdOverride ?? (chatType === 'private' ? userId : (Number(this.allowedChatId) || this.allowedChatId));
    const msg = {
      message_id: Date.now() % 1000000,
      text,
      from: { id: userId, is_bot: false, first_name: username || 'tester', ...(username ? { username } : {}) },
      chat: { id: chatId, type: chatType },
    } as unknown as TelegramBot.Message;
    this.lastDmReply = null;
    this.lastDmButtons = null;
    try {
      const outcome = await this.handleMessage(msg);
      return {
        ok: true,
        outcome,
        ...(outcome === 'report_recorded' && this.lastRecordedReport ? { recorded: this.lastRecordedReport } : {}),
        dm: this.lastDmReply,
        buttons: this.lastDmButtons ?? undefined,
      };
    } catch (err: any) {
      return { ok: false, outcome: 'ignored', info: String(err?.message || err) };
    }
  }
}

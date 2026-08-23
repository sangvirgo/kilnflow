import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export interface InlineButton { text: string; callback_data: string }
export interface InlineKeyboard { inline_keyboard: InlineButton[][] }

/**
 * Gui thong bao Telegram Bot API qua HTTP.
 * Khong co token/chatId -> che do NO-OP (warn mot lan): he thong van chay day du cho demo,
 * khong bao gio lam roi luong nghiep vu chinh.
 */
@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private botToken = '';
  private chatId = '';
  private warnedNoConfig = false;

  constructor(private config: ConfigService, private prisma: PrismaService) {}

  onModuleInit() {
    this.botToken = this.config.get('telegram.botToken', '');
    this.chatId = this.config.get('telegram.chatId', '');
    if (!this.enabled) this.logger.warn('TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID chưa cấu hình → thông báo sẽ chỉ ghi log.');
    else this.logger.log('Đã BẬT thông báo Telegram.');
  }

  get enabled(): boolean { return !!this.botToken && !!this.chatId; }

  /** Lần broadcast group thành công gần nhất (phục vụ kiểm thử Phase 8.6). */
  lastGroupBroadcast: string | null = null;

  /** Gửi tới 1 chat bất kỳ (group mặc định). Ghi nhận broadcast group gần nhất phục vụ kiểm thử. */
  async sendTo(targetChatId: number | string, html: string, inlineKeyboard?: InlineKeyboard): Promise<boolean> {
    const label = '[TG] ' + html.replace(/<[^>]+>/g, '');
    if (!this.enabled) {
      if (!this.warnedNoConfig) { this.logger.log(label + '  (no-op: chưa cấu hình telegram)'); this.warnedNoConfig = true; }
      return false;
    }
    try {
      let res: Response | null = null;
      // Retry 1 lần cho lỗi mạng thoáng qua (DNS/reset) — thông báo không được phép mất vì hiccup
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await fetch('https://api.telegram.org/bot' + this.botToken + '/sendMessage', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              chat_id: targetChatId,
              text: html,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
              ...(inlineKeyboard ? { reply_markup: inlineKeyboard } : {}),
            }),
          });
          break;
        } catch (netErr: any) {
          if (attempt === 0) { await new Promise((r) => setTimeout(r, 800)); continue; }
          throw netErr;
        }
      }
      if (!res || !res.ok) {
        this.logger.error('Gửi Telegram thất bại: HTTP ' + (res ? res.status : 'không phản hồi') + ' ' + (res ? await res.text().catch(() => '') : '').slice(0, 200));
        return false;
      }
      const sent = await res.json().catch(() => null) as { result?: { message_id?: number } } | null;
      const isGroup = String(targetChatId) === this.chatId;
      this.logger.log('[TG→] Đã gửi vào ' + (isGroup ? 'group' : 'DM ' + targetChatId) +
        (sent?.result?.message_id ? ' (message_id=' + sent.result.message_id + ')' : '') + ': ' + label.replace('[TG] ', '').slice(0, 70) + '...');
      if (isGroup) this.lastGroupBroadcast = html.replace(/<[^>]+>/g, '');
      return true;
    } catch (err: any) {
      this.logger.error('Lỗi mạng khi gửi Telegram: ' + (err?.message || err));
      return false;
    }
  }

  async send(html: string, inlineKeyboard?: InlineKeyboard): Promise<boolean> {
    return this.sendTo(this.chatId, html, inlineKeyboard);
  }

  /**
   * Phase 8.7 — DM trực tiếp tới TẤT CẢ thợ đang phụ trách `stage`:
   * mẻ mới vừa "đổ về" công đoạn của họ → thợ biết ngay có việc, không phải mở app dò.
   */
  async notifyStationArrival(stage: string, payload: { batchCode: string; productName: string; quantity: number; batchId?: string; priority?: string }): Promise<number> {
    const workers = await this.prisma.authorizedWorker.findMany({ where: { assignedStage: stage } });
    if (!workers.length) return 0;
    const stageVn = TelegramService.STAGE_VN[stage] ?? stage;
    const pri = payload.priority ? ' · ưu tiên ' + (TelegramService.PRIORITY_VN[payload.priority] ?? payload.priority) : '';
    const keyboard: InlineKeyboard | undefined = payload.batchId
      ? { inline_keyboard: [[{ text: '👀 Xem & nhận mẻ này', callback_data: 'my_batch:' + payload.batchId }]] }
      : undefined;
    for (const w of workers) {
      await this.sendTo(
        w.telegramUserId,
        '📥 <b>CÓ MỚI Ở CÔNG ĐOẠN CỦA BẠN</b>\n' +
        '🧾 #' + payload.batchCode + ' · ' + payload.productName + ' ×' + payload.quantity + pri +
        '\n📍 Công đoạn: <b>' + stageVn + '</b>',
        keyboard,
      );
    }
    this.lastStationPing = { stage, batchCode: payload.batchCode, workers: workers.length };
    return workers.length;
  }

  /** Ping công đoạn gần nhất (phục vụ kiểm thử). */
  lastStationPing: { stage: string; batchCode: string; workers: number } | null = null;

  // ---------- Nhãn tiếng Việt dùng chung ----------
  static PRIORITY_VN: Record<string, string> = { high: 'CAO', medium: 'TRUNG BÌNH', low: 'THẤP' };
  static STAGE_VN: Record<string, string> = {
    MOLDING: 'Tạo hình', DRYING_TRIMMING: 'Phơi khô & Tỉa', PAINTING: 'Vẽ',
    GLAZING: 'Tráng men', FIRING: 'Nung', QC_PACKING: 'Kiểm tra & Đóng gói', DONE: 'Hoàn thành',
  };

  // ---------- Thông báo theo event (spec section 8) ----------
  batchCreated(b: { id?: string; batchCode: string; productName: string; quantity: number; priority: string }) {
    const pri = TelegramService.PRIORITY_VN[b.priority] ?? b.priority;
    // Phase 8.7 — mẻ mới bắt đầu ở MOLDING → báo thợ đang phụ trách Tạo hình
    void this.notifyStationArrival('MOLDING', { ...b });
    return this.send('🆕 <b>BATCH MỚI</b> #' + b.batchCode + '\n' + b.productName + ' ×' + b.quantity +
      ' (ưu tiên: ' + pri + ') đã được xác nhận vào sản xuất.');
  }

  stageChanged(b: { id?: string; batchCode: string; productName: string; quantity?: number; firingTempC: number | null }, from: string, to: string) {
    const f = TelegramService.STAGE_VN[from] ?? from;
    const t = TelegramService.STAGE_VN[to] ?? to;
    const extra = to === 'FIRING' && b.firingTempC ? ' — nhiệt độ mục tiêu ' + b.firingTempC + '°C' : '';
    // Phase 8.2 — đính kèm nút xác nhận hoàn thành cho bước batch VỪA vào (to),
    // nhúng cả currentStage để listener đối chiếu chống double-advance (race condition).
    const keyboard = to !== 'DONE' && b.id
      ? { inline_keyboard: [[{ text: '✅ Xác nhận hoàn thành bước này', callback_data: 'advance:' + b.id + ':' + to }]] }
      : undefined;
    // Phase 8.7 — mẻ vừa "đổ về" công đoạn `to` → DM thợ phụ trách công đoạn đó
    if (to !== 'DONE') {
      void this.notifyStationArrival(to, {
        batchId: b.id, batchCode: b.batchCode, productName: b.productName,
        quantity: b.quantity ?? 0,
      });
    }
    return this.send('🔁 #' + b.batchCode + ' (' + b.productName + ') chuyển giai đoạn:\n' + f + ' ➡️ <b>' + t + '</b>' + extra, keyboard);
  }

  riskWarning(batchCode: string, risks: { type: string; severity: string; detail: string }[]) {
    const lines = risks.map((r) => '• [' + r.severity.toUpperCase() + '] ' + r.type + ': ' + r.detail).join('\n');
    return this.send('⚠️ <b>CẢNH BÁO RỦI RO TRƯỚC SẢN XUẤT</b> — đơn hàng liên quan #' + batchCode + '\n' + lines +
      '\n<i>(Người dùng vẫn có thể chọn tiếp tục thủ công)</i>');
  }

  qcAlert(batchCode: string, r: { severity: string; defectRate: number; telegramMessage: string }) {
    return this.send(r.telegramMessage + '\n<i>(nguồn: risk-qc-agent)</i>');
  }

  monitorDelay(b: { batchCode: string; currentStage: string }, expectedHours: number) {
    const stage = TelegramService.STAGE_VN[b.currentStage] ?? b.currentStage;
    return this.send('🐢 <b>BATCH TRỄ TIẾN ĐỘ</b> (hệ thống tự phát hiện)\n#' + b.batchCode + ' đang ở giai đoạn <b>' + stage +
      '</b> đã quá lâu (' + Math.round(expectedHours * 1.3) + 'h dự kiến tối đa) mà chưa chuyển stage.');
  }

  scheduleSummary(scheduled: number, delayed: number) {
    return this.send('🗓 Scheduler chạy xong: <b>' + scheduled + '</b> mẻ được xếp lò, <b>' + delayed + '</b> mẻ trễ deadline.');
  }
}
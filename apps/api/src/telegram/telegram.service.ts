import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.botToken = this.config.get('telegram.botToken', '');
    this.chatId = this.config.get('telegram.chatId', '');
    if (!this.enabled) this.logger.warn('TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID chưa cấu hình → thông báo sẽ chỉ ghi log.');
    else this.logger.log('Đã BẬT thông báo Telegram.');
  }

  get enabled(): boolean { return !!this.botToken && !!this.chatId; }

  /** Lần broadcast group thành công gần nhất (phục vụ kiểm thử Phase 8.6). */
  lastGroupBroadcast: string | null = null;

  /** Phase 8.2 — keyboard gắn kèm thông báo cho nút tương tác trong group. */
  async send(html: string, inlineKeyboard?: { inline_keyboard: { text: string; callback_data: string }[][] }): Promise<boolean> {
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
              chat_id: this.chatId,
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
      this.logger.log('[TG→] Đã gửi vào group' + (sent?.result?.message_id ? ' (message_id=' + sent.result.message_id + ')' : '') + ': ' + label.replace('[TG] ', '').slice(0, 70) + '...');
      this.lastGroupBroadcast = html.replace(/<[^>]+>/g, '');
      return true;
    } catch (err: any) {
      this.logger.error('Lỗi mạng khi gửi Telegram: ' + (err?.message || err));
      return false;
    }
  }

  // ---------- Nhãn tiếng Việt dùng chung ----------
  static PRIORITY_VN: Record<string, string> = { high: 'CAO', medium: 'TRUNG BÌNH', low: 'THẤP' };
  static STAGE_VN: Record<string, string> = {
    MOLDING: 'Tạo hình', DRYING_TRIMMING: 'Phơi khô & Tỉa', PAINTING: 'Vẽ',
    GLAZING: 'Tráng men', FIRING: 'Nung', QC_PACKING: 'Kiểm tra & Đóng gói', DONE: 'Hoàn thành',
  };

  // ---------- Thông báo theo event (spec section 8) ----------
  batchCreated(b: { batchCode: string; productName: string; quantity: number; priority: string }) {
    const pri = TelegramService.PRIORITY_VN[b.priority] ?? b.priority;
    return this.send('🆕 <b>BATCH MỚI</b> #' + b.batchCode + '\n' + b.productName + ' ×' + b.quantity +
      ' (ưu tiên: ' + pri + ') đã được xác nhận vào sản xuất.');
  }

  stageChanged(b: { id?: string; batchCode: string; productName: string; firingTempC: number | null }, from: string, to: string) {
    const f = TelegramService.STAGE_VN[from] ?? from;
    const t = TelegramService.STAGE_VN[to] ?? to;
    const extra = to === 'FIRING' && b.firingTempC ? ' — nhiệt độ mục tiêu ' + b.firingTempC + '°C' : '';
    // Phase 8.2 — đính kèm nút xác nhận hoàn thành cho bước batch VỪA vào (to),
    // nhúng cả currentStage để listener đối chiếu chống double-advance (race condition).
    const keyboard = to !== 'DONE' && b.id
      ? { inline_keyboard: [[{ text: '✅ Xác nhận hoàn thành bước này', callback_data: 'advance:' + b.id + ':' + to }]] }
      : undefined;
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
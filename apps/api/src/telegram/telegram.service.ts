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
    if (!this.enabled) this.logger.warn('TELEGRAM_BOT_TOKEN/CHAT_ID chua cau hinh -> thong bao se chi ghi log.');
    else this.logger.log('Telegram notifications ENABLED.');
  }

  get enabled(): boolean { return !!this.botToken && !!this.chatId; }

  async send(html: string): Promise<boolean> {
    const label = '[TG] ' + html.replace(/<[^>]+>/g, '');
    if (!this.enabled) {
      if (!this.warnedNoConfig) { this.logger.log(label + '  (no-op: chua cau hinh telegram)'); this.warnedNoConfig = true; }
      return false;
    }
    try {
      const res = await fetch('https://api.telegram.org/bot' + this.botToken + '/sendMessage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
      });
      if (!res.ok) {
        this.logger.error('Telegram sendMessage failed: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
        return false;
      }
      return true;
    } catch (err: any) {
      this.logger.error('Telegram network error: ' + (err?.message || err));
      return false;
    }
  }

  // ---------- Thong bao theo event (spec section 8) ----------
  batchCreated(b: { batchCode: string; productName: string; quantity: number; priority: string }) {
    return this.send('🆕 <b>BATCH MOI</b> #' + b.batchCode + '\n' + b.productName + ' x' + b.quantity + ' (uu tien: ' + b.priority + ') da duoc xac nhan vao san xuat.');
  }

  stageChanged(b: { batchCode: string; productName: string; firingTempC: number | null }, from: string, to: string) {
    const extra = to === 'FIRING' && b.firingTempC ? ' — nhiet do muc tieu ' + b.firingTempC + '°C' : '';
    return this.send('🔁 #' + b.batchCode + ' (' + b.productName + ') chuyen giai doan:\n' + from + ' ➡️ <b>' + to + '</b>' + extra);
  }

  riskWarning(batchCode: string, risks: { type: string; severity: string; detail: string }[]) {
    const lines = risks.map((r) => '• [' + r.severity.toUpperCase() + '] ' + r.type + ': ' + r.detail).join('\n');
    return this.send('⚠️ <b>CANH BAO RUI RO TRUOC SAN XUAT</b> — don hang lien quan #' + batchCode + '\n' + lines + '\n<i>(Nguoi dung van co the chon tiep tuc thu cong)</i>');
  }

  qcAlert(batchCode: string, r: { severity: string; defectRate: number; telegramMessage: string }) {
    return this.send(r.telegramMessage + '\n<i>(nguon: risk-qc-agent)</i>');
  }

  monitorDelay(b: { batchCode: string; currentStage: string }, expectedHours: number) {
    return this.send('🐢 <b>BATCH TRE TIEN DO</b> (tu dong phat hien)\n#' + b.batchCode + ' o giai doan ' + b.currentStage + ' vuot ' + Math.round(expectedHours) + 'h du kien ma chua chuyen stage.');
  }

  scheduleSummary(scheduled: number, delayed: number) {
    return this.send('🗓 Scheduler chay xong: <b>' + scheduled + '</b> me duoc xep lo, <b>' + delayed + '</b> me bi tre deadline.');
  }
}
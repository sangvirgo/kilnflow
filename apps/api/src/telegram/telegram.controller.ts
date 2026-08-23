import { Body, Controller, Get, Post } from '@nestjs/common';
import { TelegramListenerService } from './telegram.listener';
import { TelegramService } from './telegram.service';

/**
 * Phase 8 — endpoint GIẢ LẬP nút bấm/tin nhắn Telegram để demo & test tự động
 * (cùng đường xử lý 100% như khi user bấm thật trong group; vẫn qua kiểm tra chat_id).
 */
@Controller('telegram')
export class TelegramController {
  constructor(private listener: TelegramListenerService, private telegram: TelegramService) {}

  /** Broadcast group thành công gần nhất (phục vụ kiểm thử Phase 8.6). */
  @Get('broadcast-last')
  broadcastLast() {
    return { text: this.telegram.lastGroupBroadcast };
  }

  /** body: { data, userId?, username?, messageId?, messageText?, chatType?: 'group'|'private', chatId? } */
  @Post('test/callback')
  testCallback(@Body() body: { data?: string; userId?: number; username?: string | null; messageId?: number; messageText?: string; chatType?: 'group' | 'private'; chatId?: number | string }) {
    if (!body?.data) return { ok: false, outcome: 'unknown_callback', info: 'Thiếu body.data' };
    return this.listener.simulateCallback(body.data, Number(body.userId) || 42, body.username ?? null, body.messageId, body.messageText, { chatType: body.chatType, chatIdOverride: body.chatId });
  }

  /** body: { text, userId?, username?, chatType?: 'group'|'private', chatId?, resetThrottle? } */
  @Post('test/message')
  testMessage(@Body() body: { text?: string; userId?: number; username?: string | null; chatType?: 'group' | 'private'; chatId?: number | string; resetThrottle?: boolean }) {
    if (!body?.text) return { ok: false, outcome: 'ignored', info: 'Thiếu body.text' };
    if (body.resetThrottle) this.listener.resetGuidanceThrottle();
    return this.listener.simulateMessage(String(body.text), Number(body.userId) || 42, body.username ?? null, { chatType: body.chatType, chatIdOverride: body.chatId });
  }
}

import { Body, Controller, Get, Post, Query, Sse } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { TRACE_EVENT, PREVIEW_EVENT, ERROR_EVENT, TraceEvent, ConfirmOrderDto } from '@kilnflow/shared-types';
import { OrdersService } from './orders.service';
import { OrchestratorService } from '../agents/orchestrator.service';
import { AppError } from '../common/errors';
import { TraceEmitter } from '../agents/trace';

interface SseMessage { data: string; id?: string; type?: string; }

@Controller('orders')
export class OrdersController {
  constructor(private orders: OrdersService, private orchestrator: OrchestratorService) {}

  /** Non-SSE phien ban: tra preview truc tiep (tien cho curl/test). */
  @Post('parse')
  parse(@Body() body: { rawText?: string }) {
    const rawText = (body?.rawText || '').trim();
    if (!rawText) throw new AppError(400, 'EMPTY_INPUT', 'Thiếu rawText trong body.');
    return this.orders.preview(rawText);
  }

  /**
   * Reasoning trace LIVE qua SSE (spec section 7).
   * GET vi EventSource chi ho tro GET; text truyen bang query param.
   */
  @Sse('parse/stream')
  parseStream(@Query('text') text: string): Observable<SseMessage> {
    const rawText = (text || '').trim();
    const subject = new Subject<SseMessage>();
    let seq = 0;
    const push = (type: string, payload: unknown) =>
      subject.next({ id: String(++seq), type, data: JSON.stringify(payload) });

    const emit: TraceEmitter = (icon: string, message: string, level: 'info' | 'success' | 'warn' | 'error' = 'info', agent?: string) =>
      push(TRACE_EVENT, { at: new Date().toISOString(), icon, message, level, agent } satisfies TraceEvent);

    // Phase 8-fix: kickoff SAU khi Nest subscribe vào observable — nếu chạy đồng bộ,
    // các event đầu (🚀 🔍 📤) phát ra trước subscription sẽ bị mất.
    setTimeout(() => {
      (async () => {
        if (!rawText) throw new AppError(400, 'EMPTY_INPUT', 'Thiếu tham số ?text= trên URL.');
        const preview = await this.orchestrator.runPreview(rawText, emit);
        push(PREVIEW_EVENT, preview);
      })().catch((err: any) => {
        const status = err instanceof AppError ? err.statusCode : 500;
        const code = err instanceof AppError ? err.errorCode : 'ORCHESTRATION_FAILED';
        push(ERROR_EVENT, { statusCode: status, error: code, message: err instanceof Error ? err.message : String(err) });
      }).finally(() => subject.complete());
    }, 0);

    // Heartbeat giua ket noi song khi agent chuan bi LLM response lau
    const hb = setInterval(() => subject.next({ type: 'ping', data: String(Date.now()) }), 15000);
    return subject.asObservable().pipe(finalize(() => clearInterval(hb)));
  }

  @Post('confirm')
  confirm(@Body() dto: ConfirmOrderDto & Record<string, unknown>) {
    if (!dto || typeof dto.rawText !== 'string' || !dto.parsed) {
      throw new AppError(400, 'INVALID_CONFIRM', 'Body phải có rawText và parsed (kết quả preview đã được review).');
    }
    return this.orders.confirm(dto as unknown as ConfirmOrderDto);
  }
}
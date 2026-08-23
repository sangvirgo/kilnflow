import { Injectable, Logger } from '@nestjs/common';
import { ParsedOrderSchema, ParsedOrder } from '@kilnflow/shared-types';
import { z } from 'zod';
import { LlmService } from '../llm/llm.service';
import { parseLlmJson } from '../llm/llm.utils';
import { AgentValidationError } from '../common/errors';
import { TraceEmitter } from './trace';
import { PARSER_SYSTEM_PROMPT } from './parser.prompts';

/**
 * Parser Agent — bien free-text tieng Viet thanh ParsedOrder.
 * Self-correction loop: output loi Zod -> gui lai (kem broken output + thong bao loi)
 * toi da 2 lan sua. Van fail -> AgentValidationError ro rang (khong nuot loi).
 */
@Injectable()
export class ParserAgent {
  private readonly logger = new Logger(ParserAgent.name);

  constructor(private llm: LlmService) {}

  async parse(rawText: string, emit: TraceEmitter): Promise<ParsedOrder> {
    const MAX_ATTEMPTS = 3; // 1 lan chinh + 2 lan tu-sua
    let lastBrokenOutput = '';
    let lastError = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let userMsg = 'Order description:\n"' + rawText + '"\n\nReturn the JSON object now.';
      if (attempt > 1) {
        userMsg += '\n\nYOUR PREVIOUS OUTPUT FAILED VALIDATION.' +
          '\nValidation error:\n' + lastError +
          '\nBroken output:\n' + lastBrokenOutput.slice(0, 800) +
          '\nFix the issues and return the FULL corrected JSON object only.';
        emit('🔁', 'Output sai schema (lần ' + (attempt - 1) + ') — gửi lại lỗi + output hỏng, yêu cầu LLM tự sửa...', 'warn', 'parser');
      } else {
        emit('🔍', 'Parser Agent khởi động — đọc ' + rawText.trim().length + ' ký tự mô tả đơn hàng...', 'info', 'parser');
        emit('📤', 'Gửi prompt (rules + few-shot) tới ' + this.llm.providerName + ', chờ JSON...', 'info', 'parser');
      }

      try {
        const raw = await this.llm.complete(
          [{ role: 'system', content: PARSER_SYSTEM_PROMPT }, { role: 'user', content: userMsg }],
          { jsonMode: true, temperature: attempt === 1 ? 0.1 : 0, label: 'parser-attempt-' + attempt },
);
        if (attempt === 1) emit('📥', 'Nhận phản hồi LLM (' + raw.trim().length + ' ký tự) — đối chiếu schema Zod 12 trường...', 'info', 'parser');
        lastBrokenOutput = raw;
        const candidate = this.normalize(parseLlmJson<unknown>(raw));
        const parsed = ParsedOrderSchema.safeParse(candidate);
        if (!parsed.success) {
          lastError = this.formatZodError(parsed.error);
          continue;
        }
        const final = this.enforceBusinessRules(parsed.data);
        emit('⚖️', 'Áp dụng luật ưu tiên theo deadline (' + (final.deadline_days ?? 'không có') + ' ngày) → ' + final.priority.toUpperCase(), 'info', 'parser');
        if (final.assumptions.length > 0) emit('🤔', 'LLM đã tự giả định ' + final.assumptions.length + ' điểm — ghi nhận vào assumptions[]', 'warn', 'parser');
        emit('✓', 'Parse thành công' + (attempt > 1 ? ' sau ' + (attempt - 1) + ' lần tự sửa' : '') + ' — ' + final.product_name + ' ×' + final.quantity, 'success', 'parser');
        return final;
      } catch (err: any) {
        // JSON khong parse duoc hoac loi khac o buoc xu ly output
        lastError = err instanceof Error ? err.message : String(err);
        this.logger.warn('parse attempt ' + attempt + ' failed: ' + lastError);
      }
    }

    throw new AgentValidationError('parser', {
      attempts: MAX_ATTEMPTS,
      lastError,
      lastOutputPreview: lastBrokenOutput.slice(0, 400),
    });
  }

  /** Chiu dung LLM tra so dang chu ('200') hoac truong thieu -> co gang cuu truoc khi bat loi. */
  private normalize(obj: any): any {
    if (obj == null || typeof obj !== 'object') return obj;
    const n = { ...obj };
    const toNum = (v: any): any => {
      if (typeof v === 'string') { const p = Number(v.replace(/[.,]/g, (m, off, s) => (s.indexOf('.', off + 1) >= 0 ? '' : '.'))); return Number.isFinite(p) ? p : v; }
      return v;
    };
    for (const k of ['height_cm', 'quantity', 'firing_temp_c', 'estimated_clay_kg', 'estimated_firing_hours', 'deadline_days']) {
      if (n[k] !== null && n[k] !== undefined) n[k] = toNum(n[k]);
    }
    if (!Array.isArray(n.assumptions)) n.assumptions = [];
    return n;
  }

  /** Luat nghiep vu BAT BUOC tinh trong code, khong pho thac cho LLM. */
  private enforceBusinessRules(p: ParsedOrder): ParsedOrder {
    const d = p.deadline_days;
    const derivedPriority = d == null ? 'medium' : d <= 7 ? 'high' : d <= 15 ? 'medium' : 'low';
    return { ...p, quantity: Math.round(p.quantity), firing_temp_c: Math.round(p.firing_temp_c), priority: derivedPriority as ParsedOrder['priority'] };
  }

  private formatZodError(e: z.ZodError): string {
    return e.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ');
  }
}
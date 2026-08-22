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
        emit('🔁', 'Output sai schema (lan ' + (attempt - 1) + ') — yeu cau LLM tu sua...', 'warn');
      } else {
        emit('🔍', 'Dang phan tich mo ta don hang...', 'info');
      }

      try {
        const raw = await this.llm.complete(
          [{ role: 'system', content: PARSER_SYSTEM_PROMPT }, { role: 'user', content: userMsg }],
          { jsonMode: true, temperature: attempt === 1 ? 0.1 : 0, label: 'parser-attempt-' + attempt },
);
        lastBrokenOutput = raw;
        const candidate = this.normalize(parseLlmJson<unknown>(raw));
        const parsed = ParsedOrderSchema.safeParse(candidate);
        if (!parsed.success) {
          lastError = this.formatZodError(parsed.error);
          continue;
        }
        const final = this.enforceBusinessRules(parsed.data);
        emit('✓', 'Parse thanh cong' + (attempt > 1 ? ' sau ' + (attempt - 1) + ' lan tu-sua' : '') + ' — ' + final.product_name + ' x' + final.quantity, 'success');
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
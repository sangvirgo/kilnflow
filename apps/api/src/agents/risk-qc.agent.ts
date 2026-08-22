import { Injectable } from '@nestjs/common';
import { RiskReviewOutputSchema, RiskReviewOutput, RiskItem, QcReportResultSchema, QcReportResult } from '@kilnflow/shared-types';
import { LlmService } from '../llm/llm.service';
import { parseLlmJson } from '../llm/llm.utils';
import { TraceEmitter } from './trace';
import { RISK_REVIEW_SYSTEM_PROMPT, QC_MESSAGE_SYSTEM_PROMPT } from './risk-qc.prompts';

export interface RiskContext {
  kilnBacklogHours?: number | null;
  totalKilnCapacity?: number | null;
  pendingBatchCount?: number | null;
}

/**
 * Risk / QC Agent:
 * - pre-production review (recommend_proceed) — co deterministic fallback neu LLM loi/sai schema.
 * - QC classification: NGUONG TINH THEO CODE (>15% critical, 5-15% warning, <5% info + keyword nghiem trong),
 *   LLM chi viet message Telegram tieng Viet.
 */
@Injectable()
export class RiskQcAgent {
  constructor(private llm: LlmService) {}

  async preProductionReview(parsed: any, ctx: RiskContext, emit: TraceEmitter): Promise<RiskReviewOutput> {
    const payload = { parsed, ...this.clean(ctx) };
    const userMsg = this.wrapPayload(payload) + '\nReview this order and return the JSON verdict.';
    let lastErr = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const raw = await this.llm.complete(
          [{ role: 'system', content: RISK_REVIEW_SYSTEM_PROMPT }, { role: 'user', content: attempt === 1 ? userMsg : userMsg + '\n\nPREVIOUS ATTEMPT FAILED VALIDATION:\n' + lastErr + '\nReturn corrected JSON only.' }],
          { jsonMode: true, temperature: 0.1, label: 'risk-review-' + attempt },
);
        const candidate = parseLlmJson<unknown>(raw);
        const res = RiskReviewOutputSchema.safeParse(candidate);
        if (res.success) return res.data;
        lastErr = res.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ');
      } catch (err: any) { lastErr = err?.message || String(err); }
    }
    // Deterministic fallback — tinh nang van hoat dong khi LLM hong, danh dau ro rang
    emit('⚠️', 'Risk LLM khong tin cay (' + lastErr.slice(0, 80) + ') — dung bo luat deterministic.', 'warn');
    return this.deterministicReview(parsed, ctx);
  }

  private deterministicReview(parsed: any, ctx: RiskContext): RiskReviewOutput {
    const risks: RiskItem[] = [];
    const gt = String(parsed.glaze_type || '').toLowerCase();
    if ((gt.includes('stoneware') || gt.includes('porcelain')) && parsed.firing_temp_c < 1200) risks.push({ type: 'temp_glaze_mismatch', severity: 'high', detail: 'Men ' + gt + ' can >=1200°C nhung don chi nung ' + parsed.firing_temp_c + '°C.' });
    else if (gt.includes('earthenware') && parsed.firing_temp_c > 1150) risks.push({ type: 'temp_glaze_mismatch', severity: 'medium', detail: 'Earthenware thuong <=1150°C nhung don yeu cau ' + parsed.firing_temp_c + '°C.' });
    if (parsed.deadline_days != null && ctx.kilnBacklogHours != null && parsed.deadline_days <= 7 && ctx.kilnBacklogHours! > parsed.deadline_days * 16) risks.push({ type: 'deadline_tight', severity: 'high', detail: 'Backlog lo ~' + Math.round(ctx.kilnBacklogHours!) + 'h trong khi deadline chi ' + parsed.deadline_days + ' ngay.' });
    if (!risks.length) risks.push({ type: 'general', severity: 'low', detail: 'Khong phat hien rui ro lon.' });
    return { risks, recommend_proceed: !risks.some((r) => r.severity === 'high') };
  }

  async qcClassify(input: { batchCode: string; totalQuantity: number; defectCount: number; note?: string }): Promise<QcReportResult> {
    const rate = input.totalQuantity > 0 ? input.defectCount / input.totalQuantity : 0;
    const severeHit = /nứt kết cấu|nứt thân|vỡ|gãy|crack|break|shatter/i.test(input.note || '');
    let severity: 'info' | 'warning' | 'critical';
    if (rate > 0.15 || (severeHit && rate > 0.05)) severity = 'critical';
    else if (rate >= 0.05) severity = 'warning';
    else severity = 'info';

    const fallbackMsg = (severity === 'critical' ? '🚨 ' : severity === 'warning' ? '⚠️ ' : 'ℹ️ ') +
      'QC Batch #' + input.batchCode + ': ' + input.defectCount + '/' + input.totalQuantity + ' loi (' + Math.round(rate * 1000) / 10 + '%). Ghi chú: ' + (input.note || 'không có');

    let message = fallbackMsg;
    try {
      const raw = await this.llm.complete(
        [
          { role: 'system', content: QC_MESSAGE_SYSTEM_PROMPT },
          { role: 'user', content: this.wrapPayload({ ...input, defectRate: rate, severity }) + '\nWrite the alert JSON now.' },
        ],
        { jsonMode: true, temperature: 0.3, label: 'qc-message' },
);
      const cand = parseLlmJson<{ message?: unknown }>(raw);
      if (typeof cand.message === 'string' && cand.message.trim().length > 10) message = cand.message.trim();
    } catch { /* giu fallback message — khong bao gio fail QC flow vi LLM */ }

    const out: QcReportResult = { defectCount: input.defectCount, totalQuantity: input.totalQuantity, defectRate: Math.round(rate * 10000) / 10000, severity, telegramMessage: message };
    const validated = QcReportResultSchema.safeParse(out);
    if (!validated.success) throw new Error('QC result failed schema: ' + validated.error.message);
    return validated.data;
  }

  private wrapPayload(p: unknown): string {
    return '<<<PAYLOAD\n' + JSON.stringify(p) + '\nPAYLOAD>>>';
  }
  private clean(o: any) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) if (v != null) out[k] = v;
    return out;
  }
}
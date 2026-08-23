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
  /** Trung binh actualClayKg cua CAC ME LICH SU TUONG TU (spec 5.3) — null neu khong co du lieu. */
  historicalAvgClayKg?: number | null;
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
    let lastErr = '';
    // Log chi tiết 3 nhóm kiểm tra (spec 5.3) — giúp demo nhìn thấy agent "suy nghĩ" gì
    emit('🌡', 'Kiểm tra 1/3 — men "' + (parsed.glaze_type ?? '?') + '" có hợp nhiệt nung ' + parsed.firing_temp_c + '°C?', 'info', 'risk');
    emit('📅', 'Kiểm tra 2/3 — deadline ' + (parsed.deadline_days ?? '?') + ' ngày vs backlog lò ~' + Math.round(ctx.kilnBacklogHours ?? 0) + 'h (' + (ctx.pendingBatchCount ?? 0) + ' mẻ đang chạy)', 'info', 'risk');
    if (ctx.historicalAvgClayKg != null) {
      emit('🧱', 'Kiểm tra 3/3 — đất ' + Math.round(parsed.estimated_clay_kg) + 'kg vs trung bình mẻ tương tự ~' + Math.round(ctx.historicalAvgClayKg) + 'kg', 'info', 'risk');
    }

    // NGƯỠNG TÍNH TRONG CODE — LLM chỉ được flag khi hint = true (nhất quán với fallback deterministic)
    const gtLower = String(parsed.glaze_type || '').toLowerCase();
    const tempGlazeMismatch =
      ((gtLower.includes('stoneware') || gtLower.includes('porcelain')) && parsed.firing_temp_c < 1200) ||
      (gtLower.includes('earthenware') && parsed.firing_temp_c > 1150);
    let clayDeviationPct: number | null = null;
    if (ctx.historicalAvgClayKg != null && ctx.historicalAvgClayKg! > 0 && parsed.estimated_clay_kg > 0) {
      clayDeviationPct = Math.round(Math.abs(parsed.estimated_clay_kg - ctx.historicalAvgClayKg!) / ctx.historicalAvgClayKg! * 100);
    }
    const deadlineTightByRule = parsed.deadline_days != null &&
      parsed.deadline_days <= 7 && (ctx.kilnBacklogHours ?? 0) > parsed.deadline_days * 16;
    emit('📏', 'Bộ luật code: tempMismatch=' + tempGlazeMismatch + ' · clayDev=' + (clayDeviationPct ?? 'n/a') + '% · deadlineTight=' + deadlineTightByRule, 'info', 'risk');

    const payload = { parsed, ...this.clean(ctx), rulesHint: { tempGlazeMismatch, clayDeviationPct, deadlineTightByRule } };
    const userMsg = this.wrapPayload(payload) + '\nReview this order and return the JSON verdict.';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const raw = await this.llm.complete(
          [{ role: 'system', content: RISK_REVIEW_SYSTEM_PROMPT }, { role: 'user', content: attempt === 1 ? userMsg : userMsg + '\n\nPREVIOUS ATTEMPT FAILED VALIDATION:\n' + lastErr + '\nReturn corrected JSON only.' }],
          { jsonMode: true, temperature: 0.1, label: 'risk-review-' + attempt },
);
        const candidate = parseLlmJson<unknown>(raw);
        const res = RiskReviewOutputSchema.safeParse(candidate);
        if (res.success) {
          const highs = res.data.risks.filter((r) => r.severity === 'high').length;
          emit('🧾', 'Kết luận Risk: ' + res.data.risks.filter((r) => r.type !== 'general').length + ' rủi ro (' + highs + ' mức cao) → recommend_proceed = ' + res.data.recommend_proceed, res.data.recommend_proceed ? 'success' : 'warn', 'risk');
          return res.data;
        }
        lastErr = res.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ');
      } catch (err: any) { lastErr = err?.message || String(err); }
    }
    // Deterministic fallback — tinh nang van hoat dong khi LLM hong, danh dau ro rang
    emit('⚠️', 'Risk LLM không đáng tin (' + lastErr.slice(0, 80) + ') — dùng bộ luật deterministic.', 'warn', 'risk');
    return this.deterministicReview(parsed, ctx);
  }

  /** Danh gia rui ro deterministic (khong goi LLM) — dung de server tu kiem tra lai luc confirm. */
  quickReview(parsed: any, ctx: RiskContext): RiskReviewOutput {
    return this.deterministicReview(parsed, ctx);
  }

  private deterministicReview(parsed: any, ctx: RiskContext): RiskReviewOutput {
    const risks: RiskItem[] = [];
    const gt = String(parsed.glaze_type || '').toLowerCase();
    if ((gt.includes('stoneware') || gt.includes('porcelain')) && parsed.firing_temp_c < 1200) risks.push({ type: 'temp_glaze_mismatch', severity: 'high', detail: 'Men "' + gt + '" cần nung ≥1200°C nhưng đơn chỉ yêu cầu ' + parsed.firing_temp_c + '°C.' });
    else if (gt.includes('earthenware') && parsed.firing_temp_c > 1150) risks.push({ type: 'temp_glaze_mismatch', severity: 'medium', detail: 'Men earthenware thường chỉ nung ≤1150°C nhưng đơn yêu cầu ' + parsed.firing_temp_c + '°C.' });
    if (parsed.deadline_days != null && ctx.kilnBacklogHours != null && parsed.deadline_days <= 7 && ctx.kilnBacklogHours! > parsed.deadline_days * 16) risks.push({ type: 'deadline_tight', severity: 'high', detail: 'Backlog lò ~' + Math.round(ctx.kilnBacklogHours!) + 'h trong khi deadline chỉ còn ' + parsed.deadline_days + ' ngày.' });
    if (ctx.historicalAvgClayKg != null && ctx.historicalAvgClayKg! > 0 && parsed.estimated_clay_kg > 0) {
      const dev = Math.abs(parsed.estimated_clay_kg - ctx.historicalAvgClayKg!) / ctx.historicalAvgClayKg!;
      if (dev > 0.45) {
        risks.push({
          type: 'clay_estimate_outlier',
          severity: dev > 0.9 ? 'high' : 'medium',
          detail: 'Lượng đất ước tính ' + Math.round(parsed.estimated_clay_kg) + 'kg lệch ' + Math.round(dev * 100) + '% so với trung bình các mẻ lịch sử tương tự (~' + Math.round(ctx.historicalAvgClayKg!) + 'kg).',
        });
      }
    }
    if (!risks.length) risks.push({ type: 'general', severity: 'low', detail: 'Không phát hiện rủi ro lớn.' });
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
      'QC Batch #' + input.batchCode + ': ' + input.defectCount + '/' + input.totalQuantity + ' lỗi (' + Math.round(rate * 1000) / 10 + '%). Ghi chú: ' + (input.note || 'không có');

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

  /**
   * Phase 8.3.5 — soạn message cảnh báo cho báo lỗi tự do từ Telegram (/baocao).
   * Severity do NGƯỜI DÙNG chọn trực tiếp (override), không tính theo defect-rate vì
   * thợ chỉ mô tả bằng lời; LLM chỉ viết câu thông báo tiếng Việt đúng tông.
   */
  async qcComposeFreeform(input: { batchCode: string; description: string; severity: 'info' | 'warning' | 'critical'; reporter?: string }): Promise<string> {
    const fallbackMsg = (input.severity === 'critical' ? '🚨 ' : input.severity === 'warning' ? '⚠️ ' : 'ℹ️ ') +
      'BÁO LỖI từ Telegram — Batch #' + input.batchCode +
      (input.reporter ? ' (báo bởi @' + input.reporter + ')' : '') +
      ': ' + input.description;
    try {
      const raw = await this.llm.complete(
        [
          { role: 'system', content: QC_MESSAGE_SYSTEM_PROMPT },
          { role: 'user', content: this.wrapPayload({
              batchCode: input.batchCode,
              note: input.description,
              severity: input.severity,
              source: 'telegram /baocao',
            }) + '\nWrite the alert JSON now.' },
        ],
        { jsonMode: true, temperature: 0.3, label: 'qc-freeform-message' },
      );
      const cand = parseLlmJson<{ message?: unknown }>(raw);
      if (typeof cand.message === 'string' && cand.message.trim().length > 10) return cand.message.trim();
    } catch { /* giữ fallback message — không bao giờ fail luồng báo lỗi vì LLM */ }
    return fallbackMsg;
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
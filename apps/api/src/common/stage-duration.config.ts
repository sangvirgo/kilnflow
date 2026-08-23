/**
 * NGUỒN SỰ THẬT DUY NHẤT về "một công đoạn kéo dài bao lâu là bình thường".
 * Cả Autonomous Monitor (bắn cảnh báo trễ) lẫn API Kanban (progress bar) đều gọi
 * hàm này — đảm bảo UI và bot không bao giờ lệch pha nhau về "thế nào là trễ".
 *
 * Con số giữ nguyên từ Phase 5 (không bịa số mới), theo nhịp làm việc xưởng gốm.
 */

export const STAGE_EXPECTED_HOURS: Record<string, number> = {
  MOLDING: 24,
  DRYING_TRIMMING: 48, // sấy & sửa mộc: 2 ngày
  PAINTING: 36,
  GLAZING: 24,
  FIRING: 14,          // mặc định — override theo từng mẻ bên dưới
  QC_PACKING: 12,
  DONE: Infinity,
};

/** Vượt 30% thời gian dự kiến → coi là TRỄ (spec 5.6). Monitor + UI dùng chung ngưỡng. */
export const OVERDUE_MARGIN = 1.3;

/**
 * Thời gian dự kiến (giờ) cho 1 batch tại 1 công đoạn — THỨ TƯƠNG ƯU TIÊN:
 * 1. batch.stageEstimates[stage] (Phase 9: AI chốt lúc tạo batch, riêng từng mẻ)
 * 2. FIRING → estimatedFiringHours của chính mẻ
 * 3. Hằng số theo bảng trên (batch cũ tạo trước Phase 9)
 */
export function getExpectedStageDuration(stage: string, batch?: { estimatedFiringHours?: number | null; stageEstimates?: unknown }): number {
  const se = batch?.stageEstimates as Record<string, unknown> | null | undefined;
  if (se && typeof se === 'object' && !Array.isArray(se)) {
    const v = Number((se as any)[stage]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  if (stage === 'FIRING' && batch?.estimatedFiringHours != null && batch.estimatedFiringHours > 0) {
    return batch.estimatedFiringHours;
  }
  return STAGE_EXPECTED_HOURS[stage] ?? 24;
}

/** progressPercent = elapsed/expected*100, cap 999% để hiển thị. */
export function computeStageProgress(stage: string, lastStageChangeAt: Date, now: number, batch?: { estimatedFiringHours?: number | null; stageEstimates?: unknown }): {
  expectedStageDurationHours: number;
  elapsedInStageHours: number;
  progressPercent: number;
  isOverdue: boolean;
} {
  const expectedStageDurationHours = getExpectedStageDuration(stage, batch);
  const elapsedInStageHours = Math.max(0, (now - lastStageChangeAt.getTime()) / 3_600_000);
  const rawPct = expectedStageDurationHours > 0 ? (elapsedInStageHours / expectedStageDurationHours) * 100 : 999;
  const progressPercent = Math.min(999, Math.round(rawPct * 10) / 10);
  return { expectedStageDurationHours, elapsedInStageHours: Math.round(elapsedInStageHours * 10) / 10, progressPercent, isOverdue: rawPct > OVERDUE_MARGIN * 100 };
}

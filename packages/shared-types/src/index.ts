/** Kilnflow shared contract — dung chung boi apps/api va apps/web. Moi output AI deu co Zod schema o day. */
import { z } from 'zod';

export const STAGES = ['MOLDING', 'DRYING_TRIMMING', 'PAINTING', 'GLAZING', 'FIRING', 'QC_PACKING', 'DONE'] as const;
export type Stage = (typeof STAGES)[number];
export const PRIORITIES = ['high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const ALERT_LEVELS = ['info', 'warning', 'critical'] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

// ---------------- Parser Agent ----------------
export const ParsedOrderSchema = z.object({
  product_name: z.string().min(1),
  pattern: z.string().nullable(),
  glaze_color: z.string().nullable(),
  height_cm: z.number().positive().nullable(),
  quantity: z.number().int().positive(),
  firing_temp_c: z.number().int().min(600).max(1500),
  estimated_clay_kg: z.number().positive(),
  glaze_type: z.string().min(1),
  estimated_firing_hours: z.number().positive(),
  priority: z.enum(PRIORITIES),
  deadline_days: z.number().int().positive().nullable(),
  assumptions: z.array(z.string()),
});
export type ParsedOrder = z.infer<typeof ParsedOrderSchema>;

// ---------------- Estimator Agent ----------------
export const EstimateBasisSchema = z.object({
  historicalBatchId: z.string(), productName: z.string(), pattern: z.string().nullable(),
  heightCm: z.number().nullable(), glazeType: z.string().nullable(),
  actualClayKg: z.number(), actualFiringHours: z.number(), similarity: z.number(),
});
export type EstimateBasis = z.infer<typeof EstimateBasisSchema>;

/** Phase 9 — ước lượng thời gian cho 6 công đoạn sản xuất (giờ). */
export const STAGE_DURATION_KEYS = ['MOLDING', 'DRYING_TRIMMING', 'PAINTING', 'GLAZING', 'FIRING', 'QC_PACKING'] as const;
export const StageDurationMapSchema = z.object(
  Object.fromEntries(STAGE_DURATION_KEYS.map((k) => [k, z.number().positive()])) as {
    [K in (typeof STAGE_DURATION_KEYS)[number]]: z.ZodNumber;
  },
);
export type StageDurationMap = z.infer<typeof StageDurationMapSchema>;

export const EstimatorOutputSchema = z.object({
  estimatedClayKg: z.number().positive(), estimatedFiringHours: z.number().positive(),
  confidence: z.enum(['high', 'low']), method: z.enum(['historical', 'formula']),
  basis: z.array(EstimateBasisSchema),
  // Phase 9 — thời gian từng công đoạn (weighted avg từ RAG, hoặc formula khi cold-start)
  stageEstimates: StageDurationMapSchema,
  stageEstimateConfidence: z.enum(['high', 'low']),
  stageEstimateBasis: z.array(EstimateBasisSchema),
});
export type EstimatorOutput = z.infer<typeof EstimatorOutputSchema>;

// ---------------- Risk / QC Agent ----------------
export const RiskItemSchema = z.object({ type: z.string().min(1), severity: z.enum(['low', 'medium', 'high']), detail: z.string().min(1) });
export type RiskItem = z.infer<typeof RiskItemSchema>;
export const RiskReviewOutputSchema = z.object({ risks: z.array(RiskItemSchema), recommend_proceed: z.boolean() });
export type RiskReviewOutput = z.infer<typeof RiskReviewOutputSchema>;
export const QcSeveritySchema = z.enum(['info', 'warning', 'critical']);
export type QcSeverity = z.infer<typeof QcSeveritySchema>;
export const QcReportResultSchema = z.object({
  defectCount: z.number().int().nonnegative(), totalQuantity: z.number().int().positive(),
  defectRate: z.number(), severity: QcSeveritySchema, telegramMessage: z.string().min(1),
});
export type QcReportResult = z.infer<typeof QcReportResultSchema>;

// ---------------- Scheduler Agent ----------------
export const ScheduleEntrySchema = z.object({ batchCode: z.string(), kilnId: z.string(), kilnName: z.string(), startTime: z.string() });
export type ScheduleEntry = z.infer<typeof ScheduleEntrySchema>;
export const DelayedBatchSchema = z.object({ batchCode: z.string(), reason: z.string(), suggestion: z.string() });
export type DelayedBatch = z.infer<typeof DelayedBatchSchema>;
export const SchedulerOutputSchema = z.object({ schedule: z.array(ScheduleEntrySchema), delayed_batches: z.array(DelayedBatchSchema) });
export type SchedulerOutput = z.infer<typeof SchedulerOutputSchema>;

// ---------------- Knowledge Agent ----------------
export const KnowledgeSourceSchema = z.object({ title: z.string(), url: z.string().nullable(), snippet: z.string() });
export type KnowledgeSource = z.infer<typeof KnowledgeSourceSchema>;
export const KnowledgeAnswerSchema = z.object({ answer: z.string(), sources: z.array(KnowledgeSourceSchema) });
export type KnowledgeAnswer = z.infer<typeof KnowledgeAnswerSchema>;

// ---------------- Reasoning trace / SSE ----------------
export const TRACE_EVENT = 'trace';
export const PREVIEW_EVENT = 'preview';
export const ERROR_EVENT = 'error';
export interface TraceEvent { at: string; icon: string; message: string; level: 'info' | 'success' | 'warn' | 'error'; agent?: string; }

// ---------------- API payloads ----------------
export interface OrderPreview { rawText: string; parsed: ParsedOrder; estimation: EstimatorOutput; risk: RiskReviewOutput; llmProvider: string; }
export interface ConfirmOrderDto {
  rawText: string;
  parsed: ParsedOrder;
  /** Ket qua risk review o buoc preview (client gui len de doi chieu). */
  riskReview?: RiskReviewOutput | null;
  /** Phase 9 — estimation tu preview, de luu stageEstimates vao Batch khi confirm. */
  estimation?: EstimatorOutput | null;
  /**
   * true khi nguoi da thay ro rang bao rui ro (recommend_proceed=false) van chap nhan tiep tuc.
   * Server tu danh gia lai rui ro; khi rui ro cao ma khong co flag nay -> tu choi tao batch.
   */
  overrideRisk?: boolean;
}
export interface BatchDto {
  id: string; batchCode: string; productName: string; currentStage: Stage; priority: Priority;
  quantity: number; glazeType: string | null; firingTempC: number | null;
  estimatedClayKg: number | null; estimatedFiringHours: number | null; deadlineDays: number | null;
  defectCount: number; kilnId: string | null; scheduledStart: string | null;
  lastStageChangeAt: string; createdAt: string;
  /** Phase 9 — progress trong công đoạn hiện tại (nguồn logic chung với Monitor) */
  expectedStageDurationHours: number;
  elapsedInStageHours: number;
  progressPercent: number;
  isOverdue: boolean;
  /** Phase 8.7 — thợ đã nhận mẻ (qua DM) */
  claimedByName?: string | null;
}
export interface AlertDto { id: string; batchId: string; batchCode?: string; level: AlertLevel; message: string; source: string; createdAt: string; }
export interface ApiError { statusCode: number; error: string; message: string; detail?: unknown; }
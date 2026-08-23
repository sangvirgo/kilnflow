import { Injectable } from '@nestjs/common';
import { OrderPreview } from '@kilnflow/shared-types';
import { ParserAgent } from './parser.agent';
import { EstimatorAgent } from './estimator.agent';
import { RiskQcAgent, RiskContext } from './risk-qc.agent';
import { LlmService } from '../llm/llm.service';
import { PrismaService } from '../prisma/prisma.service';
import { TraceEmitter, silentTrace } from './trace';

/**
 * Orchestrator — KHONG tu parse/tu uoc luong (spec 5). Chi dieu phoi:
 * Parser -> Estimator -> Risk/QC va lap OrderPreview.
 */
@Injectable()
export class OrchestratorService {
  constructor(
    private parser: ParserAgent,
    private estimator: EstimatorAgent,
    private riskQc: RiskQcAgent,
    private llm: LlmService,
    private prisma: PrismaService,
) {}

  async runPreview(rawText: string, emit: TraceEmitter = silentTrace()): Promise<OrderPreview> {
    emit('🚀', 'Orchestrator bắt đầu quy trình 3 agent...', 'info', 'system');

    // 1) Parser (self-correction loop bên trong)
    const parsed = await this.parser.parse(rawText, emit);

    // 2) Estimator (RAG tren HistoricalBatch)
    const estimation = await this.estimator.estimate(parsed, emit);

    // 3) Risk review (kem ngu canh backlog lo hien tai + trung binh clay cua me lich su TUONG TU)
    emit('🧪', 'Risk agent kiểm tra men/nhiệt độ, deadline và lượng đất so với dữ liệu lịch sử...', 'info', 'risk');
    const ctx = await this.buildRiskContext(estimation.basis);
    const risk = await this.riskQc.preProductionReview(parsed, ctx, emit);
    if (!risk.recommend_proceed) emit('⛔', 'Risk agent KHÔNG khuyến nghị tiếp tục — xem danh sách rủi ro trước khi xác nhận.', 'warn', 'risk');
    else emit('✓', 'Risk check xong — có thể tạo batch sau khi bạn xác nhận.', 'success', 'risk');

    emit('🏁', 'Hoàn tất! Preview đã sẵn sàng — chưa lưu gì vào hệ thống cho đến khi bạn xác nhận.', 'success', 'system');
    return { rawText, parsed, estimation, risk, llmProvider: this.llm.providerName };
  }

  /**
   * Ngu canh cho Risk agent. Neu co `basis` (cac me lich su tuong tu do Estimator tim duoc)
   * thi trung binh clay lay tren chinh cac me do; khong thi lay trung binh toan bo HistoricalBatch.
   */
  async buildRiskContext(basis?: { actualClayKg: number }[]): Promise<RiskContext> {
    const active = await this.prisma.batch.findMany({ where: { currentStage: { not: 'DONE' } }, select: { estimatedFiringHours: true } });
    const kilns = await this.prisma.kiln.findMany();
    let historicalAvgClayKg: number | null = null;
    if (basis && basis.length > 0) {
      historicalAvgClayKg = basis.reduce((s, b) => s + b.actualClayKg, 0) / basis.length;
    } else {
      const agg = await this.prisma.historicalBatch.aggregate({ _avg: { actualClayKg: true } });
      historicalAvgClayKg = agg._avg.actualClayKg ?? null;
    }
    return {
      kilnBacklogHours: active.reduce((s, b) => s + (b.estimatedFiringHours ?? 12), 0),
      totalKilnCapacity: kilns.reduce((s, k) => s + k.capacity, 0),
      pendingBatchCount: active.length,
      historicalAvgClayKg,
    };
  }
}
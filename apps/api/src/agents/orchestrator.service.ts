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
    emit('🚀', 'Orchestrator bat dau quy trinh 3 agent...', 'info');

    // 1) Parser (self-correction loop ben trong)
    const parsed = await this.parser.parse(rawText, emit);

    // 2) Estimator (RAG tren HistoricalBatch)
    const estimation = await this.estimator.estimate(parsed, emit);

    // 3) Risk review (kem ngu canh backlog lo hien tai)
    emit('🧪', 'Risk agent kiem tra men/nhiet do, deadline va nang suat lo...', 'info');
    const ctx = await this.buildRiskContext();
    const risk = await this.riskQc.preProductionReview(parsed, ctx, emit);
    if (!risk.recommend_proceed) emit('⛔', 'Risk agent KHONG khuyen nghi tiep tuc — xem danh sach rui ro truoc khi xac nhan.', 'warn');
    else emit('✓', 'Risk check xong — co the tien hanh tao batch sau khi ban xac nhan.', 'success');

    return { rawText, parsed, estimation, risk, llmProvider: this.llm.providerName };
  }

  private async buildRiskContext(): Promise<RiskContext> {
    const active = await this.prisma.batch.findMany({ where: { currentStage: { not: 'DONE' } }, select: { estimatedFiringHours: true } });
    const kilns = await this.prisma.kiln.findMany();
    return {
      kilnBacklogHours: active.reduce((s, b) => s + (b.estimatedFiringHours ?? 12), 0),
      totalKilnCapacity: kilns.reduce((s, k) => s + k.capacity, 0),
      pendingBatchCount: active.length,
    };
  }
}
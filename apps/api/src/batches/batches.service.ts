import { Injectable } from '@nestjs/common';
import { STAGES, BatchDto, Stage } from '@kilnflow/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { RiskQcAgent } from '../agents/risk-qc.agent';
import { StageTransitionError, NotFoundError, AppError } from '../common/errors';
import { computeStageProgress } from '../common/stage-duration.config';

/** State machine: CHI cho tien dung 1 stage, cam nhay coc (spec section 3). */
@Injectable()
export class BatchesService {
  constructor(
    private prisma: PrismaService,
    private telegram: TelegramService,
    private riskQc: RiskQcAgent,
  ) {}

  async list(): Promise<BatchDto[]> {
    const rows = await this.prisma.batch.findMany({ orderBy: { createdAt: 'desc' } });
    const now = Date.now();
    return rows.map((b) => ({
      ...this.toDto(b),
      // Phase 9 — progress công đoạn (cùng nguồn logic với Autonomous Monitor)
      ...computeStageProgress(b.currentStage, b.lastStageChangeAt, now, b),
      claimedByName: b.claimedByName ?? null,
    }));
  }

  /**
   * Tiến batch sang stage kế tiếp (spec section 3).
   * @param expectedFrom Phase 8.2 — khi truyền vào, update chỉ thành công nếu currentStage
   * trong DB VẪN đúng giá trị này ngay lúc chạy (conditional UPDATE nguyên tử) → 2 người
   * bấm nút gần như cùng lúc thì đúng 1 lần advance, người còn lại nhận lỗi rõ ràng.
   */
  async advanceStage(id: string, note?: string, expectedFrom?: Stage): Promise<BatchDto> {
    const batch = await this.prisma.batch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundError('Batch', id);
    const idx = STAGES.indexOf((expectedFrom ?? batch.currentStage) as Stage);
    if (idx < 0) throw new AppError(500, 'CORRUPT_STAGE', 'Batch ' + batch.batchCode + ' có currentStage không hợp lệ: ' + batch.currentStage);
    if (STAGES[idx] === 'DONE') throw new StageTransitionError('Batch ' + batch.batchCode + ' đã ở DONE — không thể tiến tiếp.');
    if (expectedFrom && expectedFrom !== batch.currentStage) {
      // Kiểm tra sớm để báo lỗi thân thiện; chốt hạ vẫn là điều kiện WHERE bên dưới (nguyên tử)
      throw new StageTransitionError('Mẻ #' + batch.batchCode + ' đã chuyển sang bước khác rồi (' + batch.currentStage + '), vui lòng kiểm tra lại trên dashboard.');
    }
    const next = STAGES[idx + 1];
    // Conditional update: chỉ áp dụng nếu currentStage vẫn là from → vật lý không thể double-advance hay nhảy cóc
    const res = await this.prisma.batch.updateMany({
      where: { id, currentStage: STAGES[idx] },
      data: { currentStage: next, lastStageChangeAt: new Date() },
    });
    if (res.count === 0) {
      throw new StageTransitionError('Mẻ #' + batch.batchCode + ' vừa được người khác chuyển bước trước bạn — hãy tải lại dashboard.');
    }
    const updated = await this.prisma.batch.findUniqueOrThrow({ where: { id } });
    await this.prisma.stageLog.create({ data: { batchId: id, stage: next, note: note || null } });
    await this.telegram.stageChanged(updated, STAGES[idx], next);
    return this.toDto(updated);
  }

  async qcReport(id: string, input: { defectCount: number; note?: string }) {
    const batch = await this.prisma.batch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundError('Batch', id);
    if (batch.currentStage !== 'QC_PACKING') {
      throw new StageTransitionError('Báo cáo QC chỉ áp dụng khi batch ở giai đoạn QC_PACKING (hiện tại: ' + batch.currentStage + ').');
    }
    const result = await this.riskQc.qcClassify({
      batchCode: batch.batchCode,
      totalQuantity: batch.quantity,
      defectCount: input.defectCount,
      note: input.note,
    });
    await this.prisma.batch.update({ where: { id }, data: { defectCount: input.defectCount } });
    await this.prisma.alert.create({
      data: { batchId: id, level: result.severity, source: 'risk-qc-agent', message: result.telegramMessage },
    });
    await this.telegram.qcAlert(batch.batchCode, result);
    return result;
  }

  async alerts(limit = 50) {
    const rows = await this.prisma.alert.findMany({ orderBy: { createdAt: 'desc' }, take: limit, include: { batch: true } });
    return rows.map((a) => ({
      id: a.id, batchId: a.batchId, batchCode: a.batch?.batchCode ?? '?', level: a.level, message: a.message, source: a.source, createdAt: a.createdAt.toISOString(),
    }));
  }

  private toDto(b: any): BatchDto {
    return {
      id: b.id, batchCode: b.batchCode, productName: b.productName, currentStage: b.currentStage, priority: b.priority,
      quantity: b.quantity, glazeType: b.glazeType, firingTempC: b.firingTempC, estimatedClayKg: b.estimatedClayKg,
      estimatedFiringHours: b.estimatedFiringHours, deadlineDays: b.deadlineDays, defectCount: b.defectCount,
      kilnId: b.kilnId, scheduledStart: b.scheduledStart ? b.scheduledStart.toISOString() : null,
      lastStageChangeAt: b.lastStageChangeAt.toISOString(), createdAt: b.createdAt.toISOString(),
      expectedStageDurationHours: 0, elapsedInStageHours: 0, progressPercent: 0, isOverdue: false,
      claimedByName: b.claimedByName ?? null,
    };
  }
}
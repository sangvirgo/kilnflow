import { Injectable } from '@nestjs/common';
import { STAGES, BatchDto, Stage } from '@kilnflow/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { RiskQcAgent } from '../agents/risk-qc.agent';
import { StageTransitionError, NotFoundError, AppError } from '../common/errors';

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
    return rows.map((b) => this.toDto(b));
  }

  async advanceStage(id: string, note?: string): Promise<BatchDto> {
    const batch = await this.prisma.batch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundError('Batch', id);
    const idx = STAGES.indexOf(batch.currentStage as Stage);
    if (idx < 0) throw new AppError(500, 'CORRUPT_STAGE', 'Batch ' + batch.batchCode + ' co currentStage khong hop le: ' + batch.currentStage);
    if (STAGES[idx] === 'DONE') throw new StageTransitionError('Batch ' + batch.batchCode + ' da o DONE — khong the tien tiep.');
    const next = STAGES[idx + 1];
    // (Vi chi cap nhat theo STAGES[idx+1] nen vat ly khong the nhay coc tu UI/API)
    const updated = await this.prisma.batch.update({
      where: { id },
      data: { currentStage: next, lastStageChangeAt: new Date() },
    });
    await this.prisma.stageLog.create({ data: { batchId: id, stage: next, note: note || null } });
    await this.telegram.stageChanged(updated, STAGES[idx], next);
    return this.toDto(updated);
  }

  async qcReport(id: string, input: { defectCount: number; note?: string }) {
    const batch = await this.prisma.batch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundError('Batch', id);
    if (batch.currentStage !== 'QC_PACKING') {
      throw new StageTransitionError('QC report chi ap dung khi batch o giai doan QC_PACKING (hien tai: ' + batch.currentStage + ').');
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
    };
  }
}
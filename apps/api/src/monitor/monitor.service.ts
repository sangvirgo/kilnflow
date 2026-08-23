import { Injectable, Logger } from '@nestjs/common';
import { STAGES, Stage } from '@kilnflow/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { STAGE_EXPECTED_HOURS, OVERMARGIN } from './stage-durations';

/**
 * Autonomous Monitor — kiem tra batch bi tre o moi stage.
 * Chay tu dong moi X ms hoac POST /monitor/tick de demo.
 * Khong phai agent (spec 5.6: khong phai conversational agent).
 */
@Injectable()
export class MonitorService {
  private readonly logger = new Logger(MonitorService.name);

  constructor(private prisma: PrismaService, private telegram: TelegramService) {}

  async tick(): Promise<{ checked: number; alerted: number }> {
    const now = Date.now();
    const batches = await this.prisma.batch.findMany({
      where: { currentStage: { not: 'DONE' } },
      include: { alerts: { select: { source: true, createdAt: true } } },
    });
    let checked = 0, alerted = 0;
    for (const b of batches) {
      checked++;
      const stage = b.currentStage;
      let expectedH = STAGE_EXPECTED_HOURS[stage] ?? 24;
      if (stage === 'FIRING' && b.estimatedFiringHours != null) expectedH = Math.max(expectedH, b.estimatedFiringHours);
      const elapsedMs = now - b.lastStageChangeAt.getTime();
      const thresholdMs = expectedH * 3600_000 * OVERMARGIN;
      if (elapsedMs > thresholdMs) {
        const sourceKey = 'monitor:' + stage;
        const already = b.alerts.some((a) => a.source === sourceKey && a.createdAt.getTime() > b.lastStageChangeAt.getTime());
        if (already) continue;
        this.logger.warn('Batch ' + b.batchCode + ' trễ tại ' + stage + ': ' + Math.round(elapsedMs / 3600_000) + 'h > ' + Math.round(expectedH * OVERMARGIN) + 'h');
        await this.prisma.alert.create({
          data: { batchId: b.id, level: 'warning', source: sourceKey, message: 'Trễ tại giai đoạn ' + stage + ': đã ' + Math.round(elapsedMs / 3600_000) + 'h (dự kiến tối đa ' + Math.round(expectedH * OVERMARGIN) + 'h)' },
        });
        await this.telegram.monitorDelay({ batchCode: b.batchCode, currentStage: stage }, expectedH);
        alerted++;
      }
    }
    return { checked, alerted };
  }
}
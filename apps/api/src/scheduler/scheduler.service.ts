import { Injectable } from '@nestjs/common';
import { SchedulerAgent } from '../agents/scheduler.agent';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { TraceEmitter, silentTrace } from '../agents/trace';

@Injectable()
export class SchedulerService {
  constructor(
    private schedulerAgent: SchedulerAgent,
    private prisma: PrismaService,
    private telegram: TelegramService,
) {}

  async run(emit: TraceEmitter = silentTrace()) {
    emit('🗓', 'Dang chay Scheduler Agent...', 'info');
    const pending = await this.prisma.batch.findMany({
      where: { currentStage: { not: 'DONE' }, scheduledStart: null },
      select: { batchCode: true, priority: true, deadlineDays: true, estimatedFiringHours: true },
    });
    const kilns = await this.prisma.kiln.findMany();
    const result = await this.schedulerAgent.propose(pending, kilns, emit);

    let scheduledCount = 0;
    for (const entry of result.output.schedule) {
      const batch = await this.prisma.batch.findFirst({ where: { batchCode: entry.batchCode } });
      if (batch) {
        await this.prisma.batch.update({
          where: { id: batch.id },
          data: { kilnId: entry.kilnId, scheduledStart: new Date(entry.startTime) },
        });
        scheduledCount++;
      }
    }

    for (const d of result.output.delayed_batches) {
      const batch = await this.prisma.batch.findFirst({ where: { batchCode: d.batchCode } });
      if (batch) {
        await this.prisma.alert.create({
          data: { batchId: batch.id, level: 'warning', source: 'scheduler-agent', message: 'Bi tre: ' + d.reason + ' | Giai phap: ' + d.suggestion },
        });
      }
    }
    await this.telegram.scheduleSummary(scheduledCount, result.output.delayed_batches.length);
    return {
      ...result.output,
      method: result.mode,
      scheduledCount,
      delayedCount: result.output.delayed_batches.length,
    };
  }
}
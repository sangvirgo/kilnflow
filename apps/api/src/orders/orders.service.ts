import { Injectable } from '@nestjs/common';
import { ParsedOrderSchema, ConfirmOrderDto } from '@kilnflow/shared-types';
import { OrchestratorService } from '../agents/orchestrator.service';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { TraceEmitter, silentTrace } from '../agents/trace';

@Injectable()
export class OrdersService {
  constructor(
    private orchestrator: OrchestratorService,
    private prisma: PrismaService,
    private telegram: TelegramService,
) {}

  preview(rawText: string, emit: TraceEmitter = silentTrace()) {
    // KHONG persist gi het — AI output chi la de xuat cho nguoi duyet (spec section 6)
    return this.orchestrator.runPreview(rawText, emit);
  }

  async confirm(dto: ConfirmOrderDto) {
    // Trust boundary: client gui len du lieu da review nhung server VAN validate lai bang Zod.
    const parsed = ParsedOrderSchema.parse(dto.parsed);

    const order = await this.prisma.order.create({
      data: {
        rawText: dto.rawText,
        parsedJson: parsed as any,
        confidence: null,
        assumptions: parsed.assumptions as any,
      },
    });

    const batchCode = await this.nextBatchCode();
    const batch = await this.prisma.batch.create({
      data: {
        batchCode,
        orderId: order.id,
        productName: parsed.product_name,
        currentStage: 'MOLDING',
        priority: parsed.priority,
        glazeType: parsed.glaze_color ?? parsed.glaze_type,
        firingTempC: Math.round(parsed.firing_temp_c),
        estimatedClayKg: parsed.estimated_clay_kg,
        estimatedFiringHours: parsed.estimated_firing_hours,
        quantity: parsed.quantity,
        deadlineDays: parsed.deadline_days,
      },
    });
    await this.prisma.stageLog.create({ data: { batchId: batch.id, stage: 'MOLDING', note: 'Khoi tao sau xac nhan' } });

    if (dto.riskAcknowledgeOverride) {
      await this.prisma.alert.create({
        data: { batchId: batch.id, level: 'warning', source: 'orders', message: 'Nguoi dung CHAP NHAN rui ro va tiep tuc desu recommend_proceed=false.' },
      });
    }

    await this.telegram.batchCreated(batch);
    return { orderId: order.id, batch };
  }

  private async nextBatchCode(): Promise<string> {
    let n = (await this.prisma.batch.count()) + 1;
    for (;;) {
      const code = 'GOM-' + String(n).padStart(3, '0');
      const exists = await this.prisma.batch.findUnique({ where: { batchCode: code } });
      if (!exists) return code;
      n++;
    }
  }
}
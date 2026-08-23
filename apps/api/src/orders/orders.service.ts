import { Injectable } from '@nestjs/common';
import { ParsedOrderSchema, ConfirmOrderDto, RiskReviewOutput } from '@kilnflow/shared-types';
import { OrchestratorService } from '../agents/orchestrator.service';
import { RiskQcAgent } from '../agents/risk-qc.agent';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { AppError } from '../common/errors';

@Injectable()
export class OrdersService {
  constructor(
    private orchestrator: OrchestratorService,
    private riskQc: RiskQcAgent,
    private prisma: PrismaService,
    private telegram: TelegramService,
) {}

  preview(rawText: string) {
    // KHONG persist gi het — AI output chi la de xuat cho nguoi duyet (spec section 6)
    return this.orchestrator.runPreview(rawText);
  }

  async confirm(dto: ConfirmOrderDto) {
    // Trust boundary: client gui len du lieu da review nhung server VAN validate lai bang Zod
    const parsed = ParsedOrderSchema.parse(dto.parsed);

    // Server TU danh gia lai rui ro (deterministic, khong phu thuot client) va doi chieu voi preview
    const ctx = await this.orchestrator.buildRiskContext();
    const serverRisk = this.riskQc.quickReview(parsed, ctx);
    const clientRisk = dto.riskReview ?? null;
    const risky =
      !serverRisk.recommend_proceed ||
      (clientRisk ? !clientRisk.recommend_proceed : false);

    if (risky && !dto.overrideRisk) {
      // Soft block (spec 5.3): tu choi tao batch, bat frontend phai hien rui ro va yeu cau nguoi dung chap nhan ro rang
      const risks = clientRisk && clientRisk.risks.length >= serverRisk.risks.length ? clientRisk.risks : serverRisk.risks;
      throw new AppError(409, 'RISK_ACKNOWLEDGEMENT_REQUIRED', 'Đơn có rủi ro trước sản xuất — cần người dùng xác nhận rõ ràng.', { risks, serverRisk });
    }

    const batchCode = await this.nextBatchCode();

    if (risky) {
      // recommend_proceed=false NHUNG nguoi dung da override -> Alert + Telegram TRUOC khi batch vao san xuat (spec 5.3)
      const risks = clientRisk && clientRisk.risks.length >= serverRisk.risks.length ? clientRisk.risks : serverRisk.risks;
      await this.telegram.riskWarning(batchCode, risks);
    }

    const order = await this.prisma.order.create({
      data: {
        rawText: dto.rawText,
        parsedJson: parsed as any,
        confidence: null,
        assumptions: parsed.assumptions as any,
      },
    });

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
    await this.prisma.stageLog.create({ data: { batchId: batch.id, stage: 'MOLDING', note: 'Khởi tạo sau khi người dùng xác nhận' } });

    if (risky) {
      const risks = clientRisk && clientRisk.risks.length >= serverRisk.risks.length ? clientRisk.risks : serverRisk.risks;
      const summary = risks.map((r) => '[' + r.severity + '] ' + r.detail).join(' | ');
      await this.prisma.alert.create({
        data: {
          batchId: batch.id,
          level: 'warning',
          source: 'risk-qc-agent',
          message: 'CẢNH BÁO RỦI RO TRƯỚC SẢN XUẤT (người dùng đã chấp nhận và tiếp tục): ' + summary,
        },
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
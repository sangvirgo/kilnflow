import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { BatchesService } from './batches.service';
import { AppError } from '../common/errors';

@Controller()
export class BatchesController {
  constructor(private batches: BatchesService) {}

  @Get('batches')
  list() { return this.batches.list(); }

  @Patch('batches/:id/stage')
  advance(@Param('id') id: string, @Body() body: { note?: string }) {
    return this.batches.advanceStage(id, body?.note);
  }

  /** Phase 11 — ghi nhận số liệu thực tế khi sản xuất/hoàn thành */
  @Patch('batches/:id/actuals')
  updateActuals(@Param('id') id: string, @Body() body: { actualClayKg?: number; actualFiringHours?: number; actualGlazeType?: string; noteUsed?: string }) {
    if (body.actualClayKg != null && (typeof body.actualClayKg !== 'number' || body.actualClayKg < 0))
      throw new AppError(400, 'INVALID_INPUT', 'actualClayKg phải là số ≥ 0');
    if (body.actualFiringHours != null && (typeof body.actualFiringHours !== 'number' || body.actualFiringHours < 0))
      throw new AppError(400, 'INVALID_INPUT', 'actualFiringHours phải là số ≥ 0');
    return this.batches.updateActuals(id, body);
  }

  @Post('batches/:id/qc-report')
  qcReport(@Param('id') id: string, @Body() body: { defectCount?: number; note?: string }) {
    const defectCount = Number(body?.defectCount);
    if (!Number.isInteger(defectCount) || defectCount < 0) throw new AppError(400, 'INVALID_INPUT', 'defectCount phai la so nguyen >= 0.');
    return this.batches.qcReport(id, { defectCount, note: body?.note });
  }

  @Get('alerts')
  alerts(@Query('limit') limit?: string) {
    const n = Number(limit);
    return this.batches.alerts(Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 50);
  }
}
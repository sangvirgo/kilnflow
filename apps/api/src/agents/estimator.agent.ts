import { Injectable } from '@nestjs/common';
import { EstimatorOutputSchema, EstimatorOutput, EstimateBasis, ParsedOrder, StageDurationMap, STAGE_DURATION_KEYS } from '@kilnflow/shared-types';
import { EmbeddingService } from '../embeddings/embeddings.service';
import { PrismaService } from '../prisma/prisma.service';
import { TraceEmitter } from './trace';

/**
 * Estimator Agent — RAG tren HistoricalBatch:
 * embed mo ta moi -> top-k cosine similarity -> trung binh co trong so.
 * Ket qua la TOAN HOC deterministik (khong giao so hoc cho LLM), LLM chi dung o Parser/Risk.
 * Cold-start -> cong thuc, confidence 'low'. Minh bac su dung duoc tra ve cho user (basis[]).
 */
@Injectable()
export class EstimatorAgent {
  constructor(private prisma: PrismaService, private embeddings: EmbeddingService) {}

  async estimate(parsed: ParsedOrder, emit: TraceEmitter): Promise<EstimatorOutput> {
    emit('📦', 'Estimator Agent khởi động — chế độ RAG trên kho mẻ lịch sử...', 'info', 'estimator');
    const desc = [parsed.product_name, parsed.pattern, parsed.height_cm, parsed.glaze_color ?? parsed.glaze_type]
      .filter((x) => x != null && x !== '').join(' ');
    const qvec = await this.embeddings.embedOne(desc);
    emit('🧮', 'Đã tạo vector embedding (' + qvec.length + ' chiều) cho: "' + desc.slice(0, 60) + '"', 'info', 'estimator');

    const rows = await this.prisma.historicalBatch.findMany({ where: { embeddingModel: this.embeddings.modelTag } });
    emit('🔎', 'So cosine similarity với ' + rows.length + ' mẻ lịch sử trong kho...', 'info', 'estimator');
    const K = 3;
    const MIN_SIM = 0.12;
    const scored = rows
      .map((r) => ({ row: r, sim: this.embeddings.similarity(qvec, this.embeddings.fromBuffer(r.embedding)) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, K)
      .filter((x) => x.sim >= MIN_SIM);

    if (scored.length > 0) {
      let clayW = 0, hoursW = 0, wSum = 0;
      const basis: EstimateBasis[] = [];
      // Phase 9 — weighted average (sim²) CHO TỪNG CÔNG ĐOẠN, cùng công thức trọng số với clay/hours
      const stageW: Record<string, { sum: number; w: number }> = {};
      for (const k of STAGE_DURATION_KEYS) stageW[k] = { sum: 0, w: 0 };
      for (const s of scored) {
        const w = Math.max(1e-6, s.sim * s.sim);
        clayW += s.row.actualClayKg * w;
        hoursW += s.row.actualFiringHours * w;
        wSum += w;
        const sd = (s.row.stageDurationsHours ?? null) as Record<string, number> | null;
        if (sd && typeof sd === 'object') {
          for (const k of STAGE_DURATION_KEYS) {
            const v = Number((sd as any)[k]);
            if (Number.isFinite(v) && v > 0) { stageW[k].sum += v * w; stageW[k].w += w; }
          }
        }
        basis.push({
          historicalBatchId: s.row.id,
          productName: s.row.productName,
          pattern: s.row.pattern,
          heightCm: s.row.heightCm,
          glazeType: s.row.glazeType,
          actualClayKg: s.row.actualClayKg,
          actualFiringHours: s.row.actualFiringHours,
          similarity: Math.round(s.sim * 1000) / 1000,
        });
      }
      const r1 = (x: number) => Math.round(x * 10) / 10;
      const stageEstimates = Object.fromEntries(
        STAGE_DURATION_KEYS.map((k) => [k, stageW[k].w > 0 ? r1(stageW[k].sum / stageW[k].w) : r1(this.coldStartStages(parsed)[k])]),
      ) as StageDurationMap;
      // Đảm bảo FIRING nhất quán với estimatedFiringHours (đã tính từ actualFiringHours true)
      stageEstimates.FIRING = r1(hoursW / wSum);

      const out: EstimatorOutput = {
        estimatedClayKg: r1(clayW / wSum),
        estimatedFiringHours: r1(hoursW / wSum),
        confidence: 'high',
        method: 'historical',
        basis,
        stageEstimates,
        stageEstimateConfidence: 'high',
        stageEstimateBasis: basis,
      };
      const validated = EstimatorOutputSchema.safeParse(out);
      if (!validated.success) throw new Error('Estimator output failed its own schema: ' + validated.error.message);
      emit('📊', 'Trung bình có trọng số (sim²): đất ≈ ' + out.estimatedClayKg + 'kg · nung ≈ ' + out.estimatedFiringHours + 'h', 'info', 'estimator');
      emit('⏱', 'Ước lượng 6 công đoạn từ ' + scored.length + ' mẻ: ' + STAGE_DURATION_KEYS.map((k) => k.slice(0, 4) + ' ' + stageEstimates[k] + 'h').join(' · '), 'info', 'estimator');
      emit('✓', 'Tìm thấy ' + scored.length + ' mẻ tương tự (độ giống ' + basis[0].similarity + '..' + basis[basis.length - 1].similarity + ') — ước lượng dựa trên dữ liệu thật.', 'success', 'estimator');
      return validated.data;
    }

    // Cold start fallback (spec 5.2.4) — công thức cho clay/hours VÀ từng công đoạn
    const h = parsed.height_cm ?? 25;
    const clay = Math.round(((h / 10) * 0.6 * parsed.quantity) * 10) / 10;
    let hours = parsed.quantity < 100 ? 8 : parsed.quantity < 300 ? 12 : parsed.quantity < 1000 ? 18 : 26;
    if (parsed.firing_temp_c >= 1280) hours += 4;
    emit('⚠️', 'Không có mẻ lịch sử tương tự (cold start) — quay lại công thức cho clay, hours và 6 công đoạn, độ tin cậy thấp.', 'warn', 'estimator');
    const out2: EstimatorOutput = {
      estimatedClayKg: clay, estimatedFiringHours: hours,
      confidence: 'low', method: 'formula', basis: [],
      stageEstimates: { ...this.coldStartStages(parsed), FIRING: hours },
      stageEstimateConfidence: 'low',
      stageEstimateBasis: [],
    };
    return EstimatorOutputSchema.parse(out2);
  }

  /** Công thức fallback theo stage khi cold-start — quy mô theo số lượng (mỗi 50 sản phẩm). */
  private coldStartStages(parsed: ParsedOrder): StageDurationMap {
    const u = Math.max(1, parsed.quantity) / 50; // "đơn vị lô" 50 sp
    const hoursFiring = (() => {
      let hh = parsed.quantity < 100 ? 8 : parsed.quantity < 300 ? 12 : parsed.quantity < 1000 ? 18 : 26;
      if (parsed.firing_temp_c >= 1280) hh += 4;
      return hh;
    })();
    const r1 = (x: number) => Math.round(x * 10) / 10;
    return {
      MOLDING: r1(Math.max(2, u * 6)),
      DRYING_TRIMMING: r1(Math.max(6, u * 12)),
      PAINTING: r1(Math.max(2, u * 8)),
      GLAZING: r1(Math.max(1, u * 5)),
      FIRING: hoursFiring,
      QC_PACKING: r1(Math.max(1, u * 3)),
    };
  }
}
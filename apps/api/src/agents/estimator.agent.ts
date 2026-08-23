import { Injectable } from '@nestjs/common';
import { EstimatorOutputSchema, EstimatorOutput, EstimateBasis, ParsedOrder } from '@kilnflow/shared-types';
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
    emit('📦', 'Đang dùng embedding tìm các mẻ lịch sử tương tự...', 'info', 'estimator');
    const desc = [parsed.product_name, parsed.pattern, parsed.height_cm, parsed.glaze_color ?? parsed.glaze_type]
      .filter((x) => x != null && x !== '').join(' ');
    const qvec = await this.embeddings.embedOne(desc);

    const rows = await this.prisma.historicalBatch.findMany({ where: { embeddingModel: this.embeddings.modelTag } });
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
      for (const s of scored) {
        const w = Math.max(1e-6, s.sim * s.sim);
        clayW += s.row.actualClayKg * w;
        hoursW += s.row.actualFiringHours * w;
        wSum += w;
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
      const out: EstimatorOutput = {
        estimatedClayKg: Math.round((clayW / wSum) * 10) / 10,
        estimatedFiringHours: Math.round((hoursW / wSum) * 10) / 10,
        confidence: 'high',
        method: 'historical',
        basis,
      };
      const validated = EstimatorOutputSchema.safeParse(out);
      if (!validated.success) throw new Error('Estimator output failed its own schema: ' + validated.error.message);
      emit('✓', 'Tìm thấy ' + scored.length + ' mẻ tương tự (độ giống ' + basis[0].similarity + '..' + basis[basis.length - 1].similarity + ') — điều chỉnh ước lượng theo dữ liệu thật.', 'success', 'estimator');
      return validated.data;
    }

    // Cold start fallback (spec 5.2.4)
    const h = parsed.height_cm ?? 25;
    const clay = Math.round(((h / 10) * 0.6 * parsed.quantity) * 10) / 10;
    let hours = parsed.quantity < 100 ? 8 : parsed.quantity < 300 ? 12 : parsed.quantity < 1000 ? 18 : 26;
    if (parsed.firing_temp_c >= 1280) hours += 4;
    emit('⚠️', 'Không có mẻ lịch sử tương tự (cold start) — quay lại công thức, độ tin cậy thấp.', 'warn', 'estimator');
    return { estimatedClayKg: clay, estimatedFiringHours: hours, confidence: 'low', method: 'formula', basis: [] };
  }
}
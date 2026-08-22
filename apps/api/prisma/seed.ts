/**
 * Seed data (spec section 9):
 *  - 12 HistoricalBatch co embedding THAT (goi API embedding neu co key;
 *    khong co key -> hashed-bow deterministic cung vector-space voi query).
 *  - 3 Kiln.
 *  - 4 Order/Batch mau o cac stage khac nhau de Kanban khong trong,
 *    co 1 batch FIRING da tre de Monitor co viec phat hien ngay khi demo.
 */
import { PrismaClient } from '@prisma/client';
import { GeminiEmbeddingProvider, LocalHashEmbeddingProvider } from '../src/embeddings/embeddings.core';
import { vecToBuffer } from '../src/embeddings/embeddings.core';

const prisma = new PrismaClient();

function pickEmbeddingProvider() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  if (key && process.env.EMBEDDING_PROVIDER !== 'local') return new GeminiEmbeddingProvider(key);
  return new LocalHashEmbeddingProvider();
}

async function main() {
  const provider = pickEmbeddingProvider();
  console.log('[seed] embedding provider:', provider.modelTag);

  await prisma.alert.deleteMany();
  await prisma.stageLog.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.order.deleteMany();
  await prisma.kiln.deleteMany();
  await prisma.historicalBatch.deleteMany();
  await prisma.knowledgeChunk.deleteMany();
  await prisma.knowledgeDoc.deleteMany();

  // ---------- Kilns ----------
  const kilns = await Promise.all([
    prisma.kiln.create({ data: { name: 'Lo so 1 (lon)', capacity: 4 } }),
    prisma.kiln.create({ data: { name: 'Lo so 2 (vua)', capacity: 2 } }),
    prisma.kiln.create({ data: { name: 'Lo thi nghiem', capacity: 1 } }),
  ]);
  console.log('[seed] kilns:', kilns.map((k) => k.name).join(', '));

  // ---------- Historical batches (du lieu thuc te san xuat gom VN) ----------
  const historical = [
    { productName: 'lo hoa sen', pattern: 'hoa sen', heightCm: 30, glazeType: 'men xanh ngoc', actualClayKg: 55, actualFiringHours: 12 },
    { productName: 'lo hoa sen', pattern: 'hoa sen', heightCm: 35, glazeType: 'men xanh ngoc', actualClayKg: 74, actualFiringHours: 14 },
    { productName: 'binh hoa', pattern: 'trong dong', heightCm: 40, glazeType: 'men nau', actualClayKg: 96, actualFiringHours: 16 },
    { productName: 'bo am tra', pattern: 'van cach', heightCm: 15, glazeType: 'men trang nga', actualClayKg: 42, actualFiringHours: 10 },
    { productName: 'chen su', pattern: null, heightCm: 8, glazeType: 'men trang nga', actualClayKg: 38, actualFiringHours: 9 },
    { productName: 'dia', pattern: 've tay', heightCm: 25, glazeType: 'men celadon', actualClayKg: 60, actualFiringHours: 11 },
    { productName: 'bat', pattern: null, heightCm: 6, glazeType: 'men xanh lam', actualClayKg: 22, actualFiringHours: 8 },
    { productName: 'tuong gom', pattern: 'rong', heightCm: 45, glazeType: 'men nau den', actualClayKg: 88, actualFiringHours: 18 },
    { productName: 'lo hoa', pattern: 'la tre', heightCm: 28, glazeType: 'men celadon', actualClayKg: 47, actualFiringHours: 12 },
    { productName: 'tach su', pattern: 'hoa sen', heightCm: 7, glazeType: 'men xanh lam', actualClayKg: 18, actualFiringHours: 8 },
    { productName: 'binh gom', pattern: null, heightCm: 50, glazeType: 'men trang nga', actualClayKg: 120, actualFiringHours: 20 },
    { productName: 'gach op lat', pattern: 'van cach', heightCm: 2, glazeType: 'men nau vang', actualClayKg: 150, actualFiringHours: 24 },
  ];
  const texts = historical.map((h) => [h.productName, h.pattern, h.heightCm, h.glazeType].filter((x) => x != null).join(' '));
  const vectors = await provider.embed(texts);
  for (let i = 0; i < historical.length; i++) {
    await prisma.historicalBatch.create({
      data: { ...historical[i], embedding: vecToBuffer(vectors[i]), embeddingModel: provider.modelTag },
    });
  }
  console.log('[seed] historical batches:', historical.length, '(embeddings computed for real)');

  // ---------- Example orders/batches cho Kanban ----------
  const now = Date.now();
  const hoursAgo = (h: number) => new Date(now - h * 3600_000);

  interface DemoBatch { raw: string; parsed: Record<string, unknown>; product: string; stage: string; priority: string; qty: number; glaze: string | null; temp: number | null; clay: number; hours: number; deadline: number | null; code: string; changedHoursAgo: number; }
  const demoBatches: DemoBatch[] = [
    { raw: 'Dat 200 lo hoa hoa van sen men xanh ngoc cao 35cm nung 1280 do C deadline 10 ngay', parsed: { product_name: 'lo hoa', quantity: 200 }, product: 'Lo hoa sen', stage: 'FIRING', priority: 'high', qty: 200, glaze: 'men xanh ngoc', temp: 1280, clay: 420, hours: 14, deadline: 10, code: 'GOM-001', changedHoursAgo: 26 },
    { raw: '150 bo am tra men trang nga deadline 20 ngay', parsed: { product_name: 'bo am tra', quantity: 150 }, product: 'Bo am tra', stage: 'GLAZING', priority: 'medium', qty: 150, glaze: 'men trang nga', temp: 1280, clay: 42, hours: 10, deadline: 20, code: 'GOM-002', changedHoursAgo: 2 },
    { raw: '500 chen su trang ong can gap sau 5 ngay', parsed: { product_name: 'chen su', quantity: 500 }, product: 'Chen su', stage: 'PAINTING', priority: 'high', qty: 500, glaze: 'men trang nga', temp: 1300, clay: 95, hours: 22, deadline: 5, code: 'GOM-003', changedHoursAgo: 1 },
    { raw: '80 tuong gom rong men nau den giao trong 30 ngay', parsed: { product_name: 'tuong gom', quantity: 80 }, product: 'Tuong rong', stage: 'MOLDING', priority: 'low', qty: 80, glaze: 'men nau den', temp: 1240, clay: 70, hours: 18, deadline: 30, code: 'GOM-004', changedHoursAgo: 4 },
  ];
  const stagesUpTo = ['MOLDING', 'DRYING_TRIMMING', 'PAINTING', 'GLAZING', 'FIRING'];
  for (const d of demoBatches) {
    const order = await prisma.order.create({
      data: { rawText: d.raw, parsedJson: d.parsed as any, confidence: 0.9, assumptions: [] },
    });
    const idx = stagesUpTo.indexOf(d.stage);
    const batch = await prisma.batch.create({
      data: {
        batchCode: d.code,
        orderId: order.id,
        productName: d.product,
        currentStage: d.stage,
        priority: d.priority,
        glazeType: d.glaze,
        firingTempC: d.temp,
        estimatedClayKg: d.clay,
        estimatedFiringHours: d.hours,
        quantity: d.qty,
        deadlineDays: d.deadline,
        lastStageChangeAt: hoursAgo(d.changedHoursAgo),
      },
    });
    for (let s = 0; s <= idx; s++) {
      await prisma.stageLog.create({
        data: { batchId: batch.id, stage: stagesUpTo[s], enteredAt: hoursAgo(d.changedHoursAgo + (idx - s) * 6) },
      });
    }
  }
  console.log('[seed] example orders/batches:', demoBatches.length, '(GOM-001 FIRING 26h ago -> monitor se canh bao tre)');
  console.log('[seed] DONE');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
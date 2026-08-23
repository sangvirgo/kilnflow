import { Injectable } from '@nestjs/common';
import { KnowledgeAnswerSchema, KnowledgeAnswer } from '@kilnflow/shared-types';
import { LlmService } from '../llm/llm.service';
import { parseLlmJson } from '../llm/llm.utils';
import { EmbeddingService } from '../embeddings/embeddings.service';
import { PrismaService } from '../prisma/prisma.service';

interface ChunkHit {
  c: { doc: { title: string; sourceUrl: string | null }; content: string };
  sim: number;
}

const SYSTEM_PROMPT = [
  'You are the KNOWLEDGE_AGENT for a ceramics workshop.',
  'Answer using ONLY the provided document chunks, in Vietnamese with full diacritics.',
  'Cite sources inline with [Source N].',
  'If the chunks contain PARTIALLY related information (for example the question asks about a specific glaze but the chunks describe its glaze family, firing cones and temperature ranges), answer WITH that information and clearly note the assumption — do not refuse when useful related data exists.',
  'Only say: Tài liệu trong kho không đủ để trả lời câu hỏi này. — when NOTHING in the chunks helps.',
  'Output ONLY JSON with key answer (string).',
].join(' ');

@Injectable()
export class KnowledgeService {
  constructor(
    private prisma: PrismaService,
    private llm: LlmService,
    private embeddings: EmbeddingService,
) {}

  async ask(question: string): Promise<KnowledgeAnswer> {
    const qvec = await this.embeddings.embedOne(question);
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: { embeddingModel: this.embeddings.modelTag },
      include: { doc: true },
    });
    const scored = chunks.map((c) => ({ c, sim: this.embeddings.similarity(qvec, this.embeddings.fromBuffer(c.embedding)) }));
    scored.sort((a, b) => b.sim - a.sim);
    let top: ChunkHit[] = scored.slice(0, 6).filter((x) => x.sim >= 0.08);

    // Fallback khi khong co chunk nao cung vector-space (vi du doi provider giua lan seed va query):
    // tra cuu theo do trung tu khoa de chatbot van tra loi duoc thay vi chet tinh nang.
    if (!top.length) {
      top = await this.keywordFallback(question);
    }
    if (!top.length) {
      return { answer: 'Chưa có tài liệu trong kho tri thức. Hãy chạy script ingestion (npm run knowledge:ingest) trước.', sources: [] };
    }

    const contexts = top.map((x, i) => ({ index: i + 1, title: x.c.doc.title, content: x.c.content.slice(0, 1600) }));
    const payload = '<<<PAYLOAD\n' + JSON.stringify({ question, contexts }) + '\nPAYLOAD>>>';

    try {
      const raw = await this.llm.complete(
        [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: payload + '\nTra loi cau hoi ngay.' }],
        { jsonMode: true, temperature: 0.2, label: 'knowledge' },
);
      const cand = parseLlmJson<{ answer?: unknown }>(raw);
      const answerText = typeof cand.answer === 'string' ? cand.answer : JSON.stringify(cand);
      const sources = top.map((x) => ({
        title: x.c.doc.title,
        url: x.c.doc.sourceUrl ?? null,
        snippet: x.c.content.slice(0, 160),
      }));
      const out = { answer: answerText, sources };
      const validated = KnowledgeAnswerSchema.safeParse(out);
      return validated.success ? validated.data : out;
    } catch {
      const sources = top.map((x) => ({ title: x.c.doc.title, url: x.c.doc.sourceUrl ?? null, snippet: x.c.content.slice(0, 160) }));
      const fallback = 'LLM tạm thời không khả dụng. Các nguồn được truy xuất: ' + sources.map((s) => s.title).join(', ');
      return { answer: fallback, sources };
    }
  }

  /** Do trung tu khoa (bo dau, lowercase) giua cau hoi va cac chunk — chi dung khi vector-space lech. */
  private async keywordFallback(question: string): Promise<ChunkHit[]> {
    const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
    const qTokens = new Set(norm(question).split(/\s+/).filter((t) => t.length >= 2));
    if (!qTokens.size) return [];
    const all = await this.prisma.knowledgeChunk.findMany({ include: { doc: true } });
    return all
      .map((c) => {
        const tokens = norm(c.content);
        let hits = 0;
        for (const t of qTokens) if (tokens.includes(t)) hits++;
        return { c, sim: hits / qTokens.size };
      })
      .filter((x) => x.sim > 0)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 4);
  }
}
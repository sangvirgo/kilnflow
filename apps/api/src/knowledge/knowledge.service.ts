import { Injectable } from '@nestjs/common';
import { KnowledgeAnswerSchema, KnowledgeAnswer } from '@kilnflow/shared-types';
import { LlmService } from '../llm/llm.service';
import { parseLlmJson } from '../llm/llm.utils';
import { EmbeddingService } from '../embeddings/embeddings.service';
import { PrismaService } from '../prisma/prisma.service';

const SYSTEM_PROMPT = 'You are the KNOWLEDGE_AGENT for a ceramics workshop. ' +
  'Answer using ONLY the provided document chunks. ' +
  'Cite sources inline with [Source N]. ' +
  'If context is insufficient, say: Tai lieu trong kho khong du de tra loi. ' +
  'Output ONLY JSON with key answer (string).';

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
    const top = scored.slice(0, 4).filter((x) => x.sim >= 0.08);

    if (!top.length) {
      return { answer: 'Chua co tai lieu trong kho tri thuc. Hay chay ingestion script truoc.', sources: [] };
    }

    const contexts = top.map((x, i) => ({ index: i + 1, title: x.c.doc.title, content: x.c.content.slice(0, 700) }));
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
      const fallback = 'LLM khong kha dung. Nguon truy xuat: ' + sources.map((s) => s.title).join(', ');
      return { answer: fallback, sources };
    }
  }
}
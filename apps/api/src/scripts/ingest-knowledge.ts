import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { LocalHashEmbeddingProvider, vecToBuffer } from '../embeddings/embeddings.core';

const prisma = new PrismaClient();

function pickProvider() {
  const key = process.env.GEMINI_API_KEY || '';
  if (key && process.env.EMBEDDING_PROVIDER !== 'local') {
    const { GeminiEmbeddingProvider } = require('../embeddings/embeddings.core');
    return new GeminiEmbeddingProvider(key);
  }
  return new LocalHashEmbeddingProvider();
}

function chunkText(text: string, maxLen = 2000, overlap = 200): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxLen, text.length);
    if (end < text.length) { const lp = text.lastIndexOf('.', end); if (lp > start + maxLen * 0.5) end = lp + 1; }
    chunks.push(text.slice(start, end).trim());
    const next = end - overlap;
    start = next > start ? next : end;
  }
  return chunks.filter((c) => c.length > 50);
}

function parseSourceLine(content: string): { title: string; url: string | null; body: string } {
  const lines = content.split('\n');
  let title = lines.find((l) => l.startsWith('#'))?.replace(/^#+\s*/, '').trim() || 'Untitled', url: string | null = null, bodyEnd = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].replace(/-+$/, '').trim().match(/^Nguon:\s*(.+?)\s*-\s*(https?:\/\/\S+?)$/i);
    if (m) { title = m[1].trim(); url = m[2].trim(); bodyEnd = i; break; }
  }
  return { title, url, body: lines.slice(0, bodyEnd).join('\n').trim() };
}

async function main() {
  const provider = pickProvider();
  console.log('[ingest] embedding provider:', provider.modelTag);
  const kbDir = path.resolve(process.cwd(), '../../knowledge-base');
  if (!fs.existsSync(kbDir)) { console.log('[ingest] not found at', kbDir); return; }
  const files = fs.readdirSync(kbDir).filter((f) => f.endsWith('.md'));
  console.log('[ingest] found', files.length, 'markdown files');
  await prisma.knowledgeChunk.deleteMany();
  await prisma.knowledgeDoc.deleteMany();
  let total = 0;
  for (const file of files) {
    const content = fs.readFileSync(path.join(kbDir, file), 'utf-8');
    const { title, url, body } = parseSourceLine(content);
    const chunks = chunkText(body);
    if (!chunks.length) continue;
    const vectors = await provider.embed(chunks);
    const doc = await prisma.knowledgeDoc.create({ data: { title, sourceUrl: url } });
    for (let i = 0; i < chunks.length; i++) {
      await prisma.knowledgeChunk.create({ data: { docId: doc.id, content: chunks[i], chunkIndex: i, embedding: vecToBuffer(vectors[i]), embeddingModel: provider.modelTag } });
    }
    total += chunks.length;
    console.log('[ingest]', file, '->', chunks.length, 'chunks, title:', title);
  }
  console.log('[ingest] DONE:', files.length, 'docs,', total, 'chunks.');
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
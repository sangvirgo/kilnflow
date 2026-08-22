// Core embedding engine — khong decorator, tai duoc boi seed script va Nest DI.

export interface EmbeddingProvider {
  readonly name: string;
  readonly modelTag: string;
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Fallback offline: hashed bag-of-words (unigram+bigram), tf weighting, L2 chuan hoa.
 * Deterministic tuyet doi — dam bao seed va query cung mot vector-space ma khong can API.
 */
export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local';
  readonly modelTag = 'local-hash-bow-256';
  readonly dim = 256;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.vectorize(t));
  }

  private tokenize(text: string): string[] {
    const norm = text.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\s]/gu, ' ');
    const words = norm.split(/\s+/).filter((w) => w.length >= 2);
    const bigrams: string[] = [];
    for (let i = 0; i < words.length - 1; i++) bigrams.push(words[i] + '_' + words[i + 1]);
    return words.concat(bigrams);
  }

  private hashDjb2(s: string): number {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h;
  }

  private vectorize(text: string): number[] {
    const v = new Array(this.dim).fill(0);
    const tokens = this.tokenize(text);
    const tf = new Map<string, number>();
    for (const tk of tokens) tf.set(tk, (tf.get(tk) || 0) + 1);
    for (const [tk, f] of tf) {
      const idx = this.hashDjb2(tk) % this.dim;
      v[idx] += 1 / Math.log(1 + f);
    }
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    return v.map((x) => x / norm);
  }
}

/** Gemini text-embedding-004 qua REST batchEmbedContents. */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'gemini';
  readonly modelTag = 'gemini-text-embedding-004';
  readonly dim = 768;
  private endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents';

  constructor(private apiKey: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 32) {
      out.push(...(await this.batch(texts.slice(i, i + 32))));
    }
    return out;
  }

  private async batch(chunk: string[]): Promise<number[][]> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: JSON.stringify({
            requests: chunk.map((text) => ({
              model: 'models/text-embedding-004',
              content: { parts: [{ text }] },
            })),
          }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200));
        const data: any = await res.json();
        return data.embeddings.map((e: any) => e.values as number[]);
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    throw new Error('Gemini embedding failed after retries: ' + String((lastErr as Error)?.message || lastErr));
  }
}

// ---------- Vector helpers (Bytes <-> Float32, cosine) ----------
export function vecToBuffer(vec: number[]): Buffer {
  const f32 = new Float32Array(vec);
  return Buffer.from(f32.buffer);
}

export function bufferToVec(buf: Buffer | Uint8Array, dim: number): number[] {
  const f32 = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return Array.from(f32).slice(0, dim);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
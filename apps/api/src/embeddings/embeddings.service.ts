import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  bufferToVec, cosineSimilarity, EmbeddingProvider, GeminiEmbeddingProvider,
  LocalHashEmbeddingProvider, vecToBuffer,
} from './embeddings.core';

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private provider!: EmbeddingProvider;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const pref = this.config.get('embeddings.provider', 'auto');
    const geminiKey = this.config.get('llm.geminiApiKey', '');
    if ((pref === 'gemini' || (pref === 'auto' && !!geminiKey)) && geminiKey) {
      this.provider = new GeminiEmbeddingProvider(geminiKey);
    } else {
      this.provider = new LocalHashEmbeddingProvider();
    }
  }

  get modelTag(): string { return this.provider.modelTag; }
  get providerName(): string { return this.provider.name; }

  async embedOne(text: string): Promise<number[]> {
    const [vec] = await this.provider.embed([text]);
    return vec;
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    return this.provider.embed(texts);
  }

  toBuffer(vec: number[]): Uint8Array { return vecToBuffer(vec); }
  fromBuffer(buf: Buffer | Uint8Array): number[] { return bufferToVec(buf, this.provider.dim); }
  similarity(a: number[], b: number[]): number { return cosineSimilarity(a, b); }
}
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  bufferToVec, cosineSimilarity, EmbeddingProvider, GeminiEmbeddingProvider,
  LocalHashEmbeddingProvider, vecToBuffer,
} from './embeddings.core';

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private provider!: EmbeddingProvider;
  private fallbackProvider = new LocalHashEmbeddingProvider();
  private readonly logger = new Logger(EmbeddingService.name);
  private useFallback = false;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const pref = this.config.get('embeddings.provider', 'auto');
    const geminiKey = this.config.get('llm.geminiApiKey', '');
    if ((pref === 'gemini' || (pref === 'auto' && !!geminiKey)) && geminiKey) {
      this.provider = new GeminiEmbeddingProvider(geminiKey);
    } else {
      this.provider = this.fallbackProvider;
    }
  }

  private async tryEmbed(texts: string[]): Promise<number[][]> {
    if (this.useFallback) return this.fallbackProvider.embed(texts);
    try {
      return await this.provider.embed(texts);
    } catch (err: any) {
      this.logger.warn('Embedding API failed (' + (err?.message || err).slice(0, 80) + ') — switching to local-hash fallback.');
      this.useFallback = true;
      this.provider = this.fallbackProvider;
      return this.fallbackProvider.embed(texts);
    }
  }

  get modelTag(): string { return this.provider.modelTag; }
  get providerName(): string { return this.provider.name; }

  async embedOne(text: string): Promise<number[]> {
    const [vec] = await this.tryEmbed([text]);
    return vec;
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    return this.tryEmbed(texts);
  }

  toBuffer(vec: number[]): Uint8Array { return vecToBuffer(vec); }
  fromBuffer(buf: Buffer | Uint8Array): number[] { return bufferToVec(buf, this.provider.dim); }
  similarity(a: number[], b: number[]): number { return cosineSimilarity(a, b); }
}
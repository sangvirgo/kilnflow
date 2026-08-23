import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmCompleteOptions, LlmMessage, LlmProvider, LlmTransport } from './llm.core';
import { GeminiProvider } from './providers/gemini.provider';
import { MockLlmProvider } from './providers/mock.provider';

@Injectable()
export class LlmService implements OnModuleInit {
  private transport!: LlmTransport;
  private readonly logger = new Logger(LlmService.name);
  constructor(private config: ConfigService) {}
  onModuleInit() {
    this.transport = new LlmTransport(this.pick(), {
      timeoutMs: this.config.get('llm.timeoutMs', 45000),
      maxRetries: this.config.get('llm.maxRetries', 3),
    });
    this.logger.log('LLM provider: ' + this.transport.providerName);
  }
  get providerName(): string { return this.transport.providerName; }
  private pick(): LlmProvider {
    const pref = this.config.get('llm.provider', 'auto');
    const key = this.config.get('llm.geminiApiKey', '');
    if (pref === 'mock') return new MockLlmProvider();
    if (key) return new GeminiProvider(key, this.config.get('llm.model', '') || undefined);
    this.logger.warn('No GEMINI_API_KEY — using MockProvider.');
    return new MockLlmProvider();
  }
  complete(messages: LlmMessage[], opts?: LlmCompleteOptions): Promise<string> {
    return this.transport.complete(messages, opts);
  }
}
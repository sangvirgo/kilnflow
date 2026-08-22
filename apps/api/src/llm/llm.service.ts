import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmCompleteOptions, LlmMessage, LlmProvider, LlmTransport } from './llm.core';
import { GeminiProvider } from './providers/gemini.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { MockLlmProvider } from './providers/mock.provider';

/**
 * Abstraction DUY NHAT ma moi agent dung de goi LLM (spec section 12).
 * auto = gemini -> deepseek -> mock (theo key co san trong env).
 */
@Injectable()
export class LlmService implements OnModuleInit {
  private transport!: LlmTransport;
  private readonly logger = new Logger(LlmService.name);

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.transport = new LlmTransport(this.pickProvider(), {
      timeoutMs: this.config.get('llm.timeoutMs', 45000),
      maxRetries: this.config.get('llm.maxRetries', 3),
    });
    this.logger.log('LLM provider in use: ' + this.transport.providerName);
  }

  get providerName(): string { return this.transport.providerName; }

  private pickProvider(): LlmProvider {
    const pref = this.config.get('llm.provider', 'auto');
    const geminiKey = this.config.get('llm.geminiApiKey', '');
    const deepseekKey = this.config.get('llm.deepseekApiKey', '');
    if (pref === 'gemini' && geminiKey) return new GeminiProvider(geminiKey, this.modelOrDefault('gemini-2.0-flash'));
    if (pref === 'deepseek' && deepseekKey) return new DeepSeekProvider(deepseekKey, this.modelOrDefault('deepseek-chat'));
    if (pref === 'mock') return new MockLlmProvider();
    // auto
    if (geminiKey) return new GeminiProvider(geminiKey, this.modelOrDefault('gemini-2.0-flash'));
    if (deepseekKey) return new DeepSeekProvider(deepseekKey, this.modelOrDefault('deepseek-chat'));
    return new MockLlmProvider();
  }

  private modelOrDefault(dflt: string): string {
    return this.config.get('llm.model', '') || dflt;
  }

  complete(messages: LlmMessage[], opts?: LlmCompleteOptions): Promise<string> {
    return this.transport.complete(messages, opts);
  }
}
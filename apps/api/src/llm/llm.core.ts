// Core LLM abstraction — KHONG co Nest decorator de script tsx tai lai duoc.
import { LlmHttpError, LlmNoOutputError, LlmRateLimitError, LlmTimeoutError } from '../common/errors';

export interface LlmMessage { role: 'system' | 'user' | 'assistant'; content: string; }

export interface LlmCompleteOptions {
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  jsonMode?: boolean;
  label?: string;
  /** Truyen xuong provider de fetch bi huy that su khi het han (spec: khong de request treo vo han). */
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  raw(messages: LlmMessage[], opts: LlmCompleteOptions): Promise<string>;
}

/** Wrapper van chuyen dung chung: timeout tung-lan-goi + retry backoff cho 429/5xx/network. */
export class LlmTransport {
  constructor(
    private readonly provider: LlmProvider,
    private readonly defaults: { timeoutMs: number; maxRetries: number },
) {}

  get providerName() { return this.provider.name + ':' + this.provider.model; }

  async complete(messages: LlmMessage[], opts: LlmCompleteOptions = {}): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? this.defaults.timeoutMs;
    const maxRetries = this.defaults.maxRetries;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        // Quan trong: truyen signal vao provider -> fetch bi huy that su khi het timeout
        const text = await this.provider.raw(messages, { ...opts, signal: ctrl.signal });
        clearTimeout(timer);
        if (!text || !text.trim()) throw new LlmNoOutputError({ provider: this.providerName, label: opts.label });
        return text;
      } catch (err: any) {
        clearTimeout(timer);
        lastErr = err;
        const status = err instanceof LlmHttpError && err.detail && typeof err.detail === 'object' ? (err.detail as any).status : null;
        const reallyRetryable = err instanceof LlmRateLimitError || err instanceof LlmTimeoutError || (status !== null && status >= 500) || (err instanceof LlmNoOutputError) || (err && (err.name === 'AbortError' || err.code === 'ECONNRESET'));
        if (!reallyRetryable || attempt === maxRetries) throw this.normalize(err);
        const delayMs = Math.min(8000, 1000 * Math.pow(2, attempt)) + Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw this.normalize(lastErr);
  }

  private normalize(err: unknown): Error {
    if (err instanceof LlmHttpError || err instanceof LlmRateLimitError || err instanceof LlmTimeoutError || err instanceof LlmNoOutputError) return err;
    if (err && (err as any).name === 'AbortError') return new LlmTimeoutError({ provider: this.providerName });
    return new LlmHttpError(0, String((err as any)?.message || err));
  }
}
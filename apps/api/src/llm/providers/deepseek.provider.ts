import { LlmHttpError, LlmRateLimitError } from '../../common/errors';
import { LlmCompleteOptions, LlmMessage, LlmProvider } from '../llm.core';

export class DeepSeekProvider implements LlmProvider {
  readonly name = 'deepseek';
  constructor(private apiKey: string, public readonly model = 'deepseek-chat') {}

  async raw(messages: LlmMessage[], opts: LlmCompleteOptions): Promise<string> {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.apiKey },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxOutputTokens ?? 2048,
        ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: opts.signal,
    });
    if (res.status === 429) throw new LlmRateLimitError({ provider: this.name, status: 429 });
    if (!res.ok) throw new LlmHttpError(res.status, { provider: this.name, body: await res.text().catch(() => '') });
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content ?? '';
  }
}
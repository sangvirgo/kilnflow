import { LlmHttpError, LlmRateLimitError } from '../../common/errors';
import { LlmCompleteOptions, LlmMessage, LlmProvider } from '../llm.core';

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  constructor(private apiKey: string, public readonly model = 'gemini-3.5-flash-lite') {}

  async raw(messages: LlmMessage[], opts: LlmCompleteOptions): Promise<string> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: opts.temperature ?? 0.2,
        maxOutputTokens: opts.maxOutputTokens ?? 2048,
        ...(opts.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + this.model + ':generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (res.status === 429) throw new LlmRateLimitError({ provider: this.name, status: 429 });
    if (!res.ok) throw new LlmHttpError(res.status, { provider: this.name, body: await res.text().catch(() => '') });
    const data: any = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts.map((p: any) => p?.text ?? '').join('');
  }
}
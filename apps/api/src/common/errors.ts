/** Loi co y-nghia nghiep vu — API filter bien thanh HTTP response ro rang. */
export class AppError extends Error {
  constructor(public statusCode: number, public errorCode: string, message: string, public detail?: unknown) {
    super(message);
    this.name = new.target.name;
  }
}
export class LlmTimeoutError extends AppError { constructor(detail?: unknown) { super(504, 'LLM_TIMEOUT', 'LLM provider did not respond in time.', detail); } }
export class LlmRateLimitError extends AppError { constructor(detail?: unknown) { super(429, 'LLM_RATE_LIMITED', 'LLM provider rate limit hit after retries.', detail); } }
export class LlmHttpError extends AppError { constructor(status: number, detail?: unknown) { super(502, 'LLM_HTTP_ERROR', 'LLM provider returned an HTTP error.', { status, detail }); } }
export class LlmNoOutputError extends AppError { constructor(detail?: unknown) { super(502, 'LLM_EMPTY_OUTPUT', 'LLM provider returned an empty response.', detail); } }
export class AgentValidationError extends AppError { constructor(agent: string, detail?: unknown) { super(422, 'AGENT_VALIDATION_FAILED', 'Agent [' + agent + '] output failed schema validation after all self-correction retries.', detail); } }
export class AgentFailedError extends AppError { constructor(agent: string, cause: string) { super(500, 'AGENT_FAILED', 'Agent [' + agent + '] failed: ' + cause); } }
export class StageTransitionError extends AppError { constructor(message: string, detail?: unknown) { super(409, 'INVALID_STAGE_TRANSITION', message, detail); } }
export class NotFoundError extends AppError { constructor(entity: string, id: string) { super(404, 'NOT_FOUND', entity + ' ' + id + ' not found'); } }
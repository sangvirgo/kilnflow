export default () => ({
  port: parseInt(process.env.PORT || '3001', 10),
  webOrigin: process.env.WEB_ORIGIN || 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL || 'mysql://root:password@localhost:3306/kilnflow',
  llm: {
    provider: process.env.LLM_PROVIDER || 'auto',
    model: process.env.LLM_MODEL || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '45000', 10),
    maxRetries: parseInt(process.env.LLM_MAX_RETRIES || '3', 10),
  },
  embeddings: { provider: process.env.EMBEDDING_PROVIDER || 'auto' },
  telegram: { botToken: process.env.TELEGRAM_BOT_TOKEN || '', chatId: process.env.TELEGRAM_CHAT_ID || '' },
  monitor: {
    enabled: (process.env.MONITOR_ENABLED || 'true') === 'true',
    intervalMs: parseInt(process.env.MONITOR_INTERVAL_MS || '300000', 10),
  },
});
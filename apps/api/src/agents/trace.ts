export type TraceAgent = 'parser' | 'estimator' | 'risk' | 'scheduler' | 'monitor' | 'system';
export type TraceEmitter = (
  icon: string,
  message: string,
  level?: 'info' | 'success' | 'warn' | 'error',
  agent?: TraceAgent,
) => void;
export function silentTrace(): TraceEmitter {
  return () => undefined;
}

export type TraceEmitter = (icon: string, message: string, level?: 'info' | 'success' | 'warn' | 'error') => void;
export function silentTrace(): TraceEmitter { return () => undefined; }
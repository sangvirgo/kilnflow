export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!res.ok) { const body = await res.json().catch(() => null); throw new Error(body?.message || 'HTTP ' + res.status); }
  return res.json();
}
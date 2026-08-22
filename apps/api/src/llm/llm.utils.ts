// Tien ich trich JSON khoi output LLM (chan viec markdown fence lam vo JSON.parse).
export function extractJsonBlock(raw: string): string {
  let t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const firstObj = t.indexOf('{');
  const firstArr = t.indexOf('[');
  let start = -1;
  if (firstObj >= 0 && (firstArr < 0 || firstObj < firstArr)) start = firstObj; else start = firstArr;
  if (start < 0) throw new SyntaxError('No JSON found in LLM output');
  const lastObj = t.lastIndexOf('}');
  const lastArr = t.lastIndexOf(']');
  const end = Math.max(lastObj, lastArr);
  if (end <= start) throw new SyntaxError('Unbalanced JSON in LLM output');
  return t.slice(start, end + 1);
}

export function parseLlmJson<T>(raw: string): T {
  return JSON.parse(extractJsonBlock(raw)) as T;
}
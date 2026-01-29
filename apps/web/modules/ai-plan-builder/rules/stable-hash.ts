import { createHash } from 'node:crypto';

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => JSON.stringify(k) + ':' + stableStringify(record[k])).join(',')}}`;
}

export function computeStableSha256(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

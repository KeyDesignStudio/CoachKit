import { createHash } from 'node:crypto';
import type { IntakeEvidence } from '@prisma/client';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => JSON.stringify(k) + ':' + stableStringify(record[k])).join(',')}}`;
}

export function computeEvidenceHash(evidence: Array<Pick<IntakeEvidence, 'questionKey' | 'answerJson'>>): string {
  const canonical = evidence
    .slice()
    .sort((a, b) => a.questionKey.localeCompare(b.questionKey))
    .map((e) => `${e.questionKey}:${stableStringify(e.answerJson)}`)
    .join('\n');

  return createHash('sha256').update(canonical).digest('hex');
}

import type { IntakeEvidence } from '@prisma/client';

export type ExtractedAiProfile = {
  profileJson: Record<string, unknown>;
  summaryText: string;
  flags: string[];
};

function normalizeToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function extractProfileDeterministic(
  evidence: Array<Pick<IntakeEvidence, 'questionKey' | 'answerJson'>>
): ExtractedAiProfile {
  const sorted = evidence.slice().sort((a, b) => a.questionKey.localeCompare(b.questionKey));

  const profileJson: Record<string, unknown> = {};
  const summaryLines: string[] = [];
  const flags = new Set<string>();

  for (const item of sorted) {
    profileJson[item.questionKey] = item.answerJson as unknown;

    const text = normalizeToText(item.answerJson).toLowerCase();
    if (text.includes('injur')) flags.add('injury');
    if (text.includes('pain')) flags.add('pain');
    if (text.includes('marathon')) flags.add('marathon');
    if (text.includes('ironman') || text.includes('triathlon')) flags.add('triathlon');

    summaryLines.push(`${item.questionKey}: ${normalizeToText(item.answerJson)}`);
  }

  return {
    profileJson,
    summaryText: summaryLines.join('\n'),
    flags: Array.from(flags).sort(),
  };
}

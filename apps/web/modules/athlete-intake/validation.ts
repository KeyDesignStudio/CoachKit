export type WeeklyMinutesInputs = {
  hoursPerDay?: number | null;
  daysPerWeek?: number | null;
};

export function computeWeeklyMinutesTarget(inputs: WeeklyMinutesInputs): number | null {
  const hours = typeof inputs.hoursPerDay === 'number' ? inputs.hoursPerDay : null;
  const days = typeof inputs.daysPerWeek === 'number' ? inputs.daysPerWeek : null;
  if (!hours || !days) return null;
  if (!Number.isFinite(hours) || !Number.isFinite(days)) return null;
  const minutes = Math.round(hours * days * 60);
  return minutes > 0 ? minutes : null;
}

export function normalizeAustralianMobile(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[\s()\-]/g, '');

  if (/^04\d{8}$/.test(cleaned)) {
    return `+61${cleaned.slice(1)}`;
  }
  if (/^614\d{8}$/.test(cleaned)) {
    return `+${cleaned}`;
  }
  if (/^\+614\d{8}$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

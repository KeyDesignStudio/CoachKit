const MILES_RANGE_REGEX = /(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(mile|miles|mi)\b/gi;
const MILES_VALUE_REGEX = /(\d+(?:\.\d+)?)\s*(mile|miles|mi)\b/gi;
const DISTANCE_REGEX = /(\d+(?:\.\d+)?)\s*(km|kms|kilometres?|kilometers?|mile|miles|mi|m)\b/gi;

function roundDistance(value: number, decimals = 1) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatKmValue(value: number) {
  const rounded = roundDistance(value, 1);
  if (Math.abs(rounded - Math.round(rounded)) < 0.05) return `${Math.round(rounded)}km`;
  return `${rounded.toFixed(1).replace(/\.0$/, '')}km`;
}

function milesToKm(value: number) {
  return value * 1.60934;
}

export function normalizeDistanceUnitsToKm(value: string) {
  return String(value ?? '')
    .replace(MILES_RANGE_REGEX, (_, start, end) => `${formatKmValue(milesToKm(Number(start)))}-${formatKmValue(milesToKm(Number(end)))}`)
    .replace(MILES_VALUE_REGEX, (_, raw) => formatKmValue(milesToKm(Number(raw))));
}

export function parseDistanceKm(value: string): number | null {
  const normalized = normalizeDistanceUnitsToKm(String(value ?? '')).replace(/,/g, '');
  const matches = [...normalized.matchAll(DISTANCE_REGEX)];
  if (!matches.length) return null;

  let best: number | null = null;
  for (const match of matches) {
    const rawValue = Number(match[1]);
    const unit = String(match[2]).toLowerCase();
    if (!Number.isFinite(rawValue)) continue;

    let km: number | null = null;
    if (unit === 'm') km = rawValue / 1000;
    else km = rawValue;
    if (!Number.isFinite(km)) continue;

    best = best == null ? km : Math.max(best, km);
  }

  return best == null ? null : roundDistance(best, 1);
}

export function normalizeDistanceTokenToKm(token: string) {
  const normalized = normalizeDistanceUnitsToKm(String(token ?? '').trim());
  return normalized.replace(/\s+/g, '');
}

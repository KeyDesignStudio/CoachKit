import { WorkoutLibraryIntensityCategory } from '@prisma/client';

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function titleCaseWord(word: string): string {
  const trimmed = word.trim();
  if (!trimmed) return '';

  const upper = trimmed.toUpperCase();

  // Preserve common short acronyms.
  if (/^[A-Z0-9]{2,4}$/.test(upper)) return upper;

  // Preserve zone tokens like Z1..Z5.
  if (/^Z[1-5]$/.test(upper)) return upper;

  return upper[0] + upper.slice(1).toLowerCase();
}

export function normalizeTag(raw: string): string | null {
  const collapsed = collapseWhitespace(String(raw ?? ''));
  if (!collapsed) return null;

  // Split on spaces, but keep hyphens as part of the word (e.g. "Sweet-Spot").
  const words = collapsed
    .split(' ')
    .map((w) => titleCaseWord(w))
    .filter(Boolean);

  const normalized = words.join(' ');
  return normalized || null;
}

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of tags ?? []) {
    const normalized = normalizeTag(raw);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

export const CANONICAL_EQUIPMENT = [
  'Bike',
  'Indoor Trainer',
  'Treadmill',
  'Track',
  'Pool',
  'Open Water',
  'Dumbbells',
  'Bands',
  'Kettlebell',
  'RowErg',
  'Other',
] as const;

export type CanonicalEquipment = (typeof CANONICAL_EQUIPMENT)[number];

function normalizeEquipmentToken(raw: string): CanonicalEquipment {
  const token = collapseWhitespace(String(raw ?? '')).toLowerCase();
  if (!token) return 'Other';

  if (token === 'bike' || token.includes('road') || token.includes('tt') || token.includes('tri bike')) return 'Bike';

  if (token.includes('trainer') || token.includes('smart trainer') || token.includes('indoor')) return 'Indoor Trainer';

  if (token.includes('treadmill') || token === 'tm') return 'Treadmill';

  if (token.includes('track')) return 'Track';

  if (token.includes('pool')) return 'Pool';

  if (token.includes('open water') || token.includes('openwater') || token === 'ows' || token === 'ow') return 'Open Water';

  if (token.includes('dumbbell') || token.includes('weights') || token.includes('weight')) return 'Dumbbells';

  if (token.includes('band') || token.includes('resistance')) return 'Bands';

  if (token.includes('kettlebell') || token.includes('kb')) return 'Kettlebell';

  if (token.includes('row') || token.includes('erg') || token.includes('concept2')) return 'RowErg';

  if (token === 'other') return 'Other';

  return 'Other';
}

export function normalizeEquipment(equipment: string[]): CanonicalEquipment[] {
  const seen = new Set<CanonicalEquipment>();
  const result: CanonicalEquipment[] = [];

  for (const raw of equipment ?? []) {
    const normalized = normalizeEquipmentToken(raw);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function deriveIntensityCategory(intensityTarget: string): WorkoutLibraryIntensityCategory {
  const text = collapseWhitespace(intensityTarget ?? '').toUpperCase();

  // Prefer exact zone tokens.
  for (const z of ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'] as const) {
    const re = new RegExp(`(^|\\W)${z}($|\\W)`);
    if (re.test(text)) return z;
  }

  if (/(^|\W)RPE($|\W)/.test(text)) return 'RPE';

  return 'OTHER';
}

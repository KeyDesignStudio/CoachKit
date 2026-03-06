import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/errors';
import { parsePlanDistance, parsePlanSeason } from '@/modules/plan-library/server/ingest';

describe('plan-library ingest normalization', () => {
  it('accepts common human distance labels', () => {
    expect(parsePlanDistance('Olympic')).toBe('OLYMPIC');
    expect(parsePlanDistance('70.3 / Half Ironman')).toBe('HALF_IRONMAN');
    expect(parsePlanDistance('5k')).toBe('FIVE_K');
    expect(parsePlanDistance('Duathlon Sprint')).toBe('DUATHLON_SPRINT');
  });

  it('accepts common season labels and blanks', () => {
    expect(parsePlanSeason('Base')).toBe('BASE');
    expect(parsePlanSeason('In Season')).toBe('IN_SEASON');
    expect(parsePlanSeason('')).toBeNull();
  });

  it('rejects unsupported labels with a client error', () => {
    expect(() => parsePlanDistance('Trail Ultra')).toThrow(ApiError);
    expect(() => parsePlanSeason('Base / Build')).toThrow(ApiError);
  });
});

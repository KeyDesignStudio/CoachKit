import { describe, expect, it } from 'vitest';

import { buildDeterministicSessionDetailV1, sessionDetailV1Schema } from '@/modules/ai-plan-builder/rules/session-detail';

describe('ai-plan-builder session detail variation', () => {
  it('produces valid detail with comprehensive structure', () => {
    const detail = buildDeterministicSessionDetailV1({
      discipline: 'bike',
      type: 'tempo',
      durationMinutes: 60,
      context: { weekIndex: 2, dayOfWeek: 4, sessionOrdinal: 1 },
    });
    const parsed = sessionDetailV1Schema.safeParse(detail);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.structure.length).toBeGreaterThanOrEqual(2);
    expect(parsed.data.explainability?.whyThis?.length ?? 0).toBeGreaterThan(20);
    expect(parsed.data.variants?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('varies recipe steps across context seed', () => {
    const first = buildDeterministicSessionDetailV1({
      discipline: 'run',
      type: 'endurance',
      durationMinutes: 45,
      context: { weekIndex: 0, dayOfWeek: 1, sessionOrdinal: 0 },
    });
    const second = buildDeterministicSessionDetailV1({
      discipline: 'run',
      type: 'endurance',
      durationMinutes: 45,
      context: { weekIndex: 1, dayOfWeek: 4, sessionOrdinal: 2 },
    });
    const firstMain = first.structure.find((s) => s.blockType === 'main' || s.blockType === 'strength')?.steps ?? '';
    const secondMain = second.structure.find((s) => s.blockType === 'main' || s.blockType === 'strength')?.steps ?? '';
    expect(firstMain.length).toBeGreaterThan(0);
    expect(secondMain.length).toBeGreaterThan(0);
    expect(firstMain).not.toEqual(secondMain);
  });
});


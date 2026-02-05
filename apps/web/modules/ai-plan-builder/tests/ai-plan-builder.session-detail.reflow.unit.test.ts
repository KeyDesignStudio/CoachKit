import { describe, expect, it } from 'vitest';

import {
  normalizeSessionDetailV1DurationsToTotal,
  reflowSessionDetailV1ToNewTotal,
  sessionDetailV1Schema,
} from '@/modules/ai-plan-builder/rules/session-detail';

describe('AI Plan Builder v1 (Session detail: rounding + reflow)', () => {
  it('normalizes odd block minutes to 5-min increments and preserves total', () => {
    const detail = sessionDetailV1Schema.parse({
      objective: 'Technique swim session',
      structure: [
        { blockType: 'warmup', durationMinutes: 9, intensity: { rpe: 2, zone: 'Z1', notes: 'Easy' }, steps: 'Warm up.' },
        { blockType: 'main', durationMinutes: 45, intensity: { rpe: 4, zone: 'Z2', notes: 'Steady' }, steps: 'Main set.' },
        { blockType: 'cooldown', durationMinutes: 6, intensity: { rpe: 2, zone: 'Z1', notes: 'Easy' }, steps: 'Cool down.' },
      ],
      targets: { primaryMetric: 'RPE', notes: 'Stay controlled.' },
    });

    const normalized = normalizeSessionDetailV1DurationsToTotal({ detail, totalMinutes: 60 });
    const parsed = sessionDetailV1Schema.safeParse(normalized);
    expect(parsed.success).toBe(true);

    const mins = normalized.structure.map((b) => b.durationMinutes ?? 0);
    for (const m of mins) {
      if (m > 0) expect(m % 5).toBe(0);
    }
    expect(mins.reduce((a, b) => a + b, 0)).toBe(60);

    const warmup = normalized.structure.find((b) => b.blockType === 'warmup')?.durationMinutes ?? 0;
    const main = normalized.structure.find((b) => b.blockType === 'main')?.durationMinutes ?? 0;
    const cooldown = normalized.structure.find((b) => b.blockType === 'cooldown')?.durationMinutes ?? 0;

    expect(warmup).toBeGreaterThanOrEqual(5);
    expect(warmup).toBeLessThanOrEqual(20);
    expect(cooldown).toBeGreaterThanOrEqual(5);
    expect(cooldown).toBeLessThanOrEqual(15);
    expect(main).toBeGreaterThanOrEqual(10);
  });

  it('reflows detail when total duration changes (50 → 40) and keeps sums consistent', () => {
    const detail = sessionDetailV1Schema.parse({
      objective: 'Endurance run session',
      structure: [
        { blockType: 'warmup', durationMinutes: 10, intensity: { rpe: 2, zone: 'Z1', notes: 'Easy' }, steps: 'Easy jog.' },
        { blockType: 'main', durationMinutes: 35, intensity: { rpe: 4, zone: 'Z2', notes: 'Steady' }, steps: 'Steady aerobic.' },
        { blockType: 'cooldown', durationMinutes: 5, intensity: { rpe: 2, zone: 'Z1', notes: 'Easy' }, steps: 'Easy jog + stretch.' },
      ],
      targets: { primaryMetric: 'RPE', notes: 'Stay controlled.' },
    });

    const reflowed = reflowSessionDetailV1ToNewTotal({ detail, newTotalMinutes: 40 });
    const parsed = sessionDetailV1Schema.safeParse(reflowed);
    expect(parsed.success).toBe(true);

    const mins = reflowed.structure.map((b) => b.durationMinutes ?? 0);
    for (const m of mins) {
      if (m > 0) expect(m % 5).toBe(0);
    }
    expect(mins.reduce((a, b) => a + b, 0)).toBe(40);

    expect(reflowed.objective).toBe('Endurance run session');
  });
});

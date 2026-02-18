import { describe, expect, it } from 'vitest';

import { buildDeterministicSessionDetailV1, sessionDetailV1Schema } from './session-detail';

describe('sessionDetailV1Schema', () => {
  it('accepts deterministic minimal content', () => {
    const detail = buildDeterministicSessionDetailV1({ discipline: 'run', type: 'endurance', durationMinutes: 45 });
    const parsed = sessionDetailV1Schema.safeParse(detail);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.objective.length).toBeGreaterThan(0);
    expect(Array.isArray(parsed.data.structure)).toBe(true);
    expect(parsed.data.structure.length).toBeGreaterThan(0);
  });

  it('rejects empty objective', () => {
    const parsed = sessionDetailV1Schema.safeParse({
      objective: '',
      structure: [{ blockType: 'main', steps: 'Do stuff' }],
      targets: { primaryMetric: 'RPE', notes: 'ok' },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects structure without main/strength block', () => {
    const parsed = sessionDetailV1Schema.safeParse({
      objective: 'Easy day',
      structure: [
        { blockType: 'warmup', durationMinutes: 10, intensity: { rpe: 2, zone: 'Z1', notes: 'Easy' }, steps: 'Warm up.' },
        { blockType: 'cooldown', durationMinutes: 5, intensity: { rpe: 2, zone: 'Z1', notes: 'Easy' }, steps: 'Cool down.' },
      ],
      targets: { primaryMetric: 'RPE', notes: 'Keep easy.' },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects warmup after main block', () => {
    const parsed = sessionDetailV1Schema.safeParse({
      objective: 'Tempo run',
      structure: [
        { blockType: 'main', durationMinutes: 30, intensity: { rpe: 6, zone: 'Z3', notes: 'Tempo' }, steps: 'Main set.' },
        { blockType: 'warmup', durationMinutes: 10, intensity: { rpe: 2, zone: 'Z1', notes: 'Easy' }, steps: 'Warm up.' },
      ],
      targets: { primaryMetric: 'RPE', notes: 'Controlled tempo.' },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects ZONE metric when no zone target exists', () => {
    const parsed = sessionDetailV1Schema.safeParse({
      objective: 'Bike endurance',
      structure: [{ blockType: 'main', durationMinutes: 45, intensity: { rpe: 4, notes: 'Steady' }, steps: 'Main set.' }],
      targets: { primaryMetric: 'ZONE', notes: 'Hold zone.' },
    });
    expect(parsed.success).toBe(false);
  });
});

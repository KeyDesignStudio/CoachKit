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
});

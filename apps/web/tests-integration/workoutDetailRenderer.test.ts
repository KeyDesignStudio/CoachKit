import { describe, expect, it } from 'vitest';

import { sessionDetailV1Schema } from '@/modules/ai-plan-builder/rules/session-detail';
import {
  assertNormalizedSessionDetailMatchesTotal,
  renderWorkoutDetailFromSessionDetailV1,
} from '@/lib/workoutDetailRenderer';

describe('workoutDetailRenderer (canonical SessionDetailV1 -> text)', () => {
  it('renders objective + WARMUP/MAIN/COOLDOWN lines in the required format', () => {
    const detail = sessionDetailV1Schema.parse({
      objective: 'Aerobic endurance',
      structure: [
        { blockType: 'warmup', durationMinutes: 10, steps: 'Easy warmup.' },
        { blockType: 'main', durationMinutes: 45, steps: 'Steady aerobic.' },
        { blockType: 'cooldown', durationMinutes: 5, steps: 'Easy jog + stretch.' },
      ],
      targets: { primaryMetric: 'RPE', notes: 'Keep it controlled.' },
      cues: ['Relax shoulders', 'Quick cadence'],
    });

    assertNormalizedSessionDetailMatchesTotal({ detail, totalMinutes: 60, incrementMinutes: 5 });

    const text = renderWorkoutDetailFromSessionDetailV1(detail);
    expect(text.split('\n')[0]).toBe('Aerobic endurance');
    expect(text.split('\n')[0]).not.toMatch(/\(\s*\d+\s*min\s*\)/i);
    expect(text).toContain('\n\nWARMUP: 10 min – Easy warmup.');
    expect(text).toContain('\nMAIN: 45 min – Steady aerobic.');
    expect(text).toContain('\nCOOLDOWN: 5 min – Easy jog + stretch.');
    expect(text).not.toContain('TARGETS:');
    expect(text).not.toContain('CUES:');
    expect(text).not.toContain('SAFETY:');
  });

  it('fails if block minutes do not sum to the planned total', () => {
    const detail = sessionDetailV1Schema.parse({
      objective: 'Run (50 min).',
      structure: [
        { blockType: 'warmup', durationMinutes: 10, steps: 'Easy.' },
        { blockType: 'main', durationMinutes: 35, steps: 'Steady.' },
        { blockType: 'cooldown', durationMinutes: 5, steps: 'Easy.' },
      ],
      targets: { primaryMetric: 'RPE', notes: 'Controlled.' },
    });

    expect(() => assertNormalizedSessionDetailMatchesTotal({ detail, totalMinutes: 55, incrementMinutes: 5 })).toThrow(
      /sum to 55 minutes/i
    );
  });
});

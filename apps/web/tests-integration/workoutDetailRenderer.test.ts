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
        { blockType: 'warmup', durationMinutes: 10, steps: 'Easy warmup.', intensity: { rpe: 3 } },
        { blockType: 'main', durationMinutes: 45, steps: 'Steady aerobic.', intensity: { rpe: 5 } },
        { blockType: 'cooldown', durationMinutes: 5, steps: 'Easy jog + stretch.', intensity: { rpe: 2 } },
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
        { blockType: 'warmup', durationMinutes: 10, steps: 'Easy.', intensity: { rpe: 3 } },
        { blockType: 'main', durationMinutes: 35, steps: 'Steady.', intensity: { rpe: 5 } },
        { blockType: 'cooldown', durationMinutes: 5, steps: 'Easy.', intensity: { rpe: 2 } },
      ],
      targets: { primaryMetric: 'RPE', notes: 'Controlled.' },
    });

    expect(() => assertNormalizedSessionDetailMatchesTotal({ detail, totalMinutes: 55, incrementMinutes: 5 })).toThrow(
      /sum to 55 minutes/i
    );
  });

  it('uses recipeV2 blocks as canonical source when present', () => {
    const detail = sessionDetailV1Schema.parse({
      objective: 'Technique swim session',
      purpose: 'Primary purpose: improve movement economy and technical quality.',
      structure: [
        { blockType: 'warmup', durationMinutes: 5, steps: 'LEGACY warmup text should not render.', intensity: { rpe: 3 } },
        { blockType: 'main', durationMinutes: 20, steps: 'LEGACY main text should not render.', intensity: { rpe: 4 } },
        { blockType: 'cooldown', durationMinutes: 5, steps: 'LEGACY cooldown text should not render.', intensity: { rpe: 2 } },
      ],
      targets: { primaryMetric: 'RPE', notes: 'Keep controlled.' },
      recipeV2: {
        version: 'v2',
        primaryGoal: 'technique-quality',
        executionSummary: 'Primary purpose: improve movement economy and technical quality.',
        blocks: [
          { key: 'warmup', durationMinutes: 5, notes: ['200m easy + 4 x 50m drill/swim by 25m'] },
          {
            key: 'drill',
            durationMinutes: 8,
            intervals: [{ reps: 4, on: '100m pull buoy', off: '30s easy', intent: 'Build posture and catch quality under light aerobic load.' }],
            notes: ['Dedicated drill set: catch-up, fingertip drag, and 6-1-6 balance drill', 'Keep precision high.'],
          },
          {
            key: 'main',
            durationMinutes: 14,
            intervals: [{ reps: 4, on: '100m pull buoy', off: '30s easy', intent: 'Build posture and catch quality under light aerobic load.' }],
            notes: ['4 x 50m as 25m drill + 25m swim, 20s rest', 'Keep stroke length and relaxed exhale.'],
          },
          { key: 'cooldown', durationMinutes: 3, notes: ['Easy 100-200m choice stroke + 2 min mobility'] },
        ],
        adjustments: {
          ifMissed: ['Skip catch-up intensity. Resume the plan at the next session and protect consistency for the week.'],
          ifCooked: ['Drop one intensity level, reduce reps, or switch to steady aerobic work while keeping technique clean.'],
        },
        qualityChecks: ['Warm-up and cooldown included before and after key work.'],
      },
    });

    const text = renderWorkoutDetailFromSessionDetailV1(detail);
    expect(text).toContain('DRILL: 8 min – 4 x 100m pull buoy, 30s easy. Build posture and catch quality under light aerobic load.');
    expect(text).toContain('MAIN: 14 min – 4 x 100m pull buoy, 30s easy. Build posture and catch quality under light aerobic load.');
    expect(text).toContain('IF MISSED: Skip catch-up intensity. Resume the plan at the next session and protect consistency for the week.');
    expect(text).not.toContain('LEGACY warmup text should not render.');
    expect(text).not.toContain('LEGACY main text should not render.');
  });
});

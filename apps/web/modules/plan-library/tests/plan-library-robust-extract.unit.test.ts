import { describe, expect, it } from 'vitest';

import { shouldPreferCollapsedFallback } from '@/modules/plan-library/server/robust-extract';
import type { ExtractedPlanSource } from '@/modules/plan-library/server/extract';

function makeSource(params: {
  sessions: Array<{
    discipline: 'SWIM' | 'SWIM_OPEN_WATER' | 'BIKE' | 'RUN' | 'BRICK' | 'STRENGTH' | 'REST';
    title?: string | null;
    notes?: string | null;
    parserConfidence?: number | null;
    durationMinutes?: number | null;
    distanceKm?: number | null;
  }>;
  weekCount?: number;
  confidence?: number;
}): ExtractedPlanSource {
  return {
    rawText: '',
    rawJson: null,
    weeks: Array.from({ length: params.weekCount ?? 1 }, (_, weekIndex) => ({ weekIndex })),
    sessions: params.sessions.map((session, index) => ({
      weekIndex: 0,
      ordinal: index + 1,
      dayOfWeek: null,
      sessionType: 'endurance',
      discipline: session.discipline,
      title: session.title ?? null,
      durationMinutes: session.durationMinutes ?? null,
      distanceKm: session.distanceKm ?? null,
      intensityType: null,
      intensityTargetJson: null,
      recipeV2Json: null,
      parserConfidence: session.parserConfidence ?? 0.62,
      parserWarningsJson: null,
      structureJson: null,
      notes: session.notes ?? null,
    })),
    rules: [],
    warnings: [],
    confidence: params.confidence ?? 0.62,
  };
}

describe('plan-library robust extract fallback scoring', () => {
  it('keeps baseline extraction when collapsed fallback is noisier', () => {
    const baseline = makeSource({
      weekCount: 4,
      sessions: [
        { discipline: 'RUN', notes: '8km moderate on a flat route' },
        { discipline: 'BIKE', notes: '4 x 8mins moderate / 2mins easy' },
        { discipline: 'BRICK', notes: '3 x 10mins bike vigorous + 1km run moderate' },
        { discipline: 'SWIM_OPEN_WATER', notes: '1,500m include 2 x 300m efforts', distanceKm: 1.5 },
        { discipline: 'RUN', notes: '10km moderate on a flat route' },
        { discipline: 'REST', notes: 'REST-DAY' },
      ],
    });

    const collapsed = makeSource({
      weekCount: 6,
      sessions: [
        { discipline: 'RUN', notes: '8km moderate | Week focus: stay consistent' },
        { discipline: 'REST', notes: 'REST-DAY BIKE 40km moderate', distanceKm: 40 },
        { discipline: 'BRICK', notes: 'brick – a great workout to really get you race ready 220TRIATHLON.COM' },
        { discipline: 'SWIM_OPEN_WATER', notes: '1,700m open water', distanceKm: 1.7 },
        { discipline: 'REST', notes: 'REST-DAY RUN 10km moderate', distanceKm: 10 },
        { discipline: 'BIKE', notes: '5 x 3mins hard / 1min easy' },
      ],
    });

    expect(shouldPreferCollapsedFallback({ baseline, collapsedFallback: collapsed })).toBe(false);
  });

  it('allows collapsed fallback when baseline is effectively empty', () => {
    const baseline = makeSource({
      weekCount: 1,
      sessions: [],
    });

    const collapsed = makeSource({
      weekCount: 3,
      sessions: [
        { discipline: 'RUN', notes: 'Easy run 40mins' },
        { discipline: 'BIKE', notes: 'Steady bike 60mins' },
      ],
    });

    expect(shouldPreferCollapsedFallback({ baseline, collapsedFallback: collapsed })).toBe(true);
  });
});

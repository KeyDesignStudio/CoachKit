import { describe, expect, it } from 'vitest';

import { inferLayoutFamily } from '@/modules/plan-library/server/layout-families';

describe('plan-library layout family inference', () => {
  it('detects weekly grid plans with week headers and weekday rows', () => {
    const inferred = inferLayoutFamily({
      title: '12 Week Beginner Olympic Training Plan',
      rawText: `12 WEEK BEGINNER OLYMPIC TRAINING PLAN | WEEKS 1-4\nWEEK 1\nWEEK 2\nWEEK 3\nWEEK 4\nMon\nTue\nWed\nThu\nFri\nSat\nSun\nSwim\nBike\nRun`,
    });

    expect(inferred.slug).toBe('weekly-grid');
    expect(inferred.confidence).toBeGreaterThan(0.8);
  });

  it('downgrades to mixed editorial when magazine noise dominates the weekly grid', () => {
    const inferred = inferLayoutFamily({
      title: 'Race Your First 70.3',
      rawText: `220 TRIATHLON\nTRAINING ZONES\nHow it works\nWEEK 1\nWEEK 2\nWEEK 3\nMon\nTue\nWed\nThu\nFri\nSat\nSun\nMeet the expert`,
    });

    expect(inferred.slug).toBe('mixed-editorial');
  });

  it('falls back to prose plans when narrative structure dominates', () => {
    const inferred = inferLayoutFamily({
      title: 'Build to Your First Marathon',
      rawText:
        'Week one introduces easy aerobic running. Focus on relaxed form and finish feeling like you could continue. The second paragraph explains the progression and recovery goals in prose.',
    });

    expect(inferred.slug).toBe('prose-plan');
  });
});

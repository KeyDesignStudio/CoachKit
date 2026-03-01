import { describe, expect, it } from 'vitest';

import { rankChallengeScoreRows } from '@/lib/challenges/service';

describe('rankChallengeScoreRows', () => {
  it('uses deterministic tie-breakers: earliest last contribution then athleteId', () => {
    const ranked = rankChallengeScoreRows([
      {
        athleteId: 'athlete-z',
        score: 100,
        rankingValue: 100,
        sessionsCount: 2,
        lastContributingActivityAt: new Date('2026-02-03T10:00:00.000Z'),
      },
      {
        athleteId: 'athlete-a',
        score: 100,
        rankingValue: 100,
        sessionsCount: 3,
        lastContributingActivityAt: new Date('2026-02-02T10:00:00.000Z'),
      },
      {
        athleteId: 'athlete-b',
        score: 100,
        rankingValue: 100,
        sessionsCount: 1,
        lastContributingActivityAt: new Date('2026-02-02T10:00:00.000Z'),
      },
    ]);

    expect(ranked.map((row) => row.athleteId)).toEqual(['athlete-a', 'athlete-b', 'athlete-z']);
    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 3]);
  });
});

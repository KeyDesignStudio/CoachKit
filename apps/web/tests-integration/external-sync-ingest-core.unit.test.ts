import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompletionSource } from '@prisma/client';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    completedActivity: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

import { upsertExternalCompletedActivity } from '@/lib/external-sync/ingest-core';
import { listRegisteredProviderAdapters } from '@/lib/external-sync/adapters';

function buildNormalizedActivity(overrides?: Partial<Parameters<typeof upsertExternalCompletedActivity>[0]['activity']>) {
  return {
    externalActivityId: 'a1',
    provider: 'STRAVA' as const,
    source: CompletionSource.STRAVA,
    discipline: 'RUN' as const,
    subtype: 'Run',
    title: 'Morning Run',
    startTime: new Date('2026-02-19T06:00:00.000Z'),
    activityDayKey: '2026-02-19',
    activityMinutes: 360,
    durationMinutes: 45,
    distanceKm: 9.1,
    notes: null,
    metricsNamespace: 'strava',
    metrics: {
      avgHr: 152,
      avgSpeedMps: 3.4,
    },
    ...overrides,
  };
}

describe('external sync adapter registry', () => {
  it('registers Strava adapter as active provider', () => {
    expect(listRegisteredProviderAdapters()).toContain('STRAVA');
  });
});

describe('upsertExternalCompletedActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new completion for first-seen external activity', async () => {
    prismaMock.completedActivity.create.mockResolvedValue({
      id: 'c1',
      calendarItemId: null,
      durationMinutes: 45,
      distanceKm: 9.1,
      startTime: new Date('2026-02-19T06:00:00.000Z'),
      confirmedAt: null,
      matchDayDiff: null,
    });

    const result = await upsertExternalCompletedActivity({
      athleteId: 'ath-1',
      activity: buildNormalizedActivity(),
    });

    expect(result.kind).toBe('created');
    expect(prismaMock.completedActivity.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.completedActivity.findUnique).not.toHaveBeenCalled();
  });

  it('returns unchanged for replayed identical payload', async () => {
    const duplicateError: any = new Error('duplicate');
    duplicateError.code = 'P2002';
    prismaMock.completedActivity.create.mockRejectedValue(duplicateError);
    prismaMock.completedActivity.findUnique.mockResolvedValue({
      id: 'c-existing',
      calendarItemId: null,
      durationMinutes: 45,
      distanceKm: 9.1,
      startTime: new Date('2026-02-19T06:00:00.000Z'),
      confirmedAt: null,
      matchDayDiff: null,
      metricsJson: { strava: { avgHr: 152, avgSpeedMps: 3.4 } },
    });

    const result = await upsertExternalCompletedActivity({
      athleteId: 'ath-1',
      activity: buildNormalizedActivity(),
    });

    expect(result.kind).toBe('unchanged');
    expect(prismaMock.completedActivity.update).not.toHaveBeenCalled();
  });

  it('updates existing completion when payload changed', async () => {
    const duplicateError: any = new Error('duplicate');
    duplicateError.code = 'P2002';
    prismaMock.completedActivity.create.mockRejectedValue(duplicateError);
    prismaMock.completedActivity.findUnique.mockResolvedValue({
      id: 'c-existing',
      calendarItemId: null,
      durationMinutes: 45,
      distanceKm: 9.1,
      startTime: new Date('2026-02-19T06:00:00.000Z'),
      confirmedAt: null,
      matchDayDiff: null,
      metricsJson: { strava: { avgHr: 150, avgSpeedMps: 3.2 } },
    });
    prismaMock.completedActivity.update.mockResolvedValue({
      id: 'c-existing',
      calendarItemId: null,
      durationMinutes: 46,
      distanceKm: 9.2,
      startTime: new Date('2026-02-19T06:01:00.000Z'),
      confirmedAt: null,
      matchDayDiff: null,
    });

    const result = await upsertExternalCompletedActivity({
      athleteId: 'ath-1',
      activity: buildNormalizedActivity({
        durationMinutes: 46,
        distanceKm: 9.2,
        startTime: new Date('2026-02-19T06:01:00.000Z'),
        metrics: { avgHr: 155, avgSpeedMps: 3.5 },
      }),
    });

    expect(result.kind).toBe('updated');
    expect(prismaMock.completedActivity.update).toHaveBeenCalledTimes(1);
  });
});

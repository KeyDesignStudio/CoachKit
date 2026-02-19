import type { CompletionSource } from '@prisma/client';

export const EXTERNAL_SYNC_PROVIDERS = ['STRAVA', 'GARMIN', 'WAHOO', 'COROS', 'POLAR'] as const;
export type ExternalSyncProvider = (typeof EXTERNAL_SYNC_PROVIDERS)[number];

export type ExternalActivityDiscipline = 'RUN' | 'BIKE' | 'SWIM' | 'STRENGTH' | 'OTHER';

export type NormalizedExternalActivity = {
  externalActivityId: string;
  provider: ExternalSyncProvider;
  source: CompletionSource;
  discipline: ExternalActivityDiscipline;
  subtype?: string | null;
  title: string;
  startTime: Date;
  activityDayKey: string;
  activityMinutes: number;
  durationMinutes: number;
  distanceKm: number | null;
  notes: string | null;
  metricsNamespace: string;
  metrics: Record<string, unknown>;
};

export type ExternalIngestResultKind = 'created' | 'updated' | 'unchanged';

export type ExternalIngestResult = {
  kind: ExternalIngestResultKind;
  completed: {
    id: string;
    calendarItemId: string | null;
    durationMinutes: number;
    distanceKm: number | null;
    startTime: Date;
    confirmedAt: Date | null;
    matchDayDiff: number | null;
  };
};

export type ExternalProviderAdapter<TRawActivity = unknown> = {
  provider: ExternalSyncProvider;
  normalize(raw: TRawActivity, context: { athleteTimezone: string }): NormalizedExternalActivity | null;
};

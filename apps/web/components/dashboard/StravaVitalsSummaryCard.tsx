'use client';

import type { StravaVitalsSnapshot } from '@/lib/strava-vitals';

function formatNumber(value: number | null, suffix = '') {
  if (value == null) return 'N/A';
  return `${value}${suffix}`;
}

function formatPace(seconds: number | null, unit: string) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return 'N/A';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs}${unit}`;
}

type Props = {
  vitals: StravaVitalsSnapshot | null;
  loading: boolean;
  title?: string;
};

export function StravaVitalsSummaryCard({ vitals, loading, title = 'Strava Vitals (90d)' }: Props) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{title}</h3>
        {vitals ? <span className="text-xs text-[var(--muted)]">{vitals.sampleSize} sessions</span> : null}
      </div>

      {loading ? <p className="text-sm text-[var(--muted)]">Loading vitals...</p> : null}
      {!loading && (!vitals || vitals.sampleSize === 0) ? (
        <p className="text-sm text-[var(--muted)]">No synced Strava sessions yet.</p>
      ) : null}

      {!loading && vitals && vitals.sampleSize > 0 ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div className="text-[var(--muted)]">Bike avg power</div>
          <div className="text-right font-medium">{formatNumber(vitals.bike.avgPowerW, ' W')}</div>

          <div className="text-[var(--muted)]">Run avg pace</div>
          <div className="text-right font-medium">{formatPace(vitals.run.avgPaceSecPerKm, '/km')}</div>

          <div className="text-[var(--muted)]">Swim avg pace</div>
          <div className="text-right font-medium">{formatPace(vitals.swim.avgPaceSecPer100m, '/100m')}</div>

          <div className="text-[var(--muted)]">Avg heart rate</div>
          <div className="text-right font-medium">{formatNumber(vitals.overall.avgHrBpm, ' bpm')}</div>
        </div>
      ) : null}
    </div>
  );
}

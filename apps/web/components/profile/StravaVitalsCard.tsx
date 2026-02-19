'use client';

import type { StravaVitalsSnapshot } from '@/lib/strava-vitals';

function formatNumber(value: number | null, suffix = '') {
  if (value == null) return '—';
  return `${value}${suffix}`;
}

function formatPace(seconds: number | null, unit: string) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs} ${unit}`;
}

type Props = {
  vitals: StravaVitalsSnapshot | null;
  loading: boolean;
  error?: string;
};

export function StravaVitalsCard({ vitals, loading, error }: Props) {
  return (
    <section className="mb-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Strava Performance Vitals</h2>
        {vitals ? <p className="text-xs text-[var(--muted)]">Last {vitals.windowDays} days</p> : null}
      </div>

      {loading ? <p className="text-sm text-[var(--muted)]">Loading Strava vitals...</p> : null}
      {!loading && error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {!loading && !error && vitals && vitals.sampleSize === 0 ? (
        <p className="text-sm text-[var(--muted)]">No synced Strava sessions yet in this period.</p>
      ) : null}

      {!loading && !error && vitals && vitals.sampleSize > 0 ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Overall</p>
              <p className="mt-1 text-sm">Sessions: {vitals.sampleSize}</p>
              <p className="text-sm">Avg HR: {formatNumber(vitals.overall.avgHrBpm, ' bpm')}</p>
              <p className="text-sm">Avg distance: {formatNumber(vitals.overall.avgDistanceKm, ' km')}</p>
              <p className="text-sm">Avg duration: {formatNumber(vitals.overall.avgDurationMinutes, ' min')}</p>
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Bike</p>
              <p className="mt-1 text-sm">Sessions: {vitals.bike.sessions}</p>
              <p className="text-sm">Avg power: {formatNumber(vitals.bike.avgPowerW, ' W')}</p>
              <p className="text-sm">Avg speed: {formatNumber(vitals.bike.avgSpeedKmh, ' km/h')}</p>
              <p className="text-sm">Avg HR: {formatNumber(vitals.bike.avgHrBpm, ' bpm')}</p>
              <p className="text-sm">Avg cadence: {formatNumber(vitals.bike.avgCadenceRpm, ' rpm')}</p>
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Run</p>
              <p className="mt-1 text-sm">Sessions: {vitals.run.sessions}</p>
              <p className="text-sm">Avg pace: {formatPace(vitals.run.avgPaceSecPerKm, '/km')}</p>
              <p className="text-sm">Avg HR: {formatNumber(vitals.run.avgHrBpm, ' bpm')}</p>
              <p className="text-sm">Avg cadence: {formatNumber(vitals.run.avgCadenceRpm, ' rpm')}</p>
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 md:col-span-3">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Swim</p>
              <p className="mt-1 text-sm">Sessions: {vitals.swim.sessions}</p>
              <p className="text-sm">Avg pace: {formatPace(vitals.swim.avgPaceSecPer100m, '/100m')}</p>
              <p className="text-sm">Avg HR: {formatNumber(vitals.swim.avgHrBpm, ' bpm')}</p>
            </div>
          </div>
          {vitals.latestActivityAt ? (
            <p className="text-xs text-[var(--muted)]">Latest synced session: {new Date(vitals.latestActivityAt).toLocaleString()}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

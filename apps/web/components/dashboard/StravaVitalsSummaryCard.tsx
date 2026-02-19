'use client';

import type { StravaVitalsComparison, StravaVitalsMetricDelta } from '@/lib/strava-vitals';

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

function metricArrow(delta: StravaVitalsMetricDelta) {
  if (delta.trend === 'up') return '▲';
  if (delta.trend === 'down') return '▼';
  return '•';
}

function metricClass(delta: StravaVitalsMetricDelta) {
  if (delta.trend === 'up') return 'text-emerald-600';
  if (delta.trend === 'down') return 'text-rose-600';
  return 'text-[var(--muted)]';
}

function DeltaInline({ delta, formatter }: { delta: StravaVitalsMetricDelta; formatter: (value: number) => string }) {
  if (delta.delta == null) {
    return <span className="text-xs text-[var(--muted)]">No prior baseline</span>;
  }
  return (
    <span className={`text-xs ${metricClass(delta)}`}>
      {metricArrow(delta)} {formatter(Math.abs(delta.delta))}
    </span>
  );
}

type Props = {
  comparison: StravaVitalsComparison | null;
  loading: boolean;
  title?: string;
  showLoadPanel?: boolean;
  onToggleLoadPanel?: (next: boolean) => void;
};

export function StravaVitalsSummaryCard({
  comparison,
  loading,
  title = 'Strava Vitals',
  showLoadPanel = false,
  onToggleLoadPanel,
}: Props) {
  const vitals = comparison?.current ?? null;

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{title}</h3>
        <div className="flex items-center gap-2">
          {onToggleLoadPanel ? (
            <button
              type="button"
              onClick={() => onToggleLoadPanel(!showLoadPanel)}
              className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs"
            >
              {showLoadPanel ? 'Hide CTL/ATL/TSB' : 'Show CTL/ATL/TSB'}
            </button>
          ) : null}
          {vitals ? <span className="text-xs text-[var(--muted)]">{vitals.sampleSize} sessions</span> : null}
        </div>
      </div>

      {comparison ? (
        <p className="mb-2 text-xs text-[var(--muted)]">
          {comparison.range.from} to {comparison.range.to}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-[var(--muted)]">Loading vitals...</p> : null}
      {!loading && (!vitals || vitals.sampleSize === 0) ? (
        <p className="text-sm text-[var(--muted)]">No synced Strava sessions yet.</p>
      ) : null}

      {!loading && vitals && vitals.sampleSize > 0 && comparison ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="text-[var(--muted)]">Bike avg power</div>
            <div className="text-right font-medium">{formatNumber(vitals.bike.avgPowerW, ' W')}</div>
            <div className="col-span-2 text-right">
              <DeltaInline delta={comparison.deltas.bike.avgPowerW} formatter={(value) => `${value} W`} />
            </div>

            <div className="text-[var(--muted)]">Run avg pace</div>
            <div className="text-right font-medium">{formatPace(vitals.run.avgPaceSecPerKm, '/km')}</div>
            <div className="col-span-2 text-right">
              <DeltaInline delta={comparison.deltas.run.avgPaceSecPerKm} formatter={(value) => `${value}s/km`} />
            </div>

            <div className="text-[var(--muted)]">Swim avg pace</div>
            <div className="text-right font-medium">{formatPace(vitals.swim.avgPaceSecPer100m, '/100m')}</div>
            <div className="col-span-2 text-right">
              <DeltaInline delta={comparison.deltas.swim.avgPaceSecPer100m} formatter={(value) => `${value}s/100m`} />
            </div>

            <div className="text-[var(--muted)]">Avg heart rate</div>
            <div className="text-right font-medium">{formatNumber(vitals.overall.avgHrBpm, ' bpm')}</div>
            <div className="col-span-2 text-right">
              <DeltaInline delta={comparison.deltas.overall.avgHrBpm} formatter={(value) => `${value} bpm`} />
            </div>
          </div>

          {showLoadPanel && comparison.loadModel ? (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Load model</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-[var(--muted)]">
                <div>CTL</div>
                <div>ATL</div>
                <div>TSB</div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm font-medium tabular-nums">
                <div>{comparison.loadModel.current.ctl.toFixed(1)}</div>
                <div>{comparison.loadModel.current.atl.toFixed(1)}</div>
                <div>{comparison.loadModel.current.tsb.toFixed(1)}</div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

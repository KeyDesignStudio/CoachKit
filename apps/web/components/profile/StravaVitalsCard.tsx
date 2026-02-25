'use client';

import { useEffect, useMemo, useState } from 'react';

import { useApi } from '@/components/api-client';
import type { StravaLoadModel, StravaVitalsComparison, StravaVitalsMetricDelta } from '@/lib/strava-vitals';
import { addDays, toDateInput } from '@/lib/client-date';

type WindowPreset = 'LAST_30' | 'LAST_90' | 'LAST_180' | 'CUSTOM';

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

function metricArrow(delta: StravaVitalsMetricDelta) {
  if (delta.trend === 'up') return '▲';
  if (delta.trend === 'down') return '▼';
  return '•';
}

function metricArrowClass(delta: StravaVitalsMetricDelta) {
  if (delta.trend === 'up') return 'text-emerald-600';
  if (delta.trend === 'down') return 'text-rose-600';
  return 'text-[var(--muted)]';
}

function MetricDeltaText({ delta, formatter }: { delta: StravaVitalsMetricDelta; formatter: (value: number | null) => string }) {
  if (delta.current == null || delta.previous == null || delta.delta == null) {
    return <span className="text-xs text-[var(--muted)]">No previous period baseline</span>;
  }

  const abs = Math.abs(delta.delta);
  return (
    <span className={`text-xs ${metricArrowClass(delta)}`}>
      {metricArrow(delta)} {formatter(abs)} vs previous period
    </span>
  );
}

function LoadPanel({ model }: { model: StravaLoadModel }) {
  const row = (label: string, current: number, previous: number, delta: number) => {
    const trend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '•';
    const cls = trend === 'up' ? 'text-emerald-600' : trend === 'down' ? 'text-rose-600' : 'text-[var(--muted)]';
    return (
      <div className="grid grid-cols-[80px_1fr] gap-2 text-sm" key={label}>
        <div className="font-medium">{label}</div>
        <div className="text-right tabular-nums">
          {current.toFixed(1)}
          <span className="text-[var(--muted)]"> (prev {previous.toFixed(1)}) </span>
          <span className={cls}>
            {arrow} {Math.abs(delta).toFixed(1)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Load trend model (CTL / ATL / TSB)</p>
      <div className="mt-2 space-y-1">
        {row('CTL', model.current.ctl, model.previous.ctl, model.delta.ctl)}
        {row('ATL', model.current.atl, model.previous.atl, model.delta.atl)}
        {row('TSB', model.current.tsb, model.previous.tsb, model.delta.tsb)}
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">Model source window: {model.sourceDays} days</p>
    </div>
  );
}

function presetWindowDays(preset: WindowPreset) {
  if (preset === 'LAST_30') return 30;
  if (preset === 'LAST_180') return 180;
  return 90;
}

type Props = {
  endpoint: string;
  title?: string;
};

export function StravaVitalsCard({ endpoint, title = 'Strava Performance Vitals' }: Props) {
  const { request } = useApi();
  const [comparison, setComparison] = useState<StravaVitalsComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [windowPreset, setWindowPreset] = useState<WindowPreset>('LAST_90');
  const [showLoadPanel, setShowLoadPanel] = useState(false);

  const todayIso = useMemo(() => toDateInput(new Date()), []);
  const [customFrom, setCustomFrom] = useState(toDateInput(addDays(new Date(), -29)));
  const [customTo, setCustomTo] = useState(todayIso);

  useEffect(() => {
    let ignore = false;

    const load = async () => {
      setLoading(true);
      setError('');

      try {
        const qs = new URLSearchParams();
        if (windowPreset === 'CUSTOM') {
          if (!customFrom || !customTo) {
            setLoading(false);
            return;
          }
          qs.set('from', customFrom);
          qs.set('to', customTo);
        } else {
          qs.set('windowDays', String(presetWindowDays(windowPreset)));
        }
        if (showLoadPanel) {
          qs.set('includeLoadModel', '1');
        }

        const data = await request<{ comparison: StravaVitalsComparison }>(`${endpoint}?${qs.toString()}`, {
          cache: 'no-store',
        });
        if (!ignore) {
          setComparison(data.comparison);
        }
      } catch (err) {
        if (!ignore) {
          setComparison(null);
          setError(err instanceof Error ? err.message : 'Failed to load Strava vitals.');
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      ignore = true;
    };
  }, [request, endpoint, windowPreset, customFrom, customTo, showLoadPanel]);

  const vitals = comparison?.current ?? null;

  return (
    <section className="mb-6 rounded-2xl border border-[#f0532436] bg-[#fff2e9]/90 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1 text-xs"
            value={windowPreset}
            onChange={(e) => setWindowPreset(e.target.value as WindowPreset)}
          >
            <option value="LAST_30">Last 30 days</option>
            <option value="LAST_90">Last 90 days</option>
            <option value="LAST_180">Last 180 days</option>
            <option value="CUSTOM">Custom window</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
            <input type="checkbox" checked={showLoadPanel} onChange={(e) => setShowLoadPanel(e.target.checked)} />
            Show CTL/ATL/TSB
          </label>
        </div>
      </div>

      {windowPreset === 'CUSTOM' ? (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="text-xs text-[var(--muted)]">
            From
            <input
              type="date"
              className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1 text-sm"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            To
            <input
              type="date"
              className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1 text-sm"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </label>
        </div>
      ) : null}

      {comparison ? (
        <p className="mb-3 text-xs text-[var(--muted)]">
          {comparison.range.from} to {comparison.range.to} compared with {comparison.previousRange.from} to {comparison.previousRange.to}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-[var(--muted)]">Loading Strava vitals...</p> : null}
      {!loading && error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {!loading && !error && vitals && vitals.sampleSize === 0 ? (
        <p className="text-sm text-[var(--muted)]">No synced Strava sessions yet in this period.</p>
      ) : null}

      {!loading && !error && vitals && vitals.sampleSize > 0 && comparison ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Bike</p>
              <p className="mt-1 text-sm">Sessions: {vitals.bike.sessions}</p>
              <p className="text-sm">Avg power: {formatNumber(vitals.bike.avgPowerW, ' W')}</p>
              <MetricDeltaText delta={comparison.deltas.bike.avgPowerW} formatter={(v) => formatNumber(v, ' W')} />
              <p className="mt-1 text-sm">Avg speed: {formatNumber(vitals.bike.avgSpeedKmh, ' km/h')}</p>
              <MetricDeltaText delta={comparison.deltas.bike.avgSpeedKmh} formatter={(v) => formatNumber(v, ' km/h')} />
              <p className="mt-1 text-sm">Avg HR: {formatNumber(vitals.bike.avgHrBpm, ' bpm')}</p>
              <MetricDeltaText delta={comparison.deltas.bike.avgHrBpm} formatter={(v) => formatNumber(v, ' bpm')} />
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Run</p>
              <p className="mt-1 text-sm">Sessions: {vitals.run.sessions}</p>
              <p className="text-sm">Avg pace: {formatPace(vitals.run.avgPaceSecPerKm, '/km')}</p>
              <MetricDeltaText delta={comparison.deltas.run.avgPaceSecPerKm} formatter={(v) => formatPace(v, '/km')} />
              <p className="mt-1 text-sm">Avg HR: {formatNumber(vitals.run.avgHrBpm, ' bpm')}</p>
              <MetricDeltaText delta={comparison.deltas.run.avgHrBpm} formatter={(v) => formatNumber(v, ' bpm')} />
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Swim</p>
              <p className="mt-1 text-sm">Sessions: {vitals.swim.sessions}</p>
              <p className="text-sm">Avg pace: {formatPace(vitals.swim.avgPaceSecPer100m, '/100m')}</p>
              <MetricDeltaText delta={comparison.deltas.swim.avgPaceSecPer100m} formatter={(v) => formatPace(v, '/100m')} />
              <p className="mt-1 text-sm">Avg HR: {formatNumber(vitals.swim.avgHrBpm, ' bpm')}</p>
              <MetricDeltaText delta={comparison.deltas.swim.avgHrBpm} formatter={(v) => formatNumber(v, ' bpm')} />
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 md:col-span-3">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Overall</p>
              <p className="mt-1 text-sm">Avg heart rate: {formatNumber(vitals.overall.avgHrBpm, ' bpm')}</p>
              <MetricDeltaText delta={comparison.deltas.overall.avgHrBpm} formatter={(v) => formatNumber(v, ' bpm')} />
              <p className="mt-1 text-sm">Sessions: {vitals.sampleSize}</p>
              <p className="mt-1 text-sm">Avg distance: {formatNumber(vitals.overall.avgDistanceKm, ' km')}</p>
              <MetricDeltaText delta={comparison.deltas.overall.avgDistanceKm} formatter={(v) => formatNumber(v, ' km')} />
              <p className="mt-1 text-sm">Avg duration: {formatNumber(vitals.overall.avgDurationMinutes, ' min')}</p>
              <MetricDeltaText delta={comparison.deltas.overall.avgDurationMinutes} formatter={(v) => formatNumber(v, ' min')} />
            </div>
          </div>

          {showLoadPanel && comparison.loadModel ? <LoadPanel model={comparison.loadModel} /> : null}

          {vitals.latestActivityAt ? (
            <p className="text-xs text-[var(--muted)]">Latest synced session: {new Date(vitals.latestActivityAt).toLocaleString()}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

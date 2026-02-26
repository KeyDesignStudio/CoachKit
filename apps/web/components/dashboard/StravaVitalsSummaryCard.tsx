'use client';

import { useMemo, useState } from 'react';

import { Icon } from '@/components/ui/Icon';
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
    return <span className="strava-vital-delta text-xs text-[var(--muted)]">No prior baseline</span>;
  }
  return (
    <span className={`strava-vital-delta text-xs ${metricClass(delta)}`}>
      {metricArrow(delta)} {formatter(Math.abs(delta.delta))}
    </span>
  );
}

function MetricValueWithDelta({
  label,
  metricId,
  comparison,
  onOpenMobile,
  value,
  delta,
  formatter,
}: {
  label: string;
  metricId: string;
  comparison: StravaVitalsComparison;
  onOpenMobile: (metricId: string) => void;
  value: string;
  delta: StravaVitalsMetricDelta;
  formatter: (value: number) => string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5">
      <div className="flex min-w-0 self-end items-center text-[var(--muted)]">
        <span className="strava-vital-primary">{label}</span>
        <MetricHelpTrigger metricId={metricId} comparison={comparison} onOpenMobile={onOpenMobile} />
      </div>
      <div className="strava-vital-primary self-end text-right font-medium">{value}</div>
      <div aria-hidden />
      <div className="text-right">
        <DeltaInline delta={delta} formatter={formatter} />
      </div>
    </div>
  );
}

type MetricHelpCopy = {
  title: string;
  what: string;
  howToRead: string;
  bullets: string[];
  caveat?: string;
};

function formatSigned(value: number, digits = 1): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'N/A';
  const fixed = n.toFixed(digits);
  return n > 0 ? `+${fixed}` : fixed;
}

function dynamicSummary(metricId: string, comparison: StravaVitalsComparison | null): string | null {
  const vitals = comparison?.current;
  if (!vitals || vitals.sampleSize <= 0) return 'We need synced sessions before this metric can be interpreted.';
  const noBaseline = 'We need a few weeks of data to show your normal range.';

  if (metricId === 'bike') {
    if (vitals.bike.avgPowerW == null) return 'No power meter data yet, so bike power cannot be interpreted.';
    const delta = comparison?.deltas?.bike?.avgPowerW?.delta;
    if (delta == null) return noBaseline;
    return delta >= 0
      ? `Bike power is up by ${Math.round(delta)}W vs your baseline.`
      : `Bike power is down by ${Math.round(Math.abs(delta))}W vs your baseline.`;
  }
  if (metricId === 'run') {
    if (vitals.run.avgPaceSecPerKm == null) return 'No run sessions logged yet, so run pace cannot be interpreted.';
    const delta = comparison?.deltas?.run?.avgPaceSecPerKm?.delta;
    if (delta == null) return noBaseline;
    return delta < 0
      ? `Run pace is faster by ${Math.round(Math.abs(delta))}s/km vs your baseline.`
      : `Run pace is slower by ${Math.round(delta)}s/km vs your baseline.`;
  }
  if (metricId === 'swim') {
    if (vitals.swim.avgPaceSecPer100m == null) return 'No swim sessions logged yet, so swim pace cannot be interpreted.';
    const delta = comparison?.deltas?.swim?.avgPaceSecPer100m?.delta;
    if (delta == null) return noBaseline;
    return delta < 0
      ? `Swim pace is faster by ${Math.round(Math.abs(delta))}s/100m vs your baseline.`
      : `Swim pace is slower by ${Math.round(delta)}s/100m vs your baseline.`;
  }
  if (metricId === 'hr') {
    if (vitals.overall.avgHrBpm == null) return 'No heart-rate data yet, so this metric cannot be interpreted.';
    const delta = comparison?.deltas?.overall?.avgHrBpm?.delta;
    if (delta == null) return noBaseline;
    return delta > 0
      ? `Average heart rate is up by ${Math.round(delta)} bpm vs your baseline.`
      : `Average heart rate is down by ${Math.round(Math.abs(delta))} bpm vs your baseline.`;
  }
  if (metricId === 'ctl') {
    const m = comparison?.loadModel;
    if (!m) return 'Load model is unavailable until enough synced data is present.';
    if (m.delta.ctl == null) return noBaseline;
    return `Fitness (CTL) trend is ${m.delta.ctl >= 0 ? 'up' : 'down'} (${formatSigned(m.delta.ctl)}).`;
  }
  if (metricId === 'atl') {
    const m = comparison?.loadModel;
    if (!m) return 'Load model is unavailable until enough synced data is present.';
    if (m.delta.atl == null) return noBaseline;
    return `Fatigue (ATL) trend is ${m.delta.atl >= 0 ? 'up' : 'down'} (${formatSigned(m.delta.atl)}).`;
  }
  if (metricId === 'tsb') {
    const m = comparison?.loadModel;
    if (!m) return 'Load model is unavailable until enough synced data is present.';
    const tsb = m.current.tsb;
    if (!Number.isFinite(tsb)) return noBaseline;
    if (tsb <= -10) return `You are carrying high fatigue right now (TSB ${tsb.toFixed(1)}).`;
    if (tsb < 0) return `You are slightly fatigued right now (TSB ${tsb.toFixed(1)}).`;
    if (tsb <= 10) return `You are relatively fresh right now (TSB ${tsb.toFixed(1)}).`;
    return `You are very fresh right now (TSB ${tsb.toFixed(1)}).`;
  }

  return null;
}

function metricHelpContent(metricId: string, comparison: StravaVitalsComparison | null): MetricHelpCopy {
  const summary = dynamicSummary(metricId, comparison);
  if (metricId === 'bike') {
    return {
      title: 'Bike avg power',
      what: 'Average cycling power across this date range, in watts.',
      howToRead: summary ?? 'Higher usually means stronger output for the same type of ride.',
      bullets: ['Higher usually means stronger effort.', 'Compare to your own baseline, not someone else.', 'Terrain and device setup can shift this value.'],
      caveat: 'N/A appears when no power meter data is available.',
    };
  }
  if (metricId === 'run') {
    return {
      title: 'Run avg pace',
      what: 'Average running pace across this date range.',
      howToRead: summary ?? 'Lower pace time means faster running.',
      bullets: ['Lower time = faster pace.', 'Compare to your baseline for similar run types.', 'Hills, heat, and stops can slow the number.'],
      caveat: 'N/A appears when no run sessions are logged.',
    };
  }
  if (metricId === 'swim') {
    return {
      title: 'Swim avg pace',
      what: 'Average swim pace per 100m across this date range.',
      howToRead: summary ?? 'Lower time means faster swimming.',
      bullets: ['Lower time = faster pace.', 'Compare to your own baseline.', 'Pool length and rest pauses can affect pace accuracy.'],
    };
  }
  if (metricId === 'hr') {
    return {
      title: 'Avg heart rate',
      what: 'Average heart rate across sessions in this date range.',
      howToRead: summary ?? 'Use trend direction over weeks, not one isolated number.',
      bullets: ['Higher can mean harder work, heat, or fatigue.', 'Compare against your normal range.', 'Watch multi-week trends, not single sessions.'],
      caveat: 'Sensor quality and strap fit affect reliability.',
    };
  }
  if (metricId === 'ctl') {
    return {
      title: 'CTL (Fitness)',
      what: 'Estimated long-term training load, roughly the last 6 weeks.',
      howToRead: summary ?? 'Higher CTL usually means stronger base fitness.',
      bullets: ['Changes slowly over time.', 'Best compared month-to-month.', 'Use alongside ATL and TSB for context.'],
      caveat: 'Only as accurate as Strava training stress inputs.',
    };
  }
  if (metricId === 'atl') {
    return {
      title: 'ATL (Fatigue)',
      what: 'Estimated short-term training load, roughly the last 7 days.',
      howToRead: summary ?? 'Higher ATL generally means more recent fatigue.',
      bullets: ['Changes quickly after hard weeks.', 'Use with TSB to gauge freshness.', 'Short spikes are normal during build weeks.'],
      caveat: 'Does not include sleep or life stress directly.',
    };
  }
  return {
    title: 'TSB (Freshness)',
    what: 'Freshness estimate calculated as CTL minus ATL.',
    howToRead: summary ?? 'Positive is fresher, negative is more fatigued.',
    bullets: ['Near zero is common during normal training.', 'Very negative often means recovery is needed.', 'Use this as guidance, not a strict rule.'],
    caveat: 'This is a guide only; coach judgement still applies.',
  };
}

function MetricHelpTrigger({
  metricId,
  comparison,
  onOpenMobile,
}: {
  metricId: string;
  comparison: StravaVitalsComparison | null;
  onOpenMobile: (metricId: string) => void;
}) {
  const content = useMemo(() => metricHelpContent(metricId, comparison), [metricId, comparison]);
  return (
    <div className="group relative inline-flex items-center">
      <button
        type="button"
        onClick={() => {
          if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
            onOpenMobile(metricId);
          }
        }}
        className="ml-1 inline-flex min-h-[28px] min-w-[28px] items-center justify-center text-[12px] leading-none text-[var(--muted)] hover:text-[var(--text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        aria-label={`Help for ${content.title}`}
      >
        ⓘ
      </button>
      <div
        role="tooltip"
        className="pointer-events-none absolute left-0 top-8 z-20 hidden w-72 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 text-left shadow-lg md:block md:opacity-0 md:transition-opacity md:duration-150 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
      >
        <div className="text-xs font-semibold text-[var(--text)]">{content.title}</div>
        <div className="mt-1 text-xs text-[var(--muted)]">{content.what}</div>
        <div className="mt-2 text-xs text-[var(--text)]">How to read this: {content.howToRead}</div>
        <ul className="mt-2 list-disc pl-4 text-xs text-[var(--text)]">
          {content.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
          {content.caveat ? <li>{content.caveat}</li> : null}
          <li>{'“N/A” means no usable data in this range. “No prior baseline” means we need more historical data.'}</li>
        </ul>
      </div>
    </div>
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
  const [mobileHelpMetricId, setMobileHelpMetricId] = useState<string | null>(null);
  const mobileHelpContent = mobileHelpMetricId ? metricHelpContent(mobileHelpMetricId, comparison) : null;

  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        borderColor: 'var(--strava-card-border)',
        backgroundColor: 'var(--strava-card-bg)',
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          <Icon name="strava" size="sm" className="text-[var(--muted)]" aria-hidden />
          {title}
        </h3>
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
          <div className="space-y-1">
            <MetricValueWithDelta
              label="Swim avg pace"
              metricId="swim"
              comparison={comparison}
              onOpenMobile={setMobileHelpMetricId}
              value={formatPace(vitals.swim.avgPaceSecPer100m, '/100m')}
              delta={comparison.deltas.swim.avgPaceSecPer100m}
              formatter={(value) => `${value}s/100m`}
            />
            <MetricValueWithDelta
              label="Bike avg power"
              metricId="bike"
              comparison={comparison}
              onOpenMobile={setMobileHelpMetricId}
              value={formatNumber(vitals.bike.avgPowerW, ' W')}
              delta={comparison.deltas.bike.avgPowerW}
              formatter={(value) => `${value} W`}
            />
            <MetricValueWithDelta
              label="Run avg pace"
              metricId="run"
              comparison={comparison}
              onOpenMobile={setMobileHelpMetricId}
              value={formatPace(vitals.run.avgPaceSecPerKm, '/km')}
              delta={comparison.deltas.run.avgPaceSecPerKm}
              formatter={(value) => `${value}s/km`}
            />
            <MetricValueWithDelta
              label="Avg heart rate"
              metricId="hr"
              comparison={comparison}
              onOpenMobile={setMobileHelpMetricId}
              value={formatNumber(vitals.overall.avgHrBpm, ' bpm')}
              delta={comparison.deltas.overall.avgHrBpm}
              formatter={(value) => `${value} bpm`}
            />
          </div>

          {showLoadPanel && comparison.loadModel ? (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Load model</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-[var(--muted)]">
                <div className="flex items-center">
                  CTL
                  <MetricHelpTrigger metricId="ctl" comparison={comparison} onOpenMobile={setMobileHelpMetricId} />
                </div>
                <div className="flex items-center">
                  ATL
                  <MetricHelpTrigger metricId="atl" comparison={comparison} onOpenMobile={setMobileHelpMetricId} />
                </div>
                <div className="flex items-center">
                  TSB
                  <MetricHelpTrigger metricId="tsb" comparison={comparison} onOpenMobile={setMobileHelpMetricId} />
                </div>
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

      {mobileHelpContent ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={`${mobileHelpContent.title} help`}>
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            onClick={() => setMobileHelpMetricId(null)}
            aria-label="Close help"
          />
          <div className="absolute bottom-0 left-0 right-0 rounded-t-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-xl">
            <div className="mb-1 text-sm font-semibold">{mobileHelpContent.title}</div>
            <div className="text-xs text-[var(--muted)]">{mobileHelpContent.what}</div>
            <div className="mt-2 text-xs text-[var(--text)]">How to read this: {mobileHelpContent.howToRead}</div>
            <ul className="mt-2 list-disc pl-5 text-xs text-[var(--text)]">
              {mobileHelpContent.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
              {mobileHelpContent.caveat ? <li>{mobileHelpContent.caveat}</li> : null}
              <li>{'“N/A” means no usable data in this range. “No prior baseline” means we need more historical data.'}</li>
            </ul>
            <button
              type="button"
              className="mt-3 inline-flex min-h-[44px] items-center rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm"
              onClick={() => setMobileHelpMetricId(null)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

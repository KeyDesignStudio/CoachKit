'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useApi } from '@/components/api-client';
import { Block } from '@/components/ui/Block';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { tokens } from '@/components/ui/tokens';
import { cn } from '@/lib/cn';
import { formatDisplayInTimeZone } from '@/lib/client-date';

type Dataset = 'ACTUAL' | 'PLANNED';
type DatasetMode = Dataset | 'BOTH';

type SessionBreakdownRow = {
  id: string;
  title: string;
  durationMinutes: number;
  distanceKm: number | null;
  rpe: number | null;
  caloriesKcal: number | null;
};

type DatasetPayload = {
  series: Record<string, number[]>;
  breakdown: Record<string, Record<string, SessionBreakdownRow[]>>;
};

type CumulativeTrainingResponse = {
  from: string;
  to: string;
  dataset: DatasetMode;
  disciplineFilter: string | null;
  dayKeys: string[];
  disciplines: string[];
  actual: DatasetPayload | null;
  planned: DatasetPayload | null;
};

function formatMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDistanceKm(km: number | null): string | null {
  if (typeof km !== 'number' || !Number.isFinite(km) || km <= 0) return null;
  if (km < 10) return `${km.toFixed(1)}km`;
  return `${Math.round(km)}km`;
}

function formatCalories(kcal: number | null): string | null {
  if (typeof kcal !== 'number' || !Number.isFinite(kcal) || kcal <= 0) return null;
  return `${Math.round(kcal)}kcal`;
}

function tickStepForDayCount(days: number): number {
  if (days <= 7) return 1;
  if (days <= 14) return 2;
  if (days <= 30) return 5;
  return 7;
}

type HoveredPoint = {
  discipline: string;
  dayKey: string;
  actual?: {
    cumulativeMinutes: number;
    dailyMinutes: number;
    dailyDistanceKm: number | null;
    dailyCaloriesKcal: number | null;
    sessions: SessionBreakdownRow[];
  };
  planned?: {
    cumulativeMinutes: number;
    dailyMinutes: number;
    dailyDistanceKm: number | null;
  };
  anchor: { x: number; y: number };
};

function sumDailyTotals(sessions: SessionBreakdownRow[]): {
  minutes: number;
  distanceKm: number | null;
  caloriesKcal: number | null;
} {
  let minutes = 0;
  let distanceKm = 0;
  let hasDistance = false;
  let caloriesKcal = 0;
  let hasCalories = false;

  for (const s of sessions) {
    minutes += s.durationMinutes;
    if (typeof s.distanceKm === 'number' && Number.isFinite(s.distanceKm)) {
      distanceKm += s.distanceKm;
      hasDistance = true;
    }
    if (typeof s.caloriesKcal === 'number' && Number.isFinite(s.caloriesKcal)) {
      caloriesKcal += s.caloriesKcal;
      hasCalories = true;
    }
  }

  return {
    minutes,
    distanceKm: hasDistance ? distanceKm : null,
    caloriesKcal: hasCalories ? caloriesKcal : null,
  };
}

export function CumulativeTrainingChart({
  from,
  to,
  discipline,
  athleteTimeZone,
  initialData,
  disableFetch,
  defaultMode,
}: {
  from: string;
  to: string;
  discipline: string | null;
  athleteTimeZone: string;
  initialData?: CumulativeTrainingResponse;
  disableFetch?: boolean;
  defaultMode?: DatasetMode;
}) {
  const { request } = useApi();

  const [mode, setMode] = useState<DatasetMode>(defaultMode ?? 'BOTH');
  const [data, setData] = useState<CumulativeTrainingResponse | null>(initialData ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const [tooltipEnabled, setTooltipEnabled] = useState(false);
  const [hovered, setHovered] = useState<HoveredPoint | null>(null);

  const plotContainerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 640, h: 260 });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setTooltipEnabled(media.matches);
    update();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }

    // eslint-disable-next-line deprecation/deprecation
    media.addListener(update);
    // eslint-disable-next-line deprecation/deprecation
    return () => media.removeListener(update);
  }, []);

  useEffect(() => {
    const el = plotContainerRef.current;
    if (!el) return;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(320, Math.round(rect.width));
      setSize({ w, h: 260 });
    };

    compute();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => compute()) : null;
    ro?.observe(el);

    return () => ro?.disconnect();
  }, []);

  useEffect(() => {
    if (disableFetch) return;
    let cancelled = false;

    const qs = new URLSearchParams();
    qs.set('from', from);
    qs.set('to', to);
    qs.set('dataset', mode);
    if (discipline) qs.set('discipline', discipline);

    setLoading(true);
    setError('');

    request<CumulativeTrainingResponse>(`/api/athlete/dashboard/cumulative-training?${qs.toString()}`)
      .then((resp) => {
        if (cancelled) return;
        setData(resp);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load training chart.');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [disableFetch, mode, discipline, from, request, to]);

  const chart = useMemo(() => {
    const dayKeys = data?.dayKeys ?? [];
    const disciplines = data?.disciplines ?? [];
    const actualSeries = data?.actual?.series ?? {};
    const plannedSeries = data?.planned?.series ?? {};

    const getSeries = (disc: string) => {
      if (mode === 'PLANNED') return plannedSeries[disc] ?? [];
      if (mode === 'ACTUAL') return actualSeries[disc] ?? [];
      const a = actualSeries[disc] ?? [];
      const p = plannedSeries[disc] ?? [];
      return a.length >= p.length ? a : p;
    };

    const hasAnyPoint = disciplines.some((d) => getSeries(d).some((v) => v > 0));

    const maxY = Math.max(
      0,
      ...disciplines.flatMap((d) => {
        const a = actualSeries[d] ?? [];
        const p = plannedSeries[d] ?? [];
        if (mode === 'ACTUAL') return a;
        if (mode === 'PLANNED') return p;
        return [...a, ...p];
      })
    );

    return {
      dayKeys,
      disciplines,
      hasAnyPoint,
      maxY,
      actualSeries,
      plannedSeries,
    };
  }, [data, mode]);

  const plannedStroke = {
    width: 1.6,
    opacity: 0.35,
    dash: '5 4',
    pointOpacity: 0.15,
  } as const;

  const actualStroke = {
    width: 2.6,
    opacity: 0.95,
    pointOpacity: 0.9,
  } as const;

  const tooltipNode =
    hovered
      ? createPortal(
          <div
            role="tooltip"
            className={cn(
              'pointer-events-none fixed z-[60] -translate-x-1/2 -translate-y-full',
              'px-3 py-2 rounded-md border border-[var(--border-subtle)]',
              'bg-[var(--bg-card)] text-[var(--text)] shadow-lg'
            )}
            style={{ left: hovered.anchor.x, top: hovered.anchor.y - 10 }}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <div className="text-xs font-medium">
                  {formatDisplayInTimeZone(hovered.dayKey, athleteTimeZone)}
                </div>
                <div className="text-xs text-[var(--muted)]">{mode === 'BOTH' ? 'Actual + Planned' : mode === 'ACTUAL' ? 'Actual' : 'Planned'}</div>
              </div>

              <div className="flex items-center gap-2">
                {(() => {
                  const theme = getDisciplineTheme(hovered.discipline);
                  return <Icon name={theme.iconName} size="sm" className={theme.textClass} aria-hidden />;
                })()}
                <div className="text-xs font-medium">{hovered.discipline}</div>
              </div>

              <div className="space-y-2">
                {hovered.actual ? (
                  <div className="rounded border border-[var(--border-subtle)] px-2 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Actual</div>
                      <div className="text-xs text-[var(--muted)]">Cumulative {formatMinutes(hovered.actual.cumulativeMinutes)}</div>
                    </div>
                    <div className="mt-1 text-xs text-[var(--muted)]">
                      Daily total: {formatMinutes(hovered.actual.dailyMinutes)}
                      {formatDistanceKm(hovered.actual.dailyDistanceKm) ? ` · ${formatDistanceKm(hovered.actual.dailyDistanceKm)}` : ''}
                      {formatCalories(hovered.actual.dailyCaloriesKcal) ? ` · ${formatCalories(hovered.actual.dailyCaloriesKcal)}` : ''}
                    </div>
                  </div>
                ) : null}

                {hovered.planned ? (
                  <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-structure)]/40 px-2 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Planned</div>
                      <div className="text-xs text-[var(--muted)]">Cumulative {formatMinutes(hovered.planned.cumulativeMinutes)}</div>
                    </div>
                    <div className="mt-1 text-xs text-[var(--muted)]">
                      Daily total: {formatMinutes(hovered.planned.dailyMinutes)}
                      {formatDistanceKm(hovered.planned.dailyDistanceKm) ? ` · ${formatDistanceKm(hovered.planned.dailyDistanceKm)}` : ''}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="border-t border-[var(--border-subtle)] pt-2">
                <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Sessions (Actual)</div>
                {hovered.actual?.sessions?.length ? null : (
                  <div className="text-xs text-[var(--muted)] mt-1">No sessions for this day.</div>
                )}
                {hovered.actual?.sessions?.length ? (
                  <div className="mt-1 space-y-1 max-w-[340px]">
                    {hovered.actual.sessions.slice(0, 8).map((s) => {
                      const parts = [
                        formatMinutes(s.durationMinutes),
                        formatDistanceKm(s.distanceKm),
                        s.rpe != null ? `RPE ${s.rpe}` : null,
                        formatCalories(s.caloriesKcal),
                      ].filter(Boolean);

                      return (
                        <div key={s.id} className="flex items-baseline justify-between gap-3">
                          <div className="min-w-0 truncate text-xs" title={s.title}>
                            {s.title}
                          </div>
                          <div className="shrink-0 text-[11px] tabular-nums text-[var(--muted)] whitespace-nowrap">{parts.join(' · ')}</div>
                        </div>
                      );
                    })}
                    {hovered.actual.sessions.length > 8 ? (
                      <div className="text-[11px] text-[var(--muted)]">+{hovered.actual.sessions.length - 8} more</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  const w = size.w;
  const h = size.h;

  const padding = { left: 52, right: 12, top: 14, bottom: 32 };
  const plotW = Math.max(1, w - padding.left - padding.right);
  const plotH = Math.max(1, h - padding.top - padding.bottom);

  const xAt = (idx: number, n: number) => {
    if (n <= 1) return padding.left + plotW / 2;
    return padding.left + (idx / (n - 1)) * plotW;
  };

  const yAt = (value: number, max: number) => {
    if (max <= 0) return padding.top + plotH;
    const t = Math.max(0, Math.min(1, value / max));
    return padding.top + (1 - t) * plotH;
  };

  const yTicks = [0, chart.maxY * 0.5, chart.maxY].map((v) => Math.round(v));
  const xTickStep = tickStepForDayCount(chart.dayKeys.length);

  const showEmptyState = !loading && !error && data && !chart.hasAnyPoint;

  return (
    <div className="min-w-0" data-testid="athlete-dashboard-cumulative-training">
      {tooltipNode}
      <Block
        title="Cumulative training time"
        rightAction={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === 'ACTUAL' ? 'primary' : 'secondary'}
              onClick={() => setMode('ACTUAL')}
              aria-pressed={mode === 'ACTUAL'}
            >
              Actual
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'PLANNED' ? 'primary' : 'secondary'}
              onClick={() => setMode('PLANNED')}
              aria-pressed={mode === 'PLANNED'}
            >
              Planned
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'BOTH' ? 'primary' : 'secondary'}
              onClick={() => setMode('BOTH')}
              aria-pressed={mode === 'BOTH'}
            >
              Both
            </Button>
          </div>
        }
        padding={false}
      >
        <div className={cn(tokens.spacing.blockPaddingX, 'pt-4 pb-3')}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-[var(--muted)]">Time accumulates by local day ({athleteTimeZone}).</div>
            <div className="flex flex-wrap items-center gap-3">
              {(chart.disciplines.length ? chart.disciplines : ['BIKE', 'RUN', 'SWIM', 'OTHER']).map((disc) => {
                const theme = getDisciplineTheme(disc);
                const active = chart.disciplines.includes(disc);
                return (
                  <div key={disc} className={cn('flex items-center gap-1.5', active ? '' : 'opacity-30')}>
                    <span className={cn('inline-flex', theme.textClass)} aria-hidden>
                      <svg width="10" height="10" viewBox="0 0 10 10">
                        <circle cx="5" cy="5" r="4" fill="currentColor" />
                      </svg>
                    </span>
                    <span className={cn('text-xs font-medium', tokens.typography.meta)}>{disc}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className={cn('border-t border-[var(--border-subtle)]', tokens.spacing.blockPaddingX, 'pb-4')}>
          {error ? <div className="pt-4 text-sm text-rose-700">{error}</div> : null}
          {showEmptyState ? <div className="pt-4 text-sm text-[var(--muted)]">No training data for this period.</div> : null}

          {!error && !showEmptyState ? (
            <div ref={plotContainerRef} className="pt-2">
              <svg
                ref={svgRef}
                width={w}
                height={h}
                viewBox={`0 0 ${w} ${h}`}
                className="block"
                onMouseLeave={() => setHovered(null)}
              >
                {/* Horizontal grid + Y axis labels */}
                {yTicks.map((t) => {
                  const y = yAt(t, chart.maxY);
                  return (
                    <g key={t}>
                      <line x1={padding.left} y1={y} x2={w - padding.right} y2={y} stroke="var(--border-subtle)" strokeWidth={1} />
                      <text
                        x={padding.left - 10}
                        y={y}
                        textAnchor="end"
                        dominantBaseline="middle"
                        className="fill-[var(--muted)]"
                        fontSize={10}
                      >
                        {formatMinutes(t)}
                      </text>
                    </g>
                  );
                })}

                {/* X axis labels */}
                {chart.dayKeys.map((dayKey, idx) => {
                  if (idx % xTickStep !== 0 && idx !== chart.dayKeys.length - 1) return null;
                  const x = xAt(idx, chart.dayKeys.length);
                  return (
                    <text
                      key={dayKey}
                      x={x}
                      y={h - 10}
                      textAnchor="middle"
                      className="fill-[var(--muted)]"
                      fontSize={10}
                    >
                      {formatDisplayInTimeZone(dayKey, athleteTimeZone)}
                    </text>
                  );
                })}

                {/* Lines */}
                {chart.disciplines.map((disc) => {
                  const theme = getDisciplineTheme(disc);
                  const actualValues = chart.actualSeries[disc] ?? [];
                  const plannedValues = chart.plannedSeries[disc] ?? [];

                  const makePath = (values: number[]) =>
                    values
                      .map((v, idx) => {
                        const x = xAt(idx, chart.dayKeys.length);
                        const y = yAt(v, chart.maxY);
                        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
                      })
                      .join(' ');

                  return (
                    <g key={disc} className={theme.textClass}>
                      {/* Planned behind Actual (Both mode) */}
                      {mode === 'BOTH' && plannedValues.length ? (
                        <path
                          d={makePath(plannedValues)}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={plannedStroke.width}
                          strokeDasharray={plannedStroke.dash}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          opacity={plannedStroke.opacity}
                        />
                      ) : null}

                      {/* Planned only (primary styling) */}
                      {mode === 'PLANNED' && plannedValues.length ? (
                        <path
                          d={makePath(plannedValues)}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={actualStroke.width}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          opacity={actualStroke.opacity}
                        />
                      ) : null}

                      {/* Actual on top (Both + Actual modes) */}
                      {mode !== 'PLANNED' && actualValues.length ? (
                        <path
                          d={makePath(actualValues)}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={actualStroke.width}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          opacity={actualStroke.opacity}
                        />
                      ) : null}

                      {(mode === 'PLANNED' ? plannedValues : actualValues).map((v, idx) => {
                        const x = xAt(idx, chart.dayKeys.length);
                        const y = yAt(v, chart.maxY);
                        const dayKey = chart.dayKeys[idx]!;

                        const actualCumulative = actualValues[idx] ?? 0;
                        const plannedCumulative = plannedValues[idx] ?? 0;

                        const actualSessions = data?.actual?.breakdown?.[dayKey]?.[disc] ?? [];
                        const plannedSessions = data?.planned?.breakdown?.[dayKey]?.[disc] ?? [];

                        const actualTotals = sumDailyTotals(actualSessions);
                        const plannedTotals = sumDailyTotals(plannedSessions);

                        const handleHoverOrTap = () => {
                          const svgEl = svgRef.current;
                          if (!svgEl) return;
                          const rect = svgEl.getBoundingClientRect();

                          setHovered({
                            discipline: disc,
                            dayKey,
                            anchor: { x: rect.left + x, y: rect.top + y },
                            actual:
                              mode === 'PLANNED'
                                ? undefined
                                : {
                                    cumulativeMinutes: actualCumulative,
                                    dailyMinutes: actualTotals.minutes,
                                    dailyDistanceKm: actualTotals.distanceKm,
                                    dailyCaloriesKcal: actualTotals.caloriesKcal,
                                    sessions: actualSessions,
                                  },
                            planned:
                              mode === 'ACTUAL'
                                ? undefined
                                : {
                                    cumulativeMinutes: plannedCumulative,
                                    dailyMinutes: plannedTotals.minutes,
                                    dailyDistanceKm: plannedTotals.distanceKm,
                                  },
                          });
                        };

                        return (
                          <circle
                            key={`${disc}:${dayKey}:${mode}`}
                            data-testid={`ct-point-${disc}-${dayKey}-${mode === 'PLANNED' ? 'planned' : 'actual'}`}
                            cx={x}
                            cy={y}
                            r={3.5}
                            fill="currentColor"
                            opacity={actualStroke.pointOpacity}
                            onMouseEnter={() => {
                              if (!tooltipEnabled) return;
                              handleHoverOrTap();
                            }}
                            onClick={() => {
                              // Allow tooltip on touch devices via tap.
                              handleHoverOrTap();
                            }}
                            onMouseMove={() => {
                              // Keep tooltip stable while hovering.
                            }}
                          />
                        );
                      })}
                    </g>
                  );
                })}
              </svg>

              {loading ? <div className="pt-2 text-sm text-[var(--muted)]">Updating…</div> : null}
            </div>
          ) : null}
        </div>
      </Block>
    </div>
  );
}

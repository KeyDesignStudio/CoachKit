'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { Icon } from '@/components/ui/Icon';
import { SelectField } from '@/components/ui/SelectField';
import { uiH1 } from '@/components/ui/typography';
import { Block } from '@/components/ui/Block';
import { BlockTitle } from '@/components/ui/BlockTitle';
import { FieldLabel } from '@/components/ui/FieldLabel';
import { tokens } from '@/components/ui/tokens';
import { getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';
import { cn } from '@/lib/cn';
import { addDays, formatDisplayInTimeZone, toDateInput } from '@/lib/client-date';
import { FullScreenLogoLoader } from '@/components/FullScreenLogoLoader';

type TimeRangePreset = 'LAST_7' | 'LAST_14' | 'LAST_30';

type AthleteDashboardResponse = {
  kpis: {
    workoutsCompleted: number;
    workoutsSkipped: number;
    totalTrainingMinutes: number;
    totalDistanceKm: number;
  };
  attention: {
    pendingConfirmation: number;
    workoutsMissed: number;
    painFlagWorkouts?: number;
  };
  disciplineLoad: Array<{ discipline: string; totalMinutes: number; totalDistanceKm: number }>;
};

function NeedsAttentionItem({
  label,
  count,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  tone: 'danger' | 'primary' | 'neutral';
  onClick: () => void;
}) {
  const toneClasses =
    tone === 'danger'
      ? 'bg-rose-500/15 text-rose-700'
      : tone === 'primary'
        ? 'bg-blue-600/10 text-blue-700'
        : 'bg-[var(--bg-card)] border border-black/15 text-[var(--text)]';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-2xl text-left min-h-[56px]',
        tokens.spacing.containerPadding,
        'transition-colors',
        tone === 'neutral' ? 'hover:bg-white/60' : '',
        toneClasses
      )}
    >
      <div className={cn("flex items-center justify-between", tokens.spacing.blockRowGap)}>
        <div className={cn("font-medium", tokens.typography.body)}>{label}</div>
        <div className={cn("font-semibold tabular-nums", tokens.typography.h1, tone === 'danger' ? 'text-rose-700' : '')}>{count}</div>
      </div>
    </button>
  );
}

function formatMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDistanceKm(km: number): string {
  const value = Number.isFinite(km) ? km : 0;
  if (value === 0) return '0km';
  if (value < 10) return `${value.toFixed(1)}km`;
  return `${Math.round(value)}km`;
}

function getDateRangeFromPreset(preset: TimeRangePreset, athleteTimeZone: string) {
  const todayKey = getZonedDateKeyForNow(athleteTimeZone);
  const todayUtcMidnight = new Date(`${todayKey}T00:00:00.000Z`);
  const days = preset === 'LAST_14' ? 14 : preset === 'LAST_30' ? 30 : 7;
  const from = toDateInput(addDays(todayUtcMidnight, -(days - 1)));
  const to = toDateInput(todayUtcMidnight);
  return { from, to };
}

export default function AthleteDashboardConsolePage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();

  const [timeRange, setTimeRange] = useState<TimeRangePreset>('LAST_7');
  const [discipline, setDiscipline] = useState<string | null>(null);

  const [data, setData] = useState<AthleteDashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const needsCardRef = useRef<HTMLDivElement | null>(null);
  const [xlTopCardHeightPx, setXlTopCardHeightPx] = useState<number | null>(null);

  const athleteTimeZone = user?.timezone ?? 'UTC';
  const dateRange = useMemo(() => getDateRangeFromPreset(timeRange, athleteTimeZone), [timeRange, athleteTimeZone]);

  const reload = useCallback(
    async (bypassCache = false) => {
      if (!user?.userId || user.role !== 'ATHLETE') return;

      setLoading(true);
      setError('');

      const qs = new URLSearchParams();
      qs.set('from', dateRange.from);
      qs.set('to', dateRange.to);
      if (discipline) qs.set('discipline', discipline);
      if (bypassCache) qs.set('t', String(Date.now()));

      try {
        const resp = await request<AthleteDashboardResponse>(
          `/api/athlete/dashboard/console?${qs.toString()}`,
          bypassCache ? { cache: 'no-store' } : undefined
        );
        setData(resp);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
      } finally {
        setLoading(false);
      }
    },
    [dateRange.from, dateRange.to, discipline, request, user?.role, user?.userId]
  );

  useEffect(() => {
    if (user?.role === 'ATHLETE') {
      void reload();
    }
  }, [reload, user?.role]);

  // Keep the three top cards the same height at desktop (xl), using the Needs card as the baseline.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (userLoading) return;
    if (!user || user.role !== 'ATHLETE') return;

    const mql = window.matchMedia('(min-width: 1280px)');
    const compute = () => {
      if (!mql.matches) {
        setXlTopCardHeightPx(null);
        return;
      }
      const h = needsCardRef.current?.getBoundingClientRect().height;
      if (!h || !Number.isFinite(h) || h <= 0) return;
      setXlTopCardHeightPx(Math.round(h));
    };

    compute();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => compute()) : null;
    if (ro && needsCardRef.current) ro.observe(needsCardRef.current);
    const onChange = () => compute();
    mql.addEventListener('change', onChange);
    window.addEventListener('resize', onChange);

    return () => {
      ro?.disconnect();
      mql.removeEventListener('change', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, [user, userLoading]);

  // Keep loading/access gates consistent with the coach dashboard styling.
  if (userLoading) {
    return <FullScreenLogoLoader />;
  }

  if (!user || user.role !== 'ATHLETE') {
    return (
      <div className={cn(tokens.spacing.screenPadding, "pt-6")}>
        <p className={tokens.typography.bodyMuted}>Athlete access required.</p>
      </div>
    );
  }

  return (
    <>
      <section className={cn(tokens.spacing.screenPadding, "pb-10")}>
        <div className="pt-3 md:pt-6">
          <h1 className={tokens.typography.h1}>Athlete Console</h1>
        </div>

        <div className="mt-4">
          {/* Top grid shell: mobile 1 col (Filters → Needs → At a glance), tablet 2 cols (Needs + Filters, then At a glance), desktop 3 cols */}
          <div className={cn("grid grid-cols-1 min-w-0 items-start md:grid-cols-2 xl:grid-cols-3", tokens.spacing.gridGap)}>
              {/* Column 1: Needs your attention */}
              <div className="min-w-0 order-2 md:order-2">
                <div ref={needsCardRef}>
                  <Block
                    title="Needs your attention"
                    rightAction={<div className={tokens.typography.meta}>Tap to open calendar</div>}
                  >
                    <div className={cn("grid", tokens.spacing.widgetGap)}>
                      {typeof data?.attention.painFlagWorkouts === 'number' ? (
                        <NeedsAttentionItem
                          label="Workouts with pain flagged"
                          count={data.attention.painFlagWorkouts}
                          tone="danger"
                          onClick={() => (window.location.href = '/athlete/calendar')}
                        />
                      ) : null}

                      <NeedsAttentionItem
                        label="Workouts pending your confirmation"
                        count={data?.attention.pendingConfirmation ?? 0}
                        tone="primary"
                        onClick={() => (window.location.href = '/athlete/calendar')}
                      />

                      <NeedsAttentionItem
                        label="Workouts missed"
                        count={data?.attention.workoutsMissed ?? 0}
                        tone="neutral"
                        onClick={() => (window.location.href = '/athlete/calendar')}
                      />
                    </div>
                  </Block>
                </div>
              </div>

              {/* Column 2: Filters/selectors */}
              <div className="min-w-0 order-1 md:order-1">
                <Block
                  title="Make your selection"
                  className="flex flex-col justify-between"
                  style={xlTopCardHeightPx ? { height: `${xlTopCardHeightPx}px` } : undefined}
                >
                  <div>
                    <div className={cn("grid grid-cols-2 gap-y-6 min-w-0 md:gap-x-4", tokens.spacing.gridGap)}>
                      {/* Row 1 */}
                      <div className="min-w-0 col-start-1 row-start-1">
                        <FieldLabel className="pl-1">Discipline</FieldLabel>
                        <SelectField
                          className="min-h-[44px] w-full"
                          value={discipline ?? ''}
                          onChange={(e) => setDiscipline(e.target.value ? e.target.value : null)}
                        >
                          <option value="">All disciplines</option>
                          <option value="BIKE">Bike</option>
                          <option value="RUN">Run</option>
                          <option value="SWIM">Swim</option>
                          <option value="OTHER">Other</option>
                        </SelectField>
                      </div>
                      <div className="min-w-0 col-start-2 row-start-1" aria-hidden="true" />

                      {/* Row 2 */}
                      <div className="min-w-0 col-start-1 row-start-2">
                        <FieldLabel className="pl-1">Time range</FieldLabel>
                        <SelectField
                          className="min-h-[44px] w-full"
                          value={timeRange}
                          onChange={(e) => setTimeRange(e.target.value as TimeRangePreset)}
                        >
                          <option value="LAST_7">Last 7 days</option>
                          <option value="LAST_14">Last 14 days</option>
                          <option value="LAST_30">Last 30 days</option>
                        </SelectField>
                      </div>

                      <div className="min-w-0 col-start-2 row-start-2">
                        <FieldLabel className="pl-1">&nbsp;</FieldLabel>
                        <div className={cn("min-h-[44px] flex items-center justify-center rounded-2xl px-3 min-w-0 bg-[var(--bg-structure)]/75")}>
                          <div className={cn("truncate", tokens.typography.body)}>
                            {formatDisplayInTimeZone(dateRange.from, athleteTimeZone)} → {formatDisplayInTimeZone(dateRange.to, athleteTimeZone)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Refresh (bottom-right, spans both columns) */}
                  <div className="flex items-center justify-end gap-3 mt-4">
                    <Button type="button" variant="secondary" onClick={() => reload(true)} className="min-h-[44px]">
                      <Icon name="refresh" size="sm" className="mr-1" aria-hidden />
                      Refresh
                    </Button>
                  </div>
                </Block>
              </div>

              {/* Column 3: At a glance (stacks vertically); on tablet sits below and spans full width */}
              <div className="min-w-0 md:order-3 md:col-span-2 xl:col-span-1">
                <div
                  className="rounded-2xl bg-[var(--bg-card)] p-3 min-h-0 flex flex-col"
                  data-testid="athlete-dashboard-at-a-glance"
                  style={xlTopCardHeightPx ? { minHeight: `${xlTopCardHeightPx}px` } : undefined}
                >
                  <div className="flex items-end justify-between gap-3 mb-2">
                    <BlockTitle>At a glance</BlockTitle>
                    <div className="text-xs text-[var(--muted)]" aria-hidden="true" />
                  </div>

                  <div
                    className={cn("grid grid-cols-1 items-start min-[520px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] min-[520px]:items-center min-w-0", tokens.spacing.widgetGap)}
                    data-testid="athlete-dashboard-at-a-glance-grid"
                  >
                    {/* Left: stats */}
                    <div className={cn("min-w-0 rounded-2xl bg-[var(--bg-structure)]/40", tokens.spacing.elementPadding)} data-testid="athlete-dashboard-at-a-glance-stats">
                      <div className={cn("grid", tokens.spacing.widgetGap)}>
                        {[
                          { label: 'WORKOUTS COMPLETED', value: String(data?.kpis.workoutsCompleted ?? 0) },
                          { label: 'WORKOUTS MISSED', value: String(data?.kpis.workoutsSkipped ?? 0) },
                          { label: 'TOTAL TRAINING TIME', value: formatMinutes(data?.kpis.totalTrainingMinutes ?? 0) },
                          { label: 'TOTAL DISTANCE', value: formatDistanceKm(data?.kpis.totalDistanceKm ?? 0) },
                        ].map((row, idx) => (
                          <div
                            key={row.label}
                            className={cn(
                              'min-w-0 flex items-baseline justify-between py-2',
                              tokens.spacing.widgetGap,
                              idx < 3 ? 'border-b border-black/5' : ''
                            )}
                            data-testid="athlete-dashboard-at-a-glance-stat-row"
                          >
                            <div className={cn('min-w-0 uppercase tracking-wide truncate', tokens.typography.meta)} title={row.label}>
                              {row.label}
                            </div>
                            <div className={cn('flex-shrink-0 leading-[1.05] font-semibold tabular-nums', tokens.typography.body, 'sm:text-base')}>
                              {row.value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Right: discipline load */}
                    <div className={cn("min-w-0 rounded-2xl bg-[var(--bg-structure)]/40", tokens.spacing.elementPadding)} data-testid="athlete-dashboard-discipline-load">
                      <div className={cn("flex flex-col", tokens.spacing.widgetGap)}>
                        {(() => {
                          const rows = data?.disciplineLoad ?? [];
                          const maxMinutes = Math.max(1, ...rows.map((r) => r.totalMinutes));
                          return (
                            <>
                              {rows.map((r) => {
                                const theme = getDisciplineTheme(r.discipline);
                                const pct = Math.max(0, Math.min(1, r.totalMinutes / maxMinutes));
                                const rightValue = `${formatMinutes(r.totalMinutes)} · ${formatDistanceKm(r.totalDistanceKm)}`;
                                return (
                                  <div key={r.discipline} className={cn("grid grid-cols-[auto,1fr,auto] items-center min-w-0", tokens.spacing.widgetGap)}>
                                    <div className={cn("flex items-center min-w-[64px]", tokens.spacing.widgetGap)}>
                                      <Icon name={theme.iconName} size="sm" className={theme.textClass} aria-hidden />
                                      <span className={cn("font-medium text-[var(--text)]", tokens.typography.meta)}>{(r.discipline || 'OTHER').toUpperCase()}</span>
                                    </div>

                                    <div className="h-2 rounded-full bg-black/10 overflow-hidden">
                                      <div className="h-full rounded-full bg-black/25" style={{ width: `${Math.round(pct * 100)}%` }} />
                                    </div>

                                    <div
                                      className={cn("tabular-nums text-right whitespace-nowrap truncate max-w-[120px]", tokens.typography.meta)}
                                      title={rightValue}
                                    >
                                      {rightValue}
                                    </div>
                                  </div>
                                );
                              })}
                              {rows.length === 0 ? <div className="text-sm text-[var(--muted)] px-1 py-2">No data for this range.</div> : null}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          {error ? <div className="mt-4 rounded-2xl bg-rose-500/10 text-rose-700 p-4 text-sm">{error}</div> : null}
          {loading && !data ? <FullScreenLogoLoader /> : null}
        </div>
      </section>
    </>
  );
}

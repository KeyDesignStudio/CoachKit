'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { Icon } from '@/components/ui/Icon';
import { SelectField } from '@/components/ui/SelectField';
import { Block } from '@/components/ui/Block';
import { BlockTitle } from '@/components/ui/BlockTitle';
import { FieldLabel } from '@/components/ui/FieldLabel';
import { tokens } from '@/components/ui/tokens';
import { getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';
import { cn } from '@/lib/cn';
import { addDays, formatDisplayInTimeZone, toDateInput } from '@/lib/client-date';
import { FullScreenLogoLoader } from '@/components/FullScreenLogoLoader';
import { formatKcal } from '@/lib/calendar/discipline-summary';

type TimeRangePreset = 'LAST_7' | 'LAST_14' | 'LAST_30';

type AthleteDashboardResponse = {
  attention: {
    pendingConfirmation: number;
    workoutsMissed: number;
    painFlagWorkouts?: number;
  };
  rangeSummary: {
    fromDayKey: string;
    toDayKey: string;
    totals: {
      plannedMinutes: number;
      completedMinutes: number;
      plannedDistanceKm: number;
      completedDistanceKm: number;
      plannedCaloriesKcal: number | null;
      completedCaloriesKcal: number;
      workoutsPlanned: number;
      workoutsCompleted: number;
      workoutsSkipped: number;
      workoutsMissed: number;
    };
    byDiscipline: Array<{
      discipline: string;
      plannedMinutes: number;
      completedMinutes: number;
      plannedDistanceKm: number;
      completedDistanceKm: number;
      plannedCaloriesKcal: number | null;
      completedCaloriesKcal: number;
    }>;
    caloriesByDay: Array<{ dayKey: string; completedCaloriesKcal: number; plannedCaloriesKcal: number | null }>;
  };
  nextUp: Array<{
    id: string;
    date: string;
    title: string | null;
    discipline: string | null;
    plannedStartTimeLocal: string | null;
  }>;
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
        : 'bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text)]';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-2xl text-left min-h-[56px]',
        tokens.spacing.containerPadding,
        'transition-colors',
        tone === 'neutral' ? 'hover:bg-[var(--bg-surface)]' : '',
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

function formatCalories(kcal: number | null): string {
  if (kcal == null) return '—';
  return formatKcal(kcal).replace(' kcal', 'kcal');
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
                    showHeaderDivider={false}
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
                  showHeaderDivider={false}
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
                          data-testid="athlete-dashboard-time-range"
                        >
                          <option value="LAST_7">Last 7 days</option>
                          <option value="LAST_14">Last 14 days</option>
                          <option value="LAST_30">Last 30 days</option>
                        </SelectField>
                      </div>

                      <div className="min-w-0 col-start-2 row-start-2">
                        <FieldLabel className="pl-1">&nbsp;</FieldLabel>
                        <div
                          className={cn("min-h-[44px] flex items-center justify-center rounded-2xl px-3 min-w-0 bg-[var(--bg-structure)]/75")}
                          data-testid="athlete-dashboard-range-display"
                        >
                          <div className={cn("truncate", tokens.typography.body)}>
                            {formatDisplayInTimeZone(dateRange.from, athleteTimeZone)} → {formatDisplayInTimeZone(dateRange.to, athleteTimeZone)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Refresh removed as data auto-reloads */}
                </Block>
              </div>

              {/* Column 3: At a glance (stacks vertically); on tablet sits below and spans full width */}
              <div className="min-w-0 order-3 md:order-3 md:col-span-2 xl:col-span-1">
                <div
                  className="rounded-2xl bg-[var(--bg-card)] p-3 min-h-0 flex flex-col"
                  data-testid="athlete-dashboard-at-a-glance"
                  style={xlTopCardHeightPx ? { minHeight: `${xlTopCardHeightPx}px` } : undefined}
                >
                  <div className="flex items-end justify-between gap-3 mb-2">
                    <BlockTitle>At a glance</BlockTitle>
                    <div className="text-xs text-[var(--muted)]">In this range</div>
                  </div>

                  <div
                    className={cn("grid grid-cols-1 items-start min-[520px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] min-[520px]:items-center min-w-0", tokens.spacing.widgetGap)}
                    data-testid="athlete-dashboard-at-a-glance-grid"
                  >
                    {/* Left: stats */}
                    <div className={cn("min-w-0 rounded-2xl bg-[var(--bg-structure)]/40", tokens.spacing.elementPadding)} data-testid="athlete-dashboard-at-a-glance-stats">
                      <div className={cn("grid", tokens.spacing.widgetGap)}>
                        {[
                          { label: 'WORKOUTS COMPLETED', value: String(data?.rangeSummary?.totals.workoutsCompleted ?? 0) },
                          { label: 'WORKOUTS MISSED', value: String(data?.rangeSummary?.totals.workoutsMissed ?? 0) },
                          { label: 'TOTAL TRAINING TIME', value: formatMinutes(data?.rangeSummary?.totals.completedMinutes ?? 0) },
                          { label: 'TOTAL DISTANCE', value: formatDistanceKm(data?.rangeSummary?.totals.completedDistanceKm ?? 0) },
                        ].map((row, idx) => (
                          <div
                            key={row.label}
                            className={cn(
                              'min-w-0 flex items-baseline justify-between py-2',
                              tokens.spacing.widgetGap,
                              idx < 3 ? 'border-b border-[var(--border-subtle)]' : ''
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
                          const rows = (data?.rangeSummary?.byDiscipline ?? []).map((row) => ({
                            discipline: row.discipline,
                            totalMinutes: row.completedMinutes,
                            totalDistanceKm: row.completedDistanceKm,
                          }));
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

                                    <div className="h-2 rounded-full bg-[var(--bar-track)] overflow-hidden">
                                      <div className="h-full rounded-full bg-[var(--bar-fill)]" style={{ width: `${Math.round(pct * 100)}%` }} />
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

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="athlete-dashboard-range-panels">
              <Block title="Planned vs Completed" showHeaderDivider={false} className="min-h-[280px]" data-testid="athlete-range-planned-card">
                {(() => {
                  const summary = data?.rangeSummary;
                  const plannedTotal = summary?.totals.plannedMinutes ?? 0;
                  const completedTotal = summary?.totals.completedMinutes ?? 0;
                  const plannedLabel = formatMinutes(plannedTotal);
                  const completedLabel = formatMinutes(completedTotal);
                  const percent = plannedTotal > 0 ? Math.min(100, Math.round((completedTotal / plannedTotal) * 100)) : 0;
                  const rows = (summary?.byDiscipline ?? []).filter((row) => row.plannedMinutes > 0 || row.completedMinutes > 0);

                  return (
                    <div className="flex h-full flex-col gap-4">
                      <div className="flex flex-col gap-1" data-testid="athlete-range-summary-primary">
                        {plannedTotal > 0 ? (
                          <>
                            <div className="text-sm text-[var(--muted)]">Completed {completedLabel} of Planned {plannedLabel}</div>
                            <div className="text-xs text-[var(--muted)]">{percent}% of plan</div>
                          </>
                        ) : completedTotal > 0 ? (
                          <>
                            <div className="text-sm text-[var(--muted)]">Completed {completedLabel}</div>
                            <div className="text-xs text-[var(--muted)]">No planned sessions in this range</div>
                          </>
                        ) : (
                          <div className="text-sm text-[var(--muted)]">No planned sessions in this range</div>
                        )}
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="h-2 rounded-full bg-[var(--bar-track)] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[var(--bar-fill)] transition-[width] duration-200"
                            style={{ width: plannedTotal > 0 ? `${percent}%` : completedTotal > 0 ? '100%' : '0%' }}
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 min-h-[120px]">
                        {rows.length === 0 ? (
                          <div className="text-xs text-[var(--muted)]">No sessions logged for this range.</div>
                        ) : (
                          rows.map((row) => {
                            const rowPlanned = formatMinutes(row.plannedMinutes);
                            const rowCompleted = formatMinutes(row.completedMinutes);
                            const label = row.discipline.toUpperCase();
                            return (
                              <div key={row.discipline} className="flex items-center justify-between gap-3 text-xs">
                                <span className="font-medium text-[var(--text)] truncate">{label}</span>
                                <span className="tabular-nums text-[var(--muted)]">
                                  {row.plannedMinutes > 0 ? `${rowCompleted} / ${rowPlanned}` : rowCompleted}
                                </span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })()}
              </Block>

              <Block title="Calories" showHeaderDivider={false} className="min-h-[280px]" data-testid="athlete-range-calories-card">
                {(() => {
                  const summary = data?.rangeSummary;
                  const completedCalories = summary?.totals.completedCaloriesKcal ?? 0;
                  const plannedCalories = summary?.totals.plannedCaloriesKcal ?? null;
                  const points = summary?.caloriesByDay ?? [];
                  const maxCalories = Math.max(1, ...points.map((p) => p.completedCaloriesKcal));

                  return (
                    <div className="flex h-full flex-col gap-4">
                      <div className="flex flex-col gap-1">
                        <div className="text-sm text-[var(--muted)]">Completed {formatCalories(completedCalories)}</div>
                        <div className="text-xs text-[var(--muted)]">Planned {formatCalories(plannedCalories)}</div>
                      </div>

                      <div className="flex min-h-[140px] items-end gap-1 rounded-2xl bg-[var(--bg-structure)]/40 p-3">
                        {points.length === 0 ? (
                          <div className="text-xs text-[var(--muted)]">No calorie data in this range.</div>
                        ) : (
                          points.map((point) => {
                            const height = Math.max(4, Math.round((point.completedCaloriesKcal / maxCalories) * 100));
                            return (
                              <div key={point.dayKey} className="flex h-full flex-1 items-end">
                                <div
                                  className="w-full rounded-full bg-[var(--bar-fill)]/70"
                                  style={{ height: `${height}%` }}
                                  title={`${formatDisplayInTimeZone(point.dayKey, athleteTimeZone)} · ${formatCalories(point.completedCaloriesKcal)}`}
                                />
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })()}
              </Block>

              <Block title="Next up" showHeaderDivider={false} className="min-h-[280px]" data-testid="athlete-range-nextup-card">
                {(() => {
                  const sessions = data?.nextUp ?? [];

                  if (sessions.length === 0) {
                    return <div className="text-sm text-[var(--muted)]">No planned sessions in this range.</div>;
                  }

                  return (
                    <div className="flex flex-col gap-3">
                      {sessions.map((session) => {
                        const theme = getDisciplineTheme(session.discipline);
                        const dayLabel = formatDisplayInTimeZone(session.date, athleteTimeZone);
                        const timeLabel = session.plannedStartTimeLocal ?? 'Anytime';
                        return (
                          <div key={session.id} className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-structure)]/40 p-3">
                            <div className="flex min-w-0 items-start gap-2">
                              <Icon name={theme.iconName} size="sm" className={theme.textClass} aria-hidden />
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-[var(--text)] truncate">{session.title || 'Planned session'}</div>
                                <div className="text-xs text-[var(--muted)] truncate">{dayLabel} · {timeLabel}</div>
                              </div>
                            </div>
                            <div className="text-xs uppercase tracking-wide text-[var(--muted)]">
                              {(session.discipline || 'Other').toUpperCase()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </Block>
            </div>

          {error ? <div className="mt-4 rounded-2xl bg-rose-500/10 text-rose-700 p-4 text-sm">{error}</div> : null}
          {loading && !data ? <FullScreenLogoLoader /> : null}
        </div>
      </section>
    </>
  );
}

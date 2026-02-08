'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { SelectField } from '@/components/ui/SelectField';
import { Block } from '@/components/ui/Block';
import { FieldLabel } from '@/components/ui/FieldLabel';
import { tokens } from '@/components/ui/tokens';
import { getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';
import { cn } from '@/lib/cn';
import { addDays, formatDisplayInTimeZone, toDateInput } from '@/lib/client-date';
import { FullScreenLogoLoader } from '@/components/FullScreenLogoLoader';
import { formatKcal } from '@/lib/calendar/discipline-summary';

type TimeRangePreset = 'LAST_7' | 'LAST_14' | 'LAST_30';

type AthleteDashboardResponse = {
  rangeSummary: {
    fromDayKey: string;
    toDayKey: string;
    totals: {
      plannedMinutes: number;
      completedMinutes: number;
      completedCaloriesKcal: number;
      completedCaloriesMethod: 'actual' | 'estimated' | 'mixed';
      completedCaloriesEstimatedCount: number;
    };
    byDiscipline: Array<{
      discipline: string;
      plannedMinutes: number;
      completedMinutes: number;
    }>;
    caloriesByDay: Array<{
      dayKey: string;
      completedCaloriesKcal: number;
      sessions: Array<{
        id?: string;
        title?: string | null;
        discipline: string;
        caloriesKcal: number;
        caloriesEstimated?: boolean;
      }>;
    }>;
  };
};

function formatMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
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

  const [data, setData] = useState<AthleteDashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    [dateRange.from, dateRange.to, request, user?.role, user?.userId]
  );

  useEffect(() => {
    if (user?.role === 'ATHLETE') {
      void reload();
    }
  }, [reload, user?.role]);

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
          <Block title="Time range" showHeaderDivider={false}>
            <div className={cn("grid grid-cols-1 gap-4 min-w-0 sm:grid-cols-2", tokens.spacing.gridGap)}>
              <div className="min-w-0">
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

              <div className="min-w-0">
                <FieldLabel className="pl-1">Dates</FieldLabel>
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
          </Block>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3" data-testid="athlete-dashboard-chart-grid">
          <Block
            title="Calories"
            showHeaderDivider={false}
            className="min-h-[280px] xl:col-start-1"
            data-testid="athlete-dashboard-calories-chart"
          >
            {(() => {
              const summary = data?.rangeSummary;
              const points = summary?.caloriesByDay ?? [];
              const totalCalories = summary?.totals.completedCaloriesKcal ?? 0;
              const maxCalories = Math.max(1, ...points.map((point) => point.completedCaloriesKcal));

              const buildTooltip = (point: typeof points[number]) => {
                const dateLabel = formatDisplayInTimeZone(point.dayKey, athleteTimeZone);
                const header = `${dateLabel} · ${formatCalories(point.completedCaloriesKcal)}`;
                if (point.sessions.length === 0) return `${header}\nNo completed sessions`;

                const map = new Map<string, { calories: number; estimated: boolean }>();
                point.sessions.forEach((session) => {
                  const key = session.discipline.toUpperCase();
                  const existing = map.get(key) ?? { calories: 0, estimated: false };
                  existing.calories += session.caloriesKcal;
                  existing.estimated = existing.estimated || Boolean(session.caloriesEstimated);
                  map.set(key, existing);
                });

                const lines = Array.from(map.entries()).map(([discipline, row]) => {
                  const label = `${discipline} · ${formatCalories(row.calories)}`;
                  return row.estimated ? `${label} (est.)` : label;
                });

                return [header, ...lines].join('\n');
              };

              return (
                <div className="flex h-full flex-col gap-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-sm text-[var(--muted)]">Total {formatCalories(totalCalories)}</div>
                    <div className="text-xs text-[var(--muted)]">In this range</div>
                  </div>

                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-structure)]/40 p-4">
                    <div className="flex h-[180px] items-end gap-1" aria-label="Calories per day">
                      {points.map((point) => {
                        const heightPct = maxCalories > 0 ? Math.round((point.completedCaloriesKcal / maxCalories) * 100) : 0;
                        return (
                          <div key={point.dayKey} className="flex-1 min-w-[8px] flex flex-col items-center gap-2" title={buildTooltip(point)}>
                            <div className="w-full flex items-end justify-center h-[140px]">
                              <div
                                className="w-3 sm:w-4 rounded-full bg-[var(--bar-fill)]"
                                style={{ height: `${heightPct}%`, minHeight: point.completedCaloriesKcal > 0 ? '6px' : '0' }}
                              />
                            </div>
                            <div className="text-[10px] text-[var(--muted)] tabular-nums">
                              {point.dayKey.slice(8)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}
          </Block>

          <Block
            title="Planned vs Completed"
            showHeaderDivider={false}
            className="min-h-[280px] xl:col-start-2"
            data-testid="athlete-dashboard-compliance-chart"
          >
            {(() => {
              const summary = data?.rangeSummary;
              const plannedTotal = summary?.totals.plannedMinutes ?? 0;
              const completedTotal = summary?.totals.completedMinutes ?? 0;
              const percent = plannedTotal > 0 ? Math.min(100, Math.round((completedTotal / plannedTotal) * 100)) : 0;
              const rows = (summary?.byDiscipline ?? []).filter((row) => row.plannedMinutes > 0 || row.completedMinutes > 0);

              return (
                <div className="flex h-full flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    {plannedTotal > 0 ? (
                      <>
                        <div className="text-lg font-semibold text-[var(--text)]">{percent}% complete</div>
                        <div className="text-sm text-[var(--muted)]">
                          Completed {formatMinutes(completedTotal)} of {formatMinutes(plannedTotal)} planned
                        </div>
                      </>
                    ) : completedTotal > 0 ? (
                      <>
                        <div className="text-lg font-semibold text-[var(--text)]">No planned sessions in this range</div>
                        <div className="text-sm text-[var(--muted)]">Completed {formatMinutes(completedTotal)}</div>
                      </>
                    ) : (
                      <div className="text-lg font-semibold text-[var(--text)]">No planned sessions in this range</div>
                    )}
                  </div>

                  <div className="h-3 rounded-full bg-[var(--bar-track)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--bar-fill)] transition-[width] duration-200"
                      style={{ width: plannedTotal > 0 ? `${percent}%` : completedTotal > 0 ? '100%' : '0%' }}
                    />
                  </div>

                  <div className="flex flex-col gap-3">
                    {rows.length === 0 ? (
                      <div className="text-xs text-[var(--muted)]">No sessions logged for this range.</div>
                    ) : (
                      rows.map((row) => {
                        const planned = row.plannedMinutes;
                        const completed = row.completedMinutes;
                        const denom = planned > 0 ? planned : completed > 0 ? completed : 1;
                        const pct = Math.max(0, Math.min(100, Math.round((completed / denom) * 100)));
                        const label = row.discipline.toUpperCase();
                        const detail = planned > 0 ? `${formatMinutes(completed)} / ${formatMinutes(planned)}` : formatMinutes(completed);
                        return (
                          <div key={row.discipline} className="flex flex-col gap-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-[var(--text)] truncate">{label}</span>
                              <span className="tabular-nums text-[var(--muted)]">{detail}</span>
                            </div>
                            <div className="h-2 rounded-full bg-[var(--bar-track)] overflow-hidden">
                              <div className="h-full rounded-full bg-[var(--bar-fill)]" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })()}
          </Block>
        </div>

        {error ? <div className="mt-4 rounded-2xl bg-rose-500/10 text-rose-700 p-4 text-sm">{error}</div> : null}
        {loading && !data ? <FullScreenLogoLoader /> : null}
      </section>
    </>
  );
}

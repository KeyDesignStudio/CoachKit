'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { SelectField } from '@/components/ui/SelectField';
import { Block } from '@/components/ui/Block';
import { FieldLabel } from '@/components/ui/FieldLabel';
import { AtAGlanceCard } from '@/components/dashboard/AtAGlanceCard';
import { StravaVitalsSummaryCard } from '@/components/dashboard/StravaVitalsSummaryCard';
import { tokens } from '@/components/ui/tokens';
import { getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';
import { cn } from '@/lib/cn';
import { addDays, formatDisplayInTimeZone, toDateInput } from '@/lib/client-date';
import { FullScreenLogoLoader } from '@/components/FullScreenLogoLoader';
import { formatKcal } from '@/lib/calendar/discipline-summary';
import type { StravaVitalsComparison } from '@/lib/strava-vitals';
import type { GoalCountdown } from '@/lib/goal-countdown';
import { GoalCountdownCallout } from '@/components/goal/GoalCountdownCallout';
import { Button } from '@/components/ui/Button';

type TimeRangePreset = 'LAST_7' | 'LAST_14' | 'LAST_30' | 'LAST_60' | 'LAST_90' | 'THIS_MONTH' | 'LAST_MONTH' | 'CUSTOM';

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
      completedCaloriesMethod: 'actual' | 'estimated' | 'mixed';
      completedCaloriesEstimatedCount: number;
      workoutsPlanned: number;
      workoutsCompleted: number;
      workoutsSkipped: number;
      workoutsMissed: number;
    };
    byDiscipline: Array<{
      discipline: string;
      plannedWorkouts: number;
      completedWorkouts: number;
      plannedMinutes: number;
      completedMinutes: number;
      plannedDistanceKm: number;
      completedDistanceKm: number;
      plannedCaloriesKcal: number | null;
      completedCaloriesKcal: number;
    }>;
    caloriesByDiscipline: Array<{ discipline: string; completedCaloriesKcal: number }>;
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
  nextUp: Array<{
    id: string;
    date: string;
    title: string | null;
    discipline: string | null;
    plannedStartTimeLocal: string | null;
  }>;
  stravaVitals: StravaVitalsComparison;
  goalCountdown: GoalCountdown | null;
};

type AthleteIntakeLifecycleResponse = {
  openDraftIntake?: { id?: string | null; createdAt?: string | null } | null;
  latestSubmittedIntake?: { id?: string | null; createdAt?: string | null } | null;
  reminderTracking?: {
    requestedAt?: string | null;
    lastReminderAt?: string | null;
    remindersSent?: number;
    nextReminderDueAt?: string | null;
    isReminderDue?: boolean;
  } | null;
  lifecycle?: {
    hasOpenRequest?: boolean;
  } | null;
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
      <div className={cn('flex items-center justify-between', tokens.spacing.blockRowGap)}>
        <div className={cn('font-medium', tokens.typography.body)}>{label}</div>
        <div className={cn('font-semibold tabular-nums', tokens.typography.h1, tone === 'danger' ? 'text-rose-700' : '')}>{count}</div>
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
  return formatKcal(kcal);
}

function getDateRangeFromPreset(preset: TimeRangePreset, athleteTimeZone: string, customFrom: string, customTo: string) {
  const todayKey = getZonedDateKeyForNow(athleteTimeZone);
  const todayUtcMidnight = new Date(`${todayKey}T00:00:00.000Z`);
  if (preset === 'CUSTOM') {
    return { from: customFrom || todayKey, to: customTo || todayKey };
  }

  if (preset === 'THIS_MONTH') {
    const from = `${todayKey.slice(0, 7)}-01`;
    return { from, to: todayKey };
  }

  if (preset === 'LAST_MONTH') {
    const year = Number(todayKey.slice(0, 4));
    const month = Number(todayKey.slice(5, 7));
    const currentMonthStartUtc = new Date(Date.UTC(year, month - 1, 1));
    const lastMonthStartUtc = new Date(Date.UTC(year, month - 2, 1));
    const lastMonthEndUtc = addDays(currentMonthStartUtc, -1);
    return { from: toDateInput(lastMonthStartUtc), to: toDateInput(lastMonthEndUtc) };
  }

  const days =
    preset === 'LAST_90' ? 90 : preset === 'LAST_60' ? 60 : preset === 'LAST_30' ? 30 : preset === 'LAST_14' ? 14 : 7;
  const from = toDateInput(addDays(todayUtcMidnight, -(days - 1)));
  const to = toDateInput(todayUtcMidnight);
  return { from, to };
}

function getNowPartsInTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? NaN);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
  };
}

function getHoursUntilSession(
  nextSession: AthleteDashboardResponse['nextUp'][number] | null | undefined,
  timeZone: string
): number | null {
  if (!nextSession) return null;
  const dateMatch = String(nextSession.date ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const timeMatch = String(nextSession.plannedStartTimeLocal ?? '').match(/^(\d{2}):(\d{2})/);
  const hour = timeMatch ? Number(timeMatch[1]) : 9;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;
  const now = getNowPartsInTimeZone(timeZone);

  if (![year, month, day, hour, minute, now.year, now.month, now.day, now.hour, now.minute].every(Number.isFinite)) {
    return null;
  }

  const targetMs = Date.UTC(year, month - 1, day, hour, minute);
  const nowMs = Date.UTC(now.year, now.month - 1, now.day, now.hour, now.minute);
  const diffMs = targetMs - nowMs;
  return Math.max(0, Math.ceil(diffMs / (60 * 60 * 1000)));
}

function formatNextSessionLabel(nextSession: AthleteDashboardResponse['nextUp'][number] | null | undefined): string {
  const fromTitle = String(nextSession?.title ?? '').trim();
  if (fromTitle) {
    return /\bsession\b/i.test(fromTitle) ? fromTitle : `${fromTitle} session`;
  }

  const discipline = String(nextSession?.discipline ?? '').trim().toLowerCase();
  if (discipline) return `${discipline} session`;
  return 'training session';
}

export default function AthleteDashboardConsolePage() {
  const { user, loading: userLoading, error: userError } = useAuthUser();
  const { request } = useApi();
  const router = useRouter();

  const [timeRange, setTimeRange] = useState<TimeRangePreset>('LAST_30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [discipline, setDiscipline] = useState<string | null>(null);
  const [showLoadPanel, setShowLoadPanel] = useState(false);

  const [data, setData] = useState<AthleteDashboardResponse | null>(null);
  const [trainingRequestLifecycle, setTrainingRequestLifecycle] = useState<AthleteIntakeLifecycleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const needsCardRef = useRef<HTMLDivElement | null>(null);
  const [xlTopCardHeightPx, setXlTopCardHeightPx] = useState<number | null>(null);

  const athleteTimeZone = user?.timezone ?? 'UTC';
  const dateRange = useMemo(
    () => getDateRangeFromPreset(timeRange, athleteTimeZone, customFrom, customTo),
    [timeRange, athleteTimeZone, customFrom, customTo]
  );

  const reload = useCallback(
    async (bypassCache = false) => {
      if (!user?.userId || user.role !== 'ATHLETE') return;

      setLoading(true);
      setError('');

      const qs = new URLSearchParams();
      qs.set('from', dateRange.from);
      qs.set('to', dateRange.to);
      if (discipline) qs.set('discipline', discipline);
      if (showLoadPanel) qs.set('includeLoadModel', '1');
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
    [dateRange.from, dateRange.to, discipline, request, showLoadPanel, user?.role, user?.userId]
  );

  const reloadTrainingRequestLifecycle = useCallback(async () => {
    if (!user?.userId || user.role !== 'ATHLETE') return;
    try {
      const lifecycle = await request<AthleteIntakeLifecycleResponse>('/api/athlete/ai-plan/intake/latest', { cache: 'no-store' });
      setTrainingRequestLifecycle(lifecycle ?? null);
    } catch {
      setTrainingRequestLifecycle(null);
    }
  }, [request, user?.role, user?.userId]);

  useEffect(() => {
    if (user?.role === 'ATHLETE') {
      void reload();
      void reloadTrainingRequestLifecycle();
    }
  }, [reload, reloadTrainingRequestLifecycle, user?.role]);

  useEffect(() => {
    if (user?.role !== 'ATHLETE') return;
    const timer = setInterval(() => {
      void reloadTrainingRequestLifecycle();
    }, 60_000);
    return () => clearInterval(timer);
  }, [reloadTrainingRequestLifecycle, user?.role]);

  const hasOpenTrainingRequest = Boolean(trainingRequestLifecycle?.lifecycle?.hasOpenRequest ?? trainingRequestLifecycle?.openDraftIntake?.id);
  const athleteGreeting = useMemo(() => {
    const preferredName = String(user?.name ?? 'Athlete').trim().split(/\s+/)[0] || 'Athlete';
    const nextSession = data?.nextUp?.[0] ?? null;

    if (!nextSession) {
      return `G'day ${preferredName}! No upcoming sessions scheduled.`;
    }

    const sessionLabel = formatNextSessionLabel(nextSession);
    const hoursUntil = getHoursUntilSession(nextSession, athleteTimeZone);
    if (hoursUntil == null) {
      return `G'day ${preferredName}! You've got your next ${sessionLabel} coming up soon.`;
    }

    return `G'day ${preferredName}! You've got your next ${sessionLabel} in ${hoursUntil} ${hoursUntil === 1 ? 'hour' : 'hours'}.`;
  }, [athleteTimeZone, data?.nextUp, user?.name]);

  useEffect(() => {
    if (user?.role === 'COACH') {
      router.replace('/coach/dashboard');
    } else if (user?.role === 'ADMIN') {
      router.replace('/admin/ai-usage');
    }
  }, [router, user?.role]);

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
  if (userLoading || (!user && !userError)) {
    return <FullScreenLogoLoader />;
  }

  if (!user || user.role !== 'ATHLETE') {
    return (
      <div className={cn(tokens.spacing.screenPadding, 'pt-6')}>
        <p className={tokens.typography.bodyMuted}>
          {userError ? 'We could not load your account yet. Please refresh.' : 'Redirecting...'}
        </p>
      </div>
    );
  }

  return (
    <>
      <section className={cn(tokens.spacing.screenPadding, 'pb-10')}>
        <div className="pt-3 md:pt-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className={tokens.typography.h1}>Athlete Console</h1>
            <span className={cn(tokens.typography.h1, 'text-[var(--muted)]')} aria-hidden>
              |
            </span>
            <p className={cn(tokens.typography.h1, 'text-[var(--muted)]')}>{athleteGreeting}</p>
          </div>
        </div>

        {hasOpenTrainingRequest ? (
          <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-amber-900">Complete your Training Request</div>
                <div className="mt-1 text-xs text-amber-900/90">
                  {String(user?.name ?? '').trim() ? `${String(user?.name).trim().split(/\s+/)[0]}, ` : ''}
                  this is the primary step to unlock your next training block from your coach.
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-amber-900/90">
                  <span>
                    Requested:{' '}
                    {trainingRequestLifecycle?.reminderTracking?.requestedAt
                      ? new Date(String(trainingRequestLifecycle.reminderTracking.requestedAt)).toLocaleString()
                      : trainingRequestLifecycle?.openDraftIntake?.createdAt
                        ? new Date(String(trainingRequestLifecycle.openDraftIntake.createdAt)).toLocaleString()
                        : 'Recently'}
                  </span>
                  <span>
                    Reminders: {Math.max(0, Number(trainingRequestLifecycle?.reminderTracking?.remindersSent ?? 0))}
                  </span>
                  <span>
                    {trainingRequestLifecycle?.reminderTracking?.nextReminderDueAt
                      ? `Next reminder ${
                          trainingRequestLifecycle?.reminderTracking?.isReminderDue ? 'due now' : `due ${new Date(String(trainingRequestLifecycle.reminderTracking.nextReminderDueAt)).toLocaleString()}`
                        }`
                      : 'Reminder schedule active'}
                  </span>
                </div>
              </div>
              <div className="flex-shrink-0">
                <Button type="button" className="min-h-[44px]" onClick={() => router.push('/athlete/training-request' as never)}>
                  Complete Training Request
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {data?.goalCountdown?.mode && data.goalCountdown.mode !== 'none' ? (
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-3">
            <GoalCountdownCallout
              goal={data.goalCountdown}
              variant="hero"
              className="ring-0 border border-[#cad7eb] bg-[#e9eef8]/85 lg:col-start-3 lg:w-full"
            />
          </div>
        ) : null}

        <div className="mt-4">
          <div className={cn('grid grid-cols-1 min-w-0 items-start min-[900px]:grid-cols-2 xl:grid-cols-3', tokens.spacing.gridGap)}>
            <div className="min-w-0 order-2 md:order-2">
              <div ref={needsCardRef}>
                <Block title="Needs your attention" rightAction={<div className={tokens.typography.meta}>Tap to open calendar</div>} showHeaderDivider={false}>
                  <div className={cn('grid', tokens.spacing.widgetGap)}>
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

            <div className="min-w-0 order-1 md:order-1">
              <Block
                title="Make your selection"
                className="flex flex-col"
                style={xlTopCardHeightPx ? { height: `${xlTopCardHeightPx}px` } : undefined}
                showHeaderDivider={false}
              >
                <div className="-mt-2">
                  <div className={cn('grid grid-cols-1 gap-y-4 min-w-0 min-[900px]:grid-cols-2 min-[900px]:gap-y-6 min-[900px]:gap-x-4', tokens.spacing.gridGap)}>
                    <div className="min-w-0 min-[900px]:col-start-1 min-[900px]:row-start-1">
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
                    <div className="hidden min-w-0 min-[900px]:block min-[900px]:col-start-2 min-[900px]:row-start-1" aria-hidden="true" />

                    <div className="min-w-0 min-[900px]:col-start-1 min-[900px]:row-start-2">
                      <FieldLabel className="pl-1">Time range</FieldLabel>
                      <SelectField
                        className="min-h-[44px] w-full"
                        value={timeRange}
                        onChange={(e) => setTimeRange(e.target.value as TimeRangePreset)}
                        data-testid="athlete-dashboard-time-range"
                      >
                        <option value="LAST_30">Last 30 days</option>
                        <option value="LAST_60">Last 60 days</option>
                        <option value="LAST_90">Last 90 days</option>
                        <option value="THIS_MONTH">This month</option>
                        <option value="LAST_MONTH">Last month</option>
                        <option value="LAST_14">Last 14 days</option>
                        <option value="LAST_7">Last 7 days</option>
                        <option value="CUSTOM">Custom</option>
                      </SelectField>
                    </div>

                    <div className="min-w-0 min-[900px]:col-start-2 min-[900px]:row-start-2">
                      {timeRange === 'CUSTOM' ? (
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-xs text-[var(--muted)]">
                            From
                            <input
                              type="date"
                              className="mt-1 w-full min-h-[44px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)]"
                              value={customFrom}
                              onChange={(e) => setCustomFrom(e.target.value)}
                            />
                          </label>
                          <label className="text-xs text-[var(--muted)]">
                            To
                            <input
                              type="date"
                              className="mt-1 w-full min-h-[44px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)]"
                              value={customTo}
                              onChange={(e) => setCustomTo(e.target.value)}
                            />
                          </label>
                        </div>
                      ) : (
                        <>
                          <FieldLabel className="pl-1">&nbsp;</FieldLabel>
                          <div
                            className={cn(
                              'min-h-[44px] flex items-center justify-center rounded-2xl px-3 min-w-0 bg-[var(--bg-structure)]/75'
                            )}
                            data-testid="athlete-dashboard-range-display"
                          >
                            <div className={cn('md:truncate text-xs sm:text-sm', tokens.typography.body)}>
                              {formatDisplayInTimeZone(dateRange.from, athleteTimeZone)} →{' '}
                              {formatDisplayInTimeZone(dateRange.to, athleteTimeZone)}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </Block>
            </div>

            <div className="min-w-0 order-3 md:order-3 md:col-span-2 xl:col-span-1">
              <AtAGlanceCard
                minHeightPx={xlTopCardHeightPx ?? undefined}
                loading={loading && !data}
                testIds={{
                  card: 'athlete-dashboard-at-a-glance',
                  grid: 'athlete-dashboard-at-a-glance-grid',
                  stats: 'athlete-dashboard-at-a-glance-stats',
                  statRow: 'athlete-dashboard-at-a-glance-stat-row',
                  disciplineLoad: 'athlete-dashboard-discipline-load',
                }}
                statsRows={[
                  { label: 'WORKOUTS COMPLETED', value: String(data?.rangeSummary?.totals.workoutsCompleted ?? 0) },
                  { label: 'WORKOUTS MISSED', value: String(data?.rangeSummary?.totals.workoutsMissed ?? 0) },
                  { label: 'TOTAL TRAINING TIME', value: formatMinutes(data?.rangeSummary?.totals.completedMinutes ?? 0) },
                  { label: 'TOTAL DISTANCE', value: formatDistanceKm(data?.rangeSummary?.totals.completedDistanceKm ?? 0) },
                ]}
                disciplineRows={(() => {
                  const seedOrder = ['BIKE', 'RUN', 'SWIM', 'OTHER'] as const;
                  const byDiscipline = new Map<string, { totalMinutes: number; totalDistanceKm: number }>();
                  for (const row of data?.rangeSummary?.byDiscipline ?? []) {
                    byDiscipline.set(String(row.discipline || 'OTHER').toUpperCase(), {
                      totalMinutes: Number(row.completedMinutes ?? 0),
                      totalDistanceKm: Number(row.completedDistanceKm ?? 0),
                    });
                  }

                  return seedOrder.map((discipline) => {
                    const existing = byDiscipline.get(discipline);
                    const totalMinutes = existing?.totalMinutes ?? 0;
                    const totalDistanceKm = existing?.totalDistanceKm ?? 0;
                    return {
                      discipline,
                      totalMinutes,
                      rightValue: `${formatMinutes(totalMinutes)} · ${formatDistanceKm(totalDistanceKm)}`,
                    };
                  });
                })()}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3" data-testid="athlete-dashboard-chart-grid">
          <Block
            title="Planned vs Completed"
            showHeaderDivider={false}
            className="min-h-[280px]"
            data-testid="athlete-dashboard-compliance-chart"
          >
            {(() => {
              const summary = data?.rangeSummary;
              const plannedTotal = summary?.totals.workoutsPlanned ?? 0;
              const completedTotal = summary?.totals.workoutsCompleted ?? 0;
              const percent = plannedTotal > 0 ? Math.min(100, Math.round((completedTotal / plannedTotal) * 100)) : 0;
              const rows = (summary?.byDiscipline ?? []).filter((row) => row.plannedWorkouts > 0 || row.completedWorkouts > 0);

              return (
                <div className="flex h-full flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    {plannedTotal > 0 ? (
                      <>
                        <div className="text-lg font-semibold text-[var(--text)]">{percent}% complete</div>
                        <div className="text-sm text-[var(--muted)]">
                          Completed {completedTotal} of {plannedTotal} planned sessions
                        </div>
                      </>
                    ) : completedTotal > 0 ? (
                      <>
                        <div className="text-lg font-semibold text-[var(--text)]">No planned sessions in this range</div>
                        <div className="text-sm text-[var(--muted)]">Completed {completedTotal} sessions</div>
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
                        const planned = row.plannedWorkouts;
                        const completed = row.completedWorkouts;
                        const denom = planned > 0 ? planned : completed > 0 ? completed : 1;
                        const pct = Math.max(0, Math.min(100, Math.round((completed / denom) * 100)));
                        const label = row.discipline.toUpperCase();
                        const detail = planned > 0 ? `${completed} / ${planned}` : `${completed}`;
                        return (
                          <div key={row.discipline} className="flex flex-col gap-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-[var(--text)] md:truncate">{label}</span>
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

          <Block title="Calories" showHeaderDivider={false} className="min-h-[280px]" data-testid="athlete-dashboard-calories-chart">
            {(() => {
              const summary = data?.rangeSummary;
              const points = summary?.caloriesByDay ?? [];
              const totalCalories = summary?.totals.completedCaloriesKcal ?? 0;
              const maxCalories = Math.max(1, ...points.map((point) => point.completedCaloriesKcal));
              const axisStep = points.length <= 31 ? 1 : points.length <= 90 ? 7 : 14;

              const axisLabelForPoint = (point: (typeof points)[number], idx: number) => {
                const shouldShow = idx === 0 || idx === points.length - 1 || idx % axisStep === 0;
                if (!shouldShow) return '';
                if (points.length <= 31) return point.dayKey.slice(8);
                const d = new Date(`${point.dayKey}T00:00:00.000Z`);
                return new Intl.DateTimeFormat('en-AU', {
                  timeZone: athleteTimeZone,
                  day: '2-digit',
                  month: 'short',
                }).format(d);
              };

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
                    <div className="text-sm text-[var(--muted)]">Total {formatKcal(totalCalories)} burned</div>
                    <div className="text-xs text-[var(--muted)]">In this range</div>
                  </div>

                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-structure)]/40 p-4">
                    <div className="flex h-[180px] items-end gap-1" aria-label="Calories per day">
                      {points.map((point, idx) => {
                        const heightPct = maxCalories > 0 ? Math.round((point.completedCaloriesKcal / maxCalories) * 100) : 0;
                        const axisLabel = axisLabelForPoint(point, idx);
                        return (
                          <div key={point.dayKey} className="flex-1 min-w-[8px] flex flex-col items-center gap-2" title={buildTooltip(point)}>
                            <div className="w-full flex items-end justify-center h-[140px]">
                              <div
                                className="w-3 sm:w-4 rounded-full bg-[var(--bar-fill)]"
                                style={{ height: `${heightPct}%`, minHeight: point.completedCaloriesKcal > 0 ? '6px' : '0' }}
                              />
                            </div>
                            <div className="text-[10px] text-[var(--muted)] tabular-nums h-3 leading-none">
                              {axisLabel}
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

          <div className="xl:col-span-1">
            <StravaVitalsSummaryCard
              comparison={data?.stravaVitals ?? null}
              loading={loading && !data}
              title="Strava Vitals"
              showLoadPanel={showLoadPanel}
              onToggleLoadPanel={setShowLoadPanel}
            />
          </div>
        </div>

        {error ? <div className="mt-4 rounded-2xl bg-rose-500/10 text-rose-700 p-4 text-sm">{error}</div> : null}
        {loading && !data ? <FullScreenLogoLoader /> : null}
      </section>
    </>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { SelectField } from '@/components/ui/SelectField';
import { Block } from '@/components/ui/Block';
import { BlockTitle } from '@/components/ui/BlockTitle';
import { FieldLabel } from '@/components/ui/FieldLabel';
import { AthleteSelector } from '@/components/coach/AthleteSelector';
import { StravaVitalsSummaryCard } from '@/components/dashboard/StravaVitalsSummaryCard';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { addDays, formatDayMonthYearInTimeZone, formatDisplayInTimeZone, toDateInput } from '@/lib/client-date';
import { cn } from '@/lib/cn';
import { tokens } from '@/components/ui/tokens';
import { getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';
import { getWarmWelcomeMessage } from '@/lib/user-greeting';
import type { StravaVitalsComparison } from '@/lib/strava-vitals';
import type { GoalCountdown } from '@/lib/goal-countdown';

type TimeRangePreset = 'LAST_7' | 'LAST_14' | 'LAST_30' | 'CUSTOM';
type InboxPreset = 'ALL' | 'PAIN' | 'COMMENTS' | 'SKIPPED' | 'AWAITING_REVIEW';

type DashboardAthlete = {
  id: string;
  name: string | null;
  disciplines: string[];
};

type ReviewItem = {
  id: string;
  title: string;
  date: string;
  actionAt: string;
  discipline: string;
  plannedStartTimeLocal: string | null;
  plannedDurationMinutes: number | null;
  plannedDistanceKm: number | null;
  workoutDetail: string | null;
  status: string;
  latestCompletedActivity: {
    id: string;
    durationMinutes: number | null;
    distanceKm: number | null;
    painFlag: boolean;
    startTime: string;
  } | null;
  athlete: {
    id: string;
    name: string | null;
  } | null;
  hasAthleteComment: boolean;
  commentCount: number;
};

type DashboardResponse = {
  athletes: DashboardAthlete[];
  kpis: {
    workoutsCompleted: number;
    workoutsSkipped: number;
    totalTrainingMinutes: number;
    totalDistanceKm: number;
  };
  attention: {
    painFlagWorkouts: number;
    athleteCommentWorkouts: number;
    skippedWorkouts: number;
    awaitingCoachReview: number;
  };
  goalCountdowns: Array<{
    athleteId: string;
    athleteName: string | null;
    goalCountdown: GoalCountdown;
  }>;
  selectedGoalCountdown: {
    athleteId: string;
    athleteName: string | null;
    goalCountdown: GoalCountdown;
  } | null;
  disciplineLoad: Array<{ discipline: string; totalMinutes: number; totalDistanceKm: number }>;
  stravaVitals: StravaVitalsComparison;
  reviewInbox: ReviewItem[];
  reviewInboxPage: {
    offset: number;
    limit: number;
    hasMore: boolean;
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

function formatDistanceKm(km: number): string {
  const value = Number.isFinite(km) ? km : 0;
  if (value === 0) return '0km';
  if (value < 10) return `${value.toFixed(1)}km`;
  return `${Math.round(value)}km`;
}

function formatCalendarDayLabel(dateIso: string, timeZone: string): string {
  return formatDisplayInTimeZone(dateIso, timeZone);
}

function getDateRangeFromPreset(preset: TimeRangePreset, coachTimeZone: string, customFrom: string, customTo: string) {
  const todayKey = getZonedDateKeyForNow(coachTimeZone);
  const todayUtcMidnight = new Date(`${todayKey}T00:00:00.000Z`);

  if (preset === 'CUSTOM') {
    return { from: customFrom || todayKey, to: customTo || todayKey };
  }

  const days = preset === 'LAST_14' ? 14 : preset === 'LAST_30' ? 30 : 7;
  const from = toDateInput(addDays(todayUtcMidnight, -(days - 1)));
  const to = toDateInput(todayUtcMidnight);
  return { from, to };
}

function AttentionItem({
  label,
  count,
  tone,
  active,
  onClick,
}: {
  label: string;
  count: number;
  tone: 'danger' | 'primary' | 'neutral';
  active: boolean;
  onClick: () => void;
}) {
  const toneClasses =
    tone === 'danger'
      ? 'bg-rose-500/15 text-rose-700'
      : tone === 'primary'
        ? 'bg-blue-600/10 text-blue-700'
        : 'bg-[var(--bg-card)] text-[var(--text)]';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-2xl text-left min-h-[56px]',
        tokens.spacing.containerPadding,
        'transition-colors',
        active ? 'ring-2 ring-[var(--ring)]' : 'hover:bg-[var(--bg-surface)]',
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

function AlertStripItem({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-2xl text-left min-h-[56px]',
        tokens.spacing.containerPadding,
        'bg-[var(--bg-card)] border border-[var(--border-subtle)] transition-colors',
        active ? 'ring-2 ring-[var(--ring)]' : 'hover:bg-[var(--bg-surface)]'
      )}
    >
      <div className={cn('flex items-center justify-between', tokens.spacing.widgetGap)}>
        <div className={cn('font-medium', tokens.typography.body)}>{label}</div>
        <div className={cn('font-semibold tabular-nums', tokens.typography.h1)}>{count}</div>
      </div>
    </button>
  );
}

export default function CoachDashboardConsolePage() {
  const { user, loading: userLoading, error: userError } = useAuthUser();
  const { request } = useApi();
  const router = useRouter();
  const fallbackWelcomeMessage = useMemo(
    () => getWarmWelcomeMessage({ name: user?.name, timeZone: user?.timezone }),
    [user?.name, user?.timezone]
  );
  const [welcomeMessage, setWelcomeMessage] = useState(fallbackWelcomeMessage);
  const styledWelcome = useMemo(() => {
    const match = welcomeMessage.match(/^G'day\s+([^.]+)\.\s*(.*)$/i);
    if (!match) return { name: '', rest: welcomeMessage };
    return { name: String(match[1] ?? '').trim(), rest: String(match[2] ?? '').trim() };
  }, [welcomeMessage]);

  const [timeRange, setTimeRange] = useState<TimeRangePreset>('LAST_7');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<Set<string>>(() => new Set());
  const [discipline, setDiscipline] = useState<string | null>(null);
  const [inboxPreset, setInboxPreset] = useState<InboxPreset>('ALL');
  const [showLoadPanel, setShowLoadPanel] = useState(false);

  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reviewInboxRef = useRef<HTMLDivElement | null>(null);

  const needsCardRef = useRef<HTMLDivElement | null>(null);
  const [xlTopCardHeightPx, setXlTopCardHeightPx] = useState<number | null>(null);

  const coachTimeZone = user?.timezone ?? 'UTC';
  const athleteOptions = useMemo(
    () =>
      (data?.athletes ?? []).map((athlete) => ({
        userId: athlete.id,
        user: { id: athlete.id, name: athlete.name },
      })),
    [data?.athletes]
  );
  const selectedAthleteIdList = useMemo(() => Array.from(selectedAthleteIds), [selectedAthleteIds]);
  const allAthletesSelected =
    athleteOptions.length > 0 &&
    selectedAthleteIdList.length === athleteOptions.length &&
    selectedAthleteIdList.every((id) => athleteOptions.some((athlete) => athlete.userId === id));
  const singleSelectedAthleteId = selectedAthleteIdList.length === 1 ? selectedAthleteIdList[0] : null;
  const athleteScopeKey = useMemo(() => selectedAthleteIdList.slice().sort().join(','), [selectedAthleteIdList]);
  const dateRange = useMemo(() => getDateRangeFromPreset(timeRange, coachTimeZone, customFrom, customTo), [
    timeRange,
    coachTimeZone,
    customFrom,
    customTo,
  ]);

  useEffect(() => {
    if (athleteOptions.length === 0) return;
    if (selectedAthleteIds.size > 0) return;
    setSelectedAthleteIds(new Set(athleteOptions.map((athlete) => athlete.userId)));
  }, [athleteOptions, selectedAthleteIds.size]);

  const reload = useCallback(
    async (options?: { bypassCache?: boolean }) => {
      if (!user?.userId || user.role !== 'COACH') return;
      const bypassCache = options?.bypassCache ?? false;
      const inboxOffset = 0;

      setLoading(true);
      setError('');

      const qs = new URLSearchParams();
      qs.set('from', dateRange.from);
      qs.set('to', dateRange.to);
      qs.set('inboxLimit', '25');
      qs.set('inboxOffset', String(inboxOffset));
      if (selectedAthleteIdList.length > 0 && !allAthletesSelected) {
        qs.set('athleteIds', selectedAthleteIdList.join(','));
      }
      if (discipline) qs.set('discipline', discipline);
      if (showLoadPanel) qs.set('includeLoadModel', '1');
      if (bypassCache) qs.set('t', String(Date.now()));

      try {
        const resp = await request<DashboardResponse>(`/api/coach/dashboard/console?${qs.toString()}`, bypassCache ? { cache: 'no-store' } : undefined);
        setData(resp);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
      } finally {
        setLoading(false);
      }
    },
    [allAthletesSelected, dateRange.from, dateRange.to, discipline, request, selectedAthleteIdList, showLoadPanel, user?.role, user?.userId]
  );

  useEffect(() => {
    if (user?.role === 'COACH') {
      reload();
    }
  }, [reload, user?.role]);

  useEffect(() => {
    if (user?.role === 'ATHLETE') {
      router.replace('/athlete/dashboard');
    } else if (user?.role === 'ADMIN') {
      router.replace('/admin/ai-usage');
    }
  }, [router, user?.role]);

  // Keep the three top cards the same height at desktop (xl), using the Needs card as the baseline.
  // Note: this must initialize after the coach UI renders; during the loading gate the ref is null.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (userLoading) return;
    if (!user || user.role !== 'COACH') return;

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

  // If the global filters change, clear any inbox shortcut filter.
  useEffect(() => {
    setInboxPreset('ALL');
  }, [athleteScopeKey, dateRange.from, dateRange.to, discipline]);

  const disciplineOptions = useMemo(() => {
    const set = new Set<string>();
    (data?.athletes ?? []).forEach((a) => (a.disciplines ?? []).forEach((d) => set.add((d || '').toUpperCase())));
    ['BIKE', 'RUN', 'SWIM', 'OTHER'].forEach((d) => set.add(d));
    return Array.from(set)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [data?.athletes]);
  const visibleGoalCountdowns = useMemo(
    () =>
      (data?.goalCountdowns ?? [])
        .filter((entry) => entry.goalCountdown.mode !== 'none' && entry.goalCountdown.eventDate)
        .sort((a, b) => {
          const aDays = typeof a.goalCountdown.daysRemaining === 'number' ? a.goalCountdown.daysRemaining : Number.MAX_SAFE_INTEGER;
          const bDays = typeof b.goalCountdown.daysRemaining === 'number' ? b.goalCountdown.daysRemaining : Number.MAX_SAFE_INTEGER;
          if (aDays !== bDays) return aDays - bDays;
          const aName = String(a.athleteName ?? '');
          const bName = String(b.athleteName ?? '');
          return aName.localeCompare(bName);
        }),
    [data?.goalCountdowns]
  );

  const jumpToInbox = useCallback(() => {
    reviewInboxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const toggleInboxPreset = useCallback(
    (next: InboxPreset) => {
      setInboxPreset((prev) => (prev === next ? 'ALL' : next));
      jumpToInbox();
    },
    [jumpToInbox]
  );

  const coachGreetingContext = useMemo(() => {
    const completed = Math.max(0, Number(data?.kpis?.workoutsCompleted ?? 0));
    const skipped = Math.max(0, Number(data?.kpis?.workoutsSkipped ?? 0));
    const nextGoal = data?.selectedGoalCountdown?.goalCountdown?.eventName
      ? String(data.selectedGoalCountdown.goalCountdown.eventName)
      : '';
    return [
      `squad completed workouts: ${completed}`,
      `squad missed workouts: ${skipped}`,
      nextGoal ? `nearest athlete event: ${nextGoal}` : '',
    ]
      .filter(Boolean)
      .join('; ');
  }, [data?.kpis?.workoutsCompleted, data?.kpis?.workoutsSkipped, data?.selectedGoalCountdown?.goalCountdown?.eventName]);

  useEffect(() => {
    setWelcomeMessage(fallbackWelcomeMessage);
  }, [fallbackWelcomeMessage]);

  useEffect(() => {
    if (!user?.userId || user.role !== 'COACH') return;
    const qs = new URLSearchParams();
    if (coachGreetingContext) qs.set('context', coachGreetingContext);
    void request<{ greeting: string }>(`/api/me/greeting?${qs.toString()}`, { cache: 'no-store' })
      .then((resp) => {
        if (resp?.greeting) setWelcomeMessage(String(resp.greeting));
      })
      .catch(() => {
        setWelcomeMessage(fallbackWelcomeMessage);
      });
  }, [coachGreetingContext, fallbackWelcomeMessage, request, user?.role, user?.userId]);

  if (userLoading || (!user && !userError)) {
    return (
      <div className={cn(tokens.spacing.screenPadding, "pt-6")}>
        <p className={cn(tokens.typography.bodyMuted)}>Loading...</p>
      </div>
    );
  }

  if (!user || user.role !== 'COACH') {
    return (
      <div className={cn(tokens.spacing.screenPadding, "pt-6")}>
        <p className={tokens.typography.bodyMuted}>
          {userError ? 'We could not load your account yet. Please refresh.' : 'Redirecting...'}
        </p>
      </div>
    );
  }

  return (
    <>
      <section className={cn(tokens.spacing.screenPadding, "pb-10")}>
        <div className={cn("pt-3 md:pt-6")}>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            <h1 className={tokens.typography.h1}>Coach Console</h1>
            <span className="hidden h-5 w-px bg-[var(--border-subtle)] md:inline-block" aria-hidden />
            <p className="flex items-end gap-1 text-sm font-normal leading-tight text-[var(--fg-muted)] md:text-base">
              <span className="italic">G&apos;day</span>
              {styledWelcome.name ? <span className="text-[var(--text)]">{styledWelcome.name}.</span> : null}
              <span className="font-normal">{styledWelcome.rest || welcomeMessage}</span>
            </p>
          </div>
        </div>

        {/* Top grid shell: mobile 1 col (Filters → Needs → At a glance), tablet 2 cols (Needs + Filters, then At a glance), desktop 3 cols */}
        <div className={cn("mt-3 grid grid-cols-1 min-w-0 items-start md:mt-4 md:grid-cols-2 xl:grid-cols-3", tokens.spacing.gridGap)}>
          {/* Column 1: Needs your attention */}
          <div className="min-w-0 order-2 md:order-2">
            <div ref={needsCardRef}>
              <Block
                title="Needs your attention"
                rightAction={<div className={tokens.typography.meta}>Tap to focus inbox</div>}
                showHeaderDivider={false}
              >
                <div className={cn("grid", tokens.spacing.widgetGap)}>
                  <AttentionItem
                    label="Workouts with pain flags"
                    count={data?.attention.painFlagWorkouts ?? 0}
                    tone="danger"
                    active={inboxPreset === 'PAIN'}
                    onClick={() => toggleInboxPreset('PAIN')}
                  />
                  <AttentionItem
                    label="Workouts with athlete comments"
                    count={data?.attention.athleteCommentWorkouts ?? 0}
                    tone="primary"
                    active={inboxPreset === 'COMMENTS'}
                    onClick={() => toggleInboxPreset('COMMENTS')}
                  />
                </div>

                <div className={cn("mt-2 grid md:grid-cols-2", tokens.spacing.widgetGap)}>
                  <AlertStripItem
                    label="Missed workouts"
                    count={data?.attention.skippedWorkouts ?? 0}
                    active={inboxPreset === 'SKIPPED'}
                    onClick={() => toggleInboxPreset('SKIPPED')}
                  />
                  <AlertStripItem
                    label="Awaiting coach review"
                    count={data?.attention.awaitingCoachReview ?? 0}
                    active={inboxPreset === 'AWAITING_REVIEW'}
                    onClick={() => toggleInboxPreset('AWAITING_REVIEW')}
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
                <div className={cn("grid grid-cols-1 md:grid-cols-2 md:gap-x-4 md:gap-y-6", tokens.spacing.widgetGap)}>
                  {/* Row 1 */}
                  <div className="md:col-start-1 md:row-start-1">
                    <FieldLabel className="pl-1">Athlete</FieldLabel>
                    <AthleteSelector
                      athletes={athleteOptions}
                      selectedIds={selectedAthleteIds}
                      onChange={(nextSelected) => {
                        if (nextSelected.size === 0 && athleteOptions.length > 0) {
                          setSelectedAthleteIds(new Set(athleteOptions.map((athlete) => athlete.userId)));
                          return;
                        }
                        setSelectedAthleteIds(nextSelected);
                      }}
                    />
                  </div>

                  <div className="md:col-start-2 md:row-start-1">
                    <FieldLabel className="pl-1">Discipline</FieldLabel>
                    <SelectField
                      className="min-h-[44px]"
                      value={discipline ?? ''}
                      onChange={(e) => setDiscipline(e.target.value ? e.target.value : null)}
                    >
                      <option value="">All disciplines</option>
                      {disciplineOptions.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </SelectField>
                  </div>

                  {/* Row 2 */}
                  <div className="md:col-start-1 md:row-start-2">
                    <FieldLabel className="pl-1">Time range</FieldLabel>
                    <SelectField
                      className="min-h-[44px]"
                      value={timeRange}
                      onChange={(e) => setTimeRange(e.target.value as TimeRangePreset)}
                    >
                      <option value="LAST_7">Last 7 days</option>
                      <option value="LAST_14">Last 14 days</option>
                      <option value="LAST_30">Last 30 days</option>
                      <option value="CUSTOM">Custom</option>
                    </SelectField>

                    {timeRange === 'CUSTOM' ? (
                      <div className={cn("mt-2 grid grid-cols-2", tokens.spacing.widgetGap)}>
                        <div>
                          <FieldLabel className="pl-1">From</FieldLabel>
                          <input
                            type="date"
                            className={cn(
                              "w-full min-h-[44px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text)]",
                              tokens.spacing.elementPadding,
                              tokens.typography.body
                            )}
                            value={customFrom}
                            onChange={(e) => setCustomFrom(e.target.value)}
                          />
                        </div>
                        <div>
                          <FieldLabel className="pl-1">To</FieldLabel>
                          <input
                            type="date"
                            className={cn(
                              "w-full min-h-[44px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text)]",
                              tokens.spacing.elementPadding,
                              tokens.typography.body
                            )}
                            value={customTo}
                            onChange={(e) => setCustomTo(e.target.value)}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="md:col-start-2 md:row-start-2">
                    <FieldLabel className="pl-1">&nbsp;</FieldLabel>
                    <div className={cn("min-h-[44px] flex items-center justify-center rounded-2xl bg-[var(--bg-structure)]/75", tokens.spacing.elementPadding)}>
                      <div className={cn("font-medium text-[var(--muted)] text-xs sm:text-sm", tokens.typography.body)}>
                        {formatCalendarDayLabel(dateRange.from, coachTimeZone)} → {formatCalendarDayLabel(dateRange.to, coachTimeZone)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 4: Refresh removed as data auto-reloads */}

            </Block>
          </div>

          {/* Column 3: At a glance (stacks vertically); on tablet sits below and spans full width */}
          <div className="min-w-0 order-3 md:order-3 md:col-span-2 xl:col-span-1">
            <div
              className={cn("rounded-2xl bg-[var(--bg-card)] min-h-0 flex flex-col", tokens.spacing.containerPadding)}
              style={xlTopCardHeightPx ? { minHeight: `${xlTopCardHeightPx}px` } : undefined}
              data-testid="coach-dashboard-at-a-glance"
            >
              <div className="flex items-end justify-between gap-3 mb-2">
                <BlockTitle>At a glance</BlockTitle>
              </div>

              <div
                className={cn("grid grid-cols-1 items-start min-[520px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] min-[520px]:items-center min-w-0", tokens.spacing.widgetGap)}
                data-testid="coach-dashboard-at-a-glance-grid"
              >
                {/* Left: stats */}
                <div className={cn("min-w-0 rounded-2xl bg-[var(--bg-structure)]/40", tokens.spacing.elementPadding)} data-testid="coach-dashboard-at-a-glance-stats">
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
                          'min-w-0 flex items-baseline justify-between',
                          tokens.spacing.elementPadding,
                          tokens.spacing.widgetGap,
                          idx < 3 ? 'border-b border-[var(--border-subtle)]' : ''
                        )}
                        data-testid="coach-dashboard-at-a-glance-stat-row"
                      >
                        <div className={cn('min-w-0 uppercase tracking-wide truncate', tokens.typography.meta)} title={row.label}>
                          {row.label}
                        </div>
                        <div className={cn('flex-shrink-0 leading-[1.05] tabular-nums', tokens.typography.statValue)}>
                          {row.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: discipline load */}
                <div className={cn("min-w-0 rounded-2xl bg-[var(--bg-structure)]/40", tokens.spacing.elementPadding)} data-testid="coach-dashboard-discipline-load">
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
                          {rows.length === 0 ? <div className={cn("text-[var(--muted)]", tokens.typography.meta, tokens.spacing.elementPadding)}>No data for this range.</div> : null}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {error ? <div className={cn("mt-4 rounded-2xl bg-rose-500/10 text-rose-700", tokens.spacing.containerPadding, tokens.typography.body)}>{error}</div> : null}

        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div>
            <StravaVitalsSummaryCard
              comparison={data?.stravaVitals ?? null}
              loading={loading && !data}
              title={singleSelectedAthleteId ? 'Athlete Strava Vitals' : 'Squad Strava Vitals'}
              showLoadPanel={showLoadPanel}
              onToggleLoadPanel={setShowLoadPanel}
            />
          </div>

          <div ref={reviewInboxRef} id="review-inbox" data-testid="coach-dashboard-review-inbox" className="xl:col-span-2">
            <Block
              title="Event countdown"
              padding={false}
              showHeaderDivider={false}
              className="border"
              style={{ borderColor: '#cad7eb', backgroundColor: 'rgba(233, 238, 248, 0.85)' }}
            >
              {visibleGoalCountdowns.length === 0 ? (
                <div className={cn("text-[var(--muted)]", tokens.spacing.containerPadding, tokens.typography.body)}>
                  No athlete event dates available for this selection.
                </div>
              ) : (
                <div className="max-h-[420px] overflow-y-auto">
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {visibleGoalCountdowns.map((entry) => {
                      const goal = entry.goalCountdown;
                      const athleteName = String(entry.athleteName ?? 'Athlete');
                      const eventName = String(goal.eventName ?? 'Goal event');
                      const eventDate =
                        typeof goal.eventDate === 'string' && goal.eventDate
                          ? formatDayMonthYearInTimeZone(goal.eventDate, 'UTC')
                          : 'Date not set';
                      const progress = Math.max(0, Math.min(100, Number(goal.progressPct ?? 0)));
                      const weeksLabel =
                        typeof goal.weeksRemaining === 'number' && goal.weeksRemaining >= 0
                          ? `${goal.weeksRemaining} weeks to go`
                          : String(goal.label || 'Goal status');

                      return (
                        <div
                          key={entry.athleteId}
                          className={cn(
                            "grid items-center gap-3 px-4 py-2",
                            "grid-cols-1 sm:grid-cols-[minmax(140px,1.1fr)_minmax(170px,1.2fr)_minmax(120px,0.8fr)_minmax(200px,1.7fr)_auto]"
                          )}
                        >
                          <div className={cn("truncate", tokens.typography.body)} title={athleteName}>
                            {athleteName}
                          </div>
                          <div className={cn("truncate text-[var(--fg-muted)]", tokens.typography.body)} title={eventName}>
                            {eventName}
                          </div>
                          <div className={cn("whitespace-nowrap text-[var(--fg-muted)]", tokens.typography.body)}>{eventDate}</div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bar-track)]">
                            <div className="h-full rounded-full bg-orange-500/70" style={{ width: `${progress}%` }} />
                          </div>
                          <div className={cn("whitespace-nowrap text-right tabular-nums", tokens.typography.body)}>{weeksLabel}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Block>
          </div>
        </div>
      </section>
    </>
  );
}

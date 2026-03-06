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
import { Icon } from '@/components/ui/Icon';
import styles from './console-page.module.css';

type TimeRangePreset = 'LAST_7' | 'LAST_14' | 'LAST_30' | 'LAST_60' | 'LAST_90' | 'THIS_MONTH' | 'LAST_MONTH' | 'CUSTOM';
type CalorieEquivalentKey = 'bigMac' | 'snickers' | 'wine' | 'beer';

const CALORIE_EQUIVALENT_OPTIONS: Array<{
  key: CalorieEquivalentKey;
  label: string;
  icon: 'foodBurger' | 'snickersBar' | 'drinkWine' | 'drinkBeer';
  kcalPerUnit: number;
}> = [
  { key: 'bigMac', label: 'hamburgers', icon: 'foodBurger', kcalPerUnit: 550 },
  { key: 'snickers', label: 'bars of chocolate', icon: 'snickersBar', kcalPerUnit: 250 },
  { key: 'wine', label: 'glasses of red wine', icon: 'drinkWine', kcalPerUnit: 125 },
  { key: 'beer', label: 'glasses of beer', icon: 'drinkBeer', kcalPerUnit: 154 },
];

type SessionGreetingInfo = {
  title: string;
  plannedStartTimeLocal: string | null;
};

type DayTrainingSnapshot = {
  completedCount: number;
  plannedCount: number;
  completed: SessionGreetingInfo[];
  planned: SessionGreetingInfo[];
};

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
  rangeSummaryComparison: {
    previousFromDayKey: string;
    previousToDayKey: string;
    totals: {
      completedMinutes: number;
      completedDistanceKm: number;
    };
    deltas: {
      completedMinutesPct: number | null;
      completedDistanceKmPct: number | null;
    };
  } | null;
  nextUp: Array<{
    id: string;
    date: string;
    title: string | null;
    discipline: string | null;
    plannedStartTimeLocal: string | null;
  }>;
  stravaVitals: StravaVitalsComparison;
  goalCountdown: GoalCountdown | null;
  greetingTraining?: {
    yesterday: DayTrainingSnapshot;
    today: DayTrainingSnapshot;
    tomorrow: DayTrainingSnapshot;
  };
};

type ActiveChallengePreview = {
  id: string;
  title: string;
  type: string;
  status: string;
  startAt: string;
  previewBadgeImageUrl: string;
  yourRank: number | null;
  yourScoreLabel: string | null;
  canJoin: boolean;
  joined: boolean;
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

const DASHBOARD_SIDEBAR_STORAGE_KEY = 'athlete-dashboard-sidebar-open';

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

function formatKcalWithGrouping(kcal: number): string {
  if (!Number.isFinite(kcal) || kcal <= 0) return '0 kcal';
  return `${new Intl.NumberFormat('en-AU').format(Math.round(kcal))} kcal`;
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

function getDayPeriod(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function getSessionPeriod(plannedStartTimeLocal: string | null | undefined): 'morning' | 'afternoon' | 'evening' {
  const match = String(plannedStartTimeLocal ?? '').match(/^(\d{2}):(\d{2})/);
  if (!match) return 'morning';
  const hour = Number(match[1]);
  if (!Number.isFinite(hour)) return 'morning';
  return getDayPeriod(hour);
}

function formatGreetingSessionTitle(session: SessionGreetingInfo | null | undefined): string {
  const raw = String(session?.title ?? '').trim();
  if (raw) return raw;
  return 'training session';
}

function DashboardChallengesPanel({
  activeChallenges,
  athleteTimeZone,
  onOpenChallenge,
}: {
  activeChallenges: ActiveChallengePreview[];
  athleteTimeZone: string;
  onOpenChallenge: (challengeId: string) => void;
}) {
  return (
    <div className="space-y-1.5 px-1.5">
      {activeChallenges.length ? (
        activeChallenges.map((challenge) => (
          <div
            key={challenge.id}
            className="rounded-xl border border-[var(--feature-border)] bg-[var(--feature-surface)] p-2 shadow-[0_6px_16px_var(--feature-shadow)]"
          >
            <p className="text-[11px] font-semibold text-[var(--feature-title)]">{challenge.title}</p>
            <div className="mt-0.5 flex flex-wrap items-center justify-between gap-1.5">
              <p className="text-[9px] text-[var(--feature-muted)]">Starts {formatDisplayInTimeZone(challenge.startAt, athleteTimeZone)}</p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="inline-flex min-h-[22px] items-center rounded-full border border-[var(--feature-pill-border)] bg-[var(--feature-accent)] px-2 text-[8px] font-semibold text-white transition-colors hover:bg-[var(--feature-accent-strong)]"
                  onClick={() => onOpenChallenge(challenge.id)}
                >
                  View
                </button>
                {challenge.joined ? (
                  <span className="inline-flex min-h-[22px] items-center rounded-full border border-[var(--feature-success-border)] bg-[var(--feature-success-bg)] px-2 text-[8px] font-semibold text-[var(--feature-success-text)]">
                    Joined
                  </span>
                ) : challenge.canJoin ? (
                  <button
                    type="button"
                    className="inline-flex min-h-[22px] items-center rounded-full border border-[var(--feature-pill-border)] bg-[var(--feature-pill-bg)] px-2 text-[8px] font-semibold text-[var(--feature-pill-text)] transition-colors hover:bg-[var(--feature-pill-bg)]/80"
                    onClick={() => onOpenChallenge(challenge.id)}
                  >
                    Join
                  </button>
                ) : (
                  <span className="inline-flex min-h-[22px] items-center rounded-full border border-[var(--feature-pill-border)] bg-[var(--feature-pill-bg)] px-2 text-[8px] font-semibold text-[var(--feature-pill-text)]">
                    Auto joined
                  </span>
                )}
              </div>
            </div>
          </div>
        ))
      ) : (
        <div className="rounded-xl border border-[var(--feature-border)] bg-[var(--feature-surface)] p-2 shadow-[0_6px_16px_var(--feature-shadow)]">
          <p className="text-[11px] font-semibold text-[var(--feature-title)]">Loading challenge</p>
          <p className="mt-0.5 text-[9px] text-[var(--feature-muted)]">Fetching the latest challenge details.</p>
        </div>
      )}
    </div>
  );
}

function DashboardFiltersPanel({
  discipline,
  onDisciplineChange,
  timeRange,
  onTimeRangeChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
  dateRange,
  athleteTimeZone,
}: {
  discipline: string | null;
  onDisciplineChange: (next: string | null) => void;
  timeRange: TimeRangePreset;
  onTimeRangeChange: (next: TimeRangePreset) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (next: string) => void;
  onCustomToChange: (next: string) => void;
  dateRange: { from: string; to: string };
  athleteTimeZone: string;
}) {
  return (
    <div className="space-y-4 px-1.5">
      <div className="min-w-0">
        <FieldLabel className="pl-1 text-[10px]">Discipline</FieldLabel>
        <SelectField className="min-h-[44px] w-full text-xs" value={discipline ?? ''} onChange={(e) => onDisciplineChange(e.target.value ? e.target.value : null)}>
          <option value="">All disciplines</option>
          <option value="BIKE">Bike</option>
          <option value="RUN">Run</option>
          <option value="SWIM">Swim</option>
          <option value="OTHER">Other</option>
        </SelectField>
      </div>

      <div className="min-w-0">
        <FieldLabel className="pl-1 text-[10px]">Time range</FieldLabel>
        <SelectField
          className="min-h-[44px] w-full text-xs"
          value={timeRange}
          onChange={(e) => onTimeRangeChange(e.target.value as TimeRangePreset)}
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

      <div className="min-w-0">
        {timeRange === 'CUSTOM' ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-xs text-[var(--muted)]">
              From
              <input
                type="date"
                className="mt-1 w-full min-h-[44px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)]"
                value={customFrom}
                onChange={(e) => onCustomFromChange(e.target.value)}
              />
            </label>
            <label className="text-xs text-[var(--muted)]">
              To
              <input
                type="date"
                className="mt-1 w-full min-h-[44px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)]"
                value={customTo}
                onChange={(e) => onCustomToChange(e.target.value)}
              />
            </label>
          </div>
        ) : (
          <>
            <FieldLabel className="pl-1 text-[10px]">Date range</FieldLabel>
            <div
              className={cn('min-h-[44px] flex items-center justify-start rounded-2xl px-3 min-w-0 bg-[var(--bg-structure)]/75')}
              data-testid="athlete-dashboard-range-display"
            >
              <div className={cn('w-full truncate text-left text-xs')}>
                {formatDisplayInTimeZone(dateRange.from, athleteTimeZone)} → {formatDisplayInTimeZone(dateRange.to, athleteTimeZone)}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AthleteDashboardConsolePage() {
  const { user, loading: userLoading, error: userError } = useAuthUser();
  const { request } = useApi();
  const router = useRouter();

  const [timeRange, setTimeRange] = useState<TimeRangePreset>('LAST_30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [discipline, setDiscipline] = useState<string | null>(null);
  const [calorieEquivalentKey, setCalorieEquivalentKey] = useState<CalorieEquivalentKey>('bigMac');

  const [data, setData] = useState<AthleteDashboardResponse | null>(null);
  const [activeChallenges, setActiveChallenges] = useState<ActiveChallengePreview[]>([]);
  const [trainingRequestLifecycle, setTrainingRequestLifecycle] = useState<AthleteIntakeLifecycleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileSidebarMounted, setMobileSidebarMounted] = useState(false);
  const [showGreetingCelebration, setShowGreetingCelebration] = useState(false);
  const [isCompactConfetti, setIsCompactConfetti] = useState(false);
  const [sidebarInitialized, setSidebarInitialized] = useState(false);
  const [pendingSidebarSection, setPendingSidebarSection] = useState<'challenges' | 'filters' | null>(null);
  const sidebarChallengesRef = useRef<HTMLDivElement | null>(null);
  const sidebarFiltersRef = useRef<HTMLDivElement | null>(null);
  const mobileSidebarRef = useRef<HTMLDivElement | null>(null);
  const mobileSidebarCloseTimerRef = useRef<number | null>(null);

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
      if (bypassCache) qs.set('t', String(Date.now()));

      try {
        const resp = await request<AthleteDashboardResponse>(
          `/api/athlete/dashboard/console?${qs.toString()}`,
          bypassCache ? { cache: 'no-store' } : undefined
        );
        setData(resp);

        void request<{ challenges: ActiveChallengePreview[] }>('/api/athlete/challenges?status=ACTIVE', { cache: 'no-store' })
          .then((challengeResp) => {
            setActiveChallenges(challengeResp.challenges ?? []);
          })
          .catch(() => {
            setActiveChallenges([]);
          });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
      } finally {
        setLoading(false);
      }
    },
    [dateRange.from, dateRange.to, discipline, request, user?.role, user?.userId]
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
    if (typeof window === 'undefined') return;

    const coarsePointer = window.matchMedia('(pointer: coarse)');
    const update = () => {
      setIsCompactConfetti(coarsePointer.matches || window.innerWidth < 1280);
    };
    update();

    const onPointerChange = () => update();
    window.addEventListener('resize', update, { passive: true });
    coarsePointer.addEventListener('change', onPointerChange);

    return () => {
      window.removeEventListener('resize', update);
      coarsePointer.removeEventListener('change', onPointerChange);
    };
  }, []);

  useEffect(() => {
    if (user?.role !== 'ATHLETE') return;
    const timer = setInterval(() => {
      void reloadTrainingRequestLifecycle();
    }, 60_000);
    return () => clearInterval(timer);
  }, [reloadTrainingRequestLifecycle, user?.role]);

  const hasOpenTrainingRequest = Boolean(trainingRequestLifecycle?.lifecycle?.hasOpenRequest ?? trainingRequestLifecycle?.openDraftIntake?.id);
  const greetingConfettiPieces = useMemo(
    () => {
      const rand = (seed: number) => {
        const x = Math.sin(seed * 12.9898) * 43758.5453;
        return x - Math.floor(x);
      };
      const pieceCount = isCompactConfetti ? 36 : 64;
      const travelDistance = isCompactConfetti ? 138 : 160;
      return Array.from({ length: pieceCount }, (_, index) => {
        const angle = rand(index + 1) * Math.PI * 2;
        const distance = travelDistance * (0.35 + rand(index + 21) * 0.85);
        const dx = Math.round(Math.cos(angle) * distance);
        const dy = Math.round(Math.sin(angle) * distance - 90);
        const gravityDrop = 18 + Math.round(rand(index + 31) * 18);
        return {
          delay: `${Math.round(rand(index + 11) * (isCompactConfetti ? 32 : 42))}ms`,
          color: ['#facc15', '#fb7185', '#38bdf8', '#34d399'][index % 4],
          dx,
          dy,
          dxEnd: Math.round(dx * 1.08),
          dyEnd: dy + gravityDrop,
          rot: `${Math.round(rand(index + 41) * 420 - 210)}deg`,
          size: (isCompactConfetti ? 5 : 6) + Math.round(rand(index + 51) * (isCompactConfetti ? 3 : 4)),
        };
      });
    },
    [isCompactConfetti]
  );
  const athleteGreeting = useMemo(() => {
    const preferredName = String(user?.name ?? 'Athlete').trim().split(/\s+/)[0] || 'Athlete';
    const now = getNowPartsInTimeZone(athleteTimeZone);
    const dayPeriod = getDayPeriod(now.hour);

    const greetingTraining = data?.greetingTraining;
    const yesterdayCompleted = greetingTraining?.yesterday.completed?.[0] ?? null;
    const todayCompleted = greetingTraining?.today.completed?.[0] ?? null;
    const todayPlanned = greetingTraining?.today.planned?.[0] ?? null;
    const tomorrowPlanned = greetingTraining?.tomorrow.planned?.[0] ?? null;

    const lines: string[] = [];
    let hasCongratulatoryLine = false;

    if (dayPeriod === 'morning') {
      if (yesterdayCompleted) {
        lines.push(
          `Well done on yesterday ${getSessionPeriod(yesterdayCompleted.plannedStartTimeLocal)}'s ${formatGreetingSessionTitle(yesterdayCompleted)}.`
        );
        hasCongratulatoryLine = true;
      }
      if (todayPlanned) {
        lines.push(`All the best with your ${formatGreetingSessionTitle(todayPlanned)} this ${getSessionPeriod(todayPlanned.plannedStartTimeLocal)}.`);
      }
    } else if (dayPeriod === 'afternoon') {
      if (todayCompleted) {
        lines.push(`Well done on today's ${formatGreetingSessionTitle(todayCompleted)}.`);
        hasCongratulatoryLine = true;
      }
      if (todayPlanned) {
        lines.push(`You've got your ${formatGreetingSessionTitle(todayPlanned)} this ${getSessionPeriod(todayPlanned.plannedStartTimeLocal)}.`);
      } else if (tomorrowPlanned) {
        lines.push(`You've got your ${formatGreetingSessionTitle(tomorrowPlanned)} tomorrow ${getSessionPeriod(tomorrowPlanned.plannedStartTimeLocal)}.`);
      }
    } else {
      if (todayCompleted) {
        lines.push(`Well done on today's ${formatGreetingSessionTitle(todayCompleted)}.`);
        hasCongratulatoryLine = true;
      }
      if (tomorrowPlanned) {
        lines.push(`You've got your ${formatGreetingSessionTitle(tomorrowPlanned)} tomorrow ${getSessionPeriod(tomorrowPlanned.plannedStartTimeLocal)}.`);
      }
    }

    if (lines.length === 0) {
      const nextSession = data?.nextUp?.[0] ?? null;
      const nextLabel =
        String(nextSession?.title ?? '').trim() ||
        String(nextSession?.discipline ?? '').trim().toLowerCase() ||
        'training session';
      if (!nextSession) return { message: `G'day ${preferredName}! No upcoming sessions scheduled.`, shouldCelebrate: false };
      return { message: `G'day ${preferredName}! You've got your next ${nextLabel} coming up soon.`, shouldCelebrate: false };
    }

    return { message: `G'day ${preferredName}! ${lines.join(' ')}`, shouldCelebrate: hasCongratulatoryLine };
  }, [athleteTimeZone, data?.greetingTraining, data?.nextUp, user?.name]);

  useEffect(() => {
    const shouldCelebrate = athleteGreeting.shouldCelebrate || /well done/i.test(athleteGreeting.message);
    if (!shouldCelebrate) return;
    setShowGreetingCelebration(true);
    const timer = window.setTimeout(() => setShowGreetingCelebration(false), 2100);
    return () => window.clearTimeout(timer);
  }, [athleteGreeting.message, athleteGreeting.shouldCelebrate]);

  useEffect(() => {
    if (user?.role === 'COACH') {
      router.replace('/coach/dashboard');
    } else if (user?.role === 'ADMIN') {
      router.replace('/admin' as any);
    }
  }, [router, user?.role]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sidebarInitialized) return;
    const saved = window.localStorage.getItem(DASHBOARD_SIDEBAR_STORAGE_KEY);
    if (saved === 'true' || saved === 'false') {
      setSidebarOpen(saved === 'true');
    } else {
      setSidebarOpen(window.matchMedia('(min-width: 1024px)').matches);
    }
    setSidebarInitialized(true);
  }, [sidebarInitialized]);

  useEffect(() => {
    if (!sidebarInitialized || typeof window === 'undefined') return;
    window.localStorage.setItem(DASHBOARD_SIDEBAR_STORAGE_KEY, sidebarOpen ? 'true' : 'false');
  }, [sidebarInitialized, sidebarOpen]);

  useEffect(() => {
    if (!sidebarOpen || !pendingSidebarSection) return;
    const target = pendingSidebarSection === 'challenges' ? sidebarChallengesRef.current : sidebarFiltersRef.current;
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setPendingSidebarSection(null);
  }, [pendingSidebarSection, sidebarOpen]);

  const openMobileSidebar = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (mobileSidebarCloseTimerRef.current !== null) {
      window.clearTimeout(mobileSidebarCloseTimerRef.current);
      mobileSidebarCloseTimerRef.current = null;
    }
    setMobileSidebarMounted(true);
    window.requestAnimationFrame(() => setMobileSidebarOpen(true));
  }, []);

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (!mobileSidebarMounted || typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMobileSidebar();
        return;
      }
      if (!mobileSidebarOpen) return;
      if (event.key !== 'Tab' || !mobileSidebarRef.current) return;
      const focusable = mobileSidebarRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (mobileSidebarOpen) {
      const initialTarget = mobileSidebarRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      initialTarget?.focus();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closeMobileSidebar, mobileSidebarMounted, mobileSidebarOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOpen = () => openMobileSidebar();
    window.addEventListener('coachkit:open-dashboard-sidebar', onOpen);
    return () => window.removeEventListener('coachkit:open-dashboard-sidebar', onOpen);
  }, [openMobileSidebar]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!mobileSidebarMounted || mobileSidebarOpen) return;
    mobileSidebarCloseTimerRef.current = window.setTimeout(() => {
      setMobileSidebarMounted(false);
      mobileSidebarCloseTimerRef.current = null;
    }, 720);
    return () => {
      if (mobileSidebarCloseTimerRef.current !== null) {
        window.clearTimeout(mobileSidebarCloseTimerRef.current);
        mobileSidebarCloseTimerRef.current = null;
      }
    };
  }, [mobileSidebarMounted, mobileSidebarOpen]);

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
      <section className="pb-10">
        <div className={cn('pt-3 md:pt-6 px-4 md:pr-6 lg:pr-8', sidebarOpen ? 'md:pl-[256px]' : 'md:pl-[76px]')}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className={cn(tokens.typography.h1, 'text-[22px] md:text-2xl')}>Athlete Console</h1>
            <span className={cn(tokens.typography.h1, 'text-[var(--muted)]')} aria-hidden>
              |
            </span>
            <div className="relative overflow-visible">
              {showGreetingCelebration ? (
                <div className={styles.confettiLayer} aria-hidden data-testid="athlete-dashboard-greeting-confetti">
                  {greetingConfettiPieces.map((piece, index) => (
                    <span
                      key={`greeting-confetti-${index}`}
                      className={styles.confettiPiece}
                      style={{
                        animationDelay: piece.delay,
                        backgroundColor: piece.color,
                        width: `${piece.size}px`,
                        height: `${Math.round(piece.size * 1.8)}px`,
                        ['--dx' as any]: `${piece.dx}px`,
                        ['--dy' as any]: `${piece.dy}px`,
                        ['--dx-end' as any]: `${piece.dxEnd}px`,
                        ['--dy-end' as any]: `${piece.dyEnd}px`,
                        ['--rot' as any]: piece.rot,
                      }}
                    />
                  ))}
                </div>
              ) : null}
              <p className="text-[20px] md:text-[22px] font-bold tracking-tight text-[var(--muted)]">{athleteGreeting.message}</p>
            </div>
          </div>
        </div>

        {hasOpenTrainingRequest ? (
          <div className={cn('mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 mx-4 md:mr-6 lg:mr-8', sidebarOpen ? 'md:ml-[256px]' : 'md:ml-[76px]')}>
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

        <div className={cn('mt-4 px-4 md:pr-6 lg:pr-8', sidebarOpen ? 'md:pl-[256px]' : 'md:pl-[76px]')}>
          <aside
            className={cn(
              'hidden md:block fixed left-0 top-[88px] z-30 h-[calc(100vh-88px)] shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden',
              sidebarOpen ? 'w-[240px]' : 'w-[60px]'
            )}
            data-testid="athlete-dashboard-sidebar-desktop"
          >
            <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2">
              <div className={cn('flex items-center gap-1', sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]"
                  aria-label="Open notifications"
                  title="Notifications"
                  onClick={() => router.push('/athlete/notifications' as never)}
                >
                  <Icon name="inbox" size="sm" aria-hidden />
                </button>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]"
                  aria-label="Open settings"
                  title="Settings"
                  onClick={() => router.push('/athlete/settings' as never)}
                >
                  <Icon name="settings" size="sm" aria-hidden />
                </button>
              </div>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]"
                onClick={() => setSidebarOpen((prev) => !prev)}
                aria-label={sidebarOpen ? 'Collapse dashboard sidebar' : 'Expand dashboard sidebar'}
                title={sidebarOpen ? 'Collapse navigation' : 'Expand navigation'}
                aria-expanded={sidebarOpen}
                data-testid="athlete-dashboard-sidebar-toggle"
              >
                <Icon name="sidebar" size="md" aria-hidden />
              </button>
            </div>

            {sidebarOpen ? (
              <div className="h-[calc(100vh-144px)] overflow-y-auto px-2.5 py-3">
                <div className="flex min-h-full flex-col gap-4">
                  <div ref={sidebarChallengesRef}>
                    <DashboardChallengesPanel
                      activeChallenges={activeChallenges}
                      athleteTimeZone={athleteTimeZone}
                      onOpenChallenge={(challengeId) => router.push(`/challenges/${challengeId}` as never)}
                    />
                  </div>

                  <div ref={sidebarFiltersRef} className="border-t border-[var(--border-subtle)] pt-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Icon name="filter" size="sm" className="text-[var(--muted)]" aria-hidden />
                      <h2 className={cn(tokens.typography.blockTitle, 'text-xs')}>Make your selection</h2>
                    </div>
                    <DashboardFiltersPanel
                      discipline={discipline}
                      onDisciplineChange={setDiscipline}
                      timeRange={timeRange}
                      onTimeRangeChange={setTimeRange}
                      customFrom={customFrom}
                      customTo={customTo}
                      onCustomFromChange={setCustomFrom}
                      onCustomToChange={setCustomTo}
                      dateRange={dateRange}
                      athleteTimeZone={athleteTimeZone}
                    />
                  </div>

                  {data?.goalCountdown?.mode && data.goalCountdown.mode !== 'none' ? (
                    <div className="mt-auto border-t border-[var(--border-subtle)] pt-4">
                      <div className="px-1.5">
                        <GoalCountdownCallout
                          goal={data.goalCountdown}
                          variant="hero"
                          showShortLabel={false}
                          className="ring-0 border border-[var(--border-subtle)] bg-[var(--bg-card)] dark:border-slate-700/70 dark:bg-slate-900/90 min-h-[124px]"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex h-[calc(100vh-144px)] flex-col items-center gap-2 overflow-y-auto py-3">
                <button
                  type="button"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-subtle)] text-[var(--text)] hover:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]"
                  aria-label="Open challenges section"
                  onClick={() => {
                    setSidebarOpen(true);
                    setPendingSidebarSection('challenges');
                  }}
                >
                  <Icon name="favorite" size="md" aria-hidden />
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-subtle)] text-[var(--text)] hover:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]"
                  aria-label="Open filters section"
                  onClick={() => {
                    setSidebarOpen(true);
                    setPendingSidebarSection('filters');
                  }}
                >
                  <Icon name="filter" size="md" aria-hidden />
                </button>
              </div>
            )}
          </aside>

          <div className="min-w-0">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:[grid-template-columns:repeat(6,minmax(0,1fr))]" data-testid="athlete-dashboard-chart-grid">
              <div className="min-w-0 order-1 md:order-none md:col-span-2 lg:col-span-6">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:[grid-template-columns:5fr_6fr_4fr]">
                  <div className="hidden md:block min-w-0">
                    <Block
                      title="Needs your attention"
                      rightAction={<div className={tokens.typography.meta}>Tap to open calendar</div>}
                      showHeaderDivider={false}
                      className="h-full"
                    >
                      <div className={cn('grid pb-5', tokens.spacing.widgetGap)}>
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

                  <div className="min-w-0">
                    <AtAGlanceCard
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
                        {
                          label: 'TOTAL TRAINING TIME',
                          value: formatMinutes(data?.rangeSummary?.totals.completedMinutes ?? 0),
                          deltaPercent: data?.rangeSummaryComparison?.deltas.completedMinutesPct ?? null,
                        },
                        {
                          label: 'TOTAL DISTANCE',
                          value: formatDistanceKm(data?.rangeSummary?.totals.completedDistanceKm ?? 0),
                          deltaPercent: data?.rangeSummaryComparison?.deltas.completedDistanceKmPct ?? null,
                        },
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

                  <div className="hidden md:block min-w-0">
                    <Block
                      title="Planned vs Completed"
                      showHeaderDivider={false}
                      className="min-h-[230px]"
                      data-testid="athlete-dashboard-compliance-chart"
                    >
            {(() => {
              const summary = data?.rangeSummary;
              const plannedTotal = summary?.totals.workoutsPlanned ?? 0;
              const completedTotal = summary?.totals.workoutsCompleted ?? 0;
              const percent = plannedTotal > 0 ? Math.min(100, Math.round((completedTotal / plannedTotal) * 100)) : 0;
              const rows = (summary?.byDiscipline ?? []).filter((row) => row.plannedWorkouts > 0 || row.completedWorkouts > 0);

              return (
                <div className="flex h-full flex-col gap-3">
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
                  </div>
                </div>
              </div>

              <Block
                title="Calories"
                showHeaderDivider={false}
                className="order-3 md:order-none min-h-[230px] lg:col-span-3"
                data-testid="athlete-dashboard-calories-chart"
              >
            {(() => {
              const summary = data?.rangeSummary;
              const points = summary?.caloriesByDay ?? [];
              const totalCalories = summary?.totals.completedCaloriesKcal ?? 0;
              const maxCalories = Math.max(1, ...points.map((point) => point.completedCaloriesKcal));
              const selectedEquivalent =
                CALORIE_EQUIVALENT_OPTIONS.find((option) => option.key === calorieEquivalentKey) ?? CALORIE_EQUIVALENT_OPTIONS[0];
              const equivalentValue =
                totalCalories > 0
                  ? new Intl.NumberFormat('en-AU', {
                      minimumFractionDigits: totalCalories / selectedEquivalent.kcalPerUnit < 10 ? 1 : 0,
                      maximumFractionDigits: 1,
                    }).format(totalCalories / selectedEquivalent.kcalPerUnit)
                  : '0';
              const axisStep = points.length > 14 ? 7 : 1;
              const monthLabel = (dayKey: string) =>
                new Intl.DateTimeFormat('en-AU', { timeZone: athleteTimeZone, month: 'short' }).format(new Date(`${dayKey}T00:00:00.000Z`));
              const monthMarkers =
                points.length <= 31
                  ? points.reduce<Array<{ idx: number; label: string }>>((acc, point, idx) => {
                      const currentMonth = point.dayKey.slice(0, 7);
                      const prevMonth = idx > 0 ? points[idx - 1]?.dayKey.slice(0, 7) : null;
                      if (idx === 0 || currentMonth !== prevMonth) {
                        acc.push({ idx, label: monthLabel(point.dayKey) });
                      }
                      return acc;
                    }, [])
                  : [];
              const monthMarkersWithSpacing = monthMarkers.reduce<Array<{ idx: number; label: string; left: number }>>((acc, marker, idx) => {
                const baseLeft = points.length > 1 ? (marker.idx / (points.length - 1)) * 100 : 0;
                const prev = acc[acc.length - 1];
                const minGapPct = 10;
                const leftFloor = idx === 0 ? 0 : 4;
                let nextLeft = Math.max(baseLeft, leftFloor);

                if (prev && nextLeft - prev.left < minGapPct) {
                  nextLeft = prev.left + minGapPct;
                }
                if (idx === 1 && nextLeft < 12) {
                  nextLeft = 12;
                }

                nextLeft = Math.min(nextLeft, 98);
                acc.push({ ...marker, left: nextLeft });
                return acc;
              }, []);

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
                <div className="flex h-full flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-sm text-[var(--muted)]">Total {formatKcalWithGrouping(totalCalories)} burned</div>
                    <div className="text-xs text-[var(--muted)]">In this range</div>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
                    <span className="inline-flex items-center gap-1">
                      <Icon name={selectedEquivalent.icon} size="sm" className="scale-90 text-[var(--muted)]" aria-hidden />
                      Approximately {equivalentValue} {selectedEquivalent.label}
                    </span>
                    <div className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] p-1">
                      {CALORIE_EQUIVALENT_OPTIONS.map((option) => {
                        const isActive = option.key === calorieEquivalentKey;
                        return (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => setCalorieEquivalentKey(option.key)}
                            title={option.label}
                            className={cn(
                              'inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors',
                              isActive
                                ? 'bg-[var(--bg-surface)] text-[var(--text)]'
                                : 'text-[var(--muted)] hover:bg-[var(--bg-structure)]/60 hover:text-[var(--text)]'
                            )}
                            aria-pressed={isActive}
                            aria-label={option.label}
                          >
                            <Icon name={option.icon} size="sm" className="scale-90" aria-hidden />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-structure)]/40 p-3">
                    <div className="flex h-[108px] items-end gap-0.5 sm:gap-1 overflow-hidden" aria-label="Calories per day">
                      {points.map((point, idx) => {
                        const heightPct = maxCalories > 0 ? Math.round((point.completedCaloriesKcal / maxCalories) * 100) : 0;
                        const axisLabel = axisLabelForPoint(point, idx);
                        return (
                          <div key={point.dayKey} className="flex-1 min-w-0 flex flex-col items-center gap-2" title={buildTooltip(point)}>
                            <div className="w-full flex items-end justify-center h-[78px]">
                              <div
                                className="w-2.5 sm:w-3 md:w-4 rounded-full bg-[var(--bar-fill)]"
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
                    {monthMarkersWithSpacing.length > 0 ? (
                      <div className="relative mt-1 h-3" aria-hidden>
                        {monthMarkersWithSpacing.map((marker) => (
                          <span
                            key={`${marker.idx}-${marker.label}`}
                            className="absolute text-[9px] leading-none text-[var(--muted)] whitespace-nowrap"
                            style={{
                              left: `${marker.left}%`,
                              transform:
                                marker.idx === 0
                                  ? 'none'
                                  : marker.idx === points.length - 1
                                    ? 'translateX(-100%)'
                                    : 'translateX(-50%)',
                            }}
                          >
                            {marker.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })()}
              </Block>

              <div className="order-2 md:order-none lg:col-span-3">
                <StravaVitalsSummaryCard comparison={data?.stravaVitals ?? null} loading={loading && !data} title="Strava Vitals" addBottomSpacer />
              </div>

              <div className="md:hidden order-4 min-w-0">
                <Block
                  title="Planned vs Completed"
                  showHeaderDivider={false}
                  className="min-h-[230px]"
                  data-testid="athlete-dashboard-compliance-chart-mobile"
                >
                  {(() => {
                    const summary = data?.rangeSummary;
                    const plannedTotal = summary?.totals.workoutsPlanned ?? 0;
                    const completedTotal = summary?.totals.workoutsCompleted ?? 0;
                    const percent = plannedTotal > 0 ? Math.min(100, Math.round((completedTotal / plannedTotal) * 100)) : 0;
                    const rows = (summary?.byDiscipline ?? []).filter((row) => row.plannedWorkouts > 0 || row.completedWorkouts > 0);

                    return (
                      <div className="flex h-full flex-col gap-3">
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
              </div>
            </div>
          </div>
        </div>

        {mobileSidebarMounted ? (
          <>
            <div
              className={cn('fixed inset-0 z-40 bg-black transition-opacity duration-500 md:hidden', mobileSidebarOpen ? 'opacity-100' : 'opacity-0')}
              onClick={closeMobileSidebar}
            />
            <aside
              ref={mobileSidebarRef}
              className={cn(
                'fixed left-0 top-0 z-50 h-full w-[min(88vw,360px)] overflow-y-auto border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] transition-transform duration-700 ease-in-out md:hidden',
                mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
              )}
              aria-label="Dashboard sidebar"
              data-testid="athlete-dashboard-sidebar-mobile"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-3">
                <div className="text-sm font-semibold text-[var(--text)]">Dashboard sidebar</div>
                <button
                  type="button"
                  onClick={closeMobileSidebar}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]"
                  aria-label="Close dashboard sidebar"
                >
                  <Icon name="close" size="md" aria-hidden />
                </button>
              </div>
              <div className="space-y-4 p-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                <DashboardChallengesPanel
                  activeChallenges={activeChallenges}
                  athleteTimeZone={athleteTimeZone}
                  onOpenChallenge={(challengeId) => {
                    closeMobileSidebar();
                    router.push(`/challenges/${challengeId}` as never);
                  }}
                />
                <div className="border-t border-[var(--border-subtle)] pt-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Icon name="filter" size="sm" className="text-[var(--muted)]" aria-hidden />
                    <h2 className={cn(tokens.typography.blockTitle, 'text-xs')}>Make your selection</h2>
                  </div>
                  <DashboardFiltersPanel
                    discipline={discipline}
                    onDisciplineChange={(next) => {
                      setDiscipline(next);
                      closeMobileSidebar();
                    }}
                    timeRange={timeRange}
                    onTimeRangeChange={(next) => {
                      setTimeRange(next);
                      if (next !== 'CUSTOM') closeMobileSidebar();
                    }}
                    customFrom={customFrom}
                    customTo={customTo}
                    onCustomFromChange={setCustomFrom}
                    onCustomToChange={setCustomTo}
                    dateRange={dateRange}
                    athleteTimeZone={athleteTimeZone}
                  />
                </div>
                {data?.goalCountdown?.mode && data.goalCountdown.mode !== 'none' ? (
                  <div className="border-t border-[var(--border-subtle)] pt-4">
                    <div className="px-1.5">
                      <GoalCountdownCallout
                        goal={data.goalCountdown}
                        variant="hero"
                        showShortLabel={false}
                        className="ring-0 border border-[var(--border-subtle)] bg-[var(--bg-card)] dark:border-slate-700/70 dark:bg-slate-900/90 min-h-[124px]"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </aside>
          </>
        ) : null}

        {error ? (
          <div className={cn('mt-4 rounded-2xl bg-rose-500/10 text-rose-700 p-4 text-sm mx-4 md:mr-6 lg:mr-8', sidebarOpen ? 'md:ml-[256px]' : 'md:ml-[76px]')}>
            {error}
          </div>
        ) : null}
        {loading && !data ? <FullScreenLogoLoader /> : null}
      </section>
    </>
  );
}

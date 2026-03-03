'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/SelectField';
import { Block } from '@/components/ui/Block';
import { FieldLabel } from '@/components/ui/FieldLabel';
import { AthleteSelector } from '@/components/coach/AthleteSelector';
import { CoachOnboardingModal } from '@/components/coach/CoachOnboardingModal';
import { AtAGlanceCard } from '@/components/dashboard/AtAGlanceCard';
import { StravaVitalsSummaryCard } from '@/components/dashboard/StravaVitalsSummaryCard';
import { FullScreenLogoLoader } from '@/components/FullScreenLogoLoader';
import { Icon } from '@/components/ui/Icon';
import { addDays, formatDayMonthYearInTimeZone, formatDisplayInTimeZone, toDateInput } from '@/lib/client-date';
import { cn } from '@/lib/cn';
import { tokens } from '@/components/ui/tokens';
import { getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';
import type { StravaVitalsComparison } from '@/lib/strava-vitals';
import type { GoalCountdown } from '@/lib/goal-countdown';

type TimeRangePreset = 'LAST_7' | 'LAST_14' | 'LAST_30' | 'LAST_60' | 'LAST_90' | 'THIS_MONTH' | 'LAST_MONTH' | 'CUSTOM';
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

type CoachActiveChallengePreview = {
  id: string;
  title: string;
  status: string;
  startAt: string;
};

const DASHBOARD_SIDEBAR_STORAGE_KEY = 'coach-dashboard-sidebar-open';

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

function formatReviewInboxDateShort(value: string, timeZone: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value ?? '');
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(parsed);
}

function getDateRangeFromPreset(preset: TimeRangePreset, coachTimeZone: string, customFrom: string, customTo: string) {
  const todayKey = getZonedDateKeyForNow(coachTimeZone);
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

function CoachDashboardChallengesPanel({
  activeChallenges,
  coachTimeZone,
  onOpenChallenge,
}: {
  activeChallenges: CoachActiveChallengePreview[];
  coachTimeZone: string;
  onOpenChallenge: (challengeId: string) => void;
}) {
  return (
    <div className="space-y-1.5 px-1.5">
      {activeChallenges.length ? (
        activeChallenges.map((challenge) => (
          <div key={challenge.id} className="rounded-xl border border-[#8fc5ff]/35 bg-[linear-gradient(145deg,rgba(94,131,196,0.65),rgba(27,48,84,0.92))] p-2">
            <p className="text-[11px] font-semibold text-white">{challenge.title}</p>
            <div className="mt-0.5 flex flex-wrap items-center justify-between gap-1.5">
              <p className="text-[8px] text-[#d4e3ff]">Starts {formatDisplayInTimeZone(challenge.startAt, coachTimeZone)}</p>
              <button
                type="button"
                className="inline-flex min-h-[22px] items-center rounded-full border border-[#8fc5ff]/45 bg-[#15316a] px-2 text-[8px] font-semibold text-[#e7efff] transition-colors hover:bg-[#1d3f86]"
                onClick={() => onOpenChallenge(challenge.id)}
              >
                View
              </button>
            </div>
          </div>
        ))
      ) : (
        <div className="rounded-xl border border-[#8fc5ff]/25 bg-[rgba(6,18,41,0.38)] p-2">
          <p className="text-[11px] font-semibold text-white">No active challenge</p>
          <p className="mt-0.5 text-[8px] text-[#d4e3ff]">You haven’t published one yet.</p>
        </div>
      )}
    </div>
  );
}

function CoachDashboardFiltersPanel({
  athleteOptions,
  selectedAthleteIds,
  onAthleteIdsChange,
  discipline,
  onDisciplineChange,
  disciplineOptions,
  timeRange,
  onTimeRangeChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
  dateRange,
  coachTimeZone,
}: {
  athleteOptions: Array<{ userId: string; user: { id: string; name: string | null } }>;
  selectedAthleteIds: Set<string>;
  onAthleteIdsChange: (next: Set<string>) => void;
  discipline: string | null;
  onDisciplineChange: (next: string | null) => void;
  disciplineOptions: string[];
  timeRange: TimeRangePreset;
  onTimeRangeChange: (next: TimeRangePreset) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (next: string) => void;
  onCustomToChange: (next: string) => void;
  dateRange: { from: string; to: string };
  coachTimeZone: string;
}) {
  return (
    <div className="space-y-4 px-1.5">
      <div className="min-w-0">
        <FieldLabel className="pl-1 text-[10px]">Athlete</FieldLabel>
        <AthleteSelector athletes={athleteOptions} selectedIds={selectedAthleteIds} onChange={onAthleteIdsChange} />
      </div>

      <div className="min-w-0">
        <FieldLabel className="pl-1 text-[10px]">Discipline</FieldLabel>
        <SelectField className="min-h-[44px] w-full text-xs" value={discipline ?? ''} onChange={(e) => onDisciplineChange(e.target.value ? e.target.value : null)}>
          <option value="">All disciplines</option>
          {disciplineOptions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </SelectField>
      </div>

      <div className="min-w-0">
        <FieldLabel className="pl-1 text-[10px]">Time range</FieldLabel>
        <SelectField className="min-h-[44px] w-full text-xs" value={timeRange} onChange={(e) => onTimeRangeChange(e.target.value as TimeRangePreset)}>
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
            <div className={cn('min-h-[44px] flex items-center justify-start rounded-2xl px-3 min-w-0 bg-[var(--bg-structure)]/75')}>
              <div className={cn('w-full truncate text-left text-xs')}>
                {formatDisplayInTimeZone(dateRange.from, coachTimeZone)} → {formatDisplayInTimeZone(dateRange.to, coachTimeZone)}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CoachDashboardConsolePage() {
  const { user, loading: userLoading, error: userError } = useAuthUser();
  const { request } = useApi();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [timeRange, setTimeRange] = useState<TimeRangePreset>('LAST_30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<Set<string>>(() => new Set());
  const [discipline, setDiscipline] = useState<string | null>(null);
  const [inboxPreset, setInboxPreset] = useState<InboxPreset>('ALL');
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [selectedReviewItemIds, setSelectedReviewItemIds] = useState<Set<string>>(() => new Set());
  const [reviewingItems, setReviewingItems] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarInitialized, setSidebarInitialized] = useState(false);
  const [pendingSidebarSection, setPendingSidebarSection] = useState<'challenges' | 'filters' | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [data, setData] = useState<DashboardResponse | null>(null);
  const [activeChallenges, setActiveChallenges] = useState<CoachActiveChallengePreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reviewInboxRef = useRef<HTMLDivElement | null>(null);
  const sidebarChallengesRef = useRef<HTMLDivElement | null>(null);
  const sidebarFiltersRef = useRef<HTMLDivElement | null>(null);
  const mobileSidebarRef = useRef<HTMLDivElement | null>(null);

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
  const forceOnboardingModal = searchParams.get('onboarding') === '1';

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
      qs.set('includeLoadModel', '1');
      if (bypassCache) qs.set('t', String(Date.now()));

      try {
        const [resp, challengeResp] = await Promise.all([
          request<DashboardResponse>(`/api/coach/dashboard/console?${qs.toString()}`, bypassCache ? { cache: 'no-store' } : undefined),
          request<{ challenges: CoachActiveChallengePreview[] }>('/api/coach/challenges?status=ACTIVE', { cache: 'no-store' }).catch(() => ({ challenges: [] })),
        ]);
        setData(resp);
        setActiveChallenges(challengeResp.challenges ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
      } finally {
        setLoading(false);
      }
    },
    [allAthletesSelected, dateRange.from, dateRange.to, discipline, request, selectedAthleteIdList, user?.role, user?.userId]
  );

  useEffect(() => {
    if (user?.role === 'COACH') {
      reload();
    }
  }, [reload, user?.role]);

  useEffect(() => {
    if (user?.role === 'COACH' && forceOnboardingModal) {
      setShowOnboardingModal(true);
      setOnboardingChecked(true);
      return;
    }

    if (onboardingChecked) return;
    if (user?.role !== 'COACH') return;
    if (!data) return;

    const hasAthletes = Array.isArray(data.athletes) && data.athletes.length > 0;
    if (hasAthletes) {
      setOnboardingChecked(true);
      return;
    }

    try {
      if (typeof window !== 'undefined') {
        const skipped = window.localStorage.getItem('coachkit-coach-onboarding-skip') === '1';
        const completed = window.localStorage.getItem('coachkit-coach-onboarding-complete') === '1';
        if (!skipped && !completed) {
          setShowOnboardingModal(true);
        }
      }
    } catch {
      // noop
    } finally {
      setOnboardingChecked(true);
    }
  }, [data, forceOnboardingModal, onboardingChecked, user?.role]);

  useEffect(() => {
    if (user?.role === 'ATHLETE') {
      router.replace('/athlete/dashboard');
    } else if (user?.role === 'ADMIN') {
      router.replace('/admin/ai-usage');
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

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileSidebarOpen(false);
        return;
      }
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
    const initialTarget = mobileSidebarRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    initialTarget?.focus();

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileSidebarOpen]);

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
  const visibleReviewInbox = useMemo(() => {
    const items = data?.reviewInbox ?? [];
    if (inboxPreset === 'PAIN') return items.filter((item) => Boolean(item.latestCompletedActivity?.painFlag));
    if (inboxPreset === 'COMMENTS') return items.filter((item) => item.hasAthleteComment);
    if (inboxPreset === 'SKIPPED') return items.filter((item) => item.status === 'SKIPPED');
    if (inboxPreset === 'AWAITING_REVIEW') return items;
    return items;
  }, [data?.reviewInbox, inboxPreset]);
  const selectedReviewCount = useMemo(
    () => visibleReviewInbox.filter((item) => selectedReviewItemIds.has(item.id)).length,
    [visibleReviewInbox, selectedReviewItemIds]
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
  const toggleReviewItemSelection = useCallback((itemId: string) => {
    setSelectedReviewItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);
  const clearReviewSelection = useCallback(() => {
    setSelectedReviewItemIds(new Set());
  }, []);
  const markSelectedReviewed = useCallback(async () => {
    const ids = visibleReviewInbox.map((item) => item.id).filter((id) => selectedReviewItemIds.has(id));
    if (ids.length === 0) return;
    setReviewingItems(true);
    setError('');
    try {
      await request('/api/coach/review-inbox/bulk-review', {
        method: 'POST',
        data: { ids },
      });
      setSelectedReviewItemIds(new Set());
      await reload({ bypassCache: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark selected workouts as reviewed.');
    } finally {
      setReviewingItems(false);
    }
  }, [reload, request, selectedReviewItemIds, visibleReviewInbox]);

  useEffect(() => {
    setSelectedReviewItemIds((prev) => {
      const valid = new Set(visibleReviewInbox.map((item) => item.id));
      const next = new Set<string>();
      prev.forEach((id) => {
        if (valid.has(id)) next.add(id);
      });
      return next;
    });
  }, [visibleReviewInbox]);

  if (userLoading || (!user && !userError)) return <FullScreenLogoLoader />;

  if (!user || user.role !== 'COACH') {
    return (
      <div className={cn(tokens.spacing.screenPadding, "pt-6")}>
        <p className={tokens.typography.bodyMuted}>
          {userError ? 'We could not load your account yet. Please refresh.' : 'Redirecting...'}
        </p>
      </div>
    );
  }

  if (loading && !data) return <FullScreenLogoLoader />;

  return (
    <>
      <section className="pb-10">
        <div className={cn('pt-3 md:pt-6 px-4 md:pr-6 lg:pr-8', sidebarOpen ? 'md:pl-[256px]' : 'md:pl-[76px]')}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className={tokens.typography.h1}>Coach Console</h1>
            <button
              type="button"
              className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)] md:hidden"
              aria-label="Open dashboard sidebar"
              aria-expanded={mobileSidebarOpen}
              onClick={() => setMobileSidebarOpen(true)}
              data-testid="coach-dashboard-mobile-sidebar-toggle"
            >
              <Icon name="menu" size="md" aria-hidden />
            </button>
          </div>
        </div>

        <div className={cn('mt-4 px-4 md:pr-6 lg:pr-8', sidebarOpen ? 'md:pl-[256px]' : 'md:pl-[76px]')}>
          <aside
            className={cn(
              'hidden md:block fixed left-0 top-[88px] z-30 h-[calc(100vh-88px)] shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden',
              sidebarOpen ? 'w-[240px]' : 'w-[60px]'
            )}
            data-testid="coach-dashboard-sidebar-desktop"
          >
            <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2">
              <div className={cn('flex items-center gap-1', sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]"
                  aria-label="Open notifications"
                  title="Notifications"
                  onClick={() => router.push('/coach/notifications' as never)}
                >
                  <Icon name="inbox" size="sm" aria-hidden />
                </button>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]"
                  aria-label="Open settings"
                  title="Settings"
                  onClick={() => router.push('/coach/settings' as never)}
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
                data-testid="coach-dashboard-sidebar-toggle"
              >
                <Icon name={sidebarOpen ? 'prev' : 'next'} size="md" aria-hidden />
              </button>
            </div>

            {sidebarOpen ? (
              <div className="h-[calc(100vh-144px)] overflow-y-auto px-2.5 py-3 space-y-4">
                <div ref={sidebarChallengesRef}>
                  <CoachDashboardChallengesPanel
                    activeChallenges={activeChallenges}
                    coachTimeZone={coachTimeZone}
                    onOpenChallenge={(challengeId) => router.push(`/coach/challenges/${challengeId}` as never)}
                  />
                </div>

                <div ref={sidebarFiltersRef} className="border-t border-[var(--border-subtle)] pt-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Icon name="filter" size="sm" className="text-[var(--muted)]" aria-hidden />
                    <h2 className={cn(tokens.typography.blockTitle, 'text-xs')}>Make your selection</h2>
                  </div>
                  <CoachDashboardFiltersPanel
                    athleteOptions={athleteOptions}
                    selectedAthleteIds={selectedAthleteIds}
                    onAthleteIdsChange={(nextSelected) => {
                      if (nextSelected.size === 0 && athleteOptions.length > 0) {
                        setSelectedAthleteIds(new Set(athleteOptions.map((athlete) => athlete.userId)));
                        return;
                      }
                      setSelectedAthleteIds(nextSelected);
                    }}
                    discipline={discipline}
                    onDisciplineChange={setDiscipline}
                    disciplineOptions={disciplineOptions}
                    timeRange={timeRange}
                    onTimeRangeChange={setTimeRange}
                    customFrom={customFrom}
                    customTo={customTo}
                    onCustomFromChange={setCustomFrom}
                    onCustomToChange={setCustomTo}
                    dateRange={dateRange}
                    coachTimeZone={coachTimeZone}
                  />
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
            {error ? <div className={cn('mb-4 rounded-2xl bg-rose-500/10 text-rose-700', tokens.spacing.containerPadding, tokens.typography.body)}>{error}</div> : null}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:[grid-template-columns:repeat(6,minmax(0,1fr))]">
              <div className="min-w-0 lg:col-span-2">
                <Block title="Needs your attention" rightAction={<div className={tokens.typography.meta}>Tap to focus inbox</div>} showHeaderDivider={false} className="h-full">
                  <div className={cn('grid', tokens.spacing.widgetGap)}>
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
                  <div className={cn('mt-2 grid min-[900px]:grid-cols-2', tokens.spacing.widgetGap)}>
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

              <div className="min-w-0 lg:col-span-2">
                <AtAGlanceCard
                  loading={loading && !data}
                  testIds={{
                    card: 'coach-dashboard-at-a-glance',
                    grid: 'coach-dashboard-at-a-glance-grid',
                    stats: 'coach-dashboard-at-a-glance-stats',
                    statRow: 'coach-dashboard-at-a-glance-stat-row',
                    disciplineLoad: 'coach-dashboard-discipline-load',
                  }}
                  statsRows={[
                    { label: 'WORKOUTS COMPLETED', value: String(data?.kpis.workoutsCompleted ?? 0) },
                    { label: 'WORKOUTS MISSED', value: String(data?.kpis.workoutsSkipped ?? 0) },
                    { label: 'TOTAL TRAINING TIME', value: formatMinutes(data?.kpis.totalTrainingMinutes ?? 0) },
                    { label: 'TOTAL DISTANCE', value: formatDistanceKm(data?.kpis.totalDistanceKm ?? 0) },
                  ]}
                  disciplineRows={(data?.disciplineLoad ?? []).map((row) => ({
                    discipline: row.discipline,
                    totalMinutes: row.totalMinutes,
                    rightValue: `${formatMinutes(row.totalMinutes)} · ${formatDistanceKm(row.totalDistanceKm)}`,
                  }))}
                />
              </div>

              <div className="min-w-0 lg:col-span-2">
                <StravaVitalsSummaryCard
                  comparison={data?.stravaVitals ?? null}
                  loading={loading && !data}
                  title={singleSelectedAthleteId ? 'Athlete Strava Vitals' : 'Squad Strava Vitals'}
                />
              </div>

              <div ref={reviewInboxRef} id="review-inbox" data-testid="coach-dashboard-review-inbox" className="min-w-0 lg:col-span-3">
                <Block
                  title="Review inbox"
                  className="h-full"
                  rightAction={
                    <Button size="sm" onClick={markSelectedReviewed} disabled={reviewingItems || selectedReviewCount === 0}>
                      Mark reviewed
                    </Button>
                  }
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className={cn(tokens.typography.meta, 'text-[var(--muted)]')}>Showing {visibleReviewInbox.length}</div>
                      <button
                        type="button"
                        className={cn('text-[var(--muted)] hover:text-[var(--text)]', tokens.typography.meta)}
                        onClick={clearReviewSelection}
                        disabled={selectedReviewCount === 0}
                      >
                        Clear
                      </button>
                    </div>

                    <div className="space-y-2">
                      {visibleReviewInbox.length === 0 ? (
                        <div className={cn('rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-structure)]/45', tokens.spacing.elementPadding, tokens.typography.bodyMuted)}>
                          No workouts currently match this review filter.
                        </div>
                      ) : (
                        visibleReviewInbox.map((item) => (
                          <label
                            key={item.id}
                            className={cn('flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]', tokens.spacing.elementPadding)}
                          >
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4"
                              checked={selectedReviewItemIds.has(item.id)}
                              onChange={() => toggleReviewItemSelection(item.id)}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-col items-start gap-1 md:flex-row md:items-start md:justify-between md:gap-3">
                                <div className={cn('md:truncate font-semibold', tokens.typography.body)} title={String(item.athlete?.name ?? 'Athlete')}>
                                  {String(item.athlete?.name ?? 'Athlete')}
                                </div>
                                <div className={cn('md:whitespace-nowrap text-[var(--muted)]', tokens.typography.meta)}>
                                  {formatReviewInboxDateShort(item.date, coachTimeZone)}
                                </div>
                              </div>
                              <div className={cn('mt-1 md:truncate text-[var(--text)]', tokens.typography.body)} title={String(item.title ?? '')}>
                                {String(item.title ?? '')}
                              </div>
                              <div className={cn('mt-1 flex items-center gap-2 text-[var(--muted)]', tokens.typography.meta)}>
                                <span>{String(item.discipline || 'OTHER').toUpperCase()}</span>
                                <span>•</span>
                                <span>{item.status === 'SKIPPED' ? 'Missed' : 'Completed'}</span>
                                {item.hasAthleteComment ? (
                                  <>
                                    <span>•</span>
                                    <span>
                                      {item.commentCount} comment{item.commentCount === 1 ? '' : 's'}
                                    </span>
                                  </>
                                ) : null}
                              </div>
                            </div>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                </Block>
              </div>

              <div className="min-w-0 lg:col-span-3">
                <Block
                  title="Event countdown"
                  padding={false}
                  showHeaderDivider={false}
                  className="border border-[#cad7eb] bg-[rgba(233,238,248,0.85)] dark:border-[#243047] dark:bg-[rgba(12,16,30,0.96)]"
                >
                  {loading && !data ? (
                    <div className={cn('space-y-3', tokens.spacing.containerPadding)}>
                      <div className={cn('text-[var(--muted)]', tokens.typography.body)}>
                        Loading athlete event countdowns...
                      </div>
                      <div className="space-y-2" aria-hidden="true">
                        {[0, 1].map((index) => (
                          <div key={`goal-countdown-loading-${index}`} className="space-y-2 rounded-xl bg-[var(--bg-card)]/60 px-3 py-2">
                            <div className="h-3 w-1/3 animate-pulse rounded bg-[var(--border-subtle)]" />
                            <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--border-subtle)]" />
                            <div className="h-1.5 w-full animate-pulse rounded-full bg-[var(--border-subtle)]" />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : visibleGoalCountdowns.length === 0 ? (
                    <div className={cn('text-[var(--muted)]', tokens.spacing.containerPadding, tokens.typography.body)}>
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
                          const progressRaw = Math.max(0, Math.min(100, Number(goal.progressPct ?? 0)));
                          const progress = goal.mode !== 'none' && !goal.isPast && !goal.isRaceDay ? Math.max(2, progressRaw) : progressRaw;
                          const weeksLabel =
                            typeof goal.weeksRemaining === 'number' && goal.weeksRemaining >= 0
                              ? `${goal.weeksRemaining} weeks to go`
                              : String(goal.label || 'Goal status');

                          return (
                            <div key={entry.athleteId} className={cn('space-y-1 px-3 py-2')}>
                              <div className="grid grid-cols-1 items-start gap-1 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-2">
                                <div className={cn('md:truncate text-[13px] font-medium', tokens.typography.body)} title={athleteName}>
                                  {athleteName}
                                </div>
                                <div className={cn('md:whitespace-nowrap text-right text-[12px] tabular-nums text-[var(--fg-muted)] dark:text-slate-300', tokens.typography.meta)}>
                                  {weeksLabel}
                                </div>
                              </div>
                              <div className="grid grid-cols-1 items-start gap-1 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-2">
                                <div className={cn('md:truncate text-[12px] text-[var(--fg-muted)] dark:text-slate-400', tokens.typography.meta)} title={eventName}>
                                  {eventName}
                                </div>
                                <div className={cn('md:whitespace-nowrap text-[12px] text-[var(--fg-muted)] dark:text-slate-400', tokens.typography.meta)}>{eventDate}</div>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bar-track)]">
                                <div className="h-full rounded-full bg-orange-500/70" style={{ width: `${progress}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </Block>
              </div>
            </div>
          </div>
        </div>

        {mobileSidebarOpen ? (
          <div className="md:hidden fixed inset-0 z-50">
            <button
              type="button"
              className="absolute inset-0 bg-black/35"
              aria-label="Close dashboard sidebar"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <aside
              ref={mobileSidebarRef}
              className="absolute left-0 top-0 h-full w-[min(90vw,320px)] border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-label="Dashboard sidebar"
              data-testid="coach-dashboard-sidebar-mobile"
            >
              <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3">
                <div className="text-sm font-semibold text-[var(--text)]">Dashboard sidebar</div>
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]"
                  onClick={() => setMobileSidebarOpen(false)}
                  aria-label="Close dashboard sidebar"
                >
                  <Icon name="close" size="md" aria-hidden />
                </button>
              </div>

              <div className="h-[calc(100%-56px)] overflow-y-auto px-3 py-3 space-y-4">
                <div>
                  <CoachDashboardChallengesPanel
                    activeChallenges={activeChallenges}
                    coachTimeZone={coachTimeZone}
                    onOpenChallenge={(challengeId) => {
                      setMobileSidebarOpen(false);
                      router.push(`/coach/challenges/${challengeId}` as never);
                    }}
                  />
                </div>

                <div className="border-t border-[var(--border-subtle)] pt-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Icon name="filter" size="sm" className="text-[var(--muted)]" aria-hidden />
                    <h2 className={cn(tokens.typography.blockTitle, 'text-xs')}>Make your selection</h2>
                  </div>
                  <CoachDashboardFiltersPanel
                    athleteOptions={athleteOptions}
                    selectedAthleteIds={selectedAthleteIds}
                    onAthleteIdsChange={(nextSelected) => {
                      if (nextSelected.size === 0 && athleteOptions.length > 0) {
                        setSelectedAthleteIds(new Set(athleteOptions.map((athlete) => athlete.userId)));
                        return;
                      }
                      setSelectedAthleteIds(nextSelected);
                    }}
                    discipline={discipline}
                    onDisciplineChange={setDiscipline}
                    disciplineOptions={disciplineOptions}
                    timeRange={timeRange}
                    onTimeRangeChange={setTimeRange}
                    customFrom={customFrom}
                    customTo={customTo}
                    onCustomFromChange={setCustomFrom}
                    onCustomToChange={setCustomTo}
                    dateRange={dateRange}
                    coachTimeZone={coachTimeZone}
                  />
                </div>
              </div>
            </aside>
          </div>
        ) : null}
      </section>
      <CoachOnboardingModal
        isOpen={showOnboardingModal}
        onClose={() => setShowOnboardingModal(false)}
        onComplete={() => {
          try {
            if (typeof window !== 'undefined') {
              window.localStorage.setItem('coachkit-coach-onboarding-complete', '1');
            }
          } catch {
            // noop
          }
          setShowOnboardingModal(false);
        }}
        request={request}
        initialTimezone={user?.timezone || 'Australia/Brisbane'}
        initialSquadName="CoachKit"
      />
    </>
  );
}

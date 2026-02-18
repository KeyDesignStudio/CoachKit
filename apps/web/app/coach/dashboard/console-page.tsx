'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { AskCard } from '@/components/knowledge/AskCard';
import { ReviewDrawer } from '@/components/coach/ReviewDrawer';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { SelectField } from '@/components/ui/SelectField';
import { Block } from '@/components/ui/Block';
import { BlockTitle } from '@/components/ui/BlockTitle';
import { FieldLabel } from '@/components/ui/FieldLabel';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { addDays, formatDisplayInTimeZone, toDateInput } from '@/lib/client-date';
import { cn } from '@/lib/cn';
import { tokens } from '@/components/ui/tokens';
import { getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';
import { getWarmWelcomeMessage } from '@/lib/user-greeting';

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
    rpe: number | null;
    painFlag: boolean;
    startTime: string;
  } | null;
  athlete: {
    id: string;
    name: string | null;
  } | null;
  comments: Array<{
    id: string;
    body: string;
    createdAt: string;
    author: {
      id: string;
      name: string | null;
      role: 'COACH' | 'ATHLETE';
    };
  }>;
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
  disciplineLoad: Array<{ discipline: string; totalMinutes: number; totalDistanceKm: number }>;
  reviewInbox: ReviewItem[];
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

function ReviewInboxRow({
  item,
  timeZone,
  isChecked,
  onToggleSelected,
  onOpen,
}: {
  item: ReviewItem;
  timeZone: string;
  isChecked: boolean;
  onToggleSelected: (id: string, checked: boolean) => void;
  onOpen: (item: ReviewItem) => void;
}) {
  const theme = getDisciplineTheme(item.discipline);
  const athleteName = item.athlete?.name ?? 'Unknown athlete';
  const disciplineLabel = (item.discipline || 'OTHER').toUpperCase();
  const painFlag = item.latestCompletedActivity?.painFlag ?? false;
  const isSkipped = item.status === 'SKIPPED';
  const isCompleted = item.status.startsWith('COMPLETED');

  function toDateKeyInTimeZone(dateIso: string, tz: string): string | null {
    const date = new Date(dateIso);
    if (Number.isNaN(date.getTime())) return null;

    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    const yyyy = parts.find((p) => p.type === 'year')?.value;
    const mm = parts.find((p) => p.type === 'month')?.value;
    const dd = parts.find((p) => p.type === 'day')?.value;
    if (!yyyy || !mm || !dd) return null;
    return `${yyyy}-${mm}-${dd}`;
  }

  function formatInboxDateLabel(dateKey: string, tz: string): string | null {
    const anchor = new Date(`${dateKey}T00:00:00.000Z`);
    if (Number.isNaN(anchor.getTime())) return null;

    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    }).formatToParts(anchor);

    const weekday = parts.find((p) => p.type === 'weekday')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    if (!weekday || !day || !month) return null;
    return `${weekday} ${day} ${month}`;
  }

  const completedDateKey = item.latestCompletedActivity?.startTime ? toDateKeyInTimeZone(item.latestCompletedActivity.startTime, timeZone) : null;
  const plannedDateKey = item.date || null;
  const displayDateKey = isCompleted ? (completedDateKey ?? plannedDateKey) : plannedDateKey;
  const dateLabel = displayDateKey ? formatInboxDateLabel(displayDateKey, timeZone) : null;

  const statusText = (item.status === 'SKIPPED' ? 'MISSED' : item.status)
    .replace('COMPLETED_', 'COMPLETED ')
    .replace(/_/g, ' ')
    .trim();

  return (
    <div className={cn("flex items-center min-w-0", tokens.spacing.widgetGap, tokens.spacing.elementPadding)}>
      <label className="h-11 w-11 flex items-center justify-center flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className="h-5 w-5 accent-blue-600"
          checked={isChecked}
          onChange={(e) => {
            e.stopPropagation();
            onToggleSelected(item.id, e.target.checked);
          }}
          aria-label={`Select ${athleteName} - ${item.title}`}
        />
      </label>

      {/* Mobile: compact row (checkbox, date, athlete, discipline icon only) */}
      <button
        type="button"
        onClick={() => onOpen(item)}
        className={cn(
          'md:hidden flex items-center min-w-0 flex-1 text-left justify-start min-h-[44px]',
          tokens.spacing.tinyGap
        )}
      >
        {dateLabel ? (
          <span className={cn('flex-shrink-0 whitespace-nowrap tabular-nums', tokens.typography.meta)}>{dateLabel}</span>
        ) : null}
        <span className={cn('block min-w-0 flex-1 truncate font-medium', tokens.typography.body)}>{athleteName}</span>
        <Icon name={theme.iconName} size="sm" className={cn('flex-shrink-0', theme.textClass)} aria-hidden />
      </button>

      <button
        type="button"
        onClick={() => onOpen(item)}
        className={cn(
          'hidden md:flex items-center min-w-0 flex-1 text-left justify-start min-h-[44px]',
          tokens.spacing.widgetGap,
          painFlag ? 'bg-rose-500/10 rounded-xl -mx-2' : ''
        )}
        style={painFlag ? { padding: '8px' } : undefined}
      >
        <span className={cn("block min-w-0 max-w-[30%] truncate font-medium", tokens.typography.body)}>{athleteName}</span>
        {dateLabel ? <span className={cn("flex-shrink-0 whitespace-nowrap", tokens.typography.meta)}>{dateLabel}</span> : null}
        <span className={cn("block min-w-0 flex-1 truncate", tokens.typography.body)}>{item.title}</span>

        <div className={cn("flex items-center flex-shrink-0 whitespace-nowrap", tokens.spacing.tinyGap)}>
          <Icon name={theme.iconName} size="sm" className={theme.textClass} />
          <span className={cn('uppercase font-medium', tokens.typography.meta, theme.textClass)}>{disciplineLabel}</span>
        </div>

        <div className={cn("flex items-center flex-shrink-0 whitespace-nowrap", tokens.spacing.tinyGap)}>
          <span className={cn('uppercase', painFlag ? 'text-rose-700 font-medium' : tokens.typography.meta)}>{statusText}</span>
          <div className={cn("flex items-center", tokens.spacing.tinyGap)}>
            {item.hasAthleteComment ? <Icon name="athleteComment" size="xs" className="text-blue-600" aria-label="Has athlete comment" aria-hidden={false} /> : null}
            {painFlag ? <Icon name="painFlag" size="xs" className="text-rose-500" aria-label="Pain flagged" aria-hidden={false} /> : null}
            {isSkipped ? <Icon name="skipped" size="xs" className={tokens.typography.meta} aria-label="Missed" aria-hidden={false} /> : null}
          </div>
        </div>
      </button>
    </div>
  );
}

export default function CoachDashboardConsolePage() {
  const { user, loading: userLoading, error: userError } = useAuthUser();
  const { request } = useApi();
  const router = useRouter();
  const welcomeMessage = useMemo(
    () => getWarmWelcomeMessage({ name: user?.name, timeZone: user?.timezone }),
    [user?.name, user?.timezone]
  );

  const [timeRange, setTimeRange] = useState<TimeRangePreset>('LAST_7');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [discipline, setDiscipline] = useState<string | null>(null);
  const [inboxPreset, setInboxPreset] = useState<InboxPreset>('ALL');

  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const [selectedItem, setSelectedItem] = useState<ReviewItem | null>(null);

  const reviewInboxRef = useRef<HTMLDivElement | null>(null);

  const needsCardRef = useRef<HTMLDivElement | null>(null);
  const [xlTopCardHeightPx, setXlTopCardHeightPx] = useState<number | null>(null);

  const coachTimeZone = user?.timezone ?? 'UTC';
  const dateRange = useMemo(() => getDateRangeFromPreset(timeRange, coachTimeZone, customFrom, customTo), [
    timeRange,
    coachTimeZone,
    customFrom,
    customTo,
  ]);

  const reload = useCallback(
    async (bypassCache = false) => {
      if (!user?.userId || user.role !== 'COACH') return;

      setLoading(true);
      setError('');

      const qs = new URLSearchParams();
      qs.set('from', dateRange.from);
      qs.set('to', dateRange.to);
      if (athleteId) qs.set('athleteId', athleteId);
      if (discipline) qs.set('discipline', discipline);
      if (bypassCache) qs.set('t', String(Date.now()));

      try {
        const resp = await request<DashboardResponse>(`/api/coach/dashboard/console?${qs.toString()}`, bypassCache ? { cache: 'no-store' } : undefined);
        setData(resp);
        setSelectedIds(new Set());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
      } finally {
        setLoading(false);
      }
    },
    [athleteId, dateRange.from, dateRange.to, discipline, request, user?.role, user?.userId]
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
  }, [dateRange.from, dateRange.to, athleteId, discipline]);

  const disciplineOptions = useMemo(() => {
    const set = new Set<string>();
    (data?.athletes ?? []).forEach((a) => (a.disciplines ?? []).forEach((d) => set.add((d || '').toUpperCase())));
    ['BIKE', 'RUN', 'SWIM', 'OTHER'].forEach((d) => set.add(d));
    return Array.from(set)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [data?.athletes]);

  const inboxItems = useMemo(() => {
    const items = data?.reviewInbox ?? [];
    if (inboxPreset === 'ALL' || inboxPreset === 'AWAITING_REVIEW') return items;
    if (inboxPreset === 'PAIN') return items.filter((i) => i.latestCompletedActivity?.painFlag);
    if (inboxPreset === 'COMMENTS') return items.filter((i) => i.hasAthleteComment);
    if (inboxPreset === 'SKIPPED') return items.filter((i) => i.status === 'SKIPPED');
    return items;
  }, [data?.reviewInbox, inboxPreset]);

  // Keep bulk selection aligned to the currently visible inbox dataset.
  useEffect(() => {
    const allowedIds = new Set(inboxItems.map((item) => item.id));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (allowedIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [inboxItems]);

  const selectedCount = selectedIds.size;

  const handleToggleSelected = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBulkMarkReviewed = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);

    setBulkLoading(true);
    setError('');
    try {
      await request('/api/coach/review-inbox/bulk-review', {
        method: 'POST',
        data: { ids },
      });

      setData((prev) => {
        if (!prev) return prev;
        const nextInbox = prev.reviewInbox.filter((item) => !selectedIds.has(item.id));
        return {
          ...prev,
          attention: {
            ...prev.attention,
            awaitingCoachReview: Math.max(0, prev.attention.awaitingCoachReview - selectedIds.size),
          },
          reviewInbox: nextInbox,
        };
      });

      clearSelection();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to bulk mark reviewed.');
    } finally {
      setBulkLoading(false);
    }
  }, [clearSelection, request, selectedIds]);

  const markReviewed = useCallback(
    async (id: string) => {
      await request(`/api/coach/calendar-items/${id}/review`, { method: 'POST' });
      await reload(true);
    },
    [reload, request]
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
          <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-4">
            <h1 className={tokens.typography.h1}>Coach Console</h1>
            <p className={cn(tokens.typography.h1, "justify-self-center text-center italic opacity-90")}>{welcomeMessage}</p>
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
                    <SelectField
                      className="min-h-[44px]"
                      value={athleteId ?? ''}
                      onChange={(e) => setAthleteId(e.target.value ? e.target.value : null)}
                    >
                      <option value="">All athletes</option>
                      {(data?.athletes ?? []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name ?? 'Unnamed athlete'}
                        </option>
                      ))}
                    </SelectField>
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

        <div className="mt-6">
          <AskCard />
        </div>


        {/* Review Inbox + Notifications split (desktop/tablet); centered on page */}
        <div className="mt-10 mx-auto w-full px-4 md:px-0 md:max-w-[50%] md:min-w-[340px]">
          {/* Review inbox */}
          <div ref={reviewInboxRef} id="review-inbox" data-testid="coach-dashboard-review-inbox">
            {/* Preserve vertical rhythm from the prior layout (title used to sit above the card). */}
            <div className="mb-2" aria-hidden="true">
              <div className="h-4" />
            </div>

            <Block title="Review inbox" padding={false} showHeaderDivider={false}>
              <div
                className={cn(
                  "flex items-center justify-between border-b border-[var(--border-subtle)]",
                  tokens.spacing.elementPadding,
                  tokens.spacing.widgetGap
                )}
              >
                <div className={cn("text-[var(--muted)]", tokens.typography.meta)}>
                  Showing <span className="font-medium text-[var(--text)] tabular-nums">{inboxItems.length}</span>
                  {inboxPreset !== 'ALL' && inboxPreset !== 'AWAITING_REVIEW' ? <span className="ml-2">(focused)</span> : null}
                </div>
                <div className={cn("flex items-center", tokens.spacing.widgetGap)}>
                  <Button type="button" onClick={handleBulkMarkReviewed} disabled={bulkLoading || selectedCount === 0} className="min-h-[44px]">
                    {bulkLoading ? 'Marking…' : `Mark Reviewed${selectedCount ? ` (${selectedCount})` : ''}`}
                  </Button>
                  <Button type="button" variant="ghost" onClick={clearSelection} disabled={selectedCount === 0} className="min-h-[44px]">
                    Clear
                  </Button>
                </div>
              </div>

              {loading ? <div className={cn("text-[var(--muted)]", tokens.spacing.containerPadding, tokens.typography.body)}>Loading…</div> : null}
              {!loading && inboxItems.length === 0 ? <div className={cn("text-[var(--muted)]", tokens.spacing.containerPadding, tokens.typography.body)}>Nothing to review for this range.</div> : null}

              <div className="divide-y divide-[var(--border-subtle)]">
                {inboxItems.map((item) => (
                  <ReviewInboxRow
                    key={item.id}
                    item={item}
                    timeZone={coachTimeZone}
                    isChecked={selectedIds.has(item.id)}
                    onToggleSelected={handleToggleSelected}
                    onOpen={(it) => setSelectedItem(it)}
                  />
                ))}
              </div>
            </Block>
          </div>
        </div>
      </section>

      <ReviewDrawer
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onMarkReviewed={markReviewed}
        showSessionTimes={false}
        timeZone={coachTimeZone}
      />
    </>
  );
}

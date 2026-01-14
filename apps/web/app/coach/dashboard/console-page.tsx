'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { ReviewDrawer } from '@/components/coach/ReviewDrawer';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Select } from '@/components/ui/Select';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { uiH1, uiMuted } from '@/components/ui/typography';
import { addDays, formatDisplayInTimeZone, toDateInput } from '@/lib/client-date';
import { cn } from '@/lib/cn';
import { getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';

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
  athleteSummaries: Array<{
    athleteId: string;
    name: string | null;
    completedCount: number;
    skippedCount: number;
    totalMinutes: number;
    disciplinesPresent: string[];
    painFlagCount: number;
    athleteCommentCount: number;
  }>;
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
  if (value === 0) return '0 km';
  if (value < 10) return `${value.toFixed(1)} km`;
  return `${Math.round(value)} km`;
}

function formatCalendarDayLabel(dateIso: string, timeZone: string): string {
  const formatted = formatDisplayInTimeZone(dateIso, timeZone);
  return formatted.split(',')[1]?.trim() || formatted;
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
        'w-full rounded-2xl px-4 py-3 text-left min-h-[56px]',
        'transition-colors',
        active ? 'ring-2 ring-[var(--ring)]' : 'hover:bg-white/60',
        toneClasses
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm font-medium">{label}</div>
        <div className={cn('text-2xl font-semibold tabular-nums', tone === 'danger' ? 'text-rose-700' : '')}>{count}</div>
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
        'w-full rounded-2xl px-4 py-3 text-left min-h-[56px]',
        'bg-[var(--bg-card)] border border-black/15 transition-colors',
        active ? 'ring-2 ring-[var(--ring)]' : 'hover:bg-white/60'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-[var(--text)]">{label}</div>
        <div className="text-2xl font-semibold tabular-nums text-[var(--text)]">{count}</div>
      </div>
    </button>
  );
}

function ReviewInboxRow({
  item,
  isChecked,
  onToggleSelected,
  onOpen,
}: {
  item: ReviewItem;
  isChecked: boolean;
  onToggleSelected: (id: string, checked: boolean) => void;
  onOpen: (item: ReviewItem) => void;
}) {
  const theme = getDisciplineTheme(item.discipline);
  const athleteName = item.athlete?.name ?? 'Unknown athlete';
  const disciplineLabel = (item.discipline || 'OTHER').toUpperCase();
  const painFlag = item.latestCompletedActivity?.painFlag ?? false;
  const isSkipped = item.status === 'SKIPPED';

  const statusText = item.status
    .replace('COMPLETED_', 'COMPLETED ')
    .replace(/_/g, ' ')
    .trim();

  return (
    <div className="flex items-center gap-2 px-3 py-2 min-w-0">
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

      <button
        type="button"
        onClick={() => onOpen(item)}
        className={cn(
          'flex items-center gap-2 min-w-0 flex-1 text-left justify-start min-h-[44px]',
          painFlag ? 'bg-rose-500/10 rounded-xl px-2 py-2 -mx-2' : ''
        )}
      >
        <span className="block min-w-0 max-w-[30%] truncate text-sm font-medium text-[var(--text)]">{athleteName}</span>
        <span className="block min-w-0 max-w-[45%] truncate text-sm text-[var(--text)]">{item.title}</span>

        <div className="flex items-center gap-1 flex-shrink-0 whitespace-nowrap">
          <Icon name={theme.iconName} size="sm" className={theme.textClass} />
          <span className={cn('text-xs uppercase text-[var(--muted)] font-medium', theme.textClass)}>{disciplineLabel}</span>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0 whitespace-nowrap">
          <span className={cn('text-xs uppercase', painFlag ? 'text-rose-700 font-medium' : 'text-[var(--muted)]')}>{statusText}</span>
          <div className="flex items-center gap-1">
            {item.hasAthleteComment ? <Icon name="athleteComment" size="xs" className="text-blue-600" aria-label="Has athlete comment" aria-hidden={false} /> : null}
            {painFlag ? <Icon name="painFlag" size="xs" className="text-rose-500" aria-label="Pain flagged" aria-hidden={false} /> : null}
            {isSkipped ? <Icon name="skipped" size="xs" className="text-[var(--muted)]" aria-label="Skipped" aria-hidden={false} /> : null}
          </div>
        </div>
      </button>
    </div>
  );
}

export default function CoachDashboardConsolePage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();

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

  if (userLoading) {
    return (
      <div className="px-6 pt-6">
        <p className="text-[var(--muted)]">Loading...</p>
      </div>
    );
  }

  if (!user || user.role !== 'COACH') {
    return (
      <div className="px-6 pt-6">
        <p className="text-[var(--muted)]">Coach access required.</p>
      </div>
    );
  }

  return (
    <>
      <section className="px-4 pb-10 md:px-6">
        <div className="pt-3 md:pt-6">
          <h1 className={cn(uiH1, 'font-semibold')}>Coach Console</h1>
        </div>

        {/* Top grid shell: mobile 1 col (Needs → Filters → At a glance), tablet 2 cols (Needs + Filters, then At a glance), desktop 3 cols */}
        <div className="mt-3 grid grid-cols-1 gap-4 min-w-0 items-start md:mt-4 md:gap-6 md:grid-cols-2 xl:grid-cols-3">
          {/* Column 1: Needs your attention */}
          <div className="min-w-0 md:order-2">
            <div ref={needsCardRef} className="rounded-2xl bg-[var(--bg-card)] p-3 md:p-4">
              <div className="flex items-end justify-between gap-3 mb-2">
                <h2 className="text-sm font-semibold text-[var(--text)]">Needs your attention</h2>
                <div className="text-xs text-[var(--muted)]">Tap to focus inbox</div>
              </div>

              <div className="grid gap-2">
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

              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <AlertStripItem
                  label="Skipped workouts"
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
            </div>
          </div>

          {/* Column 2: Filters/selectors */}
          <div className="min-w-0 md:order-1">
            <div
              className="rounded-2xl bg-[var(--bg-card)] p-3"
              style={xlTopCardHeightPx ? { height: `${xlTopCardHeightPx}px` } : undefined}
            >
              <div className="flex items-end justify-between gap-3 mb-2">
                <h2 className="text-sm font-semibold text-[var(--text)]">Make your selection</h2>
                <div className="text-xs text-[var(--muted)]" aria-hidden="true" />
              </div>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-x-4 md:gap-y-3">
                {/* Row 1 */}
                <div className="md:col-start-1 md:row-start-1">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mb-0.5 leading-none">Athlete</div>
                  <Select className="min-h-[44px]" value={athleteId ?? ''} onChange={(e) => setAthleteId(e.target.value ? e.target.value : null)}>
                    <option value="">All athletes</option>
                    {(data?.athletes ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name ?? 'Unnamed athlete'}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="md:col-start-2 md:row-start-1">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mb-0.5 leading-none">Discipline (optional)</div>
                  <Select className="min-h-[44px]" value={discipline ?? ''} onChange={(e) => setDiscipline(e.target.value ? e.target.value : null)}>
                    <option value="">All disciplines</option>
                    {disciplineOptions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
                </div>

                {/* Row 2 */}
                <div className="md:col-start-1 md:row-start-2">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mb-0.5 leading-none">Time range</div>
                  <Select className="min-h-[44px]" value={timeRange} onChange={(e) => setTimeRange(e.target.value as TimeRangePreset)}>
                    <option value="LAST_7">Last 7 days</option>
                    <option value="LAST_14">Last 14 days</option>
                    <option value="LAST_30">Last 30 days</option>
                    <option value="CUSTOM">Custom</option>
                  </Select>

                  {timeRange === 'CUSTOM' ? (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mb-0.5 leading-none">From</div>
                        <input
                          type="date"
                          className="w-full min-h-[44px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-2 text-sm text-[var(--text)]"
                          value={customFrom}
                          onChange={(e) => setCustomFrom(e.target.value)}
                        />
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mb-0.5 leading-none">To</div>
                        <input
                          type="date"
                          className="w-full min-h-[44px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-2 text-sm text-[var(--text)]"
                          value={customTo}
                          onChange={(e) => setCustomTo(e.target.value)}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="md:col-start-2 md:row-start-2">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mb-0.5 leading-none">&nbsp;</div>
                  <div className="min-h-[44px] flex items-center">
                    <div className="text-sm font-semibold text-[var(--text)]">
                      {formatCalendarDayLabel(dateRange.from, coachTimeZone)} → {formatCalendarDayLabel(dateRange.to, coachTimeZone)}
                    </div>
                  </div>
                </div>

                {/* Row 3 gap */}
                <div className="col-span-1 md:col-span-2 h-2 md:h-3" aria-hidden="true" />

                {/* Row 4 */}
                <div className="md:col-span-2 flex items-center justify-end gap-3">
                  <Button type="button" variant="secondary" onClick={() => reload(true)} className="min-h-[44px]">
                    <Icon name="refresh" size="sm" className="mr-1" aria-hidden />
                    Refresh
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Column 3: At a glance (stacks vertically); on tablet sits below and spans full width */}
          <div className="min-w-0 md:order-3 md:col-span-2 xl:col-span-1">
            <div
              className="rounded-2xl bg-[var(--bg-card)] p-3"
              data-testid="coach-dashboard-at-a-glance"
              style={xlTopCardHeightPx ? { height: `${xlTopCardHeightPx}px` } : undefined}
            >
              <div className="flex items-end justify-between gap-3 mb-2">
                <h2 className="text-sm font-semibold text-[var(--text)]">At a glance</h2>
                <div className="text-xs text-[var(--muted)]" aria-hidden="true" />
              </div>

              <div
                className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-x-6 gap-y-4 md:gap-x-10 md:gap-y-6"
                data-testid="coach-dashboard-at-a-glance-grid"
              >
                {[
                  { label: 'Workouts completed', value: String(data?.kpis.workoutsCompleted ?? 0) },
                  { label: 'Workouts skipped', value: String(data?.kpis.workoutsSkipped ?? 0) },
                  { label: 'Total training time', value: formatMinutes(data?.kpis.totalTrainingMinutes ?? 0) },
                  { label: 'Total distance', value: formatDistanceKm(data?.kpis.totalDistanceKm ?? 0) },
                ].map((tile) => (
                  <div key={tile.label} className="min-w-0 rounded-2xl bg-[var(--bg-structure)]/50 px-3 py-2">
                    <div className="text-[22px] min-[420px]:text-[24px] lg:text-[26px] leading-[1.05] font-semibold tabular-nums text-[var(--text)]">
                      {tile.value}
                    </div>
                    <div
                      className="min-w-0 text-[10px] md:text-[11px] leading-snug uppercase tracking-wide text-[var(--muted)]/90 whitespace-nowrap overflow-hidden text-ellipsis"
                      title={tile.label}
                    >
                      {tile.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {error ? <div className="mt-4 rounded-2xl bg-rose-500/10 text-rose-700 p-4 text-sm">{error}</div> : null}

        {/* Priority order on mobile: Title → Filters → Needs → KPIs → Load → Accountability → Inbox */}

        {/* Discipline load + Review inbox */}
        <div className="mt-6 grid grid-cols-1 gap-6 min-w-0 items-start md:grid-cols-2">
          {/* Column 1: Review inbox */}
          <div className="min-w-0" ref={reviewInboxRef} id="review-inbox">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h2 className="text-sm font-semibold text-[var(--text)]">Review inbox</h2>
              <div className="text-xs uppercase tracking-wide text-[var(--muted)]">FILTER APPLIED: UNREVIEWED COMPLETED + SKIPPED</div>
            </div>

            <div className="rounded-3xl bg-[var(--bg-structure)]/60 p-4 md:p-5">
              <div className="rounded-2xl bg-[var(--bg-card)] overflow-hidden">
                <div className="px-3 py-2 flex items-center justify-between gap-3 border-b border-black/5">
                  <div className="text-xs text-[var(--muted)]">
                    Showing <span className="font-medium text-[var(--text)] tabular-nums">{inboxItems.length}</span>
                    {inboxPreset !== 'ALL' && inboxPreset !== 'AWAITING_REVIEW' ? <span className="ml-2">(focused)</span> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" onClick={handleBulkMarkReviewed} disabled={bulkLoading || selectedCount === 0} className="min-h-[44px]">
                      {bulkLoading ? 'Marking…' : `Mark Reviewed${selectedCount ? ` (${selectedCount})` : ''}`}
                    </Button>
                    <Button type="button" variant="ghost" onClick={clearSelection} disabled={selectedCount === 0} className="min-h-[44px]">
                      Clear
                    </Button>
                  </div>
                </div>

                {loading ? <div className="px-4 py-6 text-sm text-[var(--muted)]">Loading…</div> : null}
                {!loading && inboxItems.length === 0 ? <div className="px-4 py-6 text-sm text-[var(--muted)]">Nothing to review for this range.</div> : null}

                <div className="divide-y divide-black/5">
                  {inboxItems.map((item) => (
                    <ReviewInboxRow
                      key={item.id}
                      item={item}
                      isChecked={selectedIds.has(item.id)}
                      onToggleSelected={handleToggleSelected}
                      onOpen={(it) => setSelectedItem(it)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Column 2: Discipline load */}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--text)] mb-2">Discipline load</h2>
            <div className="rounded-2xl bg-[var(--bg-card)] p-3">
              {(() => {
                const rows = data?.disciplineLoad ?? [];
                const maxMinutes = Math.max(1, ...rows.map((r) => r.totalMinutes));
                return (
                  <div className="flex flex-col gap-2">
                    {rows.map((r) => {
                      const theme = getDisciplineTheme(r.discipline);
                      const pct = Math.round((r.totalMinutes / maxMinutes) * 100);
                      return (
                        <div key={r.discipline} className="grid grid-cols-[auto,1fr,auto] items-center gap-2">
                          <div className="flex items-center gap-2 min-w-[72px]">
                            <Icon name={theme.iconName} size="sm" className={theme.textClass} />
                            <span className="text-xs font-medium text-[var(--text)]">{r.discipline}</span>
                          </div>

                          <div className="h-2 rounded-full bg-black/10 overflow-hidden">
                            <div className={cn('h-full rounded-full', theme.textClass.replace('text-', 'bg-'))} style={{ width: `${pct}%` }} />
                          </div>

                          <div className="text-xs text-[var(--muted)] tabular-nums text-right">
                            {formatMinutes(r.totalMinutes)} · {formatDistanceKm(r.totalDistanceKm)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </section>

      <ReviewDrawer item={selectedItem} onClose={() => setSelectedItem(null)} onMarkReviewed={markReviewed} showSessionTimes={false} />
    </>
  );
}

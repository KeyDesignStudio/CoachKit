'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { ReviewDrawer } from '@/components/coach/ReviewDrawer';
import { MonthGrid } from '@/components/coach/MonthGrid';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { Icon } from '@/components/ui/Icon';
import { Select } from '@/components/ui/Select';
import { SkeletonMonthGrid } from '@/components/calendar/SkeletonMonthGrid';
import { SkeletonReviewList } from '@/components/dashboard/SkeletonReviewList';
import { addDays, formatDisplay, toDateInput } from '@/lib/client-date';
import { cn } from '@/lib/cn';
import { getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';
import { CALENDAR_ACTION_ICON_CLASS } from '@/components/calendar/iconTokens';

type CommentRecord = {
  id: string;
  body: string;
  createdAt: string;
  author: {
    id: string;
    name: string | null;
    role: 'COACH' | 'ATHLETE';
  };
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
  comments: CommentRecord[];
  hasAthleteComment: boolean;
  commentCount: number;
};

type ViewMode = 'list' | 'calendar';

function SelectAllGroupHeader({
  title,
  count,
  groupIds,
  selectedIds,
  onToggle,
}: {
  title: string;
  count: number;
  groupIds: string[];
  selectedIds: Set<string>;
  onToggle: (groupIds: string[], allSelected: boolean) => void;
}) {
  const checkboxRef = useRef<HTMLInputElement | null>(null);

  const selectedInGroupCount = useMemo(() => {
    if (groupIds.length === 0) return 0;
    let count = 0;
    groupIds.forEach((id) => {
      if (selectedIds.has(id)) count += 1;
    });
    return count;
  }, [groupIds, selectedIds]);

  const allSelected = groupIds.length > 0 && selectedInGroupCount === groupIds.length;
  const noneSelected = selectedInGroupCount === 0;
  const indeterminate = !noneSelected && !allSelected;

  useEffect(() => {
    if (!checkboxRef.current) return;
    checkboxRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <div className="flex items-center justify-between gap-3 mb-2">
      <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
        {title} ({count})
      </h2>

      <div className="flex items-center">
        <label
          className={cn(
            'flex items-center gap-2 rounded-lg px-2 min-h-[44px]',
            'text-xs font-medium text-[var(--muted)]',
            groupIds.length === 0 ? 'opacity-60' : 'cursor-pointer'
          )}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <input
            ref={checkboxRef}
            type="checkbox"
            className="h-4 w-4 accent-blue-600"
            checked={allSelected}
            disabled={groupIds.length === 0}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onToggle(groupIds, allSelected);
            }}
            aria-label={`Select all in ${title}`}
          />
          <span>Select all</span>
        </label>
      </div>
    </div>
  );
}

function getMonthGridStartUtc(year: number, monthIndex: number): Date {
  const firstDayUtc = new Date(Date.UTC(year, monthIndex, 1));
  const dayOfWeek = firstDayUtc.getUTCDay(); // 0 = Sunday
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  return new Date(Date.UTC(year, monthIndex, 1 + mondayOffset));
}

function getMonthGridDaysUtc(year: number, monthIndex: number): Date[] {
  const start = getMonthGridStartUtc(year, monthIndex);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function getDisplayDateLabel(dateKey: string): string {
  return formatDisplay(dateKey);
}

function getAthletePrefix(name?: string | null): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'Unknown';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const lastInitial = parts[parts.length - 1]?.[0];
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

function getDateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  if (!year || !month || !day) {
    return date.toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

export default function CoachDashboardPage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();
  const didInitFromTimezone = useRef(false);
  const didInitAthleteFilter = useRef(false);
  const perfFrameMarked = useRef(false);
  const perfDataMarked = useRef(false);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<ReviewItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [athleteFilterId, setAthleteFilterId] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() };
  });

  // Initialize default month + restore last-used view.
  useEffect(() => {
    if (!user?.timezone) return;
    if (didInitFromTimezone.current) return;

    const storedView = typeof window !== 'undefined' ? (localStorage.getItem('coach-review-view') as ViewMode | null) : null;
    if (storedView === 'list' || storedView === 'calendar') {
      setViewMode(storedView);
    }

    const todayKey = getZonedDateKeyForNow(user.timezone);
    const todayUtcMidnight = new Date(`${todayKey}T00:00:00.000Z`);
    setCalendarMonth({ year: todayUtcMidnight.getUTCFullYear(), month: todayUtcMidnight.getUTCMonth() });
    didInitFromTimezone.current = true;
  }, [user?.timezone]);

  // Restore persisted athlete filter (shared by list + calendar).
  useEffect(() => {
    if (!user?.userId) return;
    if (didInitAthleteFilter.current) return;
    if (typeof window === 'undefined') return;

    const key = 'coachkit.reviewInbox.calendarAthleteFilter';
    const stored = localStorage.getItem(key);
    setAthleteFilterId(stored ? stored : null);

    didInitAthleteFilter.current = true;
  }, [user?.userId]);

  const setAndPersistAthleteFilterId = useCallback((next: string | null) => {
    setAthleteFilterId(next);
    if (typeof window !== 'undefined') {
      const key = 'coachkit.reviewInbox.calendarAthleteFilter';
      if (!next) localStorage.removeItem(key);
      else localStorage.setItem(key, next);
    }
  }, []);

  const todayKey = useMemo(() => {
    if (!user?.timezone) return null;
    return getZonedDateKeyForNow(user.timezone);
  }, [user?.timezone]);

  const yesterdayKey = useMemo(() => {
    if (!todayKey) return null;
    const todayUtcMidnight = new Date(`${todayKey}T00:00:00.000Z`);
    return toDateInput(addDays(todayUtcMidnight, -1));
  }, [todayKey]);

  const loadItems = useCallback(async (bypassCache = false) => {
    if (!user?.userId) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const url = bypassCache ? `/api/coach/review-inbox?t=${Date.now()}` : `/api/coach/review-inbox`;
      const data = await request<{ items: ReviewItem[] }>(url, bypassCache ? { cache: 'no-store' } : undefined);
      setItems(data.items);
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inbox.');
    } finally {
      setLoading(false);

      if (process.env.NODE_ENV !== 'production' && perfFrameMarked.current && !perfDataMarked.current) {
        perfDataMarked.current = true;
        try {
          performance.mark('coach-dashboard-data');
          performance.measure('coach-dashboard-load', 'coach-dashboard-frame', 'coach-dashboard-data');
        } catch {
          // noop
        }
      }
    }
  }, [request, user?.userId]);

  useEffect(() => {
    if (user?.role === 'COACH') {
      loadItems();
    }
  }, [loadItems, user?.role]);

  const markReviewed = useCallback(
    async (id: string) => {
      try {
        await request(`/api/coach/calendar-items/${id}/review`, { method: 'POST' });
        await loadItems();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to mark reviewed.');
        throw err;
      }
    },
    [request, loadItems]
  );

  const toggleViewMode = useCallback((next: ViewMode) => {
    setViewMode(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('coach-review-view', next);
    }
  }, []);

  const filteredItems = useMemo(() => {
    if (!athleteFilterId) return items;
    return items.filter((item) => item.athlete?.id === athleteFilterId);
  }, [athleteFilterId, items]);

  // Keep bulk selection aligned to the currently visible (filtered) dataset.
  useEffect(() => {
    const allowedIds = new Set(filteredItems.map((item) => item.id));
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
  }, [filteredItems]);

  const groupedListItems = useMemo(() => {
    const today: ReviewItem[] = [];
    const yesterday: ReviewItem[] = [];
    const earlier: ReviewItem[] = [];

    const coachTz = user?.timezone ?? 'UTC';

    filteredItems.forEach((item) => {
      const actionDateKey = getDateKeyInTimeZone(new Date(item.actionAt), coachTz);
      if (todayKey && actionDateKey === todayKey) {
        today.push(item);
        return;
      }
      if (yesterdayKey && actionDateKey === yesterdayKey) {
        yesterday.push(item);
        return;
      }
      earlier.push(item);
    });

    const sortByActionAtDesc = (a: ReviewItem, b: ReviewItem) =>
      new Date(b.actionAt).getTime() - new Date(a.actionAt).getTime();

    today.sort(sortByActionAtDesc);
    yesterday.sort(sortByActionAtDesc);
    earlier.sort(sortByActionAtDesc);

    const earlierByDate = new Map<string, ReviewItem[]>();
    earlier.forEach((item) => {
      const actionDateKey = getDateKeyInTimeZone(new Date(item.actionAt), coachTz);
      if (!earlierByDate.has(actionDateKey)) earlierByDate.set(actionDateKey, []);
      earlierByDate.get(actionDateKey)!.push(item);
    });
    Array.from(earlierByDate.values()).forEach((arr) => arr.sort(sortByActionAtDesc));

    const earlierDateKeys = Array.from(earlierByDate.keys()).sort((a, b) => b.localeCompare(a));

    return {
      today,
      yesterday,
      earlierByDate,
      earlierDateKeys,
    };
  }, [filteredItems, todayKey, yesterdayKey, user?.timezone]);

  const monthDays = useMemo(() => {
    return getMonthGridDaysUtc(calendarMonth.year, calendarMonth.month);
  }, [calendarMonth.year, calendarMonth.month]);

  const calendarItems = filteredItems;

  const athleteFilterOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    items.forEach((item) => {
      if (!item.athlete?.id) return;
      map.set(item.athlete.id, { id: item.athlete.id, name: (item.athlete.name ?? 'Unknown athlete').trim() || 'Unknown athlete' });
    });
    const options = Array.from(map.values());
    options.sort((a, b) => a.name.localeCompare(b.name));
    return options;
  }, [items]);

  const itemsByActionDate = useMemo(() => {
    const grouped = new Map<string, ReviewItem[]>();
    const coachTz = user?.timezone ?? 'UTC';
    calendarItems.forEach((item) => {
      const actionDateKey = getDateKeyInTimeZone(new Date(item.actionAt), coachTz);
      if (!grouped.has(actionDateKey)) grouped.set(actionDateKey, []);
      grouped.get(actionDateKey)!.push(item);
    });
    grouped.forEach((arr) => {
      arr.sort((a, b) => new Date(b.actionAt).getTime() - new Date(a.actionAt).getTime());
    });
    return grouped;
  }, [calendarItems, user?.timezone]);

  const visibleMonthItemCount = useMemo(() => {
    const keys = monthDays
      .filter((d) => d.getUTCMonth() === calendarMonth.month)
      .map((d) => toDateInput(d));
    let count = 0;
    keys.forEach((key) => {
      count += itemsByActionDate.get(key)?.length ?? 0;
    });
    return count;
  }, [calendarMonth.month, itemsByActionDate, monthDays]);

  const selectedCount = selectedIds.size;

  const handleToggleSelected = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleToggleGroupSelectAll = useCallback((groupIds: string[], allSelected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        groupIds.forEach((id) => next.delete(id));
        return next;
      }
      groupIds.forEach((id) => next.add(id));
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

      setItems((prev) => prev.filter((item) => !selectedIds.has(item.id)));
      clearSelection();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to bulk mark reviewed.');
    } finally {
      setBulkLoading(false);
    }
  }, [request, selectedIds, clearSelection]);

  const navigateMonth = useCallback((deltaMonths: number) => {
    setCalendarMonth((prev) => {
      const nextDate = new Date(Date.UTC(prev.year, prev.month + deltaMonths, 1));
      return { year: nextDate.getUTCFullYear(), month: nextDate.getUTCMonth() };
    });
  }, []);

  // Dev-only perf marks
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (perfFrameMarked.current) return;
    perfFrameMarked.current = true;
    try {
      performance.mark('coach-dashboard-frame');
    } catch {
      // noop
    }
  }, []);

  if (!userLoading && (!user || user.role !== 'COACH')) {
    return <p className="text-[var(--muted)]">Coach access required.</p>;
  }

  const showSkeleton = userLoading || loading;

  return (
    <section className="flex flex-col gap-6" data-coach-dashboard-version="review-inbox-v2">
      <header className="flex flex-col gap-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-4 md:px-6 md:py-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs md:text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Coach Review</p>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Inbox</h1>
            <p className="text-xs md:text-sm text-[var(--muted)]">Only unreviewed athlete actions (completed or skipped).</p>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
            <div className="flex items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-1 w-full md:w-auto">
              <button
                type="button"
                onClick={() => toggleViewMode('list')}
                className={cn(
                  'rounded-lg px-3 py-2 text-xs md:text-sm font-medium transition-colors min-h-[44px] flex-1 md:flex-initial',
                  viewMode === 'list'
                    ? 'bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--foreground)]'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                )}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => toggleViewMode('calendar')}
                className={cn(
                  'rounded-lg px-3 py-2 text-xs md:text-sm font-medium transition-colors min-h-[44px] flex-1 md:flex-initial',
                  viewMode === 'calendar'
                    ? 'bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--foreground)]'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                )}
              >
                Calendar
              </button>
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <Button
                type="button"
                variant="ghost"
                onClick={() => loadItems(true)}
                disabled={loading}
                className="w-full md:w-auto min-h-[44px]"
              >
                <Icon name="refresh" size="sm" className="md:mr-1" />
                <span className="hidden md:inline">Refresh</span>
              </Button>
            </div>
          </div>
        </div>

        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        {loading ? <p className="text-sm text-[var(--muted)]">Loading review inbox...</p> : null}
      </header>

      {items.length === 0 && !loading ? (
        <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
          <p className="text-lg text-[var(--muted)]">No workouts awaiting review.</p>
        </div>
      ) : null}

      {showSkeleton && viewMode === 'list' ? (
        <SkeletonReviewList rows={6} />
      ) : viewMode === 'list' ? (
        <div className="space-y-6">
          <div className="flex items-center justify-end">
            <div className="flex items-center gap-3">
              <div className="hidden sm:block text-xs text-[var(--muted)]">Athlete</div>
              <Select
                className="min-h-[44px] w-[220px]"
                value={athleteFilterId ?? ''}
                onChange={(e) => setAndPersistAthleteFilterId(e.target.value || null)}
                aria-label="Athlete filter"
              >
                <option value="">All athletes</option>
                {athleteFilterOptions.map((ath) => (
                  <option key={ath.id} value={ath.id}>
                    {ath.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {items.length > 0 && filteredItems.length === 0 ? (
            <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
              <p className="text-sm text-[var(--muted)]">No workouts awaiting review for this athlete.</p>
            </div>
          ) : null}

          {groupedListItems.today.length > 0 ? (
            <section>
              <SelectAllGroupHeader
                title="Today"
                count={groupedListItems.today.length}
                groupIds={groupedListItems.today.map((i) => i.id)}
                selectedIds={selectedIds}
                onToggle={handleToggleGroupSelectAll}
              />
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] divide-y divide-[var(--border-subtle)]">
                {groupedListItems.today.map((item) => {
                  const theme = getDisciplineTheme(item.discipline);
                  const athleteName = item.athlete?.name ?? 'Unknown athlete';
                  const disciplineLabel = (item.discipline || 'OTHER').toUpperCase();
                  const isChecked = selectedIds.has(item.id);
                  const painFlag = item.latestCompletedActivity?.painFlag ?? false;
                  const isSkipped = item.status === 'SKIPPED';
                  return (
                    <div key={item.id} className="flex items-start gap-3 px-3 py-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-blue-600"
                        checked={isChecked}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleToggleSelected(item.id, e.target.checked);
                        }}
                        aria-label={`Select ${athleteName} - ${item.title}`}
                      />
                      <button type="button" onClick={() => setSelectedItem(item)} className="flex-1 min-w-0 text-left">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[var(--text)] truncate">{athleteName}</p>
                            <p className="text-xs text-[var(--text)] truncate mt-0.5">{item.title}</p>
                            <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--muted)]">
                              <span className="inline-flex items-center gap-1">
                                <Icon name={theme.iconName} size="sm" className={theme.textClass} />
                                <span className={cn('font-medium', theme.textClass)}>{disciplineLabel}</span>
                              </span>
                              <Badge className="hidden sm:inline-flex">{item.status.replace(/_/g, ' ')}</Badge>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
                            {item.hasAthleteComment ? (
                              <Icon name="athleteComment" size="xs" className={`text-blue-600 ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Has athlete comment" aria-hidden={false} />
                            ) : null}
                            {painFlag ? (
                              <Icon name="painFlag" size="xs" className={`text-rose-500 ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Pain flagged" aria-hidden={false} />
                            ) : null}
                            {isSkipped ? (
                              <Icon name="skipped" size="xs" className={`text-[var(--muted)] ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Skipped" aria-hidden={false} />
                            ) : null}
                          </div>
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {groupedListItems.yesterday.length > 0 ? (
            <section>
              <SelectAllGroupHeader
                title="Yesterday"
                count={groupedListItems.yesterday.length}
                groupIds={groupedListItems.yesterday.map((i) => i.id)}
                selectedIds={selectedIds}
                onToggle={handleToggleGroupSelectAll}
              />
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] divide-y divide-[var(--border-subtle)]">
                {groupedListItems.yesterday.map((item) => {
                  const theme = getDisciplineTheme(item.discipline);
                  const athleteName = item.athlete?.name ?? 'Unknown athlete';
                  const disciplineLabel = (item.discipline || 'OTHER').toUpperCase();
                  const isChecked = selectedIds.has(item.id);
                  const painFlag = item.latestCompletedActivity?.painFlag ?? false;
                  const isSkipped = item.status === 'SKIPPED';
                  return (
                    <div key={item.id} className="flex items-start gap-3 px-3 py-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-blue-600"
                        checked={isChecked}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleToggleSelected(item.id, e.target.checked);
                        }}
                        aria-label={`Select ${athleteName} - ${item.title}`}
                      />
                      <button type="button" onClick={() => setSelectedItem(item)} className="flex-1 min-w-0 text-left">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[var(--text)] truncate">{athleteName}</p>
                            <p className="text-xs text-[var(--text)] truncate mt-0.5">{item.title}</p>
                            <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--muted)]">
                              <span className="inline-flex items-center gap-1">
                                <Icon name={theme.iconName} size="sm" className={theme.textClass} />
                                <span className={cn('font-medium', theme.textClass)}>{disciplineLabel}</span>
                              </span>
                              <Badge className="hidden sm:inline-flex">{item.status.replace(/_/g, ' ')}</Badge>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
                            {item.hasAthleteComment ? (
                              <Icon name="athleteComment" size="xs" className={`text-blue-600 ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Has athlete comment" aria-hidden={false} />
                            ) : null}
                            {painFlag ? (
                              <Icon name="painFlag" size="xs" className={`text-rose-500 ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Pain flagged" aria-hidden={false} />
                            ) : null}
                            {isSkipped ? (
                              <Icon name="skipped" size="xs" className={`text-[var(--muted)] ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Skipped" aria-hidden={false} />
                            ) : null}
                          </div>
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {groupedListItems.earlierDateKeys.length > 0 ? (
            <section>
              <SelectAllGroupHeader
                title="Earlier"
                count={groupedListItems.earlierDateKeys.reduce((acc, dateKey) => {
                  const dayItems = groupedListItems.earlierByDate.get(dateKey) || [];
                  return acc + dayItems.length;
                }, 0)}
                groupIds={groupedListItems.earlierDateKeys.flatMap((dateKey) => {
                  const dayItems = groupedListItems.earlierByDate.get(dateKey) || [];
                  return dayItems.map((i) => i.id);
                })}
                selectedIds={selectedIds}
                onToggle={handleToggleGroupSelectAll}
              />
              <div className="space-y-3">
                {groupedListItems.earlierDateKeys.map((dateKey) => {
                  const dayItems = groupedListItems.earlierByDate.get(dateKey) || [];
                  return (
                    <div key={dateKey} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
                      <div className="px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                        <p className="text-sm font-medium">{getDisplayDateLabel(dateKey)}</p>
                      </div>
                      <div className="divide-y divide-[var(--border-subtle)]">
                        {dayItems.map((item) => {
                          const theme = getDisciplineTheme(item.discipline);
                          const athleteName = item.athlete?.name ?? 'Unknown athlete';
                          const disciplineLabel = (item.discipline || 'OTHER').toUpperCase();
                          const isChecked = selectedIds.has(item.id);
                          const painFlag = item.latestCompletedActivity?.painFlag ?? false;
                          const isSkipped = item.status === 'SKIPPED';
                          return (
                            <div key={item.id} className="flex items-start gap-3 px-3 py-3">
                              <input
                                type="checkbox"
                                className="mt-1 h-4 w-4 accent-blue-600"
                                checked={isChecked}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleToggleSelected(item.id, e.target.checked);
                                }}
                                aria-label={`Select ${athleteName} - ${item.title}`}
                              />
                              <button type="button" onClick={() => setSelectedItem(item)} className="flex-1 min-w-0 text-left">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-[var(--text)] truncate">{athleteName}</p>
                                    <p className="text-xs text-[var(--text)] truncate mt-0.5">{item.title}</p>
                                    <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--muted)]">
                                      <span className="inline-flex items-center gap-1">
                                        <Icon name={theme.iconName} size="sm" className={theme.textClass} />
                                        <span className={cn('font-medium', theme.textClass)}>{disciplineLabel}</span>
                                      </span>
                                      <Badge className="hidden sm:inline-flex">{item.status.replace(/_/g, ' ')}</Badge>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
                                    {item.hasAthleteComment ? (
                                      <Icon name="athleteComment" size="xs" className={`text-blue-600 ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Has athlete comment" aria-hidden={false} />
                                    ) : null}
                                    {painFlag ? (
                                      <Icon name="painFlag" size="xs" className={`text-rose-500 ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Pain flagged" aria-hidden={false} />
                                    ) : null}
                                    {isSkipped ? (
                                      <Icon name="skipped" size="xs" className={`text-[var(--muted)] ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Skipped" aria-hidden={false} />
                                    ) : null}
                                  </div>
                                </div>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {showSkeleton && viewMode === 'calendar' ? (
        <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" disabled className="min-h-[44px]">
                <Icon name="prev" size="sm" />
              </Button>
              <Button type="button" variant="ghost" disabled className="min-h-[44px]">
                <Icon name="next" size="sm" />
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden sm:block text-xs text-[var(--muted)]">Athlete</div>
              <Select className="min-h-[44px] w-[220px]" value="" disabled aria-label="Athlete filter">
                <option value="">Loading…</option>
              </Select>
            </div>

            <div className="h-4 w-32 rounded bg-[var(--bg-card)] animate-pulse" aria-hidden="true" />
            <div className="w-[120px]" />
          </div>

          <SkeletonMonthGrid />
        </div>
      ) : viewMode === 'calendar' ? (
        <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => navigateMonth(-1)} className="min-h-[44px]">
                <Icon name="prev" size="sm" />
              </Button>
              <Button type="button" variant="ghost" onClick={() => navigateMonth(1)} className="min-h-[44px]">
                <Icon name="next" size="sm" />
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden sm:block text-xs text-[var(--muted)]">Athlete</div>
              <Select
                className="min-h-[44px] w-[220px]"
                value={athleteFilterId ?? ''}
                onChange={(e) => setAndPersistAthleteFilterId(e.target.value || null)}
                aria-label="Athlete filter"
              >
                <option value="">All athletes</option>
                {athleteFilterOptions.map((ath) => (
                  <option key={ath.id} value={ath.id}>
                    {ath.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="text-sm font-medium">
              {new Date(Date.UTC(calendarMonth.year, calendarMonth.month, 1)).toLocaleDateString(undefined, {
                month: 'long',
                year: 'numeric',
              })}
            </div>
            <div className="w-[120px]" />
          </div>

          {visibleMonthItemCount === 0 ? (
            <div className="px-6 py-10 text-center">
              <p className="text-sm text-[var(--muted)]">No unreviewed workouts for this athlete in this month.</p>
            </div>
          ) : null}

          <MonthGrid>
            {monthDays.map((date) => {
              const dateKey = toDateInput(date);
              const dayItems = itemsByActionDate.get(dateKey) || [];
              const isCurrentMonth = date.getUTCMonth() === calendarMonth.month;
              const isToday = !!todayKey && dateKey === todayKey;

              return (
                <div
                  key={dateKey}
                  className={cn(
                    'min-h-[120px] p-2 border border-[var(--border-subtle)] bg-[var(--bg-card)]',
                    'flex flex-col gap-2',
                    !isCurrentMonth ? 'opacity-70' : '',
                    isToday ? 'border-2 border-[var(--today-border)] relative' : ''
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className={cn('text-xs font-medium', !isCurrentMonth ? 'text-[var(--muted)]' : 'text-[var(--text)]')}>
                      {date.getUTCDate()}
                    </span>
                    {isToday ? (
                      <span className="text-[10px] rounded px-2 py-0.5 bg-blue-500/10 text-blue-700 border border-[var(--today-border)]">
                        Today
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-1">
                    {dayItems.map((item) => {
                      const theme = getDisciplineTheme(item.discipline);
                      const disciplineLabel = (item.discipline || 'OTHER').toUpperCase();
                      const painFlag = item.latestCompletedActivity?.painFlag ?? false;
                      const isSkipped = item.status === 'SKIPPED';
                      const athletePrefix = athleteFilterId ? '' : getAthletePrefix(item.athlete?.name);
                      const baseTitle = item.title || disciplineLabel;
                      const displayTitle = athletePrefix ? `${athletePrefix}: ${baseTitle}` : baseTitle;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setSelectedItem(item)}
                          className={cn(
                            'w-full flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left',
                            'bg-transparent hover:bg-[var(--bg-structure)]'
                          )}
                        >
                          <Icon name={theme.iconName} size="sm" className={theme.textClass} />
                          <span className={cn('text-[10px] leading-none font-medium', theme.textClass)}>{disciplineLabel}</span>
                          <span className="text-xs text-[var(--text)] truncate flex-1">{displayTitle}</span>
                          <span className="flex items-center gap-1 flex-shrink-0">
                            {item.hasAthleteComment ? (
                              <Icon name="athleteComment" size="xs" className={`text-blue-600 ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Has athlete comment" aria-hidden={false} />
                            ) : null}
                            {painFlag ? (
                              <Icon name="painFlag" size="xs" className={`text-rose-500 ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Pain flagged" aria-hidden={false} />
                            ) : null}
                            {isSkipped ? (
                              <Icon name="skipped" size="xs" className={`text-[var(--muted)] ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Skipped" aria-hidden={false} />
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </MonthGrid>
        </div>
      ) : null}

      {selectedCount > 0 ? (
        <div className="sticky bottom-4">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm text-[var(--text)]">{selectedCount} selected</p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={clearSelection} disabled={bulkLoading}>
                Clear
              </Button>
              <Button type="button" onClick={handleBulkMarkReviewed} disabled={bulkLoading}>
                {bulkLoading ? 'Marking…' : 'Mark Reviewed'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ReviewDrawer item={selectedItem} onClose={() => setSelectedItem(null)} onMarkReviewed={markReviewed} />
    </section>
  );
}

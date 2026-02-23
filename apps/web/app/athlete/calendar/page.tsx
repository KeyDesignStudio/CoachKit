'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { AthleteCalendarGrid } from '@/components/calendar/AthleteCalendarGrid';
import { SessionDrawer } from '@/components/coach/SessionDrawer';
import { CalendarContextMenu, ContextMenuAction } from '@/components/coach/CalendarContextMenu';
import { getCalendarDisplayTime } from '@/components/calendar/getCalendarDisplayTime';
import { sortSessionsForDay } from '@/components/athlete/sortSessionsForDay';
import { uiEyebrow, uiH1, uiMuted } from '@/components/ui/typography';
import { formatDayMonthYearInTimeZone, formatWeekOfLabel } from '@/lib/client-date';
import { addDaysToDayKey, getLocalDayKey, getTodayDayKey, parseDayKeyToUtcDate, startOfWeekDayKey } from '@/lib/day-key';
import { getRangeCompletionSummary, isCompletedCalendarItem } from '@/lib/calendar/completion';
import { logCalendarPerfOnce, markCalendarPerf, resetCalendarPerfMarks } from '@/lib/perf/calendar-perf';
import type { WeatherSummary } from '@/lib/weather-model';
import { buildAiPlanBuilderSessionTitle } from '@/modules/ai-plan-builder/lib/session-title';
import type { GoalCountdown } from '@/lib/goal-countdown';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const DISCIPLINE_OPTIONS = ['RUN', 'BIKE', 'SWIM', 'BRICK', 'STRENGTH', 'REST', 'OTHER'] as const;
const DEFAULT_DISCIPLINE = DISCIPLINE_OPTIONS[0];

const APB_CALENDAR_ORIGIN = 'AI_PLAN_BUILDER';

type DisciplineOption = (typeof DISCIPLINE_OPTIONS)[number];

type SessionFormState = {
  date: string;
  plannedStartTimeLocal: string;
  title: string;
  discipline: DisciplineOption | string;
  notes: string;
};

const emptyForm = (date: string): SessionFormState => ({
  date,
  plannedStartTimeLocal: '05:30',
  title: '',
  discipline: DEFAULT_DISCIPLINE,
  notes: '',
});

type ViewMode = 'week' | 'month';

interface CalendarItem {
  id: string;
  title: string;
  date: string;
  plannedStartTimeLocal: string | null;
  discipline: string;
  origin?: string | null;
  subtype?: string | null;
  status: string;
  notes: string | null;
  plannedDurationMinutes?: number | null;
  plannedDistanceKm?: number | null;
  latestCompletedActivity?: {
    painFlag: boolean;
    source: 'MANUAL' | 'STRAVA';
    effectiveStartTimeUtc: string;
    confirmedAt?: string | null;
    durationMinutes?: number | null;
    distanceKm?: number | null;
    caloriesKcal?: number | null;
  } | null;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function getMonthGridStartKey(year: number, monthIndex: number): string {
  const firstOfMonth = `${year}-${pad2(monthIndex + 1)}-01`;
  return startOfWeekDayKey(firstOfMonth);
}

function resolveCalendarItemTitle(item: CalendarItem): string {
  const title = String(item.title ?? '').trim();
  const subtype = String(item.subtype ?? '').trim();
  const discipline = String(item.discipline ?? '').trim();

  if (item.origin === APB_CALENDAR_ORIGIN) {
    const candidate = title || subtype;
    const wordCount = candidate ? candidate.split(/\s+/).filter(Boolean).length : 0;
    const titleMatchesSubtype = title && subtype && title.toLowerCase() === subtype.toLowerCase();

    if (!candidate || wordCount < 2 || titleMatchesSubtype) {
      return buildAiPlanBuilderSessionTitle({
        discipline: discipline || 'workout',
        type: subtype || title,
      });
    }
  }

  return title || discipline || 'Workout';
}

export default function AthleteCalendarPage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const athleteTimezone = user?.timezone ?? '';
  const [weekStartKey, setWeekStartKey] = useState(() => startOfWeekDayKey(getTodayDayKey(athleteTimezone)));
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [dayWeatherByDate, setDayWeatherByDate] = useState<Record<string, WeatherSummary>>({});
  const [goalCountdown, setGoalCountdown] = useState<GoalCountdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sessionForm, setSessionForm] = useState<SessionFormState>(() => emptyForm(weekStartKey));
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    type: 'session' | 'day';
    data: any;
  }>({ isOpen: false, position: { x: 0, y: 0 }, type: 'day', data: null });
  const [clipboard, setClipboard] = useState<any>(null);

  const perfLogged = useRef(false);

  const dateRange = useMemo(() => {
    if (viewMode === 'week') {
      return {
        from: weekStartKey,
        to: addDaysToDayKey(weekStartKey, 6),
      };
    } else {
      const gridStartKey = getMonthGridStartKey(currentMonth.year, currentMonth.month);
      const gridEndKey = addDaysToDayKey(gridStartKey, 41);
      return {
        from: gridStartKey,
        to: gridEndKey,
      };
    }
  }, [viewMode, weekStartKey, currentMonth]);

  const itemsByDate = useMemo(() => {
    const grouped: Record<string, CalendarItem[]> = {};

    for (const item of items) {
      const dateKey = getLocalDayKey(item.date, athleteTimezone);
      (grouped[dateKey] ??= []).push(item);
    }

    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => {
        const timeA = a.plannedStartTimeLocal || '';
        const timeB = b.plannedStartTimeLocal || '';
        return timeA.localeCompare(timeB);
      });
    }

    return grouped;
  }, [items, athleteTimezone]);

  const weekDays = useMemo(() => {
    const now = new Date();

    return Array.from({ length: 7 }, (_, i) => {
      const dayKey = addDaysToDayKey(weekStartKey, i);
      const dayItems = (itemsByDate[dayKey] || []).map((item) => ({
        ...item,
        displayTimeLocal: getCalendarDisplayTime(item, athleteTimezone, now),
      }));

      return {
        date: dayKey,
        formatted: formatDayMonthYearInTimeZone(dayKey, athleteTimezone),
        name: DAY_NAMES[i],
        weather: dayWeatherByDate[dayKey],
        items: sortSessionsForDay(dayItems, athleteTimezone),
      };
    });
  }, [weekStartKey, athleteTimezone, itemsByDate, dayWeatherByDate]);

  const monthDays = useMemo(() => {
    if (viewMode !== 'month') return [];

    const now = new Date();

    const gridStartKey = getMonthGridStartKey(currentMonth.year, currentMonth.month);
    const days = [];
    
    for (let i = 0; i < 42; i++) {
      const dateStr = addDaysToDayKey(gridStartKey, i);
      const date = parseDayKeyToUtcDate(dateStr);
      const isCurrentMonth = dateStr.slice(0, 7) === `${currentMonth.year}-${pad2(currentMonth.month + 1)}`;
      
      days.push({
        date,
        dateStr,
        isCurrentMonth,
        weather: dayWeatherByDate[dateStr],
        items: sortSessionsForDay(
          (itemsByDate[dateStr] || []).map((item) => ({
            ...item,
            displayTimeLocal: getCalendarDisplayTime(item, athleteTimezone, now),
          })),
          athleteTimezone
        ),
      });
    }
    
    return days;
  }, [viewMode, currentMonth, itemsByDate, athleteTimezone, dayWeatherByDate]);

  const weekSummary = useMemo(() => {
    return getRangeCompletionSummary({
      items,
      timeZone: athleteTimezone,
      fromDayKey: weekStartKey,
      toDayKey: addDaysToDayKey(weekStartKey, 6),
    });
  }, [items, athleteTimezone, weekStartKey]);

  const weekTopDisciplines = useMemo(() => {
    return weekSummary.byDiscipline.filter((d) => d.durationMinutes > 0 || d.distanceKm > 0).slice(0, 6);
  }, [weekSummary]);

  const monthWeeks = useMemo(() => {
    if (viewMode !== 'month') return [];

    return Array.from({ length: 6 }, (_, weekIndex) => {
      const start = weekIndex * 7;
      const week = monthDays.slice(start, start + 7);
      const weekWorkoutCount = week.reduce((acc, d) => acc + d.items.filter((i) => isCompletedCalendarItem(i)).length, 0);
      const weekStart = week[0]?.dateStr ?? '';
      const weekEnd = week[6]?.dateStr ?? '';
      const weekSummary = weekStart && weekEnd
        ? getRangeCompletionSummary({
            items,
            timeZone: athleteTimezone,
            fromDayKey: weekStart,
            toDayKey: weekEnd,
          })
        : null;
      const weekTopDisciplines = weekSummary
        ? weekSummary.byDiscipline.filter((d) => d.durationMinutes > 0 || d.distanceKm > 0).slice(0, 2)
        : [];

      return {
        weekIndex,
        week,
        weekSummary,
        weekTopDisciplines,
        weekWorkoutCount,
      };
    });
  }, [viewMode, monthDays, items, athleteTimezone]);

  const loadItems = useCallback(async (bypassCache = false) => {
    if (user?.role !== 'ATHLETE' || !user.userId) {
      return;
    }

    setLoading(true);
    setError('');

    const startMs = process.env.NODE_ENV !== 'production' ? performance.now() : 0;

    try {
      const url = bypassCache
        ? `/api/athlete/calendar?from=${dateRange.from}&to=${dateRange.to}&lean=1&t=${Date.now()}`
        : `/api/athlete/calendar?from=${dateRange.from}&to=${dateRange.to}&lean=1`;

      const data = await request<{ items: CalendarItem[]; dayWeather?: Record<string, WeatherSummary>; goalCountdown?: GoalCountdown | null }>(
        url,
        bypassCache ? { cache: 'no-store' } : undefined
      );
      setItems(data.items.map((item) => ({ ...item, title: resolveCalendarItemTitle(item) })));
      setDayWeatherByDate(data.dayWeather ?? {});
      setGoalCountdown(data.goalCountdown ?? null);
      markCalendarPerf('data');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar.');
    } finally {
      setLoading(false);

      if (process.env.NODE_ENV !== 'production') {
        try {
          const dur = performance.now() - startMs;
          // eslint-disable-next-line no-console
          console.debug('[perf] athlete-calendar fetch ms', Math.round(dur));
        } catch {
          // noop
        }
      }
    }
  }, [request, user?.role, user?.userId, dateRange.from, dateRange.to]);

  useEffect(() => {
    setMounted(true);
    const savedView = localStorage.getItem('athlete-calendar-view') as ViewMode;
    if (savedView) {
      setViewMode(savedView);
    }
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    resetCalendarPerfMarks();
    perfLogged.current = false;
    markCalendarPerf('shell');
  }, [viewMode, weekStartKey, currentMonth.year, currentMonth.month]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Persist view mode to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('athlete-calendar-view', viewMode);
    }
  }, [viewMode]);

  const goToToday = useCallback(() => {
    const now = new Date();
    if (viewMode === 'week') {
      setWeekStartKey(startOfWeekDayKey(getTodayDayKey(athleteTimezone, now)));
    } else {
      setCurrentMonth({ year: now.getFullYear(), month: now.getMonth() });
    }
  }, [viewMode, athleteTimezone]);

  const navigatePrev = useCallback(() => {
    if (viewMode === 'week') {
      setWeekStartKey((prev) => addDaysToDayKey(prev, -7));
    } else {
      setCurrentMonth((prev) => {
        const newMonth = prev.month === 0 ? 11 : prev.month - 1;
        const newYear = prev.month === 0 ? prev.year - 1 : prev.year;
        return { year: newYear, month: newMonth };
      });
    }
  }, [viewMode]);

  const navigateNext = useCallback(() => {
    if (viewMode === 'week') {
      setWeekStartKey((prev) => addDaysToDayKey(prev, 7));
    } else {
      setCurrentMonth((prev) => {
        const newMonth = prev.month === 11 ? 0 : prev.month + 1;
        const newYear = prev.month === 11 ? prev.year + 1 : prev.year;
        return { year: newYear, month: newMonth };
      });
    }
  }, [viewMode]);

  const handleItemIdClick = (itemId: string) => {
    router.push(`/athlete/workouts/${itemId}`);
  };

  const handleDayClick = (dateStr: string) => {
    setViewMode('week');
    setWeekStartKey(startOfWeekDayKey(dateStr));
  };

  const openCreateDrawer = useCallback((dateStr: string) => {
    setSessionForm(emptyForm(dateStr));
    setError('');
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, type: 'session' | 'day', data: any) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      type,
      data,
    });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleMenuAction = useCallback(async (action: ContextMenuAction, payload?: any) => {
    const { type, data: contextData } = contextMenu;
    closeContextMenu();

    if (action === 'copy' && type === 'session') {
      setClipboard(contextData);
    } else if (action === 'delete' && type === 'session') {
      if (!confirm('Are you sure you want to delete this workout?')) return;
      try {
        setLoading(true);
        await request(`/api/athlete/calendar-items/${contextData.id}`, { method: 'DELETE' });
        await loadItems(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to delete session');
      } finally {
        setLoading(false);
      }
    } else if (action === 'paste' && type === 'day') {
      if (!clipboard) return;
      
      try {
        setLoading(true);
        await request('/api/athlete/calendar-items', {
          method: 'POST',
          data: {
            date: contextData.date,
            plannedStartTimeLocal: clipboard.plannedStartTimeLocal || undefined,
            title: clipboard.title,
            discipline: clipboard.discipline,
            workoutDetail: clipboard.workoutDetail,
            notes: clipboard.notes,
          },
        });
        await loadItems(true);
      } catch(e) {
         setError('Couldn’t paste session.');
      } finally {
         setLoading(false);
      }
    }
  }, [contextMenu, clipboard, request, loadItems]);

  const onCreateSession = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError('');

      if (!sessionForm.title.trim()) {
        setError('Choose a workout title before saving.');
        return;
      }

      try {
        await request('/api/athlete/calendar-items', {
          method: 'POST',
          data: {
            date: sessionForm.date,
            plannedStartTimeLocal: sessionForm.plannedStartTimeLocal || undefined,
            title: sessionForm.title.trim(),
            discipline: String(sessionForm.discipline).trim(),
            workoutDetail: sessionForm.notes.trim() ? sessionForm.notes.trim() : undefined,
          },
        });

        await loadItems(true);
        closeDrawer();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save workout.');
      }
    },
    [request, sessionForm, loadItems, closeDrawer]
  );

  const showSkeleton = userLoading || loading || !mounted;
  const todayKey = getTodayDayKey(athleteTimezone);

  useEffect(() => {
    if (showSkeleton) return;
    markCalendarPerf('grid');
    logCalendarPerfOnce('athlete-calendar', perfLogged);
  }, [showSkeleton, viewMode, weekDays, monthWeeks]);

  return (
    <>
    <section className="flex flex-col gap-6">
      <header className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-4 md:px-6 md:py-5">
        <div className="flex flex-col gap-4">
          <div>
            <p className={uiEyebrow}>Training</p>
            <h1
              className={`${uiH1} ${viewMode === 'week' ? 'font-medium' : 'font-normal'}`}
            >
              {viewMode === 'week' ? 'Weekly Calendar' : 'Monthly Calendar'}
            </h1>
            <p className={`${uiMuted} text-xs md:text-sm`}>
              {mounted ? (
                viewMode === 'week' 
                  ? formatWeekOfLabel(dateRange.from, athleteTimezone)
                  : new Date(currentMonth.year, currentMonth.month).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })
              ) : (
                formatWeekOfLabel(dateRange.from, athleteTimezone)
              )}
            </p>
          </div>
          <div className="flex flex-col md:flex-row md:items-center gap-3 text-sm">
            {/* View Toggle */}
            <div className="flex rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-1">
              <button
                onClick={() => setViewMode('week')}
                className={`rounded-xl px-4 py-2 text-sm ${viewMode === 'month' ? 'font-normal' : 'font-medium'} transition-all flex-1 md:flex-initial min-h-[44px] ${
                  viewMode === 'week'
                    ? 'bg-[var(--bg-card)] border border-[var(--border-subtle)]'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                Week
              </button>
              <button
                onClick={() => setViewMode('month')}
                className={`rounded-xl px-4 py-2 text-sm ${viewMode === 'month' ? 'font-normal' : 'font-medium'} transition-all flex-1 md:flex-initial min-h-[44px] ${
                  viewMode === 'month'
                    ? 'bg-[var(--bg-card)] border border-[var(--border-subtle)]'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                Month
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={navigatePrev} className="flex-1 md:flex-initial min-h-[44px]">
                <Icon name="prev" size="sm" className="md:mr-1" /><span className="hidden md:inline"> Prev</span>
              </Button>
              <Button type="button" variant="ghost" onClick={goToToday} className="flex-1 md:flex-initial min-h-[44px]">
                <Icon name="today" size="sm" className="md:mr-1" /><span className="hidden md:inline"> Today</span>
              </Button>
              <Button type="button" variant="ghost" onClick={navigateNext} className="flex-1 md:flex-initial min-h-[44px]">
                <span className="hidden md:inline">Next </span><Icon name="next" size="sm" className="md:ml-1" />
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => loadItems(true)}
              disabled={loading}
              className="w-full md:w-auto min-h-[44px]"
            >
              <Icon name="refresh" size="sm" className="md:mr-1" /><span className="hidden md:inline"> Refresh</span>
            </Button>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-rose-500">{error}</p> : null}
        {loading ? <p className="mt-3 text-sm text-[var(--muted)]">Loading calendar...</p> : null}
      </header>

      {!userLoading && (!user || user.role !== 'ATHLETE') ? (
        <p className="text-[var(--muted)]">Athlete access required.</p>
      ) : null}

      <AthleteCalendarGrid
        viewMode={viewMode}
        showSkeleton={showSkeleton}
        weekDays={weekDays}
        weekSummary={weekSummary}
        weekTopDisciplines={weekTopDisciplines}
        monthWeeks={monthWeeks}
        todayKey={todayKey}
        athleteTimezone={athleteTimezone}
        goalEventDateKey={goalCountdown?.eventDate ?? null}
        goalCountdown={goalCountdown}
        onDayClick={handleDayClick}
        onAddClick={openCreateDrawer}
        onItemClick={handleItemIdClick}
        onContextMenu={handleContextMenu}
      />

      {!loading && items.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
          <p className="text-lg text-[var(--muted)]">
            {viewMode === 'week' ? 'No workouts planned for this week.' : 'No workouts planned for this month.'}
          </p>
        </div>
      ) : null}
    </section>

    <CalendarContextMenu
      isOpen={contextMenu.isOpen}
      position={contextMenu.position}
      type={contextMenu.type}
      canPaste={!!clipboard}
      onClose={closeContextMenu}
      onAction={handleMenuAction}
      showLibraryInsert={false}
    />

    <SessionDrawer
      isOpen={drawerOpen}
      onClose={closeDrawer}
      title="Add Workout"
      onSubmit={onCreateSession}
      submitLabel="Add Workout"
      submitDisabled={!sessionForm.title.trim()}
    >
      <div className="space-y-4">
        <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
          Date
          <Input
            type="date"
            value={sessionForm.date}
            onChange={(e) => setSessionForm((prev) => ({ ...prev, date: e.target.value }))}
            required
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
          Start time (optional)
          <Input
            type="time"
            value={sessionForm.plannedStartTimeLocal}
            onChange={(e) => setSessionForm((prev) => ({ ...prev, plannedStartTimeLocal: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
          Discipline
          <Select
            value={String(sessionForm.discipline)}
            onChange={(e) => setSessionForm((prev) => ({ ...prev, discipline: e.target.value }))}
          >
            {DISCIPLINE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
          Title
          <Input
            value={sessionForm.title}
            onChange={(e) => setSessionForm((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="e.g. Easy run"
            required
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
          Workout detail (optional)
          <Textarea
            value={sessionForm.notes}
            onChange={(e) => setSessionForm((prev) => ({ ...prev, notes: e.target.value }))}
            rows={4}
          />
        </label>
      </div>
    </SessionDrawer>
    </>
  );
}

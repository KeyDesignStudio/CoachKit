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
import { AthleteWeekGrid } from '@/components/athlete/AthleteWeekGrid';
import { AthleteWeekDayColumn } from '@/components/athlete/AthleteWeekDayColumn';
import { AthleteWeekSessionRow } from '@/components/athlete/AthleteWeekSessionRow';
import { MonthGrid } from '@/components/coach/MonthGrid';
import { AthleteMonthDayCell } from '@/components/athlete/AthleteMonthDayCell';
import { SessionDrawer } from '@/components/coach/SessionDrawer';
import { getCalendarDisplayTime } from '@/components/calendar/getCalendarDisplayTime';
import { sortSessionsForDay } from '@/components/athlete/sortSessionsForDay';
import { CalendarShell } from '@/components/calendar/CalendarShell';
import { SkeletonWeekGrid } from '@/components/calendar/SkeletonWeekGrid';
import { SkeletonMonthGrid } from '@/components/calendar/SkeletonMonthGrid';
import { addDays, formatDisplay, formatWeekOfLabel, startOfWeek, toDateInput } from '@/lib/client-date';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const DISCIPLINE_OPTIONS = ['RUN', 'BIKE', 'SWIM', 'BRICK', 'STRENGTH', 'REST', 'OTHER'] as const;
const DEFAULT_DISCIPLINE = DISCIPLINE_OPTIONS[0];

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
  status: string;
  notes: string | null;
  latestCompletedActivity?: {
    painFlag: boolean;
    source: 'MANUAL' | 'STRAVA';
    effectiveStartTimeUtc: string;
  } | null;
}

// Helper to group items by date
function groupItemsByDate(items: CalendarItem[]): Record<string, CalendarItem[]> {
  const grouped: Record<string, CalendarItem[]> = {};
  
  items.forEach((item) => {
    const dateStr = item.date.split('T')[0];
    if (!grouped[dateStr]) {
      grouped[dateStr] = [];
    }
    grouped[dateStr].push(item);
  });
  
  // Sort items within each day by time
  Object.keys(grouped).forEach((date) => {
    grouped[date].sort((a, b) => {
      const timeA = a.plannedStartTimeLocal || '';
      const timeB = b.plannedStartTimeLocal || '';
      return timeA.localeCompare(timeB);
    });
  });
  
  return grouped;
}

// Helper to get first Monday of month grid (may be in previous month)
function getMonthGridStart(year: number, month: number): Date {
  const firstDayOfMonth = new Date(year, month, 1);
  const dayOfWeek = firstDayOfMonth.getDay(); // 0 = Sunday
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  return new Date(year, month, 1 + mondayOffset);
}

// Helper to get last Sunday of month grid (may be in next month)
function getMonthGridEnd(year: number, month: number): Date {
  const gridStart = getMonthGridStart(year, month);
  // Always show 6 weeks (42 days) for consistency
  return addDays(gridStart, 41);
}

// Helper to check if date is today
function isToday(date: Date): boolean {
  const today = new Date();
  return date.getDate() === today.getDate() &&
         date.getMonth() === today.getMonth() &&
         date.getFullYear() === today.getFullYear();
}

export default function AthleteCalendarPage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [weekStart, setWeekStart] = useState(() => startOfWeek());
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sessionForm, setSessionForm] = useState<SessionFormState>(() => emptyForm(toDateInput(startOfWeek())));

  const perfFrameMarked = useRef(false);
  const perfDataMarked = useRef(false);

  const dateRange = useMemo(() => {
    if (viewMode === 'week') {
      return {
        from: toDateInput(weekStart),
        to: toDateInput(addDays(weekStart, 6)),
      };
    } else {
      const gridStart = getMonthGridStart(currentMonth.year, currentMonth.month);
      const gridEnd = getMonthGridEnd(currentMonth.year, currentMonth.month);
      return {
        from: toDateInput(gridStart),
        to: toDateInput(gridEnd),
      };
    }
  }, [viewMode, weekStart, currentMonth]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(weekStart, i);
      return {
        date: toDateInput(day),
        formatted: formatDisplay(toDateInput(day)),
        name: DAY_NAMES[i],
      };
    });
  }, [weekStart]);

  const itemsByDate = useMemo(() => groupItemsByDate(items), [items]);

  const athleteTimezone = user?.timezone || 'Australia/Brisbane';

  const monthDays = useMemo(() => {
    if (viewMode !== 'month') return [];

    const now = new Date();
    
    const gridStart = getMonthGridStart(currentMonth.year, currentMonth.month);
    const days = [];
    
    for (let i = 0; i < 42; i++) {
      const date = addDays(gridStart, i);
      const dateStr = toDateInput(date);
      const isCurrentMonth = date.getMonth() === currentMonth.month;
      
      days.push({
        date,
        dateStr,
        isCurrentMonth,
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
  }, [viewMode, currentMonth, itemsByDate, athleteTimezone]);

  const loadItems = useCallback(async (bypassCache = false) => {
    if (user?.role !== 'ATHLETE' || !user.userId) {
      return;
    }

    setLoading(true);
    setError('');

    const startMs = process.env.NODE_ENV !== 'production' ? performance.now() : 0;

    try {
      const url = bypassCache
        ? `/api/athlete/calendar?from=${dateRange.from}&to=${dateRange.to}&t=${Date.now()}`
        : `/api/athlete/calendar?from=${dateRange.from}&to=${dateRange.to}`;

      const data = await request<{ items: CalendarItem[] }>(
        url,
        bypassCache ? { cache: 'no-store' } : undefined
      );
      setItems(data.items);
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

        if (perfFrameMarked.current && !perfDataMarked.current) {
          perfDataMarked.current = true;
          try {
            performance.mark('athlete-calendar-data');
            performance.measure('athlete-calendar-load', 'athlete-calendar-frame', 'athlete-calendar-data');
          } catch {
            // noop
          }
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

  // Dev-only perf mark for frame.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (perfFrameMarked.current) return;
    perfFrameMarked.current = true;
    try {
      performance.mark('athlete-calendar-frame');
    } catch {
      // noop
    }
  }, []);

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
      setWeekStart(startOfWeek());
    } else {
      setCurrentMonth({ year: now.getFullYear(), month: now.getMonth() });
    }
  }, [viewMode]);

  const navigatePrev = useCallback(() => {
    if (viewMode === 'week') {
      setWeekStart((prev) => addDays(prev, -7));
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
      setWeekStart((prev) => addDays(prev, 7));
    } else {
      setCurrentMonth((prev) => {
        const newMonth = prev.month === 11 ? 0 : prev.month + 1;
        const newYear = prev.month === 11 ? prev.year + 1 : prev.year;
        return { year: newYear, month: newMonth };
      });
    }
  }, [viewMode]);

  const handleWorkoutClick = (itemId: string) => {
    router.push(`/athlete/workouts/${itemId}`);
  };

  const handleItemIdClick = (itemId: string) => {
    router.push(`/athlete/workouts/${itemId}`);
  };

  const handleDayClick = (date: Date) => {
    setViewMode('week');
    setWeekStart(startOfWeek(date));
  };

  const openCreateDrawer = useCallback((dateStr: string) => {
    setSessionForm(emptyForm(dateStr));
    setError('');
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

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

  return (
    <>
    <section className="flex flex-col gap-6">
      <header className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-4 md:px-6 md:py-5">
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs md:text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Training</p>
            <h1
              className={`text-2xl md:text-3xl ${viewMode === 'week' ? 'font-medium' : 'font-normal'}`}
            >
              {viewMode === 'week' ? 'Weekly Calendar' : 'Monthly Calendar'}
            </h1>
            <p className="text-xs md:text-sm text-[var(--muted)]">
              {mounted ? (
                viewMode === 'week' 
                  ? formatWeekOfLabel(dateRange.from, athleteTimezone)
                  : new Date(currentMonth.year, currentMonth.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
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

      {/* Calendar Grid - Week or Month */}
      {viewMode === 'week' ? (
        <CalendarShell variant="week" data-athlete-week-view-version="athlete-week-v2">
          {showSkeleton ? (
            <SkeletonWeekGrid />
          ) : (
            <AthleteWeekGrid>
              {weekDays.map((day) => {
                const dayItems = (itemsByDate[day.date] || []).map((item) => ({
                  ...item,
                  displayTimeLocal: getCalendarDisplayTime(item, athleteTimezone, new Date()),
                }));
                const dayDate = new Date(day.date);
                return (
                  <AthleteWeekDayColumn
                    key={day.date}
                    dayName={day.name}
                    formattedDate={day.formatted}
                    isEmpty={dayItems.length === 0}
                    isToday={isToday(dayDate)}
                    onAddClick={() => openCreateDrawer(day.date)}
                  >
                    {sortSessionsForDay(dayItems, athleteTimezone).map((item) => (
                      <AthleteWeekSessionRow
                        key={item.id}
                        item={item}
                        onClick={() => handleWorkoutClick(item.id)}
                        timeZone={athleteTimezone}
                      />
                    ))}
                  </AthleteWeekDayColumn>
                );
              })}
            </AthleteWeekGrid>
          )}
        </CalendarShell>
      ) : (
        <CalendarShell variant="month" data-athlete-month-view-version="athlete-month-v2">
          {showSkeleton ? (
            <SkeletonMonthGrid />
          ) : (
            <MonthGrid>
              {monthDays.map((day) => (
                <AthleteMonthDayCell
                  key={day.dateStr}
                  date={day.date}
                  dateStr={day.dateStr}
                  items={day.items}
                  isCurrentMonth={day.isCurrentMonth}
                  isToday={isToday(day.date)}
                  athleteTimezone={athleteTimezone}
                  onDayClick={handleDayClick}
                  onAddClick={(date) => openCreateDrawer(toDateInput(date))}
                  canAdd
                  onItemClick={handleItemIdClick}
                />
              ))}
            </MonthGrid>
          )}
        </CalendarShell>
      )}

      {!loading && items.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
          <p className="text-lg text-[var(--muted)]">
            {viewMode === 'week' ? 'No workouts planned for this week.' : 'No workouts planned for this month.'}
          </p>
        </div>
      ) : null}
    </section>

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

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { AthleteWeekGrid } from '@/components/athlete/AthleteWeekGrid';
import { AthleteWeekDayColumn } from '@/components/athlete/AthleteWeekDayColumn';
import { AthleteWeekSessionRow } from '@/components/athlete/AthleteWeekSessionRow';
import { MonthGrid } from '@/components/coach/MonthGrid';
import { AthleteMonthDayCell } from '@/components/athlete/AthleteMonthDayCell';
import { getCalendarDisplayTime } from '@/components/athlete/getCalendarDisplayTime';
import { sortSessionsForDay } from '@/components/athlete/sortSessionsForDay';
import { addDays, formatDisplay, startOfWeek, toDateInput } from '@/lib/client-date';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

  const loadItems = useCallback(async () => {
    if (user?.role !== 'ATHLETE' || !user.userId) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const data = await request<{ items: CalendarItem[] }>(
        `/api/athlete/calendar?from=${dateRange.from}&to=${dateRange.to}`
      );
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar.');
    } finally {
      setLoading(false);
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

  if (userLoading) {
    return <p className="text-[var(--muted)]">Loading...</p>;
  }

  if (!user || user.role !== 'ATHLETE') {
    return <p className="text-[var(--muted)]">Athlete access required.</p>;
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="rounded-3xl border border-white/20 bg-white/40 px-4 py-4 md:px-6 md:py-5 backdrop-blur-3xl shadow-inner">
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
                  ? `Week of ${dateRange.from}` 
                  : new Date(currentMonth.year, currentMonth.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
              ) : (
                `Week of ${dateRange.from}`
              )}
            </p>
          </div>
          <div className="flex flex-col md:flex-row md:items-center gap-3 text-sm">
            {/* View Toggle */}
            <div className="flex rounded-2xl border border-white/30 bg-white/40 p-1">
              <button
                onClick={() => setViewMode('week')}
                className={`rounded-xl px-4 py-2 text-sm ${viewMode === 'month' ? 'font-normal' : 'font-medium'} transition-all flex-1 md:flex-initial min-h-[44px] ${
                  viewMode === 'week' ? 'bg-white/80 shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                Week
              </button>
              <button
                onClick={() => setViewMode('month')}
                className={`rounded-xl px-4 py-2 text-sm ${viewMode === 'month' ? 'font-normal' : 'font-medium'} transition-all flex-1 md:flex-initial min-h-[44px] ${
                  viewMode === 'month' ? 'bg-white/80 shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'
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
            <Button type="button" variant="ghost" onClick={loadItems} disabled={loading} className="w-full md:w-auto min-h-[44px]">
              <Icon name="refresh" size="sm" className="md:mr-1" /><span className="hidden md:inline"> Refresh</span>
            </Button>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-rose-500">{error}</p> : null}
        {loading ? <p className="mt-3 text-sm text-[var(--muted)]">Loading calendar...</p> : null}
      </header>

      {/* Calendar Grid - Week or Month */}
      {viewMode === 'week' ? (
        <div data-athlete-week-view-version="athlete-week-v2">
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
                >
                  {sortSessionsForDay(dayItems, athleteTimezone).map((item) => (
                    <AthleteWeekSessionRow
                      key={item.id}
                      item={item}
                      onClick={() => handleWorkoutClick(item.id)}
                    />
                  ))}
                </AthleteWeekDayColumn>
              );
            })}
          </AthleteWeekGrid>
        </div>
      ) : (
        <div data-athlete-month-view-version="athlete-month-v2">
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
                onItemClick={handleItemIdClick}
              />
            ))}
          </MonthGrid>
        </div>
      )}

      {!loading && items.length === 0 ? (
        <div className="rounded-3xl border border-white/20 bg-white/40 p-8 text-center backdrop-blur-3xl">
          <p className="text-lg text-[var(--muted)]">
            {viewMode === 'week' ? 'No workouts planned for this week.' : 'No workouts planned for this month.'}
          </p>
        </div>
      ) : null}
    </section>
  );
}

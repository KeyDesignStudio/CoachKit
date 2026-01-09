'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { addDays, startOfWeek, toDateInput } from '@/lib/client-date';
import { MultiAthleteGrid } from '@/components/coach/MultiAthleteGrid';
import { MultiAthleteAccordion } from '@/components/coach/MultiAthleteAccordion';
import { AthleteSelector } from '@/components/coach/AthleteSelector';
import { CalendarItemDrawer } from '@/components/coach/CalendarItemDrawer';

type Athlete = {
  userId: string;
  coachId: string;
  disciplines: string[];
  planCadenceDays: number;
  goalsText?: string | null;
  dateOfBirth?: string | null;
  coachNotes?: string | null;
  user: {
    id: string;
    name: string | null;
    email: string;
    timezone: string;
  };
};

type CalendarItem = {
  id: string;
  title: string;
  date: string;
  plannedStartTimeLocal: string | null;
  discipline: string;
  status: string;
  notes: string | null;
  latestCompletedActivity?: {
    painFlag: boolean;
  } | null;
  comments?: Array<{
    author: { role: string };
  }>;
  hasAthleteComment?: boolean;
  coachAdvicePresent?: boolean;
};

type AthleteData = {
  athlete: {
    id: string;
    name: string | null;
  };
  items: CalendarItem[];
  weekStatus: 'DRAFT' | 'PUBLISHED';
};

export default function MultiAthleteCalendarPage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();
  const [weekStart, setWeekStart] = useState(() => startOfWeek());
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<Set<string>>(new Set());
  const [athleteData, setAthleteData] = useState<AthleteData[]>([]);
  const [selectedItem, setSelectedItem] = useState<CalendarItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'comments' | 'without-comments' | 'pain'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('coach-multi-calendar-filter') as any) || 'all';
    }
    return 'all';
  });
  const [showOnlyWithSessions, setShowOnlyWithSessions] = useState(false);

  const weekRange = useMemo(() => {
    const from = toDateInput(weekStart);
    const to = toDateInput(addDays(weekStart, 6));
    return { from, to };
  }, [weekStart]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(weekStart, i);
      return toDateInput(day);
    });
  }, [weekStart]);

  // Load athletes
  useEffect(() => {
    if (user?.role !== 'COACH' || !user.userId) return;

    const loadAthletes = async () => {
      try {
        const data = await request<{ athletes: Athlete[] }>('/api/coach/athletes');
        setAthletes(data.athletes);
        // Select all by default
        setSelectedAthleteIds(new Set(data.athletes.map((a) => a.userId)));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load athletes.');
      }
    };

    loadAthletes();
  }, [request, user?.role, user?.userId]);

  const loadCalendarData = useCallback(async () => {
    if (!user?.userId || selectedAthleteIds.size === 0) {
      setAthleteData([]);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const selectedAthletes = athletes.filter((a) => selectedAthleteIds.has(a.userId));
      
      // Fetch calendar items and week status for each athlete in parallel
      const results = await Promise.all(
        selectedAthletes.map(async (athlete) => {
          const [calendarData, weekStatusData] = await Promise.all([
            request<{ items: CalendarItem[] }>(
              `/api/coach/calendar?athleteId=${athlete.userId}&from=${weekRange.from}&to=${weekRange.to}`
            ),
            request<{ weeks: Array<{ weekStart: string; status: 'DRAFT' | 'PUBLISHED' }> }>(
              `/api/coach/plan-weeks?athleteId=${athlete.userId}&from=${weekRange.from}&to=${weekRange.to}`
            ),
          ]);

          // Process items to add hasAthleteComment and coachAdvicePresent
          const processedItems = calendarData.items.map((item) => ({
            ...item,
            hasAthleteComment: item.comments?.some((c) => c.author.role === 'ATHLETE') ?? false,
            coachAdvicePresent: !!item.notes && item.notes.trim().length > 0,
          }));

          const weekStatus = weekStatusData.weeks[0]?.status ?? 'DRAFT';

          return {
            athlete: {
              id: athlete.userId,
              name: athlete.user.name,
            },
            items: processedItems,
            weekStatus,
          };
        })
      );

      setAthleteData(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar data.');
    } finally {
      setLoading(false);
    }
  }, [request, user?.userId, athletes, selectedAthleteIds, weekRange.from, weekRange.to]);

  useEffect(() => {
    if (user?.role === 'COACH') {
      loadCalendarData();
    }
  }, [loadCalendarData, user?.role]);

  const goToToday = useCallback(() => {
    setWeekStart(startOfWeek());
  }, []);

  const navigatePrev = useCallback(() => {
    setWeekStart((prev) => addDays(prev, -7));
  }, []);

  const navigateNext = useCallback(() => {
    setWeekStart((prev) => addDays(prev, 7));
  }, []);

  const handleFilterChange = useCallback((mode: 'all' | 'comments' | 'without-comments' | 'pain') => {
    setFilterMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('coach-multi-calendar-filter', mode);
    }
  }, []);

  // Filter athlete data based on filter mode
  const filteredAthleteData = useMemo(() => {
    return athleteData
      .map((data) => {
        let filteredItems = data.items;

        if (filterMode === 'comments') {
          filteredItems = filteredItems.filter((item) => item.hasAthleteComment);
        } else if (filterMode === 'without-comments') {
          filteredItems = filteredItems.filter((item) => !item.hasAthleteComment);
        } else if (filterMode === 'pain') {
          filteredItems = filteredItems.filter((item) => item.latestCompletedActivity?.painFlag);
        }

        return {
          ...data,
          items: filteredItems,
        };
      })
      .filter((data) => {
        // Filter out athletes with no sessions if toggle enabled
        if (showOnlyWithSessions && data.items.length === 0) {
          return false;
        }
        return true;
      });
  }, [athleteData, filterMode, showOnlyWithSessions]);

  if (userLoading) {
    return <p className="text-[var(--muted)]">Loading...</p>;
  }

  if (!user || user.role !== 'COACH') {
    return <p className="text-[var(--muted)]">Coach access required.</p>;
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 rounded-3xl border border-white/20 bg-white/40 px-4 py-4 md:px-6 md:py-5 backdrop-blur-3xl shadow-inner">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs md:text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Coach Planning</p>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Multi-athlete Calendar</h1>
              <p className="text-xs md:text-sm text-[var(--muted)]">Week of {weekRange.from}</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:justify-between text-sm">
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

            <AthleteSelector
              athletes={athletes}
              selectedIds={selectedAthleteIds}
              onChange={setSelectedAthleteIds}
            />

            <div className="flex items-center rounded-xl border border-white/20 bg-white/30 p-1 backdrop-blur-sm w-full md:w-auto">
              <button
                type="button"
                onClick={() => handleFilterChange('all')}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  filterMode === 'all'
                    ? 'bg-white/80 text-[var(--foreground)] shadow-sm'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange('comments')}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  filterMode === 'comments'
                    ? 'bg-white/80 text-[var(--foreground)] shadow-sm'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                }`}
              >
                Comments
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange('without-comments')}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  filterMode === 'without-comments'
                    ? 'bg-white/80 text-[var(--foreground)] shadow-sm'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                }`}
              >
                No Comments
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange('pain')}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  filterMode === 'pain'
                    ? 'bg-white/80 text-[var(--foreground)] shadow-sm'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                }`}
              >
                Pain Flags
              </button>
            </div>

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={showOnlyWithSessions}
                  onChange={(e) => setShowOnlyWithSessions(e.target.checked)}
                  className="w-4 h-4 rounded border-white/30"
                />
                <span>Only with sessions</span>
              </label>
              <Button type="button" variant="ghost" onClick={loadCalendarData} disabled={loading}>
                <Icon name="refresh" size="sm" className="mr-1" /> Refresh
              </Button>
            </div>
          </div>
        </div>
        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        {loading ? <p className="text-sm text-[var(--muted)]">Loading calendar...</p> : null}
      </header>

      {filteredAthleteData.length === 0 && !loading ? (
        <div className="rounded-3xl border border-white/20 bg-white/40 p-8 text-center backdrop-blur-3xl">
          <p className="text-lg text-[var(--muted)]">No athletes or sessions to display.</p>
        </div>
      ) : (
        <>
          {/* Desktop view */}
          <div className="hidden lg:block">
            <MultiAthleteGrid
              athleteData={filteredAthleteData}
              weekDays={weekDays}
              onItemClick={(item: CalendarItem) => setSelectedItem(item)}
              onRefresh={loadCalendarData}
            />
          </div>

          {/* Mobile view */}
          <div className="block lg:hidden">
            <MultiAthleteAccordion
              athleteData={filteredAthleteData}
              weekDays={weekDays}
              onItemClick={(item: CalendarItem) => setSelectedItem(item)}
              onRefresh={loadCalendarData}
            />
          </div>
        </>
      )}

      <CalendarItemDrawer item={selectedItem} onClose={() => setSelectedItem(null)} onSave={loadCalendarData} />
    </section>
  );
}

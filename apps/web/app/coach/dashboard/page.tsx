'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ReviewGrid } from '@/components/coach/ReviewGrid';
import { AthleteRow } from '@/components/coach/AthleteRow';
import { ReviewChip } from '@/components/coach/ReviewChip';
import { ReviewDrawer } from '@/components/coach/ReviewDrawer';
import { MobileReviewAccordion } from '@/components/coach/MobileReviewAccordion';
import { addDays, startOfWeek, toDateInput } from '@/lib/client-date';

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
  discipline: string;
  plannedStartTimeLocal: string | null;
  plannedDurationMinutes: number | null;
  plannedDistanceKm: number | null;
  notes: string | null;
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
  coachAdvicePresent: boolean;
};

export default function CoachDashboardPage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();
  const [weekStart, setWeekStart] = useState(() => startOfWeek());
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<ReviewItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'comments' | 'without-comments'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('coach-review-filter') as 'all' | 'comments' | 'without-comments') || 'all';
    }
    return 'all';
  });

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

  const loadItems = useCallback(async () => {
    if (!user?.userId) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const data = await request<{ items: ReviewItem[] }>(
        `/api/coach/review-inbox?from=${weekRange.from}&to=${weekRange.to}`
      );
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inbox.');
    } finally {
      setLoading(false);
    }
  }, [request, user?.userId, weekRange.from, weekRange.to]);

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

  const handleBulkReview = useCallback(async () => {
    const itemsWithoutComments = items.filter(
      (item) => !item.hasAthleteComment && !(item.latestCompletedActivity?.painFlag ?? false)
    );
    if (itemsWithoutComments.length === 0) {
      alert('No items available for bulk review. Items with athlete comments or pain flags require individual attention.');
      return;
    }

    const confirmed = confirm(
      `Mark ${itemsWithoutComments.length} item(s) as reviewed? (Excludes items with athlete comments or pain flags)`
    );
    if (!confirmed) return;

    setBulkLoading(true);
    setError('');

    try {
      await request('/api/coach/review-inbox/bulk-review', {
        method: 'POST',
        data: {
          from: weekRange.from,
          to: weekRange.to,
        },
      });
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to bulk mark reviewed.');
    } finally {
      setBulkLoading(false);
    }
  }, [request, weekRange, items, loadItems]);

  const goToToday = useCallback(() => {
    setWeekStart(startOfWeek());
  }, []);

  const navigatePrev = useCallback(() => {
    setWeekStart((prev) => addDays(prev, -7));
  }, []);

  const navigateNext = useCallback(() => {
    setWeekStart((prev) => addDays(prev, 7));
  }, []);

  const handleFilterChange = useCallback((mode: 'all' | 'comments' | 'without-comments') => {
    setFilterMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('coach-review-filter', mode);
    }
  }, []);

  // Group items by athlete and date
  const athleteData = useMemo(() => {
    const athleteMap = new Map<string, { name: string; itemsByDate: Map<string, ReviewItem[]> }>();

    items.forEach((item) => {
      if (!item.athlete) return;

      // Filter based on mode
      if (filterMode === 'comments' && !item.hasAthleteComment) {
        return;
      }
      if (filterMode === 'without-comments' && item.hasAthleteComment) {
        return;
      }

      const athleteId = item.athlete.id;
      const athleteName = item.athlete.name || athleteId;

      if (!athleteMap.has(athleteId)) {
        athleteMap.set(athleteId, {
          name: athleteName,
          itemsByDate: new Map(),
        });
      }

      const athlete = athleteMap.get(athleteId)!;
      const dateStr = item.date.split('T')[0];

      if (!athlete.itemsByDate.has(dateStr)) {
        athlete.itemsByDate.set(dateStr, []);
      }

      athlete.itemsByDate.get(dateStr)!.push(item);
    });

    return Array.from(athleteMap.entries())
      .map(([id, data]) => ({
        id,
        name: data.name,
        itemsByDate: data.itemsByDate,
      }))
      .filter(athlete => {
        // In filter modes, hide athletes with no visible items
        if ((filterMode === 'comments' || filterMode === 'without-comments') && athlete.itemsByDate.size === 0) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, filterMode]);

  if (userLoading) {
    return <p className="text-[var(--muted)]">Loading...</p>;
  }

  if (!user || user.role !== 'COACH') {
    return <p className="text-[var(--muted)]">Coach access required.</p>;
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-4 md:px-6 md:py-5">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs md:text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Coach Review</p>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Review Board</h1>
              <p className="text-xs md:text-sm text-[var(--muted)]">Week of {weekRange.from}</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:justify-end md:flex-wrap text-sm">
            <div className="flex items-center gap-2 w-full md:w-auto">
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
            
            <div className="flex items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-1 w-full md:w-auto">
              <button
                type="button"
                onClick={() => handleFilterChange('all')}
                className={`rounded-lg px-3 py-2 text-xs md:text-sm font-medium transition-colors min-h-[44px] flex-1 md:flex-initial ${
                  filterMode === 'all'
                    ? 'bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--foreground)]'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange('comments')}
                className={`rounded-lg px-3 py-2 text-xs md:text-sm font-medium transition-colors min-h-[44px] flex-1 md:flex-initial ${
                  filterMode === 'comments'
                    ? 'bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--foreground)]'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                }`}
              >
                Comments
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange('without-comments')}
                className={`rounded-lg px-3 py-2 text-xs md:text-sm font-medium transition-colors min-h-[44px] flex-1 md:flex-initial ${
                  filterMode === 'without-comments'
                    ? 'bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--foreground)]'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                }`}
              >
                No Comments
              </button>
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <Button type="button" variant="ghost" onClick={loadItems} disabled={loading} className="w-full md:w-auto min-h-[44px]">
                <Icon name="refresh" size="sm" className="md:mr-1" /><span className="hidden md:inline"> Refresh</span>
              </Button>
            </div>
          </div>
        </div>
        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        {loading ? <p className="text-sm text-[var(--muted)]">Loading review inbox...</p> : null}
      </header>

      {athleteData.length === 0 && !loading ? (
        <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
          <p className="text-lg text-[var(--muted)]">No workouts awaiting review for this week.</p>
        </div>
      ) : (
        <>
          {/* Desktop view */}
          <div className="hidden lg:block">
            <ReviewGrid>
              {athleteData.map((athlete) => (
                <AthleteRow key={athlete.id} athleteName={athlete.name}>
                  {weekDays.map((date) => {
                    const dayItems = athlete.itemsByDate.get(date) || [];
                    return (
                      <div key={date}>
                        {dayItems.map((item) => (
                          <ReviewChip
                            key={item.id}
                            time={item.plannedStartTimeLocal}
                            title={item.title}
                            discipline={item.discipline}
                            hasAthleteComment={item.hasAthleteComment}
                            coachAdvicePresent={item.coachAdvicePresent}
                            painFlag={item.latestCompletedActivity?.painFlag ?? false}
                            onClick={() => setSelectedItem(item)}
                            onQuickReview={
                              !item.hasAthleteComment ? () => markReviewed(item.id) : undefined
                            }
                          />
                        ))}
                      </div>
                    );
                  })}
                </AthleteRow>
              ))}
            </ReviewGrid>
          </div>

          {/* Mobile view */}
          <div className="block lg:hidden">
            <MobileReviewAccordion
              athleteData={athleteData}
              weekDays={weekDays}
              onItemClick={(item) => setSelectedItem(item)}
              onQuickReview={(id) => markReviewed(id)}
            />
          </div>
        </>
      )}

      <ReviewDrawer item={selectedItem} onClose={() => setSelectedItem(null)} onMarkReviewed={markReviewed} />
    </section>
  );
}

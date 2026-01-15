'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { WeekGrid } from '@/components/coach/WeekGrid';
import { AthleteWeekDayColumn } from '@/components/athlete/AthleteWeekDayColumn';
import { AthleteWeekSessionRow } from '@/components/athlete/AthleteWeekSessionRow';
import { SessionDrawer } from '@/components/coach/SessionDrawer';
import { MonthGrid } from '@/components/coach/MonthGrid';
import { AthleteMonthDayCell } from '@/components/athlete/AthleteMonthDayCell';
import { AthleteSelector } from '@/components/coach/AthleteSelector';
import { CalendarShell } from '@/components/calendar/CalendarShell';
import { SkeletonWeekGrid } from '@/components/calendar/SkeletonWeekGrid';
import { SkeletonMonthGrid } from '@/components/calendar/SkeletonMonthGrid';
import { getCalendarDisplayTime } from '@/components/calendar/getCalendarDisplayTime';
import { sortSessionsForDay } from '@/components/athlete/sortSessionsForDay';
import { CALENDAR_ACTION_ICON_CLASS, CALENDAR_ADD_SESSION_ICON } from '@/components/calendar/iconTokens';
import { formatDisplayInTimeZone, formatWeekOfLabel } from '@/lib/client-date';
import { mapWithConcurrency } from '@/lib/concurrency';
import { addDaysToDayKey, getTodayDayKey, parseDayKeyToUtcDate, startOfWeekDayKey } from '@/lib/day-key';
import { cn } from '@/lib/cn';
import { uiEyebrow, uiH1, uiMuted } from '@/components/ui/typography';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import type { WeatherSummary } from '@/lib/weather-model';

const DISCIPLINE_OPTIONS = ['RUN', 'BIKE', 'SWIM', 'BRICK', 'STRENGTH', 'REST', 'OTHER'] as const;
const DEFAULT_DISCIPLINE = DISCIPLINE_OPTIONS[0];

type DisciplineOption = (typeof DISCIPLINE_OPTIONS)[number];

type AthleteOption = {
  userId: string;
  user: {
    id: string;
    name: string | null;
    timezone?: string | null;
  };
};

type CalendarItem = {
  id: string;
  date: string;
  plannedStartTimeLocal: string | null;
  displayTimeLocal?: string | null;
  discipline: string;
  status: string;
  title: string;
  athleteId?: string;
  athleteName?: string | null;
  athleteTimezone?: string;
  workoutDetail?: string | null;
  template?: { id: string; title: string } | null;
  plannedDurationMinutes?: number | null;
  plannedDistanceKm?: number | null;
  latestCompletedActivity?: {
    painFlag: boolean;
    source?: 'MANUAL' | 'STRAVA';
    effectiveStartTimeUtc?: string;
    startTime?: string;
  } | null;
};

type SessionFormState = {
  date: string;
  plannedStartTimeLocal: string;
  title: string;
  discipline: DisciplineOption | string;
  templateId: string;
  workoutDetail: string;
};

type WorkoutTitleOption = {
  id: string;
  title: string;
};

type CopyMode = 'skipExisting' | 'overwrite';
type ViewMode = 'week' | 'month';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const emptyForm = (date: string): SessionFormState => ({
  date,
  plannedStartTimeLocal: '05:30',
  title: '',
  discipline: DEFAULT_DISCIPLINE,
  templateId: '',
  workoutDetail: '',
});

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function getMonthGridStartKey(year: number, monthIndex: number): string {
  const firstOfMonth = `${year}-${pad2(monthIndex + 1)}-01`;
  return startOfWeekDayKey(firstOfMonth);
}

// Helper to group items by date
function groupItemsByDate(items: CalendarItem[]): Record<string, CalendarItem[]> {
  const grouped: Record<string, CalendarItem[]> = {};
  
  items.forEach((item) => {
    // API returns canonical YYYY-MM-DD day keys.
    const dateStr = item.date;
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

export default function CoachCalendarPage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();
  const [athletes, setAthletes] = useState<AthleteOption[]>([]);
  const didInitSelectedAthletes = useRef(false);
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<Set<string>>(() => new Set());
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [athleteTimezone, setAthleteTimezone] = useState('Australia/Brisbane');
  const [weekStartKey, setWeekStartKey] = useState(() => startOfWeekDayKey(getTodayDayKey(athleteTimezone)));
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [dayWeatherByDate, setDayWeatherByDate] = useState<Record<string, WeatherSummary>>({});
  const [drawerMode, setDrawerMode] = useState<'closed' | 'create' | 'edit'>('closed');
  const [sessionForm, setSessionForm] = useState(() => emptyForm(weekStartKey));
  const [editItemId, setEditItemId] = useState('');
  const [drawerAthleteId, setDrawerAthleteId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copyFormOpen, setCopyFormOpen] = useState(false);
  const [copyForm, setCopyForm] = useState(() => ({
    fromWeekStart: weekStartKey,
    toWeekStart: addDaysToDayKey(weekStartKey, 7),
    mode: 'skipExisting' as CopyMode,
  }));
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const [copyError, setCopyError] = useState('');
  const [titleOptions, setTitleOptions] = useState<Record<string, WorkoutTitleOption[]>>({});
  const [titleInput, setTitleInput] = useState('');
  const [titleMessage, setTitleMessage] = useState('');
  const [titleLoadingDiscipline, setTitleLoadingDiscipline] = useState<string | null>(null);
  const [weekStatus, setWeekStatus] = useState<'DRAFT' | 'PUBLISHED'>('DRAFT');
  const [publishLoading, setPublishLoading] = useState(false);

  const [mobileDaySheetOpen, setMobileDaySheetOpen] = useState(false);
  const [mobileDaySheetDateStr, setMobileDaySheetDateStr] = useState<string>('');

  const perfFrameMarked = useRef(false);
  const perfDataMarked = useRef(false);

  const stackedMode = selectedAthleteIds.size > 1;
  const singleAthleteId = selectedAthleteIds.size === 1 ? Array.from(selectedAthleteIds)[0] : '';
  const effectiveAthleteId = drawerMode === 'closed' ? singleAthleteId : drawerAthleteId;

  const selectedAthletes = useMemo(() => {
    const ids = Array.from(selectedAthleteIds);

    return ids.map((id) => {
      const found = athletes.find((athlete) => athlete.userId === id);
      if (found) return found;
      return {
        userId: id,
        user: {
          id,
          name: id,
          timezone: athleteTimezone,
        },
      };
    });
  }, [athletes, athleteTimezone, selectedAthleteIds]);

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

  const itemsByDate = useMemo(() => groupItemsByDate(items), [items]);

  const itemsById = useMemo(() => {
    const map = new Map<string, CalendarItem>();
    items.forEach((item) => {
      map.set(item.id, item);
    });
    return map;
  }, [items]);

  const editingItem = useMemo(() => {
    if (drawerMode !== 'edit' || !editItemId) return null;
    return itemsById.get(editItemId) ?? null;
  }, [drawerMode, editItemId, itemsById]);

  const weekDays = useMemo(() => {
    const now = new Date();

    return Array.from({ length: 7 }, (_, i) => {
      const dateStr = addDaysToDayKey(weekStartKey, i);
      const formatted = formatDisplayInTimeZone(dateStr, athleteTimezone);

      const dayItems = sortSessionsForDay(
        (itemsByDate[dateStr] || []).map((item) => ({
          ...item,
          displayTimeLocal: getCalendarDisplayTime(item, athleteTimezone, now),
        })),
        athleteTimezone
      );

      return {
        dayName: DAY_NAMES[i],
        date: dateStr,
        formattedDate: formatted.split(',')[1]?.trim() || formatted,
        weather: dayWeatherByDate[dateStr],
        items: dayItems,
      };
    });
  }, [weekStartKey, itemsByDate, athleteTimezone, dayWeatherByDate]);

  const monthDays = useMemo(() => {
    if (viewMode !== 'month') return [];

    const now = new Date();

    const gridStartKey = getMonthGridStartKey(currentMonth.year, currentMonth.month);
    const days: Array<{ date: Date; dateStr: string; isCurrentMonth: boolean; weather?: WeatherSummary; items: CalendarItem[] }> = [];

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

  const ensureDiscipline = (value: string): DisciplineOption => {
    const normalized = (value || '').toUpperCase();
    return (DISCIPLINE_OPTIONS.find((option) => option === normalized) ?? DEFAULT_DISCIPLINE) as DisciplineOption;
  };

  const loadTitleOptions = useCallback(
    async (discipline: string, force = false) => {
      const key = ensureDiscipline(discipline);
      if (!force && titleOptions[key]) {
        return;
      }

      setTitleLoadingDiscipline(key);
      setTitleMessage('');

      try {
        const data = await request<{ titles: WorkoutTitleOption[] }>(`/api/coach/workout-titles?discipline=${key}`);
        const sorted = [...data.titles].sort((a, b) => a.title.localeCompare(b.title));
        setTitleOptions((prev) => ({ ...prev, [key]: sorted }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load workout titles.');
      } finally {
        setTitleLoadingDiscipline((current) => (current === key ? null : current));
      }
    },
    [request, titleOptions]
  );

  const handleAddTitle = async () => {
    const titleValue = titleInput.trim();

    if (!titleValue) {
      setError('Enter a title name first.');
      return;
    }

    const key = ensureDiscipline(sessionForm.discipline);
    setTitleMessage('');

    try {
      const response = await request<{ title: WorkoutTitleOption }>('/api/coach/workout-titles', {
        method: 'POST',
        data: { title: titleValue, discipline: key },
      });

      setTitleOptions((prev) => {
        const updated = [...(prev[key] ?? []), response.title].sort((a, b) => a.title.localeCompare(b.title));
        return { ...prev, [key]: updated };
      });

      setSessionForm((prev) => ({ ...prev, title: response.title.title }));
      setTitleInput('');
      setTitleMessage(`Added "${response.title.title}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add title.');
    }
  };

  const handleDeleteTitle = async () => {
    const entry = titleOptions[ensureDiscipline(sessionForm.discipline)]?.find((opt) => opt.title === sessionForm.title);

    if (!entry) {
      setError('Select a saved title to delete.');
      return;
    }

    setTitleMessage('');

    try {
      await request(`/api/coach/workout-titles/${entry.id}`, { method: 'DELETE' });

      const key = ensureDiscipline(sessionForm.discipline);
      setTitleOptions((prev) => {
        const filtered = (prev[key] ?? []).filter((option) => option.id !== entry.id);
        return { ...prev, [key]: filtered };
      });

      setSessionForm((prev) => ({ ...prev, title: '' }));
      setTitleMessage(`Deleted "${entry.title}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete title.');
    }
  };

  const canDeleteTitle = () => {
    const key = ensureDiscipline(sessionForm.discipline);
    return (titleOptions[key] ?? []).some((option) => option.title === sessionForm.title);
  };

  const updateFormDiscipline = (value: string) => {
    const normalized = ensureDiscipline(value);
    setSessionForm((prev) => ({ ...prev, discipline: normalized, title: '' }));
    setTitleInput('');
    loadTitleOptions(normalized, true);
  };

  const loadAthletes = useCallback(async () => {
    if (user?.role !== 'COACH' || !user.userId) {
      return;
    }

    try {
      const data = await request<{ athletes: AthleteOption[] }>('/api/coach/athletes');
      setAthletes(data.athletes);

      if (didInitSelectedAthletes.current) {
        return;
      }

      const storageKey = 'coach-calendar-selected-athletes';
      const savedRaw = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null;
      const allIds = new Set(data.athletes.map((a) => a.userId));

      if (savedRaw) {
        try {
          const parsed = JSON.parse(savedRaw) as unknown;
          const savedIds = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
          const restored = new Set(savedIds.filter((id) => allIds.has(id)));
          setSelectedAthleteIds(restored.size > 0 ? restored : new Set(allIds));
        } catch {
          setSelectedAthleteIds(new Set(allIds));
        }
      } else {
        // Default: All athletes selected.
        setSelectedAthleteIds(new Set(allIds));
      }

      didInitSelectedAthletes.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load athletes.');
    }
  }, [request, user?.role, user?.userId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!didInitSelectedAthletes.current) return;
    localStorage.setItem('coach-calendar-selected-athletes', JSON.stringify(Array.from(selectedAthleteIds)));
  }, [selectedAthleteIds]);

  const loadCalendar = useCallback(async () => {
    if (selectedAthleteIds.size === 0) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      if (selectedAthleteIds.size === 1) {
        const athleteId = Array.from(selectedAthleteIds)[0];
        const itemsPromise = request<{ items: CalendarItem[]; athleteTimezone: string; dayWeather?: Record<string, WeatherSummary> }>(
          `/api/coach/calendar?athleteId=${athleteId}&from=${dateRange.from}&to=${dateRange.to}`
        );

        const planWeeksPromise =
          viewMode === 'week'
            ? request<{ weeks: Array<{ weekStart: string; status: 'DRAFT' | 'PUBLISHED' }> }>(
                `/api/coach/plan-weeks?athleteId=${athleteId}&from=${dateRange.from}&to=${dateRange.to}`
              )
            : Promise.resolve({ weeks: [] });

        const [itemsResult, weekResult] = await Promise.allSettled([itemsPromise, planWeeksPromise]);
        if (itemsResult.status !== 'fulfilled') {
          throw itemsResult.reason;
        }

        const itemsData = itemsResult.value;
        const weekData = weekResult.status === 'fulfilled' ? weekResult.value : { weeks: [] };

        const athleteName = athletes.find((a) => a.userId === athleteId)?.user.name ?? null;
        setItems(itemsData.items.map((item) => ({ ...item, athleteId, athleteName, athleteTimezone: itemsData.athleteTimezone })));
        setDayWeatherByDate(itemsData.dayWeather ?? {});
        if (itemsData.athleteTimezone) {
          setAthleteTimezone(itemsData.athleteTimezone);
        }

        if (viewMode === 'week' && weekData.weeks.length > 0) {
          const currentWeekData = weekData.weeks[0];
          setWeekStatus(currentWeekData?.status || 'DRAFT');
        } else if (viewMode === 'week') {
          setWeekStatus('DRAFT');
        }
      } else {
        // Stacked mode: load each athlete in parallel and tag items.
        const selected = Array.from(selectedAthleteIds);
        setDayWeatherByDate({});
        const results = await mapWithConcurrency(selected, 5, async (athleteId) => {
          const itemsData = await request<{ items: CalendarItem[]; athleteTimezone: string }>(
            `/api/coach/calendar?athleteId=${athleteId}&from=${dateRange.from}&to=${dateRange.to}`
          );
          const athleteName = athletes.find((a) => a.userId === athleteId)?.user.name ?? null;
          return itemsData.items.map((item) => ({
            ...item,
            athleteId,
            athleteName,
            athleteTimezone: itemsData.athleteTimezone,
          }));
        });
        setItems(results.flat());
        setWeekStatus('DRAFT');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar.');
    } finally {
      setLoading(false);
    }
  }, [athletes, dateRange.from, dateRange.to, request, selectedAthleteIds, viewMode]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(media.matches);
    update();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }

    // Safari < 14 fallback
    // eslint-disable-next-line deprecation/deprecation
    media.addListener(update);
    // eslint-disable-next-line deprecation/deprecation
    return () => media.removeListener(update);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!user?.userId) return;
    if (typeof window === 'undefined') return;

    const storageKey = `coach-calendar-view:${user.userId}`;
    const raw = localStorage.getItem(storageKey);
    const savedView = raw === 'week' || raw === 'month' ? (raw as ViewMode) : null;

    if (savedView) {
      setViewMode(savedView);
      return;
    }

    // Mobile default: Week (month is secondary).
    if (window.matchMedia('(max-width: 767px)').matches) {
      setViewMode('week');
    }
  }, [mounted, user?.userId]);

  // Dev-only perf marks
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (perfFrameMarked.current) return;
    perfFrameMarked.current = true;
    try {
      performance.mark('coach-calendar-frame');
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (!perfFrameMarked.current) return;
    if (perfDataMarked.current) return;
    if (userLoading) return;
    if (loading) return;
    if (items.length === 0) return;

    perfDataMarked.current = true;
    try {
      performance.mark('coach-calendar-data');
      performance.measure('coach-calendar-load', 'coach-calendar-frame', 'coach-calendar-data');
    } catch {
      // noop
    }
  }, [items.length, loading, userLoading]);

  useEffect(() => {
    loadAthletes();
  }, [loadAthletes]);

  useEffect(() => {
    loadCalendar();
  }, [loadCalendar]);

  useEffect(() => {
    loadTitleOptions(sessionForm.discipline);
  }, [sessionForm.discipline, loadTitleOptions]);

  // Persist view mode to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!user?.userId) return;
    localStorage.setItem(`coach-calendar-view:${user.userId}`, viewMode);
  }, [user?.userId, viewMode]);

  // Mobile header title: keep iOS header meaningful without reintroducing desktop branding.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isMobile) return;

    const title =
      viewMode === 'month'
        ? new Date(currentMonth.year, currentMonth.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        : 'Calendar';

    window.dispatchEvent(new CustomEvent('coachkit:mobile-header-title', { detail: { title } }));
  }, [currentMonth.month, currentMonth.year, isMobile, viewMode]);

  const goToToday = () => {
    const now = new Date();
    if (viewMode === 'week') {
      setWeekStartKey(startOfWeekDayKey(getTodayDayKey(athleteTimezone)));
    } else {
      setCurrentMonth({ year: now.getFullYear(), month: now.getMonth() });
    }
  };

  const navigatePrev = () => {
    if (viewMode === 'week') {
      setWeekStartKey(addDaysToDayKey(weekStartKey, -7));
    } else {
      const newMonth = currentMonth.month === 0 ? 11 : currentMonth.month - 1;
      const newYear = currentMonth.month === 0 ? currentMonth.year - 1 : currentMonth.year;
      setCurrentMonth({ year: newYear, month: newMonth });
    }
  };

  const navigateNext = () => {
    if (viewMode === 'week') {
      setWeekStartKey(addDaysToDayKey(weekStartKey, 7));
    } else {
      const newMonth = currentMonth.month === 11 ? 0 : currentMonth.month + 1;
      const newYear = currentMonth.month === 11 ? currentMonth.year + 1 : currentMonth.year;
      setCurrentMonth({ year: newYear, month: newMonth });
    }
  };

  const openMobileDaySheet = (dateStr: string) => {
    setMobileDaySheetDateStr(dateStr);
    setMobileDaySheetOpen(true);
  };

  const closeMobileDaySheet = () => {
    setMobileDaySheetOpen(false);
    setMobileDaySheetDateStr('');
  };

  const openCreateDrawer = (date: string) => {
    setDrawerAthleteId(singleAthleteId);
    setSessionForm(emptyForm(date));
    setEditItemId('');
    setDrawerMode('create');
    setError('');
    setTitleMessage('');
  };

  const openCreateDrawerForAthlete = (athleteId: string, date: string) => {
    setDrawerAthleteId(athleteId);
    setSessionForm(emptyForm(date));
    setEditItemId('');
    setDrawerMode('create');
    setError('');
    setTitleMessage('');
  };

  const openEditDrawer = (item: CalendarItem) => {
    const dateStr = item.date;
    const displayTimeLocal = item.displayTimeLocal ?? null;
    setDrawerAthleteId(item.athleteId || singleAthleteId);
    setSessionForm({
      date: dateStr,
      // Match the time shown in the calendar pill (actual when available).
      plannedStartTimeLocal: displayTimeLocal || item.plannedStartTimeLocal || '05:30',
      title: item.title,
      discipline: item.discipline,
      templateId: item.template?.id || '',
      workoutDetail: item.workoutDetail || '',
    });
    setEditItemId(item.id);
    setDrawerMode('edit');
    setError('');
    setTitleMessage('');
  };

  const closeDrawer = () => {
    setDrawerMode('closed');
    setEditItemId('');
    setDrawerAthleteId('');
    setTitleMessage('');
  };

  const onSaveSession = async (event: FormEvent) => {
    event.preventDefault();

    const trimmedAthleteId = effectiveAthleteId?.trim() || '';

    if (!trimmedAthleteId) {
      setError('Select an athlete first.');
      return;
    }

    if (!sessionForm.title) {
      setError('Choose a workout title before saving.');
      return;
    }

    try {
      const normalizedDiscipline = ensureDiscipline(sessionForm.discipline);
      const payload = {
        athleteId: trimmedAthleteId,
        date: sessionForm.date,
        plannedStartTimeLocal: sessionForm.plannedStartTimeLocal || undefined,
        title: sessionForm.title,
        discipline: normalizedDiscipline,
        templateId: sessionForm.templateId || undefined,
        workoutDetail: sessionForm.workoutDetail.trim() ? sessionForm.workoutDetail.trim() : undefined,
      };

      if (drawerMode === 'create') {
        await request('/api/coach/calendar-items', {
          method: 'POST',
          data: payload,
        });
      } else if (drawerMode === 'edit' && editItemId) {
        await request(`/api/coach/calendar-items/${editItemId}`, {
          method: 'PATCH',
          data: payload,
        });
      }

      await loadCalendar();
      closeDrawer();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workout.');
    }
  };

  const onDelete = async () => {
    if (!editItemId) {
      return;
    }

    try {
      await request(`/api/coach/calendar-items/${editItemId}`, { method: 'DELETE' });
      await loadCalendar();
      closeDrawer();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete item.');
    }
  };

  const onCopyWeek = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!singleAthleteId) {
      setCopyError('Select an athlete first.');
      return;
    }

    setCopyLoading(true);
    setCopyError('');
    setCopyMessage('');

    try {
      const response = await request<{ message?: string }>('/api/coach/calendar/copy-week', {
        method: 'POST',
        data: {
          athleteId: singleAthleteId,
          fromWeekStart: copyForm.fromWeekStart,
          toWeekStart: copyForm.toWeekStart,
          mode: copyForm.mode,
        },
      });

      setCopyMessage(response.message || 'Week copied.');
      await loadCalendar();
      setCopyFormOpen(false);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : 'Failed to copy week.');
    } finally {
      setCopyLoading(false);
    }
  };

  const toggleCopyForm = () => {
    if (copyFormOpen) {
      setCopyFormOpen(false);
      setCopyError('');
      return;
    }

    setCopyForm({
      fromWeekStart: weekStartKey,
      toWeekStart: addDaysToDayKey(weekStartKey, 7),
      mode: 'skipExisting',
    });
    setCopyError('');
    setCopyFormOpen(true);
  };

  const publishWeek = async () => {
    if (!singleAthleteId) {
      return;
    }

    setPublishLoading(true);
    setError('');

    try {
      await request('/api/coach/plan-weeks/publish', {
        method: 'POST',
        data: {
          athleteId: singleAthleteId,
          weekStart: weekStartKey,
        },
      });
      setWeekStatus('PUBLISHED');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish week.');
    } finally {
      setPublishLoading(false);
    }
  };

  const unpublishWeek = async () => {
    if (!singleAthleteId) {
      return;
    }

    setPublishLoading(true);
    setError('');

    try {
      await request('/api/coach/plan-weeks/unpublish', {
        method: 'POST',
        data: {
          athleteId: singleAthleteId,
          weekStart: weekStartKey,
        },
      });
      setWeekStatus('DRAFT');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unpublish week.');
    } finally {
      setPublishLoading(false);
    }
  };

  const isTitleLoading = () => {
    const key = ensureDiscipline(sessionForm.discipline);
    return titleLoadingDiscipline === key;
  };

  const currentDisciplineTitles = titleOptions[ensureDiscipline(sessionForm.discipline)] || [];

  if (!userLoading && (!user || user.role !== 'COACH')) {
    return <p className="text-[var(--muted)]">Coach access required.</p>;
  }

  const showSkeleton =
    userLoading ||
    loading ||
    !mounted ||
    athletes.length === 0 ||
    selectedAthleteIds.size === 0;

  return (
    <section className="flex flex-col gap-6">
      {/* Header */}
      <header className="flex flex-col gap-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-4 md:px-6 md:py-5">
        {/* Top row: Title and Athlete selector */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          {/* Left: Title and Date */}
          <div className="flex-shrink-0">
            <p className={uiEyebrow}>Planning</p>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className={`${uiH1} font-semibold`}>{mounted && viewMode === 'month' ? 'Monthly Calendar' : 'Weekly Calendar'}</h1>
              {viewMode === 'week' && mounted && (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium border border-[var(--border-subtle)] bg-[var(--bg-card)] ${
                    weekStatus === 'PUBLISHED' ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {weekStatus === 'PUBLISHED' ? 'Published' : 'Draft'}
                </span>
              )}
            </div>
            <p className={`${uiMuted} text-xs md:text-sm`}>
              {mounted ? (
                viewMode === 'week' 
                  ? formatWeekOfLabel(dateRange.from, athleteTimezone)
                  : new Date(currentMonth.year, currentMonth.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
              ) : (
                formatWeekOfLabel(dateRange.from, athleteTimezone)
              )}
            </p>
          </div>

          {/* Center: Athletes Selector (single or stacked) */}
          <div className="flex items-center flex-shrink-0">
            <div className="flex items-center gap-3 text-sm w-full md:w-auto">
              <span className="text-[var(--muted)] hidden md:inline">Athletes</span>
              <AthleteSelector athletes={athletes} selectedIds={selectedAthleteIds} onChange={setSelectedAthleteIds} />
            </div>
          </div>
        </div>

        {/* Bottom row: View Toggle, Navigation, Actions */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 text-sm">
          {/* View Toggle */}
          <div className="flex rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-1">
            <button
              onClick={() => setViewMode('week')}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-all flex-1 md:flex-initial min-h-[44px] ${
                viewMode === 'week'
                  ? 'bg-[var(--bg-card)] border border-[var(--border-subtle)]'
                  : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setViewMode('month')}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-all flex-1 md:flex-initial min-h-[44px] ${
                viewMode === 'month'
                  ? 'bg-[var(--bg-card)] border border-[var(--border-subtle)]'
                  : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              Month
            </button>
          </div>
          {/* Mobile: compact date nav: <  January 2026  > */}
          <div className="md:hidden flex items-center justify-between gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1">
            <button
              type="button"
              onClick={navigatePrev}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-[var(--text)] hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]"
              aria-label="Previous"
            >
              <Icon name="prev" size="md" />
            </button>

            <button
              type="button"
              onClick={goToToday}
              className="min-w-0 flex-1 rounded-xl px-2 py-2 text-sm font-medium text-[var(--text)] truncate hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]"
              aria-label="Go to today"
              title="Go to today"
            >
              {mounted
                ? viewMode === 'week'
                  ? formatWeekOfLabel(dateRange.from, athleteTimezone)
                  : new Date(currentMonth.year, currentMonth.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                : formatWeekOfLabel(dateRange.from, athleteTimezone)}
            </button>

            <button
              type="button"
              onClick={navigateNext}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-[var(--text)] hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]"
              aria-label="Next"
            >
              <Icon name="next" size="md" />
            </button>
          </div>

          {/* Desktop: full date nav */}
          <div className="hidden md:flex items-center gap-2">
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
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={toggleCopyForm}
              className="flex-1 md:flex-initial min-h-[44px]"
              disabled={!singleAthleteId}
              title={stackedMode ? 'Select a single athlete to copy plans.' : undefined}
            >
              {copyFormOpen ? 'Close' : <><Icon name="copyWeek" size="sm" className="md:mr-1" /><span className="hidden md:inline"> Copy</span></>}
            </Button>
            {viewMode === 'week' && mounted && !!singleAthleteId && (
              weekStatus === 'DRAFT' ? (
                <Button type="button" variant="primary" onClick={publishWeek} disabled={publishLoading} className="flex-1 md:flex-initial min-h-[44px]">
                  {publishLoading ? 'Publishing...' : 'Publish weekly plan'}
                </Button>
              ) : (
                <Button type="button" variant="ghost" onClick={unpublishWeek} disabled={publishLoading} className="flex-1 md:flex-initial min-h-[44px]">
                  {publishLoading ? 'Unpublishing...' : 'Unpublish weekly plan'}
                </Button>
              )
            )}
          </div>
        </div>
        {copyMessage ? <p className="text-sm text-emerald-600">{copyMessage}</p> : null}
        {error && drawerMode === 'closed' ? <p className="text-sm text-rose-500">{error}</p> : null}
        {loading ? <p className="text-sm text-[var(--muted)]">Loading calendar…</p> : null}
      </header>

      {/* Copy Week Form */}
      {copyFormOpen ? (
        <Card className="rounded-3xl">
          <form onSubmit={onCopyWeek} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                From week (Mon)
                <Input
                  type="date"
                  value={copyForm.fromWeekStart}
                  onChange={(event) => setCopyForm((prev) => ({ ...prev, fromWeekStart: event.target.value }))}
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                To week (Mon)
                <Input
                  type="date"
                  value={copyForm.toWeekStart}
                  onChange={(event) => setCopyForm((prev) => ({ ...prev, toWeekStart: event.target.value }))}
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                Mode
                <Select value={copyForm.mode} onChange={(event) => setCopyForm((prev) => ({ ...prev, mode: event.target.value as CopyMode }))}>
                  <option value="skipExisting">Skip existing</option>
                  <option value="overwrite">Overwrite</option>
                </Select>
              </label>
            </div>
            {copyError ? <p className="text-sm text-rose-500">{copyError}</p> : null}
            <Button type="submit" disabled={copyLoading}>
              {copyLoading ? 'Copying…' : 'Copy week'}
            </Button>
          </form>
        </Card>
      ) : null}

      {/* Calendar Grid - Week or Month */}
      {showSkeleton ? (
        <CalendarShell variant={viewMode}>
          {viewMode === 'week' ? <SkeletonWeekGrid pillsPerDay={3} /> : <SkeletonMonthGrid />}
        </CalendarShell>
      ) : selectedAthleteIds.size > 0 ? (
        viewMode === 'week' ? (
          <CalendarShell variant="week" data-coach-week-view-version="coach-week-v2">
            <WeekGrid>
              {weekDays.map((day) => {
                const dateKey = day.date;
                const isDayToday = dateKey === getTodayDayKey(athleteTimezone);
                const selected = selectedAthletes;

                return (
                  <AthleteWeekDayColumn
                    key={dateKey}
                    dayName={day.dayName}
                    formattedDate={day.formattedDate}
                    dayWeather={day.weather}
                    isEmpty={false}
                    isToday={isDayToday}
                    onAddClick={selected.length === 1 ? () => openCreateDrawerForAthlete(selected[0].userId, dateKey) : undefined}
                  >
                    <div className="flex flex-col">
                      {selected.map((athlete, index) => {
                        const tz = athlete.user.timezone || 'Australia/Brisbane';
                        const showAthleteSubheaderOnMobile = selected.length > 1;
                        const dayItemsRaw = (itemsByDate[dateKey] || []).filter((item) => item.athleteId === athlete.userId);
                        const dayItems = sortSessionsForDay(
                          dayItemsRaw.map((item) => ({
                            ...item,
                            displayTimeLocal: getCalendarDisplayTime(
                              {
                                ...item,
                              } as any,
                              tz,
                              new Date()
                            ),
                          })),
                          tz
                        );

                        return (
                          <div key={athlete.userId} className="flex flex-col gap-1.5 md:grid md:min-w-0 md:gap-2 md:grid-rows-[32px_auto]">
                            {/* Athlete subheader: always on desktop; on mobile only when stacked */}
                            <div
                              className={cn(
                                'h-8 items-center justify-between gap-2',
                                showAthleteSubheaderOnMobile ? 'flex md:flex' : 'hidden md:flex'
                              )}
                            >
                              <div className="text-[11px] font-medium text-[var(--muted)] truncate min-w-0">
                                {athlete.user.name || athlete.userId}
                              </div>
                              <button
                                type="button"
                                onClick={() => openCreateDrawerForAthlete(athlete.userId, dateKey)}
                                className="hidden md:inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--primary)] hover:bg-[var(--bg-structure)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]"
                                aria-label="Add workout"
                                title="Add workout"
                              >
                                <Icon
                                  name={CALENDAR_ADD_SESSION_ICON}
                                  size="sm"
                                  className={`text-[16px] ${CALENDAR_ACTION_ICON_CLASS}`}
                                  aria-hidden
                                />
                              </button>
                            </div>

                            <div className="min-h-[44px] flex flex-col gap-1 md:gap-2 md:min-h-[72px]">
                              {dayItems.map((item) => (
                                <AthleteWeekSessionRow
                                  key={item.id}
                                  item={{
                                    ...(item as any),
                                    title: `${item.title || item.discipline || 'Workout'}`,
                                  }}
                                  timeZone={tz}
                                  onClick={() => openEditDrawer(item)}
                                  showTimeOnMobile={false}
                                  statusIndicatorVariant="bar"
                                />
                              ))}
                            </div>

                            {index < selected.length - 1 ? (
                              <div className="my-1 md:my-2 h-px bg-[var(--border-subtle)] opacity-40" />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </AthleteWeekDayColumn>
                );
              })}
            </WeekGrid>
          </CalendarShell>
        ) : (
          <CalendarShell variant="month" data-coach-month-view-version="coach-month-v2">
            <MonthGrid>
              {monthDays.map((day) => (
                <AthleteMonthDayCell
                  key={day.dateStr}
                  date={day.date}
                  dateStr={day.dateStr}
                  dayWeather={day.weather}
                  items={day.items as any}
                  isCurrentMonth={day.isCurrentMonth}
                  isToday={day.dateStr === getTodayDayKey(athleteTimezone)}
                  canAdd={selectedAthleteIds.size === 1}
                  onDayClick={(dateStr) => {
                    if (isMobile) {
                      openMobileDaySheet(dateStr);
                      return;
                    }

                    setViewMode('week');
                    setWeekStartKey(startOfWeekDayKey(dateStr));
                  }}
                  onAddClick={(dateStr) => {
                    if (!singleAthleteId) return;
                    openCreateDrawerForAthlete(singleAthleteId, dateStr);
                  }}
                  onItemClick={(itemId) => {
                    const found = itemsById.get(itemId);
                    if (found) {
                      openEditDrawer(found);
                    }
                  }}
                />
              ))}
            </MonthGrid>
          </CalendarShell>
        )
      ) : (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center text-[var(--muted)]">
          <p>Select athletes to view the calendar</p>
        </div>
      )}

      {/* Session Drawer */}
      <SessionDrawer
        isOpen={drawerMode !== 'closed'}
        onClose={closeDrawer}
        title={drawerMode === 'create' ? 'Add Workout' : 'Edit Workout'}
        onSubmit={onSaveSession}
        submitLabel={drawerMode === 'create' ? 'Add Workout' : 'Save Changes'}
        submitDisabled={!effectiveAthleteId}
        onDelete={drawerMode === 'edit' ? onDelete : undefined}
      >
        <div className="space-y-4">
          <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
            Date
            <Input type="date" value={sessionForm.date} onChange={(event) => setSessionForm({ ...sessionForm, date: event.target.value })} required />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
            Start time (optional)
            <Input
              type="time"
              value={sessionForm.plannedStartTimeLocal}
              onChange={(event) => setSessionForm({ ...sessionForm, plannedStartTimeLocal: event.target.value })}
            />
            {editingItem?.latestCompletedActivity?.effectiveStartTimeUtc || editingItem?.latestCompletedActivity?.startTime ? (
              <span className="text-xs font-normal text-[var(--muted)]">
                Actual start:{' '}
                {editingItem.latestCompletedActivity.startTime
                  ? editingItem.latestCompletedActivity.startTime
                  : new Date(editingItem.latestCompletedActivity.effectiveStartTimeUtc as string).toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
              </span>
            ) : null}
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
            Discipline
            <Select value={sessionForm.discipline} onChange={(event) => updateFormDiscipline(event.target.value)} required>
              {DISCIPLINE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
            Workout title
            <Select value={sessionForm.title} required onChange={(event) => setSessionForm({ ...sessionForm, title: event.target.value })}>
              <option value="">Select a title</option>
              {currentDisciplineTitles.map((option) => (
                <option key={option.id} value={option.title}>
                  {option.title}
                </option>
              ))}
              {sessionForm.title && !currentDisciplineTitles.some((option) => option.title === sessionForm.title) ? (
                <option value={sessionForm.title}>{sessionForm.title} (legacy)</option>
              ) : null}
            </Select>
          </label>
          {isTitleLoading() ? <p className="text-xs text-[var(--muted)]">Loading titles…</p> : null}
          <div className="flex flex-wrap gap-3">
            <Input placeholder="Add new title" value={titleInput} onChange={(event) => setTitleInput(event.target.value)} className="flex-1" />
            <Button type="button" variant="secondary" onClick={handleAddTitle} disabled={!titleInput.trim()}>
              Add title
            </Button>
            <Button type="button" variant="ghost" onClick={handleDeleteTitle} disabled={!canDeleteTitle()} title="Delete selected title">
              🗑 Remove
            </Button>
          </div>
          <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
            Template ID (optional)
            <Input value={sessionForm.templateId} onChange={(event) => setSessionForm({ ...sessionForm, templateId: event.target.value })} />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
            Workout detail
            <Textarea
              placeholder="Optional: add instructions the athlete will see for this workout"
              value={sessionForm.workoutDetail}
              onChange={(event) => setSessionForm({ ...sessionForm, workoutDetail: event.target.value })}
              rows={4}
            />
          </label>
          {titleMessage ? <p className="text-xs text-emerald-600">{titleMessage}</p> : null}
          {error && drawerMode !== 'closed' ? <p className="text-xs text-rose-500">{error}</p> : null}
        </div>
      </SessionDrawer>

      {/* Mobile month day bottom sheet */}
      {isMobile && viewMode === 'month' && mobileDaySheetOpen ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/25" onClick={closeMobileDaySheet} />
          <div
            className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            role="dialog"
            aria-label="Day workouts"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--text)]">{mobileDaySheetDateStr || 'Day'}</div>
                <div className="text-xs text-[var(--muted)]">Workouts</div>
              </div>
              <button
                type="button"
                onClick={closeMobileDaySheet}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]"
                aria-label="Close"
              >
                <Icon name="close" size="md" />
              </button>
            </div>

            <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {(() => {
                const day = monthDays.find((d) => d.dateStr === mobileDaySheetDateStr);
                const dayItems = day?.items ?? [];

                if (dayItems.length === 0) {
                  return <div className="text-sm text-[var(--muted)]">No workouts</div>;
                }

                return (
                  <div className="flex flex-col gap-2">
                    {dayItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        data-day-workout-item="true"
                        onClick={() => {
                          closeMobileDaySheet();
                          openEditDrawer(item);
                        }}
                        className="w-full min-h-[44px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-3 text-left hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--bg-structure)]">
                            <Icon name={getDisciplineTheme(item.discipline as any).iconName} size="md" aria-hidden />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] text-[var(--muted)] whitespace-nowrap">
                              {(item as any).displayTimeLocal ?? item.plannedStartTimeLocal ?? ''}
                            </div>
                            <div className="text-sm font-medium text-[var(--text)] truncate">{item.title}</div>
                            <div className="text-[11px] text-[var(--muted)] truncate">{item.athleteName ?? ''}</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

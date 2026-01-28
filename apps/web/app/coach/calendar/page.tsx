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
import { WeekSummaryColumn } from '@/components/coach/WeekSummaryColumn';
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
import { addDaysToDayKey, getLocalDayKey, getTodayDayKey, parseDayKeyToUtcDate, startOfWeekDayKey } from '@/lib/day-key';
import { formatKmCompact, formatKcal, formatMinutesCompact, getRangeDisciplineSummary } from '@/lib/calendar/discipline-summary';
import { cn } from '@/lib/cn';
import { uiEyebrow, uiH1, uiMuted } from '@/components/ui/typography';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { WorkoutStructureView } from '@/components/workouts/WorkoutStructureView';
import { WorkoutDetail } from '@/components/workouts/WorkoutDetail';
import { CalendarContextMenu, Position, ContextMenuAction } from '@/components/coach/CalendarContextMenu';
import { CoachCalendarHelp } from '@/components/coach/CoachCalendarHelp';
import type { WeatherSummary } from '@/lib/weather-model';
import type { CalendarItem } from '@/components/coach/types';

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

type SessionFormState = {
  date: string;
  plannedStartTimeLocal: string;
  title: string;
  discipline: DisciplineOption | string;
  templateId: string;
  plannedDurationMinutes: string;
  plannedDistanceKm: string;
  intensityTarget: string;
  tagsText: string;
  equipmentText: string;
  notes: string;
  workoutStructureText: string;
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
  plannedDurationMinutes: '',
  plannedDistanceKm: '',
  intensityTarget: '',
  tagsText: '',
  equipmentText: '',
  notes: '',
  workoutStructureText: '',
  workoutDetail: '',
});

function splitCommaList(input: string): string[] {
  return input
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function formatCommaList(values: string[] | null | undefined): string {
  return (values ?? []).join(', ');
}

function parseOptionalFloat(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return value;
}

function parseOptionalInt(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.round(value);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

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

function buildCalendarItemCreatePayload(
  source: CalendarItem,
  targetAthleteId: string,
  targetDate: string
) {
  const src = source as any; 

  // Safely handle duration to ensure it's a positive integer or undefined
  let durationMinutes: number | undefined;
  const rawDuration = src.plannedDurationMinutes || (typeof src.durationSec === 'number' ? src.durationSec / 60 : undefined);
  if (typeof rawDuration === 'number' && rawDuration > 0) {
     durationMinutes = Math.round(rawDuration);
  }

  return {
    athleteId: targetAthleteId,
    date: targetDate,
    discipline: src.discipline || 'OTHER',
    // status: 'PLANNED', // Not in schema, let backend default
    title: src.title || 'Workout',
    workoutDetail: src.workoutDetail ?? src.description ?? '',
    
    // Schema: explicit string or undefined. never null.
    plannedStartTimeLocal: src.plannedStartTimeLocal || undefined,
    
    plannedDurationMinutes: durationMinutes,
    
    // Schema: string or undefined. never null.
    intensityTarget: src.intensityTarget || undefined,
    
    distanceMeters: src.distanceMeters || null, // nullable allowed by schema
    
    tags: Array.isArray(src.tags) ? src.tags : [],
    equipment: Array.isArray(src.equipment) ? src.equipment : [],
    workoutStructure: src.workoutStructure || null, // nullable allowed
    // steps_json: src.steps_json || null, // Not in schema, handled by workoutStructure
    notes: src.notes || null, // nullable allowed
  };
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
  const [drawerMode, setDrawerMode] = useState<'closed' | 'create' | 'edit' | 'view_completed'>('closed');
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

  // Context Menu & Clipboard
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: Position;
    type: 'session' | 'day';
    data: any;
  }>({ isOpen: false, position: { x: 0, y: 0 }, type: 'session', data: null });

  // Recurring sessions (for library insert)
  const [groupSessions, setGroupSessions] = useState<{ id: string; title: string; discipline: string; durationMinutes: number; description: string | null; startTimeLocal: string }[]>([]);

  useEffect(() => {
     if (user?.role === 'COACH') {
       request<{ groupSessions: any[] }>('/api/coach/group-sessions')
         .then((data) => {
           setGroupSessions(
             data.groupSessions.map((gs) => ({
               id: gs.id,
               title: gs.title,
               discipline: gs.discipline,
               durationMinutes: gs.durationMinutes,
               description: gs.description,
               startTimeLocal: gs.startTimeLocal,
             }))
           );
         })
         .catch((err) => console.error('Failed to load group sessions for menu', err));
     }
  }, [user?.role, request]);

  const [clipboard, setClipboard] = useState<CalendarItem | null>(null);

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
    if ((drawerMode !== 'edit' && drawerMode !== 'view_completed') || !editItemId) return null;
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
       try {
         setLoading(true);
         await request(`/api/coach/calendar-items/${contextData.id}`, { method: 'DELETE' });
         await loadCalendar();
       } catch (e) {
         setError(e instanceof Error ? e.message : 'Failed to delete session');
       } finally {
         setLoading(false);
       }
    } else if (action === 'paste' && type === 'day') {
      if (!clipboard) return;
      
      const targetAthleteId = contextData.athleteId || effectiveAthleteId || singleAthleteId;
      if (!targetAthleteId) {
        setError('Select an athlete to paste workout.');
        return;
      }
      
      const postPayload = buildCalendarItemCreatePayload(clipboard, targetAthleteId, contextData.date);

      try {
        setLoading(true);
        await request('/api/coach/calendar-items', { method: 'POST', data: postPayload });
        await loadCalendar();
      } catch(e) {
         setError('Couldn’t paste session. Please try copying again.');
         console.debug('Paste failure', e);
      } finally {
         setLoading(false);
      }

    } else if (action === 'library-insert-item' && type === 'day') {
      // payload is the full item object passed from context menu
      const sessionId = payload?.id; 
      const session = groupSessions.find((gs) => gs.id === sessionId);
      const targetAthleteId = contextData.athleteId || effectiveAthleteId || singleAthleteId;
      
      if (!session || !targetAthleteId || !contextData.date) return;

      const postPayload = {
        athleteId: targetAthleteId,
        date: contextData.date,
        // Clone from session
        title: session.title,
        discipline: session.discipline,
        plannedDurationMinutes: session.durationMinutes,
        plannedStartTimeLocal: session.startTimeLocal, // optional
        workoutDetail: session.description ?? '',
        tags: [],
        equipment: [],
      };

      try {
        setLoading(true);
        await request('/api/coach/calendar-items', { method: 'POST', data: postPayload });
        await loadCalendar();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to library insert.');
      } finally {
        setLoading(false);
      }
    }
  }, [contextMenu, clipboard, effectiveAthleteId, singleAthleteId, request, loadCalendar, groupSessions]);

  const openCreateDrawerForAthlete = (athleteId: string, date: string) => {
    setDrawerAthleteId(athleteId);
    setSessionForm(emptyForm(date));
    setEditItemId('');
    setDrawerMode('create');
    setError('');
    setTitleMessage('');
  };

  const openCompletedView = (item: CalendarItem) => {
    setEditItemId(item.id);
    setDrawerAthleteId(item.athleteId || singleAthleteId);
    setDrawerMode('view_completed');
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
      plannedDurationMinutes: typeof item.plannedDurationMinutes === 'number' ? String(item.plannedDurationMinutes) : '',
      plannedDistanceKm: typeof item.plannedDistanceKm === 'number' ? String(item.plannedDistanceKm) : '',
      intensityTarget: item.intensityTarget ?? '',
      tagsText: formatCommaList(item.tags),
      equipmentText: formatCommaList(item.equipment),
      notes: item.notes ?? '',
      workoutStructureText: item.workoutStructure ? safeJsonStringify(item.workoutStructure) : '',
      workoutDetail: item.workoutDetail || '',
    });
    setEditItemId(item.id);
    setDrawerMode('edit');
    setError('');
    setTitleMessage('');
  };

  const handleSessionClick = (item: CalendarItem) => {
    // Ensure we have the latest item state
    const freshItem = itemsById.get(item.id) || item;

    if (freshItem.status?.startsWith('COMPLETED')) {
      openCompletedView(freshItem);
    } else {
      openEditDrawer(freshItem);
    }
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

      const isCreate = drawerMode === 'create';

      const durationMinutes = parseOptionalInt(sessionForm.plannedDurationMinutes);
      if (sessionForm.plannedDurationMinutes.trim() && durationMinutes === null) {
        setError('Duration must be a number of minutes.');
        return;
      }
      if (durationMinutes != null && durationMinutes <= 0) {
        setError('Duration must be a positive number of minutes.');
        return;
      }

      const distanceKm = parseOptionalFloat(sessionForm.plannedDistanceKm);
      if (sessionForm.plannedDistanceKm.trim() && distanceKm === null) {
        setError('Distance must be a number (km).');
        return;
      }
      if (distanceKm != null && distanceKm < 0) {
        setError('Distance cannot be negative.');
        return;
      }

      const distanceMeters = distanceKm != null ? distanceKm * 1000 : null;

      const tags = splitCommaList(sessionForm.tagsText);
      const equipment = splitCommaList(sessionForm.equipmentText);

      const workoutDetailTrimmed = sessionForm.workoutDetail.trim();
      const intensityTargetTrimmed = sessionForm.intensityTarget.trim();
      const notesTrimmed = sessionForm.notes.trim();

      const structureText = sessionForm.workoutStructureText.trim();
      let workoutStructure: unknown | null | undefined = undefined;
      if (structureText) {
        try {
          workoutStructure = JSON.parse(structureText);
        } catch {
          setError('Workout structure must be valid JSON.');
          return;
        }
      } else {
        workoutStructure = isCreate ? undefined : null;
      }

      const payload = {
        athleteId: trimmedAthleteId,
        date: sessionForm.date,
        plannedStartTimeLocal: sessionForm.plannedStartTimeLocal || undefined,
        title: sessionForm.title,
        discipline: normalizedDiscipline,
        templateId: sessionForm.templateId || undefined,
        plannedDurationMinutes: isCreate ? (durationMinutes ?? undefined) : durationMinutes,
        plannedDistanceKm: isCreate ? (distanceKm ?? undefined) : distanceKm,
        distanceMeters: isCreate ? (distanceMeters ?? undefined) : distanceMeters,
        intensityTarget: intensityTargetTrimmed ? intensityTargetTrimmed : isCreate ? undefined : null,
        tags,
        equipment,
        notes: notesTrimmed ? notesTrimmed : isCreate ? undefined : null,
        workoutStructure,
        workoutDetail: workoutDetailTrimmed ? workoutDetailTrimmed : isCreate ? undefined : null,
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
          <div className="flex items-center gap-2">
            <CoachCalendarHelp />
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
          {viewMode === 'week' ? <SkeletonWeekGrid pillsPerDay={3} showSummaryColumn /> : <SkeletonMonthGrid showSummaryColumn />}
        </CalendarShell>
      ) : selectedAthleteIds.size > 0 ? (
        viewMode === 'week' ? (
          <CalendarShell variant="week" data-coach-week-view-version="coach-week-v2">
            <>
              {/* Mobile View */}
              <div className="flex flex-col gap-3 md:hidden">
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
                      headerTestId="coach-calendar-date-header"
                      onContextMenu={(e) => handleContextMenu(e, 'day', { date: dateKey })}
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
                            <div
                              key={athlete.userId}
                              data-testid="coach-calendar-athlete-row"
                              onContextMenu={(e) => handleContextMenu(e, 'day', { date: dateKey, athleteId: athlete.userId })}
                              className="flex flex-col gap-1.5"
                            >
                              <div
                                className={cn(
                                  'h-8 items-center justify-between gap-2',
                                  showAthleteSubheaderOnMobile ? 'flex' : 'hidden'
                                )}
                              >
                                <div className="text-[11px] font-medium text-[var(--muted)] truncate min-w-0">
                                  {athlete.user.name || athlete.userId}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => openCreateDrawerForAthlete(athlete.userId, dateKey)}
                                  className="h-6 w-6 items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--primary)]"
                                >
                                  <Icon name={CALENDAR_ADD_SESSION_ICON} size="sm" className="text-[16px]" aria-hidden />
                                </button>
                              </div>

                              <div className="min-h-[44px] flex flex-col gap-1">
                                {dayItems.map((item) => (
                                  <AthleteWeekSessionRow
                                    key={item.id}
                                    item={{
                                      ...(item as any),
                                      title: `${item.title || item.discipline || 'Workout'}`,
                                    }}
                                    timeZone={tz}
                                    onClick={() => handleSessionClick(item)}
                                    onContextMenu={(e) => handleContextMenu(e, 'session', item)}
                                    showTimeOnMobile={false}
                                    statusIndicatorVariant="bar"
                                  />
                                ))}
                              </div>

                              {index < selected.length - 1 ? (
                                <div className="my-1 h-px bg-[var(--border-subtle)] opacity-40" />
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </AthleteWeekDayColumn>
                  );
                })}
              </div>

              {/* Desktop View (Grid Aligned) */}
              <div
                className={cn('hidden md:grid gap-3', selectedAthleteIds.size > 0 ? 'md:grid-cols-8' : 'md:grid-cols-7')}
                style={{ gridTemplateRows: `auto repeat(${selectedAthletes.length}, auto)` }}
              >
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
                      headerTestId="coach-calendar-date-header"
                      onContextMenu={(e) => handleContextMenu(e, 'day', { date: dateKey })}
                      useSubgrid
                      style={{ gridRow: '1 / -1' }}
                    >
                      {selected.map((athlete, index) => {
                        const tz = athlete.user.timezone || 'Australia/Brisbane';
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
                          <div
                            key={athlete.userId}
                            data-testid="coach-calendar-athlete-row"
                            onContextMenu={(e) => handleContextMenu(e, 'day', { date: dateKey, athleteId: athlete.userId })}
                            className="flex flex-col gap-1.5 md:gap-2 min-w-0"
                          >
                            <div className="hidden md:flex h-8 items-center justify-between gap-2">
                              <div className="text-[11px] font-medium text-[var(--muted)] truncate min-w-0">
                                {athlete.user.name || athlete.userId}
                              </div>
                              <button
                                type="button"
                                onClick={() => openCreateDrawerForAthlete(athlete.userId, dateKey)}
                                data-testid="add-schedule-button"
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
                                  onClick={() => handleSessionClick(item)}
                                  onContextMenu={(e) => handleContextMenu(e, 'session', item)}
                                  showTimeOnMobile={false}
                                  statusIndicatorVariant="bar"
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </AthleteWeekDayColumn>
                  );
                })}

                <WeekSummaryColumn
                  items={items}
                  selectedAthleteIds={selectedAthleteIds}
                  weekStartKey={weekStartKey}
                  athleteTimezone={athleteTimezone}
                  style={{ gridRow: '1 / -1' }}
                />
              </div>
            </>
          </CalendarShell>
        ) : (
          <CalendarShell variant="month" data-coach-month-view-version="coach-month-v2">
            <MonthGrid includeSummaryColumn>
              {Array.from({ length: 6 }, (_, weekIndex) => {
                const start = weekIndex * 7;
                const week = monthDays.slice(start, start + 7);
                const weekWorkoutCount = week.reduce((acc, d) => acc + (d.items as any[]).filter((i) => selectedAthleteIds.has(i.athleteId ?? '') && !!i.latestCompletedActivity?.confirmedAt).length, 0);
                const weekStart = week[0]?.dateStr ?? '';
                const weekEnd = week[6]?.dateStr ?? '';
                const weekSummary = weekStart && weekEnd
                  ? getRangeDisciplineSummary({
                      items,
                      timeZone: athleteTimezone,
                      fromDayKey: weekStart,
                      toDayKey: weekEnd,
                      includePlannedFallback: false,
                      filter: (it: any) => selectedAthleteIds.has((it as any).athleteId ?? '') && !!(it as any).latestCompletedActivity?.confirmedAt,
                    })
                  : null;
                const weekTopDisciplines = weekSummary
                  ? weekSummary.byDiscipline.filter((d) => d.durationMinutes > 0 || d.distanceKm > 0).slice(0, 2)
                  : [];

                return (
                  <div key={`week-${weekIndex}`} className="contents">
                    {week.map((day) => (
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
                            handleSessionClick(found);
                          }
                        }}
                      />
                    ))}

                    <div className="hidden md:block min-h-[110px] bg-[var(--bg-surface)] p-2">
                      <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Week</div>
                      <div className="mt-1 text-xs font-semibold text-[var(--text)] tabular-nums">
                        {weekSummary ? (
                          <>
                            {formatMinutesCompact(weekSummary.totals.durationMinutes)} · {formatKmCompact(weekSummary.totals.distanceKm)}
                          </>
                        ) : (
                          <>{weekWorkoutCount} workouts</>
                        )}
                      </div>
                      {weekSummary ? (
                        <>
                          <div className="text-xs text-[var(--muted)] tabular-nums">Calories: {formatKcal(weekSummary.totals.caloriesKcal)}</div>
                          {weekTopDisciplines.length ? (
                            <div className="mt-1 space-y-0.5">
                              {weekTopDisciplines.map((row) => (
                                <div key={row.discipline} className="flex items-baseline justify-between gap-2">
                                  <div className="text-[11px] font-medium text-[var(--text)] truncate">{row.discipline}</div>
                                  <div className="text-[11px] text-[var(--muted)] tabular-nums whitespace-nowrap">
                                    {formatMinutesCompact(row.durationMinutes)} · {formatKmCompact(row.distanceKm)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="text-xs text-[var(--muted)]">{weekWorkoutCount === 1 ? 'workout' : 'workouts'}</div>
                      )}
                    </div>
                  </div>
                );
              })}
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
        title={drawerMode === 'view_completed' ? 'Workout Detail' : (drawerMode === 'create' ? 'Add Workout' : 'Edit Workout')}
        onSubmit={drawerMode === 'view_completed' ? (e) => { e.preventDefault(); closeDrawer(); } : onSaveSession}
        submitLabel={drawerMode === 'create' ? 'Add Workout' : 'Save Changes'}
        submitDisabled={drawerMode !== 'view_completed' && !effectiveAthleteId}
        onDelete={(drawerMode === 'edit') ? onDelete : undefined}
        hideFooter={drawerMode === 'view_completed'}
      >
        {drawerMode === 'view_completed' && editingItem ? (<div className="p-1"><WorkoutDetail item={editingItem} isDrawer athleteTimezone={editingItem.athleteTimezone} /></div>) : (<div className="space-y-4">
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

          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Workout Detail</h3>
                <p className="text-xs text-[var(--muted)]">Rich fields from the library render for both coach and athlete.</p>
              </div>
            </div>

            {/* Overview row */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(() => {
                const theme = getDisciplineTheme(String(sessionForm.discipline) as any);
                return (
                  <span className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text)]">
                    <Icon name={theme.iconName} size="sm" className={theme.textClass} aria-hidden />
                    <span className="font-medium">{String(sessionForm.discipline)}</span>
                  </span>
                );
              })()}
              {sessionForm.plannedDurationMinutes.trim() ? (
                <span className="inline-flex items-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text)]">
                  {sessionForm.plannedDurationMinutes.trim()} min
                </span>
              ) : null}
              {sessionForm.plannedDistanceKm.trim() ? (
                <span className="inline-flex items-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text)]">
                  {sessionForm.plannedDistanceKm.trim()} km
                </span>
              ) : null}
              {sessionForm.intensityTarget.trim() ? (
                <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm text-[var(--text)]">
                  {sessionForm.intensityTarget.trim()}
                </span>
              ) : null}
            </div>

            {/* Editable fields */}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                Duration (min)
                <Input
                  type="number"
                  inputMode="numeric"
                  value={sessionForm.plannedDurationMinutes}
                  onChange={(event) => setSessionForm({ ...sessionForm, plannedDurationMinutes: event.target.value })}
                  placeholder="e.g. 60"
                  className="min-h-[44px]"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                Distance (km)
                <Input
                  type="number"
                  inputMode="decimal"
                  value={sessionForm.plannedDistanceKm}
                  onChange={(event) => setSessionForm({ ...sessionForm, plannedDistanceKm: event.target.value })}
                  placeholder="optional"
                  className="min-h-[44px]"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)] sm:col-span-2">
                Intensity target
                <Input
                  value={sessionForm.intensityTarget}
                  onChange={(event) => setSessionForm({ ...sessionForm, intensityTarget: event.target.value })}
                  placeholder="e.g. Z2 steady, RPE 6, 4×5' @ threshold"
                  className="min-h-[44px]"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)] sm:col-span-2">
                Tags (comma separated)
                <Input
                  value={sessionForm.tagsText}
                  onChange={(event) => setSessionForm({ ...sessionForm, tagsText: event.target.value })}
                  placeholder="e.g. aerobic, hills"
                  className="min-h-[44px]"
                />
                {splitCommaList(sessionForm.tagsText).length ? (
                  <div className="flex flex-wrap gap-2">
                    {splitCommaList(sessionForm.tagsText).map((tag) => (
                      <span key={tag} className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm text-[var(--text)] break-words">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)] sm:col-span-2">
                Equipment (comma separated)
                <Input
                  value={sessionForm.equipmentText}
                  onChange={(event) => setSessionForm({ ...sessionForm, equipmentText: event.target.value })}
                  placeholder="e.g. trainer, pull buoy"
                  className="min-h-[44px]"
                />
                {splitCommaList(sessionForm.equipmentText).length ? (
                  <div className="flex flex-wrap gap-2">
                    {splitCommaList(sessionForm.equipmentText).map((eq) => (
                      <span key={eq} className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm text-[var(--text)] break-words">
                        {eq}
                      </span>
                    ))}
                  </div>
                ) : null}
              </label>
            </div>

            {/* Structure panel */}
            <details className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <summary className="cursor-pointer select-none text-sm font-medium text-[var(--text)]">Structure</summary>
              <div className="mt-3 space-y-3">
                <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                  workoutStructure (JSON)
                  <Textarea
                    value={sessionForm.workoutStructureText}
                    onChange={(event) => setSessionForm({ ...sessionForm, workoutStructureText: event.target.value })}
                    rows={6}
                    placeholder='e.g. { "segments": [ ... ] }'
                  />
                </label>

                {sessionForm.workoutStructureText.trim() ? (
                  (() => {
                    try {
                      const parsed = JSON.parse(sessionForm.workoutStructureText);
                      return <WorkoutStructureView structure={parsed} />;
                    } catch {
                      return <p className="text-sm text-rose-500">Workout structure must be valid JSON.</p>;
                    }
                  })()
                ) : null}
              </div>
            </details>

            {/* Notes panel */}
            <details className="mt-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <summary className="cursor-pointer select-none text-sm font-medium text-[var(--text)]">Notes</summary>
              <div className="mt-3">
                <Textarea
                  value={sessionForm.notes}
                  onChange={(event) => setSessionForm({ ...sessionForm, notes: event.target.value })}
                  rows={4}
                  placeholder="Optional prep/cooldown cues"
                />
              </div>
            </details>

            <div className="mt-4 grid grid-cols-1 gap-3">
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                Template ID (optional)
                <Input value={sessionForm.templateId} onChange={(event) => setSessionForm({ ...sessionForm, templateId: event.target.value })} />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                Workout detail (instructions)
                <Textarea
                  placeholder="Optional: add instructions the athlete will see for this workout"
                  value={sessionForm.workoutDetail}
                  onChange={(event) => setSessionForm({ ...sessionForm, workoutDetail: event.target.value })}
                  rows={6}
                />
              </label>
            </div>
          </div>
          {titleMessage ? <p className="text-xs text-emerald-600">{titleMessage}</p> : null}
          {error && drawerMode !== 'closed' ? <p className="text-xs text-rose-500">{error}</p> : null}
        </div>
      )}
      </SessionDrawer>

      {/* Context Menu */}
      <CalendarContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        type={contextMenu.type}
        canPaste={!!clipboard}
        onClose={closeContextMenu}
        onAction={handleMenuAction}
        libraryItems={groupSessions}
      />

      
      {/* Global Error Toast */}
      {error && drawerMode === 'closed' && (
        <div className="fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center gap-3 rounded-xl bg-rose-600 px-4 py-3 text-sm font-medium text-white shadow-lg">
            <Icon name="info" size="sm" className="text-white/90" />
            {error}
            <button onClick={() => setError('')} className="ml-2 text-white/80 hover:text-white">
              <Icon name="close" size="sm" />
            </button>
          </div>
        </div>
      )}

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
                          handleSessionClick(item);
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

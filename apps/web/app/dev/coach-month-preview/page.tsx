'use client';

import { useMemo, useState } from 'react';
import { notFound } from 'next/navigation';

import { MonthGrid } from '@/components/coach/MonthGrid';
import { AthleteMonthDayCell } from '@/components/athlete/AthleteMonthDayCell';
import { CalendarShell } from '@/components/calendar/CalendarShell';
import { getCalendarDisplayTime } from '@/components/calendar/getCalendarDisplayTime';
import { sortSessionsForDay } from '@/components/athlete/sortSessionsForDay';
import { addDaysToDayKey, getTodayDayKey, parseDayKeyToUtcDate, startOfWeekDayKey } from '@/lib/day-key';

export const dynamic = 'force-dynamic';

type PreviewWorkout = {
  id: string;
  date: string;
  plannedStartTimeLocal: string | null;
  discipline: string;
  status: string;
  title: string;
  workoutDetail?: string | null;
};

function buildPreviewItems(now: Date): PreviewWorkout[] {
  const tz = 'Australia/Brisbane';
  const todayStr = getTodayDayKey(tz, now);
  const yStr = addDaysToDayKey(todayStr, -1);
  const tStr = addDaysToDayKey(todayStr, 1);
  const d3Str = addDaysToDayKey(todayStr, 3);

  return [
    { id: 'coach-today-1', date: todayStr, plannedStartTimeLocal: '06:30', discipline: 'RUN', status: 'PLANNED', title: 'Easy run' },
    { id: 'coach-today-2', date: todayStr, plannedStartTimeLocal: '12:00', discipline: 'BIKE', status: 'PLANNED', title: 'Trainer ride', workoutDetail: 'Keep Z2' },
    { id: 'coach-today-3', date: todayStr, plannedStartTimeLocal: '18:15', discipline: 'SWIM', status: 'PLANNED', title: 'Main set' },

    { id: 'coach-yday-1', date: yStr, plannedStartTimeLocal: '07:00', discipline: 'RUN', status: 'PLANNED', title: 'Steady run' },

    { id: 'coach-tmr-1', date: tStr, plannedStartTimeLocal: '07:00', discipline: 'RUN', status: 'PLANNED', title: 'Intervals' },

    { id: 'coach-rest-1', date: d3Str, plannedStartTimeLocal: null, discipline: 'REST', status: 'PLANNED', title: 'Rest' },

    // Overflow day: lots of workouts today to confirm clipping
    ...Array.from({ length: 12 }).map((_, i) => ({
      id: `coach-today-overflow-${i + 1}`,
      date: todayStr,
      plannedStartTimeLocal: `0${(i % 9) + 1}:00`,
      discipline: i % 2 === 0 ? 'RUN' : 'BIKE',
      status: 'PLANNED',
      title: `Workout ${i + 1}`,
    })),
  ];
}

export default function DevCoachMonthPreviewPage() {
  // Dev-only page: default hidden unless explicitly enabled.
  if (process.env.NODE_ENV === 'production') notFound();
  if (process.env.NEXT_PUBLIC_SHOW_DEV_PAGES !== 'true') notFound();

  const now = useMemo(() => new Date('2026-01-03T10:00:00.000Z'), []);
  const tz = 'Australia/Brisbane';
  const todayKey = useMemo(() => getTodayDayKey(tz, now), [now]);
  const [selected, setSelected] = useState<{ kind: 'day' | 'workout'; value: string } | null>(null);

  const previewItems = useMemo(() => buildPreviewItems(now), [now]);

  const month = useMemo(() => {
    return {
      year: Number(todayKey.slice(0, 4)),
      month: Number(todayKey.slice(5, 7)) - 1,
    };
  }, [todayKey]);

  const monthDays = useMemo(() => {
    const gridStartKey = startOfWeekDayKey(`${month.year}-${String(month.month + 1).padStart(2, '0')}-01`);

    const byDate: Record<string, PreviewWorkout[]> = {};
    for (const item of previewItems) {
      byDate[item.date] ??= [];
      byDate[item.date].push(item);
    }

    const sortedByDate: Record<string, any[]> = {};
    for (const dateStr of Object.keys(byDate)) {
      sortedByDate[dateStr] = sortSessionsForDay(
        byDate[dateStr].map((item) => ({
          ...item,
          displayTimeLocal: getCalendarDisplayTime(item as any, tz, now),
        })) as any,
        tz
      ) as any;
    }

    return Array.from({ length: 42 }, (_, i) => {
      const dateStr = addDaysToDayKey(gridStartKey, i);
      const date = parseDayKeyToUtcDate(dateStr);
      return {
        date,
        dateStr,
        isCurrentMonth: dateStr.slice(0, 7) === `${month.year}-${String(month.month + 1).padStart(2, '0')}`,
        isToday: dateStr === todayKey,
        items: (sortedByDate[dateStr] || []) as any,
      };
    });
  }, [month.year, month.month, now, previewItems, todayKey]);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-normal">Dev: Coach Month Preview</h1>
      <p className="text-sm text-[var(--muted)]">
        This page is dev-only. It renders the coach month grid with fixture data to validate surface parity.
      </p>

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-sm">
        <div className="text-[var(--muted)]">Selection</div>
        <div data-testid="selection" className="mt-1">
          {selected ? `${selected.kind}: ${selected.value}` : 'none'}
        </div>
      </div>

      <CalendarShell variant="month" data-coach-month-view-version="coach-month-v2">
        <MonthGrid>
          {monthDays.map((day) => (
            <AthleteMonthDayCell
              key={day.dateStr}
              date={day.date}
              dateStr={day.dateStr}
              items={day.items as any}
              isCurrentMonth={day.isCurrentMonth}
              isToday={day.isToday}
              onDayClick={(dateStr) => setSelected({ kind: 'day', value: dateStr })}
              onItemClick={(itemId) => setSelected({ kind: 'workout', value: itemId })}
            />
          ))}
        </MonthGrid>
      </CalendarShell>
    </section>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { notFound } from 'next/navigation';

import { WeekGrid } from '@/components/coach/WeekGrid';
import { AthleteWeekDayColumn } from '@/components/athlete/AthleteWeekDayColumn';
import { AthleteWeekSessionRow } from '@/components/athlete/AthleteWeekSessionRow';
import { CalendarShell } from '@/components/calendar/CalendarShell';
import { getCalendarDisplayTime } from '@/components/calendar/getCalendarDisplayTime';

export const dynamic = 'force-dynamic';

type PreviewItem = {
  id: string;
  plannedStartTimeLocal: string | null;
  status: string;
  discipline: string;
  title: string;
  workoutDetail?: string | null;
};

type PreviewDay = {
  date: string;
  dayName: string;
  formattedDate: string;
  isToday: boolean;
  items: PreviewItem[];
};

export default function DevCoachWeekPreviewPage() {
  // Dev-only page: default hidden unless explicitly enabled.
  if (process.env.NODE_ENV === 'production') notFound();
  if (process.env.NEXT_PUBLIC_SHOW_DEV_PAGES !== 'true') notFound();

  const days = useMemo<PreviewDay[]>(
    () => [
      {
        date: '2026-01-01',
        dayName: 'Mon',
        formattedDate: 'Jan 1',
        isToday: false,
        items: [
          { id: 'c-mon-1', plannedStartTimeLocal: '06:00', status: 'PLANNED', discipline: 'RUN', title: 'Easy run', workoutDetail: null },
          { id: 'c-mon-2', plannedStartTimeLocal: '18:00', status: 'PLANNED', discipline: 'STRENGTH', title: 'Gym', workoutDetail: 'Keep it light' },
        ],
      },
      {
        date: '2026-01-02',
        dayName: 'Tue',
        formattedDate: 'Jan 2',
        isToday: false,
        items: [{ id: 'c-tue-1', plannedStartTimeLocal: '05:30', status: 'PLANNED', discipline: 'BIKE', title: 'Intervals', workoutDetail: null }],
      },
      {
        date: '2026-01-03',
        dayName: 'Wed',
        formattedDate: 'Jan 3',
        isToday: true,
        items: [],
      },
      {
        date: '2026-01-04',
        dayName: 'Thu',
        formattedDate: 'Jan 4',
        isToday: false,
        items: [{ id: 'c-thu-1', plannedStartTimeLocal: '07:00', status: 'PLANNED', discipline: 'SWIM', title: 'Technique', workoutDetail: null }],
      },
      {
        date: '2026-01-05',
        dayName: 'Fri',
        formattedDate: 'Jan 5',
        isToday: false,
        items: [{ id: 'c-fri-1', plannedStartTimeLocal: null, status: 'PLANNED', discipline: 'REST', title: 'Rest', workoutDetail: null }],
      },
      {
        date: '2026-01-06',
        dayName: 'Sat',
        formattedDate: 'Jan 6',
        isToday: false,
        items: [{ id: 'c-sat-1', plannedStartTimeLocal: '08:00', status: 'PLANNED', discipline: 'BRICK', title: 'Brick workout', workoutDetail: 'Workout detail present' }],
      },
      {
        date: '2026-01-07',
        dayName: 'Sun',
        formattedDate: 'Jan 7',
        isToday: false,
        items: [{ id: 'c-sun-1', plannedStartTimeLocal: '09:00', status: 'PLANNED', discipline: 'RUN', title: 'Long run', workoutDetail: null }],
      },
    ],
    []
  );

  const [clicked, setClicked] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <header className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-5">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Dev Preview</p>
        <h1 className="text-2xl font-semibold">Coach Week Preview</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Last click: {clicked ?? 'none'}</p>
      </header>

      <CalendarShell variant="week" data-coach-week-view-version="coach-week-v2">
        <WeekGrid>
          {days.map((day) => (
            <AthleteWeekDayColumn
              key={day.date}
              dayName={day.dayName}
              formattedDate={day.formattedDate}
              isEmpty={day.items.length === 0}
              isToday={day.isToday}
            >
              {day.items.map((item) => (
                <AthleteWeekSessionRow
                  key={item.id}
                  item={{
                    id: item.id,
                    date: day.date,
                    plannedStartTimeLocal: item.plannedStartTimeLocal,
                    discipline: item.discipline,
                    status: item.status,
                    title: item.title,
                    workoutDetail: item.workoutDetail,
                    displayTimeLocal: getCalendarDisplayTime(
                      {
                        id: item.id,
                        date: day.date,
                        status: item.status,
                        plannedStartTimeLocal: item.plannedStartTimeLocal,
                        latestCompletedActivity: null,
                      },
                      'Australia/Brisbane',
                      new Date('2026-01-03T10:00:00Z')
                    ),
                  }}
                  timeZone="Australia/Brisbane"
                  onClick={() => setClicked(`item:${item.id}`)}
                  now={new Date('2026-01-03T10:00:00Z')}
                />
              ))}
            </AthleteWeekDayColumn>
          ))}
        </WeekGrid>
      </CalendarShell>
    </div>
  );
}

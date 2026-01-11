'use client';

import { AthleteWeekGrid } from '@/components/athlete/AthleteWeekGrid';
import { AthleteWeekDayColumn } from '@/components/athlete/AthleteWeekDayColumn';
import { AthleteWeekSessionRow } from '@/components/athlete/AthleteWeekSessionRow';
import type { AthleteWeekSessionRowItem } from '@/components/athlete/AthleteWeekSessionRow';
import { CalendarShell } from '@/components/calendar/CalendarShell';

const weekDays: Array<{ dayName: string; formattedDate: string; isToday: boolean }> = [
  { dayName: 'Mon', formattedDate: 'Jan 1', isToday: false },
  { dayName: 'Tue', formattedDate: 'Jan 2', isToday: false },
  { dayName: 'Wed', formattedDate: 'Jan 3', isToday: true },
  { dayName: 'Thu', formattedDate: 'Jan 4', isToday: false },
  { dayName: 'Fri', formattedDate: 'Jan 5', isToday: false },
  { dayName: 'Sat', formattedDate: 'Jan 6', isToday: false },
  { dayName: 'Sun', formattedDate: 'Jan 7', isToday: false },
];

const itemsByIndex: AthleteWeekSessionRowItem[][] = [
  [
    {
      id: 'a1',
      date: '2026-01-01',
      plannedStartTimeLocal: '06:00',
      displayTimeLocal: '6:00 AM',
      discipline: 'RUN',
      status: 'PLANNED',
      title: 'Easy Run',
    },
    {
      id: 'a2',
      date: '2026-01-01',
      plannedStartTimeLocal: '18:00',
      displayTimeLocal: '6:00 PM',
      discipline: 'STRENGTH',
      status: 'PLANNED',
      title: 'Gym',
    },
  ],
  [
    {
      id: 'b1',
      date: '2026-01-02',
      plannedStartTimeLocal: '05:30',
      displayTimeLocal: '5:30 AM',
      discipline: 'BIKE',
      status: 'PLANNED',
      title: 'Intervals',
    },
  ],
  [],
  [
    {
      id: 'd1',
      date: '2026-01-04',
      plannedStartTimeLocal: '07:00',
      displayTimeLocal: '7:00 AM',
      discipline: 'SWIM',
      status: 'COMPLETED',
      title: 'Technique',
    },
  ],
  [
    {
      id: 'e1',
      date: '2026-01-05',
      plannedStartTimeLocal: null,
      displayTimeLocal: '',
      discipline: 'REST',
      status: 'PLANNED',
      title: 'Rest',
    },
  ],
  [
    {
      id: 'f1',
      date: '2026-01-06',
      plannedStartTimeLocal: '08:00',
      displayTimeLocal: '8:00 AM',
      discipline: 'BRICK',
      status: 'PLANNED',
      title: 'Brick Session',
      latestCompletedActivity: { painFlag: true },
      notes: 'Coach advice present',
    },
  ],
  [
    {
      id: 'g1',
      date: '2026-01-07',
      plannedStartTimeLocal: '09:00',
      displayTimeLocal: '9:00 AM',
      discipline: 'RUN',
      status: 'MISSED',
      title: 'Long Run',
    },
  ],
];

export default function WeekPreviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-5">
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Dev Preview</p>
        <h1 className="text-2xl font-semibold">Week Preview</h1>
      </header>

      <CalendarShell variant="week" data-athlete-week-view-version="athlete-week-v2">
        <AthleteWeekGrid>
          {weekDays.map((day, index) => {
            const items = itemsByIndex[index] ?? [];
            return (
              <AthleteWeekDayColumn
                key={day.dayName}
                dayName={day.dayName}
                formattedDate={day.formattedDate}
                isToday={day.isToday}
                isEmpty={items.length === 0}
              >
                {items.map((item) => (
                  <AthleteWeekSessionRow
                    key={item.id}
                    item={item}
                    onClick={() => {}}
                    timeZone="Australia/Brisbane"
                    now={new Date('2026-01-03T10:00:00.000Z')}
                  />
                ))}
              </AthleteWeekDayColumn>
            );
          })}
        </AthleteWeekGrid>
      </CalendarShell>
    </div>
  );
}

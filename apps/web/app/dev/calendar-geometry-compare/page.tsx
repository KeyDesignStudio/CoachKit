'use client';

import { useMemo, useState } from 'react';
import { notFound } from 'next/navigation';

import { startOfWeek, addDays, toDateInput, formatDisplay } from '@/lib/client-date';

import { ReviewGrid } from '@/components/coach/ReviewGrid';
import { AthleteRow } from '@/components/coach/AthleteRow';
import { ReviewChip } from '@/components/coach/ReviewChip';

import { CalendarShell } from '@/components/calendar/CalendarShell';
import { WeekGrid } from '@/components/calendar/WeekGrid';
import { AthleteWeekDayColumn } from '@/components/athlete/AthleteWeekDayColumn';
import { AthleteWeekSessionRow } from '@/components/athlete/AthleteWeekSessionRow';

export const dynamic = 'force-dynamic';

type WeekItem = {
  id: string;
  date: string;
  plannedStartTimeLocal: string | null;
  status: string;
  discipline: string;
  title: string;
  workoutDetail?: string | null;
  latestCompletedActivity?: { painFlag?: boolean } | null;
};

export default function DevCalendarGeometryComparePage() {
  // Dev-only page: default hidden unless explicitly enabled.
  if (process.env.NODE_ENV === 'production') notFound();
  if (process.env.NEXT_PUBLIC_SHOW_DEV_PAGES !== 'true') notFound();

  const weekStart = useMemo(() => startOfWeek(), []);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => toDateInput(addDays(weekStart, i))), [weekStart]);
  const todayKey = toDateInput(new Date());

  const [clicked, setClicked] = useState<string | null>(null);

  const dashboardAthleteData = useMemo(() => {
    const makeItem = (params: Omit<WeekItem, 'id'> & { id: string }) => params;
    const twoDaysOut = weekDays.includes(todayKey)
      ? weekDays[Math.min(weekDays.indexOf(todayKey) + 2, 6)]
      : weekDays[2];

    return [
      {
        id: 'ath-1',
        name: 'Alex (long-name athlete to test truncation)',
        itemsByDate: new Map<string, any[]>([
          [
            todayKey,
            [
              makeItem({
                id: 'd-a1-t1',
                date: `${todayKey}T00:00:00.000Z`,
                plannedStartTimeLocal: '06:00',
                status: 'PLANNED',
                discipline: 'RUN',
                title: 'Easy run with a very long title that should truncate cleanly',
                workoutDetail: null,
                latestCompletedActivity: null,
              }),
              makeItem({
                id: 'd-a1-t2',
                date: `${todayKey}T00:00:00.000Z`,
                plannedStartTimeLocal: '18:00',
                status: 'PLANNED',
                discipline: 'STRENGTH',
                title: 'Gym',
                workoutDetail: 'Workout detail present',
                latestCompletedActivity: { painFlag: false },
              }),
            ],
          ],
          [
            twoDaysOut,
            [
              makeItem({
                id: 'd-a1-2d-1',
                date: `${twoDaysOut}T00:00:00.000Z`,
                plannedStartTimeLocal: '12:00',
                status: 'PLANNED',
                discipline: 'SWIM',
                title: 'Technique',
                workoutDetail: null,
                latestCompletedActivity: null,
              }),
            ],
          ],
        ]),
      },
      {
        id: 'ath-2',
        name: 'Bailey',
        itemsByDate: new Map<string, any[]>([
          [
            todayKey,
            [
              makeItem({
                id: 'd-a2-t1',
                date: `${todayKey}T00:00:00.000Z`,
                plannedStartTimeLocal: '07:15',
                status: 'COMPLETED_SYNCED',
                discipline: 'BIKE',
                title: 'Trainer ride',
                workoutDetail: null,
                latestCompletedActivity: { painFlag: true },
              }),
            ],
          ],
        ]),
      },
    ];
  }, [todayKey, weekDays]);

  const weekPreviewItemsByDate = useMemo(() => {
    const makeItem = (params: Omit<WeekItem, 'id'> & { id: string }) => params;
    const twoDaysOut = weekDays.includes(todayKey)
      ? weekDays[Math.min(weekDays.indexOf(todayKey) + 2, 6)]
      : weekDays[2];

    return new Map<string, WeekItem[]>([
      [
        todayKey,
        [
          makeItem({
            id: 'w-t1',
            date: `${todayKey}T00:00:00.000Z`,
            plannedStartTimeLocal: '06:00',
            status: 'PLANNED',
            discipline: 'RUN',
            title: 'Easy run with a very long title that should truncate cleanly',
            workoutDetail: null,
            latestCompletedActivity: null,
          }),
          makeItem({
            id: 'w-t2',
            date: `${todayKey}T00:00:00.000Z`,
            plannedStartTimeLocal: '18:00',
            status: 'PLANNED',
            discipline: 'STRENGTH',
            title: 'Gym',
            workoutDetail: 'Workout detail present',
            latestCompletedActivity: { painFlag: false },
          }),
        ],
      ],
      [
        twoDaysOut,
        [
          makeItem({
            id: 'w-2d-1',
            date: `${twoDaysOut}T00:00:00.000Z`,
            plannedStartTimeLocal: '12:00',
            status: 'PLANNED',
            discipline: 'SWIM',
            title: 'Technique',
            workoutDetail: null,
            latestCompletedActivity: null,
          }),
        ],
      ],
    ]);
  }, [todayKey, weekDays]);

  return (
    <div className="flex flex-col gap-6">
      <header className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-5">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Dev Preview</p>
        <h1 className="text-2xl font-semibold">Calendar Geometry Compare</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Last click: {clicked ?? 'none'}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <h2 className="text-sm font-semibold text-[var(--text)] mb-2">Dashboard (Review Grid)</h2>
          <ReviewGrid weekDays={weekDays} todayIndex={weekDays.indexOf(todayKey)}>
            {dashboardAthleteData.map((athlete) => (
              <AthleteRow key={athlete.id} athleteName={athlete.name} todayIndex={weekDays.indexOf(todayKey)}>
                {weekDays.map((dateKey) => {
                  const dayItems = athlete.itemsByDate.get(dateKey) ?? [];
                  return (
                    <div key={`${athlete.id}:${dateKey}`} className="flex flex-col gap-1 min-w-0">
                      {dayItems.map((item) => (
                        <ReviewChip
                          key={item.id}
                          time={item.plannedStartTimeLocal}
                          title={item.title}
                          discipline={item.discipline}
                          hasAthleteComment={false}
                          painFlag={item.latestCompletedActivity?.painFlag ?? false}
                          onClick={() => setClicked(`dashboard:${item.id}`)}
                        />
                      ))}
                    </div>
                  );
                })}
              </AthleteRow>
            ))}
          </ReviewGrid>
        </section>

        <section className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <h2 className="text-sm font-semibold text-[var(--text)] mb-2">Week (Shared Calendar)</h2>
          <CalendarShell variant="week">
            <WeekGrid>
              {weekDays.map((dateKey, index) => {
                const items = weekPreviewItemsByDate.get(dateKey) ?? [];
                return (
                  <AthleteWeekDayColumn
                    key={dateKey}
                    dayName={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index]}
                    formattedDate={formatDisplay(dateKey).split(',')[0]}
                    isToday={dateKey === todayKey}
                    isEmpty={items.length === 0}
                    onHeaderClick={() => setClicked(`week:header:${dateKey}`)}
                    onEmptyClick={() => setClicked(`week:empty:${dateKey}`)}
                  >
                    {items.map((item) => (
                      <AthleteWeekSessionRow
                        key={item.id}
                        item={{
                          ...(item as any),
                          displayTimeLocal: item.plannedStartTimeLocal,
                        }}
                        timeZone="Australia/Brisbane"
                        onClick={() => setClicked(`week:item:${item.id}`)}
                      />
                    ))}
                  </AthleteWeekDayColumn>
                );
              })}
            </WeekGrid>
          </CalendarShell>
        </section>

      </div>
    </div>
  );
}

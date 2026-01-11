'use client';

import { useMemo, useState } from 'react';
import { notFound } from 'next/navigation';

import { addDays, startOfWeek, toDateInput } from '@/lib/client-date';
import { MultiAthleteGrid } from '@/components/coach/MultiAthleteGrid';

export const dynamic = 'force-dynamic';

type PreviewItem = {
  id: string;
  date: string;
  plannedStartTimeLocal: string | null;
  status: string;
  discipline: string;
  title: string;
  notes?: string | null;
  latestCompletedActivity?: { painFlag: boolean } | null;
};

export default function DevMultiCalendarPreviewPage() {
  // Dev-only page: default hidden unless explicitly enabled.
  if (process.env.NODE_ENV === 'production') notFound();
  if (process.env.NEXT_PUBLIC_SHOW_DEV_PAGES !== 'true') notFound();

  const weekStart = useMemo(() => startOfWeek(), []);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => toDateInput(addDays(weekStart, i))), [weekStart]);

  const [clicked, setClicked] = useState<string | null>(null);

  const athleteData = useMemo(
    () => {
      const todayKey = toDateInput(new Date());

      const makeItem = (params: Omit<PreviewItem, 'id'> & { id: string }) => params;

      const athletes = [
        {
          athlete: { id: 'a-1', name: 'Alex (long-name athlete to test truncation)', timezone: 'America/Los_Angeles' },
          weekStatus: 'DRAFT' as const,
          items: [
            makeItem({
              id: 'a1-today-1',
              date: `${todayKey}T00:00:00.000Z`,
              plannedStartTimeLocal: '06:00',
              status: 'PLANNED',
              discipline: 'RUN',
              title: 'Easy run with a very long title that should truncate cleanly instead of stretching columns',
              notes: null,
              latestCompletedActivity: null,
            }),
            makeItem({
              id: 'a1-today-2',
              date: `${todayKey}T00:00:00.000Z`,
              plannedStartTimeLocal: '18:00',
              status: 'PLANNED',
              discipline: 'STRENGTH',
              title: 'Gym',
              notes: 'Coach advice present',
              latestCompletedActivity: { painFlag: false },
            }),
          ] as any,
        },
        {
          athlete: { id: 'a-2', name: 'Bailey', timezone: 'Australia/Brisbane' },
          weekStatus: 'PUBLISHED' as const,
          items: [
            makeItem({
              id: 'a2-today-1',
              date: `${todayKey}T00:00:00.000Z`,
              plannedStartTimeLocal: '07:15',
              status: 'COMPLETED_SYNCED',
              discipline: 'BIKE',
              title: 'Trainer ride',
              notes: null,
              latestCompletedActivity: { painFlag: true },
            }),
          ] as any,
        },
        {
          athlete: { id: 'a-3', name: 'Casey', timezone: 'Europe/London' },
          weekStatus: 'DRAFT' as const,
          items: [] as any,
        },
      ];

      // Also sprinkle a couple of sessions on another day to validate multi-row layout.
      const twoDaysOut = weekDays.includes(todayKey)
        ? weekDays[Math.min(weekDays.indexOf(todayKey) + 2, 6)]
        : weekDays[2];

      (athletes[0].items as any).push(
        makeItem({
          id: 'a1-2days-1',
          date: `${twoDaysOut}T00:00:00.000Z`,
          plannedStartTimeLocal: '12:00',
          status: 'PLANNED',
          discipline: 'SWIM',
          title: 'Technique',
          notes: null,
          latestCompletedActivity: null,
        })
      );

      return athletes;
    },
    [weekDays]
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-5">
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Dev Preview</p>
        <h1 className="text-2xl font-semibold">Multi-athlete Calendar Preview</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Last click: {clicked ?? 'none'}</p>
      </header>

      <MultiAthleteGrid
        athleteData={athleteData as any}
        weekDays={weekDays}
        onItemClick={(item: any) => setClicked(`item:${item.id}`)}
        onRefresh={() => null}
      />
    </div>
  );
}

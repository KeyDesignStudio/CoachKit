'use client';

import { useMemo, useState } from 'react';
import { notFound } from 'next/navigation';

import { MonthGrid } from '@/components/coach/MonthGrid';
import { AthleteMonthDayCell } from '@/components/athlete/AthleteMonthDayCell';
import { addDays, toDateInput } from '@/lib/client-date';

export const dynamic = 'force-dynamic';

type PreviewSession = {
  id: string;
  date: string;
  plannedStartTimeLocal: string | null;
  discipline: string;
  status: string;
  title: string;
};

function buildPreviewItems(now: Date): PreviewSession[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const inThreeDays = addDays(today, 3);

  const todayStr = toDateInput(today);
  const yStr = toDateInput(yesterday);
  const tStr = toDateInput(tomorrow);
  const d3Str = toDateInput(inThreeDays);

  return [
    // Multiple sessions today (planned + draft + submitted)
    { id: 'sess-today-1', date: todayStr, plannedStartTimeLocal: '06:30', discipline: 'RUN', status: 'PLANNED', title: 'Easy run' },
    { id: 'sess-today-2', date: todayStr, plannedStartTimeLocal: '12:00', discipline: 'BIKE', status: 'COMPLETED_SYNCED_DRAFT', title: 'Trainer ride' },
    { id: 'sess-today-3', date: todayStr, plannedStartTimeLocal: '18:15', discipline: 'SWIM', status: 'COMPLETED_SYNCED', title: 'Main set' },

    // Yesterday planned becomes MISSED (only after day end)
    { id: 'sess-yday-1', date: yStr, plannedStartTimeLocal: '07:00', discipline: 'RUN', status: 'PLANNED', title: 'Steady run' },

    // Tomorrow planned should remain neutral
    { id: 'sess-tmr-1', date: tStr, plannedStartTimeLocal: '07:00', discipline: 'RUN', status: 'PLANNED', title: 'Intervals' },

    // Explicit REST
    { id: 'sess-rest-1', date: d3Str, plannedStartTimeLocal: null, discipline: 'REST', status: 'PLANNED', title: 'Rest' },

    // Overflow day: lots of sessions today to confirm clipping
    ...Array.from({ length: 12 }).map((_, i) => ({
      id: `sess-today-overflow-${i + 1}`,
      date: todayStr,
      plannedStartTimeLocal: `0${(i % 9) + 1}:00`,
      discipline: i % 2 === 0 ? 'RUN' : 'BIKE',
      status: 'PLANNED',
      title: `Session ${i + 1}`,
    })),
  ];
}

export default function DevMonthPreviewPage() {
  // Dev-only page: default hidden unless explicitly enabled.
  if (process.env.NODE_ENV === 'production') notFound();
  if (process.env.NEXT_PUBLIC_SHOW_DEV_PAGES !== 'true') notFound();

  const now = useMemo(() => new Date(), []);
  const [selected, setSelected] = useState<{ kind: 'day' | 'session'; value: string } | null>(null);

  const previewItems = useMemo(() => buildPreviewItems(now), [now]);

  const month = useMemo(() => {
    const d = new Date(now);
    return { year: d.getFullYear(), month: d.getMonth() };
  }, [now]);

  const monthDays = useMemo(() => {
    const gridStart = (() => {
      const firstDayOfMonth = new Date(month.year, month.month, 1);
      const dayOfWeek = firstDayOfMonth.getDay(); // 0 = Sunday
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      return new Date(month.year, month.month, 1 + mondayOffset);
    })();

    const byDate: Record<string, PreviewSession[]> = {};
    for (const item of previewItems) {
      byDate[item.date] ??= [];
      byDate[item.date].push(item);
    }

    for (const dateStr of Object.keys(byDate)) {
      byDate[dateStr].sort((a, b) => (a.plannedStartTimeLocal || '').localeCompare(b.plannedStartTimeLocal || ''));
    }

    return Array.from({ length: 42 }, (_, i) => {
      const date = addDays(gridStart, i);
      const dateStr = toDateInput(date);
      return {
        date,
        dateStr,
        isCurrentMonth: date.getMonth() === month.month,
        isToday: dateStr === toDateInput(now),
        items: byDate[dateStr] || [],
      };
    });
  }, [month.year, month.month, now, previewItems]);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-normal">Dev: Athlete Month Preview</h1>
      <p className="text-sm text-[var(--muted)]">
        This page is dev-only. It renders the month grid with fixture data to validate the icon-first contract.
      </p>

      <div className="rounded-2xl border border-white/20 bg-white/30 p-3 text-sm">
        <div className="text-[var(--muted)]">Selection</div>
        <div data-testid="selection" className="mt-1">
          {selected ? `${selected.kind}: ${selected.value}` : 'none'}
        </div>
      </div>

      <MonthGrid>
        {monthDays.map((day) => (
          <AthleteMonthDayCell
            key={day.dateStr}
            date={day.date}
            dateStr={day.dateStr}
            items={day.items}
            isCurrentMonth={day.isCurrentMonth}
            isToday={day.isToday}
            onDayClick={(d) => setSelected({ kind: 'day', value: toDateInput(d) })}
            onItemClick={(id) => setSelected({ kind: 'session', value: id })}
          />
        ))}
      </MonthGrid>
    </section>
  );
}

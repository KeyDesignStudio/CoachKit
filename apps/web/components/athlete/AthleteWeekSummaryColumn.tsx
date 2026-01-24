'use client';

import { useMemo } from 'react';

import { cn } from '@/lib/cn';
import { formatWeekOfLabel } from '@/lib/client-date';
import { getWeeklyAchievedSummary, type CalendarItemForWeeklySummary } from '@/lib/calendar/getWeeklyAchievedSummary';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatHhMm(totalSec: number): string {
  const safe = Number.isFinite(totalSec) ? Math.max(0, Math.round(totalSec)) : 0;
  const totalMin = Math.floor(safe / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${pad2(m)}`;
}

function formatKm(totalMeters: number): string {
  const m = Number.isFinite(totalMeters) ? Math.max(0, totalMeters) : 0;
  const km = m / 1000;
  if (km <= 0) return '0';
  if (km < 10) return km.toFixed(1);
  return String(Math.round(km));
}

function formatSwimMeters(totalMeters: number): string {
  const m = Number.isFinite(totalMeters) ? Math.max(0, totalMeters) : 0;
  return String(Math.round(m));
}

type AthleteWeekSummaryColumnProps = {
  weekStartKey: string;
  athleteTimezone: string;
  items: CalendarItemForWeeklySummary[];
  density?: 'default' | 'compact';
};

export function AthleteWeekSummaryColumn({ weekStartKey, athleteTimezone, items, density = 'default' }: AthleteWeekSummaryColumnProps) {
  const summary = useMemo(() => getWeeklyAchievedSummary(items, athleteTimezone), [items, athleteTimezone]);

  const headerClassName =
    density === 'compact'
      ? 'bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] px-3 py-1 md:py-1.5'
      : 'bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] px-3 py-2 md:px-3 md:py-2.5';

  const bodyClassName = cn(
    density === 'compact'
      ? 'flex flex-col gap-1 p-2 md:gap-1.5 md:p-2'
      : 'flex flex-col gap-1.5 p-2.5 md:gap-2 md:p-3'
  );

  const disciplineRows = (
    [
      { key: 'RUN' as const, label: 'RUN' },
      { key: 'BIKE' as const, label: 'BIKE' },
      { key: 'SWIM' as const, label: 'SWIM' },
      { key: 'OTHER' as const, label: 'STRENGTH/OTHER' },
    ]
      .map((d) => {
        const entry = summary.perDiscipline[d.key];
        const hasAny = entry.timeSec > 0 || entry.distanceMeters > 0;
        if (!hasAny) return null;

        if (d.key === 'SWIM') {
          return {
            label: d.label,
            time: formatHhMm(entry.timeSec),
            distance: `${formatSwimMeters(entry.distanceMeters)} m`,
          };
        }

        if (d.key === 'OTHER') {
          return {
            label: d.label,
            time: formatHhMm(entry.timeSec),
            distance: null,
          };
        }

        return {
          label: d.label,
          time: formatHhMm(entry.timeSec),
          distance: `${formatKm(entry.distanceMeters)} km`,
        };
      })
      .filter(Boolean) as Array<{ label: string; time: string; distance: string | null }>
  );

  return (
    <div
      data-athlete-week-summary-column="v1"
      className={cn('flex flex-col min-w-0 rounded bg-[var(--bg-structure)] overflow-hidden border border-[var(--border-subtle)]')}
    >
      <div className={headerClassName}>
        <div className="text-xs font-semibold text-[var(--text)]">Week total</div>
        <div className="mt-0.5 text-[11px] text-[var(--muted)] truncate">{formatWeekOfLabel(weekStartKey, athleteTimezone)}</div>
      </div>

      <div className={bodyClassName}>
        <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2.5">
          <div className="space-y-1 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted)]">Workouts completed</span>
              <span className="tabular-nums text-[var(--text)]">{summary.completedCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted)]">Workouts skipped</span>
              <span className="tabular-nums text-[var(--text)]">{summary.skippedCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted)]">Total time</span>
              <span className="tabular-nums text-[var(--text)]">{formatHhMm(summary.totalTimeSec)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted)]">Total distance</span>
              <span className="tabular-nums text-[var(--text)]">{formatKm(summary.totalDistanceMeters)} km</span>
            </div>
          </div>

          {disciplineRows.length ? <div className="my-2 h-px bg-[var(--border-subtle)]" /> : null}

          {disciplineRows.length ? (
            <div className="space-y-1 text-[11px]">
              {disciplineRows.map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-3">
                  <span className="text-[var(--muted)]">{row.label}</span>
                  <span className="tabular-nums text-[var(--text)] whitespace-nowrap">
                    {row.time}
                    {row.distance ? ` | ${row.distance}` : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

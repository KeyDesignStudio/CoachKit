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

type AthleteMonthWeekSummaryCellProps = {
  weekStartKey: string;
  athleteTimezone: string;
  items: CalendarItemForWeeklySummary[];
};

export function AthleteMonthWeekSummaryCell({ weekStartKey, athleteTimezone, items }: AthleteMonthWeekSummaryCellProps) {
  const summary = useMemo(() => getWeeklyAchievedSummary(items, athleteTimezone), [items, athleteTimezone]);

  const disciplineRows = (
    [
      { key: 'RUN' as const, label: 'RUN' },
      { key: 'BIKE' as const, label: 'BIKE' },
      { key: 'SWIM' as const, label: 'SWIM' },
      { key: 'OTHER' as const, label: 'OTHER' },
    ]
      .map((d) => {
        const entry = summary.perDiscipline[d.key];
        const hasAny = entry.completedCount + entry.skippedCount > 0;
        if (!hasAny) return null;

        if (d.key === 'SWIM') {
          return {
            label: d.label,
            time: formatHhMm(entry.timeSec),
            distance: entry.hasDistance ? `${formatSwimMeters(entry.distanceMeters)} m` : entry.timeSec > 0 ? '—' : null,
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
          distance: entry.hasDistance ? `${formatKm(entry.distanceMeters)} km` : entry.timeSec > 0 ? '—' : null,
        };
      })
      .filter(Boolean) as Array<{ label: string; time: string; distance: string | null }>
  ).slice(0, 4);

  return (
    <div
      data-athlete-month-week-summary-cell="v1"
      className={cn(
        'flex flex-col gap-1.5 md:gap-2 min-h-[76px] md:min-h-[120px] text-left',
        'p-2 md:p-2.5',
        'rounded bg-[var(--bg-card)] border border-[var(--border-subtle)]'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-[var(--text)]">Week</div>
          <div className="mt-0.5 text-[10px] text-[var(--muted)] truncate hidden md:block">
            {formatWeekOfLabel(weekStartKey, athleteTimezone)}
          </div>
        </div>
      </div>

      {/* Mobile: keep it ultra-compact */}
      <div className="md:hidden flex flex-col gap-0.5 text-[9px] text-[var(--muted)]">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate">Done</span>
          <span className="tabular-nums text-[var(--text)]">{summary.completedCount}</span>
        </div>
        <div className="flex items-center justify-between gap-1">
          <span className="truncate">Time</span>
          <span className="tabular-nums text-[var(--text)]">{formatHhMm(summary.totalTimeSec)}</span>
        </div>
      </div>

      {/* Desktop: show totals + discipline breakdown */}
      <div className="hidden md:block">
        <div className="space-y-1 text-[10px]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[var(--muted)]">Done / skipped</span>
            <span className="tabular-nums text-[var(--text)]">
              {summary.completedCount} / {summary.skippedCount}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[var(--muted)]">Time</span>
            <span className="tabular-nums text-[var(--text)]">{formatHhMm(summary.totalTimeSec)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[var(--muted)]">Distance</span>
            <span className="tabular-nums text-[var(--text)]">{formatKm(summary.totalDistanceMeters)} km</span>
          </div>
        </div>

        {disciplineRows.length ? <div className="my-2 h-px bg-[var(--border-subtle)]" /> : null}

        {disciplineRows.length ? (
          <div className="space-y-1 text-[10px]">
            {disciplineRows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-2">
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
  );
}

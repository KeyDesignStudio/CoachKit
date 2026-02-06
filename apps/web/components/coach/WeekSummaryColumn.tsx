import { formatKmCompact, formatKcal, formatMinutesCompact } from '@/lib/calendar/discipline-summary';
import { getRangeCompletionSummary } from '@/lib/calendar/completion';
import { addDaysToDayKey } from '@/lib/day-key';
import { cn } from '@/lib/cn';
import type { CalendarItem } from '@/components/coach/types';

type Props = {
  items: CalendarItem[];
  selectedAthleteIds: Set<string>;
  weekStartKey: string;
  athleteTimezone: string;
  className?: string;
  style?: React.CSSProperties;
};

export function WeekSummaryColumn({
  items,
  selectedAthleteIds,
  weekStartKey,
  athleteTimezone,
  className,
  style,
}: Props) {
  const toDayKey = addDaysToDayKey(weekStartKey, 6);
  const summary = getRangeCompletionSummary({
    items,
    timeZone: athleteTimezone,
    fromDayKey: weekStartKey,
    toDayKey,
    filter: (item) => selectedAthleteIds.has(item.athleteId ?? ''),
  });
  const top = summary.byDiscipline.filter((d) => d.durationMinutes > 0 || d.distanceKm > 0).slice(0, 6);

  return (
    <div 
       className={cn("hidden md:flex flex-col min-w-0 rounded bg-emerald-600/25 overflow-hidden border border-white/40", className)}
       style={style}
    >
      <div className="px-3 py-1.5">
        <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Summary</p>
        <p className="text-sm font-medium truncate">Selected athletes</p>
      </div>
      <div className="flex flex-col gap-3 p-3">
        <div className="rounded p-2">
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Athletes</div>
          <div className="text-sm font-semibold text-[var(--text)]">{selectedAthleteIds.size}</div>
        </div>

        <div className="rounded p-2">
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Workouts</div>
          <div className="text-sm font-semibold text-[var(--text)]">
            {summary.workoutCount}
          </div>
        </div>

        <>
          <div className="rounded p-2">
            <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Totals</div>
            <div className="mt-1 text-sm font-semibold text-[var(--text)] tabular-nums">
              {formatMinutesCompact(summary.totals.durationMinutes)} · {formatKmCompact(summary.totals.distanceKm)}
            </div>
            <div className="text-xs text-[var(--muted)] tabular-nums">Calories: {formatKcal(summary.totals.caloriesKcal)}</div>
          </div>

          <div className="rounded p-2">
            <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">By discipline</div>
            {top.length === 0 ? (
              <div className="mt-1 text-xs text-[var(--muted)]">No time/distance yet</div>
            ) : (
              <div className="mt-1 space-y-1">
                {top.map((row) => (
                  <div key={row.discipline} className="flex items-baseline justify-between gap-2">
                    <div className="text-xs font-medium text-[var(--text)] truncate">{row.discipline}</div>
                    <div className="text-xs text-[var(--muted)] tabular-nums whitespace-nowrap">
                      {formatMinutesCompact(row.durationMinutes)} · {formatKmCompact(row.distanceKm)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      </div>
    </div>
  );
}

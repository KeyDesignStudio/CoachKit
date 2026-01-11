import { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type AthleteWeekDayColumnProps = {
  dayName: string;
  formattedDate: string;
  isToday?: boolean;
  isEmpty: boolean;
  onHeaderClick?: () => void;
  onEmptyClick?: () => void;
  children: ReactNode;
};

export function AthleteWeekDayColumn({
  dayName,
  formattedDate,
  isToday = false,
  isEmpty,
  onHeaderClick,
  onEmptyClick,
  children,
}: AthleteWeekDayColumnProps) {
  return (
    <div
      data-athlete-week-day-card="v2"
      className={cn(
        'flex flex-col min-w-0 rounded-2xl bg-[var(--bg-structure)] overflow-hidden',
        isToday ? 'border-2 border-[var(--today-border)]' : 'border border-[var(--border-subtle)]'
      )}
    >
      {onHeaderClick ? (
        <button
          type="button"
          onClick={onHeaderClick}
          className="flex w-full items-center justify-between bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] px-3 py-2 rounded-t-2xl text-left"
        >
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{dayName}</p>
            <p className="text-sm font-medium truncate">{formattedDate}</p>
          </div>
          {isToday ? (
            <span className="bg-blue-500/10 text-blue-700 text-[10px] px-2 py-0.5 rounded-full">Today</span>
          ) : null}
        </button>
      ) : (
        <div className="flex items-center justify-between bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] px-3 py-2 rounded-t-2xl">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{dayName}</p>
            <p className="text-sm font-medium truncate">{formattedDate}</p>
          </div>
          {isToday ? (
            <span className="bg-blue-500/10 text-blue-700 text-[10px] px-2 py-0.5 rounded-full">Today</span>
          ) : null}
        </div>
      )}

      <div className="flex flex-col gap-2 p-2">
        {children}
        {isEmpty ? (
          onEmptyClick ? (
            <button
              type="button"
              onClick={onEmptyClick}
              className="w-full text-xs text-[var(--muted)] text-center py-2"
            >
              No workouts
            </button>
          ) : (
            <p className="text-xs text-[var(--muted)] text-center py-2">No workouts</p>
          )
        ) : null}
      </div>
    </div>
  );
}

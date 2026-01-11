import { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type AthleteWeekDayColumnProps = {
  dayName: string;
  formattedDate: string;
  isToday?: boolean;
  isEmpty: boolean;
  children: ReactNode;
};

export function AthleteWeekDayColumn({
  dayName,
  formattedDate,
  isToday = false,
  isEmpty,
  children,
}: AthleteWeekDayColumnProps) {
  return (
    <div
      data-athlete-week-day-card="v2"
      className={cn(
        'flex flex-col min-w-0 rounded-2xl border border-white/20 bg-white/15 backdrop-blur-3xl',
        isToday ? 'ring-2 ring-blue-500/40 ring-inset' : ''
      )}
    >
      <div className="flex items-center justify-between bg-white/25 border-b border-white/20 px-3 py-2 rounded-t-2xl">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{dayName}</p>
          <p className="text-sm font-medium truncate">{formattedDate}</p>
        </div>
        {isToday ? (
          <span className="bg-blue-500/10 text-blue-700 text-[10px] px-2 py-0.5 rounded-full">Today</span>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 p-2">
        {children}
        {isEmpty ? <p className="text-xs text-[var(--muted)] text-center py-2">No workouts</p> : null}
      </div>
    </div>
  );
}

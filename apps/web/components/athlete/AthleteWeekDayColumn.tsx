import { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type AthleteWeekDayColumnProps = {
  dayName: string;
  formattedDate: string;
  isToday?: boolean;
  isEmpty: boolean;
  onHeaderClick?: () => void;
  onEmptyClick?: () => void;
  onBodyClick?: () => void;
  density?: 'default' | 'compact';
  children: ReactNode;
};

export function AthleteWeekDayColumn({
  dayName,
  formattedDate,
  isToday = false,
  isEmpty,
  onHeaderClick,
  onEmptyClick,
  onBodyClick,
  density = 'default',
  children,
}: AthleteWeekDayColumnProps) {
  const headerClassName =
    density === 'compact'
      ? 'bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] px-3 py-1.5'
      : 'bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] px-3 py-2';

  const bodyClassName = cn(
    density === 'compact' ? 'flex flex-col gap-1.5 p-1.5' : 'flex flex-col gap-2 p-2',
    onBodyClick ? 'cursor-pointer transition-colors hover:bg-[var(--bg-surface)]' : ''
  );

  return (
    <div
      data-athlete-week-day-card="v2"
      className={cn(
        'flex flex-col min-w-0 rounded bg-[var(--bg-structure)] overflow-hidden',
        isToday ? 'border-2 border-[var(--today-border)]' : 'border border-[var(--border-subtle)]'
      )}
    >
      {onHeaderClick ? (
        <button
          type="button"
          onClick={onHeaderClick}
          className={cn('flex w-full items-center justify-between text-left', headerClassName)}
        >
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{dayName}</p>
            <p className="text-sm font-medium truncate">{formattedDate}</p>
          </div>
          {isToday ? (
            <span className="bg-blue-500/10 text-blue-700 text-[10px] px-2 py-0.5 rounded border border-[var(--today-border)]">Today</span>
          ) : null}
        </button>
      ) : (
        <div className={cn('flex items-center justify-between', headerClassName)}>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{dayName}</p>
            <p className="text-sm font-medium truncate">{formattedDate}</p>
          </div>
          {isToday ? (
            <span className="bg-blue-500/10 text-blue-700 text-[10px] px-2 py-0.5 rounded border border-[var(--today-border)]">Today</span>
          ) : null}
        </div>
      )}

      <div
        className={bodyClassName}
        onClick={onBodyClick}
        role={onBodyClick ? 'button' : undefined}
        tabIndex={onBodyClick ? 0 : undefined}
        onKeyDown={
          onBodyClick
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onBodyClick();
                }
              }
            : undefined
        }
      >
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

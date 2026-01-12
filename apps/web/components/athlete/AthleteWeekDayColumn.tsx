import { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/Icon';

type AthleteWeekDayColumnProps = {
  dayName: string;
  formattedDate: string;
  isToday?: boolean;
  isEmpty: boolean;
  onHeaderClick?: () => void;
  onEmptyClick?: () => void;
  onAddClick?: () => void;
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
  onAddClick,
  density = 'default',
  children,
}: AthleteWeekDayColumnProps) {
  const headerClassName =
    density === 'compact'
      ? 'bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] px-3 py-1.5'
      : 'bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] px-3 py-2';

  const bodyClassName = cn(density === 'compact' ? 'flex flex-col gap-1.5 p-1.5' : 'flex flex-col gap-2 p-2');

  const addButton = onAddClick ? (
    <button
      type="button"
      onClick={onAddClick}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-full',
        'text-[var(--muted)] hover:text-[var(--primary)]',
        'hover:bg-[var(--bg-structure)]',
        'transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]'
      )}
      aria-label="Add session"
      title="Add session"
    >
      <Icon name="add" size="sm" className="text-[16px]" aria-hidden />
    </button>
  ) : null;

  return (
    <div
      data-athlete-week-day-card="v2"
      className={cn(
        'flex flex-col min-w-0 rounded bg-[var(--bg-structure)] overflow-hidden',
        isToday ? 'border-2 border-[var(--today-border)]' : 'border border-[var(--border-subtle)]'
      )}
    >
      <div className={cn('flex items-center justify-between gap-2', headerClassName)}>
        {onHeaderClick ? (
          <button type="button" onClick={onHeaderClick} className="min-w-0 text-left">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{dayName}</p>
            <p className="text-sm font-medium truncate">{formattedDate}</p>
          </button>
        ) : (
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{dayName}</p>
            <p className="text-sm font-medium truncate">{formattedDate}</p>
          </div>
        )}

        <div className="flex items-center gap-2 flex-shrink-0">
          {isToday ? (
            <span className="bg-blue-500/10 text-blue-700 text-[10px] px-2 py-0.5 rounded border border-[var(--today-border)]">Today</span>
          ) : null}
          {addButton}
        </div>
      </div>

      <div className={bodyClassName}>
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

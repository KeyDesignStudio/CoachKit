import { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type MonthGridProps = {
  children: ReactNode;
  columns?: 7 | 8;
  extraHeaderLabel?: string;
};

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MonthGrid({ children, columns = 7, extraHeaderLabel = 'Summary' }: MonthGridProps) {
  return (
    <>
      {/* Day headers */}
      <div
        className={cn(
          'grid border-b border-[var(--border-subtle)] bg-[var(--bg-structure)]',
          columns === 8 ? 'grid-cols-8' : 'grid-cols-7'
        )}
      >
        {DAY_NAMES.map((day) => (
          <div
            key={day}
            className="border-r border-[var(--border-subtle)] px-2 py-1.5 md:px-3 md:py-2 text-center text-[11px] md:text-xs font-normal uppercase tracking-wider text-[var(--muted)] last:border-r-0"
          >
            {day}
          </div>
        ))}

        {columns === 8 ? (
          <div className="px-2 py-1.5 md:px-3 md:py-2 text-center text-[11px] md:text-xs font-normal uppercase tracking-wider text-[var(--muted)]">
            {extraHeaderLabel}
          </div>
        ) : null}
      </div>

      {/* Day cells */}
      <div className={cn('grid gap-px bg-[var(--bg-structure)]', columns === 8 ? 'grid-cols-8' : 'grid-cols-7')}>
        {children}
      </div>
    </>
  );
}

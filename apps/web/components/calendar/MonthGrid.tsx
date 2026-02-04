import { ReactNode } from 'react';

type MonthGridProps = {
  children: ReactNode;
  includeSummaryColumn?: boolean;
};

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MonthGrid({ children, includeSummaryColumn = false }: MonthGridProps) {
  return (
    <>
      {/* Day headers */}
      <div
        className={`grid ${includeSummaryColumn ? 'grid-cols-7 md:grid-cols-8' : 'grid-cols-7'} border-b border-[var(--border-subtle)] bg-[var(--bg-structure)]`}
      >
        {DAY_NAMES.map((day) => (
          <div
            key={day}
            className="border-r border-[var(--border-subtle)] px-2 py-1.5 md:px-3 md:py-2 text-center text-[11px] md:text-xs font-normal uppercase tracking-wider text-[var(--muted)] last:border-r-0"
          >
            {day}
          </div>
        ))}

        {includeSummaryColumn ? (
          <div className="hidden md:block px-2 py-1.5 md:px-3 md:py-2 text-center text-[11px] md:text-xs font-normal uppercase tracking-wider text-[var(--muted)]">
            Summary
          </div>
        ) : null}
      </div>

      {/* Day cells */}
      <div
        data-testid="calendar-month-grid"
        className={`grid ${includeSummaryColumn ? 'grid-cols-7 md:grid-cols-8' : 'grid-cols-7'} gap-px bg-[var(--bg-structure)]`}
      >
        {children}
      </div>
    </>
  );
}

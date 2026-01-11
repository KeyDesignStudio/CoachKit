import { ReactNode } from 'react';

type MonthGridProps = {
  children: ReactNode;
};

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MonthGrid({ children }: MonthGridProps) {
  return (
    <>
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-[var(--border-subtle)] bg-[var(--bg-structure)]">
        {DAY_NAMES.map((day) => (
          <div
            key={day}
            className="border-r border-[var(--border-subtle)] px-3 py-2 text-center text-xs font-normal uppercase tracking-wider text-[var(--muted)] last:border-r-0"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-px bg-[var(--bg-structure)]">{children}</div>
    </>
  );
}

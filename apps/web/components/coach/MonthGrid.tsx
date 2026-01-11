import { ReactNode } from 'react';

type MonthGridProps = {
  children: ReactNode;
};

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MonthGrid({ children }: MonthGridProps) {
  return (
    <div className="overflow-hidden rounded-3xl border border-white/20 bg-white/40 backdrop-blur-3xl shadow-inner">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-white/20 bg-white/60">
        {DAY_NAMES.map((day) => (
          <div
            key={day}
            className="border-r border-white/20 px-3 py-2 text-center text-xs font-normal uppercase tracking-wider text-[var(--muted)] last:border-r-0"
          >
            {day}
          </div>
        ))}
      </div>
      
      {/* Day cells */}
      <div className="grid grid-cols-7">
        {children}
      </div>
    </div>
  );
}

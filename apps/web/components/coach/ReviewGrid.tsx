'use client';

import { ReactNode } from 'react';

import { formatDisplay } from '@/lib/client-date';
import { cn } from '@/lib/cn';

type ReviewGridProps = {
  children: ReactNode;
  weekDays: string[];
  todayIndex?: number;
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getFormattedHeaderDate(dateKey: string): string {
  const formatted = formatDisplay(dateKey);
  return formatted.split(',')[1]?.trim() || formatted;
}

const todayTintClass =
  'relative before:absolute before:inset-0 before:bg-blue-500/5 before:pointer-events-none';

export function ReviewGrid({ children, weekDays, todayIndex = -1 }: ReviewGridProps) {
  return (
    <div className="max-w-full overflow-x-auto">
      <div
        className={cn(
          'grid min-w-0 gap-px rounded border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-px',
          '[--review-grid-cols:160px_repeat(7,minmax(0,1fr))]',
          'sm:[--review-grid-cols:200px_repeat(7,minmax(0,1fr))]',
          'lg:[--review-grid-cols:240px_repeat(7,minmax(0,1fr))]'
        )}
        style={{
          gridTemplateColumns: 'var(--review-grid-cols)',
        }}
      >
        {/* Header row */}
        <div className="min-w-0 flex items-center bg-[var(--bg-surface)] px-4 py-3">
          <span className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Athlete</span>
        </div>

        {DAYS.map((dayName, index) => {
          const dateKey = weekDays[index];
          const isToday = index === todayIndex;

          return (
            <div
              key={dayName}
              className={cn(
                'min-w-0 overflow-hidden bg-[var(--bg-surface)] px-3 py-2',
                isToday ? todayTintClass : ''
              )}
            >
              <div className="relative z-10 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{dayName}</p>
                  <p className="text-sm font-medium truncate">{getFormattedHeaderDate(dateKey)}</p>
                </div>
                {isToday ? (
                  <span className="bg-blue-500/10 text-blue-700 text-[10px] px-2 py-0.5 rounded border border-[var(--today-border)]">
                    Today
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}

        {children}
      </div>
    </div>
  );
}

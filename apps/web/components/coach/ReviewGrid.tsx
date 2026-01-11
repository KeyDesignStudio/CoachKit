'use client';

import { ReactNode } from 'react';

type ReviewGridProps = {
  children: ReactNode;
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function ReviewGrid({ children }: ReviewGridProps) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[800px]">
        {/* Header row */}
        <div className="grid grid-cols-[200px_repeat(7,1fr)] gap-px rounded-t-3xl border border-[var(--border-subtle)] bg-[var(--bg-structure)]">
          <div className="flex items-center bg-[var(--bg-surface)] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Athlete
          </div>
          {DAYS.map((day) => (
            <div
              key={day}
              className="flex items-center justify-center bg-[var(--bg-surface)] px-2 py-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]"
            >
              {day}
            </div>
          ))}
        </div>
        {/* Body */}
        <div className="rounded-b-3xl border border-t-0 border-[var(--border-subtle)] bg-[var(--bg-structure)]">
          {children}
        </div>
      </div>
    </div>
  );
}

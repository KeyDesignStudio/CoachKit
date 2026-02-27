'use client';

import { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type AthleteRowProps = {
  athleteName: string;
  children: ReactNode[];
  todayIndex?: number;
};

const todayTintClass =
  'relative before:absolute before:inset-0 before:bg-blue-500/5 before:pointer-events-none';

export function AthleteRow({ athleteName, children, todayIndex = -1 }: AthleteRowProps) {
  return (
    <div className="contents">
      <div className="min-w-0 flex items-center bg-[var(--bg-card)] px-4 py-3">
        <span className="md:truncate text-sm font-medium text-[var(--text)]">{athleteName}</span>
      </div>
      {children.map((child, index) => {
        const isToday = index === todayIndex;
        return (
          <div
            key={index}
            className={cn(
              'min-w-0 overflow-hidden min-h-[72px] bg-[var(--bg-card)] p-1.5',
              isToday ? todayTintClass : ''
            )}
          >
            <div className="relative z-10 min-w-0">{child}</div>
          </div>
        );
      })}
    </div>
  );
}

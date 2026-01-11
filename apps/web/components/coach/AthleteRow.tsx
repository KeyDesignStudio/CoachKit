'use client';

import { ReactNode } from 'react';

type AthleteRowProps = {
  athleteName: string;
  children: ReactNode[];
};

export function AthleteRow({ athleteName, children }: AthleteRowProps) {
  return (
    <div className="grid grid-cols-[200px_repeat(7,1fr)] gap-px border-t border-[var(--border-subtle)]">
      <div className="flex items-center bg-[var(--bg-card)] px-4 py-3 text-sm font-medium text-[var(--text)]">
        {athleteName}
      </div>
      {children.map((child, index) => (
        <div key={index} className="min-h-[80px] bg-[var(--bg-card)] p-2">
          {child}
        </div>
      ))}
    </div>
  );
}

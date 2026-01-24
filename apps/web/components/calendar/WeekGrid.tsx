import { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type WeekGridProps = {
  children: ReactNode;
  columns?: 7 | 8;
};

export function WeekGrid({ children, columns = 7 }: WeekGridProps) {
  return (
    <>
      {/* Mobile: Vertical day list */}
      <div className="flex flex-col gap-3 md:hidden">{children}</div>

      {/* Desktop: 7-column grid */}
      <div className={cn('hidden md:grid gap-3', columns === 8 ? 'md:grid-cols-8' : 'md:grid-cols-7')}>{children}</div>
    </>
  );
}

import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

type CalendarShellVariant = 'week' | 'month';

type CalendarShellProps = HTMLAttributes<HTMLDivElement> & {
  variant: CalendarShellVariant;
  children: ReactNode;
  structureClassName?: string;
};

export function CalendarShell({ variant, children, className, structureClassName, ...props }: CalendarShellProps) {
  const structureClasses =
    variant === 'week'
      ? 'rounded-2xl bg-[var(--bg-structure)] p-3'
      : 'overflow-hidden rounded-2xl bg-[var(--bg-structure)] p-px';

  return (
    <div
      {...props}
      data-cal-shell="true"
      className={cn('rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3', className)}
    >
      <div className={cn(structureClasses, structureClassName)}>{children}</div>
    </div>
  );
}

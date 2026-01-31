import { forwardRef, SelectHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';
import { tokens } from './tokens';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, children, ...props }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          'w-full appearance-none bg-[var(--bg-card)] px-4 py-2 pr-10',
          tokens.typography.body,
          tokens.borders.input,
          tokens.radius.input,
          className
        )}
        {...props}
      >
        {children}
      </select>
      <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-[var(--muted)]" aria-hidden="true">
        ⌄
      </span>
    </div>
  );
});

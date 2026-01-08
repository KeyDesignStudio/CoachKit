import { forwardRef, SelectHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, children, ...props }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          'w-full appearance-none rounded-2xl border border-white/30 bg-white/70 px-4 py-2 pr-10 text-sm text-[var(--text)] shadow-inner shadow-white/10 backdrop-blur-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
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

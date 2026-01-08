import { forwardRef, InputHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-2xl border border-white/30 bg-white/70 px-4 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)] shadow-inner shadow-white/10 backdrop-blur-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
});

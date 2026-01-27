import { forwardRef, InputHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';
import { tokens } from './tokens';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'w-full bg-[var(--bg-card)] px-4 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:opacity-50',
        tokens.borders.input,
        tokens.radius.input,
        className
      )}
      {...props}
    />
  );
});

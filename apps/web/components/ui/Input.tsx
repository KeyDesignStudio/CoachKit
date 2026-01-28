import { forwardRef, InputHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';
import { tokens } from './tokens';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'w-full bg-[var(--bg-card)] px-4 py-2 placeholder:text-[var(--muted)]',
        tokens.typography.body,
        tokens.borders.input,
        tokens.radius.input,
        tokens.transition.default,
        tokens.opacity.disabled,
        className
      )}
      {...props}
    />
  );
});

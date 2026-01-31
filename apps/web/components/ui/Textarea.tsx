import { forwardRef, TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';
import { tokens } from './tokens';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, rows = 4, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        'w-full bg-[var(--bg-card)] px-4 py-3 placeholder:text-[var(--muted)]',
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

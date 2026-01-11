import { forwardRef, TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, rows = 4, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        'w-full rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text)] placeholder:text-[var(--muted)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
});

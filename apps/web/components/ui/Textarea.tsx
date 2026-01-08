import { forwardRef, TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, rows = 4, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        'w-full rounded-3xl border border-white/30 bg-white/70 px-4 py-3 text-sm text-[var(--text)] placeholder:text-[var(--muted)] shadow-inner shadow-white/10 backdrop-blur-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
});

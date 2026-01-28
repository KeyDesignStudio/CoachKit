import { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';
import { tokens } from './tokens';

export type BadgeProps = HTMLAttributes<HTMLSpanElement>;

export function Badge({ className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 border border-white/30 bg-white/50 px-3 py-1 font-medium uppercase tracking-wide text-[var(--text)]/70',
        tokens.radius.pill,
        tokens.typography.meta, // text-xs, muted-ish
        className
      )}
      {...props}
    />
  );
}

import { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export type BlockTitleProps = HTMLAttributes<HTMLHeadingElement>;

const PILL_LABEL_CLASS =
  'inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/50 px-3 py-1 text-xs font-medium uppercase tracking-wide text-[var(--text)]/70';

export function BlockTitle({ className, ...props }: BlockTitleProps) {
  return <h2 className={cn(PILL_LABEL_CLASS, className)} {...props} />;
}

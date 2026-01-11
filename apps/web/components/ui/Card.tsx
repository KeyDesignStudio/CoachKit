import { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

type CardVariant = 'default' | 'soft';

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
};

const variantClasses: Record<CardVariant, string> = {
  default: 'rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]',
  soft: 'rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-structure)]',
};

export function Card({ className, variant = 'default', ...props }: CardProps) {
  return <div className={cn('p-6', variantClasses[variant], className)} {...props} />;
}

import { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

type CardVariant = 'default' | 'soft';

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
};

const variantClasses: Record<CardVariant, string> = {
  default: 'glass',
  soft: 'glass-soft',
};

export function Card({ className, variant = 'default', ...props }: CardProps) {
  return <div className={cn('p-6', variantClasses[variant], className)} {...props} />;
}

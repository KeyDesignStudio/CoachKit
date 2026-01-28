import { HTMLAttributes } from 'react';

// DEPRECATED: Use <Block> instead for consistent Layout containers with optional titles.
// This primitive is kept for backward compatibility but should not be used in new code.

import { cn } from '@/lib/cn';
import { tokens } from './tokens';

type CardVariant = 'default' | 'soft';

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
};

const variantClasses: Record<CardVariant, string> = {
  default: cn(tokens.borders.default, 'bg-[var(--bg-card)]'),
  soft: cn(tokens.borders.default, 'bg-[var(--bg-structure)]'),
};

export function Card({ className, variant = 'default', ...props }: CardProps) {
  return <div className={cn(tokens.radius.card, tokens.spacing.blockPadding, variantClasses[variant], className)} {...props} />;
}

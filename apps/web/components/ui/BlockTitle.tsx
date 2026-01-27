import { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { tokens } from './tokens';

export type BlockTitleProps = HTMLAttributes<HTMLHeadingElement>;

export function BlockTitle({ className, ...props }: BlockTitleProps) {
  return <h2 className={cn('blocktitle', tokens.typography.blockTitle, className)} {...props} />;
}

import { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export type BlockTitleProps = HTMLAttributes<HTMLHeadingElement>;

export function BlockTitle({ className, ...props }: BlockTitleProps) {
  return <h2 className={cn('blocktitle', className)} {...props} />;
}

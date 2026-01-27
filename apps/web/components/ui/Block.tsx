import React from 'react';
import { cn } from '@/lib/cn';
import { tokens } from './tokens';
import { BlockTitle } from './BlockTitle';
import { Button } from './Button';

type BlockProps = React.HTMLAttributes<HTMLDivElement> & {
  title?: string;
  rightAction?: React.ReactNode;
  padding?: boolean;
};

export function Block({ title, rightAction, children, className, padding = true, ...props }: BlockProps) {
  return (
    <div
      className={cn(
        'bg-[var(--bg-card)]',
        tokens.borders.default,
        tokens.radius.card,
        'overflow-hidden',
        className
      )}
      {...props}
    >
      {(title || rightAction) && (
        <div className={cn('flex items-center justify-between', tokens.spacing.blockPaddingX, 'py-3 border-b border-[var(--border-subtle)]')}>
          {title && <BlockTitle>{title}</BlockTitle>}
          {rightAction && <div className="ml-4">{rightAction}</div>}
        </div>
      )}
      <div className={cn(padding && tokens.spacing.blockPaddingX, padding && tokens.spacing.blockPaddingY)}>
        {children}
      </div>
    </div>
  );
}

import React from 'react';
import { cn } from '@/lib/cn';
import { tokens } from './tokens';
import { BlockTitle } from './BlockTitle';
import { Button } from './Button';

type BlockProps = React.HTMLAttributes<HTMLDivElement> & {
  title?: string;
  rightAction?: React.ReactNode;
  padding?: boolean;
  showHeaderDivider?: boolean;
};

export function Block({ title, rightAction, children, className, padding = true, showHeaderDivider = true, ...props }: BlockProps) {
  return (
    <div
      className={cn(
        'min-w-0 max-w-full',
        'bg-[var(--bg-card)]',
        tokens.borders.default,
        tokens.radius.card,
        'overflow-hidden',
        className
      )}
      {...props}
    >
      {(title || rightAction) && (
        <div
          className={cn(
            'flex min-w-0 items-center justify-between',
            tokens.spacing.blockPaddingX,
            'py-3',
            showHeaderDivider && 'border-b border-[var(--border-subtle)]'
          )}
        >
          {title && (
            <div className="min-w-0">
              <BlockTitle>{title}</BlockTitle>
            </div>
          )}
          {rightAction && <div className="ml-4 shrink-0">{rightAction}</div>}
        </div>
      )}
      <div className={cn(padding && tokens.spacing.blockPaddingX, padding && tokens.spacing.blockPaddingY)}>
        {children}
      </div>
    </div>
  );
}

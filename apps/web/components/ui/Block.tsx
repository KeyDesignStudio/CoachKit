import React from 'react';
import { cn } from '@/lib/cn';
import { tokens } from './tokens';
import { BlockTitle } from './BlockTitle';
import { Icon } from './Icon';
import { getBlockIconForTitle } from './blockIconMap';

type BlockProps = React.HTMLAttributes<HTMLDivElement> & {
  title?: string;
  rightAction?: React.ReactNode;
  padding?: boolean;
  showHeaderDivider?: boolean;
};

export function Block({ title, rightAction, children, className, padding = true, showHeaderDivider = false, ...props }: BlockProps) {
  const titleIcon = getBlockIconForTitle(title);
  void showHeaderDivider;

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
            'py-3'
          )}
        >
          {title && (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {titleIcon ? <Icon name={titleIcon} size="sm" className="text-[var(--muted)]" aria-hidden /> : null}
                <BlockTitle>{title}</BlockTitle>
              </div>
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

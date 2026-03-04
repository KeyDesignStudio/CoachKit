import { cn } from '@/lib/cn';
import { getTrendDirection, type TrendDirection } from '@/lib/trend-delta';

export function trendArrow(direction: TrendDirection): string {
  if (direction === 'up') return '▲';
  if (direction === 'down') return '▼';
  return '•';
}

export function trendClass(direction: TrendDirection): string {
  if (direction === 'up') return 'text-emerald-600';
  if (direction === 'down') return 'text-rose-600';
  return 'text-[var(--muted)]';
}

function formatPercentValue(value: number): string {
  const abs = Math.abs(value);
  const withDecimals = abs < 10 ? abs.toFixed(1) : Math.round(abs).toString();
  return `${withDecimals}%`;
}

export function TrendDelta({
  delta,
  className,
  emptyLabel = 'No prior baseline',
}: {
  delta: number | null | undefined;
  className?: string;
  emptyLabel?: string;
}) {
  if (delta == null || !Number.isFinite(delta)) {
    return <span className={cn('text-xs text-[var(--muted)]', className)}>{emptyLabel}</span>;
  }

  const direction = getTrendDirection(delta);
  return (
    <span className={cn('text-xs', trendClass(direction), className)}>
      {trendArrow(direction)} {formatPercentValue(delta)}
    </span>
  );
}


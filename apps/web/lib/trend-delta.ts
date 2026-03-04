export type TrendDirection = 'up' | 'down' | 'none' | 'flat';

export function computePercentDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

export function getTrendDirection(delta: number | null | undefined): TrendDirection {
  if (delta == null || !Number.isFinite(delta) || delta === 0) return 'none';
  return delta > 0 ? 'up' : 'down';
}

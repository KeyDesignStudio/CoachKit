import type { IconName } from '@/components/ui/iconRegistry';
import { isPastEndOfLocalDay } from '@/lib/timezones';

type Params = {
  status: string;
  date: string;
  timeZone: string;
  now?: Date;
};

function getItemDateKey(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value.includes('T')) return value.split('T')[0];
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return value;
}

export function getSessionStatusIndicator({ status, date, timeZone, now }: Params): {
  iconName: IconName;
  ariaLabel: string;
  colorClass: string;
} {
  const effectiveNow = now ?? new Date();
  const itemDayKey = getItemDateKey(date);
  const dayEnded = isPastEndOfLocalDay(itemDayKey, timeZone, effectiveNow);

  if (status === 'COMPLETED_SYNCED_DRAFT') {
    return { iconName: 'needsReview', ariaLabel: 'Draft completion (pending confirmation)', colorClass: 'text-amber-600' };
  }

  if (status === 'COMPLETED_SYNCED' || status === 'COMPLETED_MANUAL') {
    return { iconName: 'completed', ariaLabel: 'Completed', colorClass: 'text-emerald-600' };
  }

  if (status === 'SKIPPED') {
    return { iconName: 'skipped', ariaLabel: 'Skipped', colorClass: 'text-[var(--muted)]' };
  }

  if (status === 'PLANNED' && dayEnded) {
    return { iconName: 'missed', ariaLabel: 'Missed workout', colorClass: 'text-amber-700/70' };
  }

  return { iconName: 'planned', ariaLabel: 'Planned', colorClass: 'text-[var(--muted)]' };
}

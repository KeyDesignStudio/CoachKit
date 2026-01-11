import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/iconRegistry';
import { cn } from '@/lib/cn';

export type AthleteWeekSessionRowItem = {
  id: string;
  date: string;
  plannedStartTimeLocal: string | null;
  displayTimeLocal?: string | null;
  discipline: string;
  status: string;
  title: string;
  notes?: string | null;
  latestCompletedActivity?: {
    painFlag?: boolean;
  } | null;
};

type AthleteWeekSessionRowProps = {
  item: AthleteWeekSessionRowItem;
  onClick: () => void;
  now?: Date;
};

function parseDateOnlyLocal(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map((part) => Number(part));
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

function isDayEndedLocal(date: Date, now: Date): boolean {
  const dayEnd = new Date(date);
  dayEnd.setHours(0, 0, 0, 0);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return now.getTime() >= dayEnd.getTime();
}

function getDisciplineLabel(discipline: string): string {
  const d = (discipline || 'OTHER').toUpperCase();
  if (d === 'RUN' || d === 'BIKE' || d === 'SWIM' || d === 'REST') return d;
  if (d === 'BRICK') return 'BRICK';
  if (d === 'STRENGTH') return 'STR';
  return d.slice(0, 5);
}

function getAccountabilityStatusIcon(item: AthleteWeekSessionRowItem, now: Date): { name: IconName | null; className: string; title: string | null } {
  const sessionDate = parseDateOnlyLocal(item.date);
  const ended = isDayEndedLocal(sessionDate, now);

  if (item.discipline === 'REST') return { name: null, className: '', title: null };

  if (item.status === 'COMPLETED_SYNCED_DRAFT') {
    return { name: 'needsReview', className: 'text-amber-600', title: null };
  }

  if (item.status === 'COMPLETED_SYNCED' || item.status === 'COMPLETED_MANUAL') {
    return { name: 'completed', className: 'text-emerald-600', title: null };
  }

  if (item.status === 'SKIPPED') {
    return { name: 'skipped', className: 'text-[var(--muted)]', title: null };
  }

  if ((item.status === 'PLANNED' || item.status === 'MODIFIED') && ended) {
    return {
      name: 'missed',
      className: 'text-amber-700/70',
      title: 'Missed session – this workout was planned but not completed',
    };
  }

  return { name: null, className: '', title: null };
}

export function AthleteWeekSessionRow({ item, onClick, now }: AthleteWeekSessionRowProps) {
  const theme = getDisciplineTheme(item.discipline as any);
  const effectiveNow = now ?? new Date();
  const disciplineLabel = getDisciplineLabel(item.discipline);

  const pain = item.latestCompletedActivity?.painFlag ?? false;
  const hasAdvice = !!item.notes;
  const statusIcon = getAccountabilityStatusIcon(item, effectiveNow);

  return (
    <button
      type="button"
      onClick={onClick}
      data-athlete-week-session-row="v2"
      className={cn(
        'w-full cursor-pointer text-left',
        'bg-white/35 hover:bg-white/50 border border-white/25 rounded-lg px-2 py-1.5',
        'transition-colors'
      )}
      aria-label={`Open ${disciplineLabel} session`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* 1) Icon + discipline label (stacked; stable) */}
        <div className="flex flex-col items-center justify-center w-11 flex-shrink-0">
          <Icon name={theme.iconName} size="sm" className={cn(theme.textClass, 'text-[16px] leading-none')} />
          <span className={cn('text-[10px] font-medium leading-none mt-0.5', theme.textClass)}>{disciplineLabel}</span>
        </div>

        {/* 2-3) Time + title */}
        <div className="flex-1 min-w-0">
          <p className="text-[10px] leading-none text-[var(--muted)]">{item.displayTimeLocal ?? ''}</p>
          <p className="text-xs font-normal truncate text-[var(--text)]">{item.title || disciplineLabel}</p>
        </div>

        {/* 4) Indicators (right-aligned; consistent order) */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {pain ? <Icon name="painFlag" size="sm" className="text-[16px] leading-none text-rose-500" /> : null}
          {hasAdvice ? <Icon name="coachAdvice" size="sm" className="text-[16px] leading-none text-amber-600" /> : null}
          {statusIcon.name ? (
            <span title={statusIcon.title ?? undefined}>
              <Icon name={statusIcon.name} size="sm" className={cn('text-[16px] leading-none', statusIcon.className)} />
            </span>
          ) : (
            <span className="w-[16px]" />
          )}
        </div>
      </div>
    </button>
  );
}

import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/iconRegistry';
import { getSessionStatusIndicator } from '@/components/calendar/getSessionStatusIndicator';
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
  timeZone: string;
  now?: Date;
};

function getDisciplineLabel(discipline: string): string {
  const d = (discipline || 'OTHER').toUpperCase();
  if (d === 'RUN' || d === 'BIKE' || d === 'SWIM' || d === 'REST') return d;
  if (d === 'BRICK') return 'BRICK';
  if (d === 'STRENGTH') return 'STR';
  return d.slice(0, 5);
}

function getAccountabilityStatusIcon(params: {
  item: AthleteWeekSessionRowItem;
  now: Date;
  timeZone: string;
}): { name: IconName | null; className: string; title: string | null } {
  const { item, now, timeZone } = params;

  if (item.discipline === 'REST') return { name: null, className: '', title: null };

  const indicator = getSessionStatusIndicator({
    status: item.status,
    date: item.date,
    timeZone,
    now,
  });

  if (indicator.iconName === 'planned') return { name: null, className: '', title: null };

  return {
    name: indicator.iconName,
    className: indicator.colorClass,
    title:
      indicator.iconName === 'missed'
        ? 'Missed session – this workout was planned but not completed'
        : null,
  };
}

export function AthleteWeekSessionRow({ item, onClick, now, timeZone }: AthleteWeekSessionRowProps) {
  const theme = getDisciplineTheme(item.discipline as any);
  const effectiveNow = now ?? new Date();
  const disciplineLabel = getDisciplineLabel(item.discipline);

  const pain = item.latestCompletedActivity?.painFlag ?? false;
  const hasAdvice = !!item.notes;
  const statusIcon = getAccountabilityStatusIcon({ item, now: effectiveNow, timeZone });

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

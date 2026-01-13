import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/iconRegistry';
import { getSessionStatusIndicator } from '@/components/calendar/getSessionStatusIndicator';
import { cn } from '@/lib/cn';
import { CALENDAR_ACTION_ICON_CLASS } from '@/components/calendar/iconTokens';

export type AthleteWeekSessionRowItem = {
  id: string;
  date: string;
  plannedStartTimeLocal: string | null;
  displayTimeLocal?: string | null;
  discipline: string;
  status: string;
  title: string;
  workoutDetail?: string | null;
  latestCompletedActivity?: {
    painFlag?: boolean;
  } | null;
};

type AthleteWeekSessionRowProps = {
  item: AthleteWeekSessionRowItem;
  onClick: () => void;
  timeZone: string;
  now?: Date;
  variant?: 'default' | 'stacked';
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
        ? 'Missed workout – this workout was planned but not completed'
        : null,
  };
}

export function AthleteWeekSessionRow({ item, onClick, now, timeZone, variant = 'default' }: AthleteWeekSessionRowProps) {
  const theme = getDisciplineTheme(item.discipline as any);
  const effectiveNow = now ?? new Date();
  const disciplineLabel = getDisciplineLabel(item.discipline);

  const pain = item.latestCompletedActivity?.painFlag ?? false;
  const statusIcon = getAccountabilityStatusIcon({ item, now: effectiveNow, timeZone });

  const isStacked = variant === 'stacked';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      data-athlete-week-session-row="v2"
      className={cn(
        'w-full cursor-pointer text-left',
        isStacked
          ? 'bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded px-2 py-1 transition-shadow hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus-visible:shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
          : 'bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded px-2 py-1.5 transition-shadow hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus-visible:shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
      )}
      aria-label={`Open ${disciplineLabel} workout`}
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
          <p className={cn(isStacked ? 'text-[11px]' : 'text-xs', 'font-normal truncate text-[var(--text)]')}>
            {item.title || disciplineLabel}
          </p>
        </div>

        {/* 4) Indicators (right-aligned; consistent order) */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {pain ? <Icon name="painFlag" size="xs" className={cn('leading-none text-rose-500', CALENDAR_ACTION_ICON_CLASS)} /> : null}
          {statusIcon.name ? (
            <span title={statusIcon.title ?? undefined}>
              <Icon name={statusIcon.name} size="xs" className={cn('leading-none', CALENDAR_ACTION_ICON_CLASS, statusIcon.className)} />
            </span>
          ) : (
            <span className="w-[13px]" />
          )}
        </div>
      </div>
    </button>
  );
}

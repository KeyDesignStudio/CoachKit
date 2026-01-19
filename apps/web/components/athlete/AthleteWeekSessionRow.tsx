import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/iconRegistry';
import { getSessionStatusIndicator } from '@/components/calendar/getSessionStatusIndicator';
import { cn } from '@/lib/cn';
import { CALENDAR_ACTION_ICON_CLASS } from '@/components/calendar/iconTokens';
import { mobilePillGap, mobilePillPadding } from '@/components/calendar/calendarDensity';

export type AthleteWeekSessionRowItem = {
  id: string;
  date: string;
  plannedStartTimeLocal: string | null;
  displayTimeLocal?: string | null;
  origin?: string | null;
  planningStatus?: string | null;
  sourceActivityId?: string | null;
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
  showTimeOnMobile?: boolean;
  statusIndicatorVariant?: 'icon' | 'bar';
};

function getDisciplineLabel(discipline: string): string {
  const d = (discipline || 'OTHER').toUpperCase();
  if (d === 'RUN' || d === 'BIKE' || d === 'SWIM' || d === 'REST') return d;
  if (d === 'BRICK') return 'BRICK';
  if (d === 'STRENGTH') return 'STR';
  return d.slice(0, 5);
}

function getStatusBarConfig(params: {
  item: AthleteWeekSessionRowItem;
  now: Date;
  timeZone: string;
}): { iconName: IconName; ariaLabel: string; bgClassName: string; title: string | null } {
  const { item, now, timeZone } = params;

  const indicator = getSessionStatusIndicator({
    status: item.status,
    date: item.date,
    timeZone,
    now,
  });

  const isCompleted = item.status === 'COMPLETED_SYNCED' || item.status === 'COMPLETED_MANUAL';
  const isSkipped = item.status === 'SKIPPED';
  const isMissed = indicator.iconName === 'missed';

  if (isCompleted) {
    return { iconName: 'completed', ariaLabel: 'Completed', bgClassName: 'bg-emerald-600/45', title: null };
  }

  if (isSkipped) {
    return { iconName: 'skipped', ariaLabel: 'Skipped', bgClassName: 'bg-rose-600/45', title: null };
  }

  if (isMissed) {
    return {
      iconName: 'missed',
      ariaLabel: 'Missed workout',
      bgClassName: 'bg-rose-600/45',
      title: 'Missed workout – this workout was planned but not completed',
    };
  }

  if (item.status === 'COMPLETED_SYNCED_DRAFT') {
    return {
      iconName: 'needsReview',
      ariaLabel: 'Draft completion (pending confirmation)',
      bgClassName: 'bg-amber-500/45',
      title: null,
    };
  }

  return { iconName: 'planned', ariaLabel: 'Planned', bgClassName: 'bg-amber-500/45', title: null };
}

export function AthleteWeekSessionRow({
  item,
  onClick,
  now,
  timeZone,
  variant = 'default',
  showTimeOnMobile = true,
  statusIndicatorVariant = 'icon',
}: AthleteWeekSessionRowProps) {
  const theme = getDisciplineTheme(item.discipline as any);
  const effectiveNow = now ?? new Date();
  const disciplineLabel = getDisciplineLabel(item.discipline);

  const isRecordedFromStrava = item.origin === 'STRAVA' && item.planningStatus === 'UNPLANNED';
  const titleLabel = isRecordedFromStrava
    ? `${(item.title || 'Recorded activity').trim()} (unscheduled)`
    : item.title || disciplineLabel;

  const pain = item.latestCompletedActivity?.painFlag ?? false;
  const statusBar = getStatusBarConfig({ item, now: effectiveNow, timeZone });

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
        'w-full cursor-pointer text-left min-h-[44px] relative overflow-hidden',
        isStacked
          ? cn(
              'bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded',
              'transition-shadow',
              'hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus-visible:shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
              'active:bg-[var(--bg-structure)] md:active:bg-[var(--bg-card)]'
            )
          : cn(
              'bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded',
              'transition-shadow',
              'hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus-visible:shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
              'active:bg-[var(--bg-structure)] md:active:bg-[var(--bg-card)]'
            )
      )}
      aria-label={`Open ${disciplineLabel} workout`}
    >
      <div
        className={cn(
          'flex items-center min-w-0 h-full',
          mobilePillGap,
          mobilePillPadding,
          statusIndicatorVariant === 'bar' ? 'pr-3 md:pr-4' : ''
        )}
      >
        {/* 1) Icon + discipline label (stacked; stable) */}
        <div className="flex flex-col items-center justify-center w-11 flex-shrink-0">
          <Icon name={theme.iconName} size="sm" className={cn(theme.textClass, 'text-[16px] leading-none')} />
          <span className={cn('text-[10px] font-medium leading-none mt-0.5', theme.textClass)}>{disciplineLabel}</span>
        </div>

        {/* 2-3) Time + title */}
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              'text-[10px] leading-none text-[var(--muted)] whitespace-nowrap',
              showTimeOnMobile ? '' : 'hidden md:block'
            )}
          >
            {item.displayTimeLocal ?? ''}
          </p>
          <p className={cn(isStacked ? 'text-[11px]' : 'text-xs', 'font-normal truncate text-[var(--text)]')}>
            {titleLabel}
          </p>
        </div>

        {/* 4) Indicators (right-aligned; pain stays inline; status may become a full-height bar) */}
        {pain ? (
          <div className="flex items-center flex-shrink-0 whitespace-nowrap">
            <Icon name="painFlag" size="xs" className={cn('leading-none text-rose-500', CALENDAR_ACTION_ICON_CLASS)} />
          </div>
        ) : null}

        {statusIndicatorVariant === 'icon' ? (
          <div className="flex items-center flex-shrink-0 whitespace-nowrap">
            <span title={statusBar.title ?? undefined}>
              <Icon
                name={statusBar.iconName}
                size="xs"
                className={cn('leading-none', CALENDAR_ACTION_ICON_CLASS, 'text-[var(--muted)]')}
                aria-label={statusBar.ariaLabel}
                aria-hidden={false}
              />
            </span>
          </div>
        ) : null}
      </div>

      {statusIndicatorVariant === 'bar' ? (
        <div
          className={cn(
            'absolute right-0 top-0 bottom-0 w-2 md:w-4',
            statusBar.bgClassName
          )}
          title={statusBar.title ?? undefined}
          aria-hidden
        >
          <div className="hidden md:flex h-full w-full items-center justify-center">
            <Icon
              name={statusBar.iconName}
              size="xs"
              className={cn('text-black leading-none scale-[1.035] origin-center')}
              aria-hidden
            />
          </div>
        </div>
      ) : null}
    </button>
  );
}

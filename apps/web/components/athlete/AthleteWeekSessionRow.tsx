import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/iconRegistry';
import { getSessionStatusIndicator } from '@/components/calendar/getSessionStatusIndicator';
import { cn } from '@/lib/cn';
import { CALENDAR_ACTION_ICON_CLASS } from '@/components/calendar/iconTokens';
import { mobilePillGap, mobilePillPadding } from '@/components/calendar/calendarDensity';

import { asStructureSegments, segmentLabel, segmentMeta } from '@/lib/workout-structure';

export type AthleteWeekSessionRowItem = {
  id: string;
  date: string;
  plannedStartTimeLocal: string | null;
  displayTimeLocal?: string | null;
  origin?: string | null;
  planningStatus?: string | null;
  publicationStatus?: 'DRAFT' | 'PUBLISHED' | null;
  sourceActivityId?: string | null;
  discipline: string;
  status: string;
  title: string;
  workoutDetail?: string | null;
  workoutStructure?: unknown | null;
  latestCompletedActivity?: {
    painFlag?: boolean;
  } | null;
};

type AthleteWeekSessionRowProps = {
  item: AthleteWeekSessionRowItem;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
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
}): { iconName: IconName; ariaLabel: string; bgClassName: string; title: string | null; showBar: boolean } {
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
    return { iconName: 'completed', ariaLabel: 'Completed', bgClassName: 'bg-emerald-600/45', title: null, showBar: true };
  }

  if (isSkipped) {
    return { iconName: 'skipped', ariaLabel: 'Missed', bgClassName: 'bg-rose-600/45', title: null, showBar: true };
  }

  if (isMissed) {
    return {
      iconName: 'missed',
      ariaLabel: 'Missed workout',
      bgClassName: 'bg-rose-600/45',
      title: 'Missed workout – this workout was planned but not completed',
      showBar: true,
    };
  }

  if (item.status === 'COMPLETED_SYNCED_DRAFT') {
    return {
      iconName: 'needsReview',
      ariaLabel: 'Draft completion (pending confirmation)',
      bgClassName: 'bg-amber-500/45',
      title: null,
      showBar: true,
    };
  }
  const isAthleteScheduledSession = item.planningStatus === 'UNPLANNED' && item.origin !== 'STRAVA';
  const isExplicitlyPublished = item.planningStatus === 'PUBLISHED';
  const isExplicitlyUnpublished = item.planningStatus === 'DRAFT';
  const isPublishedPlanSession = item.publicationStatus === 'PUBLISHED';
  if (isExplicitlyUnpublished) {
    return { iconName: 'planned', ariaLabel: 'Draft', bgClassName: 'bg-transparent', title: null, showBar: false };
  }
  if (isAthleteScheduledSession || isExplicitlyPublished || isPublishedPlanSession) {
    return { iconName: 'planned', ariaLabel: 'Published', bgClassName: 'bg-amber-500/45', title: null, showBar: true };
  }

  return { iconName: 'planned', ariaLabel: 'Draft', bgClassName: 'bg-transparent', title: null, showBar: false };
}

export function AthleteWeekSessionRow({
  item,
  onClick,
  onContextMenu,
  now,
  timeZone,
  variant = 'default',
  showTimeOnMobile = true,
  statusIndicatorVariant = 'icon',
}: AthleteWeekSessionRowProps) {
  const theme = getDisciplineTheme(item.discipline as any);
  const effectiveNow = now ?? new Date();
  const disciplineLabel = getDisciplineLabel(item.discipline);

  const segments = item.discipline === 'BRICK' ? asStructureSegments(item.workoutStructure) : null;

  const isRecordedFromStrava = item.origin === 'STRAVA' && item.planningStatus === 'UNPLANNED';
  const isAiPlanBuilder = item.origin === 'AI_PLAN_BUILDER';
  const titleLabel = isRecordedFromStrava
    ? `${(item.title || 'Recorded activity').trim()} (unscheduled)`
    : item.title || disciplineLabel;

  const pain = item.latestCompletedActivity?.painFlag ?? false;
  const statusBar = getStatusBarConfig({ item, now: effectiveNow, timeZone });
  const apbStripBgClassName = 'bg-[#eef1f5]';

  const isStacked = variant === 'stacked';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      onContextMenu={(e) => {
        if (onContextMenu) {
          // Do not e.preventDefault() here if we want parent to handle or if onContextMenu handles it.
          // But usually we want to stop propagation.
          // The passed onContextMenu from page calls preventDefault/stopPropagation.
          onContextMenu(e);
        }
      }}
      data-athlete-week-session-row="v2"
      className={cn(
        'w-full cursor-pointer text-left relative overflow-hidden flex flex-col',
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
          'flex items-center min-w-0 w-full min-h-[44px]',
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
        <div className="flex-1 min-w-0 py-1.5">
          <p
            className={cn(
              'text-[10px] leading-none text-[var(--muted)] whitespace-nowrap',
              showTimeOnMobile ? '' : 'hidden md:block'
            )}
          >
            {item.displayTimeLocal ?? ''}
          </p>
          <p className={cn(isStacked ? 'text-[11px]' : 'text-xs', 'font-normal truncate text-[var(--text)]')}>
            <span className="truncate">{titleLabel}</span>
            {isAiPlanBuilder ? (
              <span
                className={cn(
                  'ml-1 inline-flex items-center rounded border px-1.5 py-0.5 align-middle',
                  'text-[10px] leading-none font-medium',
                  'border-sky-500/40 text-sky-700 bg-sky-50',
                  'dark:border-sky-400/30 dark:text-sky-200 dark:bg-sky-900/20'
                )}
                title="CoachKit session"
                aria-label="CoachKit session"
              >
                <Icon name="planned" size="xs" className="mr-1 text-[11px] leading-none" aria-hidden />
                CK
              </span>
            ) : null}
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

      {segments && segments.length > 0 && (
        <div className="w-full flex flex-col border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          {segments.map((segment, idx) => {
            const label = segmentLabel(segment);
            const meta = segmentMeta(segment);
            const type = (segment.type as string)?.toUpperCase();
            let icon: IconName = 'disciplineOther';
            if (type === 'RUN' || type === 'TREADMILL') icon = 'disciplineRun';
            if (type === 'BIKE' || type === 'INDOOR_BIKE') icon = 'disciplineBike';
            if (type === 'SWIM') icon = 'disciplineSwim';
            if (type === 'STRENGTH') icon = 'disciplineStrength';
            if (type === 'REST') icon = 'disciplineRest';
            
            const notes = typeof segment.notes === 'string' ? segment.notes.trim() : null;

            return (
              <div key={idx} className="flex items-center gap-2 px-2 py-1 min-w-0 border-b last:border-0 border-[var(--border-subtle)]/50">
                 <Icon name={icon} size="xs" className="text-[var(--muted)] flex-shrink-0" />
                 <div className="min-w-0 flex-1 flex flex-col">
                   <div className="flex justify-between gap-1">
                      <span className="text-[10px] font-medium text-[var(--text)] truncate">{label}</span>
                      {meta && <span className="text-[9px] text-[var(--muted)] tabular-nums truncate flex-shrink-0">{meta}</span>}
                   </div>
                   {notes && <span className="text-[9px] text-[var(--muted)] truncate opacity-80">{notes}</span>}
                 </div>
              </div>
            );
          })}
        </div>
      )}

      {statusIndicatorVariant === 'bar' && (statusBar.showBar || isAiPlanBuilder) ? (
        <div
          className={cn(
            'absolute right-0 top-0 bottom-0 w-2 md:w-4',
            isAiPlanBuilder ? apbStripBgClassName : statusBar.bgClassName
          )}
          title={statusBar.title ?? undefined}
          aria-hidden
        >
          <div className="hidden md:flex h-full w-full items-center justify-center">
            <Icon
              name={isAiPlanBuilder ? 'planned' : statusBar.iconName}
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

import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/Icon';
import { getSessionStatusVisual } from '@/components/calendar/getSessionStatusVisual';
import { sortSessionsForDay } from '@/components/athlete/sortSessionsForDay';
import { CALENDAR_ACTION_ICON_CLASS, CALENDAR_ADD_SESSION_ICON } from '@/components/calendar/iconTokens';
import { mobileDayCellPadding, mobilePillGap, mobilePillPadding } from '@/components/calendar/calendarDensity';

export type MonthSession = {
  id: string;
  date: string | Date;
  plannedStartTimeLocal: string | null;
  displayTimeLocal?: string | null;
  discipline: string;
  status: string;
  title: string;
};

type AthleteMonthDayCellProps = {
  date: Date;
  dateStr: string;
  items: MonthSession[];
  isCurrentMonth: boolean;
  isToday: boolean;
  athleteTimezone?: string;
  onDayClick: (date: Date) => void;
  onItemClick: (itemId: string) => void;
  onAddClick?: (date: Date) => void;
  canAdd?: boolean;
};

const MAX_VISIBLE_ROWS = 3;

export function AthleteMonthDayCell({
  date,
  dateStr,
  items,
  isCurrentMonth,
  isToday,
  athleteTimezone = 'Australia/Brisbane',
  onDayClick,
  onItemClick,
  onAddClick,
  canAdd = true,
}: AthleteMonthDayCellProps) {
  const dayNumber = date.getDate();
  const sortedItems = sortSessionsForDay(items, athleteTimezone);
  const visible = sortedItems.slice(0, MAX_VISIBLE_ROWS);
  const remainingCount = Math.max(0, sortedItems.length - MAX_VISIBLE_ROWS);
  const addEnabled = !!onAddClick && canAdd;
  const addLabel = addEnabled ? 'Add workout' : 'Select single athlete to add workout';

  return (
    <div
      data-athlete-month-day-cell="v2"
      className={cn(
        'flex flex-col gap-1.5 md:gap-2 min-h-[112px] md:min-h-[120px] text-left',
        mobileDayCellPadding,
        'rounded bg-[var(--bg-card)] border',
        'transition-shadow',
        'hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus-within:shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
        !isCurrentMonth ? 'opacity-70' : '',
        isToday ? 'border-2 border-[var(--today-border)]' : 'border-[var(--border-subtle)]'
      )}
    >
      {/* A) Header row */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDayClick(date);
          }}
          className={cn(
            'h-11 min-w-11 md:h-6 md:min-w-6 md:px-1 rounded text-xs inline-flex items-center justify-center',
            'bg-[var(--bg-structure)] hover:bg-[var(--bg-structure)] border border-[var(--border-subtle)]',
            'active:bg-[var(--bg-structure)]',
            !isCurrentMonth ? 'text-[var(--muted)]' : 'text-[var(--text)]'
          )}
          aria-label={`Open day ${dateStr}`}
        >
          {dayNumber}
        </button>
        <div className="flex items-center gap-2">
          {isToday ? (
            <span className="text-[10px] rounded px-2 py-0.5 bg-blue-500/10 text-blue-700 border border-[var(--today-border)]">Today</span>
          ) : null}
          {onAddClick ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!addEnabled) return;
                onAddClick(date);
              }}
              className={cn(
                'inline-flex h-11 w-11 md:h-6 md:w-6 items-center justify-center rounded-full',
                addEnabled ? 'text-[var(--muted)] hover:text-[var(--primary)] hover:bg-[var(--bg-structure)]' : 'text-[var(--muted)] opacity-70 cursor-not-allowed',
                addEnabled ? 'active:bg-[var(--bg-structure)]' : '',
                'transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]'
              )}
              aria-label={addLabel}
              title={addLabel}
              aria-disabled={!addEnabled}
              disabled={!addEnabled}
            >
              <Icon name={CALENDAR_ADD_SESSION_ICON} size="sm" className={cn('text-[16px]', CALENDAR_ACTION_ICON_CLASS)} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      {/* B) Body: stacked workout rows (max 3) */}
      <div className="flex flex-col gap-1">
        {visible.map((item) => {
          const visual = getSessionStatusVisual(item, { now: new Date(), timeZone: athleteTimezone });
          const statusIcon = visual.overlay;
          const missedTitle =
            statusIcon === 'missed'
              ? 'Missed workout – this workout was planned but not completed'
              : undefined;

          return (
            <button
              key={item.id}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onItemClick(item.id);
              }}
              className={cn(
                'w-full flex items-center min-w-0 rounded-md text-left min-h-[44px]',
                mobilePillPadding,
                mobilePillGap,
                // Avoid stacking multiple white cards inside the day cell card.
                'bg-transparent hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)] cursor-default'
              )}
              aria-label={`Open workout ${item.id}`}
            >
              <span className={cn('text-[16px] leading-none flex-shrink-0', visual.iconColor)}>
                <Icon name={visual.icon} size="sm" className={cn('text-[16px] leading-none', CALENDAR_ACTION_ICON_CLASS)} />
              </span>
              <span className="text-[10px] leading-none text-[var(--muted)] flex-shrink-0 whitespace-nowrap">
                {item.displayTimeLocal ?? item.plannedStartTimeLocal ?? ''}
              </span>
              <span className="text-[11px] md:text-xs text-[var(--text)] truncate flex-1 min-w-0 font-normal">{item.title}</span>
              {statusIcon ? (
                <span className="flex-shrink-0 whitespace-nowrap" title={missedTitle}>
                  <Icon
                    name={statusIcon}
                    size="xs"
                    className={cn(
                      'leading-none',
                      CALENDAR_ACTION_ICON_CLASS,
                      statusIcon === 'completed'
                        ? 'text-emerald-600'
                        : statusIcon === 'needsReview'
                          ? 'text-amber-600'
                          : statusIcon === 'missed'
                            ? 'text-amber-700/70'
                            : 'text-[var(--muted)]'
                    )}
                  />
                </span>
              ) : (
                <span className="w-[13px] flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* C) Footer */}
      <div className="flex items-center justify-between text-[10px] text-[var(--muted)] min-h-[14px]">
        {remainingCount > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDayClick(date);
            }}
            className="rounded-md px-1.5 py-0.5 hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)]"
            aria-label={`Open day ${dateStr} (${remainingCount} more)`}
          >
            +{remainingCount} more
          </button>
        ) : (
          <span />
        )}
        <span />
      </div>
    </div>
  );
}

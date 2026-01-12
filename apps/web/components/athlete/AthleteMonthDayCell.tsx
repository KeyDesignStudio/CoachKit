import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/Icon';
import { getSessionStatusVisual } from '@/components/calendar/getSessionStatusVisual';
import { sortSessionsForDay } from '@/components/athlete/sortSessionsForDay';

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
}: AthleteMonthDayCellProps) {
  const dayNumber = date.getDate();
  const sortedItems = sortSessionsForDay(items, athleteTimezone);
  const visible = sortedItems.slice(0, MAX_VISIBLE_ROWS);
  const remainingCount = Math.max(0, sortedItems.length - MAX_VISIBLE_ROWS);

  return (
    <div
      data-athlete-month-day-cell="v2"
      onClick={onAddClick ? () => onAddClick(date) : undefined}
      tabIndex={onAddClick ? 0 : undefined}
      onKeyDown={
        onAddClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onAddClick(date);
              }
            }
          : undefined
      }
      className={cn(
        'flex flex-col gap-2 p-2 min-h-[120px] text-left',
        'rounded bg-[var(--bg-card)] border',
        'transition-shadow',
        'hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus-within:shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
        onAddClick
          ? [
              'cursor-pointer',
              'transition-colors duration-150',
              'hover:bg-[var(--bg-structure)]',
              'hover:ring-1 hover:ring-[var(--border-subtle)]',
              'focus-visible:outline-none',
              'focus-visible:bg-[var(--bg-structure)]',
              'focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]',
            ].join(' ')
          : '',
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
            'h-6 min-w-6 px-1 rounded text-xs',
            'bg-[var(--bg-structure)] hover:bg-[var(--bg-structure)] border border-[var(--border-subtle)]',
            !isCurrentMonth ? 'text-[var(--muted)]' : 'text-[var(--text)]'
          )}
          aria-label={`Open day ${dateStr}`}
        >
          {dayNumber}
        </button>
        {isToday ? (
          <span className="text-[10px] rounded px-2 py-0.5 bg-blue-500/10 text-blue-700 border border-[var(--today-border)]">Today</span>
        ) : null}
      </div>

      {/* B) Body: stacked session rows (max 3) */}
      <div className="flex flex-col gap-1">
        {visible.map((item) => {
          const visual = getSessionStatusVisual(item, { now: new Date(), timeZone: athleteTimezone });
          const statusIcon = visual.overlay;
          const missedTitle =
            statusIcon === 'missed'
              ? 'Missed session – this workout was planned but not completed'
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
                'w-full flex items-center gap-1 rounded-md px-1.5 py-1 text-left',
                // Avoid stacking multiple white cards inside the day cell card.
                'bg-transparent hover:bg-[var(--bg-structure)] cursor-default'
              )}
              aria-label={`Open session ${item.id}`}
            >
              <span className={cn('text-[16px] leading-none flex-shrink-0', visual.iconColor)}>
                <Icon name={visual.icon} size="sm" className="text-[16px] leading-none" />
              </span>
              <span className="text-[10px] leading-none text-[var(--muted)] flex-shrink-0">
                {item.displayTimeLocal ?? item.plannedStartTimeLocal ?? ''}
              </span>
              <span className="text-xs text-[var(--text)] truncate flex-1 font-normal">{item.title}</span>
              {statusIcon ? (
                <span className="flex-shrink-0" title={missedTitle}>
                  <Icon
                    name={statusIcon}
                    size="xs"
                    className={cn(
                      'leading-none',
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
            className="rounded-md px-1.5 py-0.5 hover:bg-[var(--bg-structure)]"
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

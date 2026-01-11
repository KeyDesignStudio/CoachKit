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
}: AthleteMonthDayCellProps) {
  const dayNumber = date.getDate();
  const sortedItems = sortSessionsForDay(items, athleteTimezone);
  const visible = sortedItems.slice(0, MAX_VISIBLE_ROWS);
  const remainingCount = Math.max(0, sortedItems.length - MAX_VISIBLE_ROWS);

  return (
    <div
      data-athlete-month-day-cell="v2"
      className={cn(
        'flex flex-col gap-2 p-2 min-h-[96px] border-r border-b border-white/20 last:border-r-0 bg-white/20 hover:bg-white/30 text-left',
        !isCurrentMonth ? 'opacity-70' : '',
        isToday ? 'ring-2 ring-blue-500 ring-inset' : ''
      )}
    >
      {/* A) Header row */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onDayClick(date)}
          className={cn(
            'h-6 w-6 rounded-full text-xs bg-white/35 hover:bg-white/50 border border-white/25',
            !isCurrentMonth ? 'text-[var(--muted)]' : 'text-[var(--text)]'
          )}
          aria-label={`Open day ${dateStr}`}
        >
          {dayNumber}
        </button>
        {isToday ? (
          <span className="text-[10px] rounded-full px-2 py-0.5 bg-blue-500/10 text-blue-700">Today</span>
        ) : null}
      </div>

      {/* B) Body: stacked session rows (max 3) */}
      <div className="flex flex-col gap-1">
        {visible.map((item) => {
          const visual = getSessionStatusVisual(item, new Date());
          const statusIcon = visual.overlay;
          const missedTitle =
            statusIcon === 'missed'
              ? 'Missed session – this workout was planned but not completed'
              : undefined;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onItemClick(item.id)}
              className="w-full flex items-center gap-1 rounded-md bg-white/35 hover:bg-white/50 border border-white/25 px-1.5 py-1 text-left"
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
                <span className="text-[16px] leading-none flex-shrink-0" title={missedTitle}>
                  <Icon
                    name={statusIcon}
                    size="sm"
                    className={cn(
                      'text-[16px] leading-none',
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
                <span className="text-[16px] leading-none flex-shrink-0" />
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
            onClick={() => onDayClick(date)}
            className="rounded-md px-1.5 py-0.5 hover:bg-white/35"
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

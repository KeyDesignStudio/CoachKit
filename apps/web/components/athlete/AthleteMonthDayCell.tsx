import { MouseEvent } from 'react';

import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/Icon';
import { getDayVisualSummary } from '@/components/calendar/getSessionStatusVisual';

export type MonthSession = {
  id: string;
  date: string | Date;
  plannedStartTimeLocal: string | null;
  discipline: string;
  status: string;
};

type AthleteMonthDayCellProps = {
  date: Date;
  dateStr: string;
  items: MonthSession[];
  isCurrentMonth: boolean;
  isToday: boolean;
  onDayClick: (date: Date) => void;
  onItemClick: (itemId: string) => void;
};

const MAX_VISIBLE_ICONS = 10;

export function AthleteMonthDayCell({
  date,
  items,
  isCurrentMonth,
  isToday,
  onDayClick,
  onItemClick,
}: AthleteMonthDayCellProps) {
  const dayNumber = date.getDate();
  const { dayTint, tooltip, sessions } = getDayVisualSummary(items, new Date());

  const visible = sessions.slice(0, MAX_VISIBLE_ICONS);

  return (
    <button
      type="button"
      onClick={() => onDayClick(date)}
      title={tooltip ?? undefined}
      data-athlete-month-day-cell="v2"
      className={cn(
        'relative h-[120px] border-r border-b border-white/20 p-2 last:border-r-0 text-left overflow-hidden',
        !isCurrentMonth ? 'bg-white/10' : 'bg-white/30',
        isToday ? 'ring-2 ring-blue-500 ring-inset' : ''
      )}
    >
      {dayTint ? <div className={cn('absolute inset-0 pointer-events-none', dayTint)} /> : null}

      <div className="relative flex items-start justify-between">
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full text-xs',
            isToday ? 'bg-blue-500 text-white' : isCurrentMonth ? 'text-[var(--text)]' : 'text-[var(--muted)]'
          )}
        >
          {dayNumber}
        </span>
      </div>

      <div className="relative mt-2 flex flex-wrap gap-1 max-h-[84px] overflow-hidden">
        {visible.map((v, idx) => {
          const itemId = v.id ?? items[idx]?.id;
          if (!itemId) return null;

          const onIconClick = (event: MouseEvent) => {
            event.stopPropagation();
            onItemClick(itemId);
          };

          return (
            <button
              key={`${itemId}-${idx}`}
              type="button"
              onClick={onIconClick}
              className="relative h-7 w-7 rounded-lg bg-white/20 hover:bg-white/35 focus:outline-none focus:ring-2 focus:ring-white/40"
              aria-label={`Open session ${itemId}`}
            >
              <Icon name={v.icon} size="sm" className={cn('absolute inset-0 m-auto', v.iconColor)} />
              {v.overlay ? (
                <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-white/90 flex items-center justify-center">
                  <Icon
                    name={v.overlay}
                    size="sm"
                    className={cn(
                      'text-[11px] leading-none',
                      v.overlay === 'completed'
                        ? 'text-emerald-600'
                        : v.overlay === 'needsReview'
                          ? 'text-amber-600'
                          : 'text-rose-500/70'
                    )}
                  />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </button>
  );
}

import { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/Icon';
import { CALENDAR_ACTION_ICON_CLASS, CALENDAR_ADD_SESSION_ICON } from '@/components/calendar/iconTokens';
import { mobileHeaderPadding } from '@/components/calendar/calendarDensity';
import type { WeatherSummary } from '@/lib/weather-model';
import { WeatherTooltip } from '@/components/calendar/WeatherTooltip';

type AthleteWeekDayColumnProps = {
  dayName: string;
  formattedDate: string;
  dayWeather?: WeatherSummary;
  isToday?: boolean;
  isEmpty: boolean;
  onHeaderClick?: () => void;
  onEmptyClick?: () => void;
  onAddClick?: () => void;
  headerTestId?: string;
  addButtonTestId?: string;
  density?: 'default' | 'compact';
  headerDensity?: 'default' | 'compact';
  children: ReactNode;
  onContextMenu?: (e: React.MouseEvent) => void;
};

export function AthleteWeekDayColumn({
  dayName,
  formattedDate,
  dayWeather,
  isToday = false,
  isEmpty,
  onHeaderClick,
  onEmptyClick,
  onAddClick,
  headerTestId,
  addButtonTestId,
  density = 'default',
  headerDensity,
  children,
  onContextMenu,
  useSubgrid = false,
  style,
}: AthleteWeekDayColumnProps & { useSubgrid?: boolean; style?: React.CSSProperties }) {
  const resolvedHeaderDensity = headerDensity ?? density;
  const headerClassName =
    resolvedHeaderDensity === 'compact'
      ? 'bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] px-3 py-1 md:py-1.5'
      : cn('bg-[var(--bg-surface)] border-b border-[var(--border-subtle)]', mobileHeaderPadding);

  const bodyClassName = cn(
    density === 'compact'
      ? 'flex flex-col gap-1 p-1 md:gap-1.5 md:p-1.5'
      : 'flex flex-col gap-1.5 p-1.5 md:gap-2 md:p-2'
  );

  const addButton = onAddClick ? (
    <button
      type="button"
      onClick={onAddClick}
      data-testid={addButtonTestId ?? 'athlete-week-day-column-add'}
      className={cn(
        'inline-flex h-11 w-11 md:h-6 md:w-6 items-center justify-center rounded-full',
        'text-[var(--muted)] hover:text-[var(--primary)]',
        'hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)]',
        'transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]'
      )}
      aria-label="Add workout"
      title="Add workout"
    >
      <Icon name={CALENDAR_ADD_SESSION_ICON} size="sm" className={cn('text-[16px]', CALENDAR_ACTION_ICON_CLASS)} aria-hidden />
    </button>
  ) : null;

  const headerNeedsTabStop = Boolean(dayWeather) && !onHeaderClick && !onAddClick;

  return (
    <div
      data-athlete-week-day-card="v2"
      onContextMenu={onContextMenu}
      style={useSubgrid ? { ...style, gridTemplateRows: 'subgrid' } : style}
      className={cn(
        'min-w-0 rounded bg-[var(--bg-structure)] overflow-hidden',
        useSubgrid ? 'grid' : 'flex flex-col',
        isToday ? 'border-2 border-[var(--today-border)]' : 'border border-[var(--border-subtle)]'
      )}
    >
      <WeatherTooltip weather={dayWeather}>
        <div
          className={cn('flex items-center justify-between gap-2', headerClassName)}
          data-testid={headerTestId}
          tabIndex={headerNeedsTabStop ? 0 : undefined}
          aria-label={headerNeedsTabStop ? `${dayName} ${formattedDate}` : undefined}
        >
          {onHeaderClick ? (
            <button type="button" onClick={onHeaderClick} className="min-w-0 text-left">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{dayName}</p>
              <p className="text-sm font-medium truncate">{formattedDate}</p>
            </button>
          ) : (
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{dayName}</p>
              <p className="text-sm font-medium truncate">{formattedDate}</p>
            </div>
          )}

          <div className="flex items-center gap-2 flex-shrink-0">
            {isToday ? (
              <span className="bg-blue-500/10 text-blue-700 text-[10px] px-2 py-0.5 rounded border border-[var(--today-border)]">Today</span>
            ) : null}
            {addButton}
          </div>
        </div>
      </WeatherTooltip>

      <div className={useSubgrid ? 'contents' : bodyClassName}>
        {children}
        {isEmpty ? (
          onEmptyClick ? (
            <button
              type="button"
              onClick={onEmptyClick}
              className="w-full text-xs text-[var(--muted)] text-center py-2"
            >
              No workouts
            </button>
          ) : (
            <p className="text-xs text-[var(--muted)] text-center py-2">No workouts</p>
          )
        ) : null}
      </div>
    </div>
  );
}

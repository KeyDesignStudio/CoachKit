'use client';

import { useCallback, useRef } from 'react';

import { CalendarShell } from '@/components/calendar/CalendarShell';
import { SkeletonWeekGrid } from '@/components/calendar/SkeletonWeekGrid';
import { SkeletonMonthGrid } from '@/components/calendar/SkeletonMonthGrid';
import { AthleteWeekDayColumn } from '@/components/athlete/AthleteWeekDayColumn';
import { AthleteWeekSessionRow } from '@/components/athlete/AthleteWeekSessionRow';
import { AthleteMonthDayCell } from '@/components/athlete/AthleteMonthDayCell';
import { WeekSummaryColumn } from '@/components/coach/WeekSummaryColumn';
import { MonthGrid } from '@/components/coach/MonthGrid';
import { Icon } from '@/components/ui/Icon';
import { CALENDAR_ACTION_ICON_CLASS, CALENDAR_ADD_SESSION_ICON } from '@/components/calendar/iconTokens';
import { cn } from '@/lib/cn';
import { formatKmCompact, formatKcal, formatMinutesCompact } from '@/lib/calendar/discipline-summary';
import type { WeatherSummary } from '@/lib/weather-model';
import type { CalendarItem } from '@/components/coach/types';
import type { GoalCountdown } from '@/lib/goal-countdown';

export type CoachAthleteOption = {
  userId: string;
  user: {
    id: string;
    name: string | null;
    timezone?: string | null;
  };
};

export type CoachWeekGridDay = {
  dateKey: string;
  dayName: string;
  formattedDate: string;
  weather?: WeatherSummary;
  isToday: boolean;
  athleteRows: Array<{
    athlete: CoachAthleteOption;
    dayItems: CalendarItem[];
    timeZone: string;
  }>;
};

export type CoachMonthDay = {
  date: Date;
  dateStr: string;
  isCurrentMonth: boolean;
  weather?: WeatherSummary;
  items: CalendarItem[];
};

export type CoachMonthWeek = {
  weekIndex: number;
  week: CoachMonthDay[];
  weekSummary: {
    totals: { durationMinutes: number; distanceKm: number; caloriesKcal: number };
    byDiscipline: Array<{ discipline: string; durationMinutes: number; distanceKm: number }>;
    workoutCount: number;
  } | null;
  weekTopDisciplines: Array<{ discipline: string; durationMinutes: number; distanceKm: number }>;
  weekWorkoutCount: number;
};

type CoachCalendarGridProps = {
  viewMode: 'week' | 'month';
  showSkeleton: boolean;
  selectedAthleteIds: Set<string>;
  selectedAthletes: CoachAthleteOption[];
  weekGridDays: CoachWeekGridDay[];
  monthWeeks: CoachMonthWeek[];
  weekStartKey: string;
  athleteTimezone: string;
  items: CalendarItem[];
  itemsById: Map<string, CalendarItem>;
  todayKey: string;
  goalCountdownByAthlete?: Record<string, GoalCountdown>;
  onContextMenu: (e: React.MouseEvent, type: 'session' | 'day', data: any) => void;
  onAddClick: (athleteId: string, date: string) => void;
  onMonthDayClick: (dateStr: string) => void;
  onMonthAddClick: (dateStr: string) => void;
  onSessionClick: (item: CalendarItem) => void;
};

export function CoachCalendarGrid({
  viewMode,
  showSkeleton,
  selectedAthleteIds,
  selectedAthletes,
  weekGridDays,
  monthWeeks,
  weekStartKey,
  athleteTimezone,
  items,
  itemsById,
  todayKey,
  goalCountdownByAthlete = {},
  onContextMenu,
  onAddClick,
  onMonthDayClick,
  onMonthAddClick,
  onSessionClick,
}: CoachCalendarGridProps) {
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextClickRef = useRef(false);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const startLongPress = useCallback(
    (event: React.TouchEvent, type: 'session' | 'day', data: any) => {
      const touch = event.touches[0];
      if (!touch) return;

      cancelLongPress();
      longPressTimerRef.current = setTimeout(() => {
        suppressNextClickRef.current = true;
        onContextMenu(
          {
            clientX: touch.clientX,
            clientY: touch.clientY,
            preventDefault: () => {},
            stopPropagation: () => {},
          } as unknown as React.MouseEvent,
          type,
          data
        );
      }, 520);
    },
    [cancelLongPress, onContextMenu]
  );

  const handleSessionTap = useCallback(
    (item: CalendarItem) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      onSessionClick(item);
    },
    [onSessionClick]
  );

  if (showSkeleton) {
    return (
      <CalendarShell variant={viewMode}>
        {viewMode === 'week' ? <SkeletonWeekGrid pillsPerDay={3} showSummaryColumn /> : <SkeletonMonthGrid showSummaryColumn />}
      </CalendarShell>
    );
  }

  if (selectedAthleteIds.size === 0) {
    return (
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center text-[var(--muted)]">
        <p>Select athletes to view the calendar</p>
      </div>
    );
  }

  if (viewMode === 'week') {
    return (
      <CalendarShell variant="week" data-coach-week-view-version="coach-week-v2">
        <>
          <div className="flex flex-col gap-3 md:hidden">
            {weekGridDays.map((day) => (
              <AthleteWeekDayColumn
                key={day.dateKey}
                dayName={day.dayName}
                formattedDate={day.formattedDate}
                dayWeather={day.weather}
                isEmpty={false}
                isToday={day.isToday}
                isGoalDay={day.athleteRows.some((row) => goalCountdownByAthlete[row.athlete.userId]?.eventDate === day.dateKey)}
                headerTestId="coach-calendar-date-header"
                onContextMenu={(e) => onContextMenu(e, 'day', { date: day.dateKey })}
              >
                <div className="flex flex-col">
                  {day.athleteRows.map((row, index) => {
                    const showAthleteSubheaderOnMobile = selectedAthletes.length > 1;
                    return (
                      <div
                        key={row.athlete.userId}
                        data-testid="coach-calendar-athlete-row"
                        onContextMenu={(e) => onContextMenu(e, 'day', { date: day.dateKey, athleteId: row.athlete.userId })}
                        onTouchStart={(e) => {
                          const target = e.target as HTMLElement | null;
                          if (target?.closest?.('[data-coach-session-touch-target="true"]')) return;
                          startLongPress(e, 'day', { date: day.dateKey, athleteId: row.athlete.userId });
                        }}
                        onTouchEnd={cancelLongPress}
                        onTouchCancel={cancelLongPress}
                        onTouchMove={cancelLongPress}
                        className="flex flex-col gap-1.5"
                        style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                      >
                        <div
                          className={cn('h-8 items-center justify-between gap-2', showAthleteSubheaderOnMobile ? 'flex' : 'hidden')}
                        >
                          <div className="text-[11px] font-medium text-[var(--muted)] md:truncate min-w-0">
                            {row.athlete.user.name || row.athlete.userId}
                          </div>
                          <button
                            type="button"
                            onClick={() => onAddClick(row.athlete.userId, day.dateKey)}
                            className="h-6 w-6 items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--primary)]"
                          >
                            <Icon name={CALENDAR_ADD_SESSION_ICON} size="sm" className="text-[16px]" aria-hidden />
                          </button>
                        </div>

                        <div className="min-h-[44px] flex flex-col gap-1">
                          {row.dayItems.map((item) => (
                            <div
                              key={item.id}
                              data-coach-session-touch-target="true"
                              onTouchStart={(e) => {
                                e.stopPropagation();
                                startLongPress(e, 'session', item);
                              }}
                              onTouchEnd={(e) => {
                                e.stopPropagation();
                                cancelLongPress();
                              }}
                              onTouchCancel={(e) => {
                                e.stopPropagation();
                                cancelLongPress();
                              }}
                              onTouchMove={(e) => {
                                e.stopPropagation();
                                cancelLongPress();
                              }}
                              style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                            >
                              <AthleteWeekSessionRow
                                item={{
                                  ...(item as any),
                                  title: `${item.title || item.discipline || 'Workout'}`,
                                }}
                                timeZone={row.timeZone}
                                onClick={() => handleSessionTap(item)}
                                onContextMenu={(e) => onContextMenu(e, 'session', item)}
                                showTimeOnMobile={false}
                                statusIndicatorVariant="bar"
                              />
                            </div>
                          ))}
                        </div>

                        {index < day.athleteRows.length - 1 ? (
                          <div className="my-1 h-px bg-[var(--border-subtle)] opacity-40" />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </AthleteWeekDayColumn>
            ))}
          </div>

          <div
            className={cn('hidden md:grid gap-3', selectedAthleteIds.size > 0 ? 'md:grid-cols-8' : 'md:grid-cols-7')}
            style={{ gridTemplateRows: `auto repeat(${selectedAthletes.length}, auto)` }}
          >
            {weekGridDays.map((day) => (
              <AthleteWeekDayColumn
                key={day.dateKey}
                dayName={day.dayName}
                formattedDate={day.formattedDate}
                dayWeather={day.weather}
                isEmpty={false}
                isToday={day.isToday}
                isGoalDay={day.athleteRows.some((row) => goalCountdownByAthlete[row.athlete.userId]?.eventDate === day.dateKey)}
                headerTestId="coach-calendar-date-header"
                onContextMenu={(e) => onContextMenu(e, 'day', { date: day.dateKey })}
                useSubgrid
                style={{ gridRow: '1 / -1' }}
              >
                {day.athleteRows.map((row) => (
                  <div
                    key={row.athlete.userId}
                    data-testid="coach-calendar-athlete-row"
                    onContextMenu={(e) => onContextMenu(e, 'day', { date: day.dateKey, athleteId: row.athlete.userId })}
                    className="flex flex-col gap-1.5 md:gap-2 min-w-0"
                  >
                    <div className="hidden md:flex h-8 items-center justify-between gap-2">
                      <div className="min-w-0 flex items-center gap-2">
                        <div className="text-[11px] font-medium text-[var(--muted)] md:truncate min-w-0">
                          {row.athlete.user.name || row.athlete.userId}
                        </div>
                        {goalCountdownByAthlete[row.athlete.userId]?.mode && goalCountdownByAthlete[row.athlete.userId].mode !== 'none' ? (
                          <span className="inline-flex items-center rounded-full border border-orange-300 bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium text-orange-700">
                            {goalCountdownByAthlete[row.athlete.userId].shortLabel}
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => onAddClick(row.athlete.userId, day.dateKey)}
                        data-testid="add-schedule-button"
                        className="hidden md:inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--primary)] hover:bg-[var(--bg-structure)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]"
                        aria-label="Add workout"
                        title="Add workout"
                      >
                        <Icon
                          name={CALENDAR_ADD_SESSION_ICON}
                          size="sm"
                          className={`text-[16px] ${CALENDAR_ACTION_ICON_CLASS}`}
                          aria-hidden
                        />
                      </button>
                    </div>

                    <div className="min-h-[44px] flex flex-col gap-1 md:gap-2 md:min-h-[72px]">
                      {row.dayItems.map((item) => (
                        <AthleteWeekSessionRow
                          key={item.id}
                          item={{
                            ...(item as any),
                            title: `${item.title || item.discipline || 'Workout'}`,
                          }}
                          timeZone={row.timeZone}
                          onClick={() => onSessionClick(item)}
                          onContextMenu={(e) => onContextMenu(e, 'session', item)}
                          showTimeOnMobile={false}
                          statusIndicatorVariant="bar"
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </AthleteWeekDayColumn>
            ))}

            <WeekSummaryColumn
              items={items}
              selectedAthleteIds={selectedAthleteIds}
              weekStartKey={weekStartKey}
              athleteTimezone={athleteTimezone}
              style={{ gridRow: '1 / -1' }}
            />
          </div>
        </>
      </CalendarShell>
    );
  }

  return (
    <CalendarShell variant="month" data-coach-month-view-version="coach-month-v2">
      <MonthGrid includeSummaryColumn>
        {monthWeeks.map((weekBlock) => (
          <div key={`week-${weekBlock.weekIndex}`} className="contents">
            {weekBlock.week.map((day) => (
              <AthleteMonthDayCell
                key={day.dateStr}
                date={day.date}
                dateStr={day.dateStr}
                dayWeather={day.weather}
                items={day.items as any}
                isCurrentMonth={day.isCurrentMonth}
                isToday={day.dateStr === todayKey}
                isGoalDay={day.items.some((item) => goalCountdownByAthlete[String(item.athleteId ?? '')]?.eventDate === day.dateStr)}
                canAdd={selectedAthleteIds.size === 1}
                onDayClick={onMonthDayClick}
                onAddClick={onMonthAddClick}
                onItemClick={(itemId) => {
                  const found = itemsById.get(itemId);
                  if (found) {
                    onSessionClick(found);
                  }
                }}
              />
            ))}

            <div className="hidden md:block min-h-[110px] bg-[rgb(209,217,232)] p-2">
              <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Week</div>
              <div className="mt-1 text-xs font-semibold text-[var(--text)] tabular-nums">
                {weekBlock.weekSummary ? (
                  <>
                    {formatMinutesCompact(weekBlock.weekSummary.totals.durationMinutes)} · {formatKmCompact(weekBlock.weekSummary.totals.distanceKm)}
                  </>
                ) : (
                  <>{weekBlock.weekWorkoutCount} workouts</>
                )}
              </div>
              {weekBlock.weekSummary ? (
                <>
                  <div className="text-xs text-[var(--muted)] tabular-nums">Calories: {formatKcal(weekBlock.weekSummary.totals.caloriesKcal)}</div>
                  {weekBlock.weekTopDisciplines.length ? (
                    <div className="mt-1 space-y-0.5">
                      {weekBlock.weekTopDisciplines.map((row) => (
                        <div key={row.discipline} className="flex items-baseline justify-between gap-2">
                          <div className="text-[11px] font-medium text-[var(--text)] md:truncate">{row.discipline}</div>
                          <div className="text-[11px] text-[var(--muted)] tabular-nums md:whitespace-nowrap">
                            {formatMinutesCompact(row.durationMinutes)} · {formatKmCompact(row.distanceKm)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="text-xs text-[var(--muted)]">{weekBlock.weekWorkoutCount === 1 ? 'workout' : 'workouts'}</div>
              )}
            </div>
          </div>
        ))}
      </MonthGrid>
    </CalendarShell>
  );
}

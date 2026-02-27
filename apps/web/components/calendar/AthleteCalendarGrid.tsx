'use client';

import { CalendarShell } from '@/components/calendar/CalendarShell';
import { SkeletonWeekGrid } from '@/components/calendar/SkeletonWeekGrid';
import { SkeletonMonthGrid } from '@/components/calendar/SkeletonMonthGrid';
import { AthleteWeekGrid } from '@/components/athlete/AthleteWeekGrid';
import { AthleteWeekDayColumn } from '@/components/athlete/AthleteWeekDayColumn';
import { AthleteWeekSessionRow, AthleteWeekSessionRowItem } from '@/components/athlete/AthleteWeekSessionRow';
import { MonthGrid } from '@/components/coach/MonthGrid';
import { AthleteMonthDayCell, MonthSession } from '@/components/athlete/AthleteMonthDayCell';
import { formatKmCompact, formatKcal, formatMinutesCompact } from '@/lib/calendar/discipline-summary';
import type { WeatherSummary } from '@/lib/weather-model';
import type { GoalCountdown } from '@/lib/goal-countdown';

export type AthleteWeekDay = {
  date: string;
  name: string;
  formatted: string;
  weather?: WeatherSummary;
  items: AthleteWeekSessionRowItem[];
};

export type AthleteMonthDay = {
  date: Date;
  dateStr: string;
  isCurrentMonth: boolean;
  weather?: WeatherSummary;
  items: MonthSession[];
};

export type AthleteMonthWeek = {
  weekIndex: number;
  week: AthleteMonthDay[];
  weekSummary: {
    totals: { durationMinutes: number; distanceKm: number; caloriesKcal: number };
    byDiscipline: Array<{ discipline: string; durationMinutes: number; distanceKm: number }>;
    workoutCount: number;
  } | null;
  weekTopDisciplines: Array<{ discipline: string; durationMinutes: number; distanceKm: number }>;
  weekWorkoutCount: number;
};

type AthleteCalendarGridProps = {
  viewMode: 'week' | 'month';
  showSkeleton: boolean;
  weekDays: AthleteWeekDay[];
  weekSummary: {
    totals: { durationMinutes: number; distanceKm: number; caloriesKcal: number };
    byDiscipline: Array<{ discipline: string; durationMinutes: number; distanceKm: number }>;
    workoutCount: number;
  } | null;
  weekTopDisciplines: Array<{ discipline: string; durationMinutes: number; distanceKm: number }>;
  monthWeeks: AthleteMonthWeek[];
  todayKey: string;
  athleteTimezone: string;
  goalEventDateKey?: string | null;
  goalCountdown?: GoalCountdown | null;
  onDayClick: (dateStr: string) => void;
  onAddClick: (dateStr: string) => void;
  onItemClick: (itemId: string) => void;
  onContextMenu: (e: React.MouseEvent, type: 'session' | 'day', data: any) => void;
};

export function AthleteCalendarGrid({
  viewMode,
  showSkeleton,
  weekDays,
  weekSummary,
  weekTopDisciplines,
  monthWeeks,
  todayKey,
  athleteTimezone,
  goalEventDateKey,
  goalCountdown,
  onDayClick,
  onAddClick,
  onItemClick,
  onContextMenu,
}: AthleteCalendarGridProps) {
  if (showSkeleton) {
    return (
      <CalendarShell variant={viewMode}>
        {viewMode === 'week' ? <SkeletonWeekGrid showSummaryColumn /> : <SkeletonMonthGrid showSummaryColumn />}
      </CalendarShell>
    );
  }

  if (viewMode === 'week') {
    return (
      <CalendarShell variant="week" data-athlete-week-view-version="athlete-week-v2">
        <AthleteWeekGrid includeSummaryColumn>
          {weekDays.map((day) => (
            <AthleteWeekDayColumn
              key={day.date}
              dayName={day.name}
              formattedDate={day.formatted}
              dayWeather={day.weather}
              isEmpty={day.items.length === 0}
              isToday={day.date === todayKey}
              isGoalDay={Boolean(goalEventDateKey && day.date === goalEventDateKey)}
              headerTestId="athlete-calendar-date-header"
              onAddClick={() => onAddClick(day.date)}
              onContextMenu={(e) => onContextMenu(e, 'day', { date: day.date })}
            >
              {day.items.map((item) => (
                <AthleteWeekSessionRow
                  key={item.id}
                  item={item}
                  onClick={() => onItemClick(item.id)}
                  timeZone={athleteTimezone}
                  statusIndicatorVariant="bar"
                  onContextMenu={(e) => onContextMenu(e, 'session', item)}
                />
              ))}
            </AthleteWeekDayColumn>
          ))}

          <div className="hidden md:flex min-w-0 flex-col overflow-hidden rounded border border-[#cad7eb] bg-[rgba(233,238,248,0.85)] text-[var(--text)] dark:border-[#243047] dark:bg-[rgba(12,16,30,0.96)] dark:text-slate-100">
            <div className="px-3 py-1.5">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)] dark:text-slate-400">Summary</p>
              <p className="text-sm font-medium md:truncate">This week</p>
              {goalCountdown?.weeksRemaining ? (
                <p className="mt-0.5 text-[11px] text-[var(--muted)] tabular-nums dark:text-slate-400">{goalCountdown.weeksRemaining} weeks to event</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 p-2">
              {!weekSummary ? (
                <div className="text-xs text-[var(--muted)] dark:text-slate-400">No workouts yet</div>
              ) : (
                <>
                  <div className="rounded p-2">
                    <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] dark:text-slate-400">Workouts</div>
                    <div className="text-sm font-semibold text-[var(--text)]">{weekSummary.workoutCount}</div>
                  </div>
                  <div className="rounded p-2">
                    <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] dark:text-slate-400">Totals</div>
                    <div className="mt-1 text-sm font-semibold text-[var(--text)] tabular-nums">
                      {formatMinutesCompact(weekSummary.totals.durationMinutes)} · {formatKmCompact(weekSummary.totals.distanceKm)}
                    </div>
                    <div className="text-xs text-[var(--muted)] tabular-nums dark:text-slate-400">Calories: {formatKcal(weekSummary.totals.caloriesKcal)}</div>
                  </div>
                  <div className="rounded p-2">
                    <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] dark:text-slate-400">By discipline</div>
                    {weekTopDisciplines.length === 0 ? (
                      <div className="mt-1 text-xs text-[var(--muted)] dark:text-slate-400">No time/distance yet</div>
                    ) : (
                      <div className="mt-1 space-y-1">
                        {weekTopDisciplines.map((row) => (
                          <div key={row.discipline} className="flex items-baseline justify-between gap-2">
                            <div className="text-xs font-medium text-[var(--text)] md:truncate">{row.discipline}</div>
                            <div className="text-xs text-[var(--muted)] tabular-nums md:whitespace-nowrap dark:text-slate-400">
                              {formatMinutesCompact(row.durationMinutes)} · {formatKmCompact(row.distanceKm)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </AthleteWeekGrid>
      </CalendarShell>
    );
  }

  return (
    <CalendarShell variant="month" data-athlete-month-view-version="athlete-month-v2">
      <MonthGrid includeSummaryColumn>
        {monthWeeks.map((weekBlock) => (
          <div key={`week-${weekBlock.weekIndex}`} className="contents">
            {weekBlock.week.map((day) => (
              <AthleteMonthDayCell
                key={day.dateStr}
                date={day.date}
                dateStr={day.dateStr}
                dayWeather={day.weather}
                items={day.items}
                isCurrentMonth={day.isCurrentMonth}
                isToday={day.dateStr === todayKey}
                isGoalDay={Boolean(goalEventDateKey && day.dateStr === goalEventDateKey)}
                athleteTimezone={athleteTimezone}
                onDayClick={onDayClick}
                onAddClick={onAddClick}
                canAdd
                onItemClick={onItemClick}
                onContextMenu={onContextMenu}
              />
            ))}

            <div className="hidden min-h-[110px] rounded border border-[#cad7eb] bg-[rgba(233,238,248,0.85)] p-2 md:block dark:border-[#243047] dark:bg-[rgba(12,16,30,0.96)]">
              <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] dark:text-slate-400">Week</div>
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
                  <div className="text-xs text-[var(--muted)] tabular-nums dark:text-slate-400">Calories: {formatKcal(weekBlock.weekSummary.totals.caloriesKcal)}</div>
                  {weekBlock.weekTopDisciplines.length ? (
                    <div className="mt-1 space-y-0.5">
                      {weekBlock.weekTopDisciplines.map((row) => (
                        <div key={row.discipline} className="flex items-baseline justify-between gap-2">
                          <div className="text-[11px] font-medium text-[var(--text)] md:truncate">{row.discipline}</div>
                          <div className="text-[11px] text-[var(--muted)] tabular-nums md:whitespace-nowrap dark:text-slate-400">
                            {formatMinutesCompact(row.durationMinutes)} · {formatKmCompact(row.distanceKm)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="text-xs text-[var(--muted)] dark:text-slate-400">{weekBlock.weekWorkoutCount === 1 ? 'workout' : 'workouts'}</div>
              )}
            </div>
          </div>
        ))}
      </MonthGrid>
    </CalendarShell>
  );
}

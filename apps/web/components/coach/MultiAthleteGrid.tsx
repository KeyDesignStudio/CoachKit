'use client';

import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Badge';
import { formatDisplay } from '@/lib/client-date';
import { toDateInput } from '@/lib/client-date';
import { CalendarShell } from '@/components/calendar/CalendarShell';
import { AthleteWeekSessionRow } from '@/components/athlete/AthleteWeekSessionRow';
import { getCalendarDisplayTime } from '@/components/calendar/getCalendarDisplayTime';
import { cn } from '@/lib/cn';

type CalendarItem = {
  id: string;
  title: string;
  date: string;
  plannedStartTimeLocal: string | null;
  discipline: string;
  status: string;
  notes: string | null;
  latestCompletedActivity?: {
    painFlag: boolean;
    effectiveStartTimeUtc?: string | Date;
    startTime?: string | Date;
    startTimeUtc?: string | null;
    source?: string;
  } | null;
  hasAthleteComment?: boolean;
  coachAdvicePresent?: boolean;
};

type AthleteData = {
  athlete: {
    id: string;
    name: string | null;
    timezone: string;
  };
  items: CalendarItem[];
  weekStatus: 'DRAFT' | 'PUBLISHED';
};

type MultiAthleteGridProps = {
  athleteData: AthleteData[];
  weekDays: string[];
  onItemClick: (item: CalendarItem) => void;
  onRefresh: () => void;
};

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MultiAthleteGrid({ athleteData, weekDays, onItemClick, onRefresh }: MultiAthleteGridProps) {
  const todayKey = toDateInput(new Date());

  // Group items by athlete and date
  const athleteRows = athleteData.map((data) => {
    const itemsByDate = new Map<string, CalendarItem[]>();
    
    data.items.forEach((item) => {
      const dateStr = item.date.split('T')[0];
      if (!itemsByDate.has(dateStr)) {
        itemsByDate.set(dateStr, []);
      }
      itemsByDate.get(dateStr)!.push(item);
    });

    // Sort items within each day by plannedStartTimeLocal
    itemsByDate.forEach((items) => {
      items.sort((a, b) => {
        if (!a.plannedStartTimeLocal) return 1;
        if (!b.plannedStartTimeLocal) return -1;
        return a.plannedStartTimeLocal.localeCompare(b.plannedStartTimeLocal);
      });
    });

    return {
      ...data,
      itemsByDate,
    };
  });

  const gridTemplateClass = 'grid-cols-[220px_repeat(7,minmax(160px,1fr))]';

  return (
    <CalendarShell variant="week" className="p-0" structureClassName="p-0">
      <div className="overflow-x-auto">
        <div className="min-w-[1400px]">
          <div className={cn('grid gap-px rounded bg-[var(--bg-structure)]', gridTemplateClass)}>
            {/* Header row */}
            <div className="flex items-center bg-[var(--bg-surface)] px-4 py-3 min-w-0 rounded border border-[var(--border-subtle)]">
              <span className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Athlete</span>
            </div>
            {DAY_NAMES.map((day, index) => {
              const dateKey = weekDays[index];
              const isToday = dateKey === todayKey;
              return (
                <div
                  key={day}
                  className={cn(
                    'min-w-0 bg-[var(--bg-surface)] px-2 py-2 text-center rounded overflow-hidden',
                    isToday ? 'border-2 border-[var(--today-border)]' : 'border border-[var(--border-subtle)]'
                  )}
                >
                  <div className="flex items-center justify-center gap-2">
                    <div className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{day}</div>
                    {isToday ? (
                      <span className="bg-blue-500/10 text-blue-700 text-[10px] px-2 py-0.5 rounded border border-[var(--today-border)]">Today</span>
                    ) : null}
                  </div>
                  <div className="text-xs text-[var(--muted)] truncate">
                    {formatDisplay(weekDays[index]).split(',')[0].split(' ')[1]}
                  </div>
                </div>
              );
            })}

            {/* Body rows (single grid; use contents for alignment) */}
            {athleteRows.map((row) => (
              <div key={row.athlete.id} className="contents">
                <div className="flex flex-col justify-center gap-1 bg-[var(--bg-card)] px-4 py-3 min-w-0">
                  <div className="text-sm font-medium text-[var(--text)] truncate">
                    {row.athlete.name || row.athlete.id}
                  </div>
                  <Badge
                    className={cn(
                      'bg-[var(--bg-card)] border border-[var(--border-subtle)]',
                      row.weekStatus === 'PUBLISHED' ? 'text-emerald-700' : 'text-amber-700'
                    )}
                  >
                    {row.weekStatus}
                  </Badge>
                </div>

                {weekDays.map((dateKey) => {
                  const isToday = dateKey === todayKey;
                  const dayItems = (row.itemsByDate.get(dateKey) || []).map((item) => ({
                    ...item,
                    displayTimeLocal: getCalendarDisplayTime(item, row.athlete.timezone, new Date()),
                    notes: item.notes,
                  }));

                  return (
                    <div
                      key={`${row.athlete.id}:${dateKey}`}
                      className={cn(
                        'min-w-0 bg-[var(--bg-structure)] p-2',
                        isToday ? 'rounded border-2 border-[var(--today-border)]' : ''
                      )}
                    >
                      <div className="flex flex-col gap-2 min-w-0">
                        {dayItems.map((item) => (
                          <AthleteWeekSessionRow
                            key={item.id}
                            item={item as any}
                            timeZone={row.athlete.timezone}
                            onClick={() => onItemClick(item)}
                          />
                        ))}

                        <button
                          type="button"
                          onClick={() => {
                            // TODO: Open create modal with athleteId + date.
                            alert(`Add session for ${row.athlete.name} on ${dateKey}`);
                          }}
                          className={cn(
                            'w-full rounded border border-dashed border-[var(--border-subtle)]',
                            'bg-[var(--bg-card)] px-2 py-2 text-xs text-[var(--muted)]',
                            'hover:text-[var(--text)] hover:bg-[var(--bg-structure)] transition-colors',
                            'flex items-center justify-center gap-1'
                          )}
                        >
                          <Icon name="add" size="sm" />
                          Add
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </CalendarShell>
  );
}

'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Badge';
import { AthleteWeekSessionRow } from '@/components/athlete/AthleteWeekSessionRow';
import { getCalendarDisplayTime } from '@/components/calendar/getCalendarDisplayTime';
import { toDateInput } from '@/lib/client-date';
import { formatDisplay } from '@/lib/client-date';
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

type MultiAthleteAccordionProps = {
  athleteData: AthleteData[];
  weekDays: string[];
  onItemClick: (item: CalendarItem) => void;
  onRefresh: () => void;
};

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MultiAthleteAccordion({ athleteData, weekDays, onItemClick, onRefresh }: MultiAthleteAccordionProps) {
  const [expandedAthletes, setExpandedAthletes] = useState<Set<string>>(new Set());
  const todayKey = toDateInput(new Date());

  const toggleAthlete = (athleteId: string) => {
    setExpandedAthletes((prev) => {
      const next = new Set(prev);
      if (next.has(athleteId)) {
        next.delete(athleteId);
      } else {
        next.add(athleteId);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
      {athleteData.map((data) => {
        const isExpanded = expandedAthletes.has(data.athlete.id);
        
        // Group items by date
        const itemsByDate = new Map<string, CalendarItem[]>();
        data.items.forEach((item) => {
          const dateStr = item.date.split('T')[0];
          if (!itemsByDate.has(dateStr)) {
            itemsByDate.set(dateStr, []);
          }
          itemsByDate.get(dateStr)!.push(item);
        });

        // Sort items within each day
        itemsByDate.forEach((items) => {
          items.sort((a, b) => {
            if (!a.plannedStartTimeLocal) return 1;
            if (!b.plannedStartTimeLocal) return -1;
            return a.plannedStartTimeLocal.localeCompare(b.plannedStartTimeLocal);
          });
        });

        return (
          <div key={data.athlete.id} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-structure)] overflow-hidden">
            <button
              type="button"
              onClick={() => toggleAthlete(data.athlete.id)}
              className="flex w-full items-center justify-between p-4 text-left hover:bg-[var(--bg-surface)] transition-colors"
            >
              <div className="flex flex-col gap-1">
                <p className="font-medium text-[var(--text)]">{data.athlete.name || data.athlete.id}</p>
                <div className="flex items-center gap-2">
                  <Badge
                    className={cn(
                      'bg-[var(--bg-card)] border border-[var(--border-subtle)]',
                      data.weekStatus === 'PUBLISHED' ? 'text-emerald-700' : 'text-amber-700'
                    )}
                  >
                    {data.weekStatus}
                  </Badge>
                  <span className="text-xs text-[var(--muted)]">{data.items.length} session(s)</span>
                </div>
              </div>
              <Icon name={isExpanded ? "next" : "next"} size="sm" className={isExpanded ? "rotate-90" : ""} />
            </button>

            {isExpanded && (
              <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-structure)] p-2">
                <div className="flex gap-1 overflow-x-auto pb-2">
                  {weekDays.map((date, index) => {
                    const dayItems = itemsByDate.get(date) || [];
                    const isToday = date === todayKey;
                    return (
                      <div key={date} className="flex-shrink-0" style={{ width: '200px' }}>
                        <div
                          className={cn(
                            'min-h-[110px] rounded-2xl bg-[var(--bg-structure)] overflow-hidden',
                            isToday ? 'border-2 border-[var(--today-border)]' : 'border border-[var(--border-subtle)]'
                          )}
                        >
                          <div className="flex items-center justify-between bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{DAY_NAMES[index]}</p>
                              <p className="text-sm font-medium truncate">{formatDisplay(date).split(',')[0].split(' ')[1]}</p>
                            </div>
                            {isToday ? (
                              <span className="bg-blue-500/10 text-blue-700 text-[10px] px-2 py-0.5 rounded-full">Today</span>
                            ) : null}
                          </div>

                          <div className="flex flex-col gap-2 p-2">
                            {dayItems
                              .map((item) => ({
                                ...item,
                                displayTimeLocal: getCalendarDisplayTime(item, data.athlete.timezone, new Date()),
                              }))
                              .map((item) => (
                                <AthleteWeekSessionRow
                                  key={item.id}
                                  item={item as any}
                                  timeZone={data.athlete.timezone}
                                  onClick={() => onItemClick(item)}
                                />
                              ))}

                            <button
                              type="button"
                              onClick={() => {
                                alert(`Add session for ${data.athlete.name} on ${date}`);
                              }}
                              className={cn(
                                'w-full rounded-xl border border-dashed border-[var(--border-subtle)]',
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
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { SessionChip } from './SessionChip';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Badge';

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
  } | null;
  hasAthleteComment?: boolean;
  coachAdvicePresent?: boolean;
};

type AthleteData = {
  athlete: {
    id: string;
    name: string | null;
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
                  <Badge className={data.weekStatus === 'PUBLISHED' ? 'bg-green-500/20 text-green-700' : 'bg-amber-500/20 text-amber-700'}>
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
                    return (
                      <div key={date} className="flex-shrink-0" style={{ width: '200px' }}>
                        <div className="mb-2 text-center text-xs font-semibold uppercase text-[var(--muted)]">
                          {DAY_NAMES[index]}
                        </div>
                        <div className="min-h-[80px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2">
                          {dayItems.map((item) => (
                            <SessionChip
                              key={item.id}
                              time={item.plannedStartTimeLocal}
                              title={item.title}
                              discipline={item.discipline}
                              status={item.status}
                              hasAthleteComment={item.hasAthleteComment}
                              coachAdvicePresent={item.coachAdvicePresent}
                              painFlag={item.latestCompletedActivity?.painFlag ?? false}
                              onClick={() => onItemClick(item)}
                            />
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              alert(`Add session for ${data.athlete.name} on ${date}`);
                            }}
                            className="w-full rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--bg-structure)] px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors flex items-center justify-center gap-1 mt-1"
                          >
                            <Icon name="add" size="sm" />
                            Add
                          </button>
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

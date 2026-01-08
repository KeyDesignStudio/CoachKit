'use client';

import { SessionChip } from './SessionChip';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Badge';
import { formatDisplay } from '@/lib/client-date';

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

type MultiAthleteGridProps = {
  athleteData: AthleteData[];
  weekDays: string[];
  onItemClick: (item: CalendarItem) => void;
  onRefresh: () => void;
};

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MultiAthleteGrid({ athleteData, weekDays, onItemClick, onRefresh }: MultiAthleteGridProps) {
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

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[1200px]">
        {/* Header row */}
        <div className="grid grid-cols-[200px_repeat(7,1fr)] gap-px rounded-t-3xl border border-white/20 bg-white/20 backdrop-blur-3xl">
          <div className="flex items-center justify-between bg-white/40 px-4 py-3">
            <span className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Athlete</span>
          </div>
          {DAY_NAMES.map((day, index) => (
            <div
              key={day}
              className="flex flex-col items-center justify-center bg-white/40 px-2 py-2 text-center"
            >
              <div className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{day}</div>
              <div className="text-xs text-[var(--muted)]">{formatDisplay(weekDays[index]).split(',')[0].split(' ')[1]}</div>
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="rounded-b-3xl border border-t-0 border-white/20 bg-white/20 backdrop-blur-3xl">
          {athleteRows.map((row) => (
            <div key={row.athlete.id} className="grid grid-cols-[200px_repeat(7,1fr)] gap-px border-t border-white/20">
              {/* Athlete name cell */}
              <div className="flex flex-col justify-center gap-1 bg-white/30 px-4 py-3">
                <div className="text-sm font-medium text-[var(--text)] truncate">
                  {row.athlete.name || row.athlete.id}
                </div>
                <Badge className={row.weekStatus === 'PUBLISHED' ? 'bg-green-500/20 text-green-700' : 'bg-amber-500/20 text-amber-700'}>
                  {row.weekStatus}
                </Badge>
              </div>

              {/* Day cells */}
              {weekDays.map((date) => {
                const dayItems = row.itemsByDate.get(date) || [];
                return (
                  <div key={date} className="min-h-[100px] bg-white/30 p-2">
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
                    {/* Quick add button */}
                    <button
                      type="button"
                      onClick={() => {
                        // TODO: Open create modal with athleteId and date
                        alert(`Add session for ${row.athlete.name} on ${date}`);
                      }}
                      className="w-full rounded-lg border border-dashed border-white/30 bg-white/20 px-2 py-1.5 text-xs text-[var(--muted)] hover:border-white/50 hover:bg-white/40 hover:text-[var(--text)] transition-colors flex items-center justify-center gap-1"
                    >
                      <Icon name="add" size="sm" />
                      Add
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

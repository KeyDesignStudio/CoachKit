import { AthleteMonthDayCell } from '@/components/athlete/AthleteMonthDayCell';

type CalendarItem = {
  id: string;
  date: string;
  plannedStartTimeLocal: string | null;
  discipline: string;
  title: string;
  status: string;
  notes?: string | null;
  latestCompletedActivity?: {
    painFlag: boolean;
  } | null;
};

type MonthDayCellProps = {
  date: Date;
  dateStr: string;
  items: CalendarItem[];
  isCurrentMonth: boolean;
  isToday: boolean;
  onDayClick: () => void;
  onItemClick: (item: CalendarItem) => void;
  athleteTimezone?: string;
};

export function MonthDayCell({
  date,
  dateStr,
  items,
  isCurrentMonth,
  isToday,
  onDayClick,
  onItemClick,
  athleteTimezone,
}: MonthDayCellProps) {
  const itemsById = new Map(items.map((item) => [item.id, item] as const));

  return (
    <AthleteMonthDayCell
      date={date}
      dateStr={dateStr}
      items={items.map((item) => ({
        id: item.id,
        date: item.date,
        plannedStartTimeLocal: item.plannedStartTimeLocal,
        displayTimeLocal: item.plannedStartTimeLocal,
        discipline: item.discipline,
        status: item.status,
        title: item.title,
      }))}
      isCurrentMonth={isCurrentMonth}
      isToday={isToday}
      athleteTimezone={athleteTimezone}
      onDayClick={(_dateStr) => onDayClick()}
      onItemClick={(itemId) => {
        const found = itemsById.get(itemId);
        if (found) {
          onItemClick(found);
        }
      }}
    />
  );
}

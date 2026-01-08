import { SessionChip } from './SessionChip';

type CalendarItem = {
  id: string;
  date: string | Date;
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
};

const MAX_VISIBLE_ITEMS = 3;

export function MonthDayCell({
  date,
  items,
  isCurrentMonth,
  isToday,
  onDayClick,
  onItemClick,
}: MonthDayCellProps) {
  const dayNumber = date.getDate();
  const visibleItems = items.slice(0, MAX_VISIBLE_ITEMS);
  const remainingCount = items.length - MAX_VISIBLE_ITEMS;

  return (
    <div
      className={`min-h-[120px] border-r border-b border-white/20 p-2 last:border-r-0 ${
        !isCurrentMonth ? 'bg-white/10' : 'bg-white/30'
      } ${isToday ? 'ring-2 ring-blue-500 ring-inset' : ''}`}
    >
      <button
        onClick={onDayClick}
        className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium hover:bg-white/50 ${
          isToday ? 'bg-blue-500 text-white' : isCurrentMonth ? '' : 'text-[var(--muted)]'
        }`}
      >
        {dayNumber}
      </button>
      
      <div className="space-y-1">
        {visibleItems.map((item) => (
          <SessionChip
            key={item.id}
            time={item.plannedStartTimeLocal}
            title={item.title}
            discipline={item.discipline}
            status={item.status}
            painFlag={item.latestCompletedActivity?.painFlag ?? false}
            onClick={() => onItemClick(item)}
          />
        ))}
        
        {remainingCount > 0 ? (
          <button
            onClick={onDayClick}
            className="w-full rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:bg-white/30"
          >
            +{remainingCount} more
          </button>
        ) : null}
      </div>
    </div>
  );
}

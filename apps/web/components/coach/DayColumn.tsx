import { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';

type DayColumnProps = {
  dayName: string;
  date: string;
  formattedDate: string;
  children: ReactNode;
  onAddClick?: () => void;
  isEmpty: boolean;
  isToday?: boolean;
};

export function DayColumn({ dayName, formattedDate, children, onAddClick, isEmpty, isToday = false }: DayColumnProps) {
  return (
    <>
      {/* Mobile: Full-width card per day */}
      <div className={`flex flex-col md:hidden rounded-2xl border overflow-hidden ${isToday ? 'border-blue-400 bg-blue-50/30' : 'border-white/20 bg-white/40'} backdrop-blur-3xl`}>
        <div className={`px-4 py-3 border-b ${isToday ? 'bg-blue-100/60 border-blue-200' : 'bg-white/60 border-white/20'}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{dayName}</p>
              <p className="text-sm font-medium">{formattedDate}</p>
            </div>
            {isToday && (
              <span className="rounded-full bg-blue-500 px-2 py-1 text-xs font-semibold text-white">
                Today
              </span>
            )}
          </div>
        </div>
        <div className="p-3 space-y-2 min-h-[80px]">
          {children}
          {onAddClick && (
            <Button type="button" variant="ghost" onClick={onAddClick} className="w-full text-sm min-h-[44px]">
              + Add
            </Button>
          )}
          {isEmpty && !onAddClick && (
            <p className="text-center text-sm text-[var(--muted)] py-4">No workouts</p>
          )}
        </div>
      </div>

      {/* Desktop: Column in grid */}
      <div className={`hidden md:flex min-w-0 flex-col border-r border-white/20 last:border-r-0 ${isToday ? 'bg-blue-50/30' : ''}`}>
        <div className={`sticky top-0 z-10 border-b border-white/20 px-3 py-3 backdrop-blur-xl ${isToday ? 'bg-blue-100/60' : 'bg-white/60'}`}>
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{dayName}</p>
            {isToday && (
              <span className="rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                Today
              </span>
            )}
          </div>
          <p className="text-sm font-medium">{formattedDate}</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2" style={{ maxHeight: 'calc(100vh - 280px)' }}>
          {children}
          {onAddClick && (
            isEmpty ? (
              <Button type="button" variant="ghost" onClick={onAddClick} className="w-full text-sm">
                + Add
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={onAddClick} className="w-full text-xs opacity-60 hover:opacity-100">
                + Add
              </Button>
            )
          )}
        </div>
      </div>
    </>
  );
}

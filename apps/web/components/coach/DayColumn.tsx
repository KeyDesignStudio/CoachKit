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
      <div
        className={`flex flex-col md:hidden rounded-2xl border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-structure)] ${
          isToday ? 'ring-2 ring-blue-500/40 ring-inset' : ''
        }`}
      >
        <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{dayName}</p>
              <p className="text-sm font-medium">{formattedDate}</p>
            </div>
            {isToday && (
              <span className="bg-blue-500/10 text-blue-700 text-[10px] px-2 py-0.5 rounded-full">Today</span>
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
      <div
        className={`hidden md:flex min-w-0 flex-col rounded-2xl border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-structure)] ${
          isToday ? 'ring-2 ring-blue-500/40 ring-inset' : ''
        }`}
      >
        <div className="sticky top-0 z-10 border-b border-[var(--border-subtle)] px-3 py-2 bg-[var(--bg-surface)]">
          <div className="flex items-center gap-2">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{dayName}</p>
            {isToday && (
              <span className="bg-blue-500/10 text-blue-700 text-[10px] px-2 py-0.5 rounded-full">Today</span>
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

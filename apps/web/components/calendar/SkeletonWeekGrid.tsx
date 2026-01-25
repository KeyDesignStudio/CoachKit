import { SkeletonPill } from '@/components/calendar/SkeletonPill';
import { cn } from '@/lib/cn';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function SkeletonWeekGrid({
  className,
  pillsPerDay = 3,
  showSummaryColumn = false,
}: {
  className?: string;
  pillsPerDay?: number;
  showSummaryColumn?: boolean;
}) {
  const dayNames = showSummaryColumn ? [...DAY_NAMES, 'Summary'] : DAY_NAMES;
  return (
    <div className={cn(`grid ${showSummaryColumn ? 'grid-cols-8' : 'grid-cols-7'} gap-2`, className)} aria-hidden="true">
      {dayNames.map((day) => (
        <div
          key={day}
          className="flex min-h-[420px] flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2"
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{day}</div>
            <div className="h-4 w-8 rounded bg-[var(--bg-card)] animate-pulse" />
          </div>

          <div className="mt-1 flex flex-col gap-2">
            {Array.from({ length: pillsPerDay }).map((_, idx) => (
              <SkeletonPill
                key={idx}
                className={cn(
                  idx % 3 === 0 ? 'w-[85%]' : idx % 3 === 1 ? 'w-[70%]' : 'w-[92%]'
                )}
              />
            ))}
            <SkeletonPill className="w-[55%] opacity-70" />
          </div>
        </div>
      ))}
    </div>
  );
}

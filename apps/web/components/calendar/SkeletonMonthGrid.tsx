import { SkeletonPill } from '@/components/calendar/SkeletonPill';
import { cn } from '@/lib/cn';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function SkeletonMonthGrid({
  className,
  showSummaryColumn = false,
}: {
  className?: string;
  showSummaryColumn?: boolean;
}) {
  const dayNames = showSummaryColumn ? [...DAY_NAMES, 'Summary'] : DAY_NAMES;
  return (
    <div
      className={cn(
        `grid ${showSummaryColumn ? 'grid-cols-7 md:grid-cols-8' : 'grid-cols-7'} gap-px bg-[var(--border-subtle)]`,
        className
      )}
      aria-hidden="true"
    >
      {dayNames.map((day) => (
        <div key={day} className={cn('bg-[var(--bg-structure)] px-2 py-2', day === 'Summary' ? 'hidden md:block' : '')}>
          <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{day}</div>
        </div>
      ))}

      {Array.from({ length: 42 + (showSummaryColumn ? 6 : 0) }).map((_, idx) => (
        <div
          key={idx}
          className={cn('min-h-[110px] bg-[var(--bg-surface)] p-2', showSummaryColumn && idx >= 42 ? 'hidden md:block' : '')}
        >
          <div className="flex items-center justify-between">
            <div className="h-4 w-6 rounded bg-[var(--bg-card)] animate-pulse" />
            <div className="h-4 w-4 rounded-full bg-[var(--bg-card)] animate-pulse" />
          </div>
          <div className="mt-2 flex flex-col gap-2">
            <SkeletonPill className="h-5 w-[92%]" />
            <SkeletonPill className="h-5 w-[70%]" />
          </div>
        </div>
      ))}
    </div>
  );
}

import { SkeletonPill } from '@/components/calendar/SkeletonPill';
import { cn } from '@/lib/cn';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function SkeletonMonthGrid({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-7 gap-px bg-[var(--border-subtle)]', className)} aria-hidden="true">
      {DAY_NAMES.map((day) => (
        <div key={day} className="bg-[var(--bg-structure)] px-2 py-2">
          <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{day}</div>
        </div>
      ))}

      {Array.from({ length: 42 }).map((_, idx) => (
        <div key={idx} className="min-h-[110px] bg-[var(--bg-surface)] p-2">
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

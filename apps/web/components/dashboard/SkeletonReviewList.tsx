import { cn } from '@/lib/cn';

function SkeletonLine({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('h-3 rounded bg-[var(--bg-card)] animate-pulse', className)} />;
}

export function SkeletonReviewList({ className, rows = 8 }: { className?: string; rows?: number }) {
  return (
    <div className={cn('space-y-6', className)} aria-hidden="true">
      {['Today', 'Yesterday', 'Earlier'].map((label) => (
        <section key={label}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <SkeletonLine className="w-32" />
            <SkeletonLine className="w-24" />
          </div>

          <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
            <div className="divide-y divide-[var(--border-subtle)]">
              {Array.from({ length: rows }).map((_, idx) => (
                <div key={idx} className="flex items-center gap-3 px-4 py-3">
                  <div className="h-4 w-4 rounded bg-[var(--bg-card)] animate-pulse" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <SkeletonLine className={cn('w-[70%]', idx % 3 === 0 ? 'w-[82%]' : idx % 3 === 1 ? 'w-[68%]' : 'w-[74%]')} />
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-14 rounded-full bg-[var(--bg-card)] animate-pulse" />
                      <div className="h-4 w-20 rounded-full bg-[var(--bg-card)] animate-pulse" />
                      <div className="h-4 w-12 rounded-full bg-[var(--bg-card)] animate-pulse" />
                    </div>
                  </div>
                  <div className="h-6 w-16 rounded-full bg-[var(--bg-card)] animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

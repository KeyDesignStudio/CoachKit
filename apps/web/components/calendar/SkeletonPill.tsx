import { cn } from '@/lib/cn';

export function SkeletonPill({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'h-6 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)]',
        'animate-pulse',
        className
      )}
    />
  );
}

import { cn } from '@/lib/cn';
import type { GoalCountdown } from '@/lib/goal-countdown';

type GoalCountdownCalloutProps = {
  goal: GoalCountdown | null | undefined;
  variant?: 'hero' | 'ribbon' | 'chip';
  athleteName?: string | null;
  className?: string;
};

function getTone(goal: GoalCountdown) {
  if (goal.mode === 'race-day') return 'ring-2 ring-amber-500/70 bg-gradient-to-r from-amber-100 via-orange-50 to-emerald-50';
  if (goal.mode === 'daily') return 'ring-1 ring-orange-300/70 bg-gradient-to-r from-orange-50 via-amber-50 to-teal-50';
  if (goal.mode === 'weekly') return 'ring-1 ring-teal-300/70 bg-gradient-to-r from-teal-50 via-sky-50 to-emerald-50';
  if (goal.mode === 'past') return 'ring-1 ring-slate-300/80 bg-gradient-to-r from-slate-100 via-slate-50 to-zinc-100';
  return 'ring-1 ring-[var(--border-subtle)] bg-[var(--bg-surface)]';
}

function formatEventDate(value: string): string {
  const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = value.match(isoDateOnly);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month, day)));
  }

  const asDate = new Date(value);
  if (Number.isNaN(asDate.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(asDate);
}

export function GoalCountdownCallout({ goal, variant = 'hero', athleteName, className }: GoalCountdownCalloutProps) {
  if (!goal || goal.mode === 'none' || !goal.eventDate) return null;

  const title = goal.eventName || 'Goal event';
  const eventDateLabel = formatEventDate(goal.eventDate);
  const who = athleteName ? `${athleteName} · ` : '';
  const showProgress = typeof goal.weeksTotal === 'number' && goal.weeksTotal > 0 && typeof goal.weeksElapsed === 'number';
  const progressPct = Math.max(0, Math.min(100, goal.progressPct ?? 0));

  if (variant === 'chip') {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-medium tabular-nums text-[var(--text)]',
          getTone(goal),
          className
        )}
      >
        <span className="truncate max-w-[140px]">{title}</span>
        <span className="opacity-80">•</span>
        <span>{goal.shortLabel}</span>
      </div>
    );
  }

  if (variant === 'ribbon') {
    return (
      <div className={cn('rounded-2xl px-4 py-3 text-[var(--text)]', getTone(goal), className)}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{who}goal focus</span>
          <span className="rounded-md bg-teal-100 px-2 py-0.5 text-sm font-semibold text-teal-900">{title}</span>
          <span className="text-xs text-[var(--muted)]">{eventDateLabel}</span>
          <span className="ml-auto text-sm font-semibold tabular-nums">{goal.label}</span>
        </div>
        {showProgress ? (
          <div className="mt-2">
            <div className="mb-1 text-[11px] text-[var(--muted)]">Progress</div>
            <div className="h-1.5 overflow-hidden rounded-full bg-black/10">
              <div className="h-full rounded-full bg-orange-500/70" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn('rounded-2xl px-4 py-4 text-[var(--text)]', getTone(goal), className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{who}goal focus</div>
          <div className="mt-1 inline-flex rounded-md bg-teal-100 px-2 py-0.5 text-base font-semibold text-teal-900">{title}</div>
          <div className="mt-1 text-xs text-[var(--muted)]">{eventDateLabel}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold leading-none tabular-nums">{goal.shortLabel}</div>
          <div className="mt-1 text-xs text-[var(--muted)]">{goal.label}</div>
        </div>
      </div>
      {showProgress ? (
        <div className="mt-3">
          <div className="mb-1 text-[11px] text-[var(--muted)]">Progress</div>
          <div className="h-2 overflow-hidden rounded-full bg-black/10">
            <div className="h-full rounded-full bg-orange-500/70" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

import { cn } from '@/lib/cn';
import type { GoalCountdown } from '@/lib/goal-countdown';

type GoalCountdownCalloutProps = {
  goal: GoalCountdown | null | undefined;
  variant?: 'hero' | 'ribbon' | 'chip';
  athleteName?: string | null;
  className?: string;
  showShortLabel?: boolean;
};

function getTone(goal: GoalCountdown) {
  if (goal.mode === 'race-day') return 'border-amber-400/75 bg-[var(--feature-surface)]';
  if (goal.mode === 'past') return 'border-[var(--border-subtle)] bg-[var(--bg-structure)]';
  return 'border-[var(--feature-border)] bg-[var(--feature-surface)]';
}

function resolveProgressPct(goal: GoalCountdown): number {
  const raw = Number(goal.progressPct);
  if (Number.isFinite(raw)) return Math.max(0, Math.min(100, raw));

  const total = Number(goal.weeksTotal);
  const elapsed = Number(goal.weeksElapsed);
  if (!Number.isFinite(total) || !Number.isFinite(elapsed) || total <= 0) return 0;
  return Math.max(0, Math.min(100, (elapsed / total) * 100));
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

export function GoalCountdownCallout({ goal, variant = 'hero', athleteName, className, showShortLabel = true }: GoalCountdownCalloutProps) {
  if (!goal || goal.mode === 'none' || !goal.eventDate) return null;

  const title = goal.eventName || 'Goal event';
  const eventDateLabel = formatEventDate(goal.eventDate);
  const who = athleteName ? `${athleteName} · ` : '';
  const showProgress = typeof goal.weeksTotal === 'number' && goal.weeksTotal > 0 && typeof goal.weeksElapsed === 'number';
  const progressPct = resolveProgressPct(goal);
  const visibleProgressPct = progressPct > 0 ? Math.max(4, progressPct) : 0;
  const progressLabel = `${Math.round(progressPct)}%`;

  if (variant === 'chip') {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-2 rounded-full border border-[var(--feature-border)] bg-[var(--feature-surface)] px-2.5 py-1 text-[11px] font-medium tabular-nums text-[var(--text)]',
          getTone(goal),
          className
        )}
      >
        <span className="md:truncate max-w-[140px]">{title}</span>
        <span className="opacity-80">•</span>
        <span>{goal.shortLabel}</span>
      </div>
    );
  }

  if (variant === 'ribbon') {
    return (
      <div className={cn('rounded-2xl border border-l-4 border-l-[var(--feature-accent)] px-4 py-3 text-[var(--text)] shadow-[0_6px_16px_var(--feature-shadow)]', getTone(goal), className)}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[11px] uppercase tracking-wide text-[var(--feature-muted)]">{who}goal focus</span>
          <span className="rounded-md border border-[var(--feature-pill-border)] bg-[var(--feature-pill-bg)] px-2 py-0.5 text-sm font-semibold text-[var(--feature-pill-text)]">
            {title}
          </span>
          <span className="text-xs text-[var(--feature-muted)]">{eventDateLabel}</span>
          <span className="ml-auto inline-flex rounded-full border border-[var(--feature-pill-border)] bg-[var(--feature-pill-bg)] px-2 py-0.5 text-sm font-semibold tabular-nums text-[var(--feature-pill-text)]">
            {goal.label}
          </span>
        </div>
        {showProgress ? (
          <div className="mt-2">
            <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--feature-muted)]">
              <span>Progress</span>
              <span className="tabular-nums text-[var(--feature-pill-text)]">{progressLabel}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bar-track)]">
              <div className="h-full rounded-full bg-[var(--feature-progress-fill)]" style={{ width: `${visibleProgressPct}%` }} />
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-2xl border border-l-4 border-l-[var(--feature-accent)] px-4 py-4 text-[var(--text)] shadow-[0_6px_16px_var(--feature-shadow)]',
        getTone(goal),
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-[var(--feature-muted)]">{who}goal focus</div>
          <div className="mt-1 inline-flex rounded-md border border-[var(--feature-pill-border)] bg-[var(--feature-pill-bg)] px-2.5 py-1 text-base font-semibold text-[var(--feature-pill-text)]">
            {title}
          </div>
          <div className="mt-1 text-xs text-[var(--feature-muted)]">{eventDateLabel}</div>
        </div>
        <div className="text-right">
          {showShortLabel ? <div className="text-lg font-semibold leading-none tabular-nums">{goal.shortLabel}</div> : null}
          <div
            className={cn(
              'inline-flex rounded-full border border-[var(--feature-pill-border)] bg-[var(--feature-pill-bg)] px-2 py-0.5 text-xs font-semibold tabular-nums text-[var(--feature-pill-text)]',
              showShortLabel ? 'mt-1' : 'text-sm'
            )}
          >
            {goal.label}
          </div>
        </div>
      </div>
      {showProgress ? (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--feature-muted)]">
            <span>Progress</span>
            <span className="tabular-nums text-[var(--feature-pill-text)]">{progressLabel}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--bar-track)]">
            <div className="h-full rounded-full bg-[var(--feature-progress-fill)]" style={{ width: `${visibleProgressPct}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

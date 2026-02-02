import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import type { IconName } from '@/components/ui/iconRegistry';
import { isPastEndOfLocalDay } from '@/lib/timezones';

export type SessionStatusVisual = {
  icon: IconName;
  overlay: IconName | null;
  iconColor: string;
  backgroundTint: string | null;
};

export type SessionLike = {
  id?: string;
  discipline: string;
  status: string;
  date: string | Date;
};

export type SessionStatusVisualWithId = SessionStatusVisual & {
  id?: string;
};

export type DayVisualSummary = {
  dayTint: string | null;
  tooltip: string | null;
  sessions: SessionStatusVisualWithId[];
};

function toIsoDateKey(value: string | Date): string {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value.includes('T')) return value.split('T')[0];
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return value;
}

type StatusVisualOptions = {
  now?: Date;
  timeZone?: string;
};

export function getSessionStatusVisual(session: SessionLike, options: StatusVisualOptions = {}): SessionStatusVisual {
  const theme = getDisciplineTheme(session.discipline as any);
  const icon = theme.iconName;

  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? 'Australia/Brisbane';
  const dateKey = toIsoDateKey(session.date);
  const ended = isPastEndOfLocalDay(dateKey, timeZone, now);

  // REST (explicit only): represented by an explicit planned REST item.
  if (session.discipline === 'REST') {
    return {
      icon,
      overlay: null,
      iconColor: 'text-slate-500',
      backgroundTint: 'bg-slate-500/5',
    };
  }

  if (session.status === 'COMPLETED_SYNCED_DRAFT') {
    return {
      icon,
      overlay: 'needsReview',
      iconColor: 'text-amber-600',
      backgroundTint: 'bg-amber-500/5',
    };
  }

  if (session.status === 'COMPLETED_SYNCED' || session.status === 'COMPLETED_MANUAL') {
    return {
      icon,
      overlay: 'completed',
      iconColor: 'text-emerald-600',
      backgroundTint: 'bg-emerald-500/5',
    };
  }

  // SKIPPED counts as a missed accountability outcome.
  if (session.status === 'SKIPPED') {
    return {
      icon,
      overlay: 'skipped',
      iconColor: 'text-[var(--muted)]',
      backgroundTint: 'bg-slate-500/5',
    };
  }

  // MISSED: only after day end.
  if (session.status === 'PLANNED' && ended) {
    return {
      icon,
      overlay: 'missed',
      iconColor: 'text-amber-700/70',
      backgroundTint: 'bg-amber-500/5',
    };
  }

  // PLANNED (upcoming)
  return {
    icon,
    overlay: 'planned',
    iconColor: 'text-slate-500',
    backgroundTint: null,
  };
}

function pickDayTint(visuals: SessionStatusVisual[]): string | null {
  // Priority: MISSED > DRAFT > SUBMITTED > REST
  if (visuals.some((v) => v.overlay === 'missed' && v.backgroundTint)) return 'bg-amber-500/5';
  if (visuals.some((v) => v.overlay === 'skipped' && v.backgroundTint)) return 'bg-slate-500/5';
  if (visuals.some((v) => v.overlay === 'needsReview' && v.backgroundTint)) return 'bg-amber-500/5';
  if (visuals.some((v) => v.overlay === 'completed' && v.backgroundTint)) return 'bg-emerald-500/5';
  if (visuals.some((v) => v.icon === 'disciplineRest' && v.backgroundTint)) return 'bg-slate-500/5';
  return null;
}

function buildTooltip(params: {
  planned: number;
  completed: number;
  draft: number;
  missed: number;
  rest: number;
}) {
  const { planned, completed, draft, missed, rest } = params;

  const parts: string[] = [];
  if (planned) parts.push(`${planned} planned`);
  if (completed) parts.push(`${completed} completed`);
  if (draft) parts.push(`${draft} draft`);
  if (missed) parts.push(`${missed} missed`);
  if (rest) parts.push(`${rest} rest`);

  return parts.length ? parts.join(' • ') : null;
}

export function getDayVisualSummary(items: SessionLike[], options: StatusVisualOptions = {}): DayVisualSummary {
  const sessions = items.map((item) => ({ ...getSessionStatusVisual(item, options), id: item.id }));

  let planned = 0;
  let completed = 0;
  let draft = 0;
  let missed = 0;
  let rest = 0;

  for (const v of sessions) {
    if (v.icon === 'disciplineRest') {
      rest += 1;
      continue;
    }

    if (v.overlay === 'needsReview') {
      draft += 1;
      continue;
    }

    if (v.overlay === 'completed') {
      completed += 1;
      continue;
    }

    if (v.overlay === 'missed' || v.overlay === 'skipped') {
      missed += 1;
      continue;
    }

    planned += 1;
  }

  return {
    dayTint: pickDayTint(sessions),
    tooltip: buildTooltip({ planned, completed, draft, missed, rest }),
    sessions,
  };
}

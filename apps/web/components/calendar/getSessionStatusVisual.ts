import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import type { IconName } from '@/components/ui/iconRegistry';

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

function parseDate(value: string | Date): Date {
  if (value instanceof Date) return value;

  // Important: date-only strings like "2026-01-11" are parsed as UTC by JS,
  // which can shift the day in local timezones. Treat them as local dates.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map((part) => Number(part));
    return new Date(y, m - 1, d);
  }

  return new Date(value);
}

function isDayEnded(sessionDate: Date, now: Date) {
  const dayEnd = new Date(sessionDate);
  // Use local day boundaries (not UTC) so "missed" doesn't appear early.
  dayEnd.setHours(0, 0, 0, 0);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return now.getTime() >= dayEnd.getTime();
}

export function getSessionStatusVisual(session: SessionLike, now: Date = new Date()): SessionStatusVisual {
  const theme = getDisciplineTheme(session.discipline as any);
  const icon = theme.iconName;

  const sessionDate = parseDate(session.date);
  const ended = isDayEnded(sessionDate, now);

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
  if ((session.status === 'PLANNED' || session.status === 'MODIFIED') && ended) {
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
    overlay: null,
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

export function getDayVisualSummary(items: SessionLike[], now: Date = new Date()): DayVisualSummary {
  const sessions = items.map((item) => ({ ...getSessionStatusVisual(item, now), id: item.id }));

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

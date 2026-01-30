import type { Prisma } from '@prisma/client';

export function buildDraftPlanJsonV1(params: {
  setupJson: unknown;
  weeks: Array<{ weekIndex: number; locked: boolean }>;
  sessions: Array<{
    weekIndex: number;
    ordinal: number;
    dayOfWeek: number;
    discipline: string;
    type: string;
    durationMinutes: number;
    notes: string | null;
    locked: boolean;
  }>;
}): Prisma.InputJsonValue {
  const weeksSorted = params.weeks
    .slice()
    .sort((a, b) => a.weekIndex - b.weekIndex)
    .map((w) => ({ weekIndex: w.weekIndex, locked: w.locked }));

  const sessionsSorted = params.sessions
    .slice()
    .sort((a, b) => a.weekIndex - b.weekIndex || a.ordinal - b.ordinal)
    .map((s) => ({
      weekIndex: s.weekIndex,
      ordinal: s.ordinal,
      dayOfWeek: s.dayOfWeek,
      discipline: s.discipline,
      type: s.type,
      durationMinutes: s.durationMinutes,
      notes: s.notes ?? null,
      locked: s.locked,
    }));

  const sessionsByWeek = new Map<number, any[]>();
  for (const s of sessionsSorted) {
    if (!sessionsByWeek.has(s.weekIndex)) sessionsByWeek.set(s.weekIndex, []);
    sessionsByWeek.get(s.weekIndex)!.push(s);
  }

  return {
    version: 'v1',
    setup: params.setupJson as Prisma.InputJsonValue,
    weeks: weeksSorted.map((w) => ({
      weekIndex: w.weekIndex,
      locked: w.locked,
      sessions: sessionsByWeek.get(w.weekIndex) ?? [],
    })),
  } as Prisma.InputJsonValue;
}

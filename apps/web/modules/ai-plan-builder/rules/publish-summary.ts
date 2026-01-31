import { z } from 'zod';

const planSessionSchema = z
  .object({
    weekIndex: z.number().int().min(0).max(52).optional(),
    ordinal: z.number().int().min(0).max(99),
    type: z.string().min(1),
    durationMinutes: z.number().int().min(0).max(10_000),
    notes: z.string().nullable().optional(),
  })
  .passthrough();

const planWeekSchema = z
  .object({
    weekIndex: z.number().int().min(0).max(52),
    sessions: z.array(planSessionSchema),
  })
  .passthrough();

const planSchema = z
  .object({
    weeks: z.array(planWeekSchema),
  })
  .passthrough();

type FlattenedSession = {
  key: string;
  weekIndex: number;
  ordinal: number;
  type: string;
  durationMinutes: number;
};

function flatten(planJson: unknown): { sessions: FlattenedSession[]; weekTotals: Map<number, number> } {
  const parsed = planSchema.safeParse(planJson);
  if (!parsed.success) {
    return { sessions: [], weekTotals: new Map() };
  }

  const sessions: FlattenedSession[] = [];
  const weekTotals = new Map<number, number>();

  for (const w of parsed.data.weeks) {
    let total = 0;
    for (const s of w.sessions) {
      const key = `${w.weekIndex}:${s.ordinal}`;
      sessions.push({
        key,
        weekIndex: w.weekIndex,
        ordinal: s.ordinal,
        type: String(s.type),
        durationMinutes: Number(s.durationMinutes),
      });
      total += Number(s.durationMinutes ?? 0);
    }
    weekTotals.set(w.weekIndex, total);
  }

  sessions.sort((a, b) => (a.weekIndex - b.weekIndex) || (a.ordinal - b.ordinal));
  return { sessions, weekTotals };
}

function formatPct(delta: number): string {
  const pct = Math.round(delta * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

/**
 * Deterministic, concise summary of changes between planJson snapshots.
 * Returns a human-readable string with up to ~5 bullet lines.
 */
export function summarizePlanChanges(prevPlanJson: unknown, nextPlanJson: unknown): string {
  const prev = flatten(prevPlanJson);
  const next = flatten(nextPlanJson);

  const prevByKey = new Map(prev.sessions.map((s) => [s.key, s] as const));
  const nextByKey = new Map(next.sessions.map((s) => [s.key, s] as const));

  let durationChanges = 0;
  let typeChanges = 0;
  let added = 0;
  let removed = 0;

  const exampleTypeChanges: Array<{ key: string; from: string; to: string }> = [];

  const allKeys = Array.from(new Set([...prevByKey.keys(), ...nextByKey.keys()])).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  for (const key of allKeys) {
    const p = prevByKey.get(key);
    const n = nextByKey.get(key);
    if (!p && n) {
      added++;
      continue;
    }
    if (p && !n) {
      removed++;
      continue;
    }
    if (!p || !n) continue;

    if (p.durationMinutes !== n.durationMinutes) durationChanges++;
    if (p.type !== n.type) {
      typeChanges++;
      if (exampleTypeChanges.length < 1) {
        exampleTypeChanges.push({ key, from: p.type, to: n.type });
      }
    }
  }

  const weekChanges: Array<{ weekIndex: number; from: number; to: number; pctDelta: number }> = [];
  const allWeeks = Array.from(new Set([...prev.weekTotals.keys(), ...next.weekTotals.keys()])).sort((a, b) => a - b);
  for (const w of allWeeks) {
    const from = prev.weekTotals.get(w) ?? 0;
    const to = next.weekTotals.get(w) ?? 0;
    if (from === to) continue;
    const pctDelta = from === 0 ? (to === 0 ? 0 : 1) : (to - from) / from;
    weekChanges.push({ weekIndex: w, from, to, pctDelta });
  }

  if (!durationChanges && !typeChanges && !added && !removed && weekChanges.length === 0) {
    return 'No changes';
  }

  const lines: string[] = [];

  if (durationChanges) {
    lines.push(`- ${durationChanges} sessions updated (duration changes)`);
  }

  if (typeChanges) {
    const example = exampleTypeChanges[0];
    lines.push(
      `- ${typeChanges} session type ${typeChanges === 1 ? 'changed' : 'changes'}${example ? ` (${example.from} → ${example.to})` : ''}`
    );
  }

  if (added) {
    lines.push(`- ${added} sessions added`);
  }

  if (removed) {
    lines.push(`- ${removed} sessions removed`);
  }

  if (weekChanges.length) {
    const biggest = [...weekChanges].sort((a, b) => Math.abs(b.pctDelta) - Math.abs(a.pctDelta) || a.weekIndex - b.weekIndex)[0];
    lines.push(`- Week ${biggest.weekIndex + 1} total volume ${formatPct(biggest.pctDelta)}`);
  }

  return lines.slice(0, 5).join('\n');
}

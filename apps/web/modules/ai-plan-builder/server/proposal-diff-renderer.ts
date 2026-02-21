import { planDiffSchema, type PlanDiffOp } from './adaptation-diff';

export type DiffViewModel = {
  summary: {
    sessionsChangedCount: number;
    totalMinutesDelta: number;
    intensitySessionsDelta: number | null;
  };
  weeks: Array<{
    weekIndex: number;
    beforeTotalMinutes: number;
    afterTotalMinutes: number;
    items: Array<{
      kind: 'session' | 'week' | 'unknown';
      text: string;
    }>;
  }>;
};

type DraftPlanJsonV1 = {
  version: 'v1';
  weeks: Array<{
    weekIndex: number;
    locked: boolean;
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
  }>;
};

type DraftSessionSnapshot = {
  id: string;
  weekIndex: number;
  ordinal: number;
  dayOfWeek: number;
  discipline: string;
  type: string;
  durationMinutes: number;
  locked: boolean;
};

function isIntensityType(type: string) {
  const t = String(type || '').toLowerCase();
  return t === 'tempo' || t === 'threshold';
}

function dayName(dayOfWeek: number) {
  // Keep this stable; dayOfWeek is stored as number.
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const idx = Number.isFinite(dayOfWeek) ? dayOfWeek : 0;
  return names[idx] ?? `Day${idx}`;
}

function titleCase(s: string) {
  const t = String(s || '').trim();
  if (!t) return '—';
  return t[0]!.toUpperCase() + t.slice(1);
}

function formatSessionLabel(s: { dayOfWeek: number; discipline: string }) {
  return `${dayName(s.dayOfWeek)} ${titleCase(s.discipline)}`;
}

function minutesText(m: number) {
  const n = Number.isFinite(m) ? Math.max(0, Math.round(m)) : 0;
  return `${n} min`;
}

function safeParseDraftPlanJsonV1(input: unknown): DraftPlanJsonV1 {
  const v = input as any;
  if (!v || v.version !== 'v1' || !Array.isArray(v.weeks)) {
    throw new Error('Invalid draftPlanJson (expected version=v1 with weeks).');
  }
  return v as DraftPlanJsonV1;
}

function computeWeekMinutes(week: DraftPlanJsonV1['weeks'][number]) {
  return (week.sessions ?? []).reduce((sum, s) => sum + (Number(s.durationMinutes ?? 0) || 0), 0);
}

function cloneDraft(draft: DraftPlanJsonV1): DraftPlanJsonV1 {
  return {
    version: 'v1',
    weeks: draft.weeks.map((w) => ({
      weekIndex: w.weekIndex,
      locked: Boolean(w.locked),
      sessions: (w.sessions ?? []).map((s) => ({ ...s, notes: s.notes ?? null })),
    })),
  };
}

function appendNote(existing: string | null | undefined, text: string) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return existing ?? null;
  if (!existing) return trimmed;
  return `${existing}\n\n${trimmed}`;
}

export function renderProposalDiff(
  proposal: {
    id: string;
    diffJson: unknown;
    // Optional: pass a snapshot of the current draft sessions so we can resolve draftSessionId.
    // This keeps the renderer deterministic with no DB reads.
    draftSessions?: DraftSessionSnapshot[];
  },
  draftPlanJson: unknown
): DiffViewModel {
  const parsedDiff = planDiffSchema.safeParse(proposal.diffJson ?? null);
  if (!parsedDiff.success) {
    throw new Error('Invalid proposal diffJson.');
  }
  const diff = parsedDiff.data;

  const before = safeParseDraftPlanJsonV1(draftPlanJson);
  const after = cloneDraft(before);

  const sessionsById = new Map<string, DraftSessionSnapshot>();
  for (const s of proposal.draftSessions ?? []) {
    if (!s?.id) continue;
    sessionsById.set(String(s.id), {
      id: String(s.id),
      weekIndex: Number(s.weekIndex ?? 0),
      ordinal: Number(s.ordinal ?? 0),
      dayOfWeek: Number(s.dayOfWeek ?? 0),
      discipline: String(s.discipline ?? ''),
      type: String(s.type ?? ''),
      durationMinutes: Number(s.durationMinutes ?? 0),
      locked: Boolean(s.locked),
    });
  }

  const weekByIndex = new Map<number, DraftPlanJsonV1['weeks'][number]>();
  for (const w of after.weeks) {
    weekByIndex.set(w.weekIndex, w);
  }

  const unknownOps: Array<{ op: PlanDiffOp; text: string; weekIndex: number | null }> = [];
  const weekNotes: Array<{ weekIndex: number; text: string }> = [];

  // Track per-session before/after for summarization.
  type SessionKey = `${number}:${number}`; // weekIndex:ordinal
  const touchedSessions = new Set<SessionKey>();
  const beforeSessionState = new Map<SessionKey, { type: string; durationMinutes: number; discipline: string; dayOfWeek: number }>();
  const afterSessionState = new Map<SessionKey, { type: string; durationMinutes: number; discipline: string; dayOfWeek: number }>();
  const sessionNotesAdded = new Map<SessionKey, string[]>();
  const weekVolumeOpsByWeek = new Map<number, number[]>();

  const findSessionInWeek = (weekIndex: number, ordinal: number) => {
    const week = weekByIndex.get(weekIndex);
    if (!week) return null;
    const list = week.sessions ?? [];
    return list.find((s) => Number(s.ordinal ?? -1) === ordinal) ?? null;
  };

  const recordBefore = (key: SessionKey, snapshot: DraftSessionSnapshot) => {
    if (beforeSessionState.has(key)) return;
    beforeSessionState.set(key, {
      type: String(snapshot.type ?? ''),
      durationMinutes: Number(snapshot.durationMinutes ?? 0),
      discipline: String(snapshot.discipline ?? ''),
      dayOfWeek: Number(snapshot.dayOfWeek ?? 0),
    });
  };

  const recordAfter = (key: SessionKey) => {
    const [weekIndexStr, ordinalStr] = key.split(':');
    const weekIndex = Number(weekIndexStr);
    const ordinal = Number(ordinalStr);
    const s = findSessionInWeek(weekIndex, ordinal);
    if (!s) return;
    afterSessionState.set(key, {
      type: String(s.type ?? ''),
      durationMinutes: Number(s.durationMinutes ?? 0),
      discipline: String(s.discipline ?? ''),
      dayOfWeek: Number(s.dayOfWeek ?? 0),
    });
  };

  // Apply ops in order (deterministically, matching server apply behavior as closely as possible).
  for (const op of diff) {
    if (op.op === 'ADJUST_WEEK_VOLUME') {
      const week = weekByIndex.get(op.weekIndex);
      if (!week) {
        unknownOps.push({ op, text: `Unknown weekIndex=${op.weekIndex} (cannot adjust volume).`, weekIndex: null });
        continue;
      }

      if (!weekVolumeOpsByWeek.has(op.weekIndex)) weekVolumeOpsByWeek.set(op.weekIndex, []);
      weekVolumeOpsByWeek.get(op.weekIndex)!.push(op.pctDelta);

      const factor = 1 + op.pctDelta;
      const sessions = (week.sessions ?? []).slice().sort((a, b) => a.ordinal - b.ordinal);
      for (const s of sessions) {
        if (s.locked) continue;
        const next = Math.max(0, Math.round(Number(s.durationMinutes ?? 0) * factor));
        s.durationMinutes = next;
        touchedSessions.add(`${week.weekIndex}:${Number(s.ordinal ?? 0)}`);
      }
      continue;
    }

    if (op.op === 'ADD_NOTE' && op.target === 'week') {
      const week = weekByIndex.get(op.weekIndex);
      if (!week) {
        unknownOps.push({ op, text: `Unknown weekIndex=${op.weekIndex} (cannot add week note).`, weekIndex: null });
        continue;
      }
      weekNotes.push({ weekIndex: week.weekIndex, text: String(op.text) });

      const sessions = (week.sessions ?? []).slice().sort((a, b) => a.ordinal - b.ordinal);
      for (const s of sessions) {
        if (s.locked) continue;
        s.notes = appendNote(s.notes, op.text);
        touchedSessions.add(`${week.weekIndex}:${Number(s.ordinal ?? 0)}`);
      }
      continue;
    }

    if (op.op === 'ADD_NOTE' && op.target === 'session') {
      const snapshot = sessionsById.get(String(op.draftSessionId));
      if (!snapshot) {
        unknownOps.push({ op, text: `Unknown sessionId=${String(op.draftSessionId)} (cannot add note).`, weekIndex: null });
        continue;
      }
      const key: SessionKey = `${snapshot.weekIndex}:${snapshot.ordinal}`;
      recordBefore(key, snapshot);
      const s = findSessionInWeek(snapshot.weekIndex, snapshot.ordinal);
      if (!s) {
        unknownOps.push({ op, text: `Unknown session key week=${snapshot.weekIndex} ordinal=${snapshot.ordinal} (cannot add note).`, weekIndex: snapshot.weekIndex });
        continue;
      }
      s.notes = appendNote(s.notes, op.text);
      touchedSessions.add(key);
      if (!sessionNotesAdded.has(key)) sessionNotesAdded.set(key, []);
      sessionNotesAdded.get(key)!.push(String(op.text));
      recordAfter(key);
      continue;
    }

    if (op.op === 'SWAP_SESSION_TYPE') {
      const snapshot = sessionsById.get(String(op.draftSessionId));
      if (!snapshot) {
        unknownOps.push({ op, text: `Unknown sessionId=${String(op.draftSessionId)} (cannot swap type).`, weekIndex: null });
        continue;
      }
      const key: SessionKey = `${snapshot.weekIndex}:${snapshot.ordinal}`;
      recordBefore(key, snapshot);
      const s = findSessionInWeek(snapshot.weekIndex, snapshot.ordinal);
      if (!s) {
        unknownOps.push({ op, text: `Unknown session key week=${snapshot.weekIndex} ordinal=${snapshot.ordinal} (cannot swap type).`, weekIndex: snapshot.weekIndex });
        continue;
      }
      s.type = String(op.newType);
      touchedSessions.add(key);
      recordAfter(key);
      continue;
    }

    if (op.op === 'REMOVE_SESSION') {
      const snapshot = sessionsById.get(String(op.draftSessionId));
      if (!snapshot) {
        unknownOps.push({ op, text: `Unknown sessionId=${String(op.draftSessionId)} (cannot remove).`, weekIndex: null });
        continue;
      }

      const week = weekByIndex.get(snapshot.weekIndex);
      if (!week) {
        unknownOps.push({ op, text: `Unknown weekIndex=${snapshot.weekIndex} (cannot remove session).`, weekIndex: null });
        continue;
      }

      const beforeCount = (week.sessions ?? []).length;
      week.sessions = (week.sessions ?? []).filter((s) => Number(s.ordinal ?? -1) !== snapshot.ordinal);
      const afterCount = (week.sessions ?? []).length;
      if (afterCount === beforeCount) {
        unknownOps.push({
          op,
          text: `Session not found in week=${snapshot.weekIndex} ordinal=${snapshot.ordinal} (cannot remove).`,
          weekIndex: snapshot.weekIndex,
        });
      } else {
        touchedSessions.add(`${snapshot.weekIndex}:${snapshot.ordinal}`);
      }

      continue;
    }

    if (op.op === 'UPDATE_SESSION') {
      const snapshot = sessionsById.get(String(op.draftSessionId));
      if (!snapshot) {
        unknownOps.push({ op, text: `Unknown sessionId=${String(op.draftSessionId)} (cannot update session).`, weekIndex: null });
        continue;
      }
      const key: SessionKey = `${snapshot.weekIndex}:${snapshot.ordinal}`;
      recordBefore(key, snapshot);
      const s = findSessionInWeek(snapshot.weekIndex, snapshot.ordinal);
      if (!s) {
        unknownOps.push({ op, text: `Unknown session key week=${snapshot.weekIndex} ordinal=${snapshot.ordinal} (cannot update session).`, weekIndex: snapshot.weekIndex });
        continue;
      }
      if (op.patch.type !== undefined) s.type = String(op.patch.type);
      if ((op.patch as any).discipline !== undefined) s.discipline = String((op.patch as any).discipline);
      if (op.patch.durationMinutes !== undefined) s.durationMinutes = Number(op.patch.durationMinutes);
      if (op.patch.notes !== undefined) s.notes = (op.patch.notes as any) === null ? null : String(op.patch.notes);
      touchedSessions.add(key);
      recordAfter(key);
      continue;
    }

    // Exhaustiveness
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _never: never = op;
  }

  // Build a stable week list spanning all weeks in the draft.
  const weekIndices = Array.from(new Set(before.weeks.map((w) => w.weekIndex).concat(after.weeks.map((w) => w.weekIndex)))).sort(
    (a, b) => a - b
  );

  const beforeWeekByIndex = new Map(before.weeks.map((w) => [w.weekIndex, w] as const));
  const afterWeekByIndex = new Map(after.weeks.map((w) => [w.weekIndex, w] as const));

  const totalBeforeMinutes = weekIndices.reduce((sum, wi) => sum + computeWeekMinutes(beforeWeekByIndex.get(wi) ?? { weekIndex: wi, locked: false, sessions: [] } as any), 0);
  const totalAfterMinutes = weekIndices.reduce((sum, wi) => sum + computeWeekMinutes(afterWeekByIndex.get(wi) ?? { weekIndex: wi, locked: false, sessions: [] } as any), 0);

  const beforeIntensity = before.weeks.flatMap((w) => w.sessions ?? []).filter((s) => isIntensityType(String(s.type))).length;
  const afterIntensity = after.weeks.flatMap((w) => w.sessions ?? []).filter((s) => isIntensityType(String(s.type))).length;

  const weeks: DiffViewModel['weeks'] = weekIndices.map((weekIndex) => {
    const bw = beforeWeekByIndex.get(weekIndex);
    const aw = afterWeekByIndex.get(weekIndex);
    const beforeTotalMinutes = bw ? computeWeekMinutes(bw) : 0;
    const afterTotalMinutes = aw ? computeWeekMinutes(aw) : 0;

    const items: DiffViewModel['weeks'][number]['items'] = [];

    const pctDeltas = weekVolumeOpsByWeek.get(weekIndex) ?? [];
    for (const pct of pctDeltas) {
      const pctRounded = Math.round(pct * 100);
      items.push({ kind: 'week', text: `Week volume ${pctRounded > 0 ? '+' : ''}${pctRounded}% (unlocked sessions only)` });
    }

    for (const note of weekNotes.filter((n) => n.weekIndex === weekIndex)) {
      items.push({ kind: 'week', text: `Added note: ${note.text}` });
    }

    const sessionKeys = Array.from(touchedSessions)
      .filter((k) => k.startsWith(`${weekIndex}:`))
      .sort((a, b) => {
        const ao = Number(a.split(':')[1]);
        const bo = Number(b.split(':')[1]);
        return ao - bo;
      });

    for (const key of sessionKeys) {
      const beforeState = beforeSessionState.get(key);
      const afterState = afterSessionState.get(key);
      if (!beforeState || !afterState) {
        // Fallback to deriving from the after draft when possible.
        const [wi, ord] = key.split(':').map((x) => Number(x));
        const s = findSessionInWeek(wi, ord);
        if (!s) continue;
        const label = formatSessionLabel({ dayOfWeek: s.dayOfWeek, discipline: s.discipline });
        items.push({ kind: 'session', text: `${label}: updated` });
        continue;
      }

      const label = formatSessionLabel({ dayOfWeek: afterState.dayOfWeek, discipline: afterState.discipline });
      const parts: string[] = [];
      if (String(beforeState.type) !== String(afterState.type)) {
        parts.push(`${titleCase(beforeState.type)} → ${titleCase(afterState.type)}`);
      }
      if (Number(beforeState.durationMinutes) !== Number(afterState.durationMinutes)) {
        parts.push(`${minutesText(beforeState.durationMinutes)} → ${minutesText(afterState.durationMinutes)}`);
      }

      const notes = sessionNotesAdded.get(key) ?? [];
      for (const text of notes) {
        parts.push(`Added note: ${text}`);
      }

      items.push({ kind: 'session', text: `${label}: ${parts.length ? parts.join('; ') : 'updated'}` });
    }

    // Unknown items that mention this week.
    for (const u of unknownOps.filter((x) => x.weekIndex === weekIndex)) {
      items.push({ kind: 'unknown', text: u.text });
    }

    return { weekIndex, beforeTotalMinutes, afterTotalMinutes, items };
  });

  // Unknown ops without a week index go at the top of the earliest week (or week 0).
  const globalUnknown = unknownOps.filter((x) => x.weekIndex === null);
  if (globalUnknown.length) {
    const targetWeekIndex = weeks[0]?.weekIndex ?? 0;
    const target = weeks.find((w) => w.weekIndex === targetWeekIndex);
    if (target) {
      target.items.unshift(...globalUnknown.map((u) => ({ kind: 'unknown' as const, text: u.text })));
    }
  }

  return {
    summary: {
      sessionsChangedCount: touchedSessions.size,
      totalMinutesDelta: totalAfterMinutes - totalBeforeMinutes,
      intensitySessionsDelta: afterIntensity - beforeIntensity,
    },
    weeks,
  };
}

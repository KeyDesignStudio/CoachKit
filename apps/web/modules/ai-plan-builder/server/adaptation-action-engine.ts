import type { PlanDiffOp } from './adaptation-diff';
import type { AiAdaptationTriggerType } from '../ai/types';

type DraftSessionSnapshot = {
  id: string;
  weekIndex: number;
  type: string;
  durationMinutes: number;
};

type SetupSnapshot = {
  startDate?: string | null;
  weekStart?: 'monday' | 'sunday' | string | null;
};

export type HardSafetyReview = {
  ok: boolean;
  currentWeekIndex: number;
  reasons: string[];
  metrics: {
    totalDurationDeltaMinutes: number;
    updateCount: number;
    swapCount: number;
    weekVolumeAdjustments: Array<{ weekIndex: number; pctDelta: number }>;
    removeCount: number;
    noteCount: number;
  };
};

export type RewriteSafetyResult = {
  diff: PlanDiffOp[];
  droppedOps: number;
  rewrites: string[];
};

function isDayKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function startOfWeek(date: Date, weekStart: 'monday' | 'sunday') {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const jsDay = next.getUTCDay();
  const startJsDay = weekStart === 'sunday' ? 0 : 1;
  const diff = (jsDay - startJsDay + 7) % 7;
  next.setUTCDate(next.getUTCDate() - diff);
  return next;
}

function inferCurrentWeekIndex(setup: SetupSnapshot): number {
  const weekStart = setup.weekStart === 'sunday' ? 'sunday' : 'monday';
  const today = startOfWeek(new Date(), weekStart);
  if (!isDayKey(setup.startDate)) return 0;
  const start = startOfWeek(new Date(`${setup.startDate}T00:00:00.000Z`), weekStart);
  const diffDays = Math.floor((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, Math.floor(diffDays / 7));
}

function isIntensityType(value: string) {
  const t = String(value || '').toLowerCase();
  return t === 'tempo' || t === 'threshold';
}

function clampDuration(value: number) {
  return Math.max(20, Math.min(240, Math.round(value)));
}

function clampPctDelta(pctDelta: number) {
  if (!Number.isFinite(pctDelta)) return 0;
  return Math.max(-0.2, Math.min(0.12, pctDelta));
}

export function rewriteProposalDiffForSafeApply(params: {
  setup: SetupSnapshot;
  sessions: DraftSessionSnapshot[];
  diff: PlanDiffOp[];
  triggerTypes: AiAdaptationTriggerType[];
}): RewriteSafetyResult {
  const bySessionId = new Map(params.sessions.map((s) => [String(s.id), s] as const));
  const currentWeekIndex = inferCurrentWeekIndex(params.setup);
  const protectiveMode = params.triggerTypes.some((t) => t === 'SORENESS' || t === 'TOO_HARD' || t === 'MISSED_KEY');

  const next: PlanDiffOp[] = [];
  const rewrites: string[] = [];
  let droppedOps = 0;

  for (const op of params.diff) {
    if (op.op === 'REMOVE_SESSION') {
      droppedOps += 1;
      rewrites.push('Dropped REMOVE_SESSION op (auto-apply does not remove sessions).');
      continue;
    }

    if (op.op === 'ADJUST_WEEK_VOLUME') {
      if (op.weekIndex < currentWeekIndex) {
        droppedOps += 1;
        rewrites.push(`Dropped past-week volume adjustment for week ${op.weekIndex + 1}.`);
        continue;
      }
      const clamped = clampPctDelta(op.pctDelta);
      if (clamped !== op.pctDelta) {
        rewrites.push(`Clamped week ${op.weekIndex + 1} volume delta from ${Math.round(op.pctDelta * 100)}% to ${Math.round(clamped * 100)}%.`);
      }
      next.push({ ...op, pctDelta: clamped });
      continue;
    }

    if (op.op === 'ADD_NOTE') {
      if (op.target === 'week') {
        if (op.weekIndex < currentWeekIndex) {
          droppedOps += 1;
          rewrites.push(`Dropped past-week note for week ${op.weekIndex + 1}.`);
          continue;
        }
        next.push(op);
        continue;
      }

      const session = bySessionId.get(String(op.draftSessionId ?? ''));
      if (!session) {
        droppedOps += 1;
        rewrites.push('Dropped note for unknown session.');
        continue;
      }
      if (session.weekIndex < currentWeekIndex) {
        droppedOps += 1;
        rewrites.push(`Dropped past-session note for session ${session.id}.`);
        continue;
      }
      next.push(op);
      continue;
    }

    if (op.op === 'SWAP_SESSION_TYPE') {
      const session = bySessionId.get(String(op.draftSessionId));
      if (!session) {
        droppedOps += 1;
        rewrites.push('Dropped swap for unknown session.');
        continue;
      }
      if (session.weekIndex < currentWeekIndex) {
        droppedOps += 1;
        rewrites.push(`Dropped swap for past-session ${session.id}.`);
        continue;
      }
      if (protectiveMode && !isIntensityType(session.type) && isIntensityType(op.newType)) {
        next.push({ ...op, newType: 'endurance' });
        rewrites.push(`Rewrote intensity escalation to endurance for session ${session.id}.`);
        continue;
      }
      next.push(op);
      continue;
    }

    if (op.op === 'UPDATE_SESSION') {
      const session = bySessionId.get(String(op.draftSessionId));
      if (!session) {
        droppedOps += 1;
        rewrites.push('Dropped update for unknown session.');
        continue;
      }
      if (session.weekIndex < currentWeekIndex) {
        droppedOps += 1;
        rewrites.push(`Dropped update for past-session ${session.id}.`);
        continue;
      }

      const patch = { ...op.patch };
      if (patch.type && protectiveMode && !isIntensityType(session.type) && isIntensityType(String(patch.type))) {
        patch.type = 'endurance';
        rewrites.push(`Rewrote patch intensity escalation to endurance for session ${session.id}.`);
      }
      if (typeof patch.durationMinutes === 'number' && Number.isFinite(patch.durationMinutes)) {
        const current = Math.max(20, Number(session.durationMinutes || 20));
        const minAllowed = Math.max(20, Math.round(current * 0.75));
        const maxAllowed = Math.min(240, Math.round(current * 1.25));
        const clamped = Math.max(minAllowed, Math.min(maxAllowed, clampDuration(patch.durationMinutes)));
        if (clamped !== patch.durationMinutes) {
          rewrites.push(`Clamped session ${session.id} duration patch from ${patch.durationMinutes} to ${clamped} min.`);
        }
        patch.durationMinutes = clamped;
      }
      next.push({ ...op, patch });
      continue;
    }

    next.push(op);
  }

  return { diff: next, droppedOps, rewrites };
}

export function evaluateProposalHardSafety(params: {
  setup: SetupSnapshot;
  sessions: DraftSessionSnapshot[];
  diff: PlanDiffOp[];
  triggerTypes: AiAdaptationTriggerType[];
}): HardSafetyReview {
  const bySessionId = new Map(params.sessions.map((s) => [String(s.id), s] as const));
  const currentWeekIndex = inferCurrentWeekIndex(params.setup);
  const reasons: string[] = [];

  let totalDurationDeltaMinutes = 0;
  let updateCount = 0;
  let swapCount = 0;
  let removeCount = 0;
  let noteCount = 0;
  const weekVolumeAdjustments: Array<{ weekIndex: number; pctDelta: number }> = [];

  const protectiveMode = params.triggerTypes.some((t) => t === 'SORENESS' || t === 'TOO_HARD' || t === 'MISSED_KEY');

  for (const op of params.diff) {
    if (op.op === 'REMOVE_SESSION') {
      removeCount += 1;
      reasons.push('Removing sessions is blocked in auto-apply mode.');
      continue;
    }

    if (op.op === 'ADJUST_WEEK_VOLUME') {
      weekVolumeAdjustments.push({ weekIndex: op.weekIndex, pctDelta: op.pctDelta });
      if (op.weekIndex < currentWeekIndex) reasons.push(`Week ${op.weekIndex + 1} is in the past and cannot be auto-adjusted.`);
      if (op.pctDelta > 0.12) reasons.push(`Week ${op.weekIndex + 1} exceeds +12% volume cap.`);
      if (op.pctDelta < -0.2) reasons.push(`Week ${op.weekIndex + 1} exceeds -20% volume cap.`);
      continue;
    }

    if (op.op === 'ADD_NOTE') {
      noteCount += 1;
      if (op.target === 'week' && op.weekIndex < currentWeekIndex) {
        reasons.push(`Week ${op.weekIndex + 1} is in the past and cannot be modified.`);
      }
      if (op.target === 'session') {
        const session = bySessionId.get(String(op.draftSessionId));
        if (!session) reasons.push('A note targets a missing session.');
        else if (session.weekIndex < currentWeekIndex) reasons.push(`Session ${session.id} is in a past week and cannot be modified.`);
      }
      continue;
    }

    if (op.op === 'SWAP_SESSION_TYPE') {
      swapCount += 1;
      const session = bySessionId.get(String(op.draftSessionId));
      if (!session) {
        reasons.push('A swap targets a missing session.');
        continue;
      }
      if (session.weekIndex < currentWeekIndex) reasons.push(`Session ${session.id} is in a past week and cannot be auto-adjusted.`);
      if (protectiveMode && !isIntensityType(session.type) && isIntensityType(op.newType)) {
        reasons.push('Protective triggers cannot escalate a session into intensity.');
      }
      continue;
    }

    if (op.op === 'UPDATE_SESSION') {
      updateCount += 1;
      const session = bySessionId.get(String(op.draftSessionId));
      if (!session) {
        reasons.push('An update targets a missing session.');
        continue;
      }
      if (session.weekIndex < currentWeekIndex) reasons.push(`Session ${session.id} is in a past week and cannot be auto-adjusted.`);
      if (op.patch.type && protectiveMode && !isIntensityType(session.type) && isIntensityType(op.patch.type)) {
        reasons.push('Protective triggers cannot escalate a session into intensity.');
      }
      if (typeof op.patch.durationMinutes === 'number' && Number.isFinite(op.patch.durationMinutes)) {
        const next = clampDuration(op.patch.durationMinutes);
        const delta = next - Number(session.durationMinutes ?? 0);
        totalDurationDeltaMinutes += delta;
        const pct = session.durationMinutes > 0 ? delta / session.durationMinutes : 0;
        if (Math.abs(pct) > 0.25) reasons.push(`Session ${session.id} exceeds per-session 25% duration cap.`);
        if (next < 20 || next > 240) reasons.push(`Session ${session.id} duration must stay between 20 and 240 minutes.`);
      }
    }
  }

  return {
    ok: reasons.length === 0,
    currentWeekIndex,
    reasons,
    metrics: {
      totalDurationDeltaMinutes,
      updateCount,
      swapCount,
      weekVolumeAdjustments,
      removeCount,
      noteCount,
    },
  };
}

export function summarizeProposalAction(params: {
  triggerTypes: AiAdaptationTriggerType[];
  metrics: HardSafetyReview['metrics'];
  rewriteSafety?: {
    droppedOps?: number;
    rewrites?: string[];
  } | null;
}) {
  const parts: string[] = [];
  const { metrics } = params;
  const triggerLabels = params.triggerTypes.length ? params.triggerTypes.join(', ') : 'COACH_REVIEW';
  const triggerExplanation = (() => {
    if (params.triggerTypes.includes('SORENESS')) return 'Athlete soreness/pain signal increased recently';
    if (params.triggerTypes.includes('TOO_HARD')) return 'Recent sessions were reported too hard';
    if (params.triggerTypes.includes('MISSED_KEY')) return 'Key session completion dropped';
    if (params.triggerTypes.includes('HIGH_COMPLIANCE')) return 'High compliance supports cautious progression';
    return 'Coach-requested adaptation';
  })();

  if (metrics.weekVolumeAdjustments.length) {
    const weekBits = metrics.weekVolumeAdjustments
      .map((w) => `W${w.weekIndex + 1} ${w.pctDelta >= 0 ? '+' : ''}${Math.round(w.pctDelta * 100)}%`)
      .join(', ');
    parts.push(`week load ${weekBits}`);
  }
  if (metrics.swapCount) parts.push(`${metrics.swapCount} session type swap${metrics.swapCount === 1 ? '' : 's'}`);
  if (metrics.updateCount) parts.push(`${metrics.updateCount} session edit${metrics.updateCount === 1 ? '' : 's'}`);
  if (metrics.noteCount) parts.push(`${metrics.noteCount} coaching note${metrics.noteCount === 1 ? '' : 's'}`);
  if (metrics.removeCount) parts.push(`${metrics.removeCount} removal${metrics.removeCount === 1 ? '' : 's'}`);
  if (metrics.totalDurationDeltaMinutes) {
    const signed = metrics.totalDurationDeltaMinutes > 0 ? `+${metrics.totalDurationDeltaMinutes}` : String(metrics.totalDurationDeltaMinutes);
    parts.push(`${signed} min total`);
  }

  const rewriteNotes: string[] = [];
  if (params.rewriteSafety?.droppedOps && params.rewriteSafety.droppedOps > 0) {
    rewriteNotes.push(`${params.rewriteSafety.droppedOps} unsafe op${params.rewriteSafety.droppedOps === 1 ? '' : 's'} removed`);
  }
  if (Array.isArray(params.rewriteSafety?.rewrites) && params.rewriteSafety!.rewrites.length > 0) {
    rewriteNotes.push(`${params.rewriteSafety!.rewrites.length} op${params.rewriteSafety!.rewrites.length === 1 ? '' : 's'} auto-adjusted`);
  }

  const changed = parts.length ? parts.join(', ') : 'no material edits';
  const safety = ['future weeks only', 'caps enforced'].concat(rewriteNotes.length ? rewriteNotes : []).join(', ');

  return `Why: ${triggerLabels} (${triggerExplanation}). What changed: ${changed}. Safety: ${safety}.`;
}

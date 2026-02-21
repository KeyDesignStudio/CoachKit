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
}) {
  const parts: string[] = [];
  const { metrics } = params;
  const triggers = params.triggerTypes.length ? params.triggerTypes.join(', ') : 'coach review';
  if (metrics.weekVolumeAdjustments.length) {
    const weekBits = metrics.weekVolumeAdjustments
      .map((w) => `W${w.weekIndex + 1} ${w.pctDelta >= 0 ? '+' : ''}${Math.round(w.pctDelta * 100)}%`)
      .join(', ');
    parts.push(`week volume (${weekBits})`);
  }
  if (metrics.swapCount) parts.push(`${metrics.swapCount} type swap${metrics.swapCount === 1 ? '' : 's'}`);
  if (metrics.updateCount) parts.push(`${metrics.updateCount} session update${metrics.updateCount === 1 ? '' : 's'}`);
  if (metrics.noteCount) parts.push(`${metrics.noteCount} coaching note${metrics.noteCount === 1 ? '' : 's'}`);
  if (metrics.removeCount) parts.push(`${metrics.removeCount} removal${metrics.removeCount === 1 ? '' : 's'}`);
  if (metrics.totalDurationDeltaMinutes) {
    const signed = metrics.totalDurationDeltaMinutes > 0 ? `+${metrics.totalDurationDeltaMinutes}` : String(metrics.totalDurationDeltaMinutes);
    parts.push(`${signed} min total duration`);
  }

  return `Why: ${triggers}. Changed: ${parts.length ? parts.join(', ') : 'no material edits'}.`;
}

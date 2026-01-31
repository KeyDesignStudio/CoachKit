import type { PlanDiffOp } from '../server/adaptation-diff';
import type { AiDraftPlanSnapshot, AiAdaptationTriggerType } from '../ai/types';

function stableSortSessions<T extends { weekIndex: number; dayOfWeek: number; ordinal: number }>(sessions: T[]) {
  return sessions
    .slice()
    .sort((a, b) => a.weekIndex - b.weekIndex || a.ordinal - b.ordinal || a.dayOfWeek - b.dayOfWeek);
}

function isIntensitySession(session: { type: string }) {
  const t = String(session.type || '').toLowerCase();
  return t === 'tempo' || t === 'threshold';
}

function downgradeIntensityType(currentType: string) {
  const t = String(currentType || '').toLowerCase();
  if (t === 'threshold') return 'tempo';
  if (t === 'tempo') return 'endurance';
  return 'endurance';
}

function pctText(pctDelta: number) {
  const pct = Math.round(pctDelta * 100);
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

function chooseNextUnlocked<T extends { locked: boolean; weekLocked: boolean }>(candidates: T[]) {
  return candidates.find((c) => !c.locked && !c.weekLocked);
}

export function suggestProposalDiffsDeterministicV1(params: {
  triggerTypes: AiAdaptationTriggerType[];
  draft: AiDraftPlanSnapshot;
}): { diff: PlanDiffOp[]; rationaleText: string; respectsLocks: boolean } {
  const weekLocked = new Map((params.draft.weeks ?? []).map((w) => [w.weekIndex, w.locked] as const));

  const sessionViews = stableSortSessions(
    (params.draft.sessions ?? []).map((s) => ({
      ...s,
      weekLocked: weekLocked.get(s.weekIndex) ?? false,
    }))
  );

  const ops: PlanDiffOp[] = [];
  const rationale: string[] = [];
  let respectsLocks = true;

  const addBlocked = (reason: string) => {
    respectsLocks = false;
    rationale.push(`Blocked by lock: ${reason}`);
  };

  const intensityCandidates = sessionViews
    .filter((s) => isIntensitySession(s))
    .map((s) => ({ ...s }));

  const nextUnlockedIntensity = chooseNextUnlocked(intensityCandidates);

  const nextWeekIndex = 1;
  const nextWeekLocked = weekLocked.get(nextWeekIndex) ?? false;

  const applyWeekVolume = (pctDelta: number, because: string) => {
    if (nextWeekLocked) {
      addBlocked(`weekIndex=${nextWeekIndex} is locked (cannot adjust week volume).`);
      return;
    }
    ops.push({ op: 'ADJUST_WEEK_VOLUME', weekIndex: nextWeekIndex, pctDelta });
    ops.push({
      op: 'ADD_NOTE',
      target: 'week',
      weekIndex: nextWeekIndex,
      text: `Volume adjustment ${pctText(pctDelta)} (${because}).`,
    });
    rationale.push(`${because}: adjust next week volume ${pctText(pctDelta)}.`);
  };

  const swapToRecovery = (sessionId: string, because: string) => {
    ops.push({ op: 'SWAP_SESSION_TYPE', draftSessionId: sessionId, newType: 'recovery' });
    ops.push({
      op: 'ADD_NOTE',
      target: 'session',
      draftSessionId: sessionId,
      text: `${because}: converted to recovery.`,
    });
  };

  for (const t of params.triggerTypes) {
    if (t === 'SORENESS') {
      rationale.push('Trigger SORENESS: soreness reported recently.');

      if (!nextUnlockedIntensity) {
        addBlocked('no unlocked intensity session found to convert for SORENESS.');
      } else {
        swapToRecovery(nextUnlockedIntensity.id, 'SORENESS');
      }

      applyWeekVolume(-0.1, 'SORENESS');
      continue;
    }

    if (t === 'TOO_HARD') {
      rationale.push('Trigger TOO_HARD: multiple sessions felt too hard.');

      if (!nextUnlockedIntensity) {
        addBlocked('no unlocked intensity session found to downgrade for TOO_HARD.');
      } else {
        const newType = downgradeIntensityType(nextUnlockedIntensity.type);
        ops.push({ op: 'SWAP_SESSION_TYPE', draftSessionId: nextUnlockedIntensity.id, newType });
        ops.push({
          op: 'ADD_NOTE',
          target: 'session',
          draftSessionId: nextUnlockedIntensity.id,
          text: `TOO_HARD: downgraded intensity (${nextUnlockedIntensity.type} -> ${newType}).`,
        } as any);
      }

      continue;
    }

    if (t === 'MISSED_KEY') {
      rationale.push('Trigger MISSED_KEY: multiple key sessions were skipped.');

      applyWeekVolume(-0.15, 'MISSED_KEY');

      if (nextWeekLocked) {
        addBlocked(`weekIndex=${nextWeekIndex} is locked (cannot replace intensity session).`);
      } else {
        const inNextWeekIntensity = sessionViews
          .filter((s) => s.weekIndex === nextWeekIndex && isIntensitySession(s))
          .map((s) => ({ ...s }));
        const target = chooseNextUnlocked(inNextWeekIntensity);
        if (!target) {
          addBlocked('no unlocked intensity session found in next week to replace for MISSED_KEY.');
        } else {
          ops.push({ op: 'SWAP_SESSION_TYPE', draftSessionId: target.id, newType: 'endurance' });
          ops.push({
            op: 'ADD_NOTE',
            target: 'session',
            draftSessionId: target.id,
            text: 'MISSED_KEY: replaced an intensity session with endurance.',
          } as any);
        }
      }

      continue;
    }

    if (t === 'HIGH_COMPLIANCE') {
      rationale.push('Trigger HIGH_COMPLIANCE: strong completion with no negative flags.');

      if (nextWeekLocked) {
        addBlocked(`weekIndex=${nextWeekIndex} is locked (cannot apply progression).`);
        continue;
      }

      // Prefer adding +10 minutes to the longest unlocked session in next week.
      const nextWeekSessions = sessionViews
        .filter((s) => s.weekIndex === nextWeekIndex)
        .map((s) => ({ ...s }))
        .sort((a, b) => b.durationMinutes - a.durationMinutes || a.ordinal - b.ordinal);

      const target = chooseNextUnlocked(nextWeekSessions);

      if (target) {
        ops.push({
          op: 'UPDATE_SESSION',
          draftSessionId: target.id,
          patch: { durationMinutes: target.durationMinutes + 10 },
        });
        ops.push({
          op: 'ADD_NOTE',
          target: 'session',
          draftSessionId: target.id,
          text: 'HIGH_COMPLIANCE: small progression (+10 minutes).',
        });
        rationale.push('HIGH_COMPLIANCE: +10 minutes to the longest session next week.');
      } else {
        // Fallback: +5% volume (will affect unlocked sessions only).
        applyWeekVolume(0.05, 'HIGH_COMPLIANCE');
      }

      continue;
    }
  }

  for (const op of ops) {
    if (op.op === 'ADJUST_WEEK_VOLUME' || (op.op === 'ADD_NOTE' && (op as any).target === 'week')) {
      if (weekLocked.get((op as any).weekIndex)) respectsLocks = false;
    }
    if (op.op === 'UPDATE_SESSION' || op.op === 'SWAP_SESSION_TYPE') {
      const s = (params.draft.sessions ?? []).find((x) => x.id === (op as any).draftSessionId);
      if (s?.locked) respectsLocks = false;
      if (weekLocked.get(s?.weekIndex ?? -1)) respectsLocks = false;
    }
  }

  return {
    diff: ops,
    rationaleText: rationale.join('\n'),
    respectsLocks,
  };
}


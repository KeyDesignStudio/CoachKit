import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCoachOwnsAthlete } from '@/lib/auth';
import { ApiError } from '@/lib/errors';

import { requireAiPlanBuilderV1Enabled } from './flag';

export const evaluateAdaptationTriggersSchema = z.object({
  aiPlanDraftId: z.string().min(1),
  windowDays: z.number().int().min(1).max(60).optional(),
});

function floorToMinute(d: Date) {
  const copy = new Date(d);
  copy.setSeconds(0, 0);
  return copy;
}

function daysAgo(end: Date, days: number) {
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(end.getTime() - ms);
}

function isKeySession(session: { type: string; durationMinutes: number; notes: string | null }) {
  const t = String(session.type || '').toLowerCase();
  const intensity = t === 'tempo' || t === 'threshold';
  const long = session.durationMinutes >= 90 || (session.notes ?? '').toLowerCase().includes('long');
  return intensity || long;
}

type FeedbackSignalRow = {
  id: string;
  createdAt: Date;
  completedStatus: string;
  feel: string | null;
  sorenessFlag: boolean;
  sorenessNotes: string | null;
  rpe: number | null;
  sleepQuality: number | null;
  sessionId: string;
  session: {
    id: string;
    weekIndex: number;
    dayOfWeek: number;
    type: string;
    durationMinutes: number;
    notes: string | null;
  };
};

type CompletedSignalRow = {
  id: string;
  startTime: Date;
  rpe: number | null;
  painFlag: boolean;
};

export function deriveAdaptationTriggersFromSignals(params: {
  now: Date;
  windowDays: number;
  feedback: FeedbackSignalRow[];
  completedActivities: CompletedSignalRow[];
}): Array<{
  triggerType: 'SORENESS' | 'TOO_HARD' | 'MISSED_KEY' | 'HIGH_COMPLIANCE';
  windowStart: Date;
  windowEnd: Date;
  evidence: Prisma.InputJsonValue;
}> {
  const now = floorToMinute(params.now);
  const windowDays = Math.max(1, Math.min(60, Number(params.windowDays || 10)));
  const feedback = [...params.feedback].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || String(a.id).localeCompare(String(b.id)));
  const completedActivities = [...params.completedActivities].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime() || String(a.id).localeCompare(String(b.id))
  );

  const last7Start = daysAgo(now, 7);
  const last10Start = daysAgo(now, 10);
  const windowStart = floorToMinute(daysAgo(now, windowDays));

  const feedbackLast7 = feedback.filter((f) => f.createdAt >= last7Start && f.createdAt <= now);
  const feedbackLast10 = feedback.filter((f) => f.createdAt >= last10Start && f.createdAt <= now);
  const feedbackInWindow = feedback.filter((f) => f.createdAt >= windowStart && f.createdAt <= now);

  const completedLast7 = completedActivities.filter((a) => a.startTime >= last7Start && a.startTime <= now);
  const completedLast10 = completedActivities.filter((a) => a.startTime >= last10Start && a.startTime <= now);
  const completedInWindow = completedActivities.filter((a) => a.startTime >= windowStart && a.startTime <= now);

  const sorenessRows = feedbackLast7.filter((f) => Boolean(f.sorenessFlag));
  const painRows = completedLast7.filter((a) => Boolean(a.painFlag));

  const tooHardRows = feedbackLast10.filter((f) => String(f.feel ?? '').toUpperCase() === 'TOO_HARD');
  const highRpeFeedback = feedbackLast10.filter((f) => Number(f.rpe ?? 0) >= 8);
  const highRpeCompleted = completedLast10.filter((a) => Number(a.rpe ?? 0) >= 8);
  const poorSleepRows = feedbackLast10.filter((f) => typeof f.sleepQuality === 'number' && f.sleepQuality <= 2);

  const keyRowsLast7 = feedbackLast7.filter((f) => isKeySession(f.session));
  const missedKeyRows = keyRowsLast7.filter((f) => String(f.completedStatus) === 'SKIPPED');
  const keySessionCount = keyRowsLast7.length;
  const missedKeyRate = keySessionCount > 0 ? missedKeyRows.length / keySessionCount : 0;

  const doneStatuses = new Set(['DONE', 'PARTIAL']);
  const doneFeedback = feedbackInWindow.filter((f) => doneStatuses.has(String(f.completedStatus))).length;
  const totalFeedback = feedbackInWindow.length;
  const compliance = totalFeedback ? doneFeedback / totalFeedback : 0;
  const windowRpeValues = [
    ...feedbackInWindow.map((f) => (typeof f.rpe === 'number' ? f.rpe : null)).filter((v): v is number => v != null),
    ...completedInWindow.map((a) => (typeof a.rpe === 'number' ? a.rpe : null)).filter((v): v is number => v != null),
  ];
  const avgWindowRpe = windowRpeValues.length ? windowRpeValues.reduce((sum, v) => sum + v, 0) / windowRpeValues.length : null;

  const triggers: Array<{
    triggerType: 'SORENESS' | 'TOO_HARD' | 'MISSED_KEY' | 'HIGH_COMPLIANCE';
    windowStart: Date;
    windowEnd: Date;
    evidence: Prisma.InputJsonValue;
  }> = [];

  const sorenessOrPain = sorenessRows.length > 0 || painRows.length > 0;
  if (sorenessOrPain) {
    triggers.push({
      triggerType: 'SORENESS',
      windowStart: floorToMinute(last7Start),
      windowEnd: now,
      evidence: {
        rule: 'SORENESS if soreness flag or pain flag appears in last 7 days',
        sorenessCount: sorenessRows.length,
        painCount: painRows.length,
        items: sorenessRows.map((f) => ({
          feedbackId: f.id,
          createdAt: f.createdAt.toISOString(),
          sorenessNotes: f.sorenessNotes,
          session: { id: f.sessionId, weekIndex: f.session.weekIndex, dayOfWeek: f.session.dayOfWeek, type: f.session.type },
        })),
      },
    });
  }

  const tooHardByFeel = tooHardRows.length >= 2;
  const tooHardByRpe = highRpeFeedback.length + highRpeCompleted.length >= 3;
  const tooHardByCompounded = tooHardRows.length >= 1 && (highRpeFeedback.length + highRpeCompleted.length >= 2 || poorSleepRows.length >= 2);
  if (tooHardByFeel || tooHardByRpe || tooHardByCompounded) {
    triggers.push({
      triggerType: 'TOO_HARD',
      windowStart: floorToMinute(last10Start),
      windowEnd: now,
      evidence: {
        rule: 'TOO_HARD if repeated TOO_HARD feel, or elevated high-RPE cluster, or compounded high strain signals.',
        tooHardFeelCount: tooHardRows.length,
        highRpeFeedbackCount: highRpeFeedback.length,
        highRpeCompletedCount: highRpeCompleted.length,
        poorSleepCount: poorSleepRows.length,
        items: tooHardRows.map((f) => ({ feedbackId: f.id, createdAt: f.createdAt.toISOString(), sessionId: f.sessionId })),
      },
    });
  }

  if (missedKeyRows.length >= 2 || (keySessionCount >= 3 && missedKeyRate >= 0.5)) {
    triggers.push({
      triggerType: 'MISSED_KEY',
      windowStart: floorToMinute(last7Start),
      windowEnd: now,
      evidence: {
        rule: 'MISSED_KEY if >=2 key sessions skipped, or >=50% of key sessions skipped (min 3 key opportunities) in last 7 days.',
        missedKeyCount: missedKeyRows.length,
        keySessionCount,
        missedKeyRate,
        items: missedKeyRows.map((f) => ({
          feedbackId: f.id,
          createdAt: f.createdAt.toISOString(),
          session: { id: f.sessionId, type: f.session.type, durationMinutes: f.session.durationMinutes, notes: f.session.notes },
        })),
      },
    });
  }

  const hasTooHardSignal = tooHardByFeel || tooHardByRpe || tooHardByCompounded;
  if (!sorenessOrPain && !hasTooHardSignal && totalFeedback >= 4 && compliance >= 0.85 && (avgWindowRpe == null || avgWindowRpe <= 6.5)) {
    triggers.push({
      triggerType: 'HIGH_COMPLIANCE',
      windowStart,
      windowEnd: now,
      evidence: {
        rule: 'HIGH_COMPLIANCE if DONE/PARTIAL >=85% on at least 4 feedback entries, no soreness/pain, no strain signals.',
        windowDays,
        totalFeedbackCount: totalFeedback,
        doneCount: doneFeedback,
        compliance,
        avgRpe: avgWindowRpe,
      },
    });
  }

  return triggers;
}

export async function evaluateAdaptationTriggers(params: {
  coachId: string;
  athleteId: string;
  aiPlanDraftId: string;
  windowDays?: number;
  now?: Date;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const draft = await prisma.aiPlanDraft.findUnique({
    where: { id: params.aiPlanDraftId },
    select: { id: true, athleteId: true, coachId: true },
  });

  if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
    throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
  }

  const now = floorToMinute(params.now ?? new Date());
  const windowDays = params.windowDays ?? 10;

  const startForQuery = daysAgo(now, Math.max(windowDays, 10));

  const feedback = await prisma.athleteSessionFeedback.findMany({
    where: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      draftId: draft.id,
      createdAt: { gte: startForQuery, lte: now },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      session: {
        select: { id: true, weekIndex: true, dayOfWeek: true, type: true, durationMinutes: true, notes: true },
      },
    },
  });

  const completedActivities = await prisma.completedActivity.findMany({
    where: {
      athleteId: params.athleteId,
      startTime: { gte: startForQuery, lte: now },
    },
    orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      startTime: true,
      rpe: true,
      painFlag: true,
    },
  });
  const triggers = deriveAdaptationTriggersFromSignals({
    now,
    windowDays,
    feedback: feedback.map((f) => ({
      id: f.id,
      createdAt: f.createdAt,
      completedStatus: String(f.completedStatus),
      feel: f.feel,
      sorenessFlag: Boolean(f.sorenessFlag),
      sorenessNotes: f.sorenessNotes,
      rpe: f.rpe,
      sleepQuality: f.sleepQuality,
      sessionId: f.sessionId,
      session: {
        id: f.session.id,
        weekIndex: f.session.weekIndex,
        dayOfWeek: f.session.dayOfWeek,
        type: f.session.type,
        durationMinutes: f.session.durationMinutes,
        notes: f.session.notes,
      },
    })),
    completedActivities: completedActivities.map((a) => ({
      id: a.id,
      startTime: a.startTime,
      rpe: a.rpe,
      painFlag: Boolean(a.painFlag),
    })),
  });

  // Dedupe by draftId + type + windowStart/end.
  const created: any[] = [];

  for (const t of triggers) {
    const existing = await prisma.adaptationTrigger.findUnique({
      where: {
        draftId_triggerType_windowStart_windowEnd: {
          draftId: draft.id,
          triggerType: t.triggerType,
          windowStart: t.windowStart,
          windowEnd: t.windowEnd,
        },
      },
      select: { id: true },
    });

    if (existing) continue;

    const row = await prisma.adaptationTrigger.create({
      data: {
        athleteId: params.athleteId,
        coachId: params.coachId,
        draftId: draft.id,
        triggerType: t.triggerType,
        windowStart: t.windowStart,
        windowEnd: t.windowEnd,
        evidenceJson: t.evidence,
      },
    });

    created.push(row);
  }

  const allForWindow = await prisma.adaptationTrigger.findMany({
    where: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      draftId: draft.id,
      windowEnd: now,
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  return { now, created, triggers: allForWindow };
}

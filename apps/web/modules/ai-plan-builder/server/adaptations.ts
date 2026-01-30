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

  const last7Start = daysAgo(now, 7);
  const last10Start = daysAgo(now, 10);

  const inLast7 = feedback.filter((f) => f.createdAt >= last7Start);
  const inLast10 = feedback.filter((f) => f.createdAt >= last10Start);
  const inWindow = feedback.filter((f) => f.createdAt >= daysAgo(now, windowDays));

  const triggers: Array<{ triggerType: 'SORENESS' | 'TOO_HARD' | 'MISSED_KEY' | 'HIGH_COMPLIANCE'; windowStart: Date; windowEnd: Date; evidence: Prisma.InputJsonValue }> = [];

  // SORENESS
  const sore = inLast7.filter((f) => f.sorenessFlag);
  if (sore.length) {
    triggers.push({
      triggerType: 'SORENESS',
      windowStart: floorToMinute(last7Start),
      windowEnd: now,
      evidence: {
        rule: 'SORENESS if any sorenessFlag=true in last 7 days',
        sorenessCount: sore.length,
        items: sore.map((f) => ({
          feedbackId: f.id,
          createdAt: f.createdAt.toISOString(),
          sorenessNotes: f.sorenessNotes,
          session: { id: f.sessionId, weekIndex: f.session.weekIndex, dayOfWeek: f.session.dayOfWeek, type: f.session.type },
        })),
      },
    });
  }

  // TOO_HARD
  const tooHard = inLast10.filter((f) => f.feel === 'TOO_HARD');
  if (tooHard.length >= 2) {
    triggers.push({
      triggerType: 'TOO_HARD',
      windowStart: floorToMinute(last10Start),
      windowEnd: now,
      evidence: {
        rule: 'TOO_HARD if feel=TOO_HARD on >=2 sessions in last 10 days',
        tooHardCount: tooHard.length,
        items: tooHard.map((f) => ({ feedbackId: f.id, createdAt: f.createdAt.toISOString(), sessionId: f.sessionId })),
      },
    });
  }

  // MISSED_KEY
  const missedKey = inLast7.filter((f) => f.completedStatus === 'SKIPPED' && isKeySession(f.session));
  if (missedKey.length >= 2) {
    triggers.push({
      triggerType: 'MISSED_KEY',
      windowStart: floorToMinute(last7Start),
      windowEnd: now,
      evidence: {
        rule: 'MISSED_KEY if >=2 key sessions marked SKIPPED in last 7 days',
        missedKeyCount: missedKey.length,
        items: missedKey.map((f) => ({
          feedbackId: f.id,
          createdAt: f.createdAt.toISOString(),
          session: { id: f.sessionId, type: f.session.type, durationMinutes: f.session.durationMinutes, notes: f.session.notes },
        })),
      },
    });
  }

  // HIGH_COMPLIANCE
  const hasSoreness = sore.length > 0;
  const hasTooHard = tooHard.length >= 2;
  const total = inWindow.length;
  const done = inWindow.filter((f) => f.completedStatus === 'DONE').length;
  const compliance = total ? done / total : 0;

  if (!hasSoreness && !hasTooHard && total > 0 && compliance >= 0.8) {
    triggers.push({
      triggerType: 'HIGH_COMPLIANCE',
      windowStart: floorToMinute(daysAgo(now, windowDays)),
      windowEnd: now,
      evidence: {
        rule: 'HIGH_COMPLIANCE if DONE >=80% of feedback entries and no TOO_HARD and no SORENESS',
        windowDays,
        totalFeedbackCount: total,
        doneCount: done,
        compliance,
      },
    });
  }

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

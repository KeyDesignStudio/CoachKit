import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import { buildDraftPlanJsonV1 } from '../rules/plan-json';

export const draftSessionPatchSchema = z
  .object({
    type: z.string().min(1).optional(),
    durationMinutes: z.number().int().min(0).max(10_000).optional(),
    notes: z.string().max(10_000).nullable().optional(),
  })
  .strict();

export const planDiffOpSchema = z.union([
  z
    .object({
      op: z.literal('UPDATE_SESSION'),
      draftSessionId: z.string().min(1),
      patch: draftSessionPatchSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal('SWAP_SESSION_TYPE'),
      draftSessionId: z.string().min(1),
      newType: z.string().min(1),
    })
    .strict(),
  z
    .object({
      op: z.literal('ADJUST_WEEK_VOLUME'),
      weekIndex: z.number().int().min(0).max(52),
      pctDelta: z.number().min(-0.9).max(1),
    })
    .strict(),
  z
    .object({
      op: z.literal('ADD_NOTE'),
      target: z.literal('session'),
      draftSessionId: z.string().min(1),
      text: z.string().trim().min(1).max(10_000),
    })
    .strict(),
  z
    .object({
      op: z.literal('ADD_NOTE'),
      target: z.literal('week'),
      weekIndex: z.number().int().min(0).max(52),
      text: z.string().trim().min(1).max(10_000),
    })
    .strict(),
]);

export const planDiffSchema = z.array(planDiffOpSchema);

export type PlanDiffOp = z.infer<typeof planDiffOpSchema>;

function appendNote(existing: string | null | undefined, text: string) {
  const trimmed = text.trim();
  if (!trimmed) return existing ?? null;
  if (!existing) return trimmed;
  return `${existing}\n\n${trimmed}`;
}

export async function applyPlanDiffToDraft(params: {
  // Use the inferred tx shape from prisma.$transaction at call-sites.
  // Explicit Prisma.TransactionClient typing can become stale in-editor if Prisma types
  // haven't been regenerated yet.
  tx: any;
  draftId: string;
  diff: PlanDiffOp[];
}) {
  // Important: lock enforcement lives in AiPlanDraftWeek/AiPlanDraftSession.
  // We re-check those here, and fail with 409 on apply if blocked.

  const weekIndicesToTouch = new Set<number>();
  const sessionIdsToTouch = new Set<string>();

  for (const op of params.diff) {
    if (op.op === 'ADJUST_WEEK_VOLUME' || (op.op === 'ADD_NOTE' && op.target === 'week')) {
      weekIndicesToTouch.add(op.weekIndex);
    }
    if (op.op === 'UPDATE_SESSION' || op.op === 'SWAP_SESSION_TYPE') {
      sessionIdsToTouch.add(op.draftSessionId);
    }
    if (op.op === 'ADD_NOTE' && op.target === 'session' && op.draftSessionId) {
      sessionIdsToTouch.add(op.draftSessionId);
    }
  }

  if (weekIndicesToTouch.size) {
    const lockedWeek = await params.tx.aiPlanDraftWeek.findFirst({
      where: { draftId: params.draftId, weekIndex: { in: Array.from(weekIndicesToTouch) }, locked: true },
      select: { weekIndex: true },
    });

    if (lockedWeek) {
      throw new ApiError(409, 'WEEK_LOCKED', 'Week is locked and sessions cannot be modified.', {
        weekIndex: lockedWeek.weekIndex,
      });
    }
  }

  const sessionsById = sessionIdsToTouch.size
    ? await params.tx.aiPlanDraftSession.findMany({
        where: { id: { in: Array.from(sessionIdsToTouch) }, draftId: params.draftId },
        select: {
          id: true,
          weekIndex: true,
          ordinal: true,
          type: true,
          durationMinutes: true,
          notes: true,
          locked: true,
        },
      })
    : [];

  if (sessionIdsToTouch.size && sessionsById.length !== sessionIdsToTouch.size) {
    throw new ApiError(404, 'NOT_FOUND', 'One or more draft sessions were not found.');
  }

  const sessionMap = new Map<string, any>(sessionsById.map((s: any) => [s.id, s] as const));

  // Apply ops deterministically in order.
  for (const op of params.diff) {
    if (op.op === 'UPDATE_SESSION') {
      const existing = sessionMap.get(op.draftSessionId);
      if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Draft session not found.');

      const wantsContentChange =
        op.patch.type !== undefined || op.patch.durationMinutes !== undefined || op.patch.notes !== undefined;

      if (existing.locked && wantsContentChange) {
        throw new ApiError(409, 'SESSION_LOCKED', 'Session is locked and cannot be edited.');
      }

      await params.tx.aiPlanDraftSession.update({
        where: { id: existing.id },
        data: {
          type: op.patch.type,
          durationMinutes: op.patch.durationMinutes,
          notes: op.patch.notes === undefined ? undefined : op.patch.notes,
        },
      });

      continue;
    }

    if (op.op === 'SWAP_SESSION_TYPE') {
      const existing = sessionMap.get(op.draftSessionId);
      if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Draft session not found.');
      if (existing.locked) {
        throw new ApiError(409, 'SESSION_LOCKED', 'Session is locked and cannot be edited.');
      }

      await params.tx.aiPlanDraftSession.update({
        where: { id: existing.id },
        data: { type: op.newType },
      });

      continue;
    }

    if (op.op === 'ADD_NOTE') {
      if (op.target === 'session') {
        const existing = op.draftSessionId ? sessionMap.get(op.draftSessionId) : undefined;
        if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Draft session not found.');
        if (existing.locked) {
          throw new ApiError(409, 'SESSION_LOCKED', 'Session is locked and cannot be edited.');
        }

        await params.tx.aiPlanDraftSession.update({
          where: { id: existing.id },
          data: { notes: appendNote(existing.notes, op.text) },
        });
      } else {
        // Week notes: append to all unlocked sessions in the week.
        const sessions = await params.tx.aiPlanDraftSession.findMany({
          where: { draftId: params.draftId, weekIndex: op.weekIndex },
          orderBy: [{ ordinal: 'asc' }],
          select: { id: true, locked: true, notes: true },
        });

        for (const s of sessions) {
          if (s.locked) continue;
          await params.tx.aiPlanDraftSession.update({
            where: { id: s.id },
            data: { notes: appendNote(s.notes, op.text) },
          });
        }
      }

      continue;
    }

    if (op.op === 'ADJUST_WEEK_VOLUME') {
      // Adjust only unlocked sessions in unlocked weeks.
      // pctDelta is applied per-session in a stable order.
      const sessions = await params.tx.aiPlanDraftSession.findMany({
        where: { draftId: params.draftId, weekIndex: op.weekIndex },
        orderBy: [{ ordinal: 'asc' }],
        select: { id: true, locked: true, durationMinutes: true },
      });

      const factor = 1 + op.pctDelta;

      for (const s of sessions) {
        if (s.locked) continue;
        const next = Math.max(0, Math.round(s.durationMinutes * factor));
        await params.tx.aiPlanDraftSession.update({
          where: { id: s.id },
          data: { durationMinutes: next },
        });
      }

      continue;
    }

    // Exhaustiveness
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _never: never = op;
  }

  // Recompute week summaries (count + minutes) for all weeks in the draft.
  const byWeek = await params.tx.aiPlanDraftSession.groupBy({
    by: ['weekIndex'],
    where: { draftId: params.draftId },
    _count: { _all: true },
    _sum: { durationMinutes: true },
  });

  for (const w of byWeek) {
    await params.tx.aiPlanDraftWeek.updateMany({
      where: { draftId: params.draftId, weekIndex: w.weekIndex },
      data: {
        sessionsCount: w._count._all,
        totalMinutes: w._sum.durationMinutes ?? 0,
      },
    });
  }

  // Keep planJson in sync with canonical week/session rows.
  const [draftSetup, weeks, sessions] = await Promise.all([
    params.tx.aiPlanDraft.findUnique({ where: { id: params.draftId }, select: { setupJson: true } }),
    params.tx.aiPlanDraftWeek.findMany({ where: { draftId: params.draftId }, select: { weekIndex: true, locked: true } }),
    params.tx.aiPlanDraftSession.findMany({
      where: { draftId: params.draftId },
      select: {
        weekIndex: true,
        ordinal: true,
        dayOfWeek: true,
        discipline: true,
        type: true,
        durationMinutes: true,
        notes: true,
        locked: true,
      },
    }),
  ]);

  if (draftSetup?.setupJson) {
    await params.tx.aiPlanDraft.update({
      where: { id: params.draftId },
      data: {
        planJson: buildDraftPlanJsonV1({ setupJson: draftSetup.setupJson, weeks, sessions }),
      },
    });
  }
}

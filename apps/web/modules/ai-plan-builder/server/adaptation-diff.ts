import { z } from 'zod';

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
      op: z.literal('REMOVE_SESSION'),
      draftSessionId: z.string().min(1),
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
  // When false, skips the planJson cache rebuild (caller may rebuild outside tx).
  syncPlanJson?: boolean;
}) {
  // Important: lock enforcement lives in AiPlanDraftWeek/AiPlanDraftSession.
  // We re-check those here, and fail with 409 on apply if blocked.

  const weekIndicesToTouch = new Set<number>();
  const sessionIdsToTouch = new Set<string>();

  for (const op of params.diff) {
    if (op.op === 'ADJUST_WEEK_VOLUME' || (op.op === 'ADD_NOTE' && op.target === 'week')) {
      weekIndicesToTouch.add(op.weekIndex);
    }
    if (op.op === 'UPDATE_SESSION' || op.op === 'SWAP_SESSION_TYPE' || op.op === 'REMOVE_SESSION') {
      sessionIdsToTouch.add(op.draftSessionId);
    }
    if (op.op === 'ADD_NOTE' && op.target === 'session' && op.draftSessionId) {
      sessionIdsToTouch.add(op.draftSessionId);
    }
  }

  const weeksToTouch = weekIndicesToTouch.size
    ? await params.tx.aiPlanDraftWeek.findMany({
        where: { draftId: params.draftId, weekIndex: { in: Array.from(weekIndicesToTouch) } },
        select: { weekIndex: true, locked: true },
      })
    : [];

  if (weekIndicesToTouch.size && weeksToTouch.length !== weekIndicesToTouch.size) {
    throw new ApiError(404, 'NOT_FOUND', 'One or more draft weeks were not found.');
  }

  for (const w of weeksToTouch) {
    if (w.locked) {
      throw new ApiError(409, 'WEEK_LOCKED', 'Week is locked and cannot be edited.');
    }
  }

  const sessionsById = sessionIdsToTouch.size
    ? await params.tx.aiPlanDraftSession.findMany({
        where: { draftId: params.draftId, id: { in: Array.from(sessionIdsToTouch) } },
        select: { id: true, locked: true, notes: true },
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

    if (op.op === 'REMOVE_SESSION') {
      const existing = sessionMap.get(op.draftSessionId);
      if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Draft session not found.');
      if (existing.locked) {
        throw new ApiError(409, 'SESSION_LOCKED', 'Session is locked and cannot be edited.');
      }

      await params.tx.aiPlanDraftSession.delete({ where: { id: existing.id } });
      sessionMap.delete(String(existing.id));
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

  if (params.syncPlanJson === false) return;

  // Keep planJson in sync with canonical week/session rows.
  // IMPORTANT: Do not use Promise.all inside interactive transactions.
  const draftSetup = await params.tx.aiPlanDraft.findUnique({ where: { id: params.draftId }, select: { setupJson: true } });
  const weeks = await params.tx.aiPlanDraftWeek.findMany({ where: { draftId: params.draftId }, select: { weekIndex: true, locked: true } });
  const sessions = await params.tx.aiPlanDraftSession.findMany({
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
  });

  if (draftSetup?.setupJson) {
    await params.tx.aiPlanDraft.update({
      where: { id: params.draftId },
      data: {
        planJson: buildDraftPlanJsonV1({ setupJson: draftSetup.setupJson, weeks, sessions }),
      },
    });
  }
}

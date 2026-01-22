import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { WorkoutLibrarySource } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { failure, handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z
  .object({
    dryRun: z.boolean().default(true),
    confirmText: z.string().optional(),
    mode: z.enum(['SOURCE', 'HEURISTIC']).default('SOURCE'),
    createdAfter: z.string().optional(),
    createdBefore: z.string().optional(),
    sampleLimit: z.number().int().positive().max(50).default(10),
  })
  .superRefine((body, ctx) => {
    if (!body.dryRun && body.confirmText?.trim().toUpperCase() !== 'DELETE') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'confirmText must be DELETE when dryRun=false.' });
    }

    if (body.mode === 'HEURISTIC') {
      if (!body.createdAfter || !body.createdBefore) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'createdAfter and createdBefore are required when mode=HEURISTIC.',
        });
      }
    }
  });

type PurgeSummary = {
  requestId: string;
  dryRun: boolean;
  mode: 'SOURCE' | 'HEURISTIC';
  matchedCount: number;
  wouldDeleteCount: number;
  deletedCount: number;
  sample: Array<{
    id: string;
    title: string;
    source: string;
    externalId: string | null;
    fingerprint: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  heuristics?: {
    createdAfter?: string;
    createdBefore?: string;
    rules: string[];
  };
};

function parseDateOrThrow(raw: string): Date {
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) {
    throw new Error(`Invalid date: ${raw}`);
  }
  return d;
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();

  try {
    await requireAdmin();

    const body = bodySchema.parse(await request.json());

    const where =
      body.mode === 'SOURCE'
        ? {
            source: WorkoutLibrarySource.PLAN_LIBRARY,
          }
        : (() => {
            const createdAfter = parseDateOrThrow(body.createdAfter!);
            const createdBefore = parseDateOrThrow(body.createdBefore!);

            return {
              // Only use this when source markers are missing.
              externalId: { not: null },
              fingerprint: null,
              createdAt: {
                gte: createdAfter,
                lte: createdBefore,
              },
            };
          })();

    const matchedCount = await prisma.workoutLibrarySession.count({ where });

    const sample = await prisma.workoutLibrarySession.findMany({
      where,
      take: body.sampleLimit,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        source: true,
        externalId: true,
        fingerprint: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (body.dryRun) {
      const summary: PurgeSummary = {
        requestId,
        dryRun: true,
        mode: body.mode,
        matchedCount,
        wouldDeleteCount: matchedCount,
        deletedCount: 0,
        sample: sample.map((s) => ({
          ...s,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        })),
        heuristics:
          body.mode === 'HEURISTIC'
            ? {
                createdAfter: body.createdAfter,
                createdBefore: body.createdBefore,
                rules: ['externalId IS NOT NULL', 'fingerprint IS NULL', 'createdAt within window'],
              }
            : undefined,
      };

      return success(summary);
    }

    // Apply mode: delete in batches to keep query sizes reasonable.
    let deletedCount = 0;
    const ids = await prisma.workoutLibrarySession.findMany({ where, select: { id: true } });

    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500).map((r) => r.id);
      const res = await prisma.workoutLibrarySession.deleteMany({ where: { id: { in: batch } } });
      deletedCount += res.count;
    }

    const summary: PurgeSummary = {
      requestId,
      dryRun: false,
      mode: body.mode,
      matchedCount,
      wouldDeleteCount: matchedCount,
      deletedCount,
      sample: sample.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
      heuristics:
        body.mode === 'HEURISTIC'
          ? {
              createdAfter: body.createdAfter,
              createdBefore: body.createdBefore,
              rules: ['externalId IS NOT NULL', 'fingerprint IS NULL', 'createdAt within window'],
            }
          : undefined,
    };

    return success(summary);
  } catch (error) {
    return handleError(error, { requestId, where: 'POST /api/admin/plan-library/purge-workout-templates' });
  }
}

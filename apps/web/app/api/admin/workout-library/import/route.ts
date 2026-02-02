import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { failure, handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const itemSchema = z.object({
  title: z.string().trim().min(1),
  discipline: z.string().trim().min(1),
  category: z.string().trim().optional(),
  tags: z.array(z.string().trim().min(1)).optional().default([]),
  workoutDetail: z.string().trim().optional().default(''),
  equipment: z.array(z.string().trim().min(1)).optional().default([]),
  durationSec: z.number().int().nonnegative().optional(),
  intensityTarget: z.string().trim().optional(),
});

const requestSchema = z.object({
  dryRun: z.boolean().optional().default(true),
  confirmApply: z.boolean().optional().default(false),
  items: z.array(itemSchema).min(1),
});

export async function POST(request: Request) {
  try {
    const { user } = await requireAdmin();
    const body = requestSchema.parse(await request.json());

    if (body.dryRun || !body.confirmApply) {
      return success({ createdIds: [], wouldCreate: body.items.length });
    }

    const createdIds: string[] = [];

    await prisma.$transaction(async (tx) => {
      for (const item of body.items) {
        const created = await tx.workoutLibrarySession.create({
          data: {
            title: item.title,
            discipline: item.discipline.trim().toUpperCase() as any,
            status: 'DRAFT',
            source: 'MANUAL',
            tags: item.tags ?? [],
            description: item.workoutDetail ?? '',
            durationSec: item.durationSec ?? 0,
            intensityTarget: item.intensityTarget ?? '',
            equipment: item.equipment ?? [],
            category: item.category ?? null,
            createdByUserId: user.id,
          },
          select: { id: true },
        });
        createdIds.push(created.id);
      }
    });

    return success({ createdIds });
  } catch (error) {
    return handleError(error, { where: '/api/admin/workout-library/import' });
  }
}

export async function GET() {
  return failure('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
}

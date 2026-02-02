import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { failure, handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const requestSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1),
  confirmApply: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  try {
    const { user } = await requireAdmin();
    const body = requestSchema.parse(await request.json());

    if (!body.confirmApply) {
      return success({ publishedCount: 0, wouldPublish: body.ids.length });
    }

    const now = new Date();

    const result = await prisma.workoutLibrarySession.updateMany({
      where: { id: { in: body.ids } },
      data: {
        status: 'PUBLISHED',
        publishedAt: now,
        publishedByUserId: user.id,
      },
    });

    return success({ publishedCount: result.count });
  } catch (error) {
    return handleError(error, { where: '/api/admin/workout-library/publish' });
  }
}

export async function GET() {
  return failure('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
}

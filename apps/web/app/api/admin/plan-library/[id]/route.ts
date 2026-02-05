import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: { id: string } }) {
  try {
    await requireAdmin();
    const planSource = await prisma.planSource.findUnique({
      where: { id: context.params.id },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          include: {
            weeks: { orderBy: { weekIndex: 'asc' } },
            rules: { orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] },
          },
        },
      },
    });

    if (!planSource) {
      throw new ApiError(404, 'PLAN_SOURCE_NOT_FOUND', 'Plan source not found.');
    }

    return success({ planSource });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => ({}));

    const planSource = await prisma.planSource.update({
      where: { id: context.params.id },
      data: {
        title: typeof body.title === 'string' ? body.title.trim() : undefined,
        sport: body.sport ?? undefined,
        distance: body.distance ?? undefined,
        level: body.level ?? undefined,
        durationWeeks: typeof body.durationWeeks === 'number' ? Math.max(0, Math.floor(body.durationWeeks)) : undefined,
        season: body.season ?? undefined,
        author: typeof body.author === 'string' ? body.author.trim() : undefined,
        publisher: typeof body.publisher === 'string' ? body.publisher.trim() : undefined,
        licenseText: typeof body.licenseText === 'string' ? body.licenseText : undefined,
        sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : undefined,
        sourceFilePath: typeof body.sourceFilePath === 'string' ? body.sourceFilePath : undefined,
        isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
      },
    });

    return success({ planSource });
  } catch (error) {
    return handleError(error);
  }
}

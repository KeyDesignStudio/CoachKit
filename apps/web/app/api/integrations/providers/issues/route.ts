import { ExternalProvider, ExternalWebhookEventStatus } from '@prisma/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { requireAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { normalizeWebhookIssue } from '@/lib/integrations/reconciliation';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  provider: z
    .enum(['GARMIN', 'WAHOO', 'COROS'])
    .optional()
    .nullable(),
  status: z
    .enum(['PENDING', 'PROCESSING', 'DONE', 'FAILED'])
    .optional()
    .nullable(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const retrySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAthlete();
    const url = new URL(request.url);

    const parsed = querySchema.parse({
      provider: url.searchParams.get('provider') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });

    const rows = await prisma.externalWebhookEvent.findMany({
      where: {
        athleteId: user.id,
        ...(parsed.provider ? { provider: parsed.provider as ExternalProvider } : {}),
        ...(parsed.status ? { status: parsed.status as ExternalWebhookEventStatus } : {}),
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: parsed.limit ?? 50,
      select: {
        id: true,
        provider: true,
        status: true,
        athleteId: true,
        externalAthleteId: true,
        externalActivityId: true,
        eventType: true,
        attempts: true,
        lastError: true,
        receivedAt: true,
        updatedAt: true,
        nextAttemptAt: true,
      },
    });

    const items = rows.map(normalizeWebhookIssue);
    const counts = rows.reduce(
      (acc, row) => {
        acc.total += 1;
        acc[row.status] += 1;
        return acc;
      },
      { total: 0, PENDING: 0, PROCESSING: 0, DONE: 0, FAILED: 0 }
    );

    return success({ items, counts });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireAthlete();
    const body = retrySchema.parse(await request.json());

    const updated = await prisma.externalWebhookEvent.updateMany({
      where: {
        id: { in: body.ids },
        athleteId: user.id,
        status: { in: [ExternalWebhookEventStatus.FAILED, ExternalWebhookEventStatus.PENDING] },
      },
      data: {
        status: ExternalWebhookEventStatus.PENDING,
        lastError: null,
        nextAttemptAt: null,
        processedAt: null,
      },
    });

    return success({ updated: updated.count });
  } catch (error) {
    return handleError(error);
  }
}

import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { handleError } from '@/lib/http';

export const dynamic = 'force-dynamic';

function getEnvBool(name: string) {
  return Boolean(process.env[name] && String(process.env[name]).trim().length > 0);
}

export async function GET(_request: NextRequest) {
  try {
    const autosyncEnabled = process.env.STRAVA_AUTOSYNC_ENABLED !== '0';

    const intentAgg = await prisma.stravaSyncIntent.aggregate({
      where: { status: 'PENDING' },
      _count: { id: true },
      _min: { createdAt: true },
      _max: { updatedAt: true },
    });

    const lastRun = await prisma.cronRun.findFirst({
      where: { kind: 'STRAVA_SYNC' },
      orderBy: { startedAt: 'desc' },
      select: { status: true, startedAt: true, finishedAt: true, errorCount: true },
    });

    const lastSuccess = await prisma.cronRun.findFirst({
      where: { kind: 'STRAVA_SYNC', status: 'SUCCEEDED' },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    });

    return NextResponse.json(
      {
        ok: true,
        autosyncEnabled,
        env: {
          hasAppBaseUrl: getEnvBool('APP_BASE_URL'),
          hasCronSecret: getEnvBool('CRON_SECRET'),
          hasWebhookToken: getEnvBool('STRAVA_WEBHOOK_VERIFY_TOKEN'),
          hasClientId: getEnvBool('STRAVA_CLIENT_ID'),
          hasClientSecret: getEnvBool('STRAVA_CLIENT_SECRET'),
        },
        pending: {
          count: intentAgg._count.id,
          oldestCreatedAt: intentAgg._min.createdAt,
          lastUpdatedAt: intentAgg._max.updatedAt,
        },
        cron: {
          lastRun,
          lastSuccessAt: lastSuccess?.startedAt ?? null,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    return handleError(error);
  }
}

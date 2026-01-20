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
      where: { pending: true },
      _count: { athleteId: true },
      _min: { lastEventAt: true },
      _max: { lastAttemptAt: true },
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
          count: intentAgg._count.athleteId,
          oldestEventAt: intentAgg._min.lastEventAt,
          lastAttemptAt: intentAgg._max.lastAttemptAt,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    return handleError(error);
  }
}

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/integrations/strava/cron/route';

type EnvSnapshot = {
  CRON_SECRET?: string;
  STRAVA_AUTOSYNC_ENABLED?: string;
};

function envSnapshot(): EnvSnapshot {
  return {
    CRON_SECRET: process.env.CRON_SECRET,
    STRAVA_AUTOSYNC_ENABLED: process.env.STRAVA_AUTOSYNC_ENABLED,
  };
}

function restoreEnv(snapshot: EnvSnapshot) {
  if (snapshot.CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = snapshot.CRON_SECRET;

  if (snapshot.STRAVA_AUTOSYNC_ENABLED === undefined) delete process.env.STRAVA_AUTOSYNC_ENABLED;
  else process.env.STRAVA_AUTOSYNC_ENABLED = snapshot.STRAVA_AUTOSYNC_ENABLED;
}

describe('strava cron endpoint', () => {
  const savedEnv = envSnapshot();
  const secret = 'test-cron-secret';
  let startWindow = new Date();

  beforeAll(async () => {
    process.env.CRON_SECRET = secret;
    process.env.STRAVA_AUTOSYNC_ENABLED = '1';
    startWindow = new Date();
  });

  afterAll(async () => {
    restoreEnv(savedEnv);

    await prisma.cronRun.deleteMany({
      where: { kind: 'STRAVA_SYNC', startedAt: { gte: startWindow } },
    });
  });

  it('requires cron secret', async () => {
    const request = new NextRequest('http://localhost/api/integrations/strava/cron');
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it('records cron run summary', async () => {
    const request = new NextRequest('http://localhost/api/integrations/strava/cron', {
      headers: { 'x-cron-secret': secret },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);

    const runs = await prisma.cronRun.findMany({
      where: { kind: 'STRAVA_SYNC', startedAt: { gte: startWindow } },
      orderBy: { startedAt: 'desc' },
      take: 1,
    });

    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0].status).toBeDefined();
  });
});

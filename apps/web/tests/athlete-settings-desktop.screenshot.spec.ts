import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const prisma = new PrismaClient();

async function setRoleCookie(page: any, role: 'COACH' | 'ATHLETE') {
  await page.context().addCookies([
    {
      name: 'coachkit-role',
      value: role,
      domain: 'localhost',
      path: '/',
    },
  ]);
}

function screenshotPath(testInfo: any, fileName: string) {
  // CWD for tests is apps/web.
  return path.join(process.cwd(), 'screenshots', String(testInfo.project.name || 'unknown'), fileName);
}

test.describe('Athlete settings desktop screenshot', () => {
  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('captures desktop layout + Strava header pills', async ({ page }, testInfo) => {
    await mkdir(path.join(process.cwd(), 'screenshots', String(testInfo.project.name || 'unknown')), { recursive: true });

    await prisma.user.upsert({
      where: { id: 'dev-coach' },
      update: { role: 'COACH' },
      create: {
        id: 'dev-coach',
        email: 'dev-coach@local',
        role: 'COACH',
        timezone: 'UTC',
        authProviderId: 'dev-coach',
      },
    });

    await prisma.user.upsert({
      where: { id: 'dev-athlete' },
      update: { role: 'ATHLETE', timezone: 'Australia/Brisbane' },
      create: {
        id: 'dev-athlete',
        email: 'dev-athlete@local',
        role: 'ATHLETE',
        timezone: 'Australia/Brisbane',
        authProviderId: 'dev-athlete',
      },
    });

    await prisma.athleteProfile.upsert({
      where: { userId: 'dev-athlete' },
      update: {
        coachId: 'dev-coach',
        disciplines: ['RUN'],
        defaultLat: -27.922,
        defaultLon: 153.314,
        defaultLocationLabel: 'Helensvale, Gold Coast',
      },
      create: {
        userId: 'dev-athlete',
        coachId: 'dev-coach',
        disciplines: ['RUN'],
        defaultLat: -27.922,
        defaultLon: 153.314,
        defaultLocationLabel: 'Helensvale, Gold Coast',
      },
    });

    await prisma.stravaConnection.upsert({
      where: { athleteId: 'dev-athlete' },
      update: {
        stravaAthleteId: '2760129',
        accessToken: 'playwright-access-token',
        refreshToken: 'playwright-refresh-token',
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
        scope: 'read,activity:read_all',
      },
      create: {
        athleteId: 'dev-athlete',
        stravaAthleteId: '2760129',
        accessToken: 'playwright-access-token',
        refreshToken: 'playwright-refresh-token',
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
        scope: 'read,activity:read_all',
      },
    });

    await setRoleCookie(page, 'ATHLETE');

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/athlete/settings', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible();
    await expect(page.getByText('Strava athlete ID: 2760129')).toBeVisible();

    await page.screenshot({ path: screenshotPath(testInfo, 'athlete-settings-desktop.png'), fullPage: true });
  });
});

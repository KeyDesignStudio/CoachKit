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
  // Write into repo folder so it's easy to share before committing.
  // CWD for tests is apps/web.
  return path.join(process.cwd(), 'screenshots', String(testInfo.project.name || 'unknown'), fileName);
}

test.describe('Athlete settings pill screenshots', () => {
  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('captures Appearance + Weather Location pills (light + dark)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone16pro', 'Captured only for iphone16pro screenshots folder.');

    await mkdir(path.join(process.cwd(), 'screenshots', String(testInfo.project.name || 'unknown')), { recursive: true });

    // Ensure dev users + athlete profile exist (auth disabled uses role cookie to pick these).
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

    await setRoleCookie(page, 'ATHLETE');

  // Navigate once to establish an origin before touching localStorage.
  await page.goto('/athlete/settings', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible();

    // Light
  await page.evaluate(() => window.localStorage.setItem('coachkit-theme', 'light'));
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible();
    await expect(page.getByTitle('Helensvale, Gold Coast')).toBeVisible();
    await page.screenshot({ path: screenshotPath(testInfo, 'athlete-settings-pills-light.png'), fullPage: true });

    // Dark
    await page.evaluate(() => window.localStorage.setItem('coachkit-theme', 'dark'));
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible();
    await expect(page.getByTitle('Helensvale, Gold Coast')).toBeVisible();
    await page.screenshot({ path: screenshotPath(testInfo, 'athlete-settings-pills-dark.png'), fullPage: true });
  });
});

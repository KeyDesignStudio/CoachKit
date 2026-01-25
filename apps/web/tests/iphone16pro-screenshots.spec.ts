import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
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

test.describe('Mobile screenshots', () => {
  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('captures coach calendar week, month, and menu drawer', async ({ page }, testInfo) => {
    await mkdir(path.join(process.cwd(), 'screenshots', String(testInfo.project.name || 'unknown')), { recursive: true });

    await setRoleCookie(page, 'COACH');

    // Week view
    await page.goto('/coach/calendar', { waitUntil: 'networkidle' });
    const width = page.viewportSize()?.width ?? 0;
    if (width > 0 && width <= 500) {
      await expect(page.locator('[data-mobile-header="v1"]')).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: /Weekly Calendar/i })).toBeVisible();
    await page.screenshot({ path: screenshotPath(testInfo, 'coach-calendar-week.png'), fullPage: true });

    // Open menu drawer
    if (width > 0 && width <= 500) {
      await page.getByRole('button', { name: /open menu/i }).click();
      await expect(page.locator('[data-mobile-nav-drawer="v1"]')).toBeVisible();
      // Ensure key coach links are visible and tappable
      await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Athletes' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Scheduling' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'SESSION BUILDER' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
      await page.screenshot({ path: screenshotPath(testInfo, 'mobile-menu-drawer.png'), fullPage: true });
      await page
        .getByRole('navigation', { name: 'Mobile navigation' })
        .getByRole('button', { name: 'Close menu' })
        .click();
    }

    // Month view
    await page.getByRole('button', { name: 'Month' }).click();
    await expect(page.getByRole('heading', { name: /Monthly Calendar/i })).toBeVisible();
    // Confirm month scan-only UI is in effect on narrow/mobile widths.
    if (width > 0 && width <= 500) {
      await expect(page.locator('[data-mobile-month-scan-only="true"]').first()).toBeVisible();
    }
    await page.screenshot({ path: screenshotPath(testInfo, 'coach-calendar-month.png'), fullPage: true });

    // Tap a day to open bottom sheet and confirm it can open workout detail
    if (width > 0 && width <= 500) {
      const firstDayCell = page.locator('[data-athlete-month-day-cell="v2"]').first();
      await firstDayCell.click();
      await expect(page.getByRole('dialog', { name: 'Day workouts' })).toBeVisible();

      const dayDialog = page.getByRole('dialog', { name: 'Day workouts' });
      const firstWorkout = dayDialog.locator('[data-day-workout-item="true"]').first();
      if (await firstWorkout.count()) {
        await firstWorkout.click();
        // Workout detail drawer should open.
        await expect(page.getByText('Edit Workout')).toBeVisible();
        // Planned vs actual time should be readable if actual exists.
        // (This assertion is conditional on seeded data.)
      }
    }
  });

  test('captures athlete + coach dashboards, athlete settings, and workout detail', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone16pro', 'Dashboard/settings screenshots are captured only for iphone16pro.');

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
      update: { coachId: 'dev-coach', disciplines: ['RUN'] },
      create: {
        userId: 'dev-athlete',
        coachId: 'dev-coach',
        disciplines: ['RUN'],
      },
    });

    const unique = crypto.randomUUID();
    const workout = await prisma.calendarItem.create({
      data: {
        athleteId: 'dev-athlete',
        coachId: 'dev-coach',
        date: new Date('2026-01-24T00:00:00.000Z'),
        plannedStartTimeLocal: '06:30',
        plannedDurationMinutes: 50,
        plannedDistanceKm: 10,
        origin: 'PLAYWRIGHT',
        sourceActivityId: `pw-${unique}-workout-detail`,
        discipline: 'RUN',
        title: 'Screenshot Run',
        workoutDetail: 'Easy run. Keep it conversational.',
        status: 'PLANNED',
      },
      select: { id: true },
    });

    // Athlete dashboard
    await setRoleCookie(page, 'ATHLETE');
    await page.goto('/athlete/dashboard', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1, name: 'Athlete Console' })).toBeVisible();
    await page.screenshot({ path: screenshotPath(testInfo, 'athlete-dashboard.png'), fullPage: true });

    // Athlete workout detail
    await page.goto(`/athlete/workouts/${workout.id}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1, name: 'Screenshot Run' })).toBeVisible();
    await page.screenshot({ path: screenshotPath(testInfo, 'athlete-workout-detail.png'), fullPage: true });

    // Athlete settings
    await page.goto('/athlete/settings', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible();
    await page.screenshot({ path: screenshotPath(testInfo, 'athlete-settings.png'), fullPage: true });

    // Coach dashboard
    await setRoleCookie(page, 'COACH');
    await page.goto('/coach/dashboard', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1, name: 'Coach Console' })).toBeVisible();
    await page.screenshot({ path: screenshotPath(testInfo, 'coach-dashboard.png'), fullPage: true });
  });
});

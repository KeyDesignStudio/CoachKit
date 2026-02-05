import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

import { getLocalDayKey, parseDayKeyToUtcDate, startOfWeekDayKey } from '@/lib/day-key';

const prisma = new PrismaClient();

async function setRoleCookie(page: any, role: 'COACH' | 'ATHLETE' | 'ADMIN') {
  await page.context().addCookies([
    {
      name: 'coachkit-role',
      value: role,
      domain: 'localhost',
      path: '/',
    },
  ]);
}

test.describe('Coach calendar: copy/paste session', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('manual session can be copied and pasted', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'iPad (gen 7)') {
      test.skip(true, 'Runs on iPad viewport where week grid + md controls are visible');
    }

    const coachId = 'dev-coach';
    const athleteId = 'pw-coach-calendar-copy-paste';
    const title = 'Copy Paste Manual Session';
    const browserTimeZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

    const todayKey = getLocalDayKey(new Date(), browserTimeZone);
    const weekStartKey = startOfWeekDayKey(todayKey);

    await prisma.user.upsert({
      where: { id: coachId },
      update: { role: 'COACH', timezone: browserTimeZone, authProviderId: coachId },
      create: {
        id: coachId,
        email: `${coachId}@local`,
        role: 'COACH',
        timezone: browserTimeZone,
        authProviderId: coachId,
      },
    });

    await prisma.user.upsert({
      where: { id: athleteId },
      update: { role: 'ATHLETE', timezone: browserTimeZone, authProviderId: athleteId },
      create: {
        id: athleteId,
        email: `${athleteId}@local`,
        role: 'ATHLETE',
        timezone: browserTimeZone,
        authProviderId: athleteId,
      },
    });

    await prisma.athleteProfile.upsert({
      where: { userId: athleteId },
      update: { coachId, disciplines: ['OTHER'] },
      create: { userId: athleteId, coachId, disciplines: ['OTHER'] },
    });

    await prisma.calendarItem.deleteMany({ where: { athleteId } });

    await prisma.calendarItem.create({
      data: {
        athleteId,
        coachId,
        date: parseDayKeyToUtcDate(weekStartKey),
        plannedStartTimeLocal: '06:00',
        discipline: 'RUN',
        title,
        plannedDurationMinutes: 40,
        status: 'PLANNED',
        deletedAt: null,
        deletedByUserId: null,
        tags: [],
        equipment: [],
      } as any,
    });

    await setRoleCookie(page, 'COACH');
    await page.addInitScript(
      ({ athleteId, coachId }) => {
        localStorage.setItem('coach-calendar-selected-athletes', JSON.stringify([athleteId]));
        localStorage.setItem(`coach-calendar-view:${coachId}`, 'week');
      },
      { athleteId, coachId }
    );

    await page.goto('/coach/calendar', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /Weekly Calendar/i })).toBeVisible();

    const sessionRow = page.locator('[data-athlete-week-session-row="v2"]:visible').filter({ hasText: title });
    await expect(sessionRow.first()).toBeVisible();
    const initialCount = await sessionRow.count();
    await sessionRow.first().click({ button: 'right' });
    await page.getByRole('button', { name: 'Copy session' }).click();

    const dayColumns = page.locator('[data-athlete-week-day-card="v2"]:visible');
    await expect(dayColumns).toHaveCount(7);
    await dayColumns.nth(1).click({ button: 'right' });
    await page.getByRole('button', { name: 'Paste session' }).click();

    await expect(page.getByText('Session pasted.')).toBeVisible();
    await expect(sessionRow).toHaveCount(initialCount + 1);
  });
});

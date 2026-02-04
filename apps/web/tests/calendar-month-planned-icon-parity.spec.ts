import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

import { getUtcRangeForLocalDayKeyRange } from '@/lib/calendar-local-day';
import { formatUtcDayKey, getLocalDayKey, parseDayKeyToUtcDate } from '@/lib/day-key';
import { buildAiPlanBuilderSessionTitle } from '../modules/ai-plan-builder/lib/session-title';

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

test.describe('Coach calendar month: planned icon parity', () => {
  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('shows planned status icon for APB-origin planned sessions (no AI UI special-casing)', async ({ page }, testInfo) => {
    // Month-day row status icons only render on md+ (desktop month). iPad viewport is wide enough.
    test.skip(testInfo.project.name !== 'iPad (gen 7)', 'Status overlay icons are desktop-month only (md+).');

    const coachId = 'dev-coach';
    const athleteId = 'pw-athlete-month-parity';
    const browserTimeZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

    const todayKey = getLocalDayKey(new Date(), browserTimeZone);
    const baseDayKey = todayKey;
    const utcRange = getUtcRangeForLocalDayKeyRange({
      fromDayKey: baseDayKey,
      toDayKey: baseDayKey,
      timeZone: browserTimeZone,
    });
    const storedStartUtc = new Date((utcRange.startUtc.getTime() + utcRange.endUtc.getTime()) / 2);
    const dateKeyUtc = formatUtcDayKey(storedStartUtc);
    const itemDate = parseDayKeyToUtcDate(dateKeyUtc);
    const plannedStartTimeLocal = storedStartUtc.toISOString().slice(11, 16);
    const manualStartUtc = new Date(storedStartUtc.getTime() + 30 * 60 * 1000);
    const manualStartTimeLocal = (manualStartUtc < utcRange.endUtc ? manualStartUtc : new Date(storedStartUtc.getTime() - 30 * 60 * 1000)).toISOString().slice(11, 16);

    const title = buildAiPlanBuilderSessionTitle({ discipline: 'bike', type: 'tempo' });

    // Ensure required dev users exist for DISABLE_AUTH mode.
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

    // Keep this test isolated from other suites by using a dedicated athlete id.
    await prisma.calendarItem.deleteMany({ where: { athleteId } });

    const item = await prisma.calendarItem.create({
      data: {
        athleteId,
        coachId,
        date: itemDate,
        plannedStartTimeLocal,
        origin: 'AI_PLAN_BUILDER',
        planningStatus: 'PLANNED',
        sourceActivityId: 'apb:pw-month-icon-parity',
        discipline: 'BIKE',
        subtype: 'tempo',
        title: 'tempo',
        plannedDurationMinutes: 45,
        status: 'PLANNED',
        deletedAt: null,
        deletedByUserId: null,
        tags: [],
        equipment: [],
      } as any,
    });

    const manualItem = await prisma.calendarItem.create({
      data: {
        athleteId,
        coachId,
        date: itemDate,
        plannedStartTimeLocal: manualStartTimeLocal,
        discipline: 'BIKE',
        title,
        plannedDurationMinutes: 45,
        status: 'PLANNED',
        deletedAt: null,
        deletedByUserId: null,
        tags: [],
        equipment: [],
      } as any,
    });

    try {
      await setRoleCookie(page, 'COACH');
      await page.addInitScript(({ athleteId, coachId }) => {
        localStorage.setItem('coach-calendar-selected-athletes', JSON.stringify([athleteId]));
        localStorage.setItem(`coach-calendar-view:${coachId}`, 'month');
      }, { athleteId, coachId });

      await page.goto('/coach/calendar', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /Monthly Calendar/i })).toBeVisible();
      await expect(page.getByTestId('calendar-month-grid')).toBeVisible();

      const monthGrid = page.getByTestId('calendar-month-grid');
      const row = monthGrid.getByLabel(`Open workout ${String(item.id)}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText(title);

      const manualRow = monthGrid.getByLabel(`Open workout ${String(manualItem.id)}`);
      await expect(manualRow).toBeVisible();
      await expect(manualRow).toContainText(title);

      // Planned status icon is the Material Symbol "event".
      await expect(row.locator('span.material-symbols-outlined', { hasText: 'event' })).toHaveCount(1);
    } finally {
      try {
        await prisma.calendarItem.deleteMany({ where: { athleteId } });
      } catch {
        // Best-effort cleanup: Prisma engine can be unavailable after test timeouts.
      }

      try {
        await prisma.athleteProfile.deleteMany({ where: { userId: athleteId } });
      } catch {
        // Best-effort cleanup: Prisma engine can be unavailable after test timeouts.
      }

      try {
        await prisma.user.deleteMany({ where: { id: athleteId } });
      } catch {
        // Best-effort cleanup: Prisma engine can be unavailable after test timeouts.
      }
    }
  });
});

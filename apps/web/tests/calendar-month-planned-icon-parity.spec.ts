import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

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

async function openAthleteSelector(page: any) {
  await page.locator('[data-athlete-selector="button"]').click();
  const dropdown = page.locator('[data-athlete-selector="dropdown"]');
  await expect(dropdown).toBeVisible();
  return dropdown;
}

async function ensureNoneSelected(dropdown: any) {
  const selectAll = dropdown.locator('input[data-athlete-selector="select-all"]');
  if (await selectAll.isChecked()) {
    await selectAll.click();
  }
  await expect(selectAll).not.toBeChecked();
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

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yyyy = tomorrow.getFullYear();
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    const dayKey = `${yyyy}-${mm}-${dd}`;

    const title = buildAiPlanBuilderSessionTitle({ discipline: 'bike', type: 'tempo' });

    // Ensure required dev users exist for DISABLE_AUTH mode.
    await prisma.user.upsert({
      where: { id: coachId },
      update: { role: 'COACH', timezone: 'UTC', authProviderId: coachId },
      create: {
        id: coachId,
        email: `${coachId}@local`,
        role: 'COACH',
        timezone: 'UTC',
        authProviderId: coachId,
      },
    });

    await prisma.user.upsert({
      where: { id: athleteId },
      update: { role: 'ATHLETE', timezone: 'UTC', authProviderId: athleteId },
      create: {
        id: athleteId,
        email: `${athleteId}@local`,
        role: 'ATHLETE',
        timezone: 'UTC',
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
        date: new Date(`${dayKey}T00:00:00.000Z`),
        plannedStartTimeLocal: '06:00',
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
        date: new Date(`${dayKey}T00:00:00.000Z`),
        plannedStartTimeLocal: '06:30',
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

      await page.goto('/coach/calendar', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /Weekly Calendar/i })).toBeVisible();

      // Select only our dedicated athlete to avoid day-cell row truncation from other seeded sessions.
      const dropdown = await openAthleteSelector(page);
      await ensureNoneSelected(dropdown);

      await dropdown.locator('input[placeholder="Search athletes..."]').fill(athleteId);
      const athleteCheckbox = dropdown.locator('input[data-athlete-selector="athlete-checkbox"]').first();
      await athleteCheckbox.click();

      // Close the dropdown so it does not obscure the calendar.
      const overlay = page.locator('xpath=//div[contains(@class,"fixed") and contains(@class,"inset-0") and contains(@class,"z-[100]")]');
      if (await overlay.isVisible()) {
        await overlay.click();
      }
      await expect(dropdown).toBeHidden();

      await page.getByRole('button', { name: 'Month' }).click();
      await expect(page.getByRole('heading', { name: /Monthly Calendar/i })).toBeVisible();

      const row = page.getByLabel(`Open workout ${String(item.id)}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText(title);

      const manualRow = page.getByLabel(`Open workout ${String(manualItem.id)}`);
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

import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

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

test.describe('Athlete profile', () => {
  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('athlete can save profile changes', async ({ page }) => {
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
        trainingSuburb: 'Brisbane',
      },
      create: {
        userId: 'dev-athlete',
        coachId: 'dev-coach',
        disciplines: ['RUN'],
        trainingSuburb: 'Brisbane',
      },
    });

    await setRoleCookie(page, 'ATHLETE');
    await page.goto('/athlete/dashboard', { waitUntil: 'networkidle' });

    await page.locator('[data-testid="user-header-control"]:visible').first().click();
    await page.getByRole('menuitem', { name: 'Athlete profile' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Athlete Profile' })).toBeVisible();

    await page.getByLabel('Training suburb').fill('Newstead');
    await page.getByRole('tab', { name: 'Training Basics' }).click();
    await page.getByLabel('Weekly minutes target').fill('420');

    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByLabel('Training suburb')).toHaveValue('Newstead');
    await page.getByRole('tab', { name: 'Training Basics' }).click();
    await expect(page.getByLabel('Weekly minutes target')).toHaveValue('420');
  });
});

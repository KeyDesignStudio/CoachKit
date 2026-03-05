import { expect, test } from '@playwright/test';

type TabletProfile = {
  name: string;
  width: number;
  height: number;
};

const TABLET_PROFILES: TabletProfile[] = [
  { name: 'Apple iPad mini (portrait)', width: 744, height: 1133 },
  { name: 'Apple iPad Air 11" (portrait)', width: 820, height: 1180 },
  { name: 'Apple iPad Pro 11" (portrait)', width: 834, height: 1194 },
  { name: 'Apple iPad Pro 13" (portrait)', width: 1024, height: 1366 },
  { name: 'Apple iPad Pro 13" (landscape)', width: 1366, height: 1024 },
  { name: 'Samsung Galaxy Tab S9 (portrait)', width: 800, height: 1280 },
  { name: 'Samsung Galaxy Tab S9 Ultra (portrait)', width: 922, height: 1470 },
  { name: 'Google Pixel Tablet (portrait)', width: 800, height: 1280 },
  { name: 'Microsoft Surface Pro 11 (portrait)', width: 912, height: 1368 },
  { name: 'Amazon Fire HD 10 (portrait)', width: 800, height: 1280 },
];

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

async function assertNoHorizontalScroll(page: any) {
  const hasOverflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
    const clientWidth = Math.max(doc.clientWidth, body.clientWidth);
    return scrollWidth > clientWidth + 1;
  });
  expect(hasOverflow, 'Page should not have horizontal overflow at tablet sizes').toBeFalsy();
}

test('Coach header navigation works across major tablet sizes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iPad (gen 11)', 'Tablet matrix runs once with explicit viewports.');
  await setRoleCookie(page, 'COACH');

  for (const profile of TABLET_PROFILES) {
    await test.step(profile.name, async () => {
      await page.setViewportSize({ width: profile.width, height: profile.height });
      await page.goto('/coach/dashboard', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { level: 1, name: 'Coach Console' })).toBeVisible();
      await assertNoHorizontalScroll(page);

      const openMenuButton = page.locator('header button[aria-label="Open menu"]:visible').first();
      const hasDrawerMenu = (await openMenuButton.count()) > 0;

      if (hasDrawerMenu) {
        await openMenuButton.click();
        const drawer = page.getByRole('navigation', { name: 'Mobile navigation' });
        await expect(drawer).toBeVisible();
        await expect(drawer.getByRole('link', { name: 'Dashboard' })).toBeVisible();
        await expect(drawer.getByRole('link', { name: 'Athletes' })).toBeVisible();
        await expect(drawer.getByRole('link', { name: 'Scheduling' })).toBeVisible();
        await expect(drawer.getByRole('link', { name: 'Challenges' })).toBeVisible();
        await drawer.getByRole('button', { name: 'Close menu' }).click();
        await expect(drawer).toHaveCount(0);
        return;
      }

      await expect(page.locator('header a[href="/coach/dashboard"]:visible')).toHaveCount(1);
      await expect(page.locator('header a[href="/coach/calendar"]:visible')).toHaveCount(1);
      await expect(page.locator('header a[href="/coach/athletes"]:visible')).toHaveCount(1);
      await expect(page.locator('header a[href="/coach/challenges"]:visible')).toHaveCount(1);
    });
  }
});

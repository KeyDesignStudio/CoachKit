import { test, expect } from '@playwright/test';

type Role = 'COACH' | 'ATHLETE' | 'ADMIN';

async function setRoleCookie(page: import('@playwright/test').Page, role: Role) {
  await page.context().addCookies([
    {
      name: 'coachkit-role',
      value: role,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('Admin routes gating', () => {
  test('COACH cannot access /admin/ai-usage (404-by-default)', async ({ page }) => {
    await setRoleCookie(page, 'COACH');

    await page.goto('/admin/ai-usage', { waitUntil: 'networkidle' });

    // In dev, Next may return 200 with an error overlay; assert by page content.
    await expect(page.getByRole('heading', { name: /ai usage/i })).toHaveCount(0);
    await expect(page.getByText(/not found/i).first()).toBeVisible();
  });

  test('ADMIN can access /admin/ai-usage', async ({ page }) => {
    await setRoleCookie(page, 'ADMIN');

    const res = await page.goto('/admin/ai-usage', { waitUntil: 'networkidle' });
    expect(res?.status()).toBe(200);

    await expect(page.getByRole('heading', { name: /ai usage/i })).toBeVisible();
  });

  test('ADMIN visiting athlete routes sees a 403 page (no redirect)', async ({ page }) => {
    await setRoleCookie(page, 'ADMIN');

    await page.goto('/athlete/calendar', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /403 — athlete access required/i })).toBeVisible();
  });
});

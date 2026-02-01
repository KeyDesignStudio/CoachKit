import { test, expect } from '@playwright/test';

async function setRoleCookie(page: import('@playwright/test').Page, role: 'ADMIN') {
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

test.describe('Admin UI smoke: AI usage page', () => {
  test('ADMIN can load /admin/ai-usage', async ({ page }) => {
    await setRoleCookie(page, 'ADMIN');

    const res = await page.goto('/admin/ai-usage', { waitUntil: 'networkidle' });
    expect(res?.status()).toBe(200);

    await expect(page.getByRole('heading', { name: /ai usage/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /run rollup/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /view raw audits/i })).toBeVisible();
  });
});

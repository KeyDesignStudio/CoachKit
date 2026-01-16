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

test.describe('Admin workout library gating', () => {
  test('COACH cannot access /admin/workout-library', async ({ page }) => {
    await setRoleCookie(page, 'COACH');

    await page.goto('/admin/workout-library', { waitUntil: 'networkidle' });

    // Should not render admin page content
    await expect(page.getByTestId('admin-workout-library-page')).toHaveCount(0);

    // Should land on forbidden/denied surface (may be /access-denied)
    await expect(page).toHaveURL(/\/access-denied/);
    await expect(page.getByRole('heading', { name: /access denied/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /workout library/i })).toHaveCount(0);
  });

  test('ADMIN can access /admin/workout-library', async ({ page }) => {
    await setRoleCookie(page, 'ADMIN');

    await page.goto('/admin/workout-library', { waitUntil: 'networkidle' });

    await expect(page.getByTestId('admin-workout-library-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: /workout library/i })).toBeVisible();
    await expect(page.getByTestId('admin-workout-library-search')).toBeVisible();
    await expect(page.getByTestId('admin-workout-library-import')).toBeVisible();
  });
});

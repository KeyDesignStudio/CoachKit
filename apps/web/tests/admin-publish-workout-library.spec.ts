import { test, expect } from '@playwright/test';

async function setRoleCookie(page: any, role: 'ADMIN' | 'COACH') {
  await page.context().addCookies([
    {
      name: 'coachkit-role',
      value: role,
      domain: 'localhost',
      path: '/',
    },
  ]);
}

test('Admin can publish DRAFT workouts and coach can see them', async ({ page }) => {
  test.skip(!process.env.DATABASE_URL, 'DATABASE_URL is required for publish-flow tests.');

  await setRoleCookie(page, 'ADMIN');

  const unique = Date.now();
  const title = `PW Publish Draft Strength ${unique}`;

  const importRes = await page.request.post('/api/admin/workout-library/import', {
    data: {
      dryRun: false,
      confirmApply: true,
      source: 'MANUAL',
      items: [
        {
          title,
          discipline: 'STRENGTH',
          tags: ['pw'],
          description: 'Playwright-created draft library workout.',
          durationSec: 600,
          intensityTarget: 'RPE 6',
          equipment: [],
        },
      ],
    },
  });

  expect(importRes.ok()).toBeTruthy();
  const importPayload = (await importRes.json()) as any;
  const createdIds: string[] = importPayload?.data?.createdIds ?? [];
  expect(createdIds.length).toBeGreaterThan(0);

  const publishRes = await page.request.post('/api/admin/workout-library/publish', {
    data: {
      ids: createdIds,
      confirmApply: true,
    },
  });

  expect(publishRes.ok()).toBeTruthy();
  const publishPayload = (await publishRes.json()) as any;
  expect(publishPayload?.data?.publishedCount).toBe(createdIds.length);

  await setRoleCookie(page, 'COACH');

  const listRes = await page.request.get('/api/coach/workout-library?discipline=STRENGTH&page=1&pageSize=20');
  expect(listRes.ok()).toBeTruthy();

  const listPayload = (await listRes.json()) as any;
  const items: Array<{ title: string }> = listPayload?.data?.items ?? [];

  expect(items.some((it) => it.title === title)).toBeTruthy();
});

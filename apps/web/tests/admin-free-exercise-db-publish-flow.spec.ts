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

test('Free Exercise DB apply + publish by source makes workouts visible to coach', async ({ page }) => {
  test.skip(!process.env.DATABASE_URL, 'DATABASE_URL is required for DB-backed publish-flow tests.');

  await setRoleCookie(page, 'ADMIN');

  // Smoke: ensure the FE DB import APPLY path works end-to-end.
  const dryRunRes = await page.request.post('/api/admin/workout-library/import/free-exercise-db', {
    data: {
      dryRun: true,
      limit: 2,
      offset: 0,
      confirmApply: false,
    },
  });
  expect(dryRunRes.ok()).toBeTruthy();

  const applyRes = await page.request.post('/api/admin/workout-library/import/free-exercise-db', {
    data: {
      dryRun: false,
      limit: 2,
      offset: 0,
      confirmApply: true,
    },
  });
  expect(applyRes.ok()).toBeTruthy();

  // Create a known DRAFT with the FREE_EXERCISE_DB source so the publish-by-source call has
  // a deterministic item we can assert on.
  const unique = Date.now();
  const title = `PW FE DB Publish Source ${unique}`;

  const createRes = await page.request.post('/api/admin/workout-library', {
    data: {
      title,
      discipline: 'STRENGTH',
      status: 'DRAFT',
      source: 'FREE_EXERCISE_DB',
      tags: ['pw', 'fe-db'],
      description: 'Playwright-created draft workout for source publish test.',
      durationSec: 600,
      intensityTarget: 'RPE 6',
      equipment: [],
    },
  });

  expect(createRes.ok()).toBeTruthy();

  const publishRes = await page.request.post('/api/admin/workout-library/publish', {
    data: {
      source: 'FREE_EXERCISE_DB',
      confirmApply: true,
      allowMoreThanCap: true,
    },
  });

  expect(publishRes.ok()).toBeTruthy();
  // Note: this test can run in parallel across multiple Playwright projects.
  // Another worker may have published all drafts for this source already.

  await setRoleCookie(page, 'COACH');

  const listRes = await page.request.get(
    `/api/coach/workout-library?q=${encodeURIComponent(title)}&discipline=STRENGTH&page=1&pageSize=10`
  );
  expect(listRes.ok()).toBeTruthy();

  const listPayload = (await listRes.json()) as any;
  const items: Array<{ title: string }> = listPayload?.data?.items ?? [];

  expect(items.some((it) => it.title === title)).toBeTruthy();
});

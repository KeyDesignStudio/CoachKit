import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import * as path from 'path';

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

function loadFixtureItems(): unknown[] {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const fixturePath = path.join(__dirname, 'fixtures', 'kaggle-sample.json');
  const raw = readFileSync(fixturePath, 'utf8');
  const parsed = JSON.parse(raw) as { items: unknown[] };
  return parsed.items;
}

test.describe('Admin Kaggle ingestion', () => {
  test('dry-run, apply, idempotency, and rollback purge', async ({ page }) => {
    await setRoleCookie(page, 'ADMIN');

    const items = loadFixtureItems();

    const dryRunRes = await page.request.post('/api/admin/workout-library/import/kaggle', {
      headers: { Cookie: 'coachkit-role=ADMIN' },
      data: {
        dryRun: true,
        confirmApply: false,
        maxRows: 200,
        items,
      },
    });

    expect(dryRunRes.ok()).toBeTruthy();
    const dryRunJson = (await dryRunRes.json()) as { data: any; error: any };
    expect(dryRunJson.error).toBeNull();
    expect(dryRunJson.data.source).toBe('KAGGLE');
    expect(dryRunJson.data.dryRun).toBe(true);
    expect(dryRunJson.data.errorCount).toBe(0);
    expect(dryRunJson.data.wouldCreate).toBeGreaterThan(0);

    const applyRes = await page.request.post('/api/admin/workout-library/import/kaggle', {
      headers: { Cookie: 'coachkit-role=ADMIN' },
      data: {
        dryRun: false,
        confirmApply: true,
        maxRows: 200,
        items,
      },
    });

    expect(applyRes.ok()).toBeTruthy();
    const applyJson = (await applyRes.json()) as { data: any; error: any };
    expect(applyJson.error).toBeNull();
    expect(applyJson.data.dryRun).toBe(false);
    expect(applyJson.data.createdCount).toBe(applyJson.data.wouldCreate);
    expect(Array.isArray(applyJson.data.createdIds)).toBe(true);

    const secondApplyRes = await page.request.post('/api/admin/workout-library/import/kaggle', {
      headers: { Cookie: 'coachkit-role=ADMIN' },
      data: {
        dryRun: false,
        confirmApply: true,
        maxRows: 200,
        items,
      },
    });

    expect(secondApplyRes.ok()).toBeTruthy();
    const secondApplyJson = (await secondApplyRes.json()) as { data: any; error: any };
    expect(secondApplyJson.error).toBeNull();
    expect(secondApplyJson.data.createdCount).toBe(0);
    expect(secondApplyJson.data.skippedExistingCount).toBeGreaterThan(0);

    const purgeDryRunRes = await page.request.post('/api/admin/workout-library/maintenance', {
      headers: { Cookie: 'coachkit-role=ADMIN' },
      data: {
        action: 'purgeDraftImportsBySource',
        dryRun: true,
        source: 'KAGGLE',
      },
    });

    expect(purgeDryRunRes.ok()).toBeTruthy();
    const purgeDryRunJson = (await purgeDryRunRes.json()) as { data: any; error: any };
    expect(purgeDryRunJson.error).toBeNull();
    expect(purgeDryRunJson.data.action).toBe('purgeDraftImportsBySource');
    expect(purgeDryRunJson.data.dryRun).toBe(true);
    expect(purgeDryRunJson.data.scanned).toBeGreaterThan(0);

    const purgeApplyRes = await page.request.post('/api/admin/workout-library/maintenance', {
      headers: { Cookie: 'coachkit-role=ADMIN' },
      data: {
        action: 'purgeDraftImportsBySource',
        dryRun: false,
        source: 'KAGGLE',
        confirm: 'PURGE_KAGGLE',
      },
    });

    expect(purgeApplyRes.ok()).toBeTruthy();
    const purgeApplyJson = (await purgeApplyRes.json()) as { data: any; error: any };
    expect(purgeApplyJson.error).toBeNull();
    expect(purgeApplyJson.data.action).toBe('purgeDraftImportsBySource');
    expect(purgeApplyJson.data.dryRun).toBe(false);
    expect(purgeApplyJson.data.deleted).toBeGreaterThan(0);
  });
});

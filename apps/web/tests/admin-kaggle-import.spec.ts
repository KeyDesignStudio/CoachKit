import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
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
  const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'kaggle-sample.json');
  const raw = readFileSync(fixturePath, 'utf8');
  const parsed = JSON.parse(raw) as { items: unknown[] };
  return parsed.items;
}

function withTestRunIsolation(items: unknown[], opts: { projectName: string; runTag: string }): unknown[] {
  const suffix = `[${opts.projectName}]`;

  return items.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...row };

    const title = typeof row.title === 'string' ? row.title : typeof row.name === 'string' ? row.name : 'Workout';
    next.title = `${title} ${suffix} ${opts.runTag}`;

    const tags = Array.isArray(row.tags)
      ? row.tags
      : typeof row.tags === 'string'
        ? row.tags
        : typeof row.tag === 'string'
          ? row.tag
          : '';
    next.tags = Array.isArray(tags) ? [...tags, opts.runTag] : `${tags}${tags ? ', ' : ''}${opts.runTag}`;

    const description = typeof row.description === 'string' ? row.description : '';
    next.description = `${description}${description ? '\n\n' : ''}testRun=${opts.runTag}`;

    return next;
  });
}

async function expectOk(res: import('@playwright/test').APIResponse, label: string) {
  if (res.ok()) return;
  const status = res.status();
  let body = '';
  try {
    body = await res.text();
  } catch {
    body = '<unable to read body>';
  }
  throw new Error(`${label} failed: HTTP ${status}\n${body.slice(0, 2000)}`);
}

test.describe('Admin Kaggle ingestion', () => {
  test('dry-run, apply, idempotency, and rollback purge', async ({ page }, testInfo) => {
    await setRoleCookie(page, 'ADMIN');

    const projectSlug = testInfo.project.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const runTag = `kaggle_ingest_test_${projectSlug}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const items = withTestRunIsolation(loadFixtureItems(), { projectName: testInfo.project.name, runTag });

    const dryRunRes = await page.request.post('/api/admin/workout-library/import/kaggle', {
      headers: { Cookie: 'coachkit-role=ADMIN' },
      data: {
        dryRun: true,
        confirmApply: false,
        maxRows: 200,
        items,
      },
    });

    await expectOk(dryRunRes, 'kaggle import dry-run');
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

    await expectOk(applyRes, 'kaggle import apply');
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

    await expectOk(secondApplyRes, 'kaggle import second apply');
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
        tag: runTag,
      },
    });

    await expectOk(purgeDryRunRes, 'kaggle purge dry-run');
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
        tag: runTag,
      },
    });

    await expectOk(purgeApplyRes, 'kaggle purge apply');
    const purgeApplyJson = (await purgeApplyRes.json()) as { data: any; error: any };
    expect(purgeApplyJson.error).toBeNull();
    expect(purgeApplyJson.data.action).toBe('purgeDraftImportsBySource');
    expect(purgeApplyJson.data.dryRun).toBe(false);
    expect(purgeApplyJson.data.deleted).toBeGreaterThan(0);
  });
});

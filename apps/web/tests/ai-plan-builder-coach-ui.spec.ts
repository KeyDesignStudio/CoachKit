import { expect, test } from '@playwright/test';

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

test.describe('AI Plan Builder v1: coach UI smoke (flag ON)', () => {
  test('generate → edit → persist → lock → blocked edit shows error', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'iphone16pro') test.skip();

    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();
    expect(
      process.env.AI_PLAN_BUILDER_V1 === '1' || process.env.AI_PLAN_BUILDER_V1 === 'true',
      'AI_PLAN_BUILDER_V1 must be enabled by the test harness.'
    ).toBe(true);

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;

      const text = msg.text();
      // We intentionally trigger a 409 from the draft-plan PATCH when saving edits to a locked session.
      // Chromium reports this as a console error even though the UI handles it.
      if (/Failed to load resource: the server responded with a status of 409/i.test(text)) return;

      consoleErrors.push(text);
    });

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(String(err));
    });

    await setRoleCookie(page, 'COACH');

    // Ensure dev fixtures exist (coach+athlete+athleteProfile).
    const fixtures = await page.request.post('/api/dev/strava/test-fixtures');
    expect(fixtures.ok()).toBeTruthy();

    const athleteId = 'dev-athlete';

    // Ensure intake exists + submitted so Intake Review tab has data.
    const createDraftRes = await page.request.post(
      `/api/coach/athletes/${athleteId}/ai-plan-builder/intake/draft`,
      {
        data: {
          draftJson: {
            goals: 'Build aerobic base',
            availability: { daysPerWeek: 4 },
            injuries: [],
          },
        },
      }
    );
    expect(createDraftRes.ok()).toBeTruthy();
    const createDraftJson = await createDraftRes.json();
    const intakeResponseId = createDraftJson.data.intakeResponse.id as string;

    const submitRes = await page.request.post(
      `/api/coach/athletes/${athleteId}/ai-plan-builder/intake/submit`,
      { data: { intakeResponseId } }
    );
    expect(submitRes.ok()).toBeTruthy();

    const extractRes = await page.request.post(
      `/api/coach/athletes/${athleteId}/ai-plan-builder/profile/extract`,
      { data: { intakeResponseId } }
    );
    expect(extractRes.ok()).toBeTruthy();

    await page.goto(`/coach/athletes/${athleteId}/ai-plan-builder`);

    await expect(page.getByTestId('apb-tab-intake')).toBeVisible();
    await expect(page.getByText('Latest Intake')).toBeVisible();

    await page.getByTestId('apb-tab-plan').click();
    await expect(page.getByTestId('apb-generate-draft')).toBeVisible();

    await page.getByTestId('apb-generate-draft').click();

    // Wait for sessions to render.
    const firstSession = page.locator('[data-testid="apb-session"]').first();
    await expect(firstSession).toBeVisible();

    const sessionId = (await firstSession.getAttribute('data-session-id')) as string;
    expect(sessionId).toBeTruthy();

    const durationInput = page.locator(`[data-session-id="${sessionId}"] [data-testid="apb-session-duration"]`);
    const saveButton = page.locator(`[data-session-id="${sessionId}"] [data-testid="apb-session-save"]`);
    const lockCheckbox = page.locator(`[data-session-id="${sessionId}"] [data-testid="apb-session-lock"]`);

    await durationInput.fill('42');
    await saveButton.click();

    // Reload and verify persistence.
    await page.reload();
    await page.getByTestId('apb-tab-plan').click();

    const durationInputAfter = page.locator(`[data-session-id="${sessionId}"] [data-testid="apb-session-duration"]`);
    await expect(durationInputAfter).toHaveValue('42');

    // Lock the week and verify week-locked edit is blocked.
    const weekIndexAttr = await firstSession.getAttribute('data-week-index');
    const weekIndex = weekIndexAttr ?? '0';
    const weekLock = page.locator(`[data-week-index="${weekIndex}"] [data-testid="apb-week-lock"]`);
    await weekLock.check();

    await durationInputAfter.fill('41');
    await saveButton.click();
    const weekLockedError = page.locator(`[data-session-id="${sessionId}"] [data-testid="apb-session-error"]`);
    await expect(weekLockedError).toBeVisible();
    await expect(weekLockedError).toContainText('Week is locked');

    // Reload: previous saved value should remain.
    await page.reload();
    await page.getByTestId('apb-tab-plan').click();
    const durationAfterWeekLockReload = page.locator(
      `[data-session-id="${sessionId}"] [data-testid="apb-session-duration"]`
    );
    await expect(durationAfterWeekLockReload).toHaveValue('42');

    // Unlock the week so we can test session-level lock behavior independently.
    const weekLockAfterReload = page.locator(`[data-week-index="${weekIndex}"] [data-testid="apb-week-lock"]`);
    await weekLockAfterReload.uncheck();

    // Lock and verify locked edit is blocked with a visible error message.
    await lockCheckbox.check();

    await durationInputAfter.fill('43');
    await saveButton.click();

    const sessionError = page.locator(`[data-session-id="${sessionId}"] [data-testid="apb-session-error"]`);
    await expect(sessionError).toBeVisible();
    await expect(sessionError).toContainText('Session is locked');

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

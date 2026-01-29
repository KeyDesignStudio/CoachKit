import { expect, test } from '@playwright/test';

import { seedDevCoachAndAthlete } from '../modules/ai-plan-builder/tests/seed';

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

    await seedDevCoachAndAthlete();

    const athleteId = 'dev-athlete';

    // Ensure intake exists + submitted so Intake Review tab has data.
    const createDraftRes = await page.request.post(`/api/coach/athletes/${athleteId}/ai-plan-builder/intake/draft`, {
      data: {
        draftJson: {
          goals: 'Build aerobic base',
          availability: { daysPerWeek: 4 },
          injuries: [],
        },
      },
    });
    expect(createDraftRes.ok()).toBeTruthy();
    const createDraftJson = await createDraftRes.json();
    const intakeResponseId = createDraftJson.data.intakeResponse.id as string;

    const submitRes = await page.request.post(`/api/coach/athletes/${athleteId}/ai-plan-builder/intake/submit`, {
      data: { intakeResponseId },
    });
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

    const generateOk = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`) &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      { timeout: 60_000 }
    );
    await page.getByTestId('apb-generate-draft').click();
    const generateRes = await generateOk;
    const generateJson = await generateRes.json();
    const draftPlan = generateJson.data.draftPlan;
    expect(String(draftPlan?.id ?? '')).toBeTruthy();

    const sessions = Array.isArray(draftPlan?.sessions) ? draftPlan.sessions : [];
    expect(sessions.length).toBeGreaterThan(0);
    const firstSessionFromDraft = sessions[0];

    const sessionId = String(firstSessionFromDraft.id);
    expect(sessionId).toBeTruthy();
    const sessionKey = {
      weekIndex: Number(firstSessionFromDraft.weekIndex ?? 0),
      dayOfWeek: Number(firstSessionFromDraft.dayOfWeek ?? 0),
      ordinal: Number(firstSessionFromDraft.ordinal ?? 0),
    };

    const firstSession = page.locator(`[data-testid="apb-session"][data-session-id="${sessionId}"]`);
    await expect(firstSession).toBeVisible();

    const durationInput = firstSession.locator('[data-testid="apb-session-duration"]');
    const saveButton = firstSession.locator('[data-testid="apb-session-save"]');

    // Draft generation can leave the UI in a transient busy state while background requests settle.
    await expect(saveButton).toBeEnabled({ timeout: 30_000 });
    await expect(durationInput).toBeEnabled({ timeout: 30_000 });

    await durationInput.fill('42');
    // Wait for any successful draft-plan PATCH, then validate persistence against the returned draft.
    const saveResPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`) &&
        res.request().method() === 'PATCH' &&
        res.status() === 200,
      { timeout: 30_000 }
    );
    await saveButton.click();
    const saveRes = await saveResPromise;
    const saveJson = await saveRes.json();
    const savedSessions = Array.isArray(saveJson.data.draftPlan.sessions) ? saveJson.data.draftPlan.sessions : [];
    const savedSession = savedSessions.find(
      (s: any) =>
        Number(s.weekIndex ?? 0) === sessionKey.weekIndex &&
        Number(s.dayOfWeek ?? 0) === sessionKey.dayOfWeek &&
        Number(s.ordinal ?? 0) === sessionKey.ordinal
    );
    expect(savedSession).toBeTruthy();
    expect(Number(savedSession.durationMinutes ?? 0)).toBe(42);

    const firstSessionAfterReload = page.locator(`[data-testid="apb-session"][data-session-id="${sessionId}"]`);
    await expect(firstSessionAfterReload).toBeVisible();
    const durationInputAfter = firstSessionAfterReload.locator('[data-testid="apb-session-duration"]');
    await expect(durationInputAfter).toHaveValue('42');

    // Lock the week and verify week-locked edit is blocked.
    const weekIndexAttr = await firstSessionAfterReload.getAttribute('data-week-index');
    const weekIndex = weekIndexAttr ?? '0';
    const weekLock = page.locator(`[data-week-index="${weekIndex}"] [data-testid="apb-week-lock"]`);

    const lockWeekOk = page.waitForResponse((res) => {
      if (!res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`)) return false;
      if (res.request().method() !== 'PATCH') return false;
      const body = res.request().postData() ?? '';
      return res.status() === 200 && body.includes('weekLocks');
    });
    await weekLock.check();
    await lockWeekOk;

    await durationInputAfter.fill('41');
    const saveLocked = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`) &&
        res.request().method() === 'PATCH' &&
        res.status() === 409
    );
    await firstSessionAfterReload.locator('[data-testid="apb-session-save"]').click();
    await saveLocked;

    const weekLockedError = firstSessionAfterReload.locator('[data-testid="apb-session-error"]');
    await expect(weekLockedError).toBeVisible();
    await expect(weekLockedError).toContainText('Week is locked');

    // Verify previous saved value still remains.
    const draftAfterWeekLockRes = await page.request.get(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/latest`);
    expect(draftAfterWeekLockRes.ok()).toBeTruthy();
    const draftAfterWeekLockJson = await draftAfterWeekLockRes.json();
    const sessionsAfterWeekLock = Array.isArray(draftAfterWeekLockJson.data.draftPlan.sessions)
      ? draftAfterWeekLockJson.data.draftPlan.sessions
      : [];
    const sessionAfterWeekLock = sessionsAfterWeekLock.find((s: any) => String(s.id) === String(sessionId));
    expect(sessionAfterWeekLock).toBeTruthy();
    expect(Number(sessionAfterWeekLock.durationMinutes ?? 0)).toBe(42);

    // Unlock the week so we can test session-level lock behavior independently.
    const weekLockAfterReload = page.locator(`[data-week-index="${weekIndex}"] [data-testid="apb-week-lock"]`);

    const unlockWeekOk = page.waitForResponse((res) => {
      if (!res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`)) return false;
      if (res.request().method() !== 'PATCH') return false;
      const body = res.request().postData() ?? '';
      return res.status() === 200 && body.includes('weekLocks');
    });
    await weekLockAfterReload.uncheck();
    await unlockWeekOk;

    // Lock and verify locked edit is blocked with a visible error message.
    const firstSessionForLock = page.locator(`[data-testid="apb-session"][data-session-id="${sessionId}"]`);

    const lockSessionOk = page.waitForResponse((res) => {
      if (!res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`)) return false;
      if (res.request().method() !== 'PATCH') return false;
      const body = res.request().postData() ?? '';
      return res.status() === 200 && body.includes('"locked":true');
    });
    await firstSessionForLock.locator('[data-testid="apb-session-lock"]').check();
    await lockSessionOk;
    await firstSessionForLock.locator('[data-testid="apb-session-duration"]').fill('43');
    const saveSessionLocked = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`) &&
        res.request().method() === 'PATCH' &&
        res.status() === 409
    );
    await firstSessionForLock.locator('[data-testid="apb-session-save"]').click();
    await saveSessionLocked;

    const sessionError = firstSessionForLock.locator('[data-testid="apb-session-error"]');
    await expect(sessionError).toBeVisible();
    await expect(sessionError).toContainText('Session is locked');

    // Start a fresh draft for adaptations flow so we don't depend on lock state.
    await page.getByTestId('apb-generate-draft').click();
    await expect(page.locator('[data-testid="apb-session"]').first()).toBeVisible();

    // Create a single feedback entry via API for determinism.
    const latestDraftRes = await page.request.get(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/latest`);
    expect(latestDraftRes.ok()).toBeTruthy();
    const latestDraftJson = await latestDraftRes.json();
    const aiPlanDraftId = latestDraftJson.data.draftPlan.id as string;
    const draftSessions = latestDraftJson.data.draftPlan.sessions as Array<{ id: string }>;
    expect(aiPlanDraftId).toBeTruthy();
    expect(draftSessions.length).toBeGreaterThan(0);

    const feedbackRes = await page.request.post(`/api/coach/athletes/${athleteId}/ai-plan-builder/feedback`, {
      data: {
        aiPlanDraftId,
        draftSessionId: draftSessions[0].id,
        completedStatus: 'DONE',
        feel: 'OK',
        sorenessFlag: true,
        sorenessNotes: 'leg tightness',
      },
    });
    expect(feedbackRes.ok()).toBeTruthy();

    await page.getByTestId('apb-tab-adaptations').click();
    await expect(page.getByTestId('apb-evaluate-triggers')).toBeVisible();
    await expect(page.getByTestId('apb-evaluate-generate')).toBeVisible();

    // Prefer the combined action for productivity.
    await page.getByTestId('apb-evaluate-generate').click();

    const firstProposal = page.getByTestId('apb-proposal-item').first();
    await expect(firstProposal).toBeVisible();

    // Batch approve should exist and produce a summary.
    await expect(page.getByTestId('apb-batch-approve')).toBeVisible();
    await page.getByTestId('apb-batch-approve').click();
    await expect(page.getByTestId('apb-batch-approve-summary')).toBeVisible();

    // Batch approve should clear PROPOSED items.
    await expect(page.getByText('No proposed items.')).toBeVisible();

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

import { expect, test } from '@playwright/test';

import { createAthlete, createCoach, nextTestId, seedDevCoachAndAthlete } from '../modules/ai-plan-builder/tests/seed';

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
  test('week start differs from draft → shows regenerate note + button', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'iphone16pro') test.skip();

    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();
    expect(
      process.env.AI_PLAN_BUILDER_V1 === '1' || process.env.AI_PLAN_BUILDER_V1 === 'true',
      'AI_PLAN_BUILDER_V1 must be enabled by the test harness.'
    ).toBe(true);

    await setRoleCookie(page, 'COACH');

    await createCoach({ id: 'dev-coach' });

    const athleteId = nextTestId('pw_weekstart_note');
    await createAthlete({ coachId: 'dev-coach', id: athleteId });

    await page.goto(`/coach/athletes/${athleteId}/ai-plan-builder`);
    await page.getByTestId('apb-tab-plan').click();

    const generateOk = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`) &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      { timeout: 60_000 }
    );
    await page.getByTestId('apb-generate-draft').click();
    await generateOk;

    // Change week start to differ from the persisted draft value.
    await page.getByTestId('apb-week-start').selectOption('sunday');

    await expect(page.getByTestId('apb-week-start-note')).toBeVisible();
    await expect(page.getByTestId('apb-week-start-note')).toContainText(
      'Week start changes apply when you regenerate the draft.'
    );
    await expect(page.getByTestId('apb-week-start-regenerate')).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('week-start-regenerate-note.png'), fullPage: true });
  });

  test('week start day toggle reorders day pickers (default Monday)', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'iphone16pro') test.skip();

    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();
    expect(
      process.env.AI_PLAN_BUILDER_V1 === '1' || process.env.AI_PLAN_BUILDER_V1 === 'true',
      'AI_PLAN_BUILDER_V1 must be enabled by the test harness.'
    ).toBe(true);

    await setRoleCookie(page, 'COACH');

    // Ensure dev coach exists (dev-auth prefers dev-coach for COACH role).
    await createCoach({ id: 'dev-coach' });

    const athleteId = nextTestId('pw_weekstart');
    await createAthlete({ coachId: 'dev-coach', id: athleteId });

    await page.goto(`/coach/athletes/${athleteId}/ai-plan-builder`);

    await page.getByTestId('apb-tab-plan').click();
    await expect(page.getByTestId('apb-week-start')).toBeVisible();

    // Default is Monday.
    await expect(page.getByTestId('apb-week-start')).toHaveValue('monday');
    await expect(page.locator('[data-testid="apb-available-days"] label').first()).toContainText('Mon');

    await page.screenshot({ path: testInfo.outputPath('week-start-monday.png'), fullPage: true });

    await page.getByTestId('apb-week-start').selectOption('sunday');
    await expect(page.locator('[data-testid="apb-available-days"] label').first()).toContainText('Sun');

    await page.screenshot({ path: testInfo.outputPath('week-start-sunday.png'), fullPage: true });
  });

  test('intake empty state → create intake CTA creates a draft', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'iphone16pro') test.skip();

    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();
    expect(
      process.env.AI_PLAN_BUILDER_V1 === '1' || process.env.AI_PLAN_BUILDER_V1 === 'true',
      'AI_PLAN_BUILDER_V1 must be enabled by the test harness.'
    ).toBe(true);

    await setRoleCookie(page, 'COACH');

    // Ensure dev coach exists (dev-auth prefers dev-coach for COACH role).
    await createCoach({ id: 'dev-coach' });

    // Use a unique athlete ID to avoid bleeding state between runs.
    const athleteId = nextTestId('pw_athlete_empty');
    await createAthlete({ coachId: 'dev-coach', id: athleteId });

    await page.goto(`/coach/athletes/${athleteId}/ai-plan-builder`);

    await expect(page.getByTestId('apb-tab-intake')).toBeVisible();
    await expect(page.getByText('Latest Intake')).toBeVisible();
    await expect(page.getByText('No intake found.')).toBeVisible();

    // Screenshot of the new empty state (with CTA visible).
    await page.screenshot({ path: testInfo.outputPath('intake-review-empty-state.png'), fullPage: true });

    const createOk = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/intake/draft`) &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      { timeout: 30_000 }
    );

    await expect(page.getByTestId('apb-create-intake')).toBeVisible();
    await page.getByTestId('apb-create-intake').click();
    await createOk;

    // Latest intake panel should now show a draft intake.
    await expect(page.getByText('Intake ID:')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Status:\s*DRAFT/i)).toBeVisible({ timeout: 30_000 });

    // Evidence should no longer show the empty prompt.
    await expect(page.getByText('Load an intake to view evidence.')).toHaveCount(0);
  });

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

      // Next.js app-router can log this as an error under heavy parallel load.
      // The page still navigates correctly via fallback.
      if (/Failed to fetch RSC payload/i.test(text)) return;

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

    // Open proposal and verify human-readable preview is visible.
    await firstProposal.click();
    await expect(page.getByTestId('apb-proposal-detail')).toBeVisible();
    await expect(page.getByTestId('apb-proposal-preview')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('apb-proposal-preview').getByText(/Week\s+\d+/).first()).toBeVisible();

    // Approve & Publish in one flow.
    const approvePublishOk = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/proposals/`) &&
        res.url().includes('/approve-and-publish') &&
        res.request().method() === 'POST' &&
        res.status() === 200,
      { timeout: 60_000 }
    );
    await page.getByTestId('apb-proposal-approve-publish').click();
    const approvePublishRes = await approvePublishOk;
    const approvePublishJson = await approvePublishRes.json().catch(() => null);

    const publishOkFlag = Boolean(approvePublishJson?.data?.publish?.ok);
    if (!publishOkFlag) {
      const publishNowButton = page.getByTestId('apb-publish-now');
      if (await publishNowButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
        const publishNowOk = page.waitForResponse(
          (res) =>
            res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/publish`) &&
            res.request().method() === 'POST' &&
            res.status() === 200,
          { timeout: 60_000 }
        );
        await publishNowButton.click();
        await publishNowOk;
      } else {
        const publishRes = await page.request.post(
          `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/publish`,
          { data: { aiPlanDraftId } }
        );
        expect(publishRes.ok()).toBeTruthy();
      }
    }

    // Switch to athlete view and confirm update banner + changes panel.
    await setRoleCookie(page, 'ATHLETE');
    await page.goto('/athlete/ai-plan');
    await expect(page.getByText('AI Plan')).toBeVisible();
    await expect(page.getByText('Plan updated')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('athlete-view-changes')).toBeVisible();

    await page.getByTestId('athlete-view-changes').click();
    await expect(page.getByTestId('athlete-changes-panel')).toBeVisible();
    await expect(page.getByTestId('athlete-change-audit').first()).toBeVisible();

    // Switch back to coach so we can verify batch approve still exists.
    await setRoleCookie(page, 'COACH');
    await page.goto(`/coach/athletes/${athleteId}/ai-plan-builder`);
    await page.getByTestId('apb-tab-adaptations').click();

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

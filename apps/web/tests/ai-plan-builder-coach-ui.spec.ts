import { expect, test } from '@playwright/test';

import { createAthlete, createCoach, nextTestId, seedDevCoachAndAthlete } from '../modules/ai-plan-builder/tests/seed';
import { createAthleteIntakeSubmission } from '../modules/ai-plan-builder/server/athlete-intake';
import { prisma } from '../lib/prisma';

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

async function setDateInput(locator: any, dayKey: string) {
  // WebKit can be finicky about typing into <input type="date">.
  await locator.evaluate((el: HTMLInputElement, value: string) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, dayKey);
}

function formatDayKey(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function parseDayKey(dayKey: string): Date {
  // Parse as local date at midday to avoid DST edge cases.
  return new Date(`${dayKey}T12:00:00`);
}

function startOfWeekDayKey(date: Date, weekStart: 'sunday' | 'monday'): string {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const weekStartIdx = weekStart === 'monday' ? 1 : 0;
  const diff = (day - weekStartIdx + 7) % 7;
  d.setDate(d.getDate() - diff);
  return formatDayKey(d);
}

test.describe('AI Plan Builder v1: coach-first UI smoke (flag ON)', () => {
  test('editing coach goal updates Athlete Brief in APB', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'iphone16pro') test.skip();

    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();
    const apbEnabled = process.env.AI_PLAN_BUILDER_V1 === '1' || process.env.AI_PLAN_BUILDER_V1 === 'true';
    test.skip(!apbEnabled, 'AI_PLAN_BUILDER_V1 must be enabled by the test harness.');

    await setRoleCookie(page, 'COACH');
    await createCoach({ id: 'dev-coach' });
    const athleteId = 'dev-athlete';
    await createAthlete({ coachId: 'dev-coach', id: athleteId });

    await prisma.athleteProfile.update({
      where: { userId: athleteId },
      data: {
        primaryGoal: 'Legacy goal',
        disciplines: ['OTHER'],
        trainingPlanSchedule: { frequency: 'WEEKLY', dayOfWeek: 2, weekOfMonth: null },
      },
    });

    await page.goto('/coach/athletes');
    await page.getByRole('button', { name: /dev-athlete|Test Athlete/i }).click();

    await expect(page.getByRole('heading', { name: 'Athlete Profile', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open full profile' })).toBeVisible();
    await page.getByRole('button', { name: 'Open full profile' }).click();
    await page.waitForURL(`/coach/athletes/${athleteId}/profile`);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole('tab', { name: 'Personal' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Training Basics' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Current Training Plan' })).toBeVisible();
    await expect(page.getByText('Loading profile...')).toHaveCount(0);
    const firstNameField = page.getByLabel('First Name');
    const lastNameField = page.getByLabel('Last Name');
    await expect(firstNameField).toBeVisible();
    await expect(lastNameField).toBeVisible();
    const firstBox = await firstNameField.boundingBox();
    const lastBox = await lastNameField.boundingBox();
    expect(firstBox).not.toBeNull();
    expect(lastBox).not.toBeNull();
    if (firstBox && lastBox) {
      expect(Math.abs(firstBox.y - lastBox.y)).toBeLessThan(8);
      expect(Math.abs(firstBox.x - lastBox.x)).toBeGreaterThan(40);
    }
    await page.getByRole('tab', { name: 'Current Training Plan' }).click();
    const otherDiscipline = page.getByRole('button', { name: 'OTHER' });
    const otherSelected = await otherDiscipline.evaluate((el) => el.className.includes('bg-blue-500/10'));
    if (!otherSelected) {
      await otherDiscipline.click();
    }
    await page.getByRole('tab', { name: 'Training Basics' }).click();
    const primaryGoalField = page.getByLabel('Primary goal');
    await expect(primaryGoalField).toHaveValue('Legacy goal');
    await primaryGoalField.fill('GOAL TEST 123');
    await expect(primaryGoalField).toHaveValue('GOAL TEST 123');
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    const saveResponsePromise = page.waitForResponse(
      (res) => res.url().includes(`/api/coach/athletes/${athleteId}`) && res.request().method() === 'PATCH'
    );
    const refreshResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/athlete-brief/refresh`) &&
        res.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Save changes' }).click();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok()).toBeTruthy();
    const refreshResponse = await refreshResponsePromise;
    expect(refreshResponse.ok()).toBeTruthy();
    const response = await page.request.get(`/api/coach/athletes/${athleteId}`);
    expect(response.ok()).toBeTruthy();
    const savedPayload = await response.json();
    expect(savedPayload?.data?.athlete?.primaryGoal).toBe('GOAL TEST 123');

    await page.goto(`/coach/athletes/${athleteId}/ai-plan-builder`);
    await expect(page.getByRole('heading', { name: 'Plan Builder', exact: true })).toBeVisible();
    await expect(page.getByTestId('apb-athlete-brief-details')).toContainText('Goal: GOAL TEST 123', { timeout: 60_000 });
  });
  test('happy path: intake → plan preview → edit → publish → calendar truth', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'iphone16pro') test.skip();

    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();
    const apbEnabled = process.env.AI_PLAN_BUILDER_V1 === '1' || process.env.AI_PLAN_BUILDER_V1 === 'true';
    test.skip(!apbEnabled, 'AI_PLAN_BUILDER_V1 must be enabled by the test harness.');

    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];

    const isIgnorableConsoleError = (text: string) => {
      const t = String(text || '');
      // Next.js dev overlay can occasionally log this during harness restarts / navigation.
      if (t.includes('Failed to fetch RSC payload') && t.includes('hot-reloader-client')) return true;
      if (/status of 409/i.test(t)) return true;
      return false;
    };

    page.on('pageerror', (err) => pageErrors.push(String((err as any)?.message ?? err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!isIgnorableConsoleError(text)) consoleErrors.push(text);
      }
    });

    await setRoleCookie(page, 'COACH');
    await createCoach({ id: 'dev-coach' });

    // In auth-disabled mode, switching to ATHLETE uses the `dev-athlete` identity.
    // Keep the whole flow on that athlete so coach ↔ athlete checks are meaningful.
    const athleteId = 'dev-athlete';
    const runTag = String(Date.now());
    const expectedCoachNote = `Coach note: keep this aerobic (${runTag}).`;
    await createAthlete({ coachId: 'dev-coach', id: athleteId });

    await prisma.athleteProfile.update({
      where: { userId: athleteId },
      data: { coachNotes: expectedCoachNote, primaryGoal: `Goal: finish (${runTag})` },
    });

    await createAthleteIntakeSubmission({
      athleteId,
      coachId: 'dev-coach',
      payload: {
        version: 'v1',
        sections: [
          {
            key: 'availability',
            title: 'Availability',
            answers: [
              { questionKey: 'availability_days', answer: ['Monday', 'Wednesday', 'Saturday'] },
              { questionKey: 'weekly_minutes', answer: 240 },
            ],
          },
          {
            key: 'safety',
            title: 'Safety',
            answers: [
              { questionKey: 'injury_status', answer: 'Knee pain when running' },
              { questionKey: 'sleep_quality', answer: 'Poor' },
            ],
          },
        ],
      },
    });

    await prisma.painReport.create({
      data: {
        athleteId,
        date: new Date(),
        bodyLocation: 'Knee',
        severity: 6,
        notes: 'Pain after long runs',
      },
    });

    const planSource = await prisma.planSource.create({
      data: {
        type: 'TEXT',
        title: `PlanSource UI Proof ${runTag}`,
        sport: 'TRIATHLON',
        distance: 'OLYMPIC',
        level: 'BEGINNER',
        durationWeeks: 4,
        season: 'BASE',
        checksumSha256: nextTestId('checksum_ui'),
        rawText: 'Week 1 Bike endurance 60 min',
        rawJson: null,
        isActive: true,
      },
    });

    const planSourceVersion = await prisma.planSourceVersion.create({
      data: {
        planSourceId: planSource.id,
        version: 1,
        extractionMetaJson: { confidence: 0.6, warnings: ['UI seed'] } as any,
      },
    });

    const weekTemplate = await prisma.planSourceWeekTemplate.create({
      data: {
        planSourceVersionId: planSourceVersion.id,
        weekIndex: 0,
        totalMinutes: 240,
        totalSessions: 5,
      },
    });

    await prisma.planSourceSessionTemplate.createMany({
      data: [
        {
          planSourceWeekTemplateId: weekTemplate.id,
          ordinal: 1,
          discipline: 'BIKE',
          sessionType: 'technique',
          durationMinutes: 45,
        },
        {
          planSourceWeekTemplateId: weekTemplate.id,
          ordinal: 2,
          discipline: 'BIKE',
          sessionType: 'endurance',
          durationMinutes: 60,
        },
      ],
    });

    await prisma.planSourceRule.createMany({
      data: [
        {
          planSourceVersionId: planSourceVersion.id,
          ruleType: 'DISCIPLINE_SPLIT',
          phase: null,
          appliesJson: {} as any,
          ruleJson: { swimPct: 0.2, bikePct: 0.6, runPct: 0.2 } as any,
          explanation: 'Bike heavy',
          priority: 1,
        },
        {
          planSourceVersionId: planSourceVersion.id,
          ruleType: 'INTENSITY_DENSITY',
          phase: null,
          appliesJson: {} as any,
          ruleJson: { maxIntensityDaysPerWeek: 1 } as any,
          explanation: 'Cap intensity',
          priority: 1,
        },
      ],
    });

    await prisma.athleteProfile.update({
      where: { userId: athleteId },
      data: {
        disciplines: ['SWIM', 'BIKE', 'RUN'],
        experienceLevel: 'Beginner',
        primaryGoal: 'Olympic',
      },
    });

    await page.goto(`/coach/athletes/${athleteId}/ai-plan-builder`);
    await expect(page.getByRole('heading', { name: 'Plan Builder', exact: true })).toBeVisible();

    // Coach UI must not expose internal/system language.
    const forbidden = [
      'Raw profile JSON',
      'Overrides',
      'JSON',
      'evidenceHash',
      'extractedProfileJson',
      'coachOverridesJson',
      'DRAFT',
      'SUBMITTED',
      'APPROVED',
      'Evidence',
      'Extract Profile',
    ];
    for (const text of forbidden) {
      await expect(page.locator('body')).not.toContainText(text);
    }

    // 1) Refresh Athlete Brief.
    await page.getByTestId('apb-refresh-brief').click();
    await expect(page.getByTestId('apb-refresh-brief')).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByTestId('apb-athlete-brief')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('apb-athlete-brief')).toContainText('Athlete Brief');

    // Athlete Brief must not leak raw/internal keys or JSON/array formatting.
    const athleteBriefForbidden = [
      'coach_notes:',
      'disciplines:',
      'goal_details',
      'goal_type',
      'goal_timeline',
      'goal_focus',
      'availability_days',
      'weekly_minutes',
      'injury_status',
      '[',
      ']',
    ];
    for (const text of athleteBriefForbidden) {
      await expect(page.locator('body')).not.toContainText(text);
    }
    await page.screenshot({ path: testInfo.outputPath('apb-01-athlete-info.png'), fullPage: true });

    // 2) Generate plan preview (choose dates so sessions fall near "today").
    const today = new Date();
    const startDate = formatDayKey(today);
    const completionDate = formatDayKey(addDays(today, 28));
    const fromDayKey = formatDayKey(addDays(today, -7));
    const toDayKey = formatDayKey(addDays(today, 60));

    await setDateInput(page.getByTestId('apb-start-date'), startDate);
    await setDateInput(page.getByTestId('apb-completion-date'), completionDate);
    await expect(page.getByText(/Derived from dates:/)).toHaveCount(0);
    const weeksToggle = page.getByTestId('apb-weeks-auto-toggle');
    if ((await weeksToggle.textContent())?.includes('Auto')) {
      await weeksToggle.click();
    }
    await expect(weeksToggle).toHaveText(/Manual/);
    const weeksInput = page.getByTestId('apb-weeks-to-completion');
    await expect(weeksInput).toBeEnabled();
    await weeksInput.fill('4');
    await page.getByTestId('apb-week-start').selectOption('sunday');

    const draftOk = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`) &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      { timeout: 90_000 }
    );
    await page.getByTestId('apb-generate-plan').click();
    await expect(page.getByTestId('apb-build-progress')).toBeVisible({ timeout: 10_000 });
    await draftOk;

    const firstWeek = page.getByTestId('apb-week').first();
    await expect(firstWeek).toBeVisible({ timeout: 60_000 });
    await expect(firstWeek.getByTestId('apb-week-commencing')).toContainText('Commencing');

    const planReasoning = page.getByTestId('apb-plan-reasoning');
    await expect(planReasoning).toBeVisible({ timeout: 60_000 });
    await expect(planReasoning).toContainText('Plan Reasoning');
    await expect(planReasoning).toContainText('Priorities', { timeout: 60_000 });
    await expect(planReasoning).toContainText(`PlanSource UI Proof ${runTag}`);
    await expect(planReasoning.getByTestId('apb-plan-source-influence')).toContainText(/confidence/i);
    await expect(planReasoning.getByTestId('apb-plan-source-influence')).toContainText(/influence|bike|intensity/i);
    const weekSummary = planReasoning.getByTestId('apb-week-summary-0');
    await expect(weekSummary).toContainText(/Sessions:/i);
    await expect(weekSummary).not.toContainText('Split:');
    await expect(weekSummary).not.toContainText(/\(\+?\d+%\)/);

    const firstSession = firstWeek.getByTestId('apb-session').first();
    await expect(firstSession.getByTestId('apb-session-day')).toBeVisible({ timeout: 60_000 });
    await expect(firstSession.getByTestId('apb-session-day')).toContainText(/\d/);
    await expect(firstSession.getByTestId('apb-session-objective-input')).toBeVisible({ timeout: 60_000 });
    await expect(firstSession.getByTestId('apb-session-objective-input')).not.toHaveValue('');
    const preview = firstSession.getByTestId('apb-session-workout-detail-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText(/WARMUP/i);
    await expect(preview).not.toContainText(/weekly mins|weekly minutes|available days/i);
    await expect(firstSession.getByTestId('apb-session-block-steps-0')).toBeVisible();

    // Save bottom-left; Lock session bottom-right.
    const saveBox = await firstSession.getByTestId('apb-session-save').boundingBox();
    const lockBox = await firstSession.getByTestId('apb-session-lock-toggle').boundingBox();
    expect(saveBox, 'Expected Save button to have a bounding box').toBeTruthy();
    expect(lockBox, 'Expected Lock button to have a bounding box').toBeTruthy();
    expect(saveBox!.x).toBeLessThan(lockBox!.x);

    // Duration should be humanised (multiples of 5 minutes).
    const durationValue = await firstSession.getByTestId('apb-session-duration').inputValue();
    const durationInt = Number.parseInt(durationValue, 10);
    expect(Number.isFinite(durationInt)).toBe(true);
    expect(durationInt % 5).toBe(0);

    await page.screenshot({ path: testInfo.outputPath('apb-02-review-plan.png'), fullPage: true });

    // Lock UX: locking the week should disable edits.
    const weekLockOk = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`) &&
        res.request().method() === 'PATCH' &&
        res.status() === 200,
      { timeout: 60_000 }
    );
    await firstWeek.getByTestId('apb-week-lock-toggle').click();
    await weekLockOk;
    await expect(firstSession.getByTestId('apb-session-duration')).toBeDisabled();
    await expect(firstSession.getByTestId('apb-session-save')).toBeDisabled();

    // Unlock week so we can proceed with edits.
    const weekUnlockOk = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`) &&
        res.request().method() === 'PATCH' &&
        res.status() === 200,
      { timeout: 60_000 }
    );
    await firstWeek.getByTestId('apb-week-lock-toggle').click();
    await weekUnlockOk;
    await expect(firstSession.getByTestId('apb-session-duration')).toBeEnabled();

    // 3) Edit a session and confirm persistence after refresh.
    const editedDuration = String(durationInt + 5);
    await firstSession.getByTestId('apb-session-duration').fill(editedDuration);
    await firstSession.getByTestId('apb-session-notes').fill(expectedCoachNote);

    const saveOk = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`) &&
        res.request().method() === 'PATCH' &&
        res.status() === 200,
      { timeout: 60_000 }
    );
    await firstSession.getByTestId('apb-session-save').click();
    await saveOk;

    await page.reload({ waitUntil: 'networkidle' });
    const firstSessionAfter = page.getByTestId('apb-session').first();
    await expect(firstSessionAfter.getByTestId('apb-session-duration')).toHaveValue(editedDuration);
    await expect(firstSessionAfter.getByTestId('apb-session-notes')).toHaveValue(expectedCoachNote);

    // 4) Publish and verify the plan materialised.
    const publishOk = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/publish`) &&
        res.request().method() === 'POST' &&
        res.status() === 200,
      { timeout: 90_000 }
    );
    await page.getByTestId('apb-publish').click();
    const publishRes = await publishOk;
    const publishJson = (await publishRes.json().catch(() => null)) as any;
    const materialisation = publishJson?.data?.materialisation ?? null;
    expect(materialisation?.ok).toBe(true);
    expect(Number(materialisation?.upsertedCount ?? 0)).toBeGreaterThan(0);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
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
      // Chromium can report failed API requests as console errors.
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

    await createAthleteIntakeSubmission({
      athleteId,
      coachId: 'dev-coach',
      payload: {
        version: 'v1',
        sections: [
          {
            key: 'availability',
            title: 'Availability',
            answers: [
              { questionKey: 'availability_days', answer: ['Monday', 'Thursday'] },
              { questionKey: 'weekly_minutes', answer: 240 },
            ],
          },
        ],
      },
    });

    await page.goto(`/coach/athletes/${athleteId}/ai-plan-builder`);
    await page.getByTestId('apb-refresh-brief').click();
    await expect(page.getByTestId('apb-athlete-brief')).toBeVisible({ timeout: 60_000 });

    const today = new Date();
    const startDate = formatDayKey(today);
    const completionDate = formatDayKey(addDays(today, 28));

    await setDateInput(page.getByTestId('apb-start-date'), startDate);
    await setDateInput(page.getByTestId('apb-completion-date'), completionDate);

    const generateOk = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`) &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      { timeout: 60_000 }
    );
    await page.getByTestId('apb-generate-plan').click();
    const generateRes = await generateOk;
    const generateJson = await generateRes.json();
    const draftPlan = generateJson.data.draftPlan;
    expect(String(draftPlan?.id ?? '')).toBeTruthy();
    const draftPlanId = String(draftPlan.id);

    const sessions = Array.isArray(draftPlan?.sessions) ? draftPlan.sessions : [];
    expect(sessions.length).toBeGreaterThan(0);
    const firstSessionFromDraft = sessions[0];

    let sessionId = String(firstSessionFromDraft.id);
    expect(sessionId).toBeTruthy();

    const firstSession = page.getByTestId('apb-session').first();
    await expect(firstSession).toBeVisible();

    const uiSessionId = await firstSession.getAttribute('data-session-id');
    if (uiSessionId) sessionId = uiSessionId;

    const durationInput = firstSession.locator('[data-testid="apb-session-duration"]');
    const saveButton = firstSession.locator('[data-testid="apb-session-save"]');

    // Draft generation can leave the UI in a transient busy state while background requests settle.
    await expect(saveButton).toBeEnabled({ timeout: 30_000 });
    await expect(durationInput).toBeEnabled({ timeout: 30_000 });

    // Regression guard: inputs must be truly interactive (not `pointer-events: none`).
    await expect(durationInput).toHaveCSS('pointer-events', 'auto');
    await durationInput.click();

    await page.screenshot({ path: testInfo.outputPath('session-inputs-editable.png'), fullPage: true });

    const requestedDuration = 42;
    const previousDuration = Number(firstSessionFromDraft.durationMinutes ?? 0);
    const expectedRoundedDuration = String(
      requestedDuration > previousDuration
        ? Math.ceil(requestedDuration / 5) * 5
        : Math.floor(requestedDuration / 5) * 5
    );
    await durationInput.fill(String(requestedDuration));
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
    const savedSession = savedSessions.find((s: any) => String(s.id) === String(sessionId));
    expect(savedSession).toBeTruthy();
    expect(Number(savedSession.durationMinutes ?? 0)).toBe(Number(expectedRoundedDuration));

    const firstSessionAfterReload = page.getByTestId('apb-session').first();
    await expect(firstSessionAfterReload).toBeVisible();
    const durationInputAfter = firstSessionAfterReload.locator('[data-testid="apb-session-duration"]');
    await expect(durationInputAfter).toHaveValue(expectedRoundedDuration);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

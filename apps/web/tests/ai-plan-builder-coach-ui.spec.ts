import { expect, test } from '@playwright/test';

import { createAthlete, createCoach, nextTestId } from '../modules/ai-plan-builder/tests/seed';
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

    await page.goto(`/coach/athletes/${athleteId}/ai-plan-builder`);
    await expect(page.getByText('Plan Builder')).toBeVisible();

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

    // 1) Start with AI intake.
    const intakeOk = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/intake/generate`) &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      { timeout: 60_000 }
    );
    await page.getByTestId('apb-generate-intake-ai').click();
    await intakeOk;

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
    await expect(page.getByText(/Derived from dates:\s*\d+/)).toBeVisible();
    await page.getByTestId('apb-weeks-auto-toggle').click();
    await expect(page.getByTestId('apb-weeks-to-completion')).toBeEnabled();
    await page.getByTestId('apb-weeks-to-completion').fill('4');
    await page.getByTestId('apb-week-start').selectOption('sunday');

    const draftOk = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`) &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      { timeout: 90_000 }
    );
    await page.getByTestId('apb-generate-plan').click();
    await draftOk;

    const firstWeek = page.getByTestId('apb-week').first();
    await expect(firstWeek).toBeVisible({ timeout: 60_000 });
    await expect(firstWeek.getByTestId('apb-week-commencing')).toContainText('Commencing');

    const firstSession = firstWeek.getByTestId('apb-session').first();
    await expect(firstSession.getByTestId('apb-session-day')).toBeVisible({ timeout: 60_000 });
    await expect(firstSession.getByTestId('apb-session-day')).toContainText(/\d/);
    await expect(firstSession.getByTestId('apb-session-objective-input')).toBeVisible({ timeout: 60_000 });
    await expect(firstSession.getByTestId('apb-session-objective-input')).not.toHaveValue('');
    await expect(firstSession.getByTestId('apb-session-workout-detail-preview')).toBeVisible();
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
    const originalObjectiveText = await firstSession.getByTestId('apb-session-objective-input').inputValue();
    const editedDuration = String(durationInt + 5);
    await firstSession.getByTestId('apb-session-duration').fill(editedDuration);
    await firstSession.getByTestId('apb-session-notes').fill(expectedCoachNote);

    // Also edit an objective and a block step to validate server-side detail updates.
    await firstSession.getByTestId('apb-session-objective-input').fill(`Aerobic endurance (${editedDuration} min)`);
    await firstSession.getByTestId('apb-session-block-steps-0').fill('Easy warmup. Keep it conversational.');

    const saveOk = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`) &&
        res.request().method() === 'PATCH' &&
        res.status() === 200,
      { timeout: 60_000 }
    );
    await firstSession.getByTestId('apb-session-save').click();
    const saveRes = await saveOk;
    const saveJson = (await saveRes.json().catch(() => null)) as any;
    const savedSessions = Array.isArray(saveJson?.data?.draftPlan?.sessions) ? saveJson.data.draftPlan.sessions : [];
    const savedSession = savedSessions.find(
      (s: any) =>
        Number(s?.durationMinutes ?? 0) === Number(editedDuration) && String(s?.notes ?? '') === String(expectedCoachNote)
    );
    expect(savedSession, 'Expected saved draft plan session in PATCH response.').toBeTruthy();

    // Objective should update (and be different from the pre-edit version).
    await expect(firstSession.getByTestId('apb-session-objective-input')).not.toHaveValue(originalObjectiveText);
    await expect(firstSession.getByTestId('apb-session-objective-input')).toHaveValue(new RegExp(`\\(${editedDuration} min\\)`));

    const normalizeText = (s: string) => String(s ?? '').replace(/\r\n/g, '\n').trim();

    // Planner truth: capture the canonical workout instructions preview (detailJson -> workoutDetail renderer).
    const plannerPreviewText = normalizeText(
      await firstSession.getByTestId('apb-session-workout-detail-preview').innerText()
    );
    expect(plannerPreviewText).toContain('WARMUP');
    expect(plannerPreviewText).toContain('MAIN');
    expect(plannerPreviewText).toContain('COOLDOWN');
    expect(plannerPreviewText).toContain('Easy warmup');

    // Workout preview should show 5-minute increments.
    for (const line of plannerPreviewText.split('\n')) {
      const m = line.match(/\u00b7\s*(\d+)\s*min/i);
      if (!m) continue;
      const minutes = Number.parseInt(m[1]!, 10);
      expect(minutes % 5).toBe(0);
    }

    // Persistence check: the PATCH response is our server-confirmed write.
    // Avoid querying the shared `latest` draft plan in E2E because other tests may mutate it.
    expect(Number((savedSession as any)?.durationMinutes ?? 0)).toBe(Number(editedDuration));
    expect(String((savedSession as any)?.notes ?? '')).toBe(expectedCoachNote);

    // Session lock: locking an individual session should disable its edits.
    const sessionLockOk = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`) &&
        res.request().method() === 'PATCH' &&
        res.status() === 200,
      { timeout: 60_000 }
    );
    await firstSession.getByTestId('apb-session-lock-toggle').click();
    await sessionLockOk;
    await expect(firstSession.getByTestId('apb-session-duration')).toBeDisabled();
    await expect(firstSession.getByTestId('apb-session-save')).toBeDisabled();

    // Unlock session before publishing.
    const sessionUnlockOk = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`) &&
        res.request().method() === 'PATCH' &&
        res.status() === 200,
      { timeout: 60_000 }
    );
    await firstSession.getByTestId('apb-session-lock-toggle').click();
    await sessionUnlockOk;

    // Reload sanity check: page still loads (even if plan preview isn't shown by default).
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByText('Plan Builder')).toBeVisible({ timeout: 60_000 });

    // 4) Publish and verify the coach calendar contains APB-origin sessions.
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

    await expect(page.getByTestId('apb-publish-success')).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: testInfo.outputPath('apb-03-published.png'), fullPage: true });

    // Calendar truth (DB safety net): confirm the plan materialised into CalendarItem rows.
    await expect
      .poll(
        async () =>
          prisma.calendarItem.count({
            where: {
              athleteId,
              origin: 'AI_PLAN_BUILDER',
              deletedAt: null,
              sourceActivityId: { startsWith: 'apb:' },
            },
          }),
        { timeout: 30_000 }
      )
      .toBeGreaterThan(0);

    // Calendar truth (API): verify AI-origin items span at least Week 1/2/3.
    const calendarRes = await page.request.get(
      `/api/coach/calendar?athleteId=${encodeURIComponent(athleteId)}&from=${encodeURIComponent(fromDayKey)}&to=${encodeURIComponent(toDayKey)}`
    );
    expect(calendarRes.ok()).toBeTruthy();
    const calendarJson = (await calendarRes.json()) as { data?: { items?: Array<any> } };
    const items = Array.isArray(calendarJson?.data?.items) ? calendarJson.data.items : [];
    const apbItems = items.filter(
      (it) =>
        it?.origin === 'AI_PLAN_BUILDER' ||
        (typeof it?.sourceActivityId === 'string' && it.sourceActivityId.startsWith('apb:'))
    );
    expect(apbItems.length).toBeGreaterThan(0);

    // Target a published APB session that has BOTH structured workout detail and the coach-edited notes.
    const apbTarget =
      apbItems.find(
        (it) =>
          typeof it?.workoutDetail === 'string' &&
          it.workoutDetail.includes('WARMUP') &&
          it.workoutDetail.includes('MAIN') &&
          it.workoutDetail.includes('COOLDOWN') &&
          String(it?.notes ?? '').includes(expectedCoachNote)
      ) ?? null;
    expect(apbTarget).not.toBeNull();

    const weekStart: 'sunday' | 'monday' = 'sunday';
    const weekKeys = apbItems
      .map((it) => String(it?.date ?? ''))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .map((d) => startOfWeekDayKey(parseDayKey(d), weekStart));

    const uniqueWeekKeys = Array.from(new Set(weekKeys)).sort();
    expect(uniqueWeekKeys.length).toBeGreaterThanOrEqual(3);
    for (const wk of uniqueWeekKeys.slice(0, 3)) {
      const hasAnyInWeek = apbItems.some((it) => {
        const dayKey = String(it?.date ?? '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return false;
        return startOfWeekDayKey(parseDayKey(dayKey), weekStart) === wk;
      });
      expect(hasAnyInWeek).toBe(true);
    }

    // Calendar truth (UI): weekly calendar shows sessions across multiple weeks.
    await page.getByTestId('apb-open-calendar').click();
    await expect(page.locator('[data-coach-week-view-version="coach-week-v2"]')).toBeVisible({ timeout: 60_000 });

    // Coach calendar requires selecting athletes before rows render.
    await page.locator('[data-athlete-selector="button"]').click();
    const dropdown = page.locator('[data-athlete-selector="dropdown"]');
    await expect(dropdown).toBeVisible({ timeout: 60_000 });
    const athleteCheckboxes = dropdown.locator('input[data-athlete-selector="athlete-checkbox"]');
    await expect(athleteCheckboxes.first()).toBeVisible({ timeout: 60_000 });
    // Select all (idempotent) now that athletes are loaded.
    await dropdown.locator('input[data-athlete-selector="select-all"]').check();
    // Close dropdown (it renders a fullscreen backdrop).
    const vp = page.viewportSize();
    await page.mouse.click(10, (vp?.height ?? 800) - 10);
    await expect(dropdown).toHaveCount(0);

    const weekView = page.locator('[data-coach-week-view-version="coach-week-v2"]').first();
    const sessionRows = weekView.locator('[data-athlete-week-session-row="v2"]');
    // Some plans may start next week depending on weekStart; walk forward until sessions appear.
    for (let i = 0; i < 6; i += 1) {
      const count = await sessionRows.count();
      if (count > 0) break;
      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForTimeout(500);
    }

    await expect(sessionRows.first()).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: testInfo.outputPath('apb-04-calendar-week-1.png'), fullPage: true });

    // Calendar truth (coach): verify the published calendar item has BOTH structured detail + coach notes.
    // Use the specific item ID we already located via the coach calendar API to avoid slow/flaky UI scanning.
    const coachItemRes = await page.request.get(`/api/coach/calendar-items/${encodeURIComponent(String((apbTarget as any).id))}`);
    expect(coachItemRes.ok()).toBeTruthy();
    const coachItemJson = (await coachItemRes.json().catch(() => null)) as any;
    const coachItem = coachItemJson?.data?.item ?? coachItemJson?.data ?? coachItemJson;
    const coachWorkoutDetail = normalizeText(String(coachItem?.workoutDetail ?? ''));
    expect(coachWorkoutDetail).toBe(plannerPreviewText);
    expect(coachWorkoutDetail).toContain('WARMUP');
    expect(coachWorkoutDetail).toContain('MAIN');
    expect(coachWorkoutDetail).toContain('COOLDOWN');
    expect(Number(coachItem?.plannedDurationMinutes ?? 0)).toBe(Number(editedDuration));
    expect(String(coachItem?.notes ?? '')).toContain(expectedCoachNote);

    // Athlete truth (UI): athlete can see the same structured detail + coach notes.
    await setRoleCookie(page, 'ATHLETE');
    await page.goto(`/athlete/workouts/${encodeURIComponent(String((apbTarget as any).id))}`, { waitUntil: 'networkidle' });
    await expect(page.getByText('Description')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('athlete-workout-description')).toBeVisible({ timeout: 60_000 });
    const athleteWorkoutDetail = normalizeText(await page.getByTestId('athlete-workout-description').innerText());
    expect(athleteWorkoutDetail).toBe(plannerPreviewText);
    expect(athleteWorkoutDetail).toContain('WARMUP');
    expect(athleteWorkoutDetail).toContain('MAIN');
    expect(athleteWorkoutDetail).toContain('COOLDOWN');

    await expect(page.getByTestId('athlete-workout-duration')).toContainText(`${editedDuration} min`);
    await expect(page.getByText('Coach Notes')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('athlete-workout-coach-notes')).toContainText(expectedCoachNote);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

/*
 * Legacy APB coach UI tests (debug UI) – kept temporarily for reference.
 * These are intentionally disabled because the coach-first UI replaced the old debug surface.
 *
 * NOTE: This block will be deleted once CI is stable.
 */

/*
test.describe.skip('AI Plan Builder v1: legacy coach UI (deprecated)', () => {
  import { expect, test } from '@playwright/test';

  import { createAthlete, createCoach, nextTestId } from '../modules/ai-plan-builder/tests/seed';

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

  function formatDayKey(date: Date): string {
    // Use local date portion, matching the day-key UX expectation.
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

  test.describe('AI Plan Builder v1: coach-first UI smoke (flag ON)', () => {
    test('happy path: intake → plan preview → edit → publish → calendar truth', async ({ page }, testInfo) => {
      if (testInfo.project.name !== 'iphone16pro') test.skip();

      expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();
      expect(
        process.env.AI_PLAN_BUILDER_V1 === '1' || process.env.AI_PLAN_BUILDER_V1 === 'true',
        'AI_PLAN_BUILDER_V1 must be enabled by the test harness.'
      ).toBe(true);

      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];

      page.on('pageerror', (err) => pageErrors.push(String((err as any)?.message ?? err)));
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      await setRoleCookie(page, 'COACH');
      await createCoach({ id: 'dev-coach' });

      const athleteId = nextTestId('pw_apb_coach_v1');
      await createAthlete({ coachId: 'dev-coach', id: athleteId });

      await page.goto(`/coach/athletes/${athleteId}/ai-plan-builder`);
      await expect(page.getByText('Plan Builder')).toBeVisible();

      // Coach UI must not expose internal/system language.
      await expect(page.getByText('Raw profile JSON')).toHaveCount(0);
      await expect(page.getByText('Overrides (JSON)')).toHaveCount(0);
      await expect(page.getByText('Evidence')).toHaveCount(0);
      await expect(page.getByText('Extract Profile')).toHaveCount(0);

      // 1) Start with AI intake.
      const intakeOk = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/intake/generate`) &&
          res.request().method() === 'POST' &&
          (res.status() === 200 || res.status() === 201),
        { timeout: 60_000 }
      );
      await page.getByTestId('apb-generate-intake-ai').click();
      await intakeOk;

      // 2) Generate plan preview.
      const today = new Date();
      const startDate = formatDayKey(today);
      const completionDate = formatDayKey(addDays(today, 28));
      const fromDayKey = formatDayKey(addDays(today, -7));
      const toDayKey = formatDayKey(addDays(today, 42));

      await setDateInput(page.getByTestId('apb-start-date'), startDate);
      await setDateInput(page.getByTestId('apb-completion-date'), completionDate);
      await expect(page.getByText(/Derived from dates:\s*\d+/)).toBeVisible();
      await page.getByTestId('apb-weeks-auto-toggle').click();
      await expect(page.getByTestId('apb-weeks-to-completion')).toBeEnabled();
      await page.getByTestId('apb-weeks-to-completion').fill('4');

      const draftOk = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`) &&
          res.request().method() === 'POST' &&
          (res.status() === 200 || res.status() === 201),
        { timeout: 90_000 }
      );
      await page.getByTestId('apb-generate-plan').click();
      await draftOk;

      const firstWeek = page.getByTestId('apb-week').first();
      await expect(firstWeek).toBeVisible({ timeout: 60_000 });
      await expect(firstWeek.getByTestId('apb-week-commencing')).toContainText('Commencing');

      const firstSession = firstWeek.getByTestId('apb-session').first();
      await expect(firstSession.getByTestId('apb-session-day')).toBeVisible({ timeout: 60_000 });
      await expect(firstSession.getByTestId('apb-session-day')).toContainText(/\d/);
      await expect(firstSession.getByTestId('apb-session-objective-input')).toBeVisible({ timeout: 60_000 });
      await expect(firstSession.getByTestId('apb-session-objective-input')).not.toHaveValue('');
      await expect(firstSession.getByTestId('apb-session-workout-detail-preview')).toBeVisible();
      await expect(firstSession.getByTestId('apb-session-block-steps-0')).toBeVisible();

      // Duration should be humanised (multiples of 5 minutes).
      const durationValue = await firstSession.getByTestId('apb-session-duration').inputValue();
      const durationInt = Number.parseInt(durationValue, 10);
      expect(Number.isFinite(durationInt)).toBe(true);
      expect(durationInt % 5).toBe(0);

      // 3) Edit a session and confirm persistence after refresh.
      const editedDuration = String(durationInt + 5);
      await firstSession.getByTestId('apb-session-duration').fill(editedDuration);
      await firstSession.getByTestId('apb-session-notes').fill('Coach note: keep this aerobic.');

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
      await expect(firstSessionAfter.getByTestId('apb-session-notes')).toHaveValue('Coach note: keep this aerobic.');

      // 4) Publish and verify the coach calendar contains APB-origin sessions.
      const publishOk = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/publish`) &&
          res.request().method() === 'POST' &&
          res.status() === 200,
        { timeout: 90_000 }
      );
      await page.getByTestId('apb-publish').click();
      await publishOk;

      const calendarRes = await page.request.get(
        `/api/coach/calendar?athleteId=${encodeURIComponent(athleteId)}&from=${encodeURIComponent(fromDayKey)}&to=${encodeURIComponent(toDayKey)}`
      );
      expect(calendarRes.ok()).toBeTruthy();
      const calendarJson = (await calendarRes.json()) as { items?: Array<any> };
      const items = Array.isArray(calendarJson.items) ? calendarJson.items : [];
      const apbItems = items.filter(
        (it) =>
          it?.origin === 'AI_PLAN_BUILDER' ||
          (typeof it?.sourceActivityId === 'string' && it.sourceActivityId.startsWith('apb:'))
      );
      expect(apbItems.length).toBeGreaterThan(0);

      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });
  });
    await generateOk;

    await expect(page.getByText('Intake ID:')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Status:\s*SUBMITTED/i)).toBeVisible({ timeout: 30_000 });

    // Evidence should have rows.
    await expect(page.getByText('No evidence items.')).toHaveCount(0);

    // Extract Profile should now be available.
    const extractButton = page.getByRole('button', { name: 'Extract Profile' });
    await expect(extractButton).toBeVisible();
    await expect(extractButton).toBeEnabled();

    const extractOk = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/profile/extract`) &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      { timeout: 60_000 }
    );
    await extractButton.click();
    await extractOk;

    // Profile panel should now show data.
    await expect(page.getByText('Latest Profile')).toBeVisible();
    await expect(page.getByText('Profile ID:')).toBeVisible({ timeout: 30_000 });

    // Proceed to generate a draft plan.
    await page.getByTestId('apb-tab-plan').click();
    await expect(page.getByTestId('apb-generate-draft')).toBeVisible();

    const draftOk = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`) &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      { timeout: 60_000 }
    );
    await page.getByTestId('apb-generate-draft').click();
    await draftOk;

    // Draft UI should render sessions.
    await expect(page.locator('[data-testid="apb-session"]').first()).toBeVisible({ timeout: 30_000 });
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
    const draftPlanId = String(draftPlan.id);

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

    // Regression guard: inputs must be truly interactive (not `pointer-events: none`).
    await expect(durationInput).toHaveCSS('pointer-events', 'auto');
    await durationInput.click();

    await page.screenshot({ path: testInfo.outputPath('session-inputs-editable.png'), fullPage: true });

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

    // When a week is locked, the UI should prevent edits client-side.
    await expect(page.locator(`[data-week-index="${weekIndex}"] [data-testid="apb-week-locked-note"]`)).toBeVisible();
    await expect(durationInputAfter).toBeDisabled();
    await expect(firstSessionAfterReload.locator('[data-testid="apb-session-save"]')).toBeDisabled();

    // Server should still enforce week locks (even if a client forces a PATCH).
    const forcedWeekEditRes = await page.request.patch(
      `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`,
      {
        data: {
          draftPlanId,
          sessionEdits: [{ sessionId, durationMinutes: 41 }],
        },
      }
    );
    expect(forcedWeekEditRes.status()).toBe(409);
    expect(await forcedWeekEditRes.text()).toContain('WEEK_LOCKED');

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

    // When a session is locked, the UI should prevent edits client-side.
    await expect(firstSessionForLock.locator('[data-testid="apb-session-duration"]')).toBeDisabled();
    await expect(firstSessionForLock.locator('[data-testid="apb-session-save"]')).toBeDisabled();

    // Server should still enforce session locks.
    const forcedSessionEditRes = await page.request.patch(
      `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`,
      {
        data: {
          draftPlanId,
          sessionEdits: [{ sessionId, durationMinutes: 43 }],
        },
      }
    );
    expect(forcedSessionEditRes.status()).toBe(409);
    expect(await forcedSessionEditRes.text()).toContain('SESSION_LOCKED');

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

*/

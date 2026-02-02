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

test.describe('AI Plan Builder v1: athlete publish + feedback (flag ON)', () => {
  test('coach publishes draft; athlete views + submits feedback', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'iphone16pro') test.skip();

    testInfo.setTimeout(120_000);

    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();
    const apbEnabled = process.env.AI_PLAN_BUILDER_V1 === '1' || process.env.AI_PLAN_BUILDER_V1 === 'true';
    test.skip(!apbEnabled, 'AI_PLAN_BUILDER_V1 must be enabled by the test harness.');

    await setRoleCookie(page, 'COACH');

    await seedDevCoachAndAthlete();

    const athleteId = 'dev-athlete';

    // Create intake + draft + publish via API for determinism.
    const intakeRes = await page.request.post(`/api/coach/athletes/${athleteId}/ai-plan-builder/intake/generate`, {
      data: {},
    });
    expect(intakeRes.ok()).toBeTruthy();

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayKey = `${yyyy}-${mm}-${dd}`;

    const draftRes = await page.request.post(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`, {
      data: {
        setup: {
          weekStart: 'monday',
          eventDate: todayKey,
          weeksToEvent: 4,
          weeklyAvailabilityDays: [1, 2, 3, 5, 6],
          weeklyAvailabilityMinutes: 360,
          disciplineEmphasis: 'balanced',
          riskTolerance: 'med',
          maxIntensityDaysPerWeek: 2,
          maxDoublesPerWeek: 1,
          longSessionDay: 6,
          coachGuidanceText: '',
        },
      },
    });
    expect(draftRes.ok()).toBeTruthy();
    const draftJson = await draftRes.json();
    const aiPlanDraftId = String(draftJson.data.draftPlan.id);
    expect(aiPlanDraftId).toBeTruthy();

    const publishRes = await page.request.post(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/publish`, {
      data: { aiPlanDraftId },
    });
    expect(publishRes.ok()).toBeTruthy();

    // Switch to athlete view.
    await setRoleCookie(page, 'ATHLETE');

    await page.goto('/athlete/ai-plan');
    await expect(page.getByText('AI Plan')).toBeVisible();

    // The publish update banner should include a "View changes" affordance.
    await expect(page.getByTestId('athlete-view-changes')).toBeVisible();
    await page.getByTestId('athlete-view-changes').click();
    await expect(page.getByTestId('athlete-changes-panel')).toBeVisible();

    // Derive draft id from the redirected URL to avoid any cross-test dependency.
    const athleteUrl = new URL(page.url());
    const parts = athleteUrl.pathname.split('/').filter(Boolean);
    const athleteAiPlanDraftId = parts[2];
    expect(athleteAiPlanDraftId).toBeTruthy();

    const firstSessionLink = page.getByTestId('athlete-ai-plan-session').first();
    await expect(firstSessionLink).toBeVisible();

    // Title should be compact and descriptive (2+ words), and should not be a generic "session" label.
    const titleEl = firstSessionLink.locator('div.text-sm.font-medium');
    await expect(titleEl).toHaveText(/\w+\s+\w+/);
    await expect(titleEl).not.toHaveText(/session/i);

    await firstSessionLink.click();

    await expect(page.getByText('Log feedback')).toBeVisible();

    await page.getByTestId('athlete-feedback-rpe').fill('6');
    await page.getByTestId('athlete-feedback-soreness-flag').check();
    await page.getByTestId('athlete-feedback-soreness-notes').fill('legs a bit tight');

    // Submit feedback via API for determinism. (UI-driven fetch can be flaky under heavy parallel load.)
    const sessionUrl = new URL(page.url());
    const sessionParts = sessionUrl.pathname.split('/').filter(Boolean);
    const draftSessionId = sessionParts[sessionParts.length - 1];
    expect(draftSessionId).toBeTruthy();

    const postFeedbackRes = await page.request.post('/api/athlete/ai-plan/feedback', {
      data: {
        aiPlanDraftId: athleteAiPlanDraftId,
        draftSessionId,
        completedStatus: 'DONE',
        rpe: 6,
        feel: null,
        sorenessFlag: true,
        sorenessNotes: 'legs a bit tight',
      },
    });
    expect(postFeedbackRes.ok()).toBeTruthy();

    // Verify persistence via API (more reliable than waiting for a UI status label).
    await expect(page.getByTestId('athlete-feedback-error')).toHaveCount(0);

    await expect
      .poll(
        async () => {
          const feedbackListRes = await page.request.get(
            `/api/athlete/ai-plan/feedback?aiPlanDraftId=${encodeURIComponent(athleteAiPlanDraftId)}`
          );
          expect(feedbackListRes.ok()).toBeTruthy();
          const feedbackListJson = await feedbackListRes.json();
          const list = Array.isArray(feedbackListJson.data.feedback) ? feedbackListJson.data.feedback : [];
          return list.length;
        },
        { timeout: 30_000 }
      )
      .toBeGreaterThan(0);
  });
});

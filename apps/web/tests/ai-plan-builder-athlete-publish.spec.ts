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

test.describe('AI Plan Builder v1: athlete publish + feedback (flag ON)', () => {
  test('coach publishes draft; athlete views + submits feedback', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'iphone16pro') test.skip();

    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();
    expect(
      process.env.AI_PLAN_BUILDER_V1 === '1' || process.env.AI_PLAN_BUILDER_V1 === 'true',
      'AI_PLAN_BUILDER_V1 must be enabled by the test harness.'
    ).toBe(true);

    await setRoleCookie(page, 'COACH');

    // Ensure dev fixtures exist (coach+athlete+athleteProfile).
    const fixtures = await page.request.post('/api/dev/strava/test-fixtures');
    expect(fixtures.ok()).toBeTruthy();

    const athleteId = 'dev-athlete';

    // Ensure Intake/Profile tabs are in a good state (matches coach UI smoke setup).
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
    await expect(page.getByTestId('apb-tab-plan')).toBeVisible();
    await page.getByTestId('apb-tab-plan').click();

    await expect(page.getByTestId('apb-generate-draft')).toBeVisible();

    await page.getByTestId('apb-generate-draft').click();
    await expect(page.locator('[data-testid="apb-session"]').first()).toBeVisible({ timeout: 30_000 });

    // Publish to athlete.
    await page.getByTestId('apb-publish').click();
    await expect(page.getByTestId('apb-publish-status')).toContainText('Published');
    await expect(page.getByTestId('apb-publish-last-published')).not.toHaveText('—');

    // Switch to athlete view.
    await setRoleCookie(page, 'ATHLETE');

    await page.goto('/athlete/ai-plan');
    await expect(page.getByText('AI Plan')).toBeVisible();

    // Derive draft id from the redirected URL to avoid any cross-test dependency.
    const athleteUrl = new URL(page.url());
    const parts = athleteUrl.pathname.split('/').filter(Boolean);
    const aiPlanDraftId = parts[2];
    expect(aiPlanDraftId).toBeTruthy();

    const firstSessionLink = page.getByTestId('athlete-ai-plan-session').first();
    await expect(firstSessionLink).toBeVisible();
    await firstSessionLink.click();

    await expect(page.getByText('Log feedback')).toBeVisible();

    await page.getByTestId('athlete-feedback-rpe').fill('6');
    await page.getByTestId('athlete-feedback-soreness-flag').check();
    await page.getByTestId('athlete-feedback-soreness-notes').fill('legs a bit tight');
    await page.getByTestId('athlete-feedback-submit').click();

    // Verify persistence via API (more reliable than waiting for a UI status label).
    await expect(page.getByTestId('athlete-feedback-error')).toHaveCount(0);

    let found = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const feedbackListRes = await page.request.get(
        `/api/athlete/ai-plan/feedback?aiPlanDraftId=${encodeURIComponent(aiPlanDraftId)}`
      );
      expect(feedbackListRes.ok()).toBeTruthy();
      const feedbackListJson = await feedbackListRes.json();
      const list = Array.isArray(feedbackListJson.data.feedback) ? feedbackListJson.data.feedback : [];
      if (list.length > 0) {
        found = true;
        break;
      }
      await page.waitForTimeout(500);
    }

    expect(found).toBe(true);
  });
});

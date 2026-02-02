import { expect, test } from '@playwright/test';

import { createAthlete, createCoach } from '../modules/ai-plan-builder/tests/seed';

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

test.describe('AI Plan Builder v1: core flow', () => {
  test('intake → evidence → extract profile (idempotent) → draft → proposal → audit', async ({ page }, testInfo) => {
    // This test mutates DB state; run it once to avoid cross-project interference.
    if (testInfo.project.name !== 'iphone16pro') test.skip();

    // Must be provided by the test harness (see scripts/test-ai-plan-builder.mjs).
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();
    const apbEnabled = process.env.AI_PLAN_BUILDER_V1 === '1' || process.env.AI_PLAN_BUILDER_V1 === 'true';
    test.skip(!apbEnabled, 'AI_PLAN_BUILDER_V1 must be enabled by the test harness.');

    await setRoleCookie(page, 'COACH');

    // Use a unique athlete id to avoid cross-test interference with other specs that rely on
    // the shared auth-disabled `dev-athlete` identity.
    const runTag = String(Date.now());
    await createCoach({ id: 'dev-coach' });
    const athleteId = `pw-athlete-${runTag}`;
    await createAthlete({ coachId: 'dev-coach', id: athleteId });

    // Create intake draft.
    const createDraftRes = await page.request.post(
      `/api/coach/athletes/${athleteId}/ai-plan-builder/intake/draft`,
      {
        data: {
          draftJson: {
            goals: `Build aerobic base (${runTag})`,
            availability: { daysPerWeek: 4 },
            injuries: [],
          },
        },
      }
    );
    expect(createDraftRes.ok()).toBeTruthy();

    const createDraftJson = await createDraftRes.json();
    const intakeResponseId = createDraftJson.data.intakeResponse.id as string;
    expect(intakeResponseId).toBeTruthy();

    // Update draft.
    const updateDraftRes = await page.request.patch(
      `/api/coach/athletes/${athleteId}/ai-plan-builder/intake/draft`,
      {
        data: {
          intakeResponseId,
          draftJson: {
            goals: `Build aerobic base (${runTag})`,
            availability: { daysPerWeek: 4 },
            injuries: [],
            notes: `Prefer mornings (${runTag})`,
          },
        },
      }
    );
    expect(updateDraftRes.ok()).toBeTruthy();

    // Submit intake (creates immutable evidence rows).
    const submitRes = await page.request.post(
      `/api/coach/athletes/${athleteId}/ai-plan-builder/intake/submit`,
      { data: { intakeResponseId } }
    );
    expect(submitRes.ok()).toBeTruthy();

    const submitJson = await submitRes.json();
    expect(submitJson.data.evidenceCreatedCount).toBeGreaterThan(0);

    // Extract AI profile (deterministic; idempotent).
    const extract1 = await page.request.post(
      `/api/coach/athletes/${athleteId}/ai-plan-builder/profile/extract`,
      { data: { intakeResponseId } }
    );
    expect(extract1.ok()).toBeTruthy();

    const extract1Json = await extract1.json();
    expect(extract1Json.data.wasCreated).toBe(true);
    const profileId = extract1Json.data.profile.id as string;

    const extract2 = await page.request.post(
      `/api/coach/athletes/${athleteId}/ai-plan-builder/profile/extract`,
      { data: { intakeResponseId } }
    );
    expect(extract2.ok()).toBeTruthy();

    const extract2Json = await extract2.json();
    expect(extract2Json.data.wasCreated).toBe(false);
    expect(extract2Json.data.profile.id).toBe(profileId);

    // Create a draft plan (parallel structure; no existing plan mutation).
    const draftPlanRes = await page.request.post(
      `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`,
      {
        data: {
          planJson: {
            week1: [{ day: 'Mon', workout: 'Easy Run 30min' }],
          },
        },
      }
    );
    expect(draftPlanRes.ok()).toBeTruthy();

    const draftPlanJson = await draftPlanRes.json();
    const draftPlanId = draftPlanJson.data.draftPlan.id as string;
    expect(draftPlanId).toBeTruthy();

    // Create a proposal referencing the draft.
    const proposalRes = await page.request.post(
      `/api/coach/athletes/${athleteId}/ai-plan-builder/proposal`,
      {
        data: {
          draftPlanId,
          proposalJson: {
            changes: [{ op: 'add', path: '/week1/0', value: { day: 'Mon', workout: 'Easy Run 30min' } }],
          },
        },
      }
    );
    expect(proposalRes.ok()).toBeTruthy();

    const proposalJson = await proposalRes.json();
    const proposalId = proposalJson.data.proposal.id as string;
    expect(proposalId).toBeTruthy();

    // Audit entry.
    const auditRes = await page.request.post(
      `/api/coach/athletes/${athleteId}/ai-plan-builder/audit`,
      {
        data: {
          eventType: 'PROPOSAL_CREATED',
          proposalId,
          diffJson: { note: 'test' },
        },
      }
    );
    expect(auditRes.ok()).toBeTruthy();

    const auditJson = await auditRes.json();
    expect(auditJson.data.audit.id).toBeTruthy();
  });
});

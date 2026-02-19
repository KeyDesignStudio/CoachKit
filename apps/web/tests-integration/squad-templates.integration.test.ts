import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';

describe('coach squad template APIs', () => {
  const coachId = 'squad-template-coach';
  const otherCoachId = 'squad-template-other-coach';
  let ownedSquadIdOne = '';
  let ownedSquadIdTwo = '';
  let foreignSquadId = '';

  beforeAll(async () => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();

    await prisma.user.create({
      data: {
        id: coachId,
        role: UserRole.COACH,
        email: 'squad-template-coach@example.test',
        name: 'Squad Template Coach',
        timezone: 'Australia/Brisbane',
        authProviderId: 'squad-template-coach-test',
      },
    });

    await prisma.user.create({
      data: {
        id: otherCoachId,
        role: UserRole.COACH,
        email: 'squad-template-other-coach@example.test',
        name: 'Squad Template Other Coach',
        timezone: 'Australia/Brisbane',
        authProviderId: 'squad-template-other-coach-test',
      },
    });

    const [ownedOne, ownedTwo, foreign] = await Promise.all([
      prisma.squad.create({ data: { coachId, name: 'Endurance Squad One' } }),
      prisma.squad.create({ data: { coachId, name: 'Endurance Squad Two' } }),
      prisma.squad.create({ data: { coachId: otherCoachId, name: 'Foreign Squad' } }),
    ]);

    ownedSquadIdOne = ownedOne.id;
    ownedSquadIdTwo = ownedTwo.id;
    foreignSquadId = foreign.id;

    vi.doMock('@/lib/auth', async () => {
      const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
      return {
        ...actual,
        requireCoach: async () => ({
          user: {
            id: coachId,
            role: UserRole.COACH,
            email: 'squad-template-coach@example.test',
            name: 'Squad Template Coach',
            timezone: 'Australia/Brisbane',
            authProviderId: 'squad-template-coach-test',
          },
        }),
      };
    });
  });

  afterAll(async () => {
    vi.resetModules();
    vi.doUnmock('@/lib/auth');

    await prisma.squadTemplateTarget.deleteMany({
      where: {
        squadTemplate: { coachId: { in: [coachId, otherCoachId] } },
      },
    });
    await prisma.squadTemplate.deleteMany({ where: { coachId: { in: [coachId, otherCoachId] } } });
    await prisma.squad.deleteMany({ where: { coachId: { in: [coachId, otherCoachId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [coachId, otherCoachId] } } });

    await prisma.$disconnect();
  });

  it('creates a template, de-duplicates squad targets, patches it, and deletes it', async () => {
    const createRoute = await import('@/app/api/coach/squad-templates/route');
    const detailRoute = await import('@/app/api/coach/squad-templates/[templateId]/route');

    const createReq = new NextRequest('http://localhost/api/coach/squad-templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '  Brick Session Base  ',
        description: 'Template for brick progressions',
        targetSquadIds: [ownedSquadIdOne, ownedSquadIdOne, ownedSquadIdTwo],
        targetPresetJson: {
          title: 'Brick Set',
          discipline: 'RUN',
          startTimeLocal: '05:30',
          durationMinutes: 75,
          selectedDays: ['MO', 'TH'],
          visibilityType: 'SQUAD',
        },
      }),
    });

    const createRes = await createRoute.POST(createReq);
    expect(createRes.status).toBe(201);
    const createJson = await createRes.json();
    expect(createJson.error).toBeNull();

    const created = createJson.data.squadTemplate as { id: string; name: string; targets: Array<{ squadId: string }> };
    expect(created.name).toBe('Brick Session Base');
    expect(created.targets).toHaveLength(2);
    expect(created.targets.map((target) => target.squadId).sort()).toEqual([ownedSquadIdOne, ownedSquadIdTwo].sort());

    const patchReq = new NextRequest(`http://localhost/api/coach/squad-templates/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Brick Session Base v2',
        targetSquadIds: [ownedSquadIdTwo],
      }),
    });
    const patchRes = await detailRoute.PATCH(patchReq, { params: { templateId: created.id } });
    expect(patchRes.status).toBe(200);
    const patchJson = await patchRes.json();
    expect(patchJson.error).toBeNull();
    expect(patchJson.data.squadTemplate.name).toBe('Brick Session Base v2');
    expect(patchJson.data.squadTemplate.targets).toHaveLength(1);
    expect(patchJson.data.squadTemplate.targets[0]?.squadId).toBe(ownedSquadIdTwo);

    const deleteReq = new NextRequest(`http://localhost/api/coach/squad-templates/${created.id}`, { method: 'DELETE' });
    const deleteRes = await detailRoute.DELETE(deleteReq, { params: { templateId: created.id } });
    expect(deleteRes.status).toBe(200);
    const deleteJson = await deleteRes.json();
    expect(deleteJson.data.deleted).toBe(true);
  });

  it('rejects invalid payloads and invalid ownership', async () => {
    const createRoute = await import('@/app/api/coach/squad-templates/route');
    const detailRoute = await import('@/app/api/coach/squad-templates/[templateId]/route');

    const invalidPresetReq = new NextRequest('http://localhost/api/coach/squad-templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Invalid Preset',
        targetSquadIds: [ownedSquadIdOne],
        targetPresetJson: {
          title: 'Bad payload',
          unexpectedField: true,
        },
      }),
    });
    const invalidPresetRes = await createRoute.POST(invalidPresetReq);
    expect(invalidPresetRes.status).toBe(400);
    const invalidPresetJson = await invalidPresetRes.json();
    expect(invalidPresetJson.error.code).toBe('VALIDATION_ERROR');

    const validCreateReq = new NextRequest('http://localhost/api/coach/squad-templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Owned only',
        targetSquadIds: [ownedSquadIdOne],
      }),
    });
    const validCreateRes = await createRoute.POST(validCreateReq);
    expect(validCreateRes.status).toBe(201);
    const validCreateJson = await validCreateRes.json();
    const templateId = validCreateJson.data.squadTemplate.id as string;

    const invalidTemplateIdReq = new NextRequest('http://localhost/api/coach/squad-templates/not-a-cuid', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nope' }),
    });
    const invalidTemplateIdRes = await detailRoute.PATCH(invalidTemplateIdReq, { params: { templateId: 'not-a-cuid' } });
    expect(invalidTemplateIdRes.status).toBe(400);
    const invalidTemplateIdJson = await invalidTemplateIdRes.json();
    expect(invalidTemplateIdJson.error.code).toBe('VALIDATION_ERROR');

    const invalidOwnershipReq = new NextRequest(`http://localhost/api/coach/squad-templates/${templateId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetSquadIds: [foreignSquadId],
      }),
    });
    const invalidOwnershipRes = await detailRoute.PATCH(invalidOwnershipReq, { params: { templateId } });
    expect(invalidOwnershipRes.status).toBe(400);
    const invalidOwnershipJson = await invalidOwnershipRes.json();
    expect(invalidOwnershipJson.error.code).toBe('INVALID_TARGET_SQUAD');

    const duplicateNameReq = new NextRequest('http://localhost/api/coach/squad-templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Owned only',
        targetSquadIds: [ownedSquadIdOne],
      }),
    });
    const duplicateNameRes = await createRoute.POST(duplicateNameReq);
    expect(duplicateNameRes.status).toBe(409);
    const duplicateNameJson = await duplicateNameRes.json();
    expect(duplicateNameJson.error.code).toBe('CONFLICT');
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CalendarItemStatus, GroupVisibilityType, UserRole } from '@prisma/client';
import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';

function lastUtcWeekday(weekday: number) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const delta = (d.getUTCDay() - weekday + 7) % 7;
  d.setUTCDate(d.getUTCDate() - delta);
  return d;
}

describe('group sessions placement suggestion', () => {
  const coachId = 'placement-suggest-coach';
  const athleteOneId = 'placement-suggest-athlete-one';
  const athleteTwoId = 'placement-suggest-athlete-two';
  let groupSessionId = '';

  beforeAll(async () => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();

    await prisma.user.create({
      data: {
        id: coachId,
        role: UserRole.COACH,
        email: 'placement-suggest-coach@example.test',
        name: 'Placement Suggest Coach',
        timezone: 'Australia/Brisbane',
        authProviderId: 'placement-suggest-coach-auth',
      },
    });

    await prisma.user.createMany({
      data: [
        {
          id: athleteOneId,
          role: UserRole.ATHLETE,
          email: 'placement-suggest-athlete-one@example.test',
          name: 'Placement Athlete One',
          timezone: 'Australia/Brisbane',
          authProviderId: 'placement-suggest-athlete-one-auth',
        },
        {
          id: athleteTwoId,
          role: UserRole.ATHLETE,
          email: 'placement-suggest-athlete-two@example.test',
          name: 'Placement Athlete Two',
          timezone: 'Australia/Brisbane',
          authProviderId: 'placement-suggest-athlete-two-auth',
        },
      ],
    });

    await prisma.athleteProfile.createMany({
      data: [
        { userId: athleteOneId, coachId },
        { userId: athleteTwoId, coachId },
      ],
    });

    const groupSession = await prisma.groupSession.create({
      data: {
        coachId,
        title: 'Threshold session',
        discipline: 'RUN',
        startTimeLocal: '06:00',
        durationMinutes: 60,
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE',
        visibilityType: GroupVisibilityType.SELECTED,
      },
    });
    groupSessionId = groupSession.id;

    await prisma.groupSessionTarget.createMany({
      data: [
        { groupSessionId, athleteId: athleteOneId },
        { groupSessionId, athleteId: athleteTwoId },
      ],
    });

    const lastMonday = lastUtcWeekday(1);
    const lastFriday = lastUtcWeekday(5);

    for (const athleteId of [athleteOneId, athleteTwoId]) {
      const mondayItem = await prisma.calendarItem.create({
        data: {
          coachId,
          athleteId,
          date: lastMonday,
          discipline: 'RUN',
          title: 'Hard Monday',
          plannedStartTimeLocal: '06:00',
          plannedDurationMinutes: 120,
          status: CalendarItemStatus.COMPLETED_MANUAL,
        },
      });
      await prisma.completedActivity.create({
        data: {
          athleteId,
          calendarItemId: mondayItem.id,
          source: 'MANUAL',
          startTime: new Date(lastMonday.getTime() + 6 * 60 * 60 * 1000),
          durationMinutes: 120,
          painFlag: true,
        },
      });

      const fridayItem = await prisma.calendarItem.create({
        data: {
          coachId,
          athleteId,
          date: lastFriday,
          discipline: 'RUN',
          title: 'Friday easy run',
          plannedStartTimeLocal: '06:30',
          plannedDurationMinutes: 60,
          status: CalendarItemStatus.COMPLETED_MANUAL,
        },
      });
      await prisma.completedActivity.create({
        data: {
          athleteId,
          calendarItemId: fridayItem.id,
          source: 'MANUAL',
          startTime: new Date(lastFriday.getTime() + 6 * 60 * 60 * 1000 + 30 * 60 * 1000),
          durationMinutes: 60,
          painFlag: false,
        },
      });
    }

    vi.doMock('@/lib/auth', async () => {
      const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
      return {
        ...actual,
        requireCoach: async () => ({
          user: {
            id: coachId,
            role: UserRole.COACH,
            email: 'placement-suggest-coach@example.test',
            name: 'Placement Suggest Coach',
            timezone: 'Australia/Brisbane',
            authProviderId: 'placement-suggest-coach-auth',
          },
        }),
      };
    });
  });

  afterAll(async () => {
    vi.resetModules();
    vi.doUnmock('@/lib/auth');

    await prisma.completedActivity.deleteMany({ where: { athleteId: { in: [athleteOneId, athleteTwoId] } } });
    await prisma.calendarItem.deleteMany({ where: { athleteId: { in: [athleteOneId, athleteTwoId] } } });
    await prisma.groupSessionTarget.deleteMany({ where: { groupSessionId } });
    await prisma.groupSession.deleteMany({ where: { id: groupSessionId } });
    await prisma.athleteProfile.deleteMany({ where: { userId: { in: [athleteOneId, athleteTwoId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [athleteOneId, athleteTwoId, coachId] } } });
    await prisma.$disconnect();
  });

  it('suggests lower-load lower-pain weekdays', async () => {
    const { GET } = await import('@/app/api/coach/group-sessions/[groupSessionId]/placement-suggestion/route');
    const req = new NextRequest(
      `http://localhost/api/coach/group-sessions/${groupSessionId}/placement-suggestion?lookbackDays=21`
    );

    const res = await GET(req, { params: { groupSessionId } });
    expect(res.status).toBe(200);

    const json = await res.json();
    const suggestion = json.data.suggestion as {
      selectedDays: string[];
      suggestedStartTimeLocal: string;
      confidence: string;
    };

    expect(suggestion.selectedDays.length).toBeGreaterThan(0);
    expect(suggestion.selectedDays).toContain('FR');
    expect(suggestion.suggestedStartTimeLocal).toBe('06:30');
    expect(['LOW', 'MEDIUM', 'HIGH']).toContain(suggestion.confidence);
  });
});

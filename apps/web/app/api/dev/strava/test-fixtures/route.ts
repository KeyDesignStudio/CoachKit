import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function isEnabled() {
  return process.env.NODE_ENV === 'development' && process.env.DISABLE_AUTH === 'true';
}

export async function POST(_request: NextRequest) {
  if (!isEnabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let body: any = null;
  try {
    body = await _request.json();
  } catch {
    body = null;
  }

  const coach = await prisma.user.upsert({
    where: { id: 'dev-coach' },
    update: {
      email: 'dev-coach@local',
      role: 'COACH',
      timezone: 'UTC',
      name: 'Dev Coach',
    },
    create: {
      id: 'dev-coach',
      email: 'dev-coach@local',
      role: 'COACH',
      timezone: 'UTC',
      name: 'Dev Coach',
    },
    select: { id: true },
  });

  const athlete = await prisma.user.upsert({
    where: { id: 'dev-athlete' },
    update: {
      email: 'dev-athlete@local',
      role: 'ATHLETE',
      timezone: 'UTC',
      name: 'Dev Athlete',
    },
    create: {
      id: 'dev-athlete',
      email: 'dev-athlete@local',
      role: 'ATHLETE',
      timezone: 'UTC',
      name: 'Dev Athlete',
    },
    select: { id: true },
  });

  await prisma.athleteProfile.upsert({
    where: { userId: athlete.id },
    update: {
      coachId: coach.id,
      disciplines: Array.isArray(body?.disciplines) && body.disciplines.length ? body.disciplines : ['OTHER'],
    },
    create: {
      userId: athlete.id,
      coachId: coach.id,
      disciplines: Array.isArray(body?.disciplines) && body.disciplines.length ? body.disciplines : ['OTHER'],
    },
    select: { userId: true },
  });

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60_000);

  const connection = await prisma.stravaConnection.upsert({
    where: { athleteId: athlete.id },
    update: {
      stravaAthleteId: '123',
      accessToken: 'stub-access-token',
      refreshToken: 'stub-refresh-token',
      expiresAt,
      scope: 'read',
    },
    create: {
      athleteId: athlete.id,
      stravaAthleteId: '123',
      accessToken: 'stub-access-token',
      refreshToken: 'stub-refresh-token',
      expiresAt,
      scope: 'read',
    },
    select: { athleteId: true, stravaAthleteId: true },
  });

  // Keep Playwright runs deterministic when reusing a local DB.
  // The Strava stub includes a fixed set of activity ids; remove any prior records.
  const stubIds = ['999', '1000', '1001', '1002', '1003'];
  await prisma.completedActivity.deleteMany({
    where: {
      athleteId: athlete.id,
      source: 'STRAVA',
      externalActivityId: { in: stubIds },
    },
  });
  await prisma.calendarItem.deleteMany({
    where: {
      athleteId: athlete.id,
      origin: 'STRAVA',
      sourceActivityId: { in: stubIds },
    },
  });

  // Optional: seed planned items used by matching tests.
  if (body?.seed === 'matching') {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));

    await prisma.calendarItem.deleteMany({
      where: {
        athleteId: athlete.id,
        origin: null,
        title: { startsWith: 'PW Planned' },
      },
    });

    await prisma.calendarItem.createMany({
      data: [
        {
          athleteId: athlete.id,
          coachId: coach.id,
          date: today,
          plannedStartTimeLocal: '06:00',
          discipline: 'RUN',
          title: 'PW Planned Run 0600',
          status: 'PLANNED',
        },
        {
          athleteId: athlete.id,
          coachId: coach.id,
          date: today,
          plannedStartTimeLocal: '14:00',
          discipline: 'STRENGTH',
          title: 'PW Planned Strength 1400',
          status: 'PLANNED',
        },
        // Ambiguous pair.
        {
          athleteId: athlete.id,
          coachId: coach.id,
          date: today,
          plannedStartTimeLocal: '08:00',
          discipline: 'RUN',
          title: 'PW Planned Run 0800 A',
          status: 'PLANNED',
        },
        {
          athleteId: athlete.id,
          coachId: coach.id,
          date: today,
          plannedStartTimeLocal: '08:10',
          discipline: 'RUN',
          title: 'PW Planned Run 0810 B',
          status: 'PLANNED',
        },
        // Midnight-boundary planned session on previous day.
        {
          athleteId: athlete.id,
          coachId: coach.id,
          date: today,
          plannedStartTimeLocal: '23:50',
          discipline: 'RUN',
          title: 'PW Planned Run 2350',
          status: 'PLANNED',
        },
        // Create a planned session for tomorrow too, just to ensure we don't accidentally match it.
        {
          athleteId: athlete.id,
          coachId: coach.id,
          date: tomorrow,
          plannedStartTimeLocal: '06:00',
          discipline: 'RUN',
          title: 'PW Planned Run Tomorrow 0600',
          status: 'PLANNED',
        },
      ] as any,
      skipDuplicates: true,
    });
  }

  await prisma.stravaSyncIntent.deleteMany({
    where: { athleteId: athlete.id },
  });

  return NextResponse.json({ ok: true, coachId: coach.id, athleteId: athlete.id, stravaAthleteId: connection.stravaAthleteId });
}

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
      disciplines: ['OTHER'],
    },
    create: {
      userId: athlete.id,
      coachId: coach.id,
      disciplines: ['OTHER'],
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
  // The Strava stub always includes activity id 999, so remove any prior records.
  await prisma.completedActivity.deleteMany({
    where: {
      athleteId: athlete.id,
      source: 'STRAVA',
      externalActivityId: '999',
    },
  });
  await prisma.calendarItem.deleteMany({
    where: {
      athleteId: athlete.id,
      origin: 'STRAVA',
      sourceActivityId: '999',
    },
  });
  await prisma.stravaSyncIntent.deleteMany({
    where: { athleteId: athlete.id },
  });

  return NextResponse.json({ ok: true, coachId: coach.id, athleteId: athlete.id, stravaAthleteId: connection.stravaAthleteId });
}

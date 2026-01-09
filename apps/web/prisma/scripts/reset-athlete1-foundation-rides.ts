/**
 * DEV/TEST ONLY – resets Athlete 1 plan for Strava matching
 *
 * One-off script: Reset Athlete 1 planned sessions for Strava matching tests
 *
 * Goal:
 * - Delete Athlete 1 CalendarItems in a fixed date range (coach-scoped for safety)
 * - Recreate a daily planned BIKE session at 16:00 local time
 * - Publish the three PlanWeeks covering the range
 *
 * Safety constraints:
 * - Does NOT touch Athlete 2
 * - Does NOT delete any CompletedActivity rows
 *
 * Run (from repo root):
 *   cd /Volumes/DockSSD/Projects/CoachKit
 *   export DATABASE_URL='postgresql://...'
 *   npx --prefix apps/web ts-node --project apps/web/tsconfig.prisma.json apps/web/prisma/scripts/reset-athlete1-foundation-rides.ts
 */

import { CalendarItemStatus, PlanWeekStatus, PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const ATHLETE_ID = 'user-athlete-one';
const COACH_ID = 'user-coach-multisport';

const rangeStart = new Date('2025-12-26T00:00:00.000Z');
const rangeEndExclusive = new Date('2026-01-09T00:00:00.000Z'); // exclusive

function dateOnlyUtc(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function parseDateOnly(value: string) {
  // YYYY-MM-DD -> Date at midnight UTC
  return new Date(`${value}T00:00:00.000Z`);
}

async function main() {
  console.log('[reset-athlete1-foundation-rides] Starting...');
  console.log('Athlete:', ATHLETE_ID);
  console.log('Coach:', COACH_ID);
  console.log('Range:', rangeStart.toISOString(), 'to', rangeEndExclusive.toISOString(), '(exclusive)');

  // Safety check: athlete belongs to expected coach
  const athlete = await prisma.athleteProfile.findUnique({
    where: { userId: ATHLETE_ID },
    select: { userId: true, coachId: true },
  });

  if (!athlete) {
    throw new Error(`AthleteProfile not found for athleteId=${ATHLETE_ID}`);
  }

  if (athlete.coachId !== COACH_ID) {
    throw new Error(
      `Safety check failed: athlete coachId=${athlete.coachId} does not match expected coachId=${COACH_ID}`
    );
  }

  // 1) Delete existing CalendarItems for athlete+coach in range
  const deleted = await prisma.calendarItem.deleteMany({
    where: {
      athleteId: ATHLETE_ID,
      coachId: COACH_ID,
      date: { gte: rangeStart, lt: rangeEndExclusive },
    },
  });

  console.log(`[reset-athlete1-foundation-rides] Deleted CalendarItems: ${deleted.count}`);

  // 2) Insert one CalendarItem per day in the range
  const items: Prisma.CalendarItemCreateManyInput[] = [];

  for (let cursor = new Date(rangeStart); cursor < rangeEndExclusive; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = dateOnlyUtc(cursor);

    items.push({
      coachId: COACH_ID,
      athleteId: ATHLETE_ID,
      date: day,
      plannedStartTimeLocal: '16:00',
      discipline: 'BIKE',
      subtype: null,
      title: 'Foundation Indoor Ride',
      plannedDurationMinutes: 60,
      plannedDistanceKm: null,
      intensityType: null,
      notes: null,
      status: CalendarItemStatus.PLANNED,
      templateId: null,
      groupSessionId: null,
      reviewedAt: null,
    });
  }

  const created = await prisma.calendarItem.createMany({
    data: items,
  });

  console.log(`[reset-athlete1-foundation-rides] Created CalendarItems: ${created.count}`);

  // 3) Publish PlanWeeks covering the range
  const weekStarts = ['2025-12-22', '2025-12-29', '2026-01-05'].map(parseDateOnly);
  const publishedAt = new Date();

  for (const weekStart of weekStarts) {
    const ws = dateOnlyUtc(weekStart);

    await prisma.planWeek.upsert({
      where: {
        coachId_athleteId_weekStart: {
          coachId: COACH_ID,
          athleteId: ATHLETE_ID,
          weekStart: ws,
        },
      },
      create: {
        coachId: COACH_ID,
        athleteId: ATHLETE_ID,
        weekStart: ws,
        status: PlanWeekStatus.PUBLISHED,
        publishedAt,
      },
      update: {
        status: PlanWeekStatus.PUBLISHED,
        publishedAt,
      },
    });

    console.log(`[reset-athlete1-foundation-rides] Published PlanWeek: ${ws.toISOString().slice(0, 10)}`);
  }

  // Ensure the next poll includes the target range by clearing the watermark.
  const updatedConn = await prisma.stravaConnection.updateMany({
    where: { athleteId: ATHLETE_ID },
    data: { lastSyncAt: null },
  });

  console.log(`[reset-athlete1-foundation-rides] Cleared StravaConnection.lastSyncAt: ${updatedConn.count} row(s)`);

  console.log('[reset-athlete1-foundation-rides] Done.');
}

main()
  .catch((err) => {
    console.error('[reset-athlete1-foundation-rides] Failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

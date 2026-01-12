/* eslint-disable no-console */
const { PrismaClient, CalendarItemStatus, CompletionSource } = require('@prisma/client');

const prisma = new PrismaClient();

function ms(start) {
  const diff = process.hrtime.bigint() - start;
  return Number(diff) / 1e6;
}

function bytes(obj) {
  return Buffer.byteLength(JSON.stringify(obj), 'utf8');
}

async function time(fn) {
  const start = process.hrtime.bigint();
  const result = await fn();
  return { durationMs: ms(start), result };
}

async function main() {
  const coachId = 'user-coach-multisport';
  const athleteId = 'user-athlete-one';

  const newIndexNames = [
    '"CalendarItem_coachId_athleteId_date_idx"',
    '"CalendarItem_coachId_reviewedAt_status_idx"',
  ];

  async function dropNewIndexes() {
    for (const idx of newIndexNames) {
      await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS ${idx};`);
    }
  }

  async function createNewIndexes() {
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "CalendarItem_coachId_athleteId_date_idx" ON "CalendarItem"("coachId", "athleteId", "date");'
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "CalendarItem_coachId_reviewedAt_status_idx" ON "CalendarItem"("coachId", "reviewedAt", "status");'
    );
  }

  const reviewWhere = {
    coachId,
    status: {
      in: [
        CalendarItemStatus.COMPLETED_MANUAL,
        CalendarItemStatus.COMPLETED_SYNCED,
        CalendarItemStatus.SKIPPED,
      ],
    },
    reviewedAt: null,
  };

  const calendarWhere = {
    coachId,
    athleteId,
    date: {
      gte: new Date('2026-01-05T00:00:00.000Z'),
      lte: new Date('2026-01-26T00:00:00.000Z'),
    },
  };

  async function reviewInboxSelect() {
    return prisma.calendarItem.findMany({
      where: reviewWhere,
      orderBy: [{ updatedAt: 'desc' }, { date: 'desc' }],
      select: {
        id: true,
        athleteId: true,
        date: true,
        plannedStartTimeLocal: true,
        discipline: true,
        subtype: true,
        title: true,
        plannedDurationMinutes: true,
        plannedDistanceKm: true,
        intensityType: true,
        intensityTargetJson: true,
        workoutDetail: true,
        attachmentsJson: true,
        status: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
        athlete: { select: { user: { select: { id: true, name: true } } } },
        completedActivities: {
          orderBy: [{ startTime: 'desc' }],
          take: 1,
          select: {
            id: true,
            source: true,
            durationMinutes: true,
            distanceKm: true,
            rpe: true,
            painFlag: true,
            startTime: true,
          },
        },
        comments: {
          orderBy: [{ createdAt: 'desc' }],
          take: 10,
          select: {
            id: true,
            body: true,
            createdAt: true,
            author: { select: { id: true, name: true, role: true } },
          },
        },
        _count: { select: { comments: true } },
      },
    });
  }

  async function reviewInboxIncludeOldish() {
    return prisma.calendarItem.findMany({
      where: reviewWhere,
      orderBy: [{ updatedAt: 'desc' }, { date: 'desc' }],
      include: {
        athlete: { select: { user: { select: { id: true, name: true } } } },
        template: { select: { id: true, title: true } },
        groupSession: { select: { id: true, title: true } },
        completedActivities: {
          orderBy: [{ startTime: 'desc' }],
          take: 1,
          select: {
            id: true,
            source: true,
            durationMinutes: true,
            distanceKm: true,
            rpe: true,
            painFlag: true,
            startTime: true,
          },
        },
        comments: {
          orderBy: [{ createdAt: 'asc' }],
          select: {
            id: true,
            body: true,
            createdAt: true,
            author: { select: { id: true, name: true, role: true } },
          },
        },
      },
    });
  }

  async function coachCalendarSelect() {
    return prisma.calendarItem.findMany({
      where: calendarWhere,
      orderBy: [{ date: 'asc' }, { plannedStartTimeLocal: 'asc' }],
      select: {
        id: true,
        athleteId: true,
        coachId: true,
        date: true,
        plannedStartTimeLocal: true,
        discipline: true,
        subtype: true,
        title: true,
        plannedDurationMinutes: true,
        plannedDistanceKm: true,
        intensityType: true,
        intensityTargetJson: true,
        workoutDetail: true,
        attachmentsJson: true,
        status: true,
        templateId: true,
        groupSessionId: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
        template: { select: { id: true, title: true } },
        groupSession: { select: { id: true, title: true } },
        completedActivities: {
          orderBy: [{ startTime: 'desc' }],
          take: 5,
          where: { source: { in: [CompletionSource.MANUAL, CompletionSource.STRAVA] } },
          select: { id: true, painFlag: true, startTime: true, source: true, metricsJson: true },
        },
      },
    });
  }

  async function coachCalendarIncludeOldish() {
    return prisma.calendarItem.findMany({
      where: calendarWhere,
      orderBy: [{ date: 'asc' }, { plannedStartTimeLocal: 'asc' }],
      include: {
        template: { select: { id: true, title: true } },
        groupSession: { select: { id: true, title: true } },
        completedActivities: {
          orderBy: [{ startTime: 'desc' }],
          take: 5,
          where: { source: { in: [CompletionSource.MANUAL, CompletionSource.STRAVA] } },
          select: { id: true, painFlag: true, startTime: true, source: true, metricsJson: true },
        },
      },
    });
  }

  console.log('== Phase 3 timings (seed data) ==');

  await dropNewIndexes();

  const baseline = {};
  {
    const t1 = await time(reviewInboxSelect);
    baseline.reviewSelectMs = t1.durationMs;
    baseline.reviewSelectBytes = bytes(t1.result);

    const t2 = await time(reviewInboxIncludeOldish);
    baseline.reviewIncludeMs = t2.durationMs;
    baseline.reviewIncludeBytes = bytes(t2.result);

    const t3 = await time(coachCalendarSelect);
    baseline.calSelectMs = t3.durationMs;
    baseline.calSelectBytes = bytes(t3.result);

    const t4 = await time(coachCalendarIncludeOldish);
    baseline.calIncludeMs = t4.durationMs;
    baseline.calIncludeBytes = bytes(t4.result);
  }

  await createNewIndexes();

  const indexed = {};
  {
    const t1 = await time(reviewInboxSelect);
    indexed.reviewSelectMs = t1.durationMs;
    indexed.reviewSelectBytes = bytes(t1.result);

    const t3 = await time(coachCalendarSelect);
    indexed.calSelectMs = t3.durationMs;
    indexed.calSelectBytes = bytes(t3.result);
  }

  console.log(JSON.stringify({ baseline, indexed }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import {
  PrismaClient,
  CalendarItemStatus,
  CompletionSource,
  GroupVisibilityType,
  PlanWeekStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

type TemplateMap = Record<'run' | 'bike' | 'swim', { id: string }>;

type WeeklyBlueprint = {
  title: string;
  discipline: string;
  subtype?: string;
  startTime: string;
  duration: number;
  distance?: number;
  intensityType?: string;
  templateId?: string;
  groupSessionId?: string;
};

const coachUser = {
  id: 'user-coach-multisport',
  email: 'coach@multisportgold.test',
};

const athleteUsersSeed = [
  { id: 'user-athlete-one', email: 'athlete.one@multisportgold.test' },
  { id: 'user-athlete-two', email: 'athlete.two@multisportgold.test' },
];

const defaultWorkoutTitles = [
  { discipline: 'RUN', title: 'Foundation Run' },
  { discipline: 'RUN', title: 'Fartlek Run' },
  { discipline: 'RUN', title: 'Run Speed Intervals' },
  { discipline: 'RUN', title: 'Tempo Run' },
  { discipline: 'RUN', title: 'Long Run' },
  { discipline: 'BIKE', title: 'Foundation Bike' },
  { discipline: 'BIKE', title: 'Bike Power Intervals' },
  { discipline: 'BIKE', title: 'Bike Short Hill Climbs' },
  { discipline: 'BIKE', title: 'Endurance Ride' },
  { discipline: 'BIKE', title: 'Tempo Ride' },
  { discipline: 'SWIM', title: 'Swim Base' },
  { discipline: 'SWIM', title: 'Swim Fartlek + Sprint' },
  { discipline: 'SWIM', title: 'Swim Technique' },
  { discipline: 'SWIM', title: 'Swim Endurance' },
  { discipline: 'BRICK', title: 'Brick Workout' },
  { discipline: 'REST', title: 'Rest Day' },
  { discipline: 'OTHER', title: 'Strength Training' },
];

async function resetDatabase() {
  await prisma.coachJournalEntry.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.message.deleteMany();
  await prisma.messageThread.deleteMany();
  await prisma.completedActivity.deleteMany();
  await prisma.calendarItem.deleteMany();
  await prisma.planWeek.deleteMany();
  await prisma.workoutTitle.deleteMany();
  await prisma.groupSessionTarget.deleteMany();
  await prisma.groupSession.deleteMany();
  await prisma.squadMember.deleteMany();
  await prisma.squad.deleteMany();
  await prisma.planTemplate.deleteMany();
  await prisma.workoutTemplate.deleteMany();
  await prisma.painReport.deleteMany();
  await prisma.athleteProfile.deleteMany();
  await prisma.user.deleteMany();
}

function getWeekStart(baseDate = new Date()): Date {
  const normalized = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate()));
  const weekday = normalized.getUTCDay();
  const diffToMonday = (weekday + 6) % 7;
  normalized.setUTCDate(normalized.getUTCDate() - diffToMonday);
  return normalized;
}

function buildWeeklyBlueprint(templates: TemplateMap, groupSessionId: string): WeeklyBlueprint[] {
  return [
    {
      title: 'Aerobic Run Foundation',
      discipline: 'RUN',
      subtype: 'Aerobic',
      startTime: '05:00',
      duration: 50,
      distance: 10,
      intensityType: 'Z2',
      templateId: templates.run.id,
    },
    {
      title: 'Track Tuesday Squad',
      discipline: 'RUN',
      subtype: 'Track',
      startTime: '05:30',
      duration: 75,
      distance: 12,
      intensityType: 'Z4',
      templateId: templates.run.id,
      groupSessionId,
    },
    {
      title: 'Bike Tempo Builder',
      discipline: 'BIKE',
      subtype: 'Tempo',
      startTime: '05:15',
      duration: 80,
      distance: 45,
      intensityType: 'Z3',
      templateId: templates.bike.id,
    },
    {
      title: 'Swim Drills + Pull',
      discipline: 'SWIM',
      subtype: 'Technique',
      startTime: '06:00',
      duration: 60,
      distance: 3.2,
      intensityType: 'Skill',
      templateId: templates.swim.id,
    },
    {
      title: 'Brick Prep Ride',
      discipline: 'BIKE',
      subtype: 'Brick',
      startTime: '05:10',
      duration: 70,
      distance: 35,
      intensityType: 'Z3',
      templateId: templates.bike.id,
    },
    {
      title: 'Long Endurance Ride',
      discipline: 'BIKE',
      subtype: 'Endurance',
      startTime: '05:30',
      duration: 150,
      distance: 90,
      intensityType: 'Z2',
      templateId: templates.bike.id,
    },
    {
      title: 'Sunday Coastal Run',
      discipline: 'RUN',
      subtype: 'Endurance',
      startTime: '06:00',
      duration: 90,
      distance: 18,
      intensityType: 'Z2',
      templateId: templates.run.id,
    },
  ];
}

async function createWeekPlan(params: {
  athleteProfileId: string;
  coachId: string;
  blueprint: WeeklyBlueprint[];
  weekStart: Date;
  completedDayIndex?: number;
}) {
  const { athleteProfileId, coachId, blueprint, weekStart, completedDayIndex } = params;
  const createdItems = [];

  for (let i = 0; i < blueprint.length; i += 1) {
    const spec = blueprint[i];
    const date = new Date(weekStart);
    date.setUTCDate(weekStart.getUTCDate() + i);

    const calendarItem = await prisma.calendarItem.create({
      data: {
        athlete: {
          connect: { userId: athleteProfileId },
        },
        coach: {
          connect: { id: coachId },
        },
        date,
        plannedStartTimeLocal: spec.startTime,
        discipline: spec.discipline,
        subtype: spec.subtype,
        title: spec.title,
        plannedDurationMinutes: spec.duration,
        plannedDistanceKm: spec.distance,
        intensityType: spec.intensityType,
        status: completedDayIndex === i ? CalendarItemStatus.COMPLETED_MANUAL : CalendarItemStatus.PLANNED,
        template: spec.templateId
          ? {
              connect: { id: spec.templateId },
            }
          : undefined,
        groupSession: spec.groupSessionId
          ? {
              connect: { id: spec.groupSessionId },
            }
          : undefined,
      },
    });

    createdItems.push(calendarItem);
  }

  return createdItems;
}

async function main() {
  await resetDatabase();

  const coach = await prisma.user.upsert({
    where: { id: coachUser.id },
    update: {
      email: coachUser.email,
      name: 'Multisport Gold Coach',
      role: 'COACH',
      timezone: 'Australia/Brisbane',
    },
    create: {
      id: coachUser.id,
      email: coachUser.email,
      name: 'Multisport Gold Coach',
      role: 'COACH',
      timezone: 'Australia/Brisbane',
    },
  });

  await prisma.coachBranding.upsert({
    where: { coachId: coach.id },
    update: {
      displayName: 'Multisport Gold',
      logoUrl: null,
    },
    create: {
      coachId: coach.id,
      displayName: 'Multisport Gold',
      logoUrl: null,
    },
  });

  await prisma.workoutTitle.createMany({
    data: defaultWorkoutTitles.map((title) => ({
      coachId: coach.id,
      discipline: title.discipline,
      title: title.title,
    })),
    skipDuplicates: true,
  });

  const athleteUsers = await Promise.all(
    athleteUsersSeed.map((seed, index) =>
      prisma.user.upsert({
        where: { id: seed.id },
        update: {
          email: seed.email,
          name: index === 0 ? 'First Athlete' : 'Second Athlete',
          role: 'ATHLETE',
          timezone: 'Australia/Brisbane',
        },
        create: {
          id: seed.id,
          email: seed.email,
          name: index === 0 ? 'First Athlete' : 'Second Athlete',
          role: 'ATHLETE',
          timezone: 'Australia/Brisbane',
        },
      }),
    ),
  );

  const athleteProfiles = await Promise.all(
    athleteUsers.map((athlete, index) =>
      prisma.athleteProfile.create({
        data: {
          userId: athlete.id,
          coachId: coach.id,
          disciplines: ['RUN', 'BIKE', 'SWIM'],
          goalsText: index === 0 ? 'Hit podium at Sunshine Coast 70.3' : 'Build consistency for first half Ironman',
          planCadenceDays: 7,
          dateOfBirth: index === 0 ? new Date('1988-03-15') : new Date('1992-07-22'),
          coachNotes: index === 0 
            ? 'Strong runner, working on bike endurance. Watch for left knee issues on long runs.'
            : 'Consistent trainer, building confidence for first HIM. Shoulder mobility needs attention in swim.',
        },
      }),
    ),
  );

  const squad = await prisma.squad.create({
    data: {
      coachId: coach.id,
      name: 'Multisport Gold Squad',
      members: {
        create: athleteProfiles.map((profile) => ({
          athlete: {
            connect: { userId: profile.userId },
          },
        })),
      },
    },
  });

  const [runTemplate, bikeTemplate, swimTemplate] = await Promise.all([
    prisma.workoutTemplate.create({
      data: {
        coachId: coach.id,
        discipline: 'RUN',
        subtype: 'Intervals',
        title: 'Run Intervals Template',
        structureJson: { reps: 6, on: '3:00', off: '2:00' },
        defaultTargetsJson: { pace: '3:45/km' },
        notes: 'Warm-up 20min, strides x4 before the main set.',
      },
    }),
    prisma.workoutTemplate.create({
      data: {
        coachId: coach.id,
        discipline: 'BIKE',
        subtype: 'Tempo',
        title: 'Bike Tempo Template',
        structureJson: { blocks: 3, duration: '15:00', intensity: '85% FTP' },
        defaultTargetsJson: { ftpPercent: 0.85 },
        notes: 'Stay aero, steady pressure.',
      },
    }),
    prisma.workoutTemplate.create({
      data: {
        coachId: coach.id,
        discipline: 'SWIM',
        subtype: 'Technique',
        title: 'Swim Skills Template',
        structureJson: { drills: ['fist', 'catch-up', 'pull buoy'] },
        defaultTargetsJson: { totalMeters: 3200 },
        notes: 'Focus on feel for the water.',
      },
    }),
  ]);

  const templateMap: TemplateMap = {
    run: { id: runTemplate.id },
    bike: { id: bikeTemplate.id },
    swim: { id: swimTemplate.id },
  };

  const groupSession = await prisma.groupSession.create({
    data: {
      coachId: coach.id,
      title: 'Tuesday Track Session',
      discipline: 'RUN',
      location: 'Runaway Bay Athletics Centre',
      startTimeLocal: '05:30',
      durationMinutes: 75,
      description: 'Weekly squad track workout focusing on speed endurance.',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU',
      visibilityType: GroupVisibilityType.SQUAD,
      targets: {
        create: [
          {
            squad: {
              connect: { id: squad.id },
            },
          },
        ],
      },
    },
  });

  // Calculate week dates
  const currentWeekStart = getWeekStart(); // W0
  const nextWeekStart = new Date(currentWeekStart);
  nextWeekStart.setUTCDate(currentWeekStart.getUTCDate() + 7); // W1
  const previousWeekStart = new Date(currentWeekStart);
  previousWeekStart.setUTCDate(currentWeekStart.getUTCDate() - 7); // W-1

  // Create PlanWeeks for all three weeks, both athletes
  await prisma.planWeek.createMany({
    data: [
      // W-1 (previous week) - PUBLISHED for both athletes
      {
        coachId: coach.id,
        athleteId: athleteProfiles[0].userId,
        weekStart: previousWeekStart,
        status: PlanWeekStatus.PUBLISHED,
        publishedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
      },
      {
        coachId: coach.id,
        athleteId: athleteProfiles[1].userId,
        weekStart: previousWeekStart,
        status: PlanWeekStatus.PUBLISHED,
        publishedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      },
      // W0 (current week) - PUBLISHED for both athletes
      {
        coachId: coach.id,
        athleteId: athleteProfiles[0].userId,
        weekStart: currentWeekStart,
        status: PlanWeekStatus.PUBLISHED,
        publishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
      },
      {
        coachId: coach.id,
        athleteId: athleteProfiles[1].userId,
        weekStart: currentWeekStart,
        status: PlanWeekStatus.PUBLISHED,
        publishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
      // W1 (next week) - DRAFT for both athletes
      {
        coachId: coach.id,
        athleteId: athleteProfiles[0].userId,
        weekStart: nextWeekStart,
        status: PlanWeekStatus.DRAFT,
        publishedAt: null,
      },
      {
        coachId: coach.id,
        athleteId: athleteProfiles[1].userId,
        weekStart: nextWeekStart,
        status: PlanWeekStatus.DRAFT,
        publishedAt: null,
      },
    ],
  });

  // Tracking counters for summary
  const stats = {
    athlete1: { planned: 0, completed: 0, skipped: 0, comments: 0, painFlags: 0, unreviewed: 0 },
    athlete2: { planned: 0, completed: 0, skipped: 0, comments: 0, painFlags: 0, unreviewed: 0 },
  };

  // ============================================================
  // W-1 (Previous Week) - Completed sessions, some reviewed
  // ============================================================

  // Athlete 1: W-1 - 3 completed sessions, 2 reviewed, 1 unreviewed (no comments)
  const athlete1PrevWeek = [
    {
      day: 0,
      discipline: 'RUN',
      title: 'Foundation Run',
      startTime: '05:30',
      duration: 45,
      distance: 9,
      completed: true,
      reviewed: true,
    },
    {
      day: 1,
      discipline: 'BIKE',
      title: 'Foundation Bike',
      startTime: '06:00',
      duration: 60,
      distance: 30,
      completed: true,
      reviewed: true,
    },
    {
      day: 3,
      discipline: 'SWIM',
      title: 'Swim Base',
      startTime: '05:45',
      duration: 50,
      distance: 2.8,
      completed: true,
      reviewed: false,
    },
  ];

  for (const session of athlete1PrevWeek) {
    const date = new Date(previousWeekStart);
    date.setUTCDate(previousWeekStart.getUTCDate() + session.day);

    const item = await prisma.calendarItem.create({
      data: {
        athleteId: athleteProfiles[0].userId,
        coachId: coach.id,
        date,
        plannedStartTimeLocal: session.startTime,
        discipline: session.discipline,
        title: session.title,
        plannedDurationMinutes: session.duration,
        plannedDistanceKm: session.distance,
        status: CalendarItemStatus.COMPLETED_MANUAL,
        reviewedAt: session.reviewed ? new Date(Date.now() - 24 * 60 * 60 * 1000) : null,
      },
    });

    if (session.completed) {
      const startTime = new Date(date);
      startTime.setUTCHours(parseInt(session.startTime.split(':')[0]), parseInt(session.startTime.split(':')[1]), 0, 0);

      await prisma.completedActivity.create({
        data: {
          athleteId: athleteProfiles[0].userId,
          calendarItemId: item.id,
          source: CompletionSource.MANUAL,
          startTime,
          durationMinutes: session.duration,
          distanceKm: session.distance,
          rpe: 6,
          notes: 'Good session',
          painFlag: false,
        },
      });

      stats.athlete1.completed++;
      if (!session.reviewed) stats.athlete1.unreviewed++;
    }
  }

  // Athlete 2: W-1 - 2 completed sessions, both reviewed (no comments)
  const athlete2PrevWeek = [
    {
      day: 0,
      discipline: 'RUN',
      title: 'Tempo Run',
      startTime: '06:00',
      duration: 50,
      distance: 10,
      completed: true,
    },
    {
      day: 2,
      discipline: 'BIKE',
      title: 'Endurance Ride',
      startTime: '05:30',
      duration: 90,
      distance: 50,
      completed: true,
    },
  ];

  for (const session of athlete2PrevWeek) {
    const date = new Date(previousWeekStart);
    date.setUTCDate(previousWeekStart.getUTCDate() + session.day);

    const item = await prisma.calendarItem.create({
      data: {
        athleteId: athleteProfiles[1].userId,
        coachId: coach.id,
        date,
        plannedStartTimeLocal: session.startTime,
        discipline: session.discipline,
        title: session.title,
        plannedDurationMinutes: session.duration,
        plannedDistanceKm: session.distance,
        status: CalendarItemStatus.COMPLETED_MANUAL,
        reviewedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });

    if (session.completed) {
      const startTime = new Date(date);
      startTime.setUTCHours(parseInt(session.startTime.split(':')[0]), parseInt(session.startTime.split(':')[1]), 0, 0);

      await prisma.completedActivity.create({
        data: {
          athleteId: athleteProfiles[1].userId,
          calendarItemId: item.id,
          source: CompletionSource.MANUAL,
          startTime,
          durationMinutes: session.duration,
          distanceKm: session.distance,
          rpe: 7,
          notes: 'Feeling strong',
          painFlag: false,
        },
      });

      stats.athlete2.completed++;
    }
  }

  // ============================================================
  // W0 (Current Week) - Rich scenario data
  // ============================================================

  // Athlete 1: W0 - Mix of completed, skipped, planned
  const athlete1CurrentWeek = [
    // Monday: Completed with pain flag + athlete comment (unreviewed)
    {
      day: 0,
      discipline: 'RUN',
      title: 'Foundation Run',
      startTime: '05:30',
      duration: 45,
      distance: 9,
      workoutDetail: 'Focus on easy aerobic pace, HR zone 2',
      status: 'completed',
      painFlag: true,
      athleteComment: 'Left knee felt tight during the last 15 minutes',
      reviewed: false,
    },
    // Tuesday: Completed with workout detail, no pain (unreviewed)
    {
      day: 1,
      discipline: 'RUN',
      title: 'Run Speed Intervals',
      startTime: '05:30',
      duration: 60,
      distance: 10,
      workoutDetail: '6x800m @ 5k pace, 2min rest',
      status: 'completed',
      painFlag: false,
      reviewed: false,
    },
    // Wednesday: Completed with pain flag, no comment (reviewed already)
    {
      day: 2,
      discipline: 'BIKE',
      title: 'Tempo Ride',
      startTime: '06:00',
      duration: 75,
      distance: 40,
      workoutDetail: '3x15min @ FTP, 5min recovery',
      status: 'completed',
      painFlag: true,
      reviewed: true,
    },
    // Thursday: Skipped with athlete comment (unreviewed)
    {
      day: 3,
      discipline: 'SWIM',
      title: 'Swim Technique',
      startTime: '05:45',
      duration: 60,
      distance: 3,
      status: 'skipped',
      athleteComment: 'Pool closed for maintenance',
      reviewed: false,
    },
    // Friday: Completed with athlete comment, no pain (unreviewed)
    {
      day: 4,
      discipline: 'BIKE',
      title: 'Foundation Bike',
      startTime: '06:15',
      duration: 60,
      distance: 35,
      status: 'completed',
      painFlag: false,
      athleteComment: 'Great session, felt really smooth today',
      reviewed: false,
    },
    // Saturday: Planned with workout detail
    {
      day: 5,
      discipline: 'RUN',
      title: 'Long Run',
      startTime: '06:00',
      duration: 90,
      distance: 18,
      workoutDetail: 'Start easy, negative split the second half',
      status: 'planned',
    },
    // Sunday: Planned (no workout detail)
    {
      day: 6,
      discipline: 'REST',
      title: 'Rest Day',
      startTime: '08:00',
      duration: 0,
      status: 'planned',
    },
  ];

  for (const session of athlete1CurrentWeek) {
    const date = new Date(currentWeekStart);
    date.setUTCDate(currentWeekStart.getUTCDate() + session.day);

    const calStatus =
      session.status === 'completed'
        ? CalendarItemStatus.COMPLETED_MANUAL
        : session.status === 'skipped'
        ? CalendarItemStatus.SKIPPED
        : CalendarItemStatus.PLANNED;

    const item = await prisma.calendarItem.create({
      data: {
        athleteId: athleteProfiles[0].userId,
        coachId: coach.id,
        date,
        plannedStartTimeLocal: session.startTime,
        discipline: session.discipline,
        title: session.title,
        plannedDurationMinutes: session.duration,
        plannedDistanceKm: session.distance,
        workoutDetail: session.workoutDetail || null,
        status: calStatus,
        reviewedAt: session.reviewed ? new Date(Date.now() - 24 * 60 * 60 * 1000) : null,
      },
    });

    if (session.status === 'completed') {
      const startTime = new Date(date);
      startTime.setUTCHours(parseInt(session.startTime.split(':')[0]), parseInt(session.startTime.split(':')[1]), 0, 0);

      await prisma.completedActivity.create({
        data: {
          athleteId: athleteProfiles[0].userId,
          calendarItemId: item.id,
          source: CompletionSource.MANUAL,
          startTime,
          durationMinutes: session.duration,
          distanceKm: session.distance,
          rpe: session.painFlag ? 8 : 6,
          notes: session.painFlag ? 'Discomfort noted' : 'Session completed as planned',
          painFlag: session.painFlag || false,
        },
      });

      stats.athlete1.completed++;
      if (session.painFlag) stats.athlete1.painFlags++;
      if (!session.reviewed) stats.athlete1.unreviewed++;
    } else if (session.status === 'skipped') {
      stats.athlete1.skipped++;
      if (!session.reviewed) stats.athlete1.unreviewed++;
    } else {
      stats.athlete1.planned++;
    }

    if (session.athleteComment) {
      await prisma.comment.create({
        data: {
          authorId: athleteProfiles[0].userId,
          calendarItemId: item.id,
          body: session.athleteComment,
        },
      });
      stats.athlete1.comments++;
    }
  }

  // Athlete 2: W0 - Different mix
  const athlete2CurrentWeek = [
    // Monday: Completed with pain flag, no comment (unreviewed)
    {
      day: 0,
      discipline: 'RUN',
      title: 'Tempo Run',
      startTime: '06:00',
      duration: 50,
      distance: 10,
      workoutDetail: 'Build to threshold in final 20 minutes',
      status: 'completed',
      painFlag: true,
      reviewed: false,
    },
    // Tuesday: Skipped with athlete comment (unreviewed)
    {
      day: 1,
      discipline: 'BIKE',
      title: 'Bike Power Intervals',
      startTime: '05:30',
      duration: 75,
      distance: 35,
      status: 'skipped',
      athleteComment: 'Woke up feeling under the weather, decided to rest',
      reviewed: false,
    },
    // Wednesday: Completed with athlete comment + pain flag (unreviewed)
    {
      day: 2,
      discipline: 'SWIM',
      title: 'Swim Endurance',
      startTime: '05:45',
      duration: 60,
      distance: 3.5,
      status: 'completed',
      painFlag: true,
      athleteComment: 'Shoulder felt tight in the final 500m',
      reviewed: false,
    },
    // Thursday: Completed, no pain, no comment (reviewed already)
    {
      day: 3,
      discipline: 'RUN',
      title: 'Fartlek Run',
      startTime: '06:00',
      duration: 55,
      distance: 11,
      workoutDetail: 'Play with pace, stay relaxed',
      status: 'completed',
      painFlag: false,
      reviewed: true,
    },
    // Friday: Completed with athlete comment, no pain (unreviewed)
    {
      day: 4,
      discipline: 'BIKE',
      title: 'Endurance Ride',
      startTime: '05:30',
      duration: 90,
      distance: 50,
      status: 'completed',
      painFlag: false,
      athleteComment: 'Beautiful morning ride, felt great',
      reviewed: false,
    },
    // Saturday: Planned with workout detail
    {
      day: 5,
      discipline: 'SWIM',
      title: 'Swim Fartlek + Sprint',
      startTime: '07:00',
      duration: 65,
      distance: 3.8,
      workoutDetail: 'Include 8x50m sprints with 30sec rest',
      status: 'planned',
    },
    // Sunday: Planned (no workout detail)
    {
      day: 6,
      discipline: 'RUN',
      title: 'Long Run',
      startTime: '06:00',
      duration: 100,
      distance: 20,
      status: 'planned',
    },
  ];

  for (const session of athlete2CurrentWeek) {
    const date = new Date(currentWeekStart);
    date.setUTCDate(currentWeekStart.getUTCDate() + session.day);

    const calStatus =
      session.status === 'completed'
        ? CalendarItemStatus.COMPLETED_MANUAL
        : session.status === 'skipped'
        ? CalendarItemStatus.SKIPPED
        : CalendarItemStatus.PLANNED;

    const item = await prisma.calendarItem.create({
      data: {
        athleteId: athleteProfiles[1].userId,
        coachId: coach.id,
        date,
        plannedStartTimeLocal: session.startTime,
        discipline: session.discipline,
        title: session.title,
        plannedDurationMinutes: session.duration,
        plannedDistanceKm: session.distance,
        workoutDetail: session.workoutDetail || null,
        status: calStatus,
        reviewedAt: session.reviewed ? new Date(Date.now() - 24 * 60 * 60 * 1000) : null,
      },
    });

    if (session.status === 'completed') {
      const startTime = new Date(date);
      startTime.setUTCHours(parseInt(session.startTime.split(':')[0]), parseInt(session.startTime.split(':')[1]), 0, 0);

      await prisma.completedActivity.create({
        data: {
          athleteId: athleteProfiles[1].userId,
          calendarItemId: item.id,
          source: CompletionSource.MANUAL,
          startTime,
          durationMinutes: session.duration,
          distanceKm: session.distance,
          rpe: session.painFlag ? 8 : 6,
          notes: session.painFlag ? 'Some discomfort' : 'Good session',
          painFlag: session.painFlag || false,
        },
      });

      stats.athlete2.completed++;
      if (session.painFlag) stats.athlete2.painFlags++;
      if (!session.reviewed) stats.athlete2.unreviewed++;
    } else if (session.status === 'skipped') {
      stats.athlete2.skipped++;
      if (!session.reviewed) stats.athlete2.unreviewed++;
    } else {
      stats.athlete2.planned++;
    }

    if (session.athleteComment) {
      await prisma.comment.create({
        data: {
          authorId: athleteProfiles[1].userId,
          calendarItemId: item.id,
          body: session.athleteComment,
        },
      });
      stats.athlete2.comments++;
    }
  }

  // ============================================================
  // W1 (Next Week) - DRAFT workouts
  // ============================================================

  // Athlete 1: W1 - 6 planned workouts
  const athlete1NextWeek = [
    {
      day: 0,
      discipline: 'RUN',
      title: 'Foundation Run',
      startTime: '05:30',
      duration: 50,
      distance: 10,
      workoutDetail: 'Easy aerobic pace',
    },
    {
      day: 1,
      discipline: 'BIKE',
      title: 'Bike Power Intervals',
      startTime: '06:00',
      duration: 75,
      distance: 38,
    },
    {
      day: 2,
      discipline: 'SWIM',
      title: 'Swim Technique',
      startTime: '05:45',
      duration: 60,
      distance: 3.2,
      workoutDetail: 'Focus on catch and pull',
    },
    {
      day: 3,
      discipline: 'RUN',
      title: 'Tempo Run',
      startTime: '06:00',
      duration: 55,
      distance: 11,
    },
    {
      day: 4,
      discipline: 'BIKE',
      title: 'Endurance Ride',
      startTime: '05:30',
      duration: 90,
      distance: 50,
    },
    {
      day: 5,
      discipline: 'RUN',
      title: 'Long Run',
      startTime: '06:00',
      duration: 95,
      distance: 19,
      workoutDetail: 'Negative split, finish strong',
    },
  ];

  for (const session of athlete1NextWeek) {
    const date = new Date(nextWeekStart);
    date.setUTCDate(nextWeekStart.getUTCDate() + session.day);

    await prisma.calendarItem.create({
      data: {
        athleteId: athleteProfiles[0].userId,
        coachId: coach.id,
        date,
        plannedStartTimeLocal: session.startTime,
        discipline: session.discipline,
        title: session.title,
        plannedDurationMinutes: session.duration,
        plannedDistanceKm: session.distance,
        workoutDetail: session.workoutDetail || null,
        status: CalendarItemStatus.PLANNED,
      },
    });

    stats.athlete1.planned++;
  }

  // Athlete 2: W1 - 5 planned workouts
  const athlete2NextWeek = [
    {
      day: 0,
      discipline: 'RUN',
      title: 'Fartlek Run',
      startTime: '06:00',
      duration: 50,
      distance: 10,
    },
    {
      day: 1,
      discipline: 'SWIM',
      title: 'Swim Base',
      startTime: '05:45',
      duration: 55,
      distance: 3,
      workoutDetail: 'Steady pace, focus on rhythm',
    },
    {
      day: 2,
      discipline: 'BIKE',
      title: 'Tempo Ride',
      startTime: '05:30',
      duration: 80,
      distance: 42,
    },
    {
      day: 4,
      discipline: 'RUN',
      title: 'Run Speed Intervals',
      startTime: '06:00',
      duration: 60,
      distance: 11,
      workoutDetail: '8x400m @ 5k pace',
    },
    {
      day: 6,
      discipline: 'BIKE',
      title: 'Endurance Ride',
      startTime: '06:00',
      duration: 120,
      distance: 65,
    },
  ];

  for (const session of athlete2NextWeek) {
    const date = new Date(nextWeekStart);
    date.setUTCDate(nextWeekStart.getUTCDate() + session.day);

    await prisma.calendarItem.create({
      data: {
        athleteId: athleteProfiles[1].userId,
        coachId: coach.id,
        date,
        plannedStartTimeLocal: session.startTime,
        discipline: session.discipline,
        title: session.title,
        plannedDurationMinutes: session.duration,
        plannedDistanceKm: session.distance,
        workoutDetail: session.workoutDetail || null,
        status: CalendarItemStatus.PLANNED,
      },
    });

    stats.athlete2.planned++;
  }

  // ============================================================
  // Coach Journal Entries
  // ============================================================

  // Athlete 1 journal entries
  await prisma.coachJournalEntry.createMany({
    data: [
      {
        coachId: coach.id,
        athleteId: athleteProfiles[0].userId,
        entryDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), // 2 weeks ago
        body: 'Initial assessment complete. Strong aerobic base, needs work on bike power. Setting conservative targets for first month.',
      },
      {
        coachId: coach.id,
        athleteId: athleteProfiles[0].userId,
        entryDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 1 week ago
        body: 'Good progress on track sessions. Noticed knee discomfort mentioned in logs - adjusting volume slightly and adding mobility work.',
      },
      {
        coachId: coach.id,
        athleteId: athleteProfiles[0].userId,
        entryDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        body: 'Tempo ride looked strong. Athlete is responding well to increased intensity. Planning brick session for next week.',
      },
    ],
  });

  // Athlete 2 journal entries
  await prisma.coachJournalEntry.createMany({
    data: [
      {
        coachId: coach.id,
        athleteId: athleteProfiles[1].userId,
        entryDate: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000), // 3 weeks ago
        body: 'New athlete onboarding. Building base fitness, focus on consistency and form development.',
      },
      {
        coachId: coach.id,
        athleteId: athleteProfiles[1].userId,
        entryDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
        body: 'Skipped bike session due to feeling unwell - good decision. Reminded about communication and recovery priorities.',
      },
      {
        coachId: coach.id,
        athleteId: athleteProfiles[1].userId,
        entryDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
        body: 'Swim technique improving nicely. Shoulder mobility exercises paying off. Consider adding more structured swim workouts.',
      },
    ],
  });

  // ============================================================
  // Summary Output
  // ============================================================

  console.log('\n✅ Seed data created successfully!\n');
  console.log('📅 Week Dates:');
  console.log(`   W-1 (Previous):  ${previousWeekStart.toISOString().split('T')[0]}`);
  console.log(`   W0  (Current):   ${currentWeekStart.toISOString().split('T')[0]}`);
  console.log(`   W1  (Next):      ${nextWeekStart.toISOString().split('T')[0]}\n`);

  console.log('👤 First Athlete:');
  console.log(`   Planned:     ${stats.athlete1.planned}`);
  console.log(`   Completed:   ${stats.athlete1.completed}`);
  console.log(`   Skipped:     ${stats.athlete1.skipped}`);
  console.log(`   Comments:    ${stats.athlete1.comments}`);
  console.log(`   Pain Flags:  ${stats.athlete1.painFlags}`);
  console.log(`   Unreviewed:  ${stats.athlete1.unreviewed}\n`);

  console.log('👤 Second Athlete:');
  console.log(`   Planned:     ${stats.athlete2.planned}`);
  console.log(`   Completed:   ${stats.athlete2.completed}`);
  console.log(`   Skipped:     ${stats.athlete2.skipped}`);
  console.log(`   Comments:    ${stats.athlete2.comments}`);
  console.log(`   Pain Flags:  ${stats.athlete2.painFlags}`);
  console.log(`   Unreviewed:  ${stats.athlete2.unreviewed}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { prisma } from '../../../lib/prisma';

import { generateAiDraftPlanV1 } from '../server/draft-plan';
import { publishAiDraftPlan } from '../server/publish';
import { createAthleteSessionFeedback } from '../server/feedback';
import { evaluateAdaptationTriggers } from '../server/adaptations';
import { generatePlanChangeProposal } from '../server/proposals';

let idCounter = 0;

function testTag() {
  const run = String(process.env.TEST_RUN_ID ?? 'local');
  // Vitest may execute test files in parallel across worker threads/processes.
  // Prefer Vitest-provided worker IDs when present to avoid collisions.
  const worker = String(
    process.env.VITEST_WORKER_ID ??
      process.env.VITEST_POOL_ID ??
      process.env.TEST_WORKER_INDEX ??
      process.pid
  );
  return { run, worker };
}

export function nextTestId(prefix: string) {
  const { run, worker } = testTag();
  idCounter += 1;
  return `${prefix}_${run}_${worker}_${idCounter}`;
}

export async function createCoach(params?: { id?: string }) {
  const id = params?.id ?? nextTestId('coach');
  return prisma.user.upsert({
    where: { id },
    update: {
      email: `${id}@local`,
      role: 'COACH',
      timezone: 'UTC',
      name: 'Test Coach',
      authProviderId: id,
    },
    create: {
      id,
      email: `${id}@local`,
      role: 'COACH',
      timezone: 'UTC',
      name: 'Test Coach',
      authProviderId: id,
    },
  });
}

export async function createAthlete(params: { coachId: string; id?: string }) {
  const id = params.id ?? nextTestId('athlete');

  // Defensive: ensure coach exists before linking AthleteProfile.
  await createCoach({ id: params.coachId });

  const athlete = await prisma.user.upsert({
    where: { id },
    update: {
      email: `${id}@local`,
      role: 'ATHLETE',
      timezone: 'UTC',
      name: 'Test Athlete',
      authProviderId: id,
    },
    create: {
      id,
      email: `${id}@local`,
      role: 'ATHLETE',
      timezone: 'UTC',
      name: 'Test Athlete',
      authProviderId: id,
    },
  });

  const profile = await prisma.athleteProfile.upsert({
    where: { userId: athlete.id },
    update: { coachId: params.coachId, disciplines: ['OTHER'] },
    create: { userId: athlete.id, coachId: params.coachId, disciplines: ['OTHER'] },
  });

  return { athlete, profile };
}

export async function seedDevCoachAndAthlete() {
  const coach = await createCoach({ id: 'dev-coach' });
  const athlete = await createAthlete({ coachId: coach.id, id: 'dev-athlete' });
  return { coach, athlete: athlete.athlete, profile: athlete.profile };
}

export async function createDraftPlanForAthlete(params: {
  coachId: string;
  athleteId: string;
  setup?: {
    eventDate: string;
    weeksToEvent: number;
    weekStart: 'monday' | 'sunday';
    weeklyAvailabilityDays: number[];
    weeklyAvailabilityMinutes: number;
    disciplineEmphasis: 'balanced' | 'swim' | 'bike' | 'run';
    riskTolerance: 'low' | 'med' | 'high';
    maxIntensityDaysPerWeek: number;
    maxDoublesPerWeek: number;
    longSessionDay: number | null;
  };
}) {
  const setup =
    params.setup ??
    ({
      eventDate: '2026-08-15',
      weeksToEvent: 6,
      weekStart: 'monday',
      weeklyAvailabilityDays: [1, 3, 5, 6],
      weeklyAvailabilityMinutes: 300,
      disciplineEmphasis: 'balanced',
      riskTolerance: 'med',
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    } as const);

  return generateAiDraftPlanV1({
    coachId: params.coachId,
    athleteId: params.athleteId,
    setup,
  });
}

export async function publishDraftPlan(params: { coachId: string; athleteId: string; aiPlanDraftId: string; now?: Date }) {
  return publishAiDraftPlan({
    coachId: params.coachId,
    athleteId: params.athleteId,
    aiPlanDraftId: params.aiPlanDraftId,
    now: params.now,
  });
}

export async function seedFeedback(params: {
  coachId: string;
  athleteId: string;
  aiPlanDraftId: string;
  draftSessionId: string;
  completedStatus?: 'DONE' | 'PARTIAL' | 'SKIPPED';
  feel?: 'EASY' | 'OK' | 'HARD' | 'TOO_HARD' | null;
  sorenessFlag?: boolean;
  sorenessNotes?: string | null;
}) {
  return createAthleteSessionFeedback({
    coachId: params.coachId,
    athleteId: params.athleteId,
    aiPlanDraftId: params.aiPlanDraftId,
    draftSessionId: params.draftSessionId,
    completedStatus: params.completedStatus ?? 'DONE',
    feel: params.feel ?? 'OK',
    sorenessFlag: params.sorenessFlag ?? false,
    sorenessNotes: params.sorenessNotes ?? null,
    rpe: null,
    sleepQuality: null,
  });
}

export async function seedTriggersAndProposal(params: {
  coachId: string;
  athleteId: string;
  aiPlanDraftId: string;
  now?: Date;
}) {
  const evaluated = await evaluateAdaptationTriggers({
    coachId: params.coachId,
    athleteId: params.athleteId,
    aiPlanDraftId: params.aiPlanDraftId,
    now: params.now,
  });

  const triggerIds = evaluated.triggers.map((t) => t.id);
  const { proposal } = await generatePlanChangeProposal({
    coachId: params.coachId,
    athleteId: params.athleteId,
    aiPlanDraftId: params.aiPlanDraftId,
    triggerIds,
  });

  return { evaluated, proposal, triggerIds };
}

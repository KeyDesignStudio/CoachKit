import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';

import { DeterministicAiPlanBuilderAI } from '@/modules/ai-plan-builder/ai/deterministic';
import { sessionDetailV1Schema, buildDeterministicSessionDetailV1 } from '@/modules/ai-plan-builder/rules/session-detail';
import {
  buildReferenceRecipePool,
  selectReferenceRecipesForSession,
  upsertCoachWorkoutExemplarFromSessionDetail,
} from '@/modules/ai-plan-builder/server/reference-recipes';

import { createAthlete, createCoach } from './seed';

describe('AI Plan Builder reference recipes', () => {
  let coachId = '';
  let athleteId = '';

  beforeAll(async () => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();
    const coach = await createCoach();
    const athlete = await createAthlete({ coachId: coach.id });
    coachId = coach.id;
    athleteId = athlete.athlete.id;
  });

  afterAll(async () => {
    await prisma.coachWorkoutExemplarFeedback.deleteMany({ where: { coachId } });
    await prisma.coachWorkoutExemplar.deleteMany({ where: { coachId } });
    await prisma.planSource.deleteMany({ where: { sourceFilePath: { startsWith: `coach:${coachId}` } } });
    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });
    await prisma.$disconnect();
  });

  it('promotes coach-edited session details and prioritizes them over plan-library references', async () => {
    const planSource = await prisma.planSource.create({
      data: {
        type: 'TEXT',
        title: 'Coach reference endurance run',
        sport: 'RUN',
        distance: 'FIVE_K',
        level: 'BEGINNER',
        durationWeeks: 4,
        checksumSha256: `reference_${coachId}_run_recipe`,
        isActive: true,
        rawText: 'Reference run source',
        rawJson: {},
        sourceFilePath: `coach:${coachId}:reference-run`,
        versions: {
          create: {
            version: 1,
            extractionMetaJson: { confidence: 1, warnings: [], sessionCount: 1, weekCount: 1 },
            weeks: {
              create: {
                weekIndex: 0,
                totalMinutes: 40,
                totalSessions: 1,
                sessions: {
                  create: {
                    ordinal: 1,
                    dayOfWeek: 2,
                    discipline: 'RUN',
                    sessionType: 'endurance',
                    title: 'Plan library endurance run',
                    durationMinutes: 40,
                    distanceKm: 6,
                    recipeV2Json: {
                      version: 'v2',
                      primaryGoal: 'aerobic-durability',
                      executionSummary: 'Plan-library aerobic run with progressive kilometre segments.',
                      blocks: [
                        { key: 'warmup', durationMinutes: 10, notes: ['10min easy jog'] },
                        {
                          key: 'main',
                          durationMinutes: 25,
                          intervals: [{ reps: 4, on: '1km', intent: 'progressive from steady to comfortably hard' }],
                          notes: ['Keep the final kilometre smooth rather than sprinting.'],
                        },
                        { key: 'cooldown', durationMinutes: 5, notes: ['5min easy jog'] },
                      ],
                      adjustments: {
                        ifMissed: ['Shorten the main set to 3 x 1km.'],
                        ifCooked: ['Keep every kilometre steady.'],
                      },
                      qualityChecks: ['Run the kilometre repeats with even pacing.'],
                    },
                    parserConfidence: 1,
                    parserWarningsJson: [],
                  },
                },
              },
            },
          },
        },
      },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    const versionId = String(planSource.versions[0]?.id ?? '');
    expect(versionId).toBeTruthy();

    const libraryPool = await buildReferenceRecipePool({
      coachId,
      planSourceSelectionJson: { selectedPlanSourceVersionIds: [versionId] } as any,
      setupJson: null,
      sessions: [{ discipline: 'RUN', type: 'endurance' }],
    });
    const librarySelection = selectReferenceRecipesForSession({
      pool: libraryPool,
      session: { discipline: 'RUN', type: 'endurance', durationMinutes: 40 },
    });
    expect(librarySelection.referenceRecipes[0]?.sourceKind).toBe('plan-library');

    const baseDetail = buildDeterministicSessionDetailV1({
      discipline: 'run',
      type: 'endurance',
      durationMinutes: 40,
    });
    const coachEditedDetail = {
      ...baseDetail,
      objective: 'Cruise intervals with controlled form',
      structure: baseDetail.structure.map((block) =>
        block.blockType === 'main' ? { ...block, steps: '3 x 8min cruise with 2min easy between.' } : block
      ),
    };

    const exemplar = await upsertCoachWorkoutExemplarFromSessionDetail({
      coachId,
      athleteId,
      draftId: 'draft_reference_test',
      draftSessionId: 'session_reference_test',
      discipline: 'RUN',
      sessionType: 'endurance',
      durationMinutes: 40,
      detail: coachEditedDetail,
    });

    expect(exemplar).toBeTruthy();

    const feedbackCount = await prisma.coachWorkoutExemplarFeedback.count({
      where: { coachId, exemplarId: exemplar?.id },
    });
    expect(feedbackCount).toBe(1);

    const combinedPool = await buildReferenceRecipePool({
      coachId,
      planSourceSelectionJson: { selectedPlanSourceVersionIds: [versionId] } as any,
      setupJson: null,
      sessions: [{ discipline: 'RUN', type: 'endurance' }],
    });
    const combinedSelection = selectReferenceRecipesForSession({
      pool: combinedPool,
      session: { discipline: 'RUN', type: 'endurance', durationMinutes: 40 },
    });
    expect(combinedSelection.referenceRecipes[0]?.sourceKind).toBe('coach-exemplar');

    const ai = new DeterministicAiPlanBuilderAI({ recordAudit: false });
    const result = await ai.generateSessionDetail({
      athleteSummaryText: 'Runner building toward a 5k',
      athleteProfile: {
        disciplines: ['RUN'],
        primaryGoal: '5k',
        secondaryGoals: [],
        focus: 'Endurance',
        eventName: null,
        eventDate: null,
        timelineWeeks: 4,
        experienceLevel: 'beginner',
        weeklyMinutesTarget: 180,
        consistencyLevel: 'building',
        availableDays: ['mon', 'wed', 'sat'],
        scheduleVariability: null,
        sleepQuality: null,
        injuryStatus: null,
        currentPainPoints: [],
        preferredTrainingTimes: [],
        equipmentAvailable: [],
        trainingEnvironment: [],
        coachNotes: null,
      } as any,
      constraints: {
        riskTolerance: 'med',
        maxIntensityDaysPerWeek: 1,
        longSessionDay: 6,
        weeklyMinutesTarget: 180,
      },
      session: {
        weekIndex: 0,
        dayOfWeek: 2,
        discipline: 'RUN',
        type: 'endurance',
        durationMinutes: 40,
      },
      referenceRecipes: combinedSelection.referenceRecipes,
    });

    const parsed = sessionDetailV1Schema.safeParse(result.detail);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.structure.some((block) => /3 x 8min cruise/i.test(block.steps))).toBe(true);
  });
});

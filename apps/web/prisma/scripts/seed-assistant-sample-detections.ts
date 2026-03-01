/**
 * DEV helper: seed sample Assistant detections for one coached athlete.
 *
 * Run:
 *   cd /Volumes/DockSSD/Projects/CoachKit
 *   export DATABASE_URL='postgresql://...'
 *   npx --prefix apps/web ts-node --project apps/web/tsconfig.prisma.json \
 *     apps/web/prisma/scripts/seed-assistant-sample-detections.ts
 */

import {
  AssistantDetectionState,
  AssistantLlmOutputType,
  AssistantRecommendationType,
  AssistantSeverity,
  PrismaClient,
  type Prisma,
} from '@prisma/client';

const prisma = new PrismaClient();

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function buildRecommendation(type: AssistantRecommendationType, title: string, details: Record<string, unknown>) {
  return {
    recommendationType: type,
    title,
    details: asJson(details),
  };
}

async function main() {
  console.log('[assistant-sample-seed] Starting...');

  const athlete = await prisma.athleteProfile.findFirst({
    orderBy: [{ userId: 'asc' }],
    select: {
      userId: true,
      coachId: true,
      user: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!athlete) {
    throw new Error('No athlete profile found. Create at least one athlete before seeding sample detections.');
  }

  const defs = await prisma.assistantPatternDefinition.findMany({
    where: { status: 'ACTIVE' },
    orderBy: [{ key: 'asc' }],
  });

  if (defs.length === 0) {
    throw new Error('No active assistant pattern definitions found. Run seed-assistant-pattern-definitions first.');
  }

  const now = new Date();
  const periodStart = new Date(now);
  periodStart.setDate(periodStart.getDate() - 28);

  let created = 0;

  for (const [index, def] of defs.entries()) {
    const existing = await prisma.assistantDetection.findFirst({
      where: {
        athleteId: athlete.userId,
        coachId: athlete.coachId,
        patternDefinitionId: def.id,
      },
      select: { id: true },
    });

    if (existing) continue;

    const confidenceScore = Math.max(58, 86 - index * 5);
    const severity: AssistantSeverity = index === 0 ? 'HIGH' : index % 2 === 0 ? 'MEDIUM' : 'LOW';

    const detection = await prisma.assistantDetection.create({
      data: {
        athleteId: athlete.userId,
        coachId: athlete.coachId,
        patternDefinitionId: def.id,
        detectedAt: now,
        periodStart,
        periodEnd: now,
        severity,
        confidenceScore,
        state: AssistantDetectionState.NEW,
        evidence: asJson({
          sample: true,
          note: 'Seeded demo evidence for Assistant UI and API validation.',
          instances: [
            { date: new Date(now.getTime() - 7 * 86400000).toISOString(), outcome: 'below_target', marker: 'session_quality_drop' },
            { date: new Date(now.getTime() - 3 * 86400000).toISOString(), outcome: 'missed_interval', marker: 'repeat_pattern' },
          ],
        }),
      },
    });

    const baseTitle = def.name;

    await prisma.assistantRecommendation.createMany({
      data: [
        buildRecommendation('PLAN_ADJUSTMENT', `Adjust plan for ${baseTitle}`, {
          intent: 'minimal_plan_diff',
          aggressiveness: 'standard',
        }),
        buildRecommendation('MESSAGE_ONLY', `Message athlete about ${baseTitle}`, {
          tone: 'matter_of_fact',
        }),
      ].map((row) => ({
        detectionId: detection.id,
        recommendationType: row.recommendationType,
        title: row.title,
        details: row.details,
      })),
    });

    await prisma.assistantLlmOutput.createMany({
      data: [
        {
          detectionId: detection.id,
          outputType: AssistantLlmOutputType.COACH_SUMMARY,
          content: `Recent sessions suggest a repeatable ${baseTitle.toLowerCase()} pattern over the last 4 weeks.`,
          model: 'seed',
          promptVersion: 'assistant_summary_v1',
          tokenUsage: asJson({ seeded: true }),
        },
        {
          detectionId: detection.id,
          outputType: AssistantLlmOutputType.ATHLETE_MESSAGE_DRAFT,
          content: `Noticed a recurring trend around ${baseTitle.toLowerCase()}. Let's make a small adjustment this week to keep progress steady.`,
          model: 'seed',
          promptVersion: 'assistant_message_draft_v1',
          tokenUsage: asJson({ seeded: true }),
        },
        {
          detectionId: detection.id,
          outputType: AssistantLlmOutputType.RATIONALE,
          content: 'Confidence is based on repeated instances, effect size, and recency weighting.',
          model: 'seed',
          promptVersion: 'assistant_rationale_v1',
          tokenUsage: asJson({ seeded: true }),
        },
      ],
    });

    created += 1;
  }

  console.log(`[assistant-sample-seed] Athlete: ${athlete.user.name ?? athlete.userId}`);
  console.log(`[assistant-sample-seed] Created detections: ${created}`);
  console.log('[assistant-sample-seed] Done.');
}

main()
  .catch((error) => {
    console.error('[assistant-sample-seed] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

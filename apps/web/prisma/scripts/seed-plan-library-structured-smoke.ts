/**
 * Seeds structured plan-library templates for Option 1 smoke tests.
 *
 * Run (from repo root):
 *   cd /Volumes/DockSSD/Projects/CoachKit
 *   export DATABASE_URL='postgresql://...'
 *   npx --prefix apps/web ts-node --project apps/web/tsconfig.prisma.json \
 *     apps/web/prisma/scripts/seed-plan-library-structured-smoke.ts
 */

import { Prisma, PrismaClient, type PlanSourceDiscipline } from '@prisma/client';

const prisma = new PrismaClient();

const COACH_ID = process.env.SMOKE_COACH_ID || 'user-coach-multisport';

type SessionSeed = {
  dayOfWeek: number;
  discipline: PlanSourceDiscipline;
  sessionType: string;
  title: string;
  durationMinutes: number;
  distanceKm: number | null;
  notes: string | null;
};

const WEEK_1: SessionSeed[] = [
  { dayOfWeek: 1, discipline: 'SWIM', sessionType: 'technique', title: 'Swim drills + easy aerobic', durationMinutes: 45, distanceKm: 1.8, notes: null },
  { dayOfWeek: 2, discipline: 'RUN', sessionType: 'interval', title: 'Run 6 x 3min', durationMinutes: 50, distanceKm: 9, notes: 'Warm-up and cool-down included.' },
  { dayOfWeek: 3, discipline: 'BIKE', sessionType: 'endurance', title: 'Bike endurance steady', durationMinutes: 70, distanceKm: 32, notes: null },
  { dayOfWeek: 4, discipline: 'REST', sessionType: 'recovery', title: 'Rest day', durationMinutes: 0, distanceKm: null, notes: 'Mobility only.' },
  { dayOfWeek: 5, discipline: 'SWIM', sessionType: 'tempo', title: 'Swim tempo sets', durationMinutes: 55, distanceKm: 2.3, notes: null },
  { dayOfWeek: 6, discipline: 'BIKE', sessionType: 'long', title: 'Long bike', durationMinutes: 130, distanceKm: 62, notes: null },
  { dayOfWeek: 7, discipline: 'RUN', sessionType: 'long', title: 'Long run easy', durationMinutes: 80, distanceKm: 14, notes: null },
];

async function upsertTemplate(params: { title: string; isPublished: boolean; qualityScore: number; reviewStatus: 'DRAFT' | 'PUBLISHED' }) {
  const existing = await prisma.planLibraryTemplate.findFirst({
    where: { createdBy: COACH_ID, title: params.title },
    select: { id: true },
  });

  const template = existing
    ? await prisma.planLibraryTemplate.update({
        where: { id: existing.id },
        data: {
          isPublished: params.isPublished,
          qualityScore: params.qualityScore,
          reviewStatus: params.reviewStatus,
          publishedAt: params.isPublished ? new Date() : null,
          durationWeeks: 12,
          sport: 'TRIATHLON',
          distance: 'OLYMPIC',
          level: 'BEGINNER',
          author: 'CoachKit smoke seed',
          publisher: 'CoachKit',
        },
      })
    : await prisma.planLibraryTemplate.create({
        data: {
          title: params.title,
          sport: 'TRIATHLON',
          distance: 'OLYMPIC',
          level: 'BEGINNER',
          durationWeeks: 12,
          author: 'CoachKit smoke seed',
          publisher: 'CoachKit',
          isPublished: params.isPublished,
          publishedAt: params.isPublished ? new Date() : null,
          qualityScore: params.qualityScore,
          reviewStatus: params.reviewStatus,
          createdBy: COACH_ID,
        },
      });

  await prisma.planLibraryTemplateSession.deleteMany({
    where: { planTemplateWeek: { planTemplateId: template.id } },
  });
  await prisma.planLibraryTemplateWeek.deleteMany({
    where: { planTemplateId: template.id },
  });

  for (let weekIndex = 1; weekIndex <= 2; weekIndex += 1) {
    const week = await prisma.planLibraryTemplateWeek.create({
      data: {
        planTemplateId: template.id,
        weekIndex,
        blockName: weekIndex === 1 ? 'Base build' : 'Load progression',
        phaseTag: 'BASE',
        targetLoadScore: weekIndex === 1 ? 0.6 : 0.68,
      },
    });
    for (const session of WEEK_1) {
      await prisma.planLibraryTemplateSession.create({
        data: {
          planTemplateWeekId: week.id,
          dayOfWeek: session.dayOfWeek,
          discipline: session.discipline,
          sessionType: session.sessionType,
          title: session.title,
          durationMinutes: session.durationMinutes,
          distanceKm: session.distanceKm,
          intensityType: session.sessionType === 'interval' ? 'HIGH' : session.sessionType === 'tempo' ? 'MODERATE' : null,
          intensityTargetJson:
            session.sessionType === 'interval'
              ? ({ rpe: '8/10' } as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          recipeV2Json: {
            discipline: session.discipline,
            objective: session.sessionType,
            durationMinutes: session.durationMinutes,
          },
          notes: session.notes,
          sourceConfidence: 1,
          needsReview: false,
        },
      });
    }
  }

  await prisma.planLibraryTemplateValidationRun.create({
    data: {
      planTemplateId: template.id,
      score: params.qualityScore,
      passed: params.qualityScore >= 0.75,
      issuesJson: [],
    },
  });

  return template;
}

async function main() {
  console.log('[seed-plan-library-structured-smoke] Seeding templates...');

  const published = await upsertTemplate({
    title: 'Smoke Published Olympic 12w',
    isPublished: true,
    qualityScore: 0.91,
    reviewStatus: 'PUBLISHED',
  });

  const draft = await upsertTemplate({
    title: 'Smoke Draft Olympic 12w',
    isPublished: false,
    qualityScore: 0.4,
    reviewStatus: 'DRAFT',
  });

  console.log('[seed-plan-library-structured-smoke] Done.');
  console.log(`  published template id: ${published.id}`);
  console.log(`  draft template id:     ${draft.id}`);
  console.log(`  coach id:              ${COACH_ID}`);
}

main()
  .catch((error) => {
    console.error('[seed-plan-library-structured-smoke] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

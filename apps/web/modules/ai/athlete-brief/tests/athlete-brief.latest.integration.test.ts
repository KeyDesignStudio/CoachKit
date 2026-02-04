import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';

import { ensureAthleteBrief, getLatestAthleteBriefSummary } from '@/modules/ai-plan-builder/server/athlete-brief';
import { createAthlete, createCoach } from '@/modules/ai-plan-builder/tests/seed';

describe('Athlete brief v1.1 (latest + idempotency)', () => {
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
    await prisma.athleteBrief.deleteMany({ where: { athleteId, coachId } });

    await prisma.athleteProfileAI.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });

    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('creates a brief from profile and returns a summary', async () => {
    await prisma.athleteProfile.update({
      where: { userId: athleteId },
      data: {
        primaryGoal: 'Run healthy through fall',
        focus: 'Consistency',
        timelineWeeks: 12,
        coachNotes: 'Focus on steady pacing',
        trainingPlanSchedule: { frequency: 'WEEKLY', dayOfWeek: 2, weekOfMonth: null },
        availableDays: ['Tuesday', 'Friday'],
        weeklyMinutesTarget: 240,
        painHistory: ['Knee pain after hills', 'Sharp pain on descents'],
      },
    });

    const first = await ensureAthleteBrief({ coachId, athleteId });
    expect(first.brief?.version).toBe('v1.1');
    if (!first.brief || first.brief.version !== 'v1.1') {
      throw new Error('Expected v1.1 athlete brief.');
    }
    expect(first.brief.constraintsAndSafety?.painHistory?.length ?? 0).toBeGreaterThan(0);
    expect(first.brief.riskFlags ?? []).toContain('Pain history flagged');

    const second = await ensureAthleteBrief({ coachId, athleteId });
    expect(second.brief?.version).toBe('v1.1');

    const summary = await getLatestAthleteBriefSummary({ coachId, athleteId });
    expect(summary).toContain('Goal');
  });
});

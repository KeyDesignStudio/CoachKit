import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';

import { createCoach, nextTestId } from './seed';

describe('AI Plan Builder test seeding helpers', () => {
  beforeAll(() => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();
  });

  afterAll(async () => {
    const coaches = await prisma.user.findMany({
      where: { email: { endsWith: '@local' }, name: 'Test Coach' },
      select: { id: true },
    });

    if (coaches.length) {
      await prisma.athleteProfile.deleteMany({ where: { coachId: { in: coaches.map((c) => c.id) } } });
      await prisma.user.deleteMany({ where: { id: { in: coaches.map((c) => c.id) } } });
    }
    await prisma.$disconnect();
  });

  it('nextTestId produces unique ids across repeated calls', () => {
    const a = nextTestId('x');
    const b = nextTestId('x');
    expect(b).not.toBe(a);
  });

  it('createCoach creates unique users when called repeatedly', async () => {
    const c1 = await createCoach();
    const c2 = await createCoach();
    expect(c1.id).not.toBe(c2.id);
  });
});

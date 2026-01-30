import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';

import { createCoach, nextTestId } from './seed';

describe('AI Plan Builder test seeding helpers', () => {
  beforeAll(() => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: '@local' }, name: 'Test Coach' } });
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

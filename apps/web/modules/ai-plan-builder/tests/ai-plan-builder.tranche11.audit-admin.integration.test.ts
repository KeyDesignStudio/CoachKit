import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UserRole } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import {
  AI_PLAN_BUILDER_ADMIN_EMAILS_ENV,
  listAiInvocationAuditsForAdmin,
  normalizeAiAuditListQuery,
} from '@/modules/ai-plan-builder/server/audit-admin';

import { createCoach } from './seed';

describe('AI Plan Builder v1 (Tranche 11A: audit admin listing)', () => {
  let coachId = '';

  beforeAll(async () => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();
    expect(
      process.env.AI_PLAN_BUILDER_V1 === '1' || process.env.AI_PLAN_BUILDER_V1 === 'true',
      'AI_PLAN_BUILDER_V1 must be enabled by the test harness.'
    ).toBe(true);

    const coach = await createCoach();
    coachId = coach.id;

    // Seed a bunch of audit rows.
    const baseCreatedAt = new Date('2026-01-30T00:00:00.000Z');

    const rows = Array.from({ length: 60 }).map((_, i) => ({
      actorType: 'COACH' as any,
      actorId: coachId,
      coachId,
      athleteId: null,
      capability: i % 2 === 0 ? 'summarizeIntake' : 'suggestDraftPlan',
      specVersion: 'v1',
      effectiveMode: i % 3 === 0 ? 'llm' : 'deterministic',
      provider: i % 3 === 0 ? 'mock' : 'deterministic',
      model: i % 3 === 0 ? 'mock' : null,
      inputHash: `in_${i}`,
      outputHash: `out_${i}`,
      durationMs: 100 + i,
      maxOutputTokens: i % 3 === 0 ? 600 : null,
      timeoutMs: i % 3 === 0 ? 10000 : null,
      retryCount: i % 3 === 0 ? 1 : 0,
      fallbackUsed: i % 10 === 0,
      errorCode: i % 10 === 0 ? 'LLM_RATE_LIMITED' : null,
      createdAt: new Date(baseCreatedAt.getTime() + i * 1000),
    }));

    await prisma.aiInvocationAudit.createMany({ data: rows });
  });

  afterAll(async () => {
    await prisma.aiInvocationAudit.deleteMany({ where: { coachId } });
    await prisma.user.deleteMany({ where: { id: coachId } });
    await prisma.$disconnect();
  });

  it('admin can list audits with pagination', async () => {
    process.env[AI_PLAN_BUILDER_ADMIN_EMAILS_ENV] = 'admin@local';
    const requester = { role: UserRole.COACH, email: 'admin@local' };

    const q1 = normalizeAiAuditListQuery({
      searchParams: { range: '30d', limit: '50', offset: '0' },
      now: new Date('2026-01-30T00:10:00.000Z'),
    });

    const result1 = await listAiInvocationAuditsForAdmin({ query: q1, requester });
    expect(result1.items.length).toBe(50);
    expect(result1.page.hasPrev).toBe(false);
    expect(result1.page.hasNext).toBe(true);

    const q2 = { ...q1, offset: 50 };
    const result2 = await listAiInvocationAuditsForAdmin({ query: q2, requester });
    expect(result2.items.length).toBe(10);
    expect(result2.page.hasPrev).toBe(true);
  });

  it('admin can filter by fallbackUsed and errorCode', async () => {
    const requester = { role: UserRole.ADMIN, email: 'role-admin@local' };

    const q = normalizeAiAuditListQuery({
      searchParams: { range: '30d', fallbackUsed: 'true', errorCode: 'LLM_RATE_LIMITED', limit: '200', offset: '0' },
      now: new Date('2026-01-30T00:10:00.000Z'),
    });

    const result = await listAiInvocationAuditsForAdmin({ query: q, requester });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((r) => r.fallbackUsed && r.errorCode === 'LLM_RATE_LIMITED')).toBe(true);
  });

  it('non-admin is blocked', async () => {
    const requester = { role: UserRole.COACH, email: 'nope@local' };

    const q = normalizeAiAuditListQuery({
      searchParams: { range: '30d', limit: '50', offset: '0' },
      now: new Date('2026-01-30T00:10:00.000Z'),
    });

    await expect(listAiInvocationAuditsForAdmin({ query: q, requester })).rejects.toBeInstanceOf(ApiError);
  });
});

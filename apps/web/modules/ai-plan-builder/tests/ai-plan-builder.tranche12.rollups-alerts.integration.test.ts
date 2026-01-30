import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';

import { prisma } from '@/lib/prisma';

import { computeDailyRollups } from '@/modules/ai-plan-builder/admin/rollups';
import { evaluateAlerts } from '@/modules/ai-plan-builder/admin/alerts';

import { createCoach } from './seed';

describe('AI Plan Builder v1 (Tranche 12: rollups + alerts integration)', () => {
  let coachId = '';

  beforeAll(async () => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();
    expect(
      process.env.AI_PLAN_BUILDER_V1 === '1' || process.env.AI_PLAN_BUILDER_V1 === 'true',
      'AI_PLAN_BUILDER_V1 must be enabled by the test harness.'
    ).toBe(true);

    const coach = await createCoach();
    coachId = coach.id;

    const baseCreatedAt = new Date('2026-01-30T01:00:00.000Z');

    const rows = Array.from({ length: 20 }).map((_, i) => ({
      actorType: 'COACH' as any,
      actorId: coachId,
      coachId,
      athleteId: null,
      capability: i % 2 === 0 ? 'summarizeIntake' : 'suggestDraftPlan',
      specVersion: 'v1',
      effectiveMode: 'llm',
      provider: 'mock',
      model: 'mock',
      inputHash: `in_${i}`,
      outputHash: `out_${i}`,
      durationMs: 100 + i,
      maxOutputTokens: 500,
      timeoutMs: 10000,
      retryCount: i % 3,
      fallbackUsed: i % 4 === 0,
      errorCode: i % 5 === 0 ? 'LLM_RATE_LIMITED' : null,
      createdAt: new Date(baseCreatedAt.getTime() + i * 1000),
    }));

    await prisma.aiInvocationAudit.createMany({ data: rows });
  });

  afterAll(async () => {
    await prisma.aiUsageAlert.deleteMany({});
    await prisma.aiInvocationDailyRollup.deleteMany({});
    await prisma.aiInvocationAudit.deleteMany({ where: { coachId } });
    await prisma.user.deleteMany({ where: { id: coachId } });
    await prisma.$disconnect();
  });

  it('T12.I1 rollup is idempotent over same window (values stable)', async () => {
    const since = new Date('2026-01-30T00:00:00.000Z');
    const until = new Date('2026-01-31T00:00:00.000Z');

    await computeDailyRollups({ since, until });

    const first = await prisma.aiInvocationDailyRollup.findMany({
      where: { date: new Date('2026-01-30T00:00:00.000Z') },
      orderBy: [{ capability: 'asc' }, { effectiveMode: 'asc' }],
      select: {
        date: true,
        provider: true,
        model: true,
        capability: true,
        effectiveMode: true,
        callCount: true,
        fallbackCount: true,
        errorCount: true,
        retryCountTotal: true,
        avgDurationMs: true,
        p95DurationMs: true,
        maxOutputTokensAvg: true,
        estimatedOutputTokens: true,
        estimatedCostUsd: true,
      },
    });

    await computeDailyRollups({ since, until });

    const second = await prisma.aiInvocationDailyRollup.findMany({
      where: { date: new Date('2026-01-30T00:00:00.000Z') },
      orderBy: [{ capability: 'asc' }, { effectiveMode: 'asc' }],
      select: {
        date: true,
        provider: true,
        model: true,
        capability: true,
        effectiveMode: true,
        callCount: true,
        fallbackCount: true,
        errorCount: true,
        retryCountTotal: true,
        avgDurationMs: true,
        p95DurationMs: true,
        maxOutputTokensAvg: true,
        estimatedOutputTokens: true,
        estimatedCostUsd: true,
      },
    });

    expect(second).toEqual(first);
  });

  it('T12.I2 alerts are created and de-duped for repeated evaluations', async () => {
    const prev = {
      calls: process.env.AI_USAGE_ALERT_CALLS_PER_DAY_THRESHOLD,
      fb: process.env.AI_USAGE_ALERT_FALLBACK_RATE_THRESHOLD,
      err: process.env.AI_USAGE_ALERT_ERROR_RATE_THRESHOLD,
      p95: process.env.AI_USAGE_ALERT_P95_LATENCY_MS_THRESHOLD,
      cost: process.env.AI_USAGE_ALERT_COST_USD_PER_DAY_THRESHOLD,
    };

    process.env.AI_USAGE_ALERT_CALLS_PER_DAY_THRESHOLD = '1';
    process.env.AI_USAGE_ALERT_FALLBACK_RATE_THRESHOLD = '0.01';
    process.env.AI_USAGE_ALERT_ERROR_RATE_THRESHOLD = '0.01';
    process.env.AI_USAGE_ALERT_P95_LATENCY_MS_THRESHOLD = '1';
    process.env.AI_USAGE_ALERT_COST_USD_PER_DAY_THRESHOLD = '0.000001';

    try {
      const date = new Date('2026-01-30T12:00:00.000Z');

      await evaluateAlerts({ date });
      await evaluateAlerts({ date });
    } finally {
      if (typeof prev.calls === 'string') process.env.AI_USAGE_ALERT_CALLS_PER_DAY_THRESHOLD = prev.calls;
      else delete process.env.AI_USAGE_ALERT_CALLS_PER_DAY_THRESHOLD;
      if (typeof prev.fb === 'string') process.env.AI_USAGE_ALERT_FALLBACK_RATE_THRESHOLD = prev.fb;
      else delete process.env.AI_USAGE_ALERT_FALLBACK_RATE_THRESHOLD;
      if (typeof prev.err === 'string') process.env.AI_USAGE_ALERT_ERROR_RATE_THRESHOLD = prev.err;
      else delete process.env.AI_USAGE_ALERT_ERROR_RATE_THRESHOLD;
      if (typeof prev.p95 === 'string') process.env.AI_USAGE_ALERT_P95_LATENCY_MS_THRESHOLD = prev.p95;
      else delete process.env.AI_USAGE_ALERT_P95_LATENCY_MS_THRESHOLD;
      if (typeof prev.cost === 'string') process.env.AI_USAGE_ALERT_COST_USD_PER_DAY_THRESHOLD = prev.cost;
      else delete process.env.AI_USAGE_ALERT_COST_USD_PER_DAY_THRESHOLD;
    }

    const alerts = await prisma.aiUsageAlert.findMany({
      where: {
        dateRangeStart: new Date('2026-01-30T00:00:00.000Z'),
      },
      orderBy: { createdAt: 'asc' },
    });

    // At least one alert should exist, and repeating should not spam duplicates.
    expect(alerts.length).toBeGreaterThan(0);

    const keys = new Set(alerts.map((a) => `${a.alertType}|${a.scope}|${a.capability ?? ''}`));
    expect(keys.size).toBe(alerts.length);

    // Ack flow.
    const first = alerts[0];
    await prisma.aiUsageAlert.update({
      where: { id: first.id },
      data: { acknowledgedAt: new Date(), acknowledgedBy: 'admin@local' },
    });

    const updated = await prisma.aiUsageAlert.findUnique({ where: { id: first.id } });
    expect(updated?.acknowledgedAt).toBeTruthy();
    expect(updated?.acknowledgedBy).toBe('admin@local');
  });

  it('T12.I3 admin endpoints are blocked for non-admin and allowed for admin (mock requireAuth)', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth', async () => {
      return {
        requireAuth: async () => ({
          user: {
            id: 'u1',
            role: UserRole.COACH,
            email: 'nope@local',
            name: null,
            timezone: 'UTC',
            authProviderId: 'u1',
          },
        }),
      };
    });

    const { POST: rollupPOST } = await import('@/app/api/admin/ai-usage/rollup/route');

    const resBlocked = await rollupPOST(
      new Request('http://localhost/api/admin/ai-usage/rollup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ days: 7 }),
      })
    );

    expect(resBlocked.status).toBe(404);

    vi.resetModules();
    vi.doMock('@/lib/auth', async () => {
      return {
        requireAuth: async () => ({
          user: {
            id: 'u2',
            role: UserRole.ADMIN,
            email: 'admin@local',
            name: null,
            timezone: 'UTC',
            authProviderId: 'u2',
          },
        }),
      };
    });

    const { POST: rollupPOST2 } = await import('@/app/api/admin/ai-usage/rollup/route');
    const { GET: rollupsGET } = await import('@/app/api/admin/ai-usage/rollups/route');
    const { POST: evalPOST } = await import('@/app/api/admin/ai-usage/evaluate-alerts/route');
    const { GET: alertsGET } = await import('@/app/api/admin/ai-usage/alerts/route');
    const { POST: ackPOST } = await import('@/app/api/admin/ai-usage/alerts/[id]/ack/route');

    const resOk = await rollupPOST2(
      new Request('http://localhost/api/admin/ai-usage/rollup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ days: 7 }),
      })
    );

    expect(resOk.status).toBe(200);

    const rollupsRes = await rollupsGET(new Request('http://localhost/api/admin/ai-usage/rollups?days=7'));
    expect(rollupsRes.status).toBe(200);
    const rollupsJson = await rollupsRes.json();
    expect(Array.isArray(rollupsJson?.data?.rollups)).toBe(true);

    const prev = {
      calls: process.env.AI_USAGE_ALERT_CALLS_PER_DAY_THRESHOLD,
      fb: process.env.AI_USAGE_ALERT_FALLBACK_RATE_THRESHOLD,
      err: process.env.AI_USAGE_ALERT_ERROR_RATE_THRESHOLD,
      p95: process.env.AI_USAGE_ALERT_P95_LATENCY_MS_THRESHOLD,
      cost: process.env.AI_USAGE_ALERT_COST_USD_PER_DAY_THRESHOLD,
    };

    process.env.AI_USAGE_ALERT_CALLS_PER_DAY_THRESHOLD = '1';
    process.env.AI_USAGE_ALERT_FALLBACK_RATE_THRESHOLD = '0.01';
    process.env.AI_USAGE_ALERT_ERROR_RATE_THRESHOLD = '0.01';
    process.env.AI_USAGE_ALERT_P95_LATENCY_MS_THRESHOLD = '1';
    process.env.AI_USAGE_ALERT_COST_USD_PER_DAY_THRESHOLD = '0.000001';

    try {
      const evalRes = await evalPOST(
        new Request('http://localhost/api/admin/ai-usage/evaluate-alerts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ days: 7 }),
        })
      );
      expect(evalRes.status).toBe(200);
    } finally {
      if (typeof prev.calls === 'string') process.env.AI_USAGE_ALERT_CALLS_PER_DAY_THRESHOLD = prev.calls;
      else delete process.env.AI_USAGE_ALERT_CALLS_PER_DAY_THRESHOLD;
      if (typeof prev.fb === 'string') process.env.AI_USAGE_ALERT_FALLBACK_RATE_THRESHOLD = prev.fb;
      else delete process.env.AI_USAGE_ALERT_FALLBACK_RATE_THRESHOLD;
      if (typeof prev.err === 'string') process.env.AI_USAGE_ALERT_ERROR_RATE_THRESHOLD = prev.err;
      else delete process.env.AI_USAGE_ALERT_ERROR_RATE_THRESHOLD;
      if (typeof prev.p95 === 'string') process.env.AI_USAGE_ALERT_P95_LATENCY_MS_THRESHOLD = prev.p95;
      else delete process.env.AI_USAGE_ALERT_P95_LATENCY_MS_THRESHOLD;
      if (typeof prev.cost === 'string') process.env.AI_USAGE_ALERT_COST_USD_PER_DAY_THRESHOLD = prev.cost;
      else delete process.env.AI_USAGE_ALERT_COST_USD_PER_DAY_THRESHOLD;
    }

    const alertsRes = await alertsGET(new Request('http://localhost/api/admin/ai-usage/alerts?limit=20&offset=0'));
    expect(alertsRes.status).toBe(200);
    const alertsJson = await alertsRes.json();
    const alerts = alertsJson?.data?.alerts;
    expect(Array.isArray(alerts)).toBe(true);
    expect(alerts.length).toBeGreaterThan(0);

    const id = String(alerts[0]?.id ?? '');
    expect(id).toBeTruthy();
    const ackRes = await ackPOST(new Request('http://localhost/api/admin/ai-usage/alerts/' + id + '/ack', { method: 'POST' }), {
      params: { id },
    } as any);
    expect(ackRes.status).toBe(200);
  });
});

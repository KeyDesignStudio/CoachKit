import { prisma } from '@/lib/prisma';

import { estimateRollupCost } from './cost-model';

function startOfUtcDay(date: Date): Date {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function nextUtcDay(date: Date): Date {
  const d = startOfUtcDay(date);
  return new Date(d.getTime() + 24 * 60 * 60 * 1000);
}

function percentile(sortedAscending: number[], p: number): number | null {
  const n = sortedAscending.length;
  if (!n) return null;
  const clamped = Math.max(0, Math.min(1, p));
  const idx = Math.ceil(clamped * n) - 1;
  const value = sortedAscending[Math.max(0, Math.min(n - 1, idx))];
  return Number.isFinite(value) ? value : null;
}

type RollupKey = string;

type RollupAccumulator = {
  date: Date;
  provider: string;
  model: string;
  capability: string;
  effectiveMode: string;

  callCount: number;
  fallbackCount: number;
  errorCount: number;
  retryCountTotal: number;

  durationSum: number;
  durations: number[];

  maxOutputTokensSum: number;
};

export async function computeDailyRollups(params: { since: Date; until: Date }): Promise<void> {
  const since = new Date(params.since);
  const until = new Date(params.until);

  if (!(since instanceof Date) || Number.isNaN(since.getTime())) throw new Error('Invalid since');
  if (!(until instanceof Date) || Number.isNaN(until.getTime())) throw new Error('Invalid until');
  if (until <= since) return;

  const audits = await prisma.aiInvocationAudit.findMany({
    where: {
      createdAt: { gte: since, lt: until },
    },
    select: {
      createdAt: true,
      provider: true,
      model: true,
      capability: true,
      effectiveMode: true,
      durationMs: true,
      maxOutputTokens: true,
      retryCount: true,
      fallbackUsed: true,
      errorCode: true,
    },
  });

  const groups = new Map<RollupKey, RollupAccumulator>();

  for (const a of audits) {
    const date = startOfUtcDay(a.createdAt);
    const provider = String(a.provider || 'unknown');
    const model = String(a.model || 'unknown');
    const capability = String(a.capability || 'unknown');
    const effectiveMode = String(a.effectiveMode || 'unknown');

    const key = `${date.toISOString()}|${provider}|${model}|${capability}|${effectiveMode}`;
    const existing = groups.get(key);
    const acc: RollupAccumulator =
      existing ??
      {
        date,
        provider,
        model,
        capability,
        effectiveMode,
        callCount: 0,
        fallbackCount: 0,
        errorCount: 0,
        retryCountTotal: 0,
        durationSum: 0,
        durations: [],
        maxOutputTokensSum: 0,
      };

    acc.callCount += 1;
    if (a.fallbackUsed) acc.fallbackCount += 1;
    if (a.errorCode) acc.errorCount += 1;
    acc.retryCountTotal += Number(a.retryCount || 0);

    const durationMs = Number(a.durationMs || 0);
    acc.durationSum += durationMs;
    acc.durations.push(durationMs);

    acc.maxOutputTokensSum += Number(a.maxOutputTokens || 0);

    if (!existing) groups.set(key, acc);
  }

  if (groups.size === 0) return;

  await prisma.$transaction(
    Array.from(groups.values()).map((g) => {
      const avgDurationMs = g.callCount ? Math.round(g.durationSum / g.callCount) : 0;
      const durationsSorted = g.durations.slice().sort((a, b) => a - b);
      const p95DurationMs = percentile(durationsSorted, 0.95);

      const maxOutputTokensAvg = g.callCount ? Math.round(g.maxOutputTokensSum / g.callCount) : 0;
      const { estimatedOutputTokens, estimatedCostUsd } = estimateRollupCost({
        model: g.model,
        callCount: g.callCount,
        maxOutputTokensAvg,
      });

      return prisma.aiInvocationDailyRollup.upsert({
        where: {
          date_provider_model_capability_effectiveMode: {
            date: g.date,
            provider: g.provider,
            model: g.model,
            capability: g.capability,
            effectiveMode: g.effectiveMode,
          },
        },
        create: {
          date: g.date,
          provider: g.provider,
          model: g.model,
          capability: g.capability,
          effectiveMode: g.effectiveMode,
          callCount: g.callCount,
          fallbackCount: g.fallbackCount,
          errorCount: g.errorCount,
          retryCountTotal: g.retryCountTotal,
          avgDurationMs,
          p95DurationMs,
          maxOutputTokensAvg,
          estimatedOutputTokens,
          estimatedCostUsd,
        },
        update: {
          callCount: g.callCount,
          fallbackCount: g.fallbackCount,
          errorCount: g.errorCount,
          retryCountTotal: g.retryCountTotal,
          avgDurationMs,
          p95DurationMs,
          maxOutputTokensAvg,
          estimatedOutputTokens,
          estimatedCostUsd,
        },
      });
    })
  );
}

export function getUtcDayWindowForLastNDays(days: number, now: Date = new Date()): { since: Date; until: Date } {
  const n = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 30;
  const until = nextUtcDay(now);
  const since = new Date(until.getTime() - n * 24 * 60 * 60 * 1000);
  return { since: startOfUtcDay(since), until: startOfUtcDay(until) };
}

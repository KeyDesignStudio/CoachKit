import { Prisma, UserRole } from '@prisma/client';

import { prisma } from '@/lib/prisma';

export const AI_USAGE_ALERT_CALLS_PER_DAY_THRESHOLD = 'AI_USAGE_ALERT_CALLS_PER_DAY_THRESHOLD' as const;
export const AI_USAGE_ALERT_FALLBACK_RATE_THRESHOLD = 'AI_USAGE_ALERT_FALLBACK_RATE_THRESHOLD' as const;
export const AI_USAGE_ALERT_ERROR_RATE_THRESHOLD = 'AI_USAGE_ALERT_ERROR_RATE_THRESHOLD' as const;
export const AI_USAGE_ALERT_P95_LATENCY_MS_THRESHOLD = 'AI_USAGE_ALERT_P95_LATENCY_MS_THRESHOLD' as const;
export const AI_USAGE_ALERT_COST_USD_PER_DAY_THRESHOLD = 'AI_USAGE_ALERT_COST_USD_PER_DAY_THRESHOLD' as const;

export function getAiUsageAlertThresholds(env: NodeJS.ProcessEnv = process.env): {
  callsPerDay: number;
  fallbackRate: number;
  errorRate: number;
  p95LatencyMs: number;
  costUsdPerDay: number;
} {
  const callsPerDay = Math.max(1, Math.floor(Number(env[AI_USAGE_ALERT_CALLS_PER_DAY_THRESHOLD] ?? '500') || 500));
  const fallbackRate = Math.max(0, Math.min(1, Number(env[AI_USAGE_ALERT_FALLBACK_RATE_THRESHOLD] ?? '0.15') || 0.15));
  const errorRate = Math.max(0, Math.min(1, Number(env[AI_USAGE_ALERT_ERROR_RATE_THRESHOLD] ?? '0.05') || 0.05));
  const p95LatencyMs = Math.max(1, Math.floor(Number(env[AI_USAGE_ALERT_P95_LATENCY_MS_THRESHOLD] ?? '25000') || 25000));
  const costUsdPerDay = Math.max(0, Number(env[AI_USAGE_ALERT_COST_USD_PER_DAY_THRESHOLD] ?? '10') || 10);

  return { callsPerDay, fallbackRate, errorRate, p95LatencyMs, costUsdPerDay };
}

function startOfUtcDay(date: Date): Date {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function nextUtcDay(date: Date): Date {
  const d = startOfUtcDay(date);
  return new Date(d.getTime() + 24 * 60 * 60 * 1000);
}

type DailyMetrics = {
  calls: number;
  fallback: number;
  errors: number;
  retryTotal: number;
  p95LatencyMs: number;
  costUsd: number;
};

function computeRates(m: DailyMetrics): { fallbackRate: number; errorRate: number; avgRetriesPerCall: number } {
  const denom = m.calls || 1;
  return {
    fallbackRate: m.fallback / denom,
    errorRate: m.errors / denom,
    avgRetriesPerCall: m.retryTotal / denom,
  };
}

function makeAlertDedupeKey(params: {
  dateRangeStart: Date;
  dateRangeEnd: Date;
  alertType: string;
  scope: string;
  capability?: string | null;
  provider?: string | null;
  model?: string | null;
}): string {
  return [
    params.dateRangeStart.toISOString(),
    params.dateRangeEnd.toISOString(),
    params.alertType,
    params.scope,
    params.capability ?? '',
    params.provider ?? '',
    params.model ?? '',
  ].join('|');
}

async function createAlertIfMissing(params: {
  dateRangeStart: Date;
  dateRangeEnd: Date;
  severity: 'INFO' | 'WARN' | 'ERROR';
  alertType:
    | 'HIGH_CALL_VOLUME'
    | 'HIGH_FALLBACK_RATE'
    | 'HIGH_ERROR_RATE'
    | 'HIGH_RETRY_RATE'
    | 'HIGH_P95_LATENCY'
    | 'HIGH_COST_ESTIMATE';
  scope: 'GLOBAL' | 'CAPABILITY' | 'COACH';
  capability?: string | null;
  provider?: string | null;
  model?: string | null;
  observedValue: number;
  thresholdValue: number;
  message: string;
}): Promise<void> {
  try {
    await prisma.aiUsageAlert.create({
      data: {
        dateRangeStart: params.dateRangeStart,
        dateRangeEnd: params.dateRangeEnd,
        dedupeKey: makeAlertDedupeKey({
          dateRangeStart: params.dateRangeStart,
          dateRangeEnd: params.dateRangeEnd,
          alertType: params.alertType,
          scope: params.scope,
          capability: params.capability ?? null,
          provider: params.provider ?? null,
          model: params.model ?? null,
        }),
        severity: params.severity as any,
        alertType: params.alertType as any,
        scope: params.scope as any,
        capability: params.capability ?? null,
        provider: params.provider ?? null,
        model: params.model ?? null,
        observedValue: params.observedValue,
        thresholdValue: params.thresholdValue,
        message: params.message,
      },
    });
  } catch (e) {
    // De-dupe by unique constraint.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return;
    throw e;
  }
}

export async function evaluateAlerts(params: { date: Date; env?: NodeJS.ProcessEnv }): Promise<void> {
  const thresholds = getAiUsageAlertThresholds(params.env);

  const dateRangeStart = startOfUtcDay(params.date);
  const dateRangeEnd = nextUtcDay(dateRangeStart);

  const rollups = await prisma.aiInvocationDailyRollup.findMany({
    where: {
      date: dateRangeStart,
    },
    select: {
      capability: true,
      callCount: true,
      fallbackCount: true,
      errorCount: true,
      retryCountTotal: true,
      p95DurationMs: true,
      estimatedCostUsd: true,
    },
  });

  if (!rollups.length) return;

  const global: DailyMetrics = {
    calls: 0,
    fallback: 0,
    errors: 0,
    retryTotal: 0,
    p95LatencyMs: 0,
    costUsd: 0,
  };

  const byCapability = new Map<string, DailyMetrics>();

  for (const r of rollups) {
    global.calls += r.callCount;
    global.fallback += r.fallbackCount;
    global.errors += r.errorCount;
    global.retryTotal += r.retryCountTotal;
    global.costUsd += r.estimatedCostUsd;
    global.p95LatencyMs = Math.max(global.p95LatencyMs, r.p95DurationMs ?? 0);

    const cap = r.capability;
    const m =
      byCapability.get(cap) ??
      ({ calls: 0, fallback: 0, errors: 0, retryTotal: 0, p95LatencyMs: 0, costUsd: 0 } satisfies DailyMetrics);

    m.calls += r.callCount;
    m.fallback += r.fallbackCount;
    m.errors += r.errorCount;
    m.retryTotal += r.retryCountTotal;
    m.costUsd += r.estimatedCostUsd;
    m.p95LatencyMs = Math.max(m.p95LatencyMs, r.p95DurationMs ?? 0);

    byCapability.set(cap, m);
  }

  const globalRates = computeRates(global);

  if (global.calls > thresholds.callsPerDay) {
    await createAlertIfMissing({
      dateRangeStart,
      dateRangeEnd,
      severity: 'WARN',
      alertType: 'HIGH_CALL_VOLUME',
      scope: 'GLOBAL',
      observedValue: global.calls,
      thresholdValue: thresholds.callsPerDay,
      message: `High call volume: ${global.calls} calls/day (threshold ${thresholds.callsPerDay}).`,
    });
  }

  if (globalRates.fallbackRate > thresholds.fallbackRate) {
    await createAlertIfMissing({
      dateRangeStart,
      dateRangeEnd,
      severity: 'WARN',
      alertType: 'HIGH_FALLBACK_RATE',
      scope: 'GLOBAL',
      observedValue: globalRates.fallbackRate,
      thresholdValue: thresholds.fallbackRate,
      message: `High fallback rate: ${(globalRates.fallbackRate * 100).toFixed(1)}% (threshold ${(thresholds.fallbackRate * 100).toFixed(1)}%).`,
    });
  }

  if (globalRates.errorRate > thresholds.errorRate) {
    await createAlertIfMissing({
      dateRangeStart,
      dateRangeEnd,
      severity: 'ERROR',
      alertType: 'HIGH_ERROR_RATE',
      scope: 'GLOBAL',
      observedValue: globalRates.errorRate,
      thresholdValue: thresholds.errorRate,
      message: `High error rate: ${(globalRates.errorRate * 100).toFixed(1)}% (threshold ${(thresholds.errorRate * 100).toFixed(1)}%).`,
    });
  }

  if (global.p95LatencyMs > thresholds.p95LatencyMs) {
    await createAlertIfMissing({
      dateRangeStart,
      dateRangeEnd,
      severity: 'WARN',
      alertType: 'HIGH_P95_LATENCY',
      scope: 'GLOBAL',
      observedValue: global.p95LatencyMs,
      thresholdValue: thresholds.p95LatencyMs,
      message: `High p95 latency: ${global.p95LatencyMs}ms (threshold ${thresholds.p95LatencyMs}ms).`,
    });
  }

  if (global.costUsd > thresholds.costUsdPerDay) {
    await createAlertIfMissing({
      dateRangeStart,
      dateRangeEnd,
      severity: 'WARN',
      alertType: 'HIGH_COST_ESTIMATE',
      scope: 'GLOBAL',
      observedValue: global.costUsd,
      thresholdValue: thresholds.costUsdPerDay,
      message: `High estimated cost: $${global.costUsd.toFixed(2)}/day (threshold $${thresholds.costUsdPerDay.toFixed(2)}).`,
    });
  }

  // Capability-scoped alerts (v1).
  for (const [capability, m] of byCapability) {
    const rates = computeRates(m);

    if (m.calls > thresholds.callsPerDay) {
      await createAlertIfMissing({
        dateRangeStart,
        dateRangeEnd,
        severity: 'WARN',
        alertType: 'HIGH_CALL_VOLUME',
        scope: 'CAPABILITY',
        capability,
        observedValue: m.calls,
        thresholdValue: thresholds.callsPerDay,
        message: `[${capability}] High call volume: ${m.calls} calls/day (threshold ${thresholds.callsPerDay}).`,
      });
    }

    if (rates.fallbackRate > thresholds.fallbackRate) {
      await createAlertIfMissing({
        dateRangeStart,
        dateRangeEnd,
        severity: 'WARN',
        alertType: 'HIGH_FALLBACK_RATE',
        scope: 'CAPABILITY',
        capability,
        observedValue: rates.fallbackRate,
        thresholdValue: thresholds.fallbackRate,
        message: `[${capability}] High fallback rate: ${(rates.fallbackRate * 100).toFixed(1)}% (threshold ${(thresholds.fallbackRate * 100).toFixed(1)}%).`,
      });
    }

    if (rates.errorRate > thresholds.errorRate) {
      await createAlertIfMissing({
        dateRangeStart,
        dateRangeEnd,
        severity: 'ERROR',
        alertType: 'HIGH_ERROR_RATE',
        scope: 'CAPABILITY',
        capability,
        observedValue: rates.errorRate,
        thresholdValue: thresholds.errorRate,
        message: `[${capability}] High error rate: ${(rates.errorRate * 100).toFixed(1)}% (threshold ${(thresholds.errorRate * 100).toFixed(1)}%).`,
      });
    }

    if (m.p95LatencyMs > thresholds.p95LatencyMs) {
      await createAlertIfMissing({
        dateRangeStart,
        dateRangeEnd,
        severity: 'WARN',
        alertType: 'HIGH_P95_LATENCY',
        scope: 'CAPABILITY',
        capability,
        observedValue: m.p95LatencyMs,
        thresholdValue: thresholds.p95LatencyMs,
        message: `[${capability}] High p95 latency: ${m.p95LatencyMs}ms (threshold ${thresholds.p95LatencyMs}ms).`,
      });
    }

    if (m.costUsd > thresholds.costUsdPerDay) {
      await createAlertIfMissing({
        dateRangeStart,
        dateRangeEnd,
        severity: 'WARN',
        alertType: 'HIGH_COST_ESTIMATE',
        scope: 'CAPABILITY',
        capability,
        observedValue: m.costUsd,
        thresholdValue: thresholds.costUsdPerDay,
        message: `[${capability}] High estimated cost: $${m.costUsd.toFixed(2)}/day (threshold $${thresholds.costUsdPerDay.toFixed(2)}).`,
      });
    }
  }
}

export async function acknowledgeAlert(params: {
  id: string;
  requester: { id: string; role: UserRole; email: string };
}): Promise<void> {
  await prisma.aiUsageAlert.update({
    where: { id: params.id },
    data: {
      acknowledgedAt: new Date(),
      acknowledgedBy: params.requester.email,
    },
  });
}

export function getUtcDayStart(date: Date): Date {
  return startOfUtcDay(date);
}

export function getUtcDayEndExclusive(date: Date): Date {
  return nextUtcDay(date);
}

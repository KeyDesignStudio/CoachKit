import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import type { UrlObject } from 'url';

import { prisma } from '@/lib/prisma';

import { requireAiPlanBuilderAuditAdminUser, requireAiPlanBuilderAuditAdminUserPage } from '@/modules/ai-plan-builder/server/audit-admin';
import { computeDailyRollups, getUtcDayWindowForLastNDays } from '@/modules/ai-plan-builder/admin/rollups';
import { evaluateAlerts, getAiUsageAlertThresholds } from '@/modules/ai-plan-builder/admin/alerts';
import { evaluateQualityGateReadiness, evaluateUatReadiness, type ReadinessStatus } from '@/modules/ai-plan-builder/admin/readiness';

export const dynamic = 'force-dynamic';

function formatPct(x: number): string {
  if (!Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(1)}%`;
}

function formatUsd(x: number): string {
  if (!Number.isFinite(x)) return '—';
  return `$${x.toFixed(2)}`;
}

function clampDays(v: unknown): 7 | 30 | 90 {
  const n = Number(v);
  if (n === 7 || n === 30 || n === 90) return n;
  return 30;
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function statusChipClass(status: ReadinessStatus): string {
  if (status === 'PASS') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'WARN') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (status === 'FAIL') return 'bg-rose-50 text-rose-700 border-rose-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

export default async function AdminAiUsagePage(props: { searchParams?: Record<string, string | string[] | undefined> }) {
  const requester = await requireAiPlanBuilderAuditAdminUserPage();

  const sp = props.searchParams ?? {};
  const get = (key: string) => {
    const v = sp[key];
    return Array.isArray(v) ? v[0] : v;
  };

  const days = clampDays(get('days'));
  const alertsLimit = clampInt(get('alertsLimit'), 20, 1, 200);
  const alertsOffset = clampInt(get('alertsOffset'), 0, 0, 1_000_000);

  const { since, until } = getUtcDayWindowForLastNDays(days);

  const rollups = await prisma.aiInvocationDailyRollup.findMany({
    where: { date: { gte: since, lt: until } },
    orderBy: [{ date: 'desc' }, { capability: 'asc' }],
  });

  const alerts = await prisma.aiUsageAlert.findMany({
    orderBy: { createdAt: 'desc' },
    skip: alertsOffset,
    take: alertsLimit,
  });

  const alertsHasPrev = alertsOffset > 0;
  const alertsHasNext = alerts.length === alertsLimit;

  // Aggregate metrics.
  const totals = {
    calls: 0,
    fallback: 0,
    errors: 0,
    costUsd: 0,
    p95LatencyMs: 0,
  };

  const byCapability = new Map<
    string,
    { calls: number; fallback: number; errors: number; costUsd: number; p95LatencyMs: number }
  >();

  for (const r of rollups) {
    totals.calls += r.callCount;
    totals.fallback += r.fallbackCount;
    totals.errors += r.errorCount;
    totals.costUsd += r.estimatedCostUsd;
    totals.p95LatencyMs = Math.max(totals.p95LatencyMs, r.p95DurationMs ?? 0);

    const cap = r.capability;
    const m = byCapability.get(cap) ?? { calls: 0, fallback: 0, errors: 0, costUsd: 0, p95LatencyMs: 0 };
    m.calls += r.callCount;
    m.fallback += r.fallbackCount;
    m.errors += r.errorCount;
    m.costUsd += r.estimatedCostUsd;
    m.p95LatencyMs = Math.max(m.p95LatencyMs, r.p95DurationMs ?? 0);
    byCapability.set(cap, m);
  }

  const fallbackRate = totals.calls ? totals.fallback / totals.calls : 0;
  const errorRate = totals.calls ? totals.errors / totals.calls : 0;
  const unackedAlerts = alerts.filter((a) => !a.acknowledgedAt).length;
  const thresholds = getAiUsageAlertThresholds();

  const daysCount = days;
  const costAvgPerDay = daysCount ? totals.costUsd / daysCount : totals.costUsd;

  const qualityReadiness = evaluateQualityGateReadiness();
  const uatReadiness = await evaluateUatReadiness();
  const runtimeReadiness: { status: ReadinessStatus; reason: string } =
    errorRate > thresholds.errorRate || fallbackRate > thresholds.fallbackRate || unackedAlerts > 0
      ? {
          status: errorRate > thresholds.errorRate ? 'FAIL' : 'WARN',
          reason:
            errorRate > thresholds.errorRate
              ? `Error rate ${(errorRate * 100).toFixed(1)}% exceeds threshold ${(thresholds.errorRate * 100).toFixed(1)}%.`
              : unackedAlerts > 0
                ? `${unackedAlerts} unacknowledged usage alert(s).`
                : `Fallback rate ${(fallbackRate * 100).toFixed(1)}% is elevated.`,
        }
      : {
          status: totals.calls > 0 ? 'PASS' : 'UNKNOWN',
          reason: totals.calls > 0 ? 'Runtime metrics are within configured thresholds.' : 'No runtime data yet in selected window.',
        };

  const capabilities = Array.from(byCapability.entries())
    .map(([capability, m]) => ({
      capability,
      ...m,
      fallbackRate: m.calls ? m.fallback / m.calls : 0,
      errorRate: m.calls ? m.errors / m.calls : 0,
    }))
    .sort((a, b) => b.calls - a.calls);

  const makeSelfHref = (patch: Record<string, string>): UrlObject => {
    const query: Record<string, string> = {
      days: String(days),
      alertsLimit: String(alertsLimit),
      alertsOffset: String(alertsOffset),
      ...patch,
    };

    return { pathname: '/admin/ai-usage', query };
  };

  async function runRollupAction(formData: FormData) {
    'use server';
    await requireAiPlanBuilderAuditAdminUser();
    const days = clampDays(formData.get('days'));
    const { since, until } = getUtcDayWindowForLastNDays(days);
    await computeDailyRollups({ since, until });
    revalidatePath('/admin/ai-usage');
  }

  async function evalAlertsAction(formData: FormData) {
    'use server';
    await requireAiPlanBuilderAuditAdminUser();
    const days = clampDays(formData.get('days') ?? 7);
    const todayUtc = new Date();
    const todayStart = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate(), 0, 0, 0, 0));

    for (let i = 0; i < days; i++) {
      await evaluateAlerts({ date: new Date(todayStart.getTime() - i * 24 * 60 * 60 * 1000) });
    }

    revalidatePath('/admin/ai-usage');
  }

  async function ackAlertAction(formData: FormData) {
    'use server';
    const requester = await requireAiPlanBuilderAuditAdminUser();
    const id = String(formData.get('id') ?? '');
    if (!id) return;

    await prisma.aiUsageAlert.update({
      where: { id },
      data: { acknowledgedAt: new Date(), acknowledgedBy: requester.email },
    });

    revalidatePath('/admin/ai-usage');
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">AI Usage (estimates)</h1>
        <div className="text-sm text-muted-foreground">Admin: {requester.email}</div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <form method="get" className="flex items-center gap-2">
          <label className="text-sm">
            Range
            <select name="days" defaultValue={String(days)} className="ml-2 rounded border px-2 py-1 text-sm">
              <option value="7">Last 7d</option>
              <option value="30">Last 30d</option>
              <option value="90">Last 90d</option>
            </select>
          </label>
          <input type="hidden" name="alertsLimit" value={String(alertsLimit)} />
          <input type="hidden" name="alertsOffset" value={String(alertsOffset)} />
          <button type="submit" className="rounded bg-black px-3 py-2 text-sm text-white">
            Apply
          </button>
          <Link href={{ pathname: '/admin/ai-usage' }} className="rounded border px-3 py-2 text-sm">
            Reset
          </Link>
        </form>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <form action={runRollupAction} className="flex items-center gap-2">
            <input type="hidden" name="days" value={String(days)} />
            <button type="submit" className="rounded border px-3 py-2 text-sm">
              Run rollup
            </button>
          </form>

          <form action={evalAlertsAction} className="flex items-center gap-2">
            <input type="hidden" name="days" value="7" />
            <button type="submit" className="rounded border px-3 py-2 text-sm">
              Evaluate alerts (7d)
            </button>
          </form>

          <Link href={{ pathname: '/admin/ai-audits' }} className="text-sm underline">
            View raw audits
          </Link>
        </div>
      </div>

      <div className="mb-6 rounded border">
        <div className="border-b px-4 py-3 text-sm font-medium">Commercial Readiness Snapshot</div>
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
          <div className="rounded border p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Quality gates</div>
              <span className={`rounded border px-2 py-0.5 text-xs font-medium ${statusChipClass(qualityReadiness.status)}`}>
                {qualityReadiness.status}
              </span>
            </div>
            <div className="text-sm">{qualityReadiness.scenarioCount} scenarios evaluated.</div>
            {qualityReadiness.failingScenarios.length ? (
              <div className="mt-1 text-xs text-rose-700">Failing: {qualityReadiness.failingScenarios.join(', ')}</div>
            ) : (
              <div className="mt-1 text-xs text-muted-foreground">All policy-ratcheted scenario gates passing.</div>
            )}
          </div>

          <div className="rounded border p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">UAT evidence</div>
              <span className={`rounded border px-2 py-0.5 text-xs font-medium ${statusChipClass(uatReadiness.status)}`}>
                {uatReadiness.status}
              </span>
            </div>
            <div className="text-sm">{uatReadiness.recordCount} UAT rows captured.</div>
            {uatReadiness.missingCases.length ? (
              <div className="mt-1 text-xs text-rose-700">Missing: {uatReadiness.missingCases.join(', ')}</div>
            ) : (
              <div className="mt-1 text-xs text-muted-foreground">Required cases C1-C10 and A1-A4 are present.</div>
            )}
          </div>

          <div className="rounded border p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Runtime health</div>
              <span className={`rounded border px-2 py-0.5 text-xs font-medium ${statusChipClass(runtimeReadiness.status)}`}>
                {runtimeReadiness.status}
              </span>
            </div>
            <div className="text-sm">
              Error {formatPct(errorRate)} · Fallback {formatPct(fallbackRate)} · Unacked alerts {unackedAlerts}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{runtimeReadiness.reason}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded border p-4">
          <div className="text-xs text-muted-foreground">Total calls</div>
          <div className="text-2xl font-semibold">{totals.calls}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-muted-foreground">Fallback rate</div>
          <div className="text-2xl font-semibold">{formatPct(fallbackRate)}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-muted-foreground">Error rate</div>
          <div className="text-2xl font-semibold">{formatPct(errorRate)}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-muted-foreground">Estimated cost</div>
          <div className="text-2xl font-semibold">{formatUsd(totals.costUsd)}</div>
          <div className="mt-1 text-xs text-muted-foreground">Avg/day: {formatUsd(costAvgPerDay)}</div>
        </div>
      </div>

      <div className="mt-6 rounded border">
        <div className="border-b px-4 py-3 text-sm font-medium">By capability</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="p-2">capability</th>
                <th className="p-2">calls</th>
                <th className="p-2">fallback</th>
                <th className="p-2">errors</th>
                <th className="p-2">p95 latency</th>
                <th className="p-2">est. cost</th>
              </tr>
            </thead>
            <tbody>
              {capabilities.map((c) => (
                <tr key={c.capability} className="border-t">
                  <td className="p-2">{c.capability}</td>
                  <td className="p-2">{c.calls}</td>
                  <td className="p-2">{formatPct(c.fallbackRate)}</td>
                  <td className="p-2">{formatPct(c.errorRate)}</td>
                  <td className="p-2">{c.p95LatencyMs ? `${c.p95LatencyMs}ms` : '—'}</td>
                  <td className="p-2">{formatUsd(c.costUsd)}</td>
                </tr>
              ))}
              {!capabilities.length ? (
                <tr>
                  <td className="p-4 text-muted-foreground" colSpan={6}>
                    No rollups found. Run rollup to populate data.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 rounded border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-medium">Alerts (last {alertsLimit})</div>
          <div className="flex gap-2 text-sm">
            {alertsHasPrev ? (
              <Link
                className="rounded border px-3 py-1"
                href={makeSelfHref({ alertsOffset: String(Math.max(0, alertsOffset - alertsLimit)) })}
              >
                Prev
              </Link>
            ) : (
              <span className="rounded border px-3 py-1 text-muted-foreground">Prev</span>
            )}
            {alertsHasNext ? (
              <Link
                className="rounded border px-3 py-1"
                href={makeSelfHref({ alertsOffset: String(alertsOffset + alertsLimit) })}
              >
                Next
              </Link>
            ) : (
              <span className="rounded border px-3 py-1 text-muted-foreground">Next</span>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="p-2">createdAt</th>
                <th className="p-2">severity</th>
                <th className="p-2">type</th>
                <th className="p-2">scope</th>
                <th className="p-2">message</th>
                <th className="p-2">ack</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="p-2 whitespace-nowrap">{new Date(a.createdAt).toISOString()}</td>
                  <td className="p-2">{a.severity}</td>
                  <td className="p-2">{a.alertType}</td>
                  <td className="p-2">{a.scope}{a.capability ? `:${a.capability}` : ''}</td>
                  <td className="p-2">{a.message}</td>
                  <td className="p-2">
                    {a.acknowledgedAt ? (
                      <span className="text-muted-foreground">acked</span>
                    ) : (
                      <form action={ackAlertAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <button type="submit" className="rounded border px-2 py-1 text-xs">
                          Acknowledge
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {!alerts.length ? (
                <tr>
                  <td className="p-4 text-muted-foreground" colSpan={6}>
                    No alerts.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 text-xs text-muted-foreground">
        Costs are estimates based on stored output-token caps (not billing-grade).
      </div>
    </div>
  );
}

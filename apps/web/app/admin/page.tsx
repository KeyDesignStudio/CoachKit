import Link from 'next/link';

import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAiPlanBuilderV1EnabledServer } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';

type AdminTile = {
  title: string;
  description: string;
  href: string;
  tag: string;
  disabled?: boolean;
  hint?: string;
};

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

export default async function AdminHomePage() {
  const requester = await requireAdmin();
  const apbEnabled = isAiPlanBuilderV1EnabledServer();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [planSourceCount, stravaLastRun, adminAudit24h, apbMetrics] = await Promise.all([
    prisma.planSource.count({ where: { isActive: true } }).catch(() => 0),
    prisma.cronRun
      .findFirst({
        where: { kind: 'STRAVA_SYNC' },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true, status: true },
      })
      .catch(() => null),
    prisma.adminAuditEvent.count({ where: { createdAt: { gte: since24h } } }).catch(() => 0),
    apbEnabled
      ? Promise.all([
          prisma.aiInvocationAudit.count({ where: { createdAt: { gte: since24h } } }).catch(() => 0),
          prisma.aiInvocationAudit.count({ where: { createdAt: { gte: since24h }, fallbackUsed: true } }).catch(() => 0),
          prisma.aiInvocationAudit
            .count({ where: { createdAt: { gte: since24h }, NOT: { errorCode: null } } })
            .catch(() => 0),
        ])
      : Promise.resolve([0, 0, 0] as const),
  ]);

  const [apbCalls24h, apbFallback24h, apbErrors24h] = apbMetrics;
  const apbFallbackRate = apbCalls24h > 0 ? apbFallback24h / apbCalls24h : 0;
  const apbErrorRate = apbCalls24h > 0 ? apbErrors24h / apbCalls24h : 0;

  const aiTiles: AdminTile[] = [
    {
      title: 'Engine Controls',
      description: 'Control model, fallback, rate-limit, and capability routing behavior.',
      href: '/admin/ai-plan-builder/engine-controls',
      tag: 'APB',
      disabled: !apbEnabled,
      hint: apbEnabled ? undefined : 'Enable AI_PLAN_BUILDER_V1 to access.',
    },
    {
      title: 'Usage & Readiness',
      description: 'Readiness snapshot, rollups, costs, and alert checks.',
      href: '/admin/ai-usage',
      tag: 'APB',
      disabled: !apbEnabled,
      hint: apbEnabled ? undefined : 'Enable AI_PLAN_BUILDER_V1 to access.',
    },
    {
      title: 'Audit Trail',
      description: 'Per-invocation traces for model, fallback, retries, and errors.',
      href: '/admin/ai-audits',
      tag: 'APB',
      disabled: !apbEnabled,
      hint: apbEnabled ? undefined : 'Enable AI_PLAN_BUILDER_V1 to access.',
    },
    {
      title: 'Policy Controls',
      description: 'Tune planning safety, load policy, and generation guardrails.',
      href: '/admin/ai-plan-builder/policy-tuning',
      tag: 'APB',
      disabled: !apbEnabled,
      hint: apbEnabled ? undefined : 'Enable AI_PLAN_BUILDER_V1 to access.',
    },
  ];

  const opsTiles: AdminTile[] = [
    {
      title: 'Knowledge Base',
      description: 'Manage structured training templates, imports, and publish state.',
      href: '/admin/plan-library',
      tag: 'Knowledge',
    },
    {
      title: 'Source Trust',
      description: 'Govern which external authorities CoachKit can cite or use during planning support.',
      href: '/admin/knowledge-sources',
      tag: 'Knowledge',
    },
    {
      title: 'Strava Sync Monitor',
      description: 'Inspect cron health and athlete import behavior.',
      href: '/admin/strava-sync',
      tag: 'Ops',
    },
    {
      title: 'Data Audit Log',
      description: 'Track create/update/delete events and actor history.',
      href: '/admin/audit',
      tag: 'Ops',
    },
  ];

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">AI Control Plane</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Govern CoachKit AI behavior, knowledge quality, source trust, and operational health from one control surface.
          </p>
        </div>
        <div className="text-sm text-muted-foreground">Admin: {requester.user.email}</div>
      </div>

      <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">APB invocations (24h)</div>
          <div className="mt-2 text-2xl font-semibold">{apbCalls24h}</div>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">APB fallback rate (24h)</div>
          <div className="mt-2 text-2xl font-semibold">{formatPct(apbFallbackRate)}</div>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">APB error rate (24h)</div>
          <div className="mt-2 text-2xl font-semibold">{formatPct(apbErrorRate)}</div>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Ops pulse</div>
          <div className="mt-2 text-sm">
            <div>Plan sources: {planSourceCount}</div>
            <div>Data audit events (24h): {adminAudit24h}</div>
            <div>
              Strava cron:{' '}
              {stravaLastRun ? `${stravaLastRun.status} @ ${stravaLastRun.startedAt.toISOString().replace('T', ' ').slice(0, 19)}` : 'no runs yet'}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Engine And Governance</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {aiTiles.map((tile) => (
            <div key={tile.title} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-base font-semibold">{tile.title}</div>
                <span className="rounded border px-2 py-0.5 text-xs text-muted-foreground">{tile.tag}</span>
              </div>
              <p className="text-sm text-muted-foreground">{tile.description}</p>
              <div className="mt-3">
                {tile.disabled ? (
                  <div className="text-xs text-amber-700">{tile.hint ?? 'Unavailable.'}</div>
                ) : (
                  <Link href={tile.href as any} className="text-sm underline">
                    Open
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Knowledge And Operations</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {opsTiles.map((tile) => (
            <div key={tile.title} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-base font-semibold">{tile.title}</div>
                <span className="rounded border px-2 py-0.5 text-xs text-muted-foreground">{tile.tag}</span>
              </div>
              <p className="text-sm text-muted-foreground">{tile.description}</p>
              <div className="mt-3">
                <Link href={tile.href as any} className="text-sm underline">
                  Open
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';

type AnalyticsPayload = {
  totals: {
    totalTemplates: number;
    publishedTemplates: number;
    draftTemplates: number;
    unresolvedSessions: number;
    averageQualityScore: number;
    averageOutcomeScore: number;
    validationPassRate: number;
  };
  imports: {
    last30d: number;
    failedLast30d: number;
    bySourceType: {
      csv: number;
      xlsx: number;
      pdfAssist: number;
    };
  };
  qualityKpis: {
    current30d: {
      editRate: number;
      rejectionRate: number;
      goodFitRate: number;
    };
    previous30d: {
      editRate: number;
      rejectionRate: number;
      goodFitRate: number;
    };
    trend: {
      editRateDelta: number;
      rejectionRateDelta: number;
      goodFitRateDelta: number;
    };
  };
  trustedSources: {
    total: number;
    active: number;
    planningEnabled: number;
    qaEnabled: number;
  };
  topTemplates: Array<{
    id: string;
    title: string;
    isPublished: boolean;
    qualityScore: number | null;
    unresolvedSessions: number;
    retrievalWeight: number;
  }>;
};

type PlanLibraryQualityInsightsProps = {
  refreshToken?: number;
};

function pct(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

export function PlanLibraryQualityInsights({ refreshToken = 0 }: PlanLibraryQualityInsightsProps) {
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError('');
      try {
        const response = await fetch('/api/admin/plan-library/templates/analytics', { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error?.message || 'Failed to load quality analytics.');
        if (!cancelled) setAnalytics(payload?.data?.analytics as AnalyticsPayload);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load quality analytics.');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  return (
    <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Quality Analytics</div>
      <h2 className="mt-1 text-lg font-semibold">Template quality and feedback loop</h2>
      {error ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {!analytics ? <div className="mt-2 text-sm text-[var(--muted)]">Loading analytics…</div> : null}
      {analytics ? (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Metric label="Templates" value={String(analytics.totals.totalTemplates)} />
            <Metric label="Published" value={String(analytics.totals.publishedTemplates)} />
            <Metric label="Draft" value={String(analytics.totals.draftTemplates)} />
            <Metric label="Unresolved Sessions" value={String(analytics.totals.unresolvedSessions)} />
            <Metric label="Avg Quality" value={pct(analytics.totals.averageQualityScore)} />
            <Metric label="Validation Pass" value={pct(analytics.totals.validationPassRate)} />
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Metric label="Edit rate (30d)" value={pct(analytics.qualityKpis.current30d.editRate)} delta={analytics.qualityKpis.trend.editRateDelta} invert />
            <Metric
              label="Rejection rate (30d)"
              value={pct(analytics.qualityKpis.current30d.rejectionRate)}
              delta={analytics.qualityKpis.trend.rejectionRateDelta}
              invert
            />
            <Metric label="Good-fit rate (30d)" value={pct(analytics.qualityKpis.current30d.goodFitRate)} delta={analytics.qualityKpis.trend.goodFitRateDelta} />
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <Metric label="Avg Outcome" value={pct(analytics.totals.averageOutcomeScore)} />
            <Metric label="Trusted Sources" value={String(analytics.trustedSources.active)} />
            <Metric label="Q&A Sources" value={String(analytics.trustedSources.qaEnabled)} />
            <Metric label="Planning Sources" value={String(analytics.trustedSources.planningEnabled)} />
          </div>

          <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
            <div className="text-xs font-semibold text-[var(--muted)]">Top weighted templates for APB retrieval</div>
            {analytics.topTemplates.length === 0 ? <div className="mt-1 text-xs text-[var(--muted)]">No published templates ranked yet.</div> : null}
            <div className="mt-2 space-y-2">
              {analytics.topTemplates.slice(0, 5).map((template) => (
                <div key={template.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs">
                  <div className="truncate">
                    <span className="font-medium">{template.title}</span>
                    <span className="ml-2 text-[var(--muted)]">
                      {template.isPublished ? 'Published' : 'Draft'} · quality {pct(template.qualityScore)} · unresolved {template.unresolvedSessions}
                    </span>
                  </div>
                  <span className="font-semibold">weight {template.retrievalWeight.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Metric(params: { label: string; value: string; delta?: number; invert?: boolean }) {
  const hasDelta = Number.isFinite(params.delta ?? Number.NaN);
  const deltaValue = Number(params.delta ?? 0);
  const positive = params.invert ? deltaValue <= 0 : deltaValue >= 0;
  const deltaText = `${deltaValue >= 0 ? '+' : ''}${(deltaValue * 100).toFixed(1)}pp`;
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{params.label}</div>
      <div className="mt-1 text-xl font-semibold">{params.value}</div>
      {hasDelta ? <div className={`mt-1 text-xs ${positive ? 'text-emerald-700' : 'text-rose-700'}`}>{deltaText} vs prev 30d</div> : null}
    </div>
  );
}

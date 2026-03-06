'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Icon } from '@/components/ui/Icon';

type WorkflowSourceSummary = {
  id: string;
  title: string;
  isActive: boolean;
  storedDocumentUrl: string | null;
  layoutFamily: { id: string; slug: string; name: string; hasCompiledRules?: boolean } | null;
  latestExtractionRun: {
    reviewStatus: 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';
    warningCount: number;
  } | null;
};

type PlanLibraryWorkflowPanelProps = {
  refreshNonce: number;
};

function StatCard({ label, value, tone }: { label: string; value: string; tone?: 'default' | 'warn' | 'good' }) {
  const toneClass =
    tone === 'good'
      ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-900 border-amber-200'
        : 'bg-[var(--bg-surface)] text-[var(--text)] border-[var(--border-subtle)]';

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

export function PlanLibraryWorkflowPanel({ refreshNonce }: PlanLibraryWorkflowPanelProps) {
  const [sources, setSources] = useState<WorkflowSourceSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSources = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/plan-library/sources', { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Failed to load plan library workflow.');
      }
      setSources((payload?.data?.sources ?? []) as WorkflowSourceSummary[]);
    } catch {
      setSources([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSources();
  }, [loadSources, refreshNonce]);

  const stats = useMemo(() => {
    const active = sources.filter((source) => source.isActive).length;
    const approved = sources.filter((source) => source.latestExtractionRun?.reviewStatus === 'APPROVED').length;
    const reviewQueue = sources.filter((source) => source.latestExtractionRun?.reviewStatus !== 'APPROVED').length;
    const templateQueue = sources.filter(
      (source) => source.storedDocumentUrl && source.layoutFamily && !source.layoutFamily.hasCompiledRules
    ).length;
    const nextReviewSource =
      sources.find((source) => source.latestExtractionRun?.reviewStatus === 'NEEDS_REVIEW') ??
      sources.find((source) => source.latestExtractionRun == null) ??
      sources.find((source) => source.latestExtractionRun?.reviewStatus === 'REJECTED') ??
      null;

    return {
      active,
      approved,
      reviewQueue,
      templateQueue,
      nextReviewSource,
    };
  }, [sources]);

  return (
    <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Plan Library Workflow</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Work each source in order: upload, route the layout, annotate and rerun, fix sessions, then approve it for APB.
          </p>
        </div>
        {stats.nextReviewSource ? (
          <Link
            href={`/admin/plan-library/parser-studio?sourceId=${stats.nextReviewSource.id}` as any}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[var(--text)] px-4 py-2 text-sm font-medium text-[var(--bg-page)]"
          >
            <Icon name="next" size="sm" aria-hidden />
            <span>Open next source</span>
          </Link>
        ) : null}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <StatCard label="Active Sources" value={loading ? '…' : String(stats.active)} />
        <StatCard label="Needs Review" value={loading ? '…' : String(stats.reviewQueue)} tone={stats.reviewQueue ? 'warn' : 'default'} />
        <StatCard label="Needs Template" value={loading ? '…' : String(stats.templateQueue)} tone={stats.templateQueue ? 'warn' : 'default'} />
        <StatCard label="Approved" value={loading ? '…' : String(stats.approved)} tone={stats.approved ? 'good' : 'default'} />
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">1. Ingest</div>
          <p className="mt-2 text-sm text-[var(--text)]">Upload the PDF and enter the metadata CoachKit needs for correct matching.</p>
        </div>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">2. Route + Annotate</div>
          <p className="mt-2 text-sm text-[var(--text)]">Set the layout family, mark week headers/day rows, and compile the template on rerun.</p>
        </div>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">3. Fix Sessions</div>
          <p className="mt-2 text-sm text-[var(--text)]">Correct bad week/day/session fields directly on the latest extracted structure.</p>
        </div>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">4. Approve</div>
          <p className="mt-2 text-sm text-[var(--text)]">Approve only sources you trust. Approved sources are weighted up in APB.</p>
        </div>
      </div>
    </section>
  );
}

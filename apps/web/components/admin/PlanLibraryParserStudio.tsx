'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { PlanSourcePdfAnnotator } from '@/components/admin/PlanSourcePdfAnnotator';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

type LayoutFamilySummary = {
  id: string;
  slug: string;
  name: string;
  familyType: string;
  description?: string | null;
};

type ParserStudioSourceSummary = {
  id: string;
  title: string;
  type: 'PDF' | 'URL' | 'TEXT';
  sport: string;
  distance: string;
  level: string;
  durationWeeks: number;
  season: string | null;
  author: string | null;
  publisher: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  storedDocumentUrl: string | null;
  layoutFamily: { id: string; slug: string; name: string; familyType: string; hasCompiledRules?: boolean } | null;
  recommendedLayoutFamily:
    | {
        id: string;
        slug: string;
        name: string;
        confidence: number;
        reasons: string[];
      }
    | null;
  latestVersion: {
    id: string;
    version: number;
    extractionMetaJson: {
      confidence?: number | null;
      warnings?: string[] | null;
    } | null;
    createdAt: string;
  } | null;
  latestRun: {
    id: string;
    reviewStatus: 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';
    confidence: number | null;
    warningCount: number;
    sessionCount: number;
    weekCount: number;
    createdAt: string;
    summaryJson?: {
      recommendedAction?: string;
    } | null;
    layoutFamily: { id: string; slug: string; name: string } | null;
    latestReview: {
      id: string;
      status: 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';
      notes: string | null;
      reviewerEmail: string;
      createdAt: string;
    } | null;
  } | null;
};

type ParserStudioDetail = {
  layoutFamilies: LayoutFamilySummary[];
  planSource: {
    id: string;
    title: string;
    type: 'PDF' | 'URL' | 'TEXT';
    sport: string;
    distance: string;
    level: string;
    durationWeeks: number;
    season: string | null;
    author: string | null;
    publisher: string | null;
    sourceUrl: string | null;
    sourceFilePath: string | null;
    storedDocumentUrl: string | null;
    rawText: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    layoutFamily: {
      id: string;
      slug: string;
      name: string;
      description?: string | null;
      hasCompiledRules?: boolean;
      compiledTemplateVersion?: string | null;
      templateSourcePlanId?: string | null;
    } | null;
    recommendedLayoutFamily:
      | {
          id: string;
          slug: string;
          name: string;
          description?: string | null;
          confidence: number;
          reasons: string[];
        }
      | null;
    latestVersion: {
      id: string;
      version: number;
      createdAt: string;
      extractionMetaJson: {
        confidence?: number | null;
        rawConfidence?: number | null;
        warnings?: string[] | null;
        sessionCount?: number | null;
        weekCount?: number | null;
        recommendedAction?: string | null;
      } | null;
      weeks: Array<{
        id: string;
        weekIndex: number;
        phase: string | null;
        totalMinutes: number | null;
        totalSessions: number | null;
        notes: string | null;
        sessions: Array<{
          id: string;
          ordinal: number;
          dayOfWeek: number | null;
          discipline: string;
          sessionType: string;
          title: string | null;
          durationMinutes: number | null;
          distanceKm: number | null;
          intensityType: string | null;
          parserConfidence: number | null;
          parserWarningsJson: string[] | null;
          recipeV2Json: unknown | null;
          structureJson: unknown | null;
          notes: string | null;
        }>;
      }>;
      rules: Array<{
        id: string;
        ruleType: string;
        phase: string | null;
        explanation: string;
        priority: number;
      }>;
    } | null;
    extractionRuns: Array<{
      id: string;
      extractorVersion: string;
      reviewStatus: 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';
      confidence: number | null;
      warningCount: number;
      sessionCount: number;
      weekCount: number;
      createdAt: string;
      updatedAt: string;
      summaryJson:
        | {
            warnings?: string[];
            recommendedAction?: string;
            inferredLayoutFamily?: {
              slug: string;
              confidence: number;
              reasons: string[];
            };
          }
        | null;
      layoutFamily: { id: string; slug: string; name: string } | null;
      reviews: Array<{
        id: string;
        status: 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';
        notes: string | null;
        reviewerEmail: string;
        createdAt: string;
      }>;
    }>;
    latestRun: {
      id: string;
      reviewStatus: 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';
      confidence: number | null;
      warningCount: number;
      sessionCount: number;
      weekCount: number;
      createdAt: string;
      summaryJson:
        | {
            warnings?: string[];
            recommendedAction?: string;
            inferredLayoutFamily?: {
              slug: string;
              confidence: number;
              reasons: string[];
            };
          }
        | null;
    } | null;
    gridPreview: {
      pageNumber: number | null;
      weekCount: number;
      dayCount: number;
      cellCount: number;
      diagnostics: string[];
      cells: Array<{
        pageNumber: number | null;
        label: string;
        weekIndex: number;
        dayOfWeek: number | null;
        rowIndex: number;
        columnIndex: number;
        bbox: {
          x: number;
          y: number;
          width: number;
          height: number;
        };
      }>;
    };
    annotations: Array<{
      id: string;
      pageNumber: number;
      annotationType: 'WEEK_HEADER' | 'DAY_LABEL' | 'SESSION_CELL' | 'BLOCK_TITLE' | 'IGNORE_REGION' | 'LEGEND' | 'NOTE';
      label: string | null;
      bboxJson: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      note: string | null;
      createdByEmail: string;
      createdAt: string;
      updatedAt: string;
    }>;
  };
};

type PlanLibraryParserStudioProps = {
  adminEmail: string;
  initialSourceId?: string | null;
};

type LatestVersionSession = NonNullable<NonNullable<ParserStudioDetail['planSource']['latestVersion']>['weeks'][number]['sessions'][number]>;

type EditableSessionForm = {
  sessionId: string;
  dayOfWeek: string;
  discipline: string;
  sessionType: string;
  title: string;
  durationMinutes: string;
  distanceKm: string;
  notes: string;
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatTimestamp(value: string) {
  try {
    return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatEnum(value: string | null | undefined) {
  if (!value) return '—';
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatConfidence(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function formatDistanceKm(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return `${value.toFixed(value >= 10 ? 0 : 1)} km`;
}

function formatDurationMinutes(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value >= 60) {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${value} min`;
}

function createEditableSessionForm(session: LatestVersionSession): EditableSessionForm {
  return {
    sessionId: session.id,
    dayOfWeek: session.dayOfWeek == null ? '' : String(session.dayOfWeek),
    discipline: session.discipline,
    sessionType: session.sessionType,
    title: session.title ?? '',
    durationMinutes: session.durationMinutes == null ? '' : String(session.durationMinutes),
    distanceKm: session.distanceKm == null ? '' : String(session.distanceKm),
    notes: session.notes ?? '',
  };
}

function isManualSessionEdit(structureJson: unknown) {
  if (!structureJson || typeof structureJson !== 'object') return false;
  const editor = (structureJson as Record<string, unknown>).editor;
  return Boolean(editor && typeof editor === 'object' && (editor as Record<string, unknown>).source === 'parser-studio');
}

function statusBadgeClass(status: 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED') {
  if (status === 'APPROVED') return 'bg-emerald-100 text-emerald-700';
  if (status === 'REJECTED') return 'bg-rose-100 text-rose-700';
  return 'bg-amber-100 text-amber-800';
}

function MetaStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--bg-structure)]/60 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-sm font-medium text-[var(--text)]">{value}</div>
    </div>
  );
}

export function PlanLibraryParserStudio({ adminEmail, initialSourceId }: PlanLibraryParserStudioProps) {
  const [overview, setOverview] = useState<{ layoutFamilies: LayoutFamilySummary[]; sources: ParserStudioSourceSummary[] } | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialSourceId ?? null);
  const [detail, setDetail] = useState<ParserStudioDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [layoutFamilyId, setLayoutFamilyId] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionBusy, setActionBusy] = useState<'layout' | 'review' | 'reextract' | 'session' | null>(null);
  const [editingSession, setEditingSession] = useState<EditableSessionForm | null>(null);

  const loadOverview = useCallback(async (preferredSourceId?: string | null) => {
    setOverviewLoading(true);
    setOverviewError('');
    try {
      const response = await fetch('/api/admin/plan-library/parser-studio', { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Failed to load parser studio sources.');
      }
      const data = payload?.data as { layoutFamilies: LayoutFamilySummary[]; sources: ParserStudioSourceSummary[] };
      setOverview(data);
      setSelectedId((current) => {
        const candidates = data?.sources ?? [];
        if (!candidates.length) return null;
        const explicit = preferredSourceId ?? current;
        if (explicit && candidates.some((source) => source.id === explicit)) return explicit;
        return candidates[0]?.id ?? null;
      });
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : 'Failed to load parser studio sources.');
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (sourceId: string) => {
    setDetailLoading(true);
    setDetailError('');
    setActionError('');
    setActionMessage('');
    try {
      const response = await fetch(`/api/admin/plan-library/${sourceId}/parser-studio`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Failed to load parser studio detail.');
      }
      const data = payload?.data as ParserStudioDetail;
      setDetail(data);
      setLayoutFamilyId(data.planSource.layoutFamily?.id ?? data.planSource.recommendedLayoutFamily?.id ?? '');
      const latestReview = data.planSource.extractionRuns[0]?.reviews[0];
      setReviewNotes(latestReview?.notes ?? '');
      setEditingSession(null);
    } catch (error) {
      setDetail(null);
      setDetailError(error instanceof Error ? error.message : 'Failed to load parser studio detail.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview(initialSourceId ?? null);
  }, [initialSourceId, loadOverview]);

  useEffect(() => {
    if (!selectedId) return;
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const latestRun = detail?.planSource.latestRun ?? null;
  const warnings = Array.isArray(latestRun?.summaryJson?.warnings) ? latestRun?.summaryJson?.warnings ?? [] : [];
  const gridPreview = detail?.planSource.gridPreview ?? null;

  const refreshAll = useCallback(async (preferredSourceId?: string | null) => {
    await loadOverview(preferredSourceId ?? selectedId ?? null);
    const targetId = preferredSourceId ?? selectedId;
    if (targetId) {
      await loadDetail(targetId);
    }
  }, [loadDetail, loadOverview, selectedId]);

  const saveLayoutFamily = useCallback(async () => {
    if (!selectedId) return;
    setActionBusy('layout');
    setActionError('');
    setActionMessage('');
    try {
      const response = await fetch(`/api/admin/plan-library/${selectedId}/parser-studio`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layoutFamilyId: layoutFamilyId || null }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Failed to save layout family.');
      }
      setActionMessage('Layout family saved.');
      const data = payload?.data as ParserStudioDetail;
      setDetail(data);
      await loadOverview(selectedId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to save layout family.');
    } finally {
      setActionBusy(null);
    }
  }, [layoutFamilyId, loadOverview, selectedId]);

  const submitReview = useCallback(async (reviewStatus: 'APPROVED' | 'NEEDS_REVIEW' | 'REJECTED') => {
    if (!selectedId) return;
    setActionBusy('review');
    setActionError('');
    setActionMessage('');
    try {
      const response = await fetch(`/api/admin/plan-library/${selectedId}/parser-studio`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewStatus, reviewNotes }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Failed to record parser review.');
      }
      const data = payload?.data as ParserStudioDetail;
      setDetail(data);
      setActionMessage(
        reviewStatus === 'APPROVED'
          ? 'Source approved for APB weighting.'
          : reviewStatus === 'REJECTED'
            ? 'Source rejected; APB selection will ignore it.'
            : 'Source marked for further parser review.'
      );
      await loadOverview(selectedId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to record parser review.');
    } finally {
      setActionBusy(null);
    }
  }, [loadOverview, reviewNotes, selectedId]);

  const rerunExtraction = useCallback(async () => {
    if (!selectedId) return;
    setActionBusy('reextract');
    setActionError('');
    setActionMessage('');
    try {
      const response = await fetch(`/api/admin/plan-library/${selectedId}/parser-studio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reextract' }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Failed to rerun extraction.');
      }
      setActionMessage('Extraction rerun created a new parser run.');
      await refreshAll(selectedId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to rerun extraction.');
    } finally {
      setActionBusy(null);
    }
  }, [refreshAll, selectedId]);

  const createAnnotation = useCallback(async (payload: {
    pageNumber: number;
    annotationType: 'WEEK_HEADER' | 'DAY_LABEL' | 'SESSION_CELL' | 'BLOCK_TITLE' | 'IGNORE_REGION' | 'LEGEND' | 'NOTE';
    label: string;
    note: string;
    bbox: { x: number; y: number; width: number; height: number };
  }) => {
    if (!selectedId) return;
    const response = await fetch(`/api/admin/plan-library/${selectedId}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const payloadJson = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payloadJson?.error?.message || 'Failed to save annotation.');
    }
    const data = payloadJson?.data as ParserStudioDetail;
    setDetail(data);
    await loadOverview(selectedId);
  }, [loadOverview, selectedId]);

  const deleteAnnotation = useCallback(async (annotationId: string) => {
    if (!selectedId) return;
    const response = await fetch(`/api/admin/plan-library/${selectedId}/annotations/${annotationId}`, {
      method: 'DELETE',
    });
    const payloadJson = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payloadJson?.error?.message || 'Failed to delete annotation.');
    }
    const data = payloadJson?.data as ParserStudioDetail;
    setDetail(data);
    await loadOverview(selectedId);
  }, [loadOverview, selectedId]);

  const saveSessionEdit = useCallback(async () => {
    if (!selectedId || !editingSession) return;
    setActionBusy('session');
    setActionError('');
    setActionMessage('');
    try {
      const response = await fetch(`/api/admin/plan-library/${selectedId}/sessions/${editingSession.sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayOfWeek: editingSession.dayOfWeek,
          discipline: editingSession.discipline,
          sessionType: editingSession.sessionType,
          title: editingSession.title,
          durationMinutes: editingSession.durationMinutes,
          distanceKm: editingSession.distanceKm,
          notes: editingSession.notes,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Failed to save session edit.');
      }
      const data = payload?.data as ParserStudioDetail;
      setDetail(data);
      setEditingSession(null);
      setActionMessage('Session updated on the latest extracted version.');
      await loadOverview(selectedId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to save session edit.');
    } finally {
      setActionBusy(null);
    }
  }, [editingSession, loadOverview, selectedId]);

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Parser Studio</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Admin review workflow for plan ingestion, layout-family routing, and APB trust gating.
          </p>
        </div>
        <div className="text-sm text-muted-foreground">Admin: {adminEmail}</div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Sources</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Pick a plan source, inspect the parse, and set the review gate APB should trust.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadOverview(selectedId)}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-structure)]"
            >
              <Icon name="refresh" size="sm" aria-hidden />
              <span>Refresh</span>
            </button>
          </div>

          {overviewError ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{overviewError}</div> : null}

          <div className="mt-4 space-y-3">
            {overviewLoading ? <div className="rounded-xl border border-dashed border-[var(--border-subtle)] px-4 py-8 text-sm text-[var(--muted)]">Loading parser studio sources…</div> : null}
            {!overviewLoading && !(overview?.sources.length) ? (
              <div className="rounded-xl border border-dashed border-[var(--border-subtle)] px-4 py-8 text-sm text-[var(--muted)]">
                No ingested plan sources are available yet.
              </div>
            ) : null}

            {overview?.sources.map((source) => {
              const selected = source.id === selectedId;
              const reviewStatus = source.latestRun?.reviewStatus ?? 'NEEDS_REVIEW';
              return (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => setSelectedId(source.id)}
                  className={cn(
                    'w-full rounded-2xl border p-3 text-left transition-colors',
                    selected
                      ? 'border-[var(--text)] bg-[var(--bg-card)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-card)] hover:bg-[var(--bg-structure)]/55'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[var(--text)]">{source.title}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">
                        {formatEnum(source.sport)} · {formatEnum(source.distance)} · {source.durationWeeks} weeks
                      </div>
                    </div>
                    <span className={cn('rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide', statusBadgeClass(reviewStatus))}>
                      {formatEnum(reviewStatus)}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
                    <span>Warnings {source.latestRun?.warningCount ?? 0}</span>
                    <span>Confidence {formatConfidence(source.latestRun?.confidence ?? source.latestVersion?.extractionMetaJson?.confidence ?? null)}</span>
                    <span>{source.layoutFamily?.name ?? source.recommendedLayoutFamily?.name ?? 'No family yet'}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-6">
          {detailError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{detailError}</div> : null}
          {detailLoading && !detail ? <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] px-4 py-10 text-sm text-[var(--muted)]">Loading parser studio detail…</div> : null}
          {!detailLoading && !detail && !detailError ? (
            <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] px-4 py-10 text-sm text-[var(--muted)]">
              Select a plan source to open Parser Studio.
            </div>
          ) : null}

          {detail ? (
            <>
              <article className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-semibold">{detail.planSource.title}</h2>
                      {detail.planSource.latestRun ? (
                        <span className={cn('rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide', statusBadgeClass(detail.planSource.latestRun.reviewStatus))}>
                          {formatEnum(detail.planSource.latestRun.reviewStatus)}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      {formatEnum(detail.planSource.sport)} · {formatEnum(detail.planSource.distance)} · {formatEnum(detail.planSource.level)} · {detail.planSource.durationWeeks} weeks
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">Updated {formatTimestamp(detail.planSource.updatedAt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {detail.planSource.storedDocumentUrl ? (
                      <a
                        href={detail.planSource.storedDocumentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-structure)]"
                      >
                        <Icon name="link" size="sm" aria-hidden />
                        <span>Open stored PDF</span>
                      </a>
                    ) : null}
                    <Link
                      href={`/admin/plan-library` as any}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-structure)]"
                    >
                      <Icon name="prev" size="sm" aria-hidden />
                      <span>Back to library</span>
                    </Link>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <MetaStat label="Weeks" value={String(detail.planSource.latestRun?.weekCount ?? detail.planSource.latestVersion?.weeks.length ?? 0)} />
                  <MetaStat label="Sessions" value={String(detail.planSource.latestRun?.sessionCount ?? detail.planSource.latestVersion?.weeks.reduce((sum, week) => sum + week.sessions.length, 0) ?? 0)} />
                  <MetaStat label="Warnings" value={String(detail.planSource.latestRun?.warningCount ?? warnings.length)} />
                  <MetaStat label="Confidence" value={formatConfidence(detail.planSource.latestRun?.confidence ?? detail.planSource.latestVersion?.extractionMetaJson?.confidence ?? null)} />
                </div>
              </article>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
                {detail.planSource.storedDocumentUrl ? (
                  <article className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 xl:col-span-2">
                    <PlanSourcePdfAnnotator
                      pdfUrl={detail.planSource.storedDocumentUrl}
                      annotations={detail.planSource.annotations}
                      previewCells={detail.planSource.gridPreview?.cells ?? []}
                      initialPageNumber={detail.planSource.gridPreview?.pageNumber ?? 1}
                      onCreateAnnotation={createAnnotation}
                      onDeleteAnnotation={deleteAnnotation}
                    />
                  </article>
                ) : null}

                <article className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">Layout Family Routing</h3>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        Set the parser family CoachKit should assume for this source, then rerun extraction.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-[var(--muted)]">Assigned layout family</span>
                      <select
                        value={layoutFamilyId}
                        onChange={(event) => setLayoutFamilyId(event.target.value)}
                        className="min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)]"
                      >
                        <option value="">Unassigned</option>
                        {detail.layoutFamilies.map((family) => (
                          <option key={family.id} value={family.id}>
                            {family.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => void saveLayoutFamily()}
                      disabled={actionBusy != null}
                      className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-[var(--border-subtle)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-structure)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Save family
                    </button>
                  </div>

                  <div className="mt-3 rounded-xl bg-[var(--bg-structure)]/55 px-3 py-3 text-sm text-[var(--text)]">
                    <div className="font-medium">Recommended family</div>
                    <div className="mt-1">
                      {detail.planSource.recommendedLayoutFamily
                        ? `${detail.planSource.recommendedLayoutFamily.name} (${formatConfidence(detail.planSource.recommendedLayoutFamily.confidence)})`
                        : 'No recommendation available.'}
                    </div>
                    {detail.planSource.recommendedLayoutFamily?.reasons?.length ? (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--muted)]">
                        {detail.planSource.recommendedLayoutFamily.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-3 text-sm text-[var(--text)]">
                    <div className="font-medium">Compiled template</div>
                    <div className="mt-1">
                      {detail.planSource.layoutFamily?.hasCompiledRules
                        ? `Ready (${detail.planSource.layoutFamily.compiledTemplateVersion || 'template'})`
                        : 'No compiled template yet.'}
                    </div>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      {detail.planSource.layoutFamily?.hasCompiledRules
                        ? 'Reruns will use the saved weekly-grid template for coordinate-based session extraction.'
                        : 'Annotate week headers and day labels, then rerun extraction to compile a reusable template.'}
                    </p>
                  </div>

                  <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-3 text-sm text-[var(--text)]">
                    <div className="font-medium">Grid preview</div>
                    <div className="mt-1">
                      {gridPreview?.cellCount
                        ? `${gridPreview.cellCount} cells · ${gridPreview.weekCount} weeks · ${gridPreview.dayCount} day rows`
                        : 'No derived grid yet.'}
                    </div>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      This uses the current annotations and/or compiled family rules to show the session boxes that will be extracted on rerun.
                    </p>
                    {gridPreview?.diagnostics?.length ? (
                      <div className="mt-3 space-y-2">
                        {gridPreview.diagnostics.map((diagnostic) => (
                          <div key={diagnostic} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            {diagnostic}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void rerunExtraction()}
                      disabled={actionBusy != null}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[var(--text)] px-4 py-2 text-sm font-medium text-[var(--bg-page)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Icon name="refresh" size="sm" aria-hidden />
                      <span>Rerun extraction</span>
                    </button>
                    {detail.planSource.latestRun?.summaryJson?.recommendedAction ? (
                      <div className="inline-flex min-h-[44px] items-center rounded-full border border-[var(--border-subtle)] px-4 py-2 text-sm text-[var(--muted)]">
                        Recommended next step: {formatEnum(detail.planSource.latestRun.summaryJson.recommendedAction)}
                      </div>
                    ) : null}
                  </div>
                </article>

                <article className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                  <div>
                    <h3 className="text-sm font-semibold">Review Gate</h3>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Approved sources are weighted up for APB. Rejected parses are ignored by APB selection.
                    </p>
                  </div>

                  <label className="mt-4 block space-y-1">
                    <span className="text-xs font-medium text-[var(--muted)]">Review notes</span>
                    <textarea
                      value={reviewNotes}
                      onChange={(event) => setReviewNotes(event.target.value)}
                      rows={5}
                      className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)]"
                      placeholder="Capture what is wrong or why this source is safe to trust."
                    />
                  </label>

                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => void submitReview('APPROVED')}
                      disabled={actionBusy != null}
                      className="min-h-[44px] rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitReview('NEEDS_REVIEW')}
                      disabled={actionBusy != null}
                      className="min-h-[44px] rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Needs review
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitReview('REJECTED')}
                      disabled={actionBusy != null}
                      className="min-h-[44px] rounded-full border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-900 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>

                  {detail.planSource.extractionRuns[0]?.reviews[0] ? (
                    <div className="mt-4 rounded-xl bg-[var(--bg-structure)]/55 px-3 py-3 text-xs text-[var(--muted)]">
                      Latest review by {detail.planSource.extractionRuns[0].reviews[0].reviewerEmail} on{' '}
                      {formatTimestamp(detail.planSource.extractionRuns[0].reviews[0].createdAt)}.
                    </div>
                  ) : null}
                </article>
              </div>

              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              {actionMessage ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{actionMessage}</div> : null}

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
                <article className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">Latest Extracted Structure</h3>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        Inspect the normalized week/session tree that APB can draw from.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-4">
                    {detail.planSource.latestVersion?.weeks.length ? (
                      detail.planSource.latestVersion.weeks.map((week) => (
                        <div key={week.id} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-semibold">Week {week.weekIndex + 1}</div>
                            <div className="text-xs text-[var(--muted)]">
                              {week.totalSessions != null ? `${week.totalSessions} sessions` : `${week.sessions.length} sessions`}
                              {week.totalMinutes != null ? ` · ${week.totalMinutes} min` : ''}
                            </div>
                          </div>
                          {week.notes ? <div className="mt-2 text-xs text-[var(--muted)]">{week.notes}</div> : null}
                          <div className="mt-3 space-y-2">
                            {week.sessions.length ? (
                              week.sessions.map((session) => (
                                <div key={session.id} className="rounded-xl border border-[var(--border-subtle)] px-3 py-2">
                                  <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <div className="text-sm font-medium text-[var(--text)]">
                                          {session.dayOfWeek != null ? `${DAY_LABELS[session.dayOfWeek] ?? 'Day'} · ` : ''}
                                          {session.title ?? `${formatEnum(session.discipline)} session`}
                                        </div>
                                        {isManualSessionEdit(session.structureJson) ? (
                                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
                                            Edited
                                          </span>
                                        ) : null}
                                      </div>
                                      <div className="mt-1 text-xs text-[var(--muted)]">
                                        {formatEnum(session.discipline)} · {formatEnum(session.sessionType)}
                                        {session.intensityType ? ` · ${session.intensityType}` : ''}
                                      </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                      <div className="text-right text-xs text-[var(--muted)]">
                                        {formatDurationMinutes(session.durationMinutes) ?? '—'}
                                        {formatDistanceKm(session.distanceKm) ? ` · ${formatDistanceKm(session.distanceKm)}` : ''}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => setEditingSession(createEditableSessionForm(session))}
                                        className="rounded-full border border-[var(--border-subtle)] px-3 py-1 text-xs font-medium text-[var(--text)] hover:bg-[var(--bg-structure)]"
                                      >
                                        Edit
                                      </button>
                                    </div>
                                  </div>
                                  {session.parserWarningsJson?.length ? (
                                    <div className="mt-2 text-xs text-amber-700">Warnings: {session.parserWarningsJson.slice(0, 2).join(' · ')}</div>
                                  ) : null}
                                  {session.notes ? <div className="mt-2 line-clamp-3 text-xs text-[var(--muted)]">{session.notes}</div> : null}
                                  {editingSession?.sessionId === session.id ? (
                                    <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                                      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Manual session correction</div>
                                      <div className="grid gap-3 md:grid-cols-2">
                                        <label className="space-y-1">
                                          <span className="text-xs font-medium text-[var(--muted)]">Day</span>
                                          <select
                                            value={editingSession.dayOfWeek}
                                            onChange={(event) => setEditingSession((current) => (current ? { ...current, dayOfWeek: event.target.value } : current))}
                                            className="min-h-[40px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)]"
                                          >
                                            <option value="">Unset</option>
                                            {DAY_LABELS.map((label, index) => (
                                              <option key={label} value={String(index)}>
                                                {label}
                                              </option>
                                            ))}
                                          </select>
                                        </label>
                                        <label className="space-y-1">
                                          <span className="text-xs font-medium text-[var(--muted)]">Discipline</span>
                                          <select
                                            value={editingSession.discipline}
                                            onChange={(event) => setEditingSession((current) => (current ? { ...current, discipline: event.target.value } : current))}
                                            className="min-h-[40px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)]"
                                          >
                                            <option value="SWIM">Swim</option>
                                            <option value="BIKE">Bike</option>
                                            <option value="RUN">Run</option>
                                            <option value="STRENGTH">Strength</option>
                                            <option value="REST">Rest</option>
                                          </select>
                                        </label>
                                        <label className="space-y-1 md:col-span-2">
                                          <span className="text-xs font-medium text-[var(--muted)]">Title</span>
                                          <input
                                            value={editingSession.title}
                                            onChange={(event) => setEditingSession((current) => (current ? { ...current, title: event.target.value } : current))}
                                            className="min-h-[40px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)]"
                                          />
                                        </label>
                                        <label className="space-y-1">
                                          <span className="text-xs font-medium text-[var(--muted)]">Session type</span>
                                          <input
                                            value={editingSession.sessionType}
                                            onChange={(event) => setEditingSession((current) => (current ? { ...current, sessionType: event.target.value } : current))}
                                            className="min-h-[40px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)]"
                                          />
                                        </label>
                                        <label className="space-y-1">
                                          <span className="text-xs font-medium text-[var(--muted)]">Duration (min)</span>
                                          <input
                                            value={editingSession.durationMinutes}
                                            onChange={(event) => setEditingSession((current) => (current ? { ...current, durationMinutes: event.target.value } : current))}
                                            inputMode="numeric"
                                            className="min-h-[40px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)]"
                                          />
                                        </label>
                                        <label className="space-y-1">
                                          <span className="text-xs font-medium text-[var(--muted)]">Distance (km)</span>
                                          <input
                                            value={editingSession.distanceKm}
                                            onChange={(event) => setEditingSession((current) => (current ? { ...current, distanceKm: event.target.value } : current))}
                                            inputMode="decimal"
                                            className="min-h-[40px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)]"
                                          />
                                        </label>
                                        <label className="space-y-1 md:col-span-2">
                                          <span className="text-xs font-medium text-[var(--muted)]">Session notes / prescription</span>
                                          <textarea
                                            rows={5}
                                            value={editingSession.notes}
                                            onChange={(event) => setEditingSession((current) => (current ? { ...current, notes: event.target.value } : current))}
                                            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)]"
                                          />
                                        </label>
                                      </div>
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        <button
                                          type="button"
                                          onClick={() => void saveSessionEdit()}
                                          disabled={actionBusy != null}
                                          className="rounded-full bg-[var(--text)] px-4 py-2 text-sm font-medium text-[var(--bg-page)] disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                          Save session
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setEditingSession(null)}
                                          disabled={actionBusy != null}
                                          className="rounded-full border border-[var(--border-subtle)] px-4 py-2 text-sm font-medium text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              ))
                            ) : (
                              <div className="text-xs text-[var(--muted)]">No sessions were extracted for this week.</div>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-[var(--border-subtle)] px-4 py-8 text-sm text-[var(--muted)]">
                        No week/session structure is available on the latest version yet.
                      </div>
                    )}
                  </div>
                </article>

                <div className="space-y-6">
                  <article className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                    <h3 className="text-sm font-semibold">Warnings</h3>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      These warnings are the current parse risk signals. High warning counts should stay out of APB until reviewed.
                    </p>
                    <div className="mt-4 space-y-2">
                      {warnings.length ? (
                        warnings.map((warning) => (
                          <div key={warning} className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            {warning}
                          </div>
                        ))
                      ) : (
                        <div className="rounded-xl border border-dashed border-[var(--border-subtle)] px-3 py-6 text-sm text-[var(--muted)]">
                          No parser warnings on the latest run.
                        </div>
                      )}
                    </div>
                  </article>

                  <article className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                    <h3 className="text-sm font-semibold">Run History</h3>
                    <div className="mt-4 space-y-3">
                      {detail.planSource.extractionRuns.length ? (
                        detail.planSource.extractionRuns.map((run) => (
                          <div key={run.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-medium text-[var(--text)]">{formatTimestamp(run.createdAt)}</div>
                              <span className={cn('rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide', statusBadgeClass(run.reviewStatus))}>
                                {formatEnum(run.reviewStatus)}
                              </span>
                            </div>
                            <div className="mt-2 text-xs text-[var(--muted)]">
                              {run.layoutFamily?.name ?? 'No layout family'} · warnings {run.warningCount} · confidence {formatConfidence(run.confidence)}
                            </div>
                            {run.reviews[0]?.notes ? <div className="mt-2 text-xs text-[var(--text)]">{run.reviews[0].notes}</div> : null}
                          </div>
                        ))
                      ) : (
                        <div className="rounded-xl border border-dashed border-[var(--border-subtle)] px-3 py-6 text-sm text-[var(--muted)]">
                          No extraction runs recorded yet.
                        </div>
                      )}
                    </div>
                  </article>

                  <article className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                    <h3 className="text-sm font-semibold">Raw Text Preview</h3>
                    <div className="mt-4 max-h-[420px] overflow-auto rounded-xl bg-[var(--bg-card)] px-3 py-3 font-mono text-xs leading-6 text-[var(--text)] whitespace-pre-wrap">
                      {detail.planSource.rawText || 'No raw text stored.'}
                    </div>
                  </article>
                </div>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

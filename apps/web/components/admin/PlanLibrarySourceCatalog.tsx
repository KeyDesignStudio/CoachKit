'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

type PlanSourceSummary = {
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
  licenseText: string | null;
  sourceUrl: string | null;
  sourceFilePath: string | null;
  layoutFamily: { id: string; slug: string; name: string; hasCompiledRules?: boolean } | null;
  storedDocumentUrl: string | null;
  storedDocumentKey: string | null;
  storedDocumentContentType: string | null;
  storedDocumentUploadedAt: string | null;
  checksumSha256: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  versionCount: number;
  latestVersion: {
    id: string;
    version: number;
    createdAt: string;
    extractionMetaJson: {
      confidence?: number | null;
      sessionCount?: number | null;
      weekCount?: number | null;
      warnings?: string[] | null;
    } | null;
  } | null;
  latestExtractionRun: {
    id: string;
    reviewStatus: 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';
    confidence: number | null;
    warningCount: number;
    createdAt: string;
    latestReview: {
      id: string;
      status: 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';
      reviewerEmail: string;
      createdAt: string;
    } | null;
  } | null;
};

type PlanSourceDetail = {
  id: string;
  rawText: string;
  sourceUrl: string | null;
  sourceFilePath: string | null;
  storedDocumentUrl: string | null;
  storedDocumentKey: string | null;
  storedDocumentContentType: string | null;
  storedDocumentUploadedAt: string | null;
  versions: Array<{
    id: string;
    version: number;
    createdAt: string;
    extractionMetaJson: {
      confidence?: number | null;
      sessionCount?: number | null;
      weekCount?: number | null;
      warnings?: string[] | null;
    } | null;
  }>;
};

type PlanLibrarySourceCatalogProps = {
  refreshNonce: number;
};

function formatTimestamp(value: string) {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
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

function getSourceFileLabel(sourceFilePath: string | null) {
  if (!sourceFilePath) return null;
  const idx = sourceFilePath.indexOf(':');
  if (idx === -1) return sourceFilePath;
  return sourceFilePath.slice(idx + 1) || sourceFilePath;
}

function getExtractionHealth(source: PlanSourceSummary) {
  const confidence = Number(source.latestVersion?.extractionMetaJson?.confidence ?? 0);
  const warnings = Array.isArray(source.latestVersion?.extractionMetaJson?.warnings) ? source.latestVersion?.extractionMetaJson?.warnings ?? [] : [];
  if (warnings.length >= 2 || confidence < 0.6) {
    return {
      label: 'Needs review',
      className: 'bg-amber-100 text-amber-800',
      warnings,
      confidence,
    };
  }
  if (warnings.length || confidence < 0.82) {
    return {
      label: 'Check parse',
      className: 'bg-sky-100 text-sky-800',
      warnings,
      confidence,
    };
  }
  return {
    label: 'Healthy',
    className: 'bg-emerald-100 text-emerald-700',
    warnings,
    confidence,
  };
}

function hasStoredDocument(source: Pick<PlanSourceSummary, 'storedDocumentUrl'> | Pick<PlanSourceDetail, 'storedDocumentUrl'>) {
  return Boolean(source.storedDocumentUrl);
}

function hasOriginalUrl(source: Pick<PlanSourceSummary, 'sourceUrl'> | Pick<PlanSourceDetail, 'sourceUrl'>) {
  return Boolean(source.sourceUrl);
}

function SourceMetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-[var(--bg-structure)]/55 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-1 truncate text-sm text-[var(--text)]" title={value}>
        {value}
      </div>
    </div>
  );
}

export function PlanLibrarySourceCatalog({ refreshNonce }: PlanLibrarySourceCatalogProps) {
  const [sources, setSources] = useState<PlanSourceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, PlanSourceDetail | undefined>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailErrorById, setDetailErrorById] = useState<Record<string, string | undefined>>({});

  const loadSources = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/plan-library/sources', { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Failed to load plan library sources.');
      }
      setSources((payload?.data?.sources ?? []) as PlanSourceSummary[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load plan library sources.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSources();
  }, [loadSources, refreshNonce]);

  const loadDetail = useCallback(async (id: string) => {
    if (detailById[id]) return;
    setDetailLoadingId(id);
    setDetailErrorById((current) => ({ ...current, [id]: undefined }));
    try {
      const response = await fetch(`/api/admin/plan-library/${id}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Failed to load plan source details.');
      }
      const planSource = payload?.data?.planSource;
      if (!planSource) {
        throw new Error('Plan source details were empty.');
      }
      const detail: PlanSourceDetail = {
        id: planSource.id,
        rawText: String(planSource.rawText ?? ''),
        sourceUrl: planSource.sourceUrl ?? null,
        sourceFilePath: planSource.sourceFilePath ?? null,
        storedDocumentUrl: planSource.storedDocumentUrl ?? null,
        storedDocumentKey: planSource.storedDocumentKey ?? null,
        storedDocumentContentType: planSource.storedDocumentContentType ?? null,
        storedDocumentUploadedAt: planSource.storedDocumentUploadedAt ? String(planSource.storedDocumentUploadedAt) : null,
        versions: Array.isArray(planSource.versions)
          ? planSource.versions.map((version: any) => ({
              id: String(version.id),
              version: Number(version.version ?? 0),
              createdAt: String(version.createdAt),
              extractionMetaJson: version.extractionMetaJson ?? null,
            }))
          : [],
      };
      setDetailById((current) => ({ ...current, [id]: detail }));
    } catch (err) {
      setDetailErrorById((current) => ({
        ...current,
        [id]: err instanceof Error ? err.message : 'Failed to load plan source details.',
      }));
    } finally {
      setDetailLoadingId((current) => (current === id ? null : current));
    }
  }, [detailById]);

  const totalActive = useMemo(() => sources.filter((source) => source.isActive).length, [sources]);
  const orderedSources = useMemo(() => {
    const reviewRank = (source: PlanSourceSummary) => {
      if (source.latestExtractionRun?.reviewStatus === 'NEEDS_REVIEW') return 0;
      if (!source.latestExtractionRun) return 1;
      if (source.latestExtractionRun.reviewStatus === 'REJECTED') return 2;
      return 3;
    };

    return [...sources].sort((left, right) => {
      const rankDelta = reviewRank(left) - reviewRank(right);
      if (rankDelta !== 0) return rankDelta;
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [sources]);

  return (
    <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Step 2 to 4</div>
          <h2 className="mt-1 text-lg font-semibold">Source Review Queue</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {sources.length} total sources · {totalActive} active. Work from the top down: review the parse, open Parser Studio, and only approve what CoachKit should trust.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadSources()}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-structure)]"
        >
          <Icon name="refresh" size="sm" aria-hidden />
          <span>Refresh list</span>
        </button>
      </div>

      {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      <div className="mt-4 space-y-3">
        {loading ? <div className="rounded-xl border border-dashed border-[var(--border-subtle)] px-4 py-8 text-sm text-[var(--muted)]">Loading plan library sources…</div> : null}

        {!loading && sources.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border-subtle)] px-4 py-8 text-sm text-[var(--muted)]">
            No plan sources have been ingested yet.
          </div>
        ) : null}

        {!loading
          ? orderedSources.map((source) => {
              const expanded = expandedId === source.id;
              const detail = detailById[source.id];
              const detailError = detailErrorById[source.id];
              const fileLabel = getSourceFileLabel(source.sourceFilePath);
              const extractionHealth = getExtractionHealth(source);
              const topWarnings = extractionHealth.warnings.slice(0, 2);
              const parserReviewStatus = source.latestExtractionRun?.reviewStatus ?? null;
              return (
                <article key={source.id} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-[var(--text)]">{source.title}</h3>
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', source.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700')}>
                          {source.isActive ? 'Active' : 'Inactive'}
                        </span>
                        <span className="rounded-full bg-[var(--bg-structure)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                          {source.type}
                        </span>
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', extractionHealth.className)}>
                          {extractionHealth.label}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-[var(--muted)]">
                        Uploaded {formatTimestamp(source.createdAt)} · Updated {formatTimestamp(source.updatedAt)} · Version count {source.versionCount}
                      </div>
                      {topWarnings.length ? (
                        <ul className="mt-2 list-disc pl-4 text-xs text-amber-700">
                          {topWarnings.map((warning, index) => (
                            <li key={`${source.id}-warning-${index}`}>{warning}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {hasStoredDocument(source) ? (
                        <a
                          href={source.storedDocumentUrl ?? '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-structure)]"
                        >
                          <Icon name="link" size="sm" aria-hidden />
                          <span>Open stored PDF</span>
                        </a>
                      ) : null}
                      {hasOriginalUrl(source) ? (
                        <a
                          href={source.sourceUrl ?? '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-structure)]"
                        >
                          <Icon name="link" size="sm" aria-hidden />
                          <span>Open source URL</span>
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          const next = expanded ? null : source.id;
                          setExpandedId(next);
                          if (next) void loadDetail(next);
                        }}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-structure)]"
                      >
                        <Icon name={expanded ? 'close' : 'expandMore'} size="sm" aria-hidden />
                        <span>{expanded ? 'Hide details' : 'View details'}</span>
                      </button>
                      <Link
                        href={`/admin/plan-library/parser-studio?sourceId=${source.id}` as any}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-structure)]"
                      >
                        <Icon name="settings" size="sm" aria-hidden />
                        <span>Parser Studio</span>
                      </Link>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <SourceMetaItem label="Sport" value={formatEnum(source.sport)} />
                    <SourceMetaItem label="Distance" value={formatEnum(source.distance)} />
                    <SourceMetaItem label="Level" value={formatEnum(source.level)} />
                    <SourceMetaItem label="Duration" value={`${source.durationWeeks} weeks`} />
                    <SourceMetaItem label="Season" value={formatEnum(source.season)} />
                    <SourceMetaItem label="Author" value={source.author?.trim() || '—'} />
                    <SourceMetaItem label="Publisher" value={source.publisher?.trim() || '—'} />
                    <SourceMetaItem label="Layout family" value={source.layoutFamily?.name || 'Unassigned'} />
                    <SourceMetaItem label="Parser gate" value={parserReviewStatus ? formatEnum(parserReviewStatus) : 'No review yet'} />
                    <SourceMetaItem label="Source reference" value={fileLabel || source.sourceUrl || source.storedDocumentKey || 'No original document reference stored'} />
                    <SourceMetaItem label="Stored PDF" value={source.storedDocumentUploadedAt ? `Available · ${formatTimestamp(source.storedDocumentUploadedAt)}` : 'Not stored'} />
                  </div>

                  {source.latestVersion ? (
                    <div className="mt-3 rounded-xl bg-[var(--bg-structure)]/45 px-3 py-2 text-xs text-[var(--muted)]">
                      Latest extraction v{source.latestVersion.version} · confidence {String(extractionHealth.confidence || '—')} · weeks {String(source.latestVersion.extractionMetaJson?.weekCount ?? '—')} · sessions {String(source.latestVersion.extractionMetaJson?.sessionCount ?? '—')} · warnings {String(extractionHealth.warnings.length)}
                    </div>
                  ) : null}

                  {expanded ? (
                    <div className="mt-4 space-y-4 border-t border-[var(--border-subtle)] pt-4">
                      {!hasStoredDocument(detail ?? source) ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                          No stored PDF is available for this source yet. The extracted text is stored; the original document can only be reopened when blob-backed document storage is configured and the source was ingested as an uploaded PDF.
                        </div>
                      ) : null}

                      {detailLoadingId === source.id && !detail ? (
                        <div className="text-sm text-[var(--muted)]">Loading source details…</div>
                      ) : null}

                      {detailError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{detailError}</div> : null}

                      {detail ? (
                        <>
                          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
                            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Extracted text preview</div>
                              <pre className="mt-2 max-h-[320px] overflow-auto whitespace-pre-wrap text-xs leading-5 text-[var(--text)]">{detail.rawText || 'No extracted text stored.'}</pre>
                            </div>

                            <div className="space-y-3">
                              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Original document</div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {hasStoredDocument(detail) ? (
                                    <a
                                      href={detail.storedDocumentUrl ?? '#'}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-structure)]"
                                    >
                                      <Icon name="link" size="sm" aria-hidden />
                                      <span>Open stored PDF</span>
                                    </a>
                                  ) : null}
                                  {hasOriginalUrl(detail) ? (
                                    <a
                                      href={detail.sourceUrl ?? '#'}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-structure)]"
                                    >
                                      <Icon name="link" size="sm" aria-hidden />
                                      <span>Open source URL</span>
                                    </a>
                                  ) : null}
                                </div>
                                <div className="mt-2 text-xs text-[var(--muted)]">
                                  {detail.storedDocumentUploadedAt
                                    ? `Stored ${formatTimestamp(detail.storedDocumentUploadedAt)}${detail.storedDocumentContentType ? ` · ${detail.storedDocumentContentType}` : ''}`
                                    : 'No stored document metadata available.'}
                                </div>
                              </div>

                              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Version history</div>
                                <div className="mt-2 space-y-2">
                                  {detail.versions.map((version) => (
                                    <div key={version.id} className="rounded-lg bg-[var(--bg-structure)]/55 px-3 py-2 text-xs text-[var(--text)]">
                                      <div className="font-semibold">Version {version.version}</div>
                                      <div className="mt-1 text-[var(--muted)]">Created {formatTimestamp(version.createdAt)}</div>
                                      <div className="mt-1 text-[var(--muted)]">
                                        Confidence {String(version.extractionMetaJson?.confidence ?? '—')} · Weeks {String(version.extractionMetaJson?.weekCount ?? '—')} · Sessions {String(version.extractionMetaJson?.sessionCount ?? '—')}
                                      </div>
                                      {Array.isArray(version.extractionMetaJson?.warnings) && version.extractionMetaJson?.warnings?.length ? (
                                        <ul className="mt-2 list-disc pl-4 text-amber-700">
                                          {version.extractionMetaJson.warnings.map((warning, index) => (
                                            <li key={`${version.id}-warning-${index}`}>{warning}</li>
                                          ))}
                                        </ul>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {source.licenseText ? (
                                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                                  <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">License / notes</div>
                                  <div className="mt-2 whitespace-pre-wrap text-sm text-[var(--text)]">{source.licenseText}</div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })
          : null}
      </div>
    </section>
  );
}

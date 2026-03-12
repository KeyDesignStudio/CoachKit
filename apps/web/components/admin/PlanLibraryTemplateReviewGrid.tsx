'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type TemplateSummary = {
  id: string;
  title: string;
  reviewStatus: 'DRAFT' | 'REVIEWED' | 'PUBLISHED' | 'REJECTED';
  isPublished: boolean;
  qualityScore: number | null;
  durationWeeks: number;
  weeks: Array<{ id: string; weekIndex: number; _count: { sessions: number } }>;
};

type TemplateSession = {
  id: string;
  dayOfWeek: number;
  discipline: 'SWIM' | 'BIKE' | 'RUN' | 'STRENGTH' | 'REST';
  sessionType: string;
  title: string | null;
  durationMinutes: number | null;
  distanceKm: number | null;
  sourceConfidence: number | null;
  needsReview: boolean;
};

type TemplateDetail = {
  id: string;
  title: string;
  reviewStatus: 'DRAFT' | 'REVIEWED' | 'PUBLISHED' | 'REJECTED';
  isPublished: boolean;
  qualityScore: number | null;
  weeks: Array<{
    id: string;
    weekIndex: number;
    blockName: string | null;
    phaseTag: string | null;
    targetLoadScore: number | null;
    sessions: TemplateSession[];
  }>;
  validationRuns: Array<{
    id: string;
    score: number;
    passed: boolean;
    issuesJson: Array<{ type: 'hard' | 'soft'; code: string; message: string }>;
    createdAt: string;
  }>;
};

type PlanLibraryTemplateReviewGridProps = {
  refreshToken?: number;
};

function formatDay(day: number) {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return labels[Math.max(0, Math.min(6, day - 1))] ?? `D${day}`;
}

function formatScore(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

export function PlanLibraryTemplateReviewGrid({ refreshToken = 0 }: PlanLibraryTemplateReviewGridProps) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/plan-library/templates', { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || 'Failed to load templates.');
      const list = (payload?.data?.templates ?? []) as TemplateSummary[];
      setTemplates(list);
      if (!selectedId && list.length) setSelectedId(list[0]!.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates.');
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const loadDetail = useCallback(async (templateId: string) => {
    setStatusMessage('');
    try {
      const response = await fetch(`/api/admin/plan-library/templates/${templateId}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || 'Failed to load template detail.');
      setDetail(payload?.data?.template as TemplateDetail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load template detail.');
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates, refreshToken]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const unresolvedCount = useMemo(
    () => detail?.weeks.flatMap((week) => week.sessions).filter((session) => session.needsReview).length ?? 0,
    [detail]
  );

  async function setNeedsReview(sessionId: string, needsReview: boolean) {
    if (!detail) return;
    setSavingId(sessionId);
    setStatusMessage('');
    try {
      const response = await fetch(`/api/admin/plan-library/templates/${detail.id}/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ needsReview }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || 'Failed to update session.');
      await loadDetail(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update session.');
    } finally {
      setSavingId(null);
    }
  }

  async function validateTemplate() {
    if (!detail) return;
    setStatusMessage('');
    try {
      const response = await fetch(`/api/admin/plan-library/templates/${detail.id}/validate`, { method: 'POST' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || 'Validation failed.');
      setStatusMessage('Validation complete.');
      await loadDetail(detail.id);
      await loadTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed.');
    }
  }

  async function publishTemplate() {
    if (!detail) return;
    setStatusMessage('');
    try {
      const response = await fetch(`/api/admin/plan-library/templates/${detail.id}/publish`, { method: 'POST' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || 'Publish failed.');
      setStatusMessage('Template published. APB can now retrieve this template.');
      await loadDetail(detail.id);
      await loadTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed.');
    }
  }

  async function deleteTemplate() {
    if (!detail) return;
    if (detail.isPublished || detail.reviewStatus === 'PUBLISHED') {
      setError('Published templates cannot be deleted here.');
      return;
    }
    const confirmed =
      typeof window === 'undefined'
        ? true
        : window.confirm(`Delete "${detail.title}"? This removes the draft template and all of its review data.`);
    if (!confirmed) return;

    setDeletingTemplateId(detail.id);
    setError('');
    setStatusMessage('');
    try {
      const response = await fetch(`/api/admin/plan-library/templates/${detail.id}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || 'Delete failed.');
      const deletedTitle = payload?.data?.deleted?.title || detail.title;
      setStatusMessage(`Deleted draft template: ${deletedTitle}.`);
      setDetail(null);
      setSelectedId(null);
      await loadTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeletingTemplateId(null);
    }
  }

  return (
    <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Review Grid</div>
      <h2 className="mt-1 text-lg font-semibold">Template review and publish gate</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Spreadsheet-like week/session review. Resolve flagged sessions, run validation, then publish.
      </p>

      {error ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {statusMessage ? <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{statusMessage}</div> : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
          <div className="mb-2 text-xs font-semibold text-[var(--muted)]">Templates</div>
          {loading ? <div className="text-xs text-[var(--muted)]">Loading…</div> : null}
          {!loading && templates.length === 0 ? <div className="text-xs text-[var(--muted)]">No templates yet.</div> : null}
          <div className="space-y-2">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => setSelectedId(template.id)}
                className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                  selectedId === template.id
                    ? 'border-slate-900 bg-slate-100'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'
                }`}
              >
                <div className="font-medium">{template.title}</div>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  {template.reviewStatus} · {template.weeks.length} weeks · quality {formatScore(template.qualityScore)}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
          {!detail ? <div className="text-xs text-[var(--muted)]">Select a template.</div> : null}
          {detail ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-base font-semibold">{detail.title}</div>
                  <div className="text-xs text-[var(--muted)]">
                    {detail.reviewStatus} · quality {formatScore(detail.qualityScore)} · unresolved {unresolvedCount}
                  </div>
                </div>
                <div className="flex gap-2">
                  {!detail.isPublished && detail.reviewStatus !== 'PUBLISHED' ? (
                    <button
                      type="button"
                      onClick={deleteTemplate}
                      disabled={deletingTemplateId === detail.id}
                      className="rounded-full border border-rose-200 px-3 py-2 text-xs text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deletingTemplateId === detail.id ? 'Deleting…' : 'Delete draft'}
                    </button>
                  ) : null}
                  <button type="button" onClick={validateTemplate} className="rounded-full border border-[var(--border-subtle)] px-3 py-2 text-xs">
                    Validate
                  </button>
                  <button
                    type="button"
                    onClick={publishTemplate}
                    className="rounded-full bg-[var(--text)] px-3 py-2 text-xs text-[var(--bg-page)]"
                  >
                    Publish
                  </button>
                </div>
              </div>

              <div className="mt-3 overflow-auto rounded-xl border border-[var(--border-subtle)]">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-[var(--bg-surface)]">
                    <tr>
                      <th className="px-2 py-2">Week</th>
                      <th className="px-2 py-2">Day</th>
                      <th className="px-2 py-2">Discipline</th>
                      <th className="px-2 py-2">Session</th>
                      <th className="px-2 py-2">Duration</th>
                      <th className="px-2 py-2">Distance</th>
                      <th className="px-2 py-2">Confidence</th>
                      <th className="px-2 py-2">Needs Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.weeks.flatMap((week) =>
                      week.sessions.map((session) => (
                        <tr key={session.id} className={session.needsReview ? 'bg-amber-50' : ''}>
                          <td className="px-2 py-2">{week.weekIndex}</td>
                          <td className="px-2 py-2">{formatDay(session.dayOfWeek)}</td>
                          <td className="px-2 py-2">{session.discipline}</td>
                          <td className="px-2 py-2">{session.title || session.sessionType}</td>
                          <td className="px-2 py-2">{session.durationMinutes ?? '—'} min</td>
                          <td className="px-2 py-2">{session.distanceKm ?? '—'} km</td>
                          <td className="px-2 py-2">{formatScore(session.sourceConfidence)}</td>
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              disabled={savingId === session.id}
                              onClick={() => void setNeedsReview(session.id, !session.needsReview)}
                              className="rounded-full border border-[var(--border-subtle)] px-2 py-1 text-xs"
                            >
                              {session.needsReview ? 'Mark resolved' : 'Flag'}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                <div className="text-xs font-semibold">Validation panel</div>
                {detail.validationRuns.length === 0 ? (
                  <div className="mt-1 text-xs text-[var(--muted)]">No validation runs yet.</div>
                ) : (
                  <div className="mt-2 space-y-2">
                    {detail.validationRuns.slice(0, 3).map((run) => (
                      <div key={run.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2 text-xs">
                        <div>
                          Score {formatScore(run.score)} · {run.passed ? 'PASS' : 'FAIL'}
                        </div>
                        {Array.isArray(run.issuesJson) && run.issuesJson.length ? (
                          <ul className="mt-1 list-disc pl-4 text-[var(--muted)]">
                            {run.issuesJson.map((issue, index) => (
                              <li key={`${run.id}-${index}`}>
                                {issue.type.toUpperCase()}: {issue.message}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

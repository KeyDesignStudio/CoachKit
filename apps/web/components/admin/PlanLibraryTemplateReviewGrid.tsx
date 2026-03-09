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
  discipline: 'SWIM' | 'SWIM_OPEN_WATER' | 'BIKE' | 'RUN' | 'BRICK' | 'STRENGTH' | 'REST';
  sessionType: string;
  title: string | null;
  durationMinutes: number | null;
  distanceKm: number | null;
  intensityType: string | null;
  intensityTargetJson: unknown | null;
  recipeV2Json: unknown | null;
  notes: string | null;
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

function dayLabel(day: number) {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return labels[Math.max(0, Math.min(6, day - 1))] ?? `D${day}`;
}

function disciplineLabel(value: TemplateSession['discipline']) {
  switch (value) {
    case 'SWIM_OPEN_WATER':
      return 'SWIM OPEN WATER';
    default:
      return value;
  }
}

function formatScore(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function prettyJson(value: unknown) {
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJsonDraft(text: string, label: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

function hasSessionMeta(session: TemplateSession) {
  return Boolean(session.sessionType || session.intensityType || session.notes || session.intensityTargetJson || session.recipeV2Json);
}

export function PlanLibraryTemplateReviewGrid({ refreshToken = 0 }: PlanLibraryTemplateReviewGridProps) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    dayOfWeek: number;
    discipline: TemplateSession['discipline'];
    sessionType: string;
    title: string;
    durationMinutes: string;
    distanceKm: string;
    intensityType: string;
    intensityTargetJsonText: string;
    recipeV2JsonText: string;
    notes: string;
  } | null>(null);

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

  function startEditing(session: TemplateSession) {
    setEditingSessionId(session.id);
    setEditDraft({
      dayOfWeek: session.dayOfWeek,
      discipline: session.discipline,
      sessionType: session.sessionType ?? '',
      title: session.title ?? '',
      durationMinutes: session.durationMinutes == null ? '' : String(session.durationMinutes),
      distanceKm: session.distanceKm == null ? '' : String(session.distanceKm),
      intensityType: session.intensityType ?? '',
      intensityTargetJsonText: prettyJson(session.intensityTargetJson),
      recipeV2JsonText: prettyJson(session.recipeV2Json),
      notes: session.notes ?? '',
    });
  }

  function cancelEditing() {
    setEditingSessionId(null);
    setEditDraft(null);
  }

  async function saveSessionEdit(sessionId: string) {
    if (!detail || !editDraft) return;
    setSavingId(sessionId);
    setError('');
    try {
      const durationValue = editDraft.durationMinutes.trim();
      const distanceValue = editDraft.distanceKm.trim();
      const intensityTargetJson = parseJsonDraft(editDraft.intensityTargetJsonText, 'Intensity target');
      const recipeV2Json = parseJsonDraft(editDraft.recipeV2JsonText, 'Recipe');
      const response = await fetch(`/api/admin/plan-library/templates/${detail.id}/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dayOfWeek: Math.max(1, Math.min(7, Number(editDraft.dayOfWeek) || 1)),
          discipline: editDraft.discipline,
          sessionType: editDraft.sessionType.trim() || 'endurance',
          title: editDraft.title.trim() || null,
          durationMinutes: durationValue ? Number(durationValue) : null,
          distanceKm: distanceValue ? Number(distanceValue) : null,
          intensityType: editDraft.intensityType.trim() || null,
          intensityTargetJson,
          recipeV2Json,
          notes: editDraft.notes.trim() || null,
          needsReview: false,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || 'Failed to save session.');
      setStatusMessage('Session updated.');
      cancelEditing();
      await loadDetail(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save session.');
    } finally {
      setSavingId(null);
    }
  }

  async function validateTemplate() {
    if (!detail) return;
    setError('');
    try {
      const response = await fetch(`/api/admin/plan-library/templates/${detail.id}/validate`, { method: 'POST' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || 'Validation failed.');
      const run = payload?.data?.validationRun as
        | { score?: number; passed?: boolean; issuesJson?: Array<{ type: 'hard' | 'soft'; code: string; message: string }> }
        | undefined;
      const issueCount = Array.isArray(run?.issuesJson) ? run!.issuesJson.length : 0;
      setStatusMessage(
        `Validation complete: ${run?.passed ? 'PASS' : 'FAIL'} · score ${formatScore(run?.score ?? null)} · ${issueCount} issue${
          issueCount === 1 ? '' : 's'
        }.`
      );
      await loadDetail(detail.id);
      await loadTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed.');
    }
  }

  async function publishTemplate() {
    if (!detail) return;
    setError('');
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
                      <th className="px-2 py-2">Edit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.weeks.flatMap((week) => {
                      const weekRows: JSX.Element[] = [
                        <tr key={`${week.id}-header`} className="bg-[var(--bg-surface)]">
                          <td colSpan={9} className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-3 text-[11px]">
                              <span className="font-semibold">Week {week.weekIndex}</span>
                              <span className="text-[var(--muted)]">Block {week.blockName || '—'}</span>
                              <span className="text-[var(--muted)]">Phase {week.phaseTag || '—'}</span>
                              <span className="text-[var(--muted)]">Target load {week.targetLoadScore ?? '—'}</span>
                              <span className="text-[var(--muted)]">{week.sessions.length} sessions</span>
                            </div>
                          </td>
                        </tr>,
                      ];

                      week.sessions.forEach((session) => {
                        const isEditing = editingSessionId === session.id && !!editDraft;
                        weekRows.push(
                          <tr key={session.id} className={session.needsReview ? 'bg-amber-50' : ''}>
                            <td className="px-2 py-2">{week.weekIndex}</td>
                            <td className="px-2 py-2">
                              {isEditing ? (
                                <select
                                  value={editDraft.dayOfWeek}
                                  onChange={(event) =>
                                    setEditDraft((current) => (current ? { ...current, dayOfWeek: Number(event.target.value) } : current))
                                  }
                                  className="w-16 rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] px-1 py-1"
                                >
                                  {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                                    <option key={day} value={day}>
                                      {dayLabel(day)}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                formatDay(session.dayOfWeek)
                              )}
                            </td>
                            <td className="px-2 py-2">
                              {isEditing ? (
                                <select
                                  value={editDraft.discipline}
                                  onChange={(event) =>
                                    setEditDraft((current) =>
                                      current ? { ...current, discipline: event.target.value as TemplateSession['discipline'] } : current
                                    )
                                  }
                                  className="min-w-[130px] rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] px-1 py-1"
                                >
                                  {['SWIM', 'SWIM_OPEN_WATER', 'BIKE', 'RUN', 'BRICK', 'STRENGTH', 'REST'].map((value) => (
                                    <option key={value} value={value}>
                                      {disciplineLabel(value as TemplateSession['discipline'])}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                session.discipline
                              )}
                            </td>
                            <td className="px-2 py-2">
                              {isEditing ? (
                                <input
                                  value={editDraft.title}
                                  onChange={(event) =>
                                    setEditDraft((current) => (current ? { ...current, title: event.target.value } : current))
                                  }
                                  className="w-full min-w-[280px] rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1"
                                  placeholder="Session title"
                                />
                              ) : (
                                session.title || session.sessionType
                              )}
                            </td>
                            <td className="px-2 py-2">
                              {isEditing ? (
                                <input
                                  value={editDraft.durationMinutes}
                                  onChange={(event) =>
                                    setEditDraft((current) => (current ? { ...current, durationMinutes: event.target.value } : current))
                                  }
                                  className="w-20 rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1"
                                  placeholder="min"
                                  inputMode="decimal"
                                />
                              ) : (
                                `${session.durationMinutes ?? '—'} min`
                              )}
                            </td>
                            <td className="px-2 py-2">
                              {isEditing ? (
                                <input
                                  value={editDraft.distanceKm}
                                  onChange={(event) =>
                                    setEditDraft((current) => (current ? { ...current, distanceKm: event.target.value } : current))
                                  }
                                  className="w-20 rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1"
                                  placeholder="km"
                                  inputMode="decimal"
                                />
                              ) : (
                                `${session.distanceKm ?? '—'} km`
                              )}
                            </td>
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
                            <td className="px-2 py-2">
                              {isEditing ? (
                                <div className="flex gap-1">
                                  <button
                                    type="button"
                                    disabled={savingId === session.id}
                                    onClick={() => void saveSessionEdit(session.id)}
                                    className="rounded-full border border-[var(--border-subtle)] px-2 py-1 text-xs"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    disabled={savingId === session.id}
                                    onClick={cancelEditing}
                                    className="rounded-full border border-[var(--border-subtle)] px-2 py-1 text-xs"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  disabled={savingId === session.id}
                                  onClick={() => startEditing(session)}
                                  className="rounded-full border border-[var(--border-subtle)] px-2 py-1 text-xs"
                                >
                                  Edit
                                </button>
                              )}
                            </td>
                          </tr>
                        );

                        if (isEditing) {
                          weekRows.push(
                            <tr key={`${session.id}-detail`} className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                              <td colSpan={9} className="px-3 py-3">
                                <div className="grid gap-3 lg:grid-cols-2">
                                  <label className="space-y-1">
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Session type</span>
                                    <input
                                      value={editDraft.sessionType}
                                      onChange={(event) =>
                                        setEditDraft((current) => (current ? { ...current, sessionType: event.target.value } : current))
                                      }
                                      className="w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1"
                                      placeholder="endurance / interval / technique"
                                    />
                                  </label>
                                  <label className="space-y-1">
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Intensity type</span>
                                    <input
                                      value={editDraft.intensityType}
                                      onChange={(event) =>
                                        setEditDraft((current) => (current ? { ...current, intensityType: event.target.value } : current))
                                      }
                                      className="w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1"
                                      placeholder="pace / power / PE"
                                    />
                                  </label>
                                  <label className="space-y-1 lg:col-span-2">
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Notes</span>
                                    <textarea
                                      value={editDraft.notes}
                                      onChange={(event) =>
                                        setEditDraft((current) => (current ? { ...current, notes: event.target.value } : current))
                                      }
                                      className="min-h-[90px] w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-2"
                                      placeholder="Imported session notes"
                                    />
                                  </label>
                                  <label className="space-y-1">
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Intensity target JSON</span>
                                    <textarea
                                      value={editDraft.intensityTargetJsonText}
                                      onChange={(event) =>
                                        setEditDraft((current) =>
                                          current ? { ...current, intensityTargetJsonText: event.target.value } : current
                                        )
                                      }
                                      className="min-h-[140px] w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-2 font-mono text-[11px]"
                                      placeholder='{"target":"8km","intervals":["6-7"]}'
                                    />
                                  </label>
                                  <label className="space-y-1">
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Recipe JSON</span>
                                    <textarea
                                      value={editDraft.recipeV2JsonText}
                                      onChange={(event) =>
                                        setEditDraft((current) =>
                                          current ? { ...current, recipeV2JsonText: event.target.value } : current
                                        )
                                      }
                                      className="min-h-[140px] w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-2 font-mono text-[11px]"
                                      placeholder='{"raw":"Run - 6-7 x 1km vigorous"}'
                                    />
                                  </label>
                                </div>
                              </td>
                            </tr>
                          );
                        } else if (hasSessionMeta(session)) {
                          weekRows.push(
                            <tr key={`${session.id}-detail`} className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                              <td colSpan={9} className="px-3 py-3">
                                <div className="flex flex-wrap gap-2 text-[11px]">
                                  <span className="rounded-full border border-[var(--border-subtle)] px-2 py-1">
                                    Type {session.sessionType || '—'}
                                  </span>
                                  <span className="rounded-full border border-[var(--border-subtle)] px-2 py-1">
                                    Intensity {session.intensityType || '—'}
                                  </span>
                                </div>
                                {session.notes ? (
                                  <div className="mt-2">
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Notes</div>
                                    <div className="mt-1 whitespace-pre-wrap text-[12px] text-[var(--muted)]">{session.notes}</div>
                                  </div>
                                ) : null}
                                {session.intensityTargetJson ? (
                                  <div className="mt-2">
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                                      Intensity target JSON
                                    </div>
                                    <pre className="mt-1 overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2 font-mono text-[11px]">
                                      {prettyJson(session.intensityTargetJson)}
                                    </pre>
                                  </div>
                                ) : null}
                                {session.recipeV2Json ? (
                                  <div className="mt-2">
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Recipe JSON</div>
                                    <pre className="mt-1 overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2 font-mono text-[11px]">
                                      {prettyJson(session.recipeV2Json)}
                                    </pre>
                                  </div>
                                ) : null}
                              </td>
                            </tr>
                          );
                        }
                      });

                      return weekRows;
                    })}
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

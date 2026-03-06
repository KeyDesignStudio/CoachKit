'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Icon } from '@/components/ui/Icon';

const FEEDBACK_LABELS: Record<string, string> = {
  PROMOTED: 'Promoted',
  UPDATED: 'Updated',
  GOOD_FIT: 'Good fit',
  EDITED: 'Edited',
  TOO_EASY: 'Too easy',
  TOO_HARD: 'Too hard',
  ARCHIVED: 'Archived',
};

type WorkoutExemplarSummary = {
  id: string;
  coachId: string;
  coachEmail: string | null;
  athleteId: string | null;
  athleteEmail: string | null;
  sourceType: string;
  discipline: string;
  sessionType: string;
  title: string | null;
  durationMinutes: number | null;
  distanceKm: number | null;
  objective: string | null;
  notes: string | null;
  tags: string[];
  usageCount: number;
  positiveFeedbackCount: number;
  editFeedbackCount: number;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  feedback: Array<{
    id: string;
    feedbackType: string;
    note: string | null;
    createdAt: string;
  }>;
};

function formatTimestamp(value: string | null) {
  if (!value) return '—';
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

export function WorkoutExemplarCatalog() {
  const [exemplars, setExemplars] = useState<WorkoutExemplarSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadExemplars = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/ai-plan-builder/workout-exemplars', { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Failed to load workout exemplars.');
      }
      setExemplars((payload?.data?.exemplars ?? []) as WorkoutExemplarSummary[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workout exemplars.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadExemplars();
  }, [loadExemplars]);

  const activeCount = useMemo(() => exemplars.filter((row) => row.isActive).length, [exemplars]);

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Workout Exemplars</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {exemplars.length} total exemplars · {activeCount} active. This is the reusable coach feedback library APB can draw from for session-detail generation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadExemplars()}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-structure)]"
        >
          <Icon name="refresh" size="sm" aria-hidden />
          <span>Refresh list</span>
        </button>
      </div>

      {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      <div className="mt-4 space-y-3">
        {loading ? <div className="rounded-xl border border-dashed border-[var(--border-subtle)] px-4 py-8 text-sm text-[var(--muted)]">Loading workout exemplars…</div> : null}
        {!loading && exemplars.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border-subtle)] px-4 py-8 text-sm text-[var(--muted)]">
            No exemplars have been promoted yet.
          </div>
        ) : null}

        {!loading
          ? exemplars.map((exemplar) => (
              <article key={exemplar.id} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-[var(--text)]">{exemplar.title?.trim() || `${formatEnum(exemplar.discipline)} ${formatEnum(exemplar.sessionType)}`}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${exemplar.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'}`}>
                        {exemplar.isActive ? 'Active' : 'Archived'}
                      </span>
                      <span className="rounded-full bg-[var(--bg-structure)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                        {formatEnum(exemplar.sourceType)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-[var(--muted)]">
                      Coach {exemplar.coachEmail ?? exemplar.coachId} · Athlete {exemplar.athleteEmail ?? exemplar.athleteId ?? '—'} · Updated {formatTimestamp(exemplar.updatedAt)}
                    </div>
                  </div>
                  <div className="grid min-w-[220px] gap-2 text-xs text-[var(--muted)] sm:grid-cols-2">
                    <div>Usage {exemplar.usageCount}</div>
                    <div>Positive feedback {exemplar.positiveFeedbackCount}</div>
                    <div>Edit flags {exemplar.editFeedbackCount}</div>
                    <div>Last used {formatTimestamp(exemplar.lastUsedAt)}</div>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-4">
                  <div className="rounded-xl bg-[var(--bg-structure)]/55 px-3 py-2 text-sm text-[var(--text)]">{formatEnum(exemplar.discipline)}</div>
                  <div className="rounded-xl bg-[var(--bg-structure)]/55 px-3 py-2 text-sm text-[var(--text)]">{formatEnum(exemplar.sessionType)}</div>
                  <div className="rounded-xl bg-[var(--bg-structure)]/55 px-3 py-2 text-sm text-[var(--text)]">{exemplar.durationMinutes != null ? `${exemplar.durationMinutes} min` : 'Duration —'}</div>
                  <div className="rounded-xl bg-[var(--bg-structure)]/55 px-3 py-2 text-sm text-[var(--text)]">{exemplar.distanceKm != null ? `${exemplar.distanceKm} km` : 'Distance —'}</div>
                </div>

                {exemplar.objective ? <div className="mt-3 text-sm text-[var(--text)]"><span className="font-medium">Objective:</span> {exemplar.objective}</div> : null}
                {exemplar.notes ? <div className="mt-2 whitespace-pre-wrap text-sm text-[var(--muted)]">{exemplar.notes}</div> : null}

                {exemplar.feedback.length ? (
                  <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Latest feedback</div>
                    <div className="mt-2 space-y-2">
                      {exemplar.feedback.map((feedback) => (
                        <div key={feedback.id} className="rounded-lg bg-[var(--bg-structure)]/55 px-3 py-2 text-xs text-[var(--text)]">
                          <div className="font-medium">{FEEDBACK_LABELS[feedback.feedbackType] ?? formatEnum(feedback.feedbackType)}</div>
                          <div className="mt-1 text-[var(--muted)]">{formatTimestamp(feedback.createdAt)}</div>
                          {feedback.note ? <div className="mt-1 whitespace-pre-wrap text-[var(--text)]">{feedback.note}</div> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            ))
          : null}
      </div>
    </section>
  );
}

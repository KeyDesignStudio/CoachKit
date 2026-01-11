'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatDisplay } from '@/lib/client-date';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { Icon } from '@/components/ui/Icon';

type CommentRecord = {
  id: string;
  body: string;
  createdAt: string;
  author: {
    id: string;
    name: string | null;
    role: 'COACH' | 'ATHLETE';
  };
};

type ReviewItem = {
  id: string;
  title: string;
  date: string;
  discipline: string;
  plannedStartTimeLocal: string | null;
  plannedDurationMinutes: number | null;
  plannedDistanceKm: number | null;
  notes: string | null;
  status: string;
  latestCompletedActivity: {
    id: string;
    durationMinutes: number | null;
    distanceKm: number | null;
    rpe: number | null;
    painFlag: boolean;
    startTime: string;
  } | null;
  athlete: {
    id: string;
    name: string | null;
  } | null;
  comments: CommentRecord[];
};

type ReviewDrawerProps = {
  item: ReviewItem | null;
  onClose: () => void;
  onMarkReviewed: (id: string) => Promise<void>;
};

export function ReviewDrawer({ item, onClose, onMarkReviewed }: ReviewDrawerProps) {
  const [marking, setMarking] = useState(false);

  const handleMarkReviewed = useCallback(async () => {
    if (!item) return;
    setMarking(true);
    try {
      await onMarkReviewed(item.id);
      onClose();
    } catch (err) {
      console.error('Failed to mark reviewed:', err);
    } finally {
      setMarking(false);
    }
  }, [item, onMarkReviewed, onClose]);

  if (!item) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <aside className="fixed right-0 top-0 z-50 h-full w-full max-w-2xl overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="flex flex-col gap-6 p-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                {(() => {
                  const theme = getDisciplineTheme(item.discipline);
                  return <Icon name={theme.iconName} size="md" className={theme.textClass} />;
                })()}
                <h2 className="text-2xl font-semibold text-[var(--text)]">{item.title}</h2>
                <Badge>{item.discipline}</Badge>
                <Badge>{item.status.replace(/_/g, ' ')}</Badge>
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {formatDisplay(item.date)} · {item.plannedStartTimeLocal ?? 'n/a'}
              </p>
              <p className="text-sm text-[var(--muted)]">
                Athlete: {item.athlete?.name ?? 'Unknown'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2 text-sm hover:bg-[var(--bg-surface)] transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Planned Details */}
          <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Planned</h3>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Duration</dt>
                <dd className="text-lg text-[var(--text)]">
                  {item.plannedDurationMinutes ?? '—'} <span className="text-sm">min</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Distance</dt>
                <dd className="text-lg text-[var(--text)]">
                  {item.plannedDistanceKm ?? '—'} <span className="text-sm">km</span>
                </dd>
              </div>
            </dl>
          </section>

          {/* Coach Advice */}
          {item.notes && (
            <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                <Icon name="coachAdvice" size="sm" className="text-amber-600" />
                Coach Advice
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--text)]">{item.notes}</p>
            </section>
          )}

          {/* Completed Activity */}
          {item.latestCompletedActivity && (
            <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Completed</h3>
              {item.latestCompletedActivity.painFlag && (
                <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20">
                  <Icon name="painFlag" size="sm" className="text-rose-500 shrink-0" />
                  <p className="text-sm text-rose-600 font-medium">Athlete reported pain or discomfort</p>
                </div>
              )}
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Duration</dt>
                  <dd className="text-lg text-[var(--text)]">
                    {item.latestCompletedActivity.durationMinutes ?? '—'} <span className="text-sm">min</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Distance</dt>
                  <dd className="text-lg text-[var(--text)]">
                    {item.latestCompletedActivity.distanceKm ?? '—'} <span className="text-sm">km</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">RPE</dt>
                  <dd className="text-lg text-[var(--text)]">{item.latestCompletedActivity.rpe ?? '—'}</dd>
                </div>
              </dl>
            </section>
          )}

          {/* Comments */}
          {item.comments.length > 0 && (
            <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                <Icon name="athleteComment" size="sm" className="text-blue-600" />
                Comments
              </h3>
              <ul className="mt-3 flex flex-col gap-3">
                {item.comments.map((comment) => (
                  <li
                    key={comment.id}
                    className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
                  >
                    <p className="text-sm text-[var(--text)]">{comment.body}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {comment.author.name ?? comment.author.role} · {new Date(comment.createdAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <Button type="button" onClick={handleMarkReviewed} disabled={marking} className="flex-1">
              {marking ? 'Marking...' : 'Mark Reviewed'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}

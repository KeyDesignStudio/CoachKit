'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useUser } from '@/components/user-context';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { formatDisplay } from '@/lib/client-date';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { Icon } from '@/components/ui/Icon';

type CompletedActivity = {
  id: string;
  durationMinutes: number;
  distanceKm: number | null;
  rpe: number | null;
  notes: string | null;
  painFlag: boolean;
  source: string;
};

type CalendarItem = {
  id: string;
  title: string;
  date: string;
  plannedStartTimeLocal: string | null;
  discipline: string;
  status: string;
  notes?: string | null;
  template?: { id: string; title: string } | null;
  groupSession?: { id: string; title: string } | null;
  completedActivities?: CompletedActivity[];
};

export default function AthleteWorkoutDetailPage({ params }: { params: { id: string } }) {
  const workoutId = params.id;
  const { user } = useUser();
  const { request } = useApi();
  const [item, setItem] = useState<CalendarItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [completionForm, setCompletionForm] = useState({
    durationMinutes: 60,
    distanceKm: '',
    rpe: 6,
    notes: '',
    painFlag: false,
  });
  const [commentDraft, setCommentDraft] = useState('');

  const loadData = useCallback(async () => {
    if (user.role !== 'ATHLETE' || !user.userId) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { item: detail } = await request<{ item: CalendarItem }>(
        `/api/athlete/calendar-items/${workoutId}`
      );

      setItem(detail);

      // Load completed activity data into form if available
      const completed = detail.completedActivities?.[0];
      if (completed) {
        setCompletionForm({
          durationMinutes: completed.durationMinutes,
          distanceKm: completed.distanceKm?.toString() ?? '',
          rpe: completed.rpe ?? 6,
          notes: completed.notes ?? '',
          painFlag: false, // Don't show pain flag in form, just for initial state
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workout.');
    } finally {
      setLoading(false);
    }
  }, [request, user.role, user.userId, workoutId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const submitCompletion = async (event: FormEvent) => {
    event.preventDefault();

    try {
      await request(`/api/athlete/calendar-items/${workoutId}/complete`, {
        method: 'POST',
        data: {
          durationMinutes: Number(completionForm.durationMinutes),
          distanceKm: completionForm.distanceKm ? Number(completionForm.distanceKm) : undefined,
          rpe: completionForm.rpe ? Number(completionForm.rpe) : undefined,
          notes: completionForm.notes || undefined,
          painFlag: completionForm.painFlag,
          commentBody: commentDraft.trim() ? commentDraft.trim() : undefined,
        },
      });
      setCommentDraft('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete workout.');
    }
  };

  const skipWorkout = async () => {
    try {
      const payload = commentDraft.trim() ? { commentBody: commentDraft.trim() } : undefined;
      await request(`/api/athlete/calendar-items/${workoutId}/skip`, {
        method: 'POST',
        data: payload,
      });
      setCommentDraft('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to skip workout.');
    }
  };

  if (user.role !== 'ATHLETE') {
    return <p className="text-[var(--muted)]">Switch to an athlete identity to open workouts.</p>;
  }

  return (
    <section className="flex flex-col gap-4">
      {error ? <p className="text-sm text-rose-500">{error}</p> : null}
      {loading ? <p className="text-sm text-[var(--muted)]">Loading workout...</p> : null}
      {item ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left column: Coach context (5/12) */}
          <div className="lg:col-span-5 space-y-4">
            {/* Session header card */}
            <Card className="rounded-3xl">
              <div className="flex items-center gap-2">
                {(() => {
                  const theme = getDisciplineTheme(item.discipline);
                  return <Icon name={theme.iconName} size="md" className={theme.textClass} />;
                })()}
                <h1 className="text-xl font-semibold text-[var(--text)] truncate">{item.title}</h1>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
                <span>{formatDisplay(item.date)}</span>
                <span>·</span>
                <span>{item.plannedStartTimeLocal ?? 'Anytime'}</span>
                <Badge className="ml-1">
                  {item.status.replace(/_/g, ' ')}
                </Badge>
                <Badge>{item.discipline}</Badge>
              </div>
              {item.template ? (
                <p className="mt-1 text-xs text-[var(--muted)]">Template: {item.template.title}</p>
              ) : null}
              {item.groupSession ? (
                <p className="mt-1 text-xs text-[var(--muted)]">Group: {item.groupSession.title}</p>
              ) : null}
            </Card>

            {/* Coach advice card (only if present) */}
            {item.notes ? (
              <Card className="rounded-3xl">
                <div className="flex items-start gap-2">
                  <Icon name="coachAdvice" size="sm" className="text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-amber-700">Coach advice</p>
                    <p className="mt-1 text-sm text-[var(--text)]">{item.notes}</p>
                  </div>
                </div>
              </Card>
            ) : null}
          </div>

          {/* Right column: Athlete log (7/12) */}
          <div className="lg:col-span-7">
            {item.status === 'PLANNED' ? (
              <Card className="rounded-3xl">
                <form id="completion-form" onSubmit={submitCompletion} className="flex flex-col h-full">
                  <div className="space-y-3">
                    <div>
                      <h2 className="text-lg font-semibold">Athlete log</h2>
                      <p className="text-xs text-[var(--muted)]">Log your effort below</p>
                    </div>

                    {/* Compact metrics row */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--muted)]">
                        Duration (min)
                        <Input
                          type="number"
                          value={completionForm.durationMinutes}
                          onChange={(event) =>
                            setCompletionForm({ ...completionForm, durationMinutes: Number(event.target.value) })
                          }
                          min={1}
                          required
                          className="text-sm min-h-[44px]"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--muted)]">
                        Distance (km)
                        <Input
                          type="number"
                          value={completionForm.distanceKm}
                          onChange={(event) => setCompletionForm({ ...completionForm, distanceKm: event.target.value })}
                          min={0}
                          step="0.1"
                          className="text-sm min-h-[44px]"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--muted)]">
                        RPE (1-10)
                        <Input
                          type="number"
                          value={completionForm.rpe}
                          min={1}
                          max={10}
                          onChange={(event) => setCompletionForm({ ...completionForm, rpe: Number(event.target.value) })}
                          className="text-sm min-h-[44px]"
                        />
                      </label>
                    </div>

                    <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--muted)]">
                      Athlete notes to Self
                      <Textarea
                        value={completionForm.notes}
                        onChange={(event) => setCompletionForm({ ...completionForm, notes: event.target.value })}
                        rows={2}
                        className="text-sm"
                        placeholder="Private notes for yourself"
                      />
                    </label>

                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={completionForm.painFlag}
                        onChange={(event) => setCompletionForm({ ...completionForm, painFlag: event.target.checked })}
                        className="w-4 h-4 rounded border-white/30 text-rose-500 focus:ring-2 focus:ring-rose-500/50"
                      />
                      <span className="text-[var(--text)]">Felt pain or discomfort during this session</span>
                    </label>

                    <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--muted)]">
                      Athlete notes to Coach
                      <Textarea
                        rows={2}
                        placeholder="Optional message to your coach"
                        value={commentDraft}
                        onChange={(event) => setCommentDraft(event.target.value)}
                        className="text-sm"
                      />
                      <p className="text-xs text-[var(--muted)] mt-1">Autosaves when you complete or skip</p>
                    </label>
                  </div>

                  {/* Action buttons at bottom */}
                  <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-white/20">
                    <Button type="button" variant="ghost" size="sm" onClick={skipWorkout} className="min-h-[44px]">
                      Skip
                    </Button>
                    <Button type="submit" size="sm" className="min-h-[44px]">
                      Complete
                    </Button>
                  </div>
                </form>
              </Card>
            ) : null}

            {/* Show completed activity data if workout is already completed */}
            {item.status !== 'PLANNED' && item.completedActivities?.[0] ? (
              <Card className="rounded-3xl">
                <h2 className="text-lg font-semibold">Athlete log</h2>
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-xs font-medium text-[var(--muted)]">Duration (min)</p>
                      <p className="text-sm mt-1">{item.completedActivities[0].durationMinutes}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-[var(--muted)]">Distance (km)</p>
                      <p className="text-sm mt-1">{item.completedActivities[0].distanceKm ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-[var(--muted)]">RPE (1-10)</p>
                      <p className="text-sm mt-1">{item.completedActivities[0].rpe ?? '—'}</p>
                    </div>
                  </div>
                  {item.completedActivities[0].painFlag ? (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20">
                      <Icon name="warning" size="sm" className="text-rose-500 shrink-0" />
                      <p className="text-sm text-rose-600">Athlete reported pain or discomfort</p>
                    </div>
                  ) : null}
                  {item.completedActivities[0].notes ? (
                    <div>
                      <p className="text-xs font-medium text-[var(--muted)]">Athlete notes to Self</p>
                      <p className="text-sm mt-1 whitespace-pre-wrap">{item.completedActivities[0].notes}</p>
                    </div>
                  ) : null}
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

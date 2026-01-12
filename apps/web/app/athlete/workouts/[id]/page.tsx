'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { formatDisplay } from '@/lib/client-date';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { Icon } from '@/components/ui/Icon';
import { getSessionStatusIndicator } from '@/components/calendar/getSessionStatusIndicator';
import { formatTimeInTimezone } from '@/lib/formatTimeInTimezone';
import { SkeletonAthleteWorkoutDetail } from '@/components/workouts/SkeletonAthleteWorkoutDetail';

type CompletedActivity = {
  id: string;
  durationMinutes: number;
  distanceKm: number | null;
  rpe: number | null;
  notes: string | null;
  painFlag: boolean;
  source: string;
  confirmedAt?: string | null;
  metricsJson?: any;
  effectiveStartTimeUtc?: string;
};

type CalendarItem = {
  id: string;
  title: string;
  date: string;
  plannedStartTimeLocal: string | null;
  discipline: string;
  status: string;
  workoutDetail?: string | null;
  template?: { id: string; title: string } | null;
  groupSession?: { id: string; title: string } | null;
  comments?: Array<{ id: string; authorId: string; body: string; createdAt: string }>;
  completedActivities?: CompletedActivity[];
};

export default function AthleteWorkoutDetailPage({ params }: { params: { id: string } }) {
  const workoutId = params.id;
  const router = useRouter();
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();
  const [item, setItem] = useState<CalendarItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [completionForm, setCompletionForm] = useState<{ durationMinutes: number; distanceKm: string; rpe: number | ''; notes: string; painFlag: boolean }>({
    durationMinutes: 60,
    distanceKm: '',
    rpe: '',
    notes: '',
    painFlag: false,
  });
  const [commentDraft, setCommentDraft] = useState('');
  const perfFrameMarked = useRef(false);
  const perfDataMarked = useRef(false);
  const isDraftSynced = item?.status === 'COMPLETED_SYNCED_DRAFT';
  const latestCompletion = item?.completedActivities?.[0];
  const isStravaCompletion = latestCompletion?.source === 'STRAVA';
  const isDraftStrava = Boolean(isDraftSynced || (isStravaCompletion && !latestCompletion?.confirmedAt));
  const showStravaBadge = Boolean(isDraftStrava || isStravaCompletion);
  const strava = (latestCompletion?.metricsJson?.strava ?? {}) as Record<string, any>;

  const tz = user?.timezone || 'Australia/Brisbane';

  const formatZonedTime = (isoString: string | undefined) => formatTimeInTimezone(isoString, tz);

  const formatZonedDateTime = (isoString: string | undefined) => {
    if (!isoString) return null;
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  };

  const formatSpeedKmh = (mps: number | undefined) => {
    if (!mps || !Number.isFinite(mps) || mps <= 0) return null;
    return `${(mps * 3.6).toFixed(1)} km/h`;
  };

  const formatPace = (secPerKm: number | undefined) => {
    if (!secPerKm || !Number.isFinite(secPerKm) || secPerKm <= 0) return null;
    const minutes = Math.floor(secPerKm / 60);
    const seconds = Math.round(secPerKm % 60);
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    return `${mm}:${ss} /km`;
  };

  const stravaType = (strava.type ?? strava.sport_type ?? strava.activityType) as string | undefined;
  const stravaName = (strava.name ?? strava.activityName) as string | undefined;
  const stravaStartUtc = latestCompletion?.effectiveStartTimeUtc;
  const stravaAvgSpeedMps = (strava.avgSpeedMps ?? strava.average_speed) as number | undefined;
  const stravaAvgPaceSecPerKm = (strava.avgPaceSecPerKm ?? strava.avg_pace_sec_per_km) as number | undefined;
  const stravaAvgHr = (strava.avgHr ?? strava.average_heartrate) as number | undefined;
  const stravaMaxHr = (strava.maxHr ?? strava.max_heartrate) as number | undefined;

  const actualTimeLabel = formatZonedTime(stravaStartUtc);
  const actualDateTimeLabel = formatZonedDateTime(stravaStartUtc);
  const avgSpeedLabel = item?.discipline === 'BIKE' ? formatSpeedKmh(stravaAvgSpeedMps) : null;
  const avgPaceLabel = item?.discipline === 'RUN' ? formatPace(stravaAvgPaceSecPerKm) : null;
  const statusLabel = isDraftStrava
    ? 'Strava detected'
    : item?.status
      ? item.status.replace(/_/g, ' ')
      : '';

  const statusIndicator = item
    ? getSessionStatusIndicator({
        status: item.status,
        date: item.date,
        timeZone: user?.timezone ?? 'Australia/Brisbane',
      })
    : null;

  const headerTimeLabel = item?.plannedStartTimeLocal ?? 'Anytime';

  const latestNoteToCoach = (item?.comments ?? []).find((c) => c.authorId === user?.userId)?.body ?? null;

  const loadData = useCallback(async (bypassCache = false) => {
    if (user?.role !== 'ATHLETE' || !user.userId) {
      return;
    }

    setLoading(true);
    setError('');

    const startMs = process.env.NODE_ENV !== 'production' ? performance.now() : 0;

    try {
      const { item: detail } = await request<{ item: CalendarItem }>(
        bypassCache ? `/api/athlete/calendar-items/${workoutId}?t=${Date.now()}` : `/api/athlete/calendar-items/${workoutId}`,
        bypassCache ? { cache: 'no-store' } : undefined
      );

      setItem(detail);

      // Load completed activity data into form if available
      const completed = detail.completedActivities?.[0];
      if (completed) {
        setCompletionForm({
          durationMinutes: completed.durationMinutes,
          distanceKm: completed.distanceKm?.toString() ?? '',
          rpe: completed.rpe ?? '',
          notes: completed.notes ?? '',
          painFlag: completed.painFlag ?? false,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workout.');
    } finally {
      setLoading(false);

      if (process.env.NODE_ENV !== 'production') {
        try {
          const dur = performance.now() - startMs;
          // eslint-disable-next-line no-console
          console.debug('[perf] athlete-workout fetch ms', Math.round(dur));
        } catch {
          // noop
        }

        if (perfFrameMarked.current && !perfDataMarked.current) {
          perfDataMarked.current = true;
          try {
            performance.mark('athlete-workout-data');
            performance.measure('athlete-workout-load', 'athlete-workout-frame', 'athlete-workout-data');
          } catch {
            // noop
          }
        }
      }
    }
  }, [request, user?.role, user?.userId, workoutId]);

  const handleClose = useCallback(() => {
    if (submitting) return;

    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }

    router.push('/athlete/calendar');
  }, [router, submitting]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Dev-only perf mark for frame.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (perfFrameMarked.current) return;
    perfFrameMarked.current = true;
    try {
      performance.mark('athlete-workout-frame');
    } catch {
      // noop
    }
  }, []);

  const submitCompletion = async (event: FormEvent) => {
    event.preventDefault();

    if (submitting) return;
    setSubmitting(true);

    try {
      if (isDraftStrava) {
        await request(`/api/athlete/calendar-items/${workoutId}/confirm-synced`, {
          method: 'POST',
          data: {
            notesToSelf: completionForm.notes,
            rpe: completionForm.rpe === '' ? undefined : Number(completionForm.rpe),
            painFlag: completionForm.painFlag,
            notesToCoach: commentDraft.trim() ? commentDraft.trim() : undefined,
          },
        });
      } else {
        await request(`/api/athlete/calendar-items/${workoutId}/complete`, {
          method: 'POST',
          data: {
            durationMinutes: Number(completionForm.durationMinutes),
            distanceKm: completionForm.distanceKm ? Number(completionForm.distanceKm) : undefined,
            rpe: completionForm.rpe === '' ? undefined : Number(completionForm.rpe),
            notes: completionForm.notes || undefined,
            painFlag: completionForm.painFlag,
            commentBody: commentDraft.trim() ? commentDraft.trim() : undefined,
          },
        });
      }
      setCommentDraft('');
      await loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : isDraftSynced ? 'Failed to confirm workout.' : 'Failed to complete workout.');
    } finally {
      setSubmitting(false);
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
      await loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to skip workout.');
    }
  };

  const showSkeleton = userLoading || loading || !item;

  return (
    <section className="flex flex-col gap-4">
      {error ? <p className="text-sm text-rose-500">{error}</p> : null}
      {loading ? <p className="text-sm text-[var(--muted)]">Loading workout...</p> : null}
      {!userLoading && (!user || user.role !== 'ATHLETE') ? (
        <p className="text-[var(--muted)]">Athlete access required.</p>
      ) : null}

      {showSkeleton ? (
        <SkeletonAthleteWorkoutDetail />
      ) : item ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left column: Coach context (5/12) */}
          <div className="lg:col-span-5 space-y-4">
            {/* Workout header card */}
            <Card className="rounded-3xl" data-athlete-workout-header-version="right-status-v1">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    {(() => {
                      const theme = getDisciplineTheme(item.discipline);
                      return <Icon name={theme.iconName} size="md" className={theme.textClass} />;
                    })()}
                    <h1 className="text-xl font-semibold text-[var(--text)] truncate">{item.title}</h1>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
                    <span>{formatDisplay(item.date)}</span>
                    <span>·</span>
                    <span>Planned: {headerTimeLabel}</span>
                    <Badge>{item.discipline}</Badge>
                  </div>
                </div>

                {statusIndicator ? (
                  <div className="flex items-center gap-2 flex-shrink-0 justify-end min-w-[44px] sm:min-w-[180px]">
                    <span title={statusIndicator.ariaLabel} aria-label={statusIndicator.ariaLabel}>
                      <Icon name={statusIndicator.iconName} size="xs" className={statusIndicator.colorClass} />
                    </span>
                    <Badge className="hidden sm:inline-flex">{statusLabel}</Badge>
                  </div>
                ) : null}
              </div>
              {item.template ? (
                <p className="mt-1 text-xs text-[var(--muted)]">Template: {item.template.title}</p>
              ) : null}
              {item.groupSession ? (
                <p className="mt-1 text-xs text-[var(--muted)]">Group: {item.groupSession.title}</p>
              ) : null}
            </Card>

            {/* Workout detail card (only if present) */}
            {item.workoutDetail ? (
              <Card className="rounded-3xl">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Workout Detail</p>
                    <p className="mt-1 text-sm text-[var(--text)]">{item.workoutDetail}</p>
                  </div>
                </div>
              </Card>
            ) : null}
          </div>

          {/* Right column: Athlete log (7/12) */}
          <div className="lg:col-span-7">
            {isStravaCompletion ? (
              <Card className="rounded-3xl mb-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold">From Strava</h2>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="/integrations/strava.webp"
                        alt="Strava"
                        title={isDraftStrava ? 'Strava detected (pending confirmation)' : 'Synced from Strava'}
                        className="h-4 w-4 scale-105 inline-block"
                      />
                    </div>
                    {actualDateTimeLabel ? (
                      <p className="text-xs text-[var(--muted)] mt-1">
                        Actual start time (from Strava):{' '}
                        <span className="text-[var(--text)] font-medium">{actualDateTimeLabel}</span>
                      </p>
                    ) : null}
                  </div>
                  {isDraftStrava ? (
                    <Badge>Pending confirmation</Badge>
                  ) : null}
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {stravaType ? (
                    <div>
                      <p className="text-xs font-medium text-[var(--muted)]">Activity type</p>
                      <p className="text-sm mt-1">{stravaType}</p>
                    </div>
                  ) : null}

                  {stravaName ? (
                    <div>
                      <p className="text-xs font-medium text-[var(--muted)]">Activity name</p>
                      <p className="text-sm mt-1">{stravaName}</p>
                    </div>
                  ) : null}

                  {avgSpeedLabel ? (
                    <div>
                      <p className="text-xs font-medium text-[var(--muted)]">Avg speed</p>
                      <p className="text-sm mt-1">{avgSpeedLabel}</p>
                    </div>
                  ) : null}

                  {avgPaceLabel ? (
                    <div>
                      <p className="text-xs font-medium text-[var(--muted)]">Avg pace</p>
                      <p className="text-sm mt-1">{avgPaceLabel}</p>
                    </div>
                  ) : null}

                  {typeof stravaAvgHr === 'number' ? (
                    <div>
                      <p className="text-xs font-medium text-[var(--muted)]">Avg HR</p>
                      <p className="text-sm mt-1">{Math.round(stravaAvgHr)} bpm</p>
                    </div>
                  ) : null}

                  {typeof stravaMaxHr === 'number' ? (
                    <div>
                      <p className="text-xs font-medium text-[var(--muted)]">Max HR</p>
                      <p className="text-sm mt-1">{Math.round(stravaMaxHr)} bpm</p>
                    </div>
                  ) : null}
                </div>
              </Card>
            ) : null}

            {item.status === 'PLANNED' || isDraftStrava ? (
              <Card className="rounded-3xl">
                <form id="completion-form" onSubmit={submitCompletion} className="flex flex-col h-full">
                  <div className="space-y-3">
                    <div>
                      <h2 className="text-lg font-semibold">Athlete log</h2>
                      {isDraftStrava ? (
                        <p className="text-xs text-[var(--muted)]">Strava detected a workout — add notes/pain and confirm to share with your coach</p>
                      ) : (
                        <p className="text-xs text-[var(--muted)]">Log your effort below</p>
                      )}
                    </div>

                    {isDraftStrava ? (
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <p className="text-xs font-medium text-[var(--muted)]">Duration (min)</p>
                          <p className="text-sm mt-1">{item.completedActivities?.[0]?.durationMinutes ?? '—'}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-[var(--muted)]">Distance (km)</p>
                          <p className="text-sm mt-1">{item.completedActivities?.[0]?.distanceKm ?? '—'}</p>
                        </div>
                        <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--muted)]">
                          RPE (1-10)
                          <Input
                            type="number"
                            value={completionForm.rpe}
                            min={1}
                            max={10}
                            onChange={(event) =>
                              setCompletionForm({
                                ...completionForm,
                                rpe: event.target.value === '' ? '' : Number(event.target.value),
                              })
                            }
                            className="text-sm min-h-[44px]"
                          />
                        </label>
                      </div>
                    ) : (
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
                            onChange={(event) =>
                              setCompletionForm({
                                ...completionForm,
                                rpe: event.target.value === '' ? '' : Number(event.target.value),
                              })
                            }
                            className="text-sm min-h-[44px]"
                          />
                        </label>
                      </div>
                    )}

                    <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--muted)]">
                      Athlete notes to Self
                      <Textarea
                        value={completionForm.notes}
                        onChange={(event) => setCompletionForm({ ...completionForm, notes: event.target.value })}
                        rows={2}
                        className="text-sm"
                        placeholder={isDraftStrava ? 'Add notes before confirming' : 'Private notes for yourself'}
                      />
                    </label>

                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={completionForm.painFlag}
                        onChange={(event) => setCompletionForm({ ...completionForm, painFlag: event.target.checked })}
                        className="w-4 h-4 rounded border-white/30 text-rose-500 focus:ring-2 focus:ring-rose-500/50"
                      />
                      <span className="text-[var(--text)]">Felt pain or discomfort during this workout</span>
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
                      <p className="text-xs text-[var(--muted)] mt-1">
                        {isDraftStrava ? 'Saved when you confirm' : 'Saved when you complete or skip'}
                      </p>
                    </label>
                  </div>

                  {/* Action buttons at bottom */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2 mt-4 pt-3 border-t border-white/20">
                    {item.status === 'PLANNED' ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={skipWorkout}
                        className="min-h-[44px] w-full sm:w-auto"
                        disabled={submitting}
                      >
                        Skip
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="min-h-[44px] w-full sm:w-auto"
                      onClick={handleClose}
                      disabled={submitting}
                    >
                      Close
                    </Button>
                    <Button type="submit" size="sm" className="min-h-[44px] w-full sm:w-auto" disabled={submitting}>
                      {isDraftStrava ? 'Confirm' : 'Complete'}
                    </Button>
                  </div>
                </form>
              </Card>
            ) : null}

            {/* Show completed activity data if workout is already completed */}
            {!isDraftStrava && item.status !== 'PLANNED' && item.completedActivities?.[0] ? (
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

                  {latestNoteToCoach ? (
                    <div>
                      <p className="text-xs font-medium text-[var(--muted)]">Sent to coach</p>
                      <p className="text-sm mt-1 whitespace-pre-wrap">{latestNoteToCoach}</p>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2 mt-4 pt-3 border-t border-white/20">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="min-h-[44px] w-full sm:w-auto"
                    onClick={handleClose}
                    disabled={submitting}
                  >
                    Close
                  </Button>
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

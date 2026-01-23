'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { ApiClientError } from '@/components/api-client';
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
import { FullScreenLogoLoader } from '@/components/FullScreenLogoLoader';
import { uiLabel } from '@/components/ui/typography';
import { WEATHER_ICON_NAME } from '@/components/calendar/weatherIconName';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

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
  plannedDurationMinutes?: number | null;
  plannedDistanceKm?: number | null;
  distanceMeters?: number | null;
  intensityTarget?: string | null;
  tags?: string[];
  equipment?: string[];
  workoutStructure?: unknown | null;
  notes?: string | null;
  template?: { id: string; title: string } | null;
  groupSession?: { id: string; title: string } | null;
  comments?: Array<{ id: string; authorId: string; body: string; createdAt: string }>;
  completedActivities?: CompletedActivity[];
};

type WeatherResponse =
  | {
      enabled: true;
      source: 'open-meteo';
      date: string;
      timezone: string;
      icon: 'sunny' | 'partly_cloudy' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow' | 'wind';
      maxTempC: number;
      sunriseLocal: string;
      sunsetLocal: string;
    }
  | {
      enabled: false;
      reason: 'NO_LOCATION';
    };

export default function AthleteWorkoutDetailPage({ params }: { params: { id: string } }) {
  const workoutId = params.id;
  const router = useRouter();
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();
  const [item, setItem] = useState<CalendarItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [completionForm, setCompletionForm] = useState<{ durationMinutes: number; distanceKm: string; rpe: number | ''; notes: string; painFlag: boolean }>({
    durationMinutes: 60,
    distanceKm: '',
    rpe: '',
    notes: '',
    painFlag: false,
  });
  const [commentDraft, setCommentDraft] = useState('');
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const perfFrameMarked = useRef(false);
  const perfDataMarked = useRef(false);
  const isDraftSynced = item?.status === 'COMPLETED_SYNCED_DRAFT';
  const latestCompletion = item?.completedActivities?.[0];
  const isStravaCompletion = latestCompletion?.source === 'STRAVA';
  const isDraftStrava = Boolean(isDraftSynced || (isStravaCompletion && !latestCompletion?.confirmedAt));
  const showStravaBadge = Boolean(isDraftStrava || isStravaCompletion);
  const hasStravaData = Boolean(isDraftStrava || isStravaCompletion);
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

  const formatDuration = (seconds: number | undefined) => {
    if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
    const totalMinutes = Math.round(seconds / 60);
    if (totalMinutes < 60) return `${totalMinutes} min`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  };

  const formatIntUnit = (value: number | undefined, unit: string) => {
    if (value === undefined || value === null || !Number.isFinite(value)) return null;
    return `${Math.round(value)} ${unit}`;
  };

  const formatPace = (secPerKm: number | undefined) => {
    if (!secPerKm || !Number.isFinite(secPerKm) || secPerKm <= 0) return null;
    const minutes = Math.floor(secPerKm / 60);
    const seconds = Math.round(secPerKm % 60);
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    return `${mm}:${ss} /km`;
  };

  const stravaType = (strava.sportType ?? strava.type ?? strava.sport_type ?? strava.activityType) as string | undefined;
  const stravaName = (strava.name ?? strava.activityName) as string | undefined;
  const stravaStartUtc = latestCompletion?.effectiveStartTimeUtc;
  const stravaAvgSpeedMps = (strava.averageSpeedMps ?? strava.avgSpeedMps ?? strava.average_speed) as number | undefined;
  const stravaAvgPaceSecPerKm =
    (strava.avgPaceSecPerKm ?? strava.avg_pace_sec_per_km) as number | undefined;
  const derivedPaceSecPerKm =
    item?.discipline === 'RUN' && stravaAvgSpeedMps && Number.isFinite(stravaAvgSpeedMps) && stravaAvgSpeedMps > 0
      ? Math.round(1000 / stravaAvgSpeedMps)
      : undefined;
  const stravaAvgHr = (strava.averageHeartrateBpm ?? strava.avgHr ?? strava.average_heartrate) as number | undefined;
  const stravaMaxHr = (strava.maxHeartrateBpm ?? strava.maxHr ?? strava.max_heartrate) as number | undefined;
  const stravaMaxSpeedMps = (strava.maxSpeedMps ?? strava.max_speed) as number | undefined;
  const stravaMovingTimeSec = (strava.movingTimeSec ?? strava.moving_time) as number | undefined;
  const stravaElevationGainM = (strava.totalElevationGainM ?? strava.total_elevation_gain) as number | undefined;
  const stravaCaloriesKcal = (strava.caloriesKcal ?? strava.calories) as number | undefined;
  const stravaCadenceRpm = (strava.averageCadenceRpm ?? strava.average_cadence) as number | undefined;

  const actualTimeLabel = formatZonedTime(stravaStartUtc);
  const actualDateTimeLabel = formatZonedDateTime(stravaStartUtc);
  const avgSpeedLabel = item?.discipline === 'BIKE' ? formatSpeedKmh(stravaAvgSpeedMps) : null;
  const avgPaceLabel = item?.discipline === 'RUN' ? formatPace(stravaAvgPaceSecPerKm ?? derivedPaceSecPerKm) : null;
  const maxSpeedLabel = item?.discipline === 'BIKE' ? formatSpeedKmh(stravaMaxSpeedMps) : null;
  const movingTimeLabel = formatDuration(stravaMovingTimeSec);
  const elevationGainLabel = formatIntUnit(stravaElevationGainM, 'm');
  const caloriesLabel = formatIntUnit(stravaCaloriesKcal, 'kcal');
  const cadenceLabel = formatIntUnit(stravaCadenceRpm, 'rpm');
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
      if (err instanceof ApiClientError && err.status === 404) {
        setError('Workout not found (it may have been deleted).');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load workout.');
      }
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

  const showToast = useCallback((message: string, kind: 'success' | 'error') => {
    setToast({ message, kind });
    window.setTimeout(() => {
      setToast((current) => (current?.message === message ? null : current));
    }, 3000);
  }, []);

  const deleteWorkout = useCallback(async () => {
    if (deleting || submitting) return;
    setDeleting(true);
    setError('');

    try {
      const result = await request<{ ok: true; deleted?: boolean; alreadyDeleted?: boolean }>(
        `/api/athlete/calendar-items/${workoutId}`,
        { method: 'DELETE' }
      );

      if (result?.alreadyDeleted) {
        showToast('Workout already deleted.', 'success');
      } else {
        showToast('Workout deleted.', 'success');
      }

      // Let the toast render briefly, then navigate away.
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      router.push('/athlete/calendar');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) {
        showToast('Workout already deleted.', 'success');
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        router.push('/athlete/calendar');
      } else if (err instanceof ApiClientError && err.status === 403) {
        showToast('You can only delete your own workouts.', 'error');
      } else {
        showToast('Failed to delete workout.', 'error');
      }
    } finally {
      setDeleting(false);
      setConfirmDeleteOpen(false);
    }
  }, [deleting, request, router, showToast, submitting, workoutId]);

  const loadWeather = useCallback(
    async (bypassCache = false) => {
      if (user?.role !== 'ATHLETE' || !user.userId) return;

      setWeatherLoading(true);
      setWeatherError('');

      try {
        const data = await request<WeatherResponse>(
          bypassCache ? `/api/athlete/workouts/${workoutId}/weather?t=${Date.now()}` : `/api/athlete/workouts/${workoutId}/weather`,
          bypassCache ? { cache: 'no-store' } : undefined
        );
        setWeather(data);
      } catch (err) {
        setWeatherError(err instanceof Error ? err.message : 'Failed to load weather.');
      } finally {
        setWeatherLoading(false);
      }
    },
    [request, user?.role, user?.userId, workoutId]
  );

  const handleClose = useCallback(() => {
    if (submitting || deleting) return;

    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }

    router.push('/athlete/calendar');
  }, [deleting, router, submitting]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (userLoading) return;
    if (!user || user.role !== 'ATHLETE') return;
    void loadWeather();
  }, [loadWeather, user, userLoading]);

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
        <FullScreenLogoLoader />
      ) : item ? (
        <div className="grid grid-cols-1 gap-4 min-w-0 lg:grid-cols-2 lg:grid-rows-2">
          {/* WORKOUT PLAN (top-left) */}
          <Card className="rounded-3xl min-w-0 lg:col-start-1 lg:row-start-1" data-athlete-workout-quadrant="workout-plan">
            <p className={uiLabel}>WORKOUT PLAN</p>

            <div className="mt-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  {(() => {
                    const theme = getDisciplineTheme(item.discipline);
                    return <Icon name={theme.iconName} size="md" className={theme.textClass} />;
                  })()}
                  <h1 className="min-w-0 text-xl font-semibold text-[var(--text)] truncate">{item.title}</h1>

                  {statusIndicator ? (
                    <span
                      className="flex-shrink-0"
                      title={statusIndicator.ariaLabel}
                      aria-label={statusIndicator.ariaLabel}
                    >
                      <Icon name={statusIndicator.iconName} size="lg" className={statusIndicator.colorClass} />
                    </span>
                  ) : null}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
                  <span>{formatDisplay(item.date)}</span>
                  <span>·</span>
                  <span>Planned: {headerTimeLabel}</span>
                </div>
              </div>

              <div className="flex flex-shrink-0 items-start justify-end gap-2">
                {showStravaBadge ? <Badge>{statusLabel}</Badge> : <Badge className="hidden sm:inline-flex">{statusLabel}</Badge>}
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              {/* Duration, Distance, RPE */}
              {item.status === 'PLANNED' || isDraftStrava ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {isDraftStrava ? (
                    <>
                      <div>
                        <p className="text-xs font-medium text-[var(--muted)]">Duration</p>
                        <p className="text-sm mt-1">{item.completedActivities?.[0]?.durationMinutes ?? '—'} min</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-[var(--muted)]">Distance</p>
                        <p className="text-sm mt-1">{item.completedActivities?.[0]?.distanceKm ?? '—'} km</p>
                      </div>
                      <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--muted)]">
                        RPE
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
                    </>
                  ) : (
                    <>
                      <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--muted)]">
                        Duration
                        <Input
                          type="number"
                          value={completionForm.durationMinutes}
                          onChange={(event) => setCompletionForm({ ...completionForm, durationMinutes: Number(event.target.value) })}
                          min={1}
                          required
                          className="text-sm min-h-[44px]"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--muted)]">
                        Distance
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
                        RPE
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
                    </>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)]">Duration</p>
                    <p className="text-sm mt-1">
                      {(latestCompletion?.durationMinutes ?? item.plannedDurationMinutes) ? `${latestCompletion?.durationMinutes ?? item.plannedDurationMinutes} min` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)]">Distance</p>
                    <p className="text-sm mt-1">
                      {(latestCompletion?.distanceKm ?? item.plannedDistanceKm) ? `${latestCompletion?.distanceKm ?? item.plannedDistanceKm} km` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)]">RPE</p>
                    <p className="text-sm mt-1">{latestCompletion?.rpe ?? item.intensityTarget ?? '—'}</p>
                  </div>
                </div>
              )}

              {/* Workout Description */}
              <div>
                <p className="text-xs font-medium text-[var(--muted)]">Workout Description</p>
                <p className="mt-1 text-sm text-[var(--text)] whitespace-pre-wrap">{item.workoutDetail?.trim() || '—'}</p>
              </div>

              {item.template ? <p className="text-xs text-[var(--muted)]">Template: {item.template.title}</p> : null}
              {item.groupSession ? <p className="text-xs text-[var(--muted)]">Group: {item.groupSession.title}</p> : null}
            </div>
          </Card>

          {/* WEATHER (bottom-left on desktop) */}
          <Card className="rounded-3xl min-w-0 lg:col-start-1 lg:row-start-2" data-athlete-workout-quadrant="weather">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className={uiLabel}>WEATHER</p>

                {weatherLoading ? (
                  <div className="mt-2 animate-pulse">
                    <div className="h-4 w-40 rounded bg-black/10" />
                    <div className="mt-2 h-4 w-52 rounded bg-black/10" />
                    <div className="mt-2 h-4 w-48 rounded bg-black/10" />
                  </div>
                ) : weather?.enabled ? (
                  <div className="mt-2 flex items-center gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/20 bg-white/30">
                      <Icon name={WEATHER_ICON_NAME[weather.icon]} size="lg" className="text-[var(--text)]" />
                    </div>

                    <div className="min-w-0">
                      <p className="text-sm text-[var(--text)]">Max: {Math.round(weather.maxTempC)}°C</p>
                      <p className="text-sm text-[var(--muted)]">Sunrise: {weather.sunriseLocal}</p>
                      <p className="text-sm text-[var(--muted)]">Sunset: {weather.sunsetLocal}</p>
                    </div>
                  </div>
                ) : weather?.enabled === false ? (
                  <p className="mt-2 text-sm text-[var(--muted)]">Add a default workout location in Settings to enable weather.</p>
                ) : weatherError ? (
                  <p className="mt-2 text-sm text-[var(--muted)]">Weather unavailable.</p>
                ) : (
                  <p className="mt-2 text-sm text-[var(--muted)]">Loading weather…</p>
                )}
              </div>

              {weather?.enabled === false ? null : (
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/20 bg-white/30 text-[var(--text)] hover:bg-white/40 disabled:opacity-50"
                  onClick={() => void loadWeather(true)}
                  disabled={weatherLoading}
                  aria-label="Refresh weather"
                  title="Refresh weather"
                >
                  <Icon name="refresh" size="sm" />
                </button>
              )}
            </div>
          </Card>

          {/* STRAVA DETECTED (top-right on desktop) */}
          {hasStravaData ? (
            <Card className="rounded-3xl min-w-0 lg:col-start-2 lg:row-start-1" data-athlete-workout-quadrant="strava">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={uiLabel}>STRAVA DETECTED</p>
                  {isDraftStrava ? <p className="mt-1 text-xs text-[var(--muted)]">Pending confirmation</p> : null}
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/integrations/strava.webp"
                  alt="Strava"
                  className="h-4 w-4 scale-110 inline-block"
                />
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {actualDateTimeLabel ? (
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)]">Start time</p>
                    <p className="text-sm mt-1">{actualDateTimeLabel}</p>
                  </div>
                ) : null}

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

                {formatSpeedKmh(stravaAvgSpeedMps) ? (
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)]">Average speed</p>
                    <p className="text-sm mt-1">{formatSpeedKmh(stravaAvgSpeedMps)}</p>
                  </div>
                ) : null}

                {movingTimeLabel ? (
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)]">Moving time</p>
                    <p className="text-sm mt-1">{movingTimeLabel}</p>
                  </div>
                ) : null}

                {elevationGainLabel ? (
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)]">Elevation gain</p>
                    <p className="text-sm mt-1">{elevationGainLabel}</p>
                  </div>
                ) : null}

                {caloriesLabel ? (
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)]">Calories</p>
                    <p className="text-sm mt-1">{caloriesLabel}</p>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}

          {/* ATHLETE LOG (bottom-right) */}
          {item.status === 'PLANNED' || isDraftStrava ? (
            <Card className="rounded-3xl min-w-0 lg:col-start-2 lg:row-start-2" data-athlete-workout-quadrant="athlete-log">
              <form id="completion-form" onSubmit={submitCompletion} className="flex flex-col h-full">
                <p className={uiLabel}>ATHLETE LOG</p>
                {isDraftStrava ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">Add notes/pain and confirm to share with your coach</p>
                ) : (
                  <p className="mt-1 text-xs text-[var(--muted)]">Log your effort below</p>
                )}

                <div className="mt-3 space-y-3">
                  <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--muted)]">
                    Athlete notes to Coach
                    <Textarea
                      rows={2}
                      placeholder="Optional message to your coach"
                      value={commentDraft}
                      onChange={(event) => setCommentDraft(event.target.value)}
                      className="text-sm"
                    />
                  </label>

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
                    <span className="text-[var(--text)]">Felt pain / discomfort</span>
                  </label>

                  <p className="text-xs text-[var(--muted)]">
                    {isDraftStrava ? 'Saved when you confirm' : 'Saved when you complete or skip'}
                  </p>
                </div>

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
                    variant="ghost"
                    size="sm"
                    className="min-h-[44px] w-full sm:w-auto text-rose-600 hover:bg-rose-500/10"
                    onClick={() => setConfirmDeleteOpen(true)}
                    disabled={submitting || deleting}
                  >
                    Delete
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="min-h-[44px] w-full sm:w-auto"
                    onClick={handleClose}
                    disabled={submitting || deleting}
                  >
                    Close
                  </Button>
                  <Button type="submit" size="sm" className="min-h-[44px] w-full sm:w-auto" disabled={submitting}>
                    {isDraftStrava ? 'Confirm' : 'Complete'}
                  </Button>
                </div>
              </form>
            </Card>
          ) : (
            <Card className="rounded-3xl min-w-0 lg:col-start-2 lg:row-start-2" data-athlete-workout-quadrant="athlete-log">
              <p className={uiLabel}>ATHLETE LOG</p>

              <div className="mt-3 space-y-3">
                {latestNoteToCoach ? (
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)]">Athlete notes to Coach</p>
                    <p className="text-sm mt-1 whitespace-pre-wrap">{latestNoteToCoach}</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)]">Athlete notes to Coach</p>
                    <p className="text-sm mt-1">—</p>
                  </div>
                )}

                {item.completedActivities?.[0]?.notes ? (
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)]">Athlete notes to Self</p>
                    <p className="text-sm mt-1 whitespace-pre-wrap">{item.completedActivities[0].notes}</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)]">Athlete notes to Self</p>
                    <p className="text-sm mt-1">—</p>
                  </div>
                )}

                <div>
                  <p className="text-xs font-medium text-[var(--muted)]">Felt pain / discomfort</p>
                  <p className="text-sm mt-1">{item.completedActivities?.[0]?.painFlag ? 'Yes' : 'No'}</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2 mt-4 pt-3 border-t border-white/20">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-[44px] w-full sm:w-auto text-rose-600 hover:bg-rose-500/10"
                  onClick={() => setConfirmDeleteOpen(true)}
                  disabled={submitting || deleting}
                >
                  Delete
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="min-h-[44px] w-full sm:w-auto"
                  onClick={handleClose}
                  disabled={submitting || deleting}
                >
                  Close
                </Button>
              </div>
            </Card>
          )}
        </div>
      ) : null}

      <ConfirmModal
        isOpen={confirmDeleteOpen}
        title="Delete workout?"
        message="This removes the workout from your calendar and your coach's calendar.\n\nThis can't be undone."
        confirmLabel={deleting ? 'Deleting…' : 'Delete workout'}
        cancelLabel="Cancel"
        onCancel={() => {
          if (deleting) return;
          setConfirmDeleteOpen(false);
        }}
        onConfirm={() => void deleteWorkout()}
      />

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="athlete-workout-toast"
          className={
            'fixed bottom-4 left-1/2 z-[70] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border px-4 py-3 text-sm shadow-lg backdrop-blur ' +
            (toast.kind === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-900')
          }
        >
          {toast.message}
        </div>
      ) : null}
    </section>
  );
}

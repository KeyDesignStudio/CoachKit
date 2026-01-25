'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from '@/components/api-client';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { formatDisplay } from '@/lib/client-date';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { Icon } from '@/components/ui/Icon';
import { uiLabel } from '@/components/ui/typography';
import { getSessionStatusIndicator } from '@/components/calendar/getSessionStatusIndicator';
import { WEATHER_ICON_NAME } from '@/components/calendar/weatherIconName';

type CommentRecord = {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
  author: {
    id: string;
    name: string | null;
    role: 'COACH' | 'ATHLETE' | string;
  };
};

type ReviewItem = {
  id: string;
  title: string;
};

type CompletedActivity = {
  id: string;
  durationMinutes: number | null;
  distanceKm: number | null;
  rpe: number | null;
  notes: string | null;
  painFlag: boolean;
  source: string;
  confirmedAt?: string | null;
  metricsJson?: any;
  startTime: string;
  effectiveStartTimeUtc?: string;
};

type CalendarItemDetail = {
  id: string;
  title: string;
  date: string;
  plannedStartTimeLocal: string | null;
  discipline: string;
  status: string;
  workoutDetail?: string | null;
  plannedDurationMinutes?: number | null;
  plannedDistanceKm?: number | null;
  intensityTarget?: string | null;
  template?: { id: string; title: string } | null;
  groupSession?: { id: string; title: string } | null;
  athlete?: { id: string; name: string | null } | null;
  comments?: CommentRecord[];
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

type ReviewDrawerProps = {
  item: ReviewItem | null;
  onClose: () => void;
  onMarkReviewed: (id: string) => Promise<void>;
  showSessionTimes?: boolean;
  timeZone: string;
};

export function ReviewDrawer({ item, onClose, onMarkReviewed, showSessionTimes: _showSessionTimes = true, timeZone }: ReviewDrawerProps) {
  const { request } = useApi();
  const [marking, setMarking] = useState(false);
  const [detail, setDetail] = useState<CalendarItemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');

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

  const loadDetail = useCallback(
    async (bypassCache = false) => {
      setDetailLoading(true);
      setDetailError('');
      try {
        const url = bypassCache ? `/api/coach/calendar-items/${item.id}?t=${Date.now()}` : `/api/coach/calendar-items/${item.id}`;
        const resp = await request<{ item: CalendarItemDetail }>(url, bypassCache ? { cache: 'no-store' } : undefined);
        setDetail(resp.item);
      } catch (err) {
        setDetailError(err instanceof Error ? err.message : 'Failed to load workout detail.');
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [item.id, request]
  );

  const loadWeather = useCallback(
    async (bypassCache = false) => {
      setWeatherLoading(true);
      setWeatherError('');
      try {
        const url = bypassCache ? `/api/athlete/workouts/${item.id}/weather?t=${Date.now()}` : `/api/athlete/workouts/${item.id}/weather`;
        const resp = await request<WeatherResponse>(url, bypassCache ? { cache: 'no-store' } : undefined);
        setWeather(resp);
      } catch (err) {
        setWeatherError(err instanceof Error ? err.message : 'Weather unavailable.');
        setWeather(null);
      } finally {
        setWeatherLoading(false);
      }
    },
    [item.id, request]
  );

  useEffect(() => {
    void loadDetail(true);
    void loadWeather(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const latestCompletion = detail?.completedActivities?.[0] ?? null;
  const isDraftSynced = detail?.status === 'COMPLETED_SYNCED_DRAFT';
  const isStravaCompletion = latestCompletion?.source === 'STRAVA';
  const isDraftStrava = Boolean(isDraftSynced || (isStravaCompletion && !latestCompletion?.confirmedAt));
  const hasStravaData = Boolean(isDraftStrava || isStravaCompletion);
  const showStravaBadge = Boolean(hasStravaData);

  const statusLabel = isDraftStrava ? 'Strava detected' : detail?.status ? detail.status.replace(/_/g, ' ') : '';
  const statusIndicator = detail
    ? getSessionStatusIndicator({
        status: detail.status,
        date: detail.date,
        timeZone,
      })
    : null;

  const athleteId = detail?.athlete?.id ?? null;
  const latestNoteToCoach = useMemo(() => {
    if (!athleteId) return null;
    const comments = detail?.comments ?? [];
    return comments.find((c) => c.authorId === athleteId)?.body ?? null;
  }, [athleteId, detail?.comments]);

  const formatZonedDateTime = useCallback(
    (isoString: string | undefined) => {
      if (!isoString) return null;
      const date = new Date(isoString);
      if (Number.isNaN(date.getTime())) return null;
      return new Intl.DateTimeFormat(undefined, {
        timeZone,
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);
    },
    [timeZone]
  );

  const formatSpeedKmh = (mps: number | undefined) => {
    if (!mps || !Number.isFinite(mps) || mps <= 0) return null;
    return `${(mps * 3.6).toFixed(1)} km/h`;
  };

  const formatDurationHms = (seconds: number | undefined) => {
    if (seconds === undefined || seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
    const totalSeconds = Math.round(seconds);
    const s = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const m = totalMinutes % 60;
    const h = Math.floor(totalMinutes / 60);
    if (h <= 0) return `${m}:${String(s).padStart(2, '0')}`;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const formatKm = (meters: number | undefined) => {
    if (meters === undefined || meters === null || !Number.isFinite(meters) || meters <= 0) return null;
    return `${(meters / 1000).toFixed(2)} km`;
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

  const FieldRow = ({ label, value }: { label: string; value: string | number | null | undefined }) => {
    if (value === undefined || value === null || value === '') return null;
    return (
      <div>
        <p className="text-xs font-medium text-[var(--muted)]">{label}</p>
        <p className="text-sm mt-1 text-[var(--text)]">{value}</p>
      </div>
    );
  };

  const strava = (latestCompletion?.metricsJson?.strava ?? {}) as Record<string, any>;
  const stravaActivity = (strava.activity ?? strava) as Record<string, any>;

  const stravaType = (strava.sportType ?? strava.type ?? strava.sport_type ?? strava.activityType) as string | undefined;
  const stravaName = (strava.name ?? strava.activityName) as string | undefined;
  const stravaStartUtc = latestCompletion?.effectiveStartTimeUtc ?? latestCompletion?.startTime;
  const actualDateTimeLabel = formatZonedDateTime(stravaStartUtc);

  const stravaAvgSpeedMps = (strava.averageSpeedMps ?? strava.avgSpeedMps ?? strava.average_speed) as number | undefined;
  const stravaAvgPaceSecPerKm = (strava.avgPaceSecPerKm ?? strava.avg_pace_sec_per_km) as number | undefined;
  const derivedPaceSecPerKm =
    detail?.discipline === 'RUN' && stravaAvgSpeedMps && Number.isFinite(stravaAvgSpeedMps) && stravaAvgSpeedMps > 0
      ? Math.round(1000 / stravaAvgSpeedMps)
      : undefined;

  const stravaMaxSpeedMps = (strava.maxSpeedMps ?? strava.max_speed) as number | undefined;
  const stravaMovingTimeSec = (strava.movingTimeSec ?? strava.moving_time) as number | undefined;
  const stravaElapsedTimeSec = (strava.elapsedTimeSec ?? strava.elapsed_time) as number | undefined;
  const stravaElevationGainM = (strava.totalElevationGainM ?? strava.total_elevation_gain) as number | undefined;
  const stravaCaloriesKcal = (strava.caloriesKcal ?? strava.calories) as number | undefined;

  const stravaSummaryPolyline =
    (typeof stravaActivity.map?.summary_polyline === 'string' ? stravaActivity.map.summary_polyline : null) ??
    (typeof stravaActivity.summary_polyline === 'string' ? stravaActivity.summary_polyline : null) ??
    (typeof stravaActivity.summaryPolyline === 'string' ? stravaActivity.summaryPolyline : null) ??
    (typeof (strava as any).summaryPolyline === 'string' ? (strava as any).summaryPolyline : null);

  const stravaDescription = typeof stravaActivity.description === 'string' ? stravaActivity.description.trim() : null;
  const stravaDeviceName = typeof stravaActivity.device_name === 'string' ? stravaActivity.device_name.trim() : null;
  const stravaLocationCity = typeof stravaActivity.location_city === 'string' ? stravaActivity.location_city.trim() : null;

  const stravaLaps = (Array.isArray(stravaActivity.laps) ? stravaActivity.laps : null) ??
    (Array.isArray((strava as any).laps) ? (strava as any).laps : []);

  const stravaAverageWatts = (stravaActivity.average_watts ?? stravaActivity.averageWatts) as number | undefined;
  const stravaMaxWatts = (stravaActivity.max_watts ?? stravaActivity.maxWatts) as number | undefined;
  const stravaSufferScore = (stravaActivity.suffer_score ?? stravaActivity.sufferScore) as number | undefined;
  const stravaPerceivedExertion = (stravaActivity.perceived_exertion ?? stravaActivity.perceivedExertion) as number | string | undefined;

  const activityAverageHeartrate =
    (stravaActivity.average_heartrate ?? stravaActivity.averageHeartrate ?? (strava as any).averageHeartrateBpm) as number | undefined;
  const activityMaxHeartrate =
    (stravaActivity.max_heartrate ?? stravaActivity.maxHeartrate ?? (strava as any).maxHeartrateBpm) as number | undefined;

  const avgSpeedLabel = detail?.discipline === 'BIKE' ? formatSpeedKmh(stravaAvgSpeedMps) : null;
  const avgPaceLabel = detail?.discipline === 'RUN' ? formatPace(stravaAvgPaceSecPerKm ?? derivedPaceSecPerKm) : null;
  const maxSpeedLabel = detail?.discipline === 'BIKE' ? formatSpeedKmh(stravaMaxSpeedMps) : null;
  const movingTimeLabel = formatDurationHms(stravaMovingTimeSec);
  const elapsedTimeLabel = formatDurationHms(stravaElapsedTimeSec);
  const elevationGainLabel = formatIntUnit(stravaElevationGainM, 'm');
  const caloriesLabel = formatIntUnit(stravaCaloriesKcal, 'kcal');

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
              <h2 className="text-lg font-semibold text-[var(--text)]">Review workout</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {detail?.athlete?.name ? `Athlete: ${detail.athlete.name}` : 'Loading…'}
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

          {detailLoading ? <p className="text-sm text-[var(--muted)]">Loading workout…</p> : null}
          {detailError ? <p className="text-sm text-rose-600">{detailError}</p> : null}

          {detail ? (
            <div className="grid grid-cols-1 gap-4 min-w-0 xl:grid-cols-2 xl:grid-rows-2">
              {/* WORKOUT PLAN */}
              <Card className="rounded-3xl min-w-0 xl:col-start-1 xl:row-start-1">
                <p className={uiLabel}>WORKOUT PLAN</p>

                <div className="mt-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {(() => {
                        const theme = getDisciplineTheme(detail.discipline);
                        return <Icon name={theme.iconName} size="md" className={theme.textClass} />;
                      })()}
                      <h3 className="min-w-0 text-xl font-semibold text-[var(--text)] truncate">{detail.title}</h3>
                      {statusIndicator ? (
                        <span className="flex-shrink-0" title={statusIndicator.ariaLabel} aria-label={statusIndicator.ariaLabel}>
                          <Icon name={statusIndicator.iconName} size="lg" className={statusIndicator.colorClass} />
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
                      <span>{formatDisplay(detail.date)}</span>
                      <span>·</span>
                      <span>Planned: {detail.plannedStartTimeLocal ?? 'Anytime'}</span>
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 items-start justify-end gap-2">
                    {showStravaBadge ? <Badge>{statusLabel}</Badge> : <Badge className="hidden sm:inline-flex">{statusLabel}</Badge>}
                  </div>
                </div>

                <div className="mt-4 grid gap-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-xs font-medium text-[var(--muted)]">Duration</p>
                      <p className="text-sm mt-1">
                        {(latestCompletion?.durationMinutes ?? detail.plannedDurationMinutes)
                          ? `${latestCompletion?.durationMinutes ?? detail.plannedDurationMinutes} min`
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-[var(--muted)]">Distance</p>
                      <p className="text-sm mt-1">
                        {(latestCompletion?.distanceKm ?? detail.plannedDistanceKm)
                          ? `${latestCompletion?.distanceKm ?? detail.plannedDistanceKm} km`
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-[var(--muted)]">RPE</p>
                      <p className="text-sm mt-1">{latestCompletion?.rpe ?? detail.intensityTarget ?? '—'}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-[var(--muted)]">Workout Description</p>
                    <p className="mt-1 text-sm text-[var(--text)] whitespace-pre-wrap">{detail.workoutDetail?.trim() || '—'}</p>
                  </div>

                  {detail.template ? <p className="text-xs text-[var(--muted)]">Template: {detail.template.title}</p> : null}
                  {detail.groupSession ? <p className="text-xs text-[var(--muted)]">Group: {detail.groupSession.title}</p> : null}
                </div>
              </Card>

              {/* WEATHER */}
              <Card className="rounded-3xl min-w-0 xl:col-start-1 xl:row-start-2">
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

              {/* STRAVA DETECTED */}
              {hasStravaData ? (
                <Card className="rounded-3xl min-w-0 xl:col-start-2 xl:row-start-1">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={uiLabel}>STRAVA DETECTED</p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/integrations/strava.webp" alt="Strava" className="h-[21px] w-[21px] shrink-0" />
                    </div>
                    {isDraftStrava ? <p className="mt-1 text-xs text-[var(--muted)]">Pending confirmation</p> : null}
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-4">
                    <div className="min-w-0 space-y-3">
                      <FieldRow label="Start time" value={actualDateTimeLabel} />
                      <FieldRow
                        label="Activity"
                        value={
                          stravaType || stravaName
                            ? `${stravaType ?? ''}${stravaType && stravaName ? ' — ' : ''}${stravaName ?? ''}`
                            : null
                        }
                      />
                      <FieldRow label="Moving time" value={movingTimeLabel} />
                      <FieldRow label="Elapsed time" value={elapsedTimeLabel} />
                      {stravaDescription ? (
                        <div>
                          <p className="text-xs font-medium text-[var(--muted)]">Description</p>
                          <p className="text-sm mt-1 text-[var(--text)] whitespace-pre-wrap break-words">{stravaDescription}</p>
                        </div>
                      ) : null}
                    </div>

                    <div className="min-w-0 space-y-3">
                      <FieldRow label="Avg speed" value={avgSpeedLabel ?? avgPaceLabel} />
                      <FieldRow label="Max speed" value={maxSpeedLabel} />
                      <FieldRow label="Elevation gain" value={elevationGainLabel} />
                      <FieldRow label="Calories" value={caloriesLabel} />
                      <FieldRow label="City" value={stravaLocationCity} />
                      <FieldRow label="Polyline" value={stravaSummaryPolyline ? `${stravaSummaryPolyline.length} chars` : null} />
                    </div>

                    <div className="min-w-0 space-y-3">
                      <FieldRow label="Avg HR" value={formatIntUnit(activityAverageHeartrate, 'bpm')} />
                      <FieldRow label="Max HR" value={formatIntUnit(activityMaxHeartrate, 'bpm')} />
                      <FieldRow label="Avg watts" value={formatIntUnit(stravaAverageWatts, 'W')} />
                      <FieldRow label="Max watts" value={formatIntUnit(stravaMaxWatts, 'W')} />
                      <FieldRow
                        label="Suffer score"
                        value={
                          stravaSufferScore !== undefined && Number.isFinite(stravaSufferScore)
                            ? Math.round(stravaSufferScore)
                            : null
                        }
                      />
                      <FieldRow
                        label="Perceived exertion"
                        value={
                          stravaPerceivedExertion === undefined || stravaPerceivedExertion === null || stravaPerceivedExertion === ''
                            ? null
                            : String(stravaPerceivedExertion)
                        }
                      />
                    </div>

                    <div className="min-w-0 space-y-3">
                      <FieldRow label="Device" value={stravaDeviceName} />
                      {Array.isArray(stravaLaps) && stravaLaps.length > 0 ? (
                        <div className="space-y-2">
                          {(stravaLaps as any[]).map((lap, idx) => {
                            const lapDistance = formatKm(lap?.distance);
                            const lapMoving = formatDurationHms(lap?.moving_time);
                            const lapSpeed = formatSpeedKmh(lap?.average_speed);
                            const lapHr = formatIntUnit(lap?.average_heartrate, 'bpm');
                            const parts = [
                              lapDistance ? `Distance ${lapDistance}` : null,
                              lapMoving ? `Moving ${lapMoving}` : null,
                              lapSpeed ? `Avg speed ${lapSpeed}` : null,
                              lapHr ? `Avg HR ${lapHr}` : null,
                            ].filter(Boolean) as string[];

                            return <FieldRow key={idx} label={`Lap ${idx + 1}`} value={parts.length ? parts.join(' · ') : null} />;
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </Card>
              ) : null}

              {/* ATHLETE LOG */}
              <Card className="rounded-3xl min-w-0 xl:col-start-2 xl:row-start-2">
                <p className={uiLabel}>ATHLETE LOG</p>
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)]">Athlete notes to Coach</p>
                    <p className="text-sm mt-1 whitespace-pre-wrap">{latestNoteToCoach?.trim() || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)]">Athlete notes to Self</p>
                    <p className="text-sm mt-1 whitespace-pre-wrap">{latestCompletion?.notes?.trim() || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)]">Felt pain / discomfort</p>
                    <p className="text-sm mt-1">{latestCompletion?.painFlag ? 'Yes' : 'No'}</p>
                  </div>
                </div>
              </Card>
            </div>
          ) : null}

          {/* Planned/Completed summaries (keep existing coach UX blocks) */}
          {detail ? (
            <>
              <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Planned</h3>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Duration</dt>
                    <dd className="text-lg text-[var(--text)]">
                      {detail.plannedDurationMinutes ?? '—'} <span className="text-sm">min</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Distance</dt>
                    <dd className="text-lg text-[var(--text)]">
                      {detail.plannedDistanceKm ?? '—'} <span className="text-sm">km</span>
                    </dd>
                  </div>
                </dl>
              </section>

              {latestCompletion ? (
                <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Completed</h3>
                  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Duration</dt>
                      <dd className="text-lg text-[var(--text)]">
                        {latestCompletion.durationMinutes ?? '—'} <span className="text-sm">min</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Distance</dt>
                      <dd className="text-lg text-[var(--text)]">
                        {latestCompletion.distanceKm ?? '—'} <span className="text-sm">km</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">RPE</dt>
                      <dd className="text-lg text-[var(--text)]">{latestCompletion.rpe ?? '—'}</dd>
                    </div>
                  </dl>
                </section>
              ) : null}
            </>
          ) : null}

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

'use client';

import { cn } from '@/lib/cn';
import { Block } from '@/components/ui/Block';
import { BlockTitle } from '@/components/ui/BlockTitle';
import { FieldLabel } from '@/components/ui/FieldLabel';
import { tokens } from '@/components/ui/tokens';
import { Icon } from '@/components/ui/Icon';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { formatTimeInTimezone } from '@/lib/formatTimeInTimezone';
import { PolylineRouteMap } from '@/components/workouts/PolylineRouteMap';
import { getStravaCaloriesKcal } from '@/lib/strava-metrics';
import { getSessionStatusIndicator } from '@/components/calendar/getSessionStatusIndicator';
import { formatDisplay } from '@/lib/client-date';
import { WEATHER_ICON_NAME } from '@/components/calendar/weatherIconName';
import { WorkoutStructureView } from '@/components/workouts/WorkoutStructureView';

// --- Types ---

export type CompletedActivity = {
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

export type CalendarItem = {
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
  // Include older type compat
  latestCompletedActivity?: Partial<CompletedActivity> | null;
};

export type WeatherResponse =
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

type WorkoutDetailProps = {
  item: CalendarItem;
  weather?: WeatherResponse | null;
  athleteTimezone?: string;
  className?: string;
  // If true, render in a 'drawer' optimized layout (e.g. single column or adjusted spacing)
  isDrawer?: boolean;
  // Optional content to render in the right column (e.g. completion form) if NO completion exists
  uncompletedActionSlot?: React.ReactNode;
};

// ... existing code ...

export function WorkoutDetail({ item, weather, athleteTimezone = 'Australia/Brisbane', className, isDrawer = false, uncompletedActionSlot }: WorkoutDetailProps) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
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

const formatIntUnit = (value: number | undefined, unit: string) => {
  if (value === undefined || value === null || !Number.isFinite(value)) return null;
  return `${Math.round(value)} ${unit}`;
};

const FieldRow = ({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}) => {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div>
      <FieldLabel className="mb-1">{label}</FieldLabel>
      <div className={cn(tokens.typography.body, valueClassName)}>{value}</div>
    </div>
  );
};

export function WorkoutDetail({ item, weather, athleteTimezone = 'Australia/Brisbane', className, isDrawer = false }: WorkoutDetailProps) {
  // Normalize latest completion
  // Some versions of item have 'completedActivities' array, others 'latestCompletedActivity' object
  let latestCompletion: CompletedActivity | undefined;
  if (item.completedActivities && item.completedActivities.length > 0) {
    latestCompletion = item.completedActivities[0];
  } else if (item.latestCompletedActivity) {
    latestCompletion = item.latestCompletedActivity as CompletedActivity;
  }

  const hasStravaMetrics = Boolean(latestCompletion?.metricsJson?.strava);
  const isStravaCompletion = latestCompletion?.source === 'STRAVA' || hasStravaMetrics;
  const isDraftSynced = item.status === 'COMPLETED_SYNCED_DRAFT';
  const isDraftStrava = Boolean(isDraftSynced || (isStravaCompletion && !latestCompletion?.confirmedAt));
  const strava = (latestCompletion?.metricsJson?.strava ?? {}) as Record<string, any>;

  const formatZonedTime = (isoString: string | undefined) => formatTimeInTimezone(isoString, athleteTimezone);

  const formatZonedDateTime = (isoString: string | undefined) => {
    if (!isoString) return null;
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat(undefined, {
      timeZone: athleteTimezone,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  };

  // Strava Metrics
  const stravaType = (strava.sportType ?? strava.type ?? strava.sport_type ?? strava.activityType) as string | undefined;
  const stravaName = (strava.name ?? strava.activityName) as string | undefined;
  const stravaStartUtc = latestCompletion?.effectiveStartTimeUtc;
  const stravaAvgSpeedMps = (strava.averageSpeedMps ?? strava.avgSpeedMps ?? strava.average_speed) as number | undefined;
  const stravaAvgPaceSecPerKm = (strava.avgPaceSecPerKm ?? strava.avg_pace_sec_per_km) as number | undefined;
  const derivedPaceSecPerKm =
    item.discipline === 'RUN' && stravaAvgSpeedMps && Number.isFinite(stravaAvgSpeedMps) && stravaAvgSpeedMps > 0
      ? Math.round(1000 / stravaAvgSpeedMps)
      : undefined;
  const stravaAvgHr = (strava.averageHeartrateBpm ?? strava.avgHr ?? strava.average_heartrate) as number | undefined;
  const stravaMaxHr = (strava.maxHeartrateBpm ?? strava.maxHr ?? strava.max_heartrate) as number | undefined;
  const stravaMaxSpeedMps = (strava.maxSpeedMps ?? strava.max_speed) as number | undefined;
  const stravaMovingTimeSec = (strava.movingTimeSec ?? strava.moving_time) as number | undefined;
  const stravaElapsedTimeSec = (strava.elapsedTimeSec ?? strava.elapsed_time) as number | undefined;
  const stravaElevationGainM = (strava.totalElevationGainM ?? strava.total_elevation_gain) as number | undefined;
  const stravaCaloriesKcal = getStravaCaloriesKcal(strava) ?? undefined;
  const stravaCadenceRpm = (strava.averageCadenceRpm ?? strava.average_cadence) as number | undefined;

  const stravaActivity = (strava.activity ?? strava) as Record<string, any>;
  const stravaDescription = typeof stravaActivity.description === 'string' ? stravaActivity.description.trim() : null;
  const stravaDeviceName = typeof stravaActivity.device_name === 'string' ? stravaActivity.device_name.trim() : null;
  const stravaLocationCity = typeof stravaActivity.location_city === 'string' ? stravaActivity.location_city.trim() : null;
  const stravaSummaryPolyline =
    (typeof stravaActivity.map?.summary_polyline === 'string' ? stravaActivity.map.summary_polyline : null) ??
    (typeof stravaActivity.summary_polyline === 'string' ? stravaActivity.summary_polyline : null) ??
    (typeof stravaActivity.summaryPolyline === 'string' ? stravaActivity.summaryPolyline : null) ??
    (typeof (strava as any).summaryPolyline === 'string' ? (strava as any).summaryPolyline : null);

  const stravaAverageWatts = (stravaActivity.average_watts ?? stravaActivity.averageWatts) as number | undefined;
  const stravaMaxWatts = (stravaActivity.max_watts ?? stravaActivity.maxWatts) as number | undefined;
  const stravaSufferScore = (stravaActivity.suffer_score ?? stravaActivity.sufferScore) as number | undefined;
  const stravaPerceivedExertion = (stravaActivity.perceived_exertion ?? stravaActivity.perceivedExertion) as number | string | undefined;

  const activityAverageHeartrate =
    (stravaActivity.average_heartrate ?? stravaActivity.averageHeartrate ?? stravaAvgHr) as number | undefined;
  const activityMaxHeartrate = (stravaActivity.max_heartrate ?? stravaActivity.maxHeartrate ?? stravaMaxHr) as number | undefined;

  const actualTimeLabel = formatZonedTime(stravaStartUtc);
  const actualDateTimeLabel = formatZonedDateTime(stravaStartUtc);
  const avgSpeedLabel = item.discipline === 'BIKE' ? formatSpeedKmh(stravaAvgSpeedMps) : null;
  const avgPaceLabel = item.discipline === 'RUN' ? formatPace(stravaAvgPaceSecPerKm ?? derivedPaceSecPerKm) : null;
  const maxSpeedLabel = item.discipline === 'BIKE' ? formatSpeedKmh(stravaMaxSpeedMps) : null;
  const movingTimeLabel = formatDurationHms(stravaMovingTimeSec);
  const elapsedTimeLabel = formatDurationHms(stravaElapsedTimeSec);
  const elevationGainLabel = formatIntUnit(stravaElevationGainM, 'm');
  const caloriesLabel = formatIntUnit(stravaCaloriesKcal, 'kcal');
  const cadenceLabel = formatIntUnit(stravaCadenceRpm, 'rpm');

  const statusIndicator = getSessionStatusIndicator({
    status: item.status,
    date: item.date,
    timeZone: athleteTimezone,
  });

  const headerTimeLabel = item.plannedStartTimeLocal ?? 'Anytime';
  
  // Planned data
  const plannedDuration = item.plannedDurationMinutes ? `${item.plannedDurationMinutes} min` : null;
  const plannedDistance = item.plannedDistanceKm ? `${item.plannedDistanceKm} km` : item.distanceMeters ? `${(item.distanceMeters/1000).toFixed(2)} km` : null;

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header Info (Title, Status, Weather) if not in Drawer, or specialized header */}
      {!isDrawer && (
        <div className="flex flex-col gap-2">
           <div className="flex items-center gap-2">
            {statusIndicator ? (
              <Icon 
                name={statusIndicator.icon} 
                className={statusIndicator.colorClass} 
                size="md" 
              />
            ) : null}
            <h1 className={tokens.typography.h2}>{item.title}</h1>
           </div>
           <div className={cn(tokens.typography.bodyMuted, 'flex items-center gap-2')}>
             <span>{formatDisplay(item.date)}</span>
             <span>·</span>
             <span>{headerTimeLabel}</span>
           </div>
        </div>
      )}

      <div className={cn('grid grid-cols-1 gap-6', isDrawer ? '' : 'lg:grid-cols-2')}>
        {/* LEFT COLUMN: Planned */}
        <div className="space-y-6">
          <Block title="Workout Plan">
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center gap-3">
                 {(() => {
                    const theme = getDisciplineTheme(item.discipline);
                    return <Icon name={theme.iconName} size="md" className={theme.textClass} />;
                 })()}
                 <div>
                   <div className="text-sm font-medium">{item.discipline}</div>
                   <div className="text-xs text-[var(--muted)]">
                      {plannedDuration && <span>{plannedDuration}</span>}
                      {plannedDuration && plannedDistance && <span> · </span>}
                      {plannedDistance && <span>{plannedDistance}</span>}
                   </div>
                 </div>
              </div>
              
              {/* Fields */}
              <div className="grid grid-cols-2 gap-4">
                 <FieldRow label="Duration" value={plannedDuration} />
                 <FieldRow label="Distance" value={plannedDistance} />
                 <FieldRow label="Intensity" value={item.intensityTarget} className="col-span-2" />
                 
                 {(item.tags && item.tags.length > 0) && (
                    <div className="col-span-2">
                      <FieldLabel className="mb-1">Tags</FieldLabel>
                      <div className="flex flex-wrap gap-2">
                        {item.tags.map(t => (
                          <span key={t} className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-xs">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                 )}
              </div>

               {/* Description / Detail */}
               {item.workoutDetail && (
                 <div className="pt-4 border-t border-[var(--border-subtle)]">
                    <FieldLabel className="mb-2">Description</FieldLabel>
                    <div className={cn("whitespace-pre-wrap", tokens.typography.body)}>{item.workoutDetail}</div>
                 </div>
               )}

               {/* Structure */}
               {item.workoutStructure && (
                  <div className="pt-4 border-t border-[var(--border-subtle)]">
                    <FieldLabel className="mb-2">Structure</FieldLabel>
                    <WorkoutStructureView structure={item.workoutStructure} />
                  </div>
               )}

                {item.notes && (
                  <div className="pt-4 border-t border-[var(--border-subtle)]">
                    <FieldLabel className="mb-2">Coach Notes</FieldLabel>
                    <div className={cn("whitespace-pre-wrap", tokens.typography.body)}>{item.notes}</div>
                  </div>
                )}
            </div>
          </Block>

           {weather && weather.enabled && (
             <Block title="Weather Conditions">
                <div className="flex items-center gap-4">
                   <Icon name={WEATHER_ICON_NAME[weather.icon] || 'sunny'} size="lg" className="text-[var(--text)]" />
                   <div>
                      <div className="text-2xl font-bold">{Math.round(weather.maxTempC)}°C</div>
                      <div className="text-xs text-[var(--muted)]">Forecast for {formatDisplay(weather.date)}</div>
                   </div>
                   <div className="ml-auto text-right text-xs text-[var(--muted)]">
                     <div>Sunrise: {weather.sunriseLocal}</div>
                     <div>Sunset: {weather.sunsetLocal}</div>
                   </div>
                </div>
             </Block>
           )}
        </div>

        {/* RIGHT COLUMN: Actual */}
        <div className="space-y-6">
           {latestCompletion && (
             <Block title={isStravaCompletion ? "Strava Activity" : "Completed Activity"}>
                <div className="space-y-4">
                  {isStravaCompletion && (
                    <div className="flex items-center gap-2 mb-4">
                       <span className="text-[#fc4c02] font-bold text-xs uppercase tracking-wide">Strava Synced</span>
                       {latestCompletion.confirmedAt && (
                         <span className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                           Confirmed
                         </span>
                       )}
                    </div>
                  )}

                  {!isStravaCompletion && (
                     <div className="grid grid-cols-2 gap-4">
                        <FieldRow label="Duration" value={`${latestCompletion.durationMinutes} min`} />
                        <FieldRow label="Distance" value={latestCompletion.distanceKm ? `${latestCompletion.distanceKm} km` : null} />
                        <FieldRow label="RPE" value={latestCompletion.rpe ? `${latestCompletion.rpe}/10` : null} />
                        <FieldRow label="Pain?" value={latestCompletion.painFlag ? 'Yes' : 'No'} valueClassName={latestCompletion.painFlag ? 'text-rose-500 font-bold' : ''} />
                     </div>
                  )}

                  {hasStravaMetrics && (
                    <>
                      {stravaName && <div className={tokens.typography.h3}>{stravaName}</div>}
                      
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        <FieldRow label="Time" value={actualTimeLabel} />
                        <FieldRow label="Moving Time" value={movingTimeLabel} />
                        <FieldRow label="Distance" value={formatKm(strava.distance)} />
                        
                        <FieldRow label="Avg HR" value={formatIntUnit(activityAverageHeartrate, 'bpm')} />
                        <FieldRow label="Max HR" value={formatIntUnit(activityMaxHeartrate, 'bpm')} />
                        <FieldRow label="Calories" value={caloriesLabel} />
                        
                        <FieldRow label="Elevation" value={elevationGainLabel} />
                        {avgPaceLabel && <FieldRow label="Avg Pace" value={avgPaceLabel} />}
                        {avgSpeedLabel && <FieldRow label="Avg Speed" value={avgSpeedLabel} />}
                        {stravaAverageWatts && <FieldRow label="Avg Power" value={`${Math.round(stravaAverageWatts)}w`} />}
                      </div>

                      {stravaDescription && (
                        <div className="pt-4 border-t border-[var(--border-subtle)]">
                          <FieldLabel className="mb-1">Activity Description</FieldLabel>
                           <div className={cn("whitespace-pre-wrap text-sm")}>{stravaDescription}</div>
                        </div>
                      )}
                    </>
                  )}

                   {/* Map */}
                   {stravaSummaryPolyline && (
                      <div className="mt-4 overflow-hidden rounded-lg border border-[var(--border-subtle)] h-48">
                         <PolylineRouteMap polyline={stravaSummaryPolyline} />
                      </div>
                   )}

                  {/* Notes / Feedback */}
                  {(latestCompletion.notes || latestCompletion.rpe) && !hasStravaMetrics && (
                     <div className="pt-4 border-t border-[var(--border-subtle)] mt-4">
                       {latestCompletion.notes && (
                         <div className="mb-4">
                            <FieldLabel className="mb-1">Feedback</FieldLabel>
                            <div className="whitespace-pre-wrap text-sm">{latestCompletion.notes}</div>
                         </div>
                       )}
                     </div>
                  )}
                  
                  {/* RPE/Pain for Strava too if set manually confirm */}
                  {hasStravaMetrics && (latestCompletion.rpe || latestCompletion.painFlag) && (
                     <div className="grid grid-cols-2 gap-4 pt-4 border-t border-[var(--border-subtle)]">
                        <FieldRow label="RPE" value={latestCompletion.rpe ? `${latestCompletion.rpe}/10` : '-'} />
                        <FieldRow label="Pain?" value={latestCompletion.painFlag ? 'Yes' : 'No'} valueClassName={latestCompletion.painFlag ? 'text-rose-500 font-bold' : ''} />
                     </div>
                  )}

                </div>
             </Block>
           )}

           {uncompletedActionSlot && (
             <div className="contents">{uncompletedActionSlot}</div>
           )}

           {!latestCompletion && !isDrawer && !uncompletedActionSlot && (
             <Block>
               <div className="p-8 text-center text-[var(--muted)]">
                 No activity recorded yet.
               </div>
             </Block>
           )}
        </div>
      </div>
    </div>
  );
}

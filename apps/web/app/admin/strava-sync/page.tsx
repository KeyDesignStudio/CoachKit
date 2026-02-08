import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { combineDateWithLocalTime } from '@/lib/date';
import { getLocalDayKey } from '@/lib/day-key';
import { tokens } from '@/components/ui/tokens';

export const dynamic = 'force-dynamic';

function formatTimestamp(value: Date | null): string {
  if (!value) return '—';
  return value.toISOString().replace('T', ' ').slice(0, 19);
}

function formatNumber(value: number | null): string {
  if (value == null) return '—';
  return String(value);
}

export default async function AdminStravaSyncPage() {
  await requireAdmin();

  const runs = await prisma.cronRun.findMany({
    where: { kind: 'STRAVA_SYNC' },
    orderBy: { startedAt: 'desc' },
    take: 20,
  });

  const lastSuccess = runs.find((run) => run.status === 'SUCCEEDED') ?? null;
  const lastSuccessAgeMs = lastSuccess ? Date.now() - lastSuccess.startedAt.getTime() : null;
  const showWarning = lastSuccessAgeMs == null || lastSuccessAgeMs > 24 * 60 * 60 * 1000;

  const recentActivities = await prisma.completedActivity.findMany({
    where: { source: 'STRAVA' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      externalActivityId: true,
      startTime: true,
      matchDayDiff: true,
      matchTimeDiffMinutes: true,
      metricsJson: true,
      calendarItemId: true,
      calendarItem: {
        select: {
          id: true,
          title: true,
          date: true,
          plannedStartTimeLocal: true,
          origin: true,
        },
      },
      athlete: {
        select: {
          userId: true,
          timezone: true,
        },
      },
    },
  });

  return (
    <section className={cn(tokens.spacing.screenPadding, 'pb-10')}>
      <div className="pt-6">
        <h1 className={tokens.typography.h1}>Strava Sync Monitor</h1>
        <p className={cn(tokens.typography.bodyMuted, 'mt-2')}>
          Daily sync (Hobby-safe). Last 20 cron runs for Strava autosync.
        </p>
      </div>

      {showWarning ? (
        <div className={cn('mt-4 rounded-2xl border border-amber-300 bg-amber-50 text-amber-800', tokens.spacing.containerPadding)}>
          <div className={cn(tokens.typography.body)}>
            Warning: No successful Strava cron run in the last 24 hours.
          </div>
        </div>
      ) : null}

      <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--border-subtle)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--bg-structure)]/40 text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Started</th>
              <th className="px-3 py-2 text-left">Finished</th>
              <th className="px-3 py-2 text-left">Duration</th>
              <th className="px-3 py-2 text-left">Athletes</th>
              <th className="px-3 py-2 text-left">Imported</th>
              <th className="px-3 py-2 text-left">Matched</th>
              <th className="px-3 py-2 text-left">Unplanned</th>
              <th className="px-3 py-2 text-left">Errors</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-[var(--muted)]" colSpan={9}>
                  No Strava cron runs recorded yet.
                </td>
              </tr>
            ) : (
              runs.map((run) => (
                <tr key={run.id} className="border-t border-[var(--border-subtle)]">
                  <td className="px-3 py-2 font-medium">{run.status}</td>
                  <td className="px-3 py-2 tabular-nums">{formatTimestamp(run.startedAt)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatTimestamp(run.finishedAt)}</td>
                  <td className="px-3 py-2 tabular-nums">{run.durationMs != null ? `${run.durationMs}ms` : '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{formatNumber(run.processedAthletes)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatNumber(run.importedActivities)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatNumber(run.matchedActivities)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatNumber(run.unplannedActivities)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {run.errorCount != null ? run.errorCount : '—'}
                    {run.firstError ? ` · ${run.firstError}` : ''}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <h2 className={cn(tokens.typography.h2, 'mb-2')}>Recent Strava activity placement</h2>
        <p className={cn(tokens.typography.bodyMuted, 'mb-4')}>
          Last 5 synced activities with athlete-local day keys and linked calendar items.
        </p>

        <div className="overflow-x-auto rounded-2xl border border-[var(--border-subtle)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-structure)]/40 text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Strava Activity</th>
                <th className="px-3 py-2 text-left">Strava Start (UTC)</th>
                <th className="px-3 py-2 text-left">Athlete Local Day</th>
                <th className="px-3 py-2 text-left">Calendar Item</th>
                <th className="px-3 py-2 text-left">Calendar Day</th>
                <th className="px-3 py-2 text-left">Materialised</th>
              </tr>
            </thead>
            <tbody>
              {recentActivities.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-[var(--muted)]" colSpan={6}>
                    No Strava activities found yet.
                  </td>
                </tr>
              ) : (
                recentActivities.map((activity) => {
                  const timeZone = activity.athlete?.timezone ?? 'UTC';
                  const stravaStartUtcRaw = (activity.metricsJson as any)?.strava?.startDateUtc;
                  const stravaStartUtc = stravaStartUtcRaw ? new Date(stravaStartUtcRaw) : activity.startTime;
                  const stravaStartLabel = stravaStartUtc.toISOString().replace('T', ' ').slice(0, 19);
                  const activityDayKey = getLocalDayKey(stravaStartUtc, timeZone);

                  const calendarItem = activity.calendarItem;
                  const calendarStartUtc = calendarItem
                    ? combineDateWithLocalTime(calendarItem.date, calendarItem.plannedStartTimeLocal)
                    : null;
                  const calendarDayKey = calendarStartUtc ? getLocalDayKey(calendarStartUtc, timeZone) : '—';
                  const materialised = calendarDayKey !== '—' && calendarDayKey === activityDayKey ? 'Yes' : 'No';
                  const calendarLabel = calendarItem
                    ? `${calendarItem.title ?? 'Planned session'} · ${calendarItem.origin ?? 'PLANNED'}`
                    : '—';

                  return (
                    <tr key={activity.id} className="border-t border-[var(--border-subtle)]">
                      <td className="px-3 py-2 tabular-nums">{activity.externalActivityId ?? '—'}</td>
                      <td className="px-3 py-2 tabular-nums">{stravaStartLabel}</td>
                      <td className="px-3 py-2 tabular-nums">{activityDayKey}</td>
                      <td className="px-3 py-2">{calendarLabel}</td>
                      <td className="px-3 py-2 tabular-nums">{calendarDayKey}</td>
                      <td className="px-3 py-2 font-medium">{materialised}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { cn } from '@/lib/cn';
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
    </section>
  );
}

import Link from 'next/link';

import { requireAthlete } from '@/lib/auth';

import { requireAiPlanBuilderV1Enabled } from '@/modules/ai-plan-builder/server/flag';
import { getPublishedAiPlanForAthlete } from '@/modules/ai-plan-builder/server/athlete-plan';
import { DAY_NAMES_SUN0, daySortKey, normalizeWeekStart } from '@/modules/ai-plan-builder/lib/week-start';

import { PublishUpdateBanner } from './PublishUpdateBanner';

export default async function AthleteAiPlanViewPage(props: { params: { aiPlanDraftId: string } }) {
  requireAiPlanBuilderV1Enabled();
  const { user } = await requireAthlete();

  const draft = await getPublishedAiPlanForAthlete({ athleteId: user.id, aiPlanDraftId: props.params.aiPlanDraftId });

  const weekStart = normalizeWeekStart((draft as any)?.setupJson?.weekStart);

  const sessionsByWeek = new Map<number, typeof draft.sessions>();
  for (const s of draft.sessions) {
    const list = sessionsByWeek.get(s.weekIndex) ?? [];
    list.push(s);
    sessionsByWeek.set(s.weekIndex, list);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">AI Plan</h1>
          <div className="mt-1 text-xs text-[var(--fg-muted)]">
            Published:{' '}
            {draft.publishedAt ? new Date(draft.publishedAt).toLocaleString() : '—'}
          </div>
        </div>
        <Link href="/athlete/dashboard" className="text-sm text-[var(--fg-muted)] hover:underline">
          Back
        </Link>
      </div>

      <PublishUpdateBanner
        aiPlanDraftId={String(draft.id)}
        initialLastPublishedSummaryText={draft.lastPublishedSummaryText ?? null}
      />

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3">
        <div className="text-sm font-medium">Latest publish summary</div>
        <pre className="mt-2 whitespace-pre-wrap text-xs text-[var(--fg-muted)]">{draft.lastPublishedSummaryText ?? '—'}</pre>
      </div>

      <div className="space-y-3">
        {draft.weeks.map((w) => {
          const weekSessions = (sessionsByWeek.get(w.weekIndex) ?? [])
            .slice()
            .sort(
              (a, b) =>
                daySortKey(a.dayOfWeek, weekStart) - daySortKey(b.dayOfWeek, weekStart) || a.ordinal - b.ordinal
            );
          return (
            <div key={w.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Week {w.weekIndex + 1}</div>
                <div className="text-xs text-[var(--fg-muted)]">{w.totalMinutes} min</div>
              </div>

              <div className="mt-2 space-y-2">
                {weekSessions.length === 0 ? (
                  <div className="text-sm text-[var(--fg-muted)]">No sessions.</div>
                ) : (
                  weekSessions.map((s) => (
                    <Link
                      key={s.id}
                      href={`/athlete/ai-plan/${encodeURIComponent(String(draft.id))}/session/${encodeURIComponent(String(s.id))}`}
                      className="block rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2"
                      data-testid="athlete-ai-plan-session"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">{s.type}</div>
                        <div className="text-xs text-[var(--fg-muted)]">{s.durationMinutes} min</div>
                      </div>
                      <div className="mt-1 text-xs text-[var(--fg-muted)]">
                        {s.discipline} • {DAY_NAMES_SUN0[Number(s.dayOfWeek) % 7]}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

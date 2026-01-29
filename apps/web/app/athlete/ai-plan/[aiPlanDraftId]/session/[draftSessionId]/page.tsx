import Link from 'next/link';

import { requireAthlete } from '@/lib/auth';

import { requireAiPlanBuilderV1Enabled } from '@/modules/ai-plan-builder/server/flag';
import { getPublishedAiPlanSessionForAthlete } from '@/modules/ai-plan-builder/server/athlete-plan';

import { AthleteFeedbackForm } from './AthleteFeedbackForm';

export default async function AthleteAiPlanSessionPage(props: {
  params: { aiPlanDraftId: string; draftSessionId: string };
}) {
  requireAiPlanBuilderV1Enabled();
  const { user } = await requireAthlete();

  const { draft, session } = await getPublishedAiPlanSessionForAthlete({
    athleteId: user.id,
    aiPlanDraftId: props.params.aiPlanDraftId,
    draftSessionId: props.params.draftSessionId,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Session</h1>
          <div className="mt-1 text-xs text-[var(--fg-muted)]">Draft: {String(draft.id)}</div>
        </div>
        <Link
          href={`/athlete/ai-plan/${encodeURIComponent(String(draft.id))}`}
          className="text-sm text-[var(--fg-muted)] hover:underline"
        >
          Back
        </Link>
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3">
        <div className="text-sm font-medium">{session.type}</div>
        <div className="mt-1 text-xs text-[var(--fg-muted)]">
          {session.discipline} • day {session.dayOfWeek} • {session.durationMinutes} min
        </div>
        {session.notes ? (
          <pre className="mt-3 whitespace-pre-wrap text-sm text-[var(--fg-muted)]">{session.notes}</pre>
        ) : (
          <div className="mt-3 text-sm text-[var(--fg-muted)]">No notes.</div>
        )}
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3">
        <div className="text-sm font-medium">Log feedback</div>
        <div className="mt-3">
          <AthleteFeedbackForm aiPlanDraftId={String(draft.id)} draftSessionId={String(session.id)} />
        </div>
      </div>
    </div>
  );
}

import { redirect } from 'next/navigation';

import { requireAthlete } from '@/lib/auth';

import { requireAiPlanBuilderV1Enabled } from '@/modules/ai-plan-builder/server/flag';
import { getLatestPublishedAiPlanForAthlete } from '@/modules/ai-plan-builder/server/athlete-plan';

export default async function AthleteAiPlanIndexPage() {
  requireAiPlanBuilderV1Enabled();
  const { user } = await requireAthlete();

  const latest = await getLatestPublishedAiPlanForAthlete({ athleteId: user.id });

  if (!latest) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-lg font-semibold">AI Plan</h1>
        <p className="mt-2 text-sm text-[var(--fg-muted)]">No published AI plan yet.</p>
      </div>
    );
  }

  redirect(`/athlete/ai-plan/${encodeURIComponent(String(latest.id))}`);
}

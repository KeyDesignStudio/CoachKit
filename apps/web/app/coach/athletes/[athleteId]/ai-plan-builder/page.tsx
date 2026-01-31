import { notFound } from 'next/navigation';

import { isAiPlanBuilderV1EnabledServer } from '@/lib/feature-flags';
import { AiPlanBuilderPage } from '@/modules/ai-plan-builder/ui/AiPlanBuilderPage';

export default async function AiPlanBuilderRoutePage({
  params,
}: {
  params: { athleteId: string };
}) {
  if (!isAiPlanBuilderV1EnabledServer()) {
    notFound();
  }

  return <AiPlanBuilderPage athleteId={params.athleteId} />;
}

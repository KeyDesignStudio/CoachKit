'use client';

import { AiPlanBuilderCoachV1 } from './AiPlanBuilderCoachV1';
import { AiPlanBuilderCoachV2 } from './AiPlanBuilderCoachV2';

export function AiPlanBuilderPage({ athleteId }: { athleteId: string }) {
  // V2 is now the default coach workflow. Keep V1 only as an explicit fallback.
  const useLegacyV1 = process.env.NEXT_PUBLIC_APB_USE_V1 === '1';
  if (useLegacyV1) {
    return <AiPlanBuilderCoachV1 athleteId={athleteId} />;
  }
  return <AiPlanBuilderCoachV2 athleteId={athleteId} />;
}

'use client';

import { AiPlanBuilderCoachV1 } from './AiPlanBuilderCoachV1';
import { AiPlanBuilderCoachV2 } from './AiPlanBuilderCoachV2';
import { AiPlanBuilderCoachJourney } from './AiPlanBuilderCoachJourney';

export function AiPlanBuilderPage({ athleteId }: { athleteId: string }) {
  // Journey rebuild is default. Keep v2/v1 as explicit fallback switches.
  const useLegacyV2 = process.env.NEXT_PUBLIC_APB_USE_V2 === '1';
  const useLegacyV1 = process.env.NEXT_PUBLIC_APB_USE_V1 === '1';
  if (useLegacyV1) {
    return <AiPlanBuilderCoachV1 athleteId={athleteId} />;
  }
  if (useLegacyV2) {
    return <AiPlanBuilderCoachV2 athleteId={athleteId} />;
  }
  return <AiPlanBuilderCoachJourney athleteId={athleteId} />;
}

'use client';

import { AiPlanBuilderCoachJourney } from './AiPlanBuilderCoachJourney';

export function AiPlanBuilderPage({ athleteId }: { athleteId: string }) {
  // V2 coach journey is the only supported surface.
  // Policy packs remain internal to generation and are never exposed as literal plan templates in UI.
  return <AiPlanBuilderCoachJourney athleteId={athleteId} />;
}

import { notFound } from '@/lib/errors';
import { isAiPlanBuilderV1EnabledServer } from '@/lib/feature-flags';

export function requireAiPlanBuilderV1Enabled(): void {
  if (!isAiPlanBuilderV1EnabledServer()) {
    // 404-by-default so the feature is effectively non-existent.
    throw notFound('Not found.');
  }
}

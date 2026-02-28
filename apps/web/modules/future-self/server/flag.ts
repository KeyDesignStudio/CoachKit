import { notFound } from '@/lib/errors';
import { isFutureSelfV1EnabledServer } from '@/lib/feature-flags';

export function requireFutureSelfV1Enabled(): void {
  if (!isFutureSelfV1EnabledServer()) {
    // 404-by-default so the feature is effectively non-existent.
    throw notFound('Not found.');
  }
}

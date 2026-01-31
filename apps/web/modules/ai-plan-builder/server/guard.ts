import { requireAiPlanBuilderV1Enabled } from './flag';

/**
 * Must be called at the top of every AI Plan Builder request handler.
 *
 * Security: when the feature flag is OFF, routes must behave as if they don't exist.
 * This check must happen before auth/validation to avoid information leaks.
 */
export function guardAiPlanBuilderRequest(): void {
  requireAiPlanBuilderV1Enabled();
}

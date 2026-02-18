import { getAiPlanBuilderAIWithHooks } from '../ai/factory';
import { getAiPlanBuilderLlmRateLimitPerHourForCapabilityFromEnv } from '../ai/config';

import { consumeLlmRateLimitOrThrow } from './llm-rate-limit';
import { recordAiInvocationAudit } from './ai-invocation-audit';

export function getAiPlanBuilderAIForCoachRequest(params: { coachId: string; athleteId?: string }) {
  const ctx = { actorType: 'COACH' as const, actorId: params.coachId, coachId: params.coachId, athleteId: params.athleteId };

  return getAiPlanBuilderAIWithHooks({
    beforeLlmCall: async ({ capability }) => {
      await consumeLlmRateLimitOrThrow({
        actorType: ctx.actorType,
        actorId: ctx.actorId,
        capability,
        coachId: ctx.coachId,
        athleteId: ctx.athleteId,
      }, {
        limitPerHour: getAiPlanBuilderLlmRateLimitPerHourForCapabilityFromEnv(capability),
      });
    },
    onInvocation: async (meta) => {
      try {
        await recordAiInvocationAudit(meta, ctx);
      } catch (err) {
        // Do not block the workflow if auditing fails.
        // eslint-disable-next-line no-console
        console.warn('AI_INVOCATION_AUDIT_FAILED', { capability: meta.capability, error: err instanceof Error ? err.message : String(err) });
      }
    },
  });
}

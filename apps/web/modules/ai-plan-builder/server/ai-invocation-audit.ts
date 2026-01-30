import { prisma } from '@/lib/prisma';

import type { AiInvocationAuditMeta } from '../ai/audit';
import type { AiInvocationActorType } from './llm-rate-limit';

export type AiInvocationAuditContext = {
  actorType: AiInvocationActorType;
  actorId: string;
  coachId?: string;
  athleteId?: string;
};

export async function recordAiInvocationAudit(meta: AiInvocationAuditMeta, ctx: AiInvocationAuditContext): Promise<void> {
  // Safety: metadata only. Never persist raw prompts/outputs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await prisma.aiInvocationAudit.create({
    data: {
      actorType: ctx.actorType as any,
      actorId: ctx.actorId,
      coachId: ctx.coachId,
      athleteId: ctx.athleteId,

      capability: meta.capability,
      specVersion: meta.specVersion,
      effectiveMode: meta.effectiveMode,

      provider: meta.provider,
      model: meta.model,

      inputHash: meta.inputHash,
      outputHash: meta.outputHash,

      durationMs: Math.max(0, Math.trunc(meta.durationMs)),
      maxOutputTokens: meta.maxOutputTokens === null ? null : Math.max(0, Math.trunc(meta.maxOutputTokens)),
      timeoutMs: meta.timeoutMs === null ? null : Math.max(0, Math.trunc(meta.timeoutMs)),
      retryCount: Math.max(0, Math.trunc(meta.retryCount)),
      fallbackUsed: Boolean(meta.fallbackUsed),
      errorCode: meta.errorCode,
    },
  });
}

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import { getAiPlanBuilderLlmRateLimitPerHourFromEnv } from '../ai/config';

export type AiInvocationActorType = 'COACH' | 'ATHLETE' | 'SYSTEM';

export type LlmRateLimitContext = {
  actorType: AiInvocationActorType;
  actorId: string;
  capability: string;
  coachId?: string;
  athleteId?: string;
};

export type AiRateLimitStore = {
  countEventsSince(params: { actorType: AiInvocationActorType; actorId: string; since: Date }): Promise<number>;
  createEvent(params: {
    actorType: AiInvocationActorType;
    actorId: string;
    capability: string;
    coachId?: string;
    athleteId?: string;
  }): Promise<void>;
};

export class PrismaAiRateLimitStore implements AiRateLimitStore {
  async countEventsSince(params: { actorType: AiInvocationActorType; actorId: string; since: Date }): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (prisma as any).aiLlmRateLimitEvent.count({
      where: {
        actorType: params.actorType as any,
        actorId: params.actorId,
        createdAt: { gte: params.since },
      },
    });
  }

  async createEvent(params: {
    actorType: AiInvocationActorType;
    actorId: string;
    capability: string;
    coachId?: string;
    athleteId?: string;
  }): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).aiLlmRateLimitEvent.create({
      data: {
        actorType: params.actorType as any,
        actorId: params.actorId,
        capability: params.capability,
        coachId: params.coachId,
        athleteId: params.athleteId,
      },
    });
  }
}

export async function consumeLlmRateLimitOrThrow(
  ctx: LlmRateLimitContext,
  options?: { now?: Date; store?: AiRateLimitStore; limitPerHour?: number }
): Promise<void> {
  const now = options?.now ?? new Date();
  const store: AiRateLimitStore = options?.store ?? new PrismaAiRateLimitStore();
  const limitPerHour = options?.limitPerHour ?? getAiPlanBuilderLlmRateLimitPerHourFromEnv();

  const since = new Date(now.getTime() - 60 * 60 * 1000);

  // Best-effort atomicity: perform count+insert in one transaction for Prisma store.
  // If a custom store is provided, it is responsible for its own atomicity.
  if (store instanceof PrismaAiRateLimitStore) {
    await prisma.$transaction(async (tx) => {
      const count = await (tx as any).aiLlmRateLimitEvent.count({
        where: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          actorType: ctx.actorType as any,
          actorId: ctx.actorId,
          createdAt: { gte: since },
        },
      });

      if (count >= limitPerHour) {
        throw new ApiError(429, 'LLM_RATE_LIMITED', 'LLM rate limit exceeded. Please retry in about an hour.');
      }

      await (tx as any).aiLlmRateLimitEvent.create({
        data: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          actorType: ctx.actorType as any,
          actorId: ctx.actorId,
          capability: ctx.capability,
          coachId: ctx.coachId,
          athleteId: ctx.athleteId,
        },
      });
    });
    return;
  }

  const count = await store.countEventsSince({ actorType: ctx.actorType, actorId: ctx.actorId, since });
  if (count >= limitPerHour) {
    throw new ApiError(429, 'LLM_RATE_LIMITED', 'LLM rate limit exceeded. Please retry in about an hour.');
  }

  await store.createEvent({
    actorType: ctx.actorType,
    actorId: ctx.actorId,
    capability: ctx.capability,
    coachId: ctx.coachId,
    athleteId: ctx.athleteId,
  });
}

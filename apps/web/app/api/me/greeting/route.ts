import { NextRequest } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { getFirstName, getTimeOfDay, getWarmWelcomeMessage, sanitizeAiGreeting } from '@/lib/user-greeting';
import { getAiPlanBuilderLlmConfig, getAiPlanBuilderLlmTransport } from '@/modules/ai-plan-builder/ai/providers/factory';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  context: z.string().trim().max(320).optional(),
  completedToday: z.coerce.number().int().min(0).max(12).optional(),
  scheduledToday: z.coerce.number().int().min(0).max(12).optional(),
});

const greetingSchema = z
  .object({
    greeting: z.string().min(12).max(260),
  })
  .strict();

const sourceSchema = z.enum(['ai', 'fallback']);

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const parsed = querySchema.parse({
      context: request.nextUrl.searchParams.get('context') ?? undefined,
      completedToday: request.nextUrl.searchParams.get('completedToday') ?? undefined,
      scheduledToday: request.nextUrl.searchParams.get('scheduledToday') ?? undefined,
    });

    const firstName = getFirstName(user.name);
    const timeOfDay = getTimeOfDay(user.timezone);
    const fallback = getWarmWelcomeMessage({ name: user.name, timeZone: user.timezone });

    const llmInput = {
      firstName,
      timeOfDay,
      role: String(user.role).toLowerCase(),
      workoutContext: parsed.context ?? '',
      completedToday: parsed.completedToday ?? 0,
      scheduledToday: parsed.scheduledToday ?? 0,
    };

    let greeting = fallback;
    let source: z.infer<typeof sourceSchema> = 'fallback';

    try {
      const cfg = getAiPlanBuilderLlmConfig();
      const transport = getAiPlanBuilderLlmTransport();

      const result = await transport.generateStructuredJson({
        system:
          "APB_CAPABILITY=generateSessionDetail\n" +
          'You write one short motivational greeting for a sports training app.\n' +
          "Return JSON only with key 'greeting'.\n" +
          "Format must be: G'day {firstName}. <one or two short sentences>.\n" +
          'Keep it natural, warm, and coach-grade.\n' +
          'Vary message focus naturally between physical, mental, educational, and practical coaching cues.\n' +
          'Do not force both physical and mental themes in every greeting.\n' +
          'Mention morning/afternoon/evening logically.\n' +
          'If role is athlete: only mention training when it is explicitly supported by completedToday or scheduledToday counts.\n' +
          'Use past tense only for completedToday > 0.\n' +
          'Use future tense only for scheduledToday > 0.\n' +
          'If both are 0, do not imply any completed or scheduled workout today.\n' +
          'If workoutContext is provided, use it as factual context only.\n' +
          'Avoid hype, avoid emojis, avoid hashtags, avoid lists, avoid quotes.',
        input: JSON.stringify(llmInput),
        schema: greetingSchema,
        model: cfg.model || 'gpt-4o-mini',
        maxOutputTokens: 140,
        timeoutMs: Math.min(cfg.timeoutMs || 20000, 8000),
      });

      greeting = sanitizeAiGreeting({
        rawGreeting: result.greeting,
        firstName,
        timeOfDay,
        completedToday: parsed.completedToday ?? 0,
        scheduledToday: parsed.scheduledToday ?? 0,
        role: String(user.role).toLowerCase(),
      });
      source = 'ai';
    } catch {
      greeting = fallback;
      source = 'fallback';
    }

    return success(
      {
        greeting,
        source,
        timeOfDay,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    return handleError(error);
  }
}

import { NextRequest } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { getFirstName, getTimeOfDay, getWarmWelcomeMessage, sanitizeAiGreeting } from '@/lib/user-greeting';
import { getAiPlanBuilderLlmConfig, getAiPlanBuilderLlmTransport } from '@/modules/ai-plan-builder/ai/providers/factory';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  context: z.string().trim().max(320).optional(),
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
    });

    const firstName = getFirstName(user.name);
    const timeOfDay = getTimeOfDay(user.timezone);
    const fallback = getWarmWelcomeMessage({ name: user.name, timeZone: user.timezone });

    const llmInput = {
      firstName,
      timeOfDay,
      role: String(user.role).toLowerCase(),
      workoutContext: parsed.context ?? '',
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
          'Reference physical and mental wellbeing.\n' +
          'Mention morning/afternoon/evening logically.\n' +
          'If workoutContext is provided, weave in a subtle specific nod to completed or scheduled training.\n' +
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


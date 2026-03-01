import { NextRequest } from 'next/server';
import { AssistantLlmOutputType } from '@prisma/client';
import { z } from 'zod';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { getCoachDetectionOrThrow } from '@/modules/assistant/server/detections';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tone: z.enum(['direct', 'encouraging', 'matter_of_fact']).default('matter_of_fact'),
  includeEvidence: z.boolean().default(false),
  recommendationId: z.string().trim().min(1).optional(),
});

function tonePrefix(tone: z.infer<typeof bodySchema>['tone']) {
  if (tone === 'direct') return 'Quick adjustment: ';
  if (tone === 'encouraging') return 'You\'re doing good work. '; 
  return '';
}

function compactEvidenceString(evidence: unknown) {
  const str = JSON.stringify(evidence);
  if (!str) return '';
  return str.length > 220 ? `${str.slice(0, 220)}...` : str;
}

export async function POST(request: NextRequest, context: { params: Promise<{ detectionId: string }> }) {
  try {
    const { user } = await requireCoach();
    const { detectionId } = await context.params;
    const payload = bodySchema.parse(await request.json());

    const detection = await getCoachDetectionOrThrow({ detectionId, coachId: user.id });
    const recommendation = payload.recommendationId
      ? detection.recommendations.find((row) => row.id === payload.recommendationId)
      : detection.recommendations[0] ?? null;

    const llmDraft = detection.llmOutputs.find((row) => row.outputType === AssistantLlmOutputType.ATHLETE_MESSAGE_DRAFT)?.content?.trim();
    const recommendationLine = recommendation ? ` ${recommendation.title}.` : '';

    let message = llmDraft || `I noticed a pattern around ${detection.patternDefinition.name.toLowerCase()}.${recommendationLine}`;
    message = `${tonePrefix(payload.tone)}${message}`.trim();

    if (payload.includeEvidence) {
      const evidence = compactEvidenceString(detection.evidence);
      if (evidence) {
        message = `${message}\n\nEvidence snapshot: ${evidence}`;
      }
    }

    return success({
      draft: {
        detectionId: detection.id,
        recommendationId: recommendation?.id ?? null,
        tone: payload.tone,
        includeEvidence: payload.includeEvidence,
        message,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

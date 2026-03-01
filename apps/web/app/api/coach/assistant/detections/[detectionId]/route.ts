import { NextRequest } from 'next/server';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { getCoachDetectionOrThrow } from '@/modules/assistant/server/detections';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, context: { params: Promise<{ detectionId: string }> }) {
  try {
    const { user } = await requireCoach();
    const { detectionId } = await context.params;

    const detection = await getCoachDetectionOrThrow({ detectionId, coachId: user.id });

    return success({ detection });
  } catch (error) {
    return handleError(error);
  }
}

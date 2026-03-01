import { NextRequest } from 'next/server';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ensureCoachOwnsChallenge, recomputeChallengeScores } from '@/lib/challenges/service';

export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest, context: { params: { challengeId: string } }) {
  try {
    const { user } = await requireCoach();
    await ensureCoachOwnsChallenge(context.params.challengeId, user.id);
    const result = await recomputeChallengeScores(context.params.challengeId, { reason: 'manual_recalculate' });
    return success({ result });
  } catch (error) {
    return handleError(error);
  }
}

import { NextRequest } from 'next/server';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { duplicateChallenge } from '@/lib/challenges/service';

export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest, context: { params: { challengeId: string } }) {
  try {
    const { user } = await requireCoach();
    const challenge = await duplicateChallenge(context.params.challengeId, user.id);
    return success({ challenge }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

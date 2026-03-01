import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { ApiError } from '@/lib/errors';
import { completeDueChallenges, recomputeChallengeScores } from '@/lib/challenges/service';
import { prisma } from '@/lib/prisma';
import { handleError } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function cronAuthFailure() {
  return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
}

function requireCronAuth(request: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET ?? process.env.COACHKIT_CRON_SECRET;
  if (!expected) throw new ApiError(500, 'CRON_SECRET_MISSING', 'CRON_SECRET is not set.');

  const provided = request.headers.get('x-cron-secret');
  if (!provided) return cronAuthFailure();

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return cronAuthFailure();
  }

  return null;
}

export async function GET(request: NextRequest) {
  try {
    const authFailure = requireCronAuth(request);
    if (authFailure) return authFailure;

    const run = await prisma.cronRun.create({
      data: {
        kind: 'CHALLENGE_ROLLOVER',
        status: 'RUNNING',
        startedAt: new Date(),
      },
      select: { id: true },
    });

    const now = new Date();
    const active = await prisma.challenge.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });

    let recomputed = 0;
    for (const challenge of active) {
      const result = await recomputeChallengeScores(challenge.id, { reason: 'nightly_cron', now });
      if (!result.skipped) recomputed += 1;
    }

    const completion = await completeDueChallenges(now);

    await prisma.cronRun.update({
      where: { id: run.id },
      data: {
        status: 'DONE',
        finishedAt: new Date(),
        summaryJson: {
          recomputed,
          completedChallenges: completion.completed,
          dueChallenges: completion.due,
        },
      },
    });

    return NextResponse.json({ ok: true, recomputed, completion });
  } catch (error) {
    return handleError(error);
  }
}

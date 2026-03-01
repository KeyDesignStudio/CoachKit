import { NextRequest, NextResponse } from 'next/server';

import { requireCoach } from '@/lib/auth';
import { handleError } from '@/lib/http';
import { ensureCoachOwnsChallenge, formatChallengeScore } from '@/lib/challenges/service';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function quote(value: string | number | null | undefined) {
  const stringValue = String(value ?? '');
  if (!stringValue.includes(',') && !stringValue.includes('"') && !stringValue.includes('\n')) return stringValue;
  return `"${stringValue.replaceAll('"', '""')}"`;
}

export async function GET(_request: NextRequest, context: { params: { challengeId: string } }) {
  try {
    const { user } = await requireCoach();
    const challenge = await ensureCoachOwnsChallenge(context.params.challengeId, user.id);

    const rows = await prisma.challengeParticipant.findMany({
      where: { challengeId: challenge.id },
      select: {
        rank: true,
        score: true,
        sessionsCount: true,
        athlete: {
          select: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: [{ rank: 'asc' }, { athleteId: 'asc' }],
    });

    const lines = [
      ['rank', 'athleteId', 'athleteName', 'athleteEmail', 'score', 'scoreLabel', 'sessions'].join(','),
      ...rows.map((row) =>
        [
          row.rank,
          row.athlete.user.id,
          row.athlete.user.name ?? '',
          row.athlete.user.email,
          row.score,
          formatChallengeScore({
            score: row.score,
            type: challenge.type,
            scoringConfig: challenge.scoringConfig,
          }),
          row.sessionsCount,
        ]
          .map((value) => quote(value as any))
          .join(',')
      ),
    ];

    const body = `${lines.join('\n')}\n`;
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename=challenge-${challenge.id}-leaderboard.csv`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

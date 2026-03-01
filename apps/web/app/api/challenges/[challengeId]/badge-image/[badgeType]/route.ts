import { ChallengeBadgeType, UserRole } from '@prisma/client';
import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { forbidden, notFound } from '@/lib/errors';
import { handleError } from '@/lib/http';
import { parseRewardConfig } from '@/lib/challenges/config';
import { renderBadgeSvg } from '@/lib/challenges/badges';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  challengeId: z.string().min(1),
  badgeType: z.nativeEnum(ChallengeBadgeType),
});

export async function GET(_request: Request, context: { params: { challengeId: string; badgeType: string } }) {
  try {
    const { user } = await requireAuth();
    const { challengeId, badgeType } = paramsSchema.parse(context.params);

    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        coachId: true,
        squadId: true,
        title: true,
        startAt: true,
        rewardConfig: true,
        squad: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!challenge) throw notFound('Challenge not found.');

    if (user.role === UserRole.COACH) {
      if (challenge.coachId !== user.id) throw forbidden('You cannot view this badge.');
    } else if (user.role === UserRole.ATHLETE) {
      const membership = await prisma.squadMember.findUnique({
        where: {
          squadId_athleteId: {
            squadId: challenge.squadId,
            athleteId: user.id,
          },
        },
        select: { athleteId: true },
      });
      if (!membership) throw forbidden('You cannot view this badge.');
    } else if (user.role !== UserRole.ADMIN) {
      throw forbidden('You cannot view this badge.');
    }

    const [coachBranding, rewardConfig] = await Promise.all([
      prisma.coachBranding.findUnique({
        where: { coachId: challenge.coachId },
        select: { logoUrl: true },
      }),
      Promise.resolve(parseRewardConfig(challenge.rewardConfig)),
    ]);

    const svg = renderBadgeSvg({
      type: badgeType,
      challengeTitle: challenge.title,
      squadName: challenge.squad.name,
      logoUrl: coachBranding?.logoUrl ?? null,
      rewardConfig,
      startAt: challenge.startAt,
    });

    return new Response(svg, {
      status: 200,
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'private, max-age=300',
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

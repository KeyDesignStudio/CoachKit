import { NextRequest } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { ApiError, forbidden } from '@/lib/errors';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

const recipientsSchema = z
  .union([
    z.object({ allAthletes: z.literal(true) }),
    z.object({ athleteIds: z.array(z.string().min(1)).min(1) }),
  ])
  .optional();

const payloadSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  recipients: recipientsSchema,
});

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const payload = payloadSchema.parse(await request.json());

    if (user.role === 'ATHLETE') {
      const athleteProfile = await prisma.athleteProfile.findUnique({
        where: { userId: user.id },
        select: { coachId: true },
      });

      if (!athleteProfile) {
        throw new ApiError(400, 'ATHLETE_PROFILE_REQUIRED', 'Athlete profile not found.');
      }

      const thread = await prisma.messageThread.upsert({
        where: { coachId_athleteId: { coachId: athleteProfile.coachId, athleteId: user.id } },
        create: { coachId: athleteProfile.coachId, athleteId: user.id },
        update: {},
        select: { id: true },
      });

      await prisma.message.create({
        data: {
          threadId: thread.id,
          senderUserId: user.id,
          senderRole: 'ATHLETE',
          body: payload.body,
          athleteReadAt: new Date(),
        },
      });

      return success({ sent: 1, threadIds: [thread.id] });
    }

    // COACH
    if (!payload.recipients) {
      throw new ApiError(400, 'RECIPIENTS_REQUIRED', 'recipients is required for coach messages.');
    }

    let athleteIds: string[] = [];

    if ('allAthletes' in payload.recipients && payload.recipients.allAthletes) {
      const rows = await prisma.athleteProfile.findMany({
        where: { coachId: user.id },
        select: { userId: true },
        orderBy: [{ userId: 'asc' }],
      });
      athleteIds = rows.map((r) => r.userId);
    } else if ('athleteIds' in payload.recipients) {
      athleteIds = payload.recipients.athleteIds;
    }

    athleteIds = Array.from(new Set(athleteIds.map((id) => id.trim()).filter(Boolean)));

    if (athleteIds.length === 0) {
      throw new ApiError(400, 'NO_RECIPIENTS', 'No athletes selected.');
    }

    // Ownership enforcement: all selected athletes must be coached by this user.
    const owned = await prisma.athleteProfile.findMany({
      where: { coachId: user.id, userId: { in: athleteIds } },
      select: { userId: true },
    });

    const ownedSet = new Set(owned.map((a) => a.userId));
    const invalid = athleteIds.filter((id) => !ownedSet.has(id));

    if (invalid.length > 0) {
      // Keep error messages generic.
      throw forbidden('One or more athletes are not available for this coach.');
    }

    const now = new Date();
    const threadIds: string[] = [];

    await prisma.$transaction(async (tx) => {
      for (const athleteId of athleteIds) {
        const thread = await tx.messageThread.upsert({
          where: { coachId_athleteId: { coachId: user.id, athleteId } },
          create: { coachId: user.id, athleteId },
          update: {},
          select: { id: true },
        });

        threadIds.push(thread.id);

        await tx.message.create({
          data: {
            threadId: thread.id,
            senderUserId: user.id,
            senderRole: 'COACH',
            body: payload.body,
            coachReadAt: now,
          },
        });
      }
    });

    return success({ sent: athleteIds.length, threadIds });
  } catch (error) {
    return handleError(error);
  }
}

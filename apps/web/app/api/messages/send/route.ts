import { NextRequest } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { ApiError, forbidden } from '@/lib/errors';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

const recipientsSchema = z
  .object({
    allAthletes: z.boolean().optional(),
    athleteIds: z.array(z.string().min(1)).optional(),
    includeCoach: z.boolean().optional(),
  })
  .optional();

const payloadSchema = z.object({
  subject: z.string().trim().max(300).optional(),
  body: z.string().trim().min(1).max(3000),
  recipients: recipientsSchema,
});

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const payload = payloadSchema.parse(await request.json());
    const bodyText = payload.subject ? `Subject: ${payload.subject}\n\n${payload.body}` : payload.body;

    if (user.role === 'ATHLETE') {
      const athleteProfile = await prisma.athleteProfile.findUnique({
        where: { userId: user.id },
        select: { coachId: true },
      });

      if (!athleteProfile) {
        throw new ApiError(400, 'ATHLETE_PROFILE_REQUIRED', 'Athlete profile not found.');
      }

      const requestedAthleteIds = Array.from(
        new Set((payload.recipients?.athleteIds ?? []).map((id) => id.trim()).filter(Boolean))
      );
      const includeCoach = payload.recipients?.includeCoach ?? requestedAthleteIds.length === 0;

      if (requestedAthleteIds.length > 0) {
        const allowedRows = await prisma.athleteProfile.findMany({
          where: {
            coachId: athleteProfile.coachId,
            userId: { in: requestedAthleteIds },
          },
          select: { userId: true },
        });

        const allowedSet = new Set(allowedRows.map((row) => row.userId));
        const invalid = requestedAthleteIds.filter((id) => !allowedSet.has(id));
        if (invalid.length > 0) {
          throw forbidden('One or more recipients are not available in your squad.');
        }
      }

      const targetAthleteIds = includeCoach
        ? Array.from(new Set([user.id, ...requestedAthleteIds]))
        : requestedAthleteIds;

      if (!targetAthleteIds.length) {
        throw new ApiError(400, 'NO_RECIPIENTS', 'No recipients selected.');
      }

      const now = new Date();
      const threadIds: string[] = [];
      await prisma.$transaction(async (tx) => {
        for (const athleteId of targetAthleteIds) {
          const thread = await tx.messageThread.upsert({
            where: { coachId_athleteId: { coachId: athleteProfile.coachId, athleteId } },
            create: { coachId: athleteProfile.coachId, athleteId },
            update: {},
            select: { id: true },
          });
          threadIds.push(thread.id);

          await tx.message.create({
            data: {
              threadId: thread.id,
              senderUserId: user.id,
              senderRole: 'ATHLETE',
              body: bodyText,
              // If athlete is writing inside their own thread, mark their own side as read.
              athleteReadAt: athleteId === user.id ? now : null,
              coachReadAt: null,
            },
          });
        }
      });

      return success({ sent: targetAthleteIds.length, threadIds });
    }

    // COACH
    if (!payload.recipients) {
      throw new ApiError(400, 'RECIPIENTS_REQUIRED', 'recipients is required for coach messages.');
    }

    let athleteIds: string[] = [];

    if (payload.recipients.allAthletes) {
      const rows = await prisma.athleteProfile.findMany({
        where: { coachId: user.id },
        select: { userId: true },
        orderBy: [{ userId: 'asc' }],
      });
      athleteIds = rows.map((r) => r.userId);
    } else {
      athleteIds = payload.recipients.athleteIds ?? [];
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
            body: bodyText,
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

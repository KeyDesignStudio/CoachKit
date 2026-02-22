import { requireAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';

import { getLatestSubmittedIntake, getOpenIntakeDraft } from '@/modules/ai-plan-builder/server/intake';
import {
  computeTrainingRequestNextReminderDueAt,
  isTrainingRequestReminderMessage,
  isTrainingRequestStartMessage,
} from '@/modules/ai-plan-builder/shared/training-request';

export async function GET() {
  try {
    const { user } = await requireAthlete();
    const profile = await prisma.athleteProfile.findUnique({
      where: { userId: user.id },
      select: { coachId: true },
    });

    if (!profile?.coachId) {
      return success({
        intakeResponse: null,
        latestSubmittedIntake: null,
        openDraftIntake: null,
        lifecycle: {
          hasOpenRequest: false,
          canOpenNewRequest: false,
        },
        reminderTracking: null,
      });
    }

    const [latestSubmittedIntake, openDraftIntake] = await Promise.all([
      getLatestSubmittedIntake({
        coachId: profile.coachId,
        athleteId: user.id,
      }),
      getOpenIntakeDraft({
        coachId: profile.coachId,
        athleteId: user.id,
      }),
    ]);

    let reminderTracking: {
      requestedAt: string | null;
      lastReminderAt: string | null;
      remindersSent: number;
      nextReminderDueAt: string | null;
      isReminderDue: boolean;
    } | null = null;

    if (openDraftIntake?.id && openDraftIntake.createdAt) {
      const thread = await prisma.messageThread.findUnique({
        where: { coachId_athleteId: { coachId: profile.coachId, athleteId: user.id } },
        select: { id: true },
      });

      const requestMessages = thread
        ? await prisma.message.findMany({
            where: {
              threadId: thread.id,
              senderRole: 'COACH',
              deletedAt: null,
              createdAt: { gte: openDraftIntake.createdAt },
            },
            orderBy: [{ createdAt: 'asc' }],
            select: { body: true, createdAt: true },
          })
        : [];

      const startMessage = requestMessages.find((m) => isTrainingRequestStartMessage(m.body));
      const reminderMessages = requestMessages.filter((m) => isTrainingRequestReminderMessage(m.body));
      const requestedAt = startMessage?.createdAt ?? openDraftIntake.createdAt;
      const lastReminderAt = reminderMessages.length ? reminderMessages[reminderMessages.length - 1]!.createdAt : null;
      const nextReminderDueAt = computeTrainingRequestNextReminderDueAt({ requestedAt, lastReminderAt });

      reminderTracking = {
        requestedAt: requestedAt.toISOString(),
        lastReminderAt: lastReminderAt ? lastReminderAt.toISOString() : null,
        remindersSent: reminderMessages.length,
        nextReminderDueAt: nextReminderDueAt.toISOString(),
        isReminderDue: nextReminderDueAt.getTime() <= Date.now(),
      };
    }

    return success({
      intakeResponse: latestSubmittedIntake,
      latestSubmittedIntake,
      openDraftIntake,
      lifecycle: {
        hasOpenRequest: Boolean(openDraftIntake),
        canOpenNewRequest: !openDraftIntake,
      },
      reminderTracking,
    });
  } catch (error) {
    return handleError(error);
  }
}

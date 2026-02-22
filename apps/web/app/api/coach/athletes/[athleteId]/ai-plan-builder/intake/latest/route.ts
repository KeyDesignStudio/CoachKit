import crypto from 'node:crypto';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { getLatestSubmittedIntake, getOpenIntakeDraft } from '@/modules/ai-plan-builder/server/intake';
import {
  computeTrainingRequestNextReminderDueAt,
  isTrainingRequestReminderMessage,
  isTrainingRequestStartMessage,
} from '@/modules/ai-plan-builder/shared/training-request';

export async function GET(request: Request, context: { params: { athleteId: string } }) {
  const requestId = crypto.randomUUID();

  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const [latestSubmittedIntake, openDraftIntake] = await Promise.all([
      getLatestSubmittedIntake({
        coachId: user.id,
        athleteId: context.params.athleteId,
      }),
      getOpenIntakeDraft({
        coachId: user.id,
        athleteId: context.params.athleteId,
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
        where: { coachId_athleteId: { coachId: user.id, athleteId: context.params.athleteId } },
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
    const prismaCode = typeof (error as any)?.code === 'string' ? String((error as any).code) : null;
    const prismaName = typeof (error as any)?.name === 'string' ? String((error as any).name) : null;
    const errName = typeof (error as any)?.name === 'string' ? String((error as any).name) : null;
    const errMessage = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack ?? null : null;
    const athleteIdHash = crypto
      .createHash('sha256')
      .update(String(context?.params?.athleteId ?? ''))
      .digest('hex')
      .slice(0, 12);

    // Single-line, structured, no-PII log for prod correlation.
    // NOTE: Vercel request IDs are typically available via response headers; we also capture any inbound hint.
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'APB_INTAKE_LATEST_ERROR',
        requestId,
        route: 'GET /api/coach/athletes/[athleteId]/ai-plan-builder/intake/latest',
        athleteIdHash,
        prismaCode,
        prismaName,
        errName,
        errMessage,
        errStack,
        vercelId: request.headers.get('x-vercel-id') ?? null,
      })
    );

    return handleError(error, { requestId, where: 'apb/intake/latest' });
  }
}

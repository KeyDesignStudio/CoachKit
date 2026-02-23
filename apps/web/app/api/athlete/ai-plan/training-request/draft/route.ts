import { z } from 'zod';

import { requireAthlete } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { createIntakeDraft, intakeDraftSchema, updateIntakeDraft } from '@/modules/ai-plan-builder/server/intake';

async function requireAthleteCoachContext(athleteId: string) {
  const profile = await prisma.athleteProfile.findUnique({
    where: { userId: athleteId },
    select: { coachId: true },
  });

  if (!profile?.coachId) {
    throw new ApiError(409, 'COACH_LINK_REQUIRED', 'A coach must be assigned before starting a training request.');
  }

  return { coachId: profile.coachId };
}

export async function POST(request: Request) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireAthlete();
    const { coachId } = await requireAthleteCoachContext(user.id);
    const { draftJson } = intakeDraftSchema.parse(await request.json().catch(() => ({})));

    const created = await createIntakeDraft({
      coachId,
      athleteId: user.id,
      source: 'athlete_initiated',
      enforceSingleOpen: true,
      initialDraftJson: draftJson,
    });

    const updated =
      draftJson !== undefined
        ? await updateIntakeDraft({
            coachId,
            athleteId: user.id,
            intakeResponseId: created.id,
            draftJson,
          })
        : created;

    return success({ intakeResponse: updated });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireAthlete();
    const { coachId } = await requireAthleteCoachContext(user.id);

    const payload = z
      .object({ intakeResponseId: z.string().min(1), draftJson: z.unknown() })
      .parse(await request.json());

    const updated = await updateIntakeDraft({
      coachId,
      athleteId: user.id,
      intakeResponseId: payload.intakeResponseId,
      draftJson: payload.draftJson,
    });

    return success({ intakeResponse: updated });
  } catch (error) {
    return handleError(error);
  }
}


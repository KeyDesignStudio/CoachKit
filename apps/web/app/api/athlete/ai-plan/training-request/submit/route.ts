import { requireAthlete } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { failure, handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { submitIntake } from '@/modules/ai-plan-builder/server/intake';

async function requireAthleteCoachContext(athleteId: string) {
  const profile = await prisma.athleteProfile.findUnique({
    where: { userId: athleteId },
    select: { coachId: true },
  });

  if (!profile?.coachId) {
    throw new ApiError(409, 'COACH_LINK_REQUIRED', 'A coach must be assigned before submitting a training request.');
  }

  return { coachId: profile.coachId };
}

export async function POST(request: Request) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireAthlete();
    const { coachId } = await requireAthleteCoachContext(user.id);
    const body = (await request.json()) as { intakeResponseId?: string };

    const intakeResponseId = String(body?.intakeResponseId ?? '').trim();
    if (!intakeResponseId) {
      return failure('VALIDATION_ERROR', 'intakeResponseId is required.', 400);
    }

    const result = await submitIntake({
      coachId,
      athleteId: user.id,
      intakeResponseId,
    });

    return success(result);
  } catch (error) {
    return handleError(error);
  }
}


import { requireAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';

import { getLatestSubmittedIntake, getOpenIntakeDraft } from '@/modules/ai-plan-builder/server/intake';

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

    return success({
      intakeResponse: latestSubmittedIntake,
      latestSubmittedIntake,
      openDraftIntake,
      lifecycle: {
        hasOpenRequest: Boolean(openDraftIntake),
        canOpenNewRequest: !openDraftIntake,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}


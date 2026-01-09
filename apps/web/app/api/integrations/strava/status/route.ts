import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { user } = await requireAthlete();

    const connection = await prisma.stravaConnection.findUnique({
      where: { athleteId: user.id },
      select: {
        stravaAthleteId: true,
        expiresAt: true,
        scope: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return success({
      connected: Boolean(connection),
      connection,
    });
  } catch (error) {
    return handleError(error);
  }
}

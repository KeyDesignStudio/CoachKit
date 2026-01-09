import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const { user } = await requireAthlete();

    const connection = await prisma.stravaConnection.findUnique({
      where: { athleteId: user.id },
      select: { id: true, accessToken: true },
    });

    if (connection) {
      // Best-effort revocation on Strava side.
      try {
        await fetch('https://www.strava.com/oauth/deauthorize', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ access_token: connection.accessToken }).toString(),
          cache: 'no-store',
        });
      } catch {
        // Ignore revocation errors; we still remove the local connection.
      }

      await prisma.stravaConnection.delete({ where: { id: connection.id } });
    }

    return success({ disconnected: true });
  } catch (error) {
    return handleError(error);
  }
}

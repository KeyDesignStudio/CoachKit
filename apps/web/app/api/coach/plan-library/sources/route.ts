import { requireCoach } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { handleError, success } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { user } = await requireCoach();
    const prefix = `coach:${user.id}`;

    const sources = await prisma.planSource.findMany({
      where: {
        sourceFilePath: { startsWith: prefix },
      },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return success({
      sources: sources.map((source) => ({
        id: source.id,
        title: source.title,
        sport: source.sport,
        distance: source.distance,
        level: source.level,
        durationWeeks: source.durationWeeks,
        isActive: source.isActive,
        createdAt: source.createdAt.toISOString(),
        latestVersion: source.versions[0]
          ? {
              id: source.versions[0].id,
              version: source.versions[0].version,
              extractionMetaJson: source.versions[0].extractionMetaJson,
            }
          : null,
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}

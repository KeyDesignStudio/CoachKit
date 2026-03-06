import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { handleError, success } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin();

    const sources = await prisma.planSource.findMany({
      include: {
        _count: {
          select: { versions: true },
        },
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ createdAt: 'desc' }, { title: 'asc' }],
    });

    return success({
      sources: sources.map((source) => ({
        id: source.id,
        title: source.title,
        type: source.type,
        sport: source.sport,
        distance: source.distance,
        level: source.level,
        durationWeeks: source.durationWeeks,
        season: source.season,
        author: source.author,
        publisher: source.publisher,
        licenseText: source.licenseText,
        sourceUrl: source.sourceUrl,
        sourceFilePath: source.sourceFilePath,
        storedDocumentUrl: source.storedDocumentUrl,
        storedDocumentKey: source.storedDocumentKey,
        storedDocumentContentType: source.storedDocumentContentType,
        storedDocumentUploadedAt: source.storedDocumentUploadedAt?.toISOString() ?? null,
        checksumSha256: source.checksumSha256,
        isActive: source.isActive,
        createdAt: source.createdAt.toISOString(),
        updatedAt: source.updatedAt.toISOString(),
        versionCount: source._count.versions,
        latestVersion: source.versions[0]
          ? {
              id: source.versions[0].id,
              version: source.versions[0].version,
              createdAt: source.versions[0].createdAt.toISOString(),
              extractionMetaJson: source.versions[0].extractionMetaJson,
            }
          : null,
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}

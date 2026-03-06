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
        layoutFamily: true,
        _count: {
          select: { versions: true },
        },
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
        extractionRuns: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            reviews: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
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
        layoutFamily: source.layoutFamily
          ? {
              id: source.layoutFamily.id,
              slug: source.layoutFamily.slug,
              name: source.layoutFamily.name,
              hasCompiledRules: Boolean(source.layoutFamily.rulesJson),
            }
          : null,
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
        latestExtractionRun: source.extractionRuns[0]
          ? {
              id: source.extractionRuns[0].id,
              reviewStatus: source.extractionRuns[0].reviewStatus,
              confidence: source.extractionRuns[0].confidence,
              warningCount: source.extractionRuns[0].warningCount,
              createdAt: source.extractionRuns[0].createdAt.toISOString(),
              latestReview: source.extractionRuns[0].reviews[0]
                ? {
                    id: source.extractionRuns[0].reviews[0].id,
                    status: source.extractionRuns[0].reviews[0].status,
                    reviewerEmail: source.extractionRuns[0].reviews[0].reviewerEmail,
                    createdAt: source.extractionRuns[0].reviews[0].createdAt.toISOString(),
                  }
                : null,
            }
          : null,
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}

import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin();

    const exemplars = await prisma.coachWorkoutExemplar.findMany({
      orderBy: [{ updatedAt: 'desc' }],
      take: 100,
      include: {
        feedback: {
          orderBy: [{ createdAt: 'desc' }],
          take: 3,
          select: {
            id: true,
            feedbackType: true,
            note: true,
            createdAt: true,
          },
        },
      },
    });

    const userIds = Array.from(new Set(exemplars.flatMap((row) => [row.coachId, row.athleteId]).filter((value): value is string => Boolean(value))));
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true },
        })
      : [];
    const userMap = new Map(users.map((user) => [user.id, user]));

    return success({
      exemplars: exemplars.map((row) => ({
        id: row.id,
        coachId: row.coachId,
        coachEmail: userMap.get(row.coachId)?.email ?? null,
        athleteId: row.athleteId,
        athleteEmail: row.athleteId ? userMap.get(row.athleteId)?.email ?? null : null,
        sourceType: row.sourceType,
        discipline: row.discipline,
        sessionType: row.sessionType,
        title: row.title,
        durationMinutes: row.durationMinutes,
        distanceKm: row.distanceKm,
        objective: row.objective,
        notes: row.notes,
        tags: row.tags,
        usageCount: row.usageCount,
        positiveFeedbackCount: row.positiveFeedbackCount,
        editFeedbackCount: row.editFeedbackCount,
        isActive: row.isActive,
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        feedback: row.feedback.map((feedback) => ({
          id: feedback.id,
          feedbackType: feedback.feedbackType,
          note: feedback.note,
          createdAt: feedback.createdAt.toISOString(),
        })),
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}

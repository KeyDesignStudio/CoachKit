import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError } from '@/lib/errors';

import { extractFromRawText } from '@/modules/plan-library/server/extract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const planSourceId = String((body as any)?.planSourceId ?? '');
    const durationWeeks = Number((body as any)?.durationWeeks ?? 0);

    if (!planSourceId) {
      throw new ApiError(400, 'PLAN_SOURCE_ID_REQUIRED', 'planSourceId is required.');
    }

    const planSource = await prisma.planSource.findUnique({ where: { id: planSourceId } });
    if (!planSource) {
      throw new ApiError(404, 'PLAN_SOURCE_NOT_FOUND', 'Plan source not found.');
    }

    const lastVersion = await prisma.planSourceVersion.findFirst({
      where: { planSourceId },
      orderBy: { version: 'desc' },
    });
    const nextVersion = (lastVersion?.version ?? 0) + 1;

    const extracted = extractFromRawText(planSource.rawText, Number.isFinite(durationWeeks) ? durationWeeks : planSource.durationWeeks);

    const created = await prisma.$transaction(async (tx) => {
      const version = await tx.planSourceVersion.create({
        data: {
          planSourceId,
          version: nextVersion,
          extractionMetaJson: {
            warnings: extracted.warnings,
            confidence: extracted.confidence,
            sessionCount: extracted.sessions.length,
            weekCount: extracted.weeks.length,
          } as any,
        },
      });

      if (extracted.weeks.length) {
        await tx.planSourceWeekTemplate.createMany({
          data: extracted.weeks.map((week) => ({
            planSourceVersionId: version.id,
            weekIndex: week.weekIndex,
            phase: week.phase ?? null,
            totalMinutes: week.totalMinutes ?? null,
            totalSessions: week.totalSessions ?? null,
            notes: week.notes ?? null,
          })),
        });
      }

      if (extracted.sessions.length) {
        const weekIds = await tx.planSourceWeekTemplate.findMany({
          where: { planSourceVersionId: version.id },
          select: { id: true, weekIndex: true },
        });
        const weekMap = new Map(weekIds.map((w) => [w.weekIndex, w.id]));

        await tx.planSourceSessionTemplate.createMany({
          data: extracted.sessions
            .filter((session) => weekMap.has(session.weekIndex))
            .map((session) => ({
              planSourceWeekTemplateId: weekMap.get(session.weekIndex)!,
              ordinal: session.ordinal,
              dayOfWeek: session.dayOfWeek ?? null,
              discipline: session.discipline as any,
              sessionType: session.sessionType,
              title: session.title ?? null,
              durationMinutes: session.durationMinutes ?? null,
              distanceKm: session.distanceKm ?? null,
              intensityType: session.intensityType ?? null,
              intensityTargetJson: session.intensityTargetJson as any,
              structureJson: session.structureJson as any,
              notes: session.notes ?? null,
            })),
        });
      }

      if (extracted.rules.length) {
        await tx.planSourceRule.createMany({
          data: extracted.rules.map((rule) => ({
            planSourceVersionId: version.id,
            ruleType: rule.ruleType as any,
            phase: rule.phase ?? null,
            appliesJson: rule.appliesJson as any,
            ruleJson: rule.ruleJson as any,
            explanation: rule.explanation,
            priority: rule.priority,
          })),
        });
      }

      return version;
    });

    return success({ version: created, extracted });
  } catch (error) {
    return handleError(error);
  }
}

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import { deriveManualSessionTemplateFields } from './extract';

export async function updatePlanSourceSessionTemplate(params: {
  planSourceId: string;
  sessionId: string;
  reviewer: { userId: string; email: string };
  data: {
    dayOfWeek: number | null;
    discipline: 'SWIM' | 'BIKE' | 'RUN' | 'STRENGTH' | 'REST';
    sessionType: string;
    title: string | null;
    durationMinutes: number | null;
    distanceKm: number | null;
    notes: string | null;
  };
}) {
  const session = await prisma.planSourceSessionTemplate.findFirst({
    where: {
      id: params.sessionId,
      planSourceWeekTemplate: {
        planSourceVersion: {
          planSourceId: params.planSourceId,
        },
      },
    },
    include: {
      planSourceWeekTemplate: {
        include: {
          planSourceVersion: {
            select: {
              id: true,
              planSourceId: true,
              version: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    throw new ApiError(404, 'PLAN_SOURCE_SESSION_NOT_FOUND', 'Plan source session was not found.');
  }

  const latestVersion = await prisma.planSourceVersion.findFirst({
    where: { planSourceId: params.planSourceId },
    orderBy: { version: 'desc' },
    select: { id: true },
  });

  if (!latestVersion || latestVersion.id !== session.planSourceWeekTemplate.planSourceVersion.id) {
    throw new ApiError(400, 'SESSION_NOT_ON_LATEST_VERSION', 'Only sessions on the latest extracted version can be edited.');
  }

  const manualFields = deriveManualSessionTemplateFields({
    discipline: params.data.discipline,
    title: params.data.title,
    notes: params.data.notes,
    sessionType: params.data.sessionType,
    durationMinutes: params.data.durationMinutes,
    distanceKm: params.data.distanceKm,
    editor: {
      email: params.reviewer.email,
    },
  });

  const updated = await prisma.planSourceSessionTemplate.update({
    where: { id: session.id },
    data: {
      dayOfWeek: params.data.dayOfWeek,
      discipline: params.data.discipline,
      sessionType: manualFields.sessionType,
      title: params.data.title?.trim() || null,
      durationMinutes: manualFields.durationMinutes,
      distanceKm: manualFields.distanceKm,
      intensityType: manualFields.intensityType,
      intensityTargetJson: manualFields.intensityTargetJson as Prisma.InputJsonValue,
      recipeV2Json: manualFields.recipeV2Json as Prisma.InputJsonValue,
      parserConfidence: manualFields.parserConfidence,
      parserWarningsJson: manualFields.parserWarningsJson as Prisma.InputJsonValue,
      structureJson: manualFields.structureJson as Prisma.InputJsonValue,
      notes: manualFields.notes,
    },
  });

  return { session: updated };
}

import { GroupVisibilityType } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

export type GroupSessionTargetInput = {
  athleteId?: string;
  squadId?: string;
};

function dedupe(ids?: (string | undefined)[]) {
  return Array.from(new Set((ids ?? []).filter((value): value is string => Boolean(value))));
}

export function buildTargetsForVisibility(
  visibilityType: GroupVisibilityType,
  targetAthleteIds?: string[],
  targetSquadIds?: string[],
): GroupSessionTargetInput[] {
  const athleteIds = dedupe(targetAthleteIds);
  const squadIds = dedupe(targetSquadIds);

  if (visibilityType === GroupVisibilityType.ALL) {
    if (athleteIds.length || squadIds.length) {
      throw new ApiError(400, 'TARGETS_NOT_ALLOWED', 'Targets are not allowed when visibilityType is ALL.');
    }

    return [];
  }

  if (visibilityType === GroupVisibilityType.SQUAD) {
    if (!squadIds.length) {
      throw new ApiError(400, 'SQUAD_TARGETS_REQUIRED', 'Provide at least one squadId for SQUAD visibility.');
    }

    if (athleteIds.length) {
      throw new ApiError(400, 'INVALID_TARGETS', 'Only squadIds are permitted when visibilityType is SQUAD.');
    }

    return squadIds.map((squadId) => ({ squadId }));
  }

  if (visibilityType === GroupVisibilityType.SELECTED) {
    if (!athleteIds.length) {
      throw new ApiError(400, 'ATHLETE_TARGETS_REQUIRED', 'Provide at least one athleteId for SELECTED visibility.');
    }

    if (squadIds.length) {
      throw new ApiError(400, 'INVALID_TARGETS', 'Only athleteIds are permitted when visibilityType is SELECTED.');
    }

    return athleteIds.map((athleteId) => ({ athleteId }));
  }

  throw new ApiError(400, 'INVALID_VISIBILITY', 'Unsupported visibility type.');
}

export async function assertCoachOwnsTargets(coachId: string, targets: GroupSessionTargetInput[]) {
  const athleteIds = dedupe(targets.map((target) => target.athleteId));
  const squadIds = dedupe(targets.map((target) => target.squadId));

  const [athletes, squads] = await Promise.all([
    athleteIds.length
      ? prisma.athleteProfile.findMany({ where: { coachId, userId: { in: athleteIds } }, select: { userId: true } })
      : Promise.resolve([]),
    squadIds.length
      ? prisma.squad.findMany({ where: { coachId, id: { in: squadIds } }, select: { id: true } })
      : Promise.resolve([]),
  ]);

  if (athleteIds.length && athletes.length !== athleteIds.length) {
    throw new ApiError(400, 'INVALID_TARGET_ATHLETE', 'One or more athletes are not coached by you.');
  }

  if (squadIds.length && squads.length !== squadIds.length) {
    throw new ApiError(400, 'INVALID_TARGET_SQUAD', 'One or more squads are not coached by you.');
  }
}

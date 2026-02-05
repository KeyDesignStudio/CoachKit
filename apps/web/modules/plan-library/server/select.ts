import type { PlanDistance, PlanLevel, PlanSeason, PlanSport } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import type { AthleteProfileSnapshot } from '@/modules/ai/athlete-brief/types';

export type PlanSourceMatch = {
  planSourceVersionId: string;
  planSourceId: string;
  title: string;
  score: number;
  reasons: string[];
};

function inferSport(profile: AthleteProfileSnapshot | null | undefined): PlanSport | null {
  const disciplines = profile?.disciplines?.map((d) => d.toUpperCase()) ?? [];
  const hasSwim = disciplines.includes('SWIM');
  const hasBike = disciplines.includes('BIKE');
  const hasRun = disciplines.includes('RUN');
  if (hasSwim && hasBike && hasRun) return 'TRIATHLON';
  if (hasBike && hasRun) return 'DUATHLON';
  if (hasRun) return 'RUN';
  if (hasBike) return 'BIKE';
  if (hasSwim) return 'SWIM';
  return null;
}

function normalizeDistance(raw?: string | null): PlanDistance | null {
  if (!raw) return null;
  const normalized = raw.toUpperCase().replace(/\s+/g, '_');
  const map: Record<string, PlanDistance> = {
    SPRINT: 'SPRINT',
    OLYMPIC: 'OLYMPIC',
    HALF_IRONMAN: 'HALF_IRONMAN',
    IRONMAN: 'IRONMAN',
    DUATHLON_STD: 'DUATHLON_STD',
    DUATHLON_SPRINT: 'DUATHLON_SPRINT',
    FIVE_K: 'FIVE_K',
    TEN_K: 'TEN_K',
    HALF_MARATHON: 'HALF_MARATHON',
    MARATHON: 'MARATHON',
  };
  return map[normalized] ?? null;
}

export async function selectPlanSources(params: {
  athleteProfile: AthleteProfileSnapshot | null;
  durationWeeks: number;
  season?: PlanSeason | null;
}) {
  const inferredSport = inferSport(params.athleteProfile);
  const inferredLevel = (params.athleteProfile?.experienceLevel?.toUpperCase() ?? null) as PlanLevel | null;
  const inferredDistance = normalizeDistance(params.athleteProfile?.primaryGoal ?? null);

  const sources = await prisma.planSource.findMany({
    where: { isActive: true },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
  });

  const matches: PlanSourceMatch[] = [];

  for (const source of sources) {
    const version = source.versions[0];
    if (!version) continue;

    let score = 0;
    const reasons: string[] = [];

    if (inferredSport && source.sport === inferredSport) {
      score += 3;
      reasons.push('sport match');
    }

    if (inferredDistance && source.distance === inferredDistance) {
      score += 3;
      reasons.push('distance match');
    }

    if (inferredLevel && source.level === inferredLevel) {
      score += 2;
      reasons.push('level match');
    }

    if (params.season && source.season === params.season) {
      score += 1;
      reasons.push('season match');
    }

    if (params.durationWeeks > 0) {
      const diff = Math.abs(source.durationWeeks - params.durationWeeks);
      score += Math.max(0, 3 - Math.min(3, diff));
      reasons.push(`duration delta ${diff}w`);
    }

    matches.push({
      planSourceVersionId: version.id,
      planSourceId: source.id,
      title: source.title,
      score,
      reasons,
    });
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}

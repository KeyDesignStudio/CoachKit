import type { PlanDistance, PlanLevel, PlanSeason, PlanSport } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import type { AthleteProfileSnapshot } from '@/modules/ai/athlete-brief/types';

export type PlanSourceMatch = {
  planSourceVersionId: string;
  planSourceId: string;
  title: string;
  score: number;
  semanticScore: number;
  metadataScore: number;
  sourcePriorityScore: number;
  sourceOrigin: 'coach' | 'global';
  reasons: string[];
};

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const as = new Set(a);
  const bs = new Set(b);
  let inter = 0;
  for (const token of as) {
    if (bs.has(token)) inter += 1;
  }
  const union = as.size + bs.size - inter;
  if (!union) return 0;
  return inter / union;
}

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
  queryText?: string | null;
  coachId?: string | null;
}) {
  const inferredSport = inferSport(params.athleteProfile);
  const inferredLevel = (params.athleteProfile?.experienceLevel?.toUpperCase() ?? null) as PlanLevel | null;
  const inferredDistance = normalizeDistance(params.athleteProfile?.primaryGoal ?? null);

  const queryTokens = tokenize(
    [
      params.queryText ?? '',
      params.athleteProfile?.primaryGoal ?? '',
      params.athleteProfile?.focus ?? '',
      params.athleteProfile?.experienceLevel ?? '',
      ...(params.athleteProfile?.disciplines ?? []),
    ]
      .filter(Boolean)
      .join(' ')
  );

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

    let metadataScore = 0;
    const reasons: string[] = [];

    if (inferredSport && source.sport === inferredSport) {
      metadataScore += 3;
      reasons.push('sport match');
    }

    if (inferredDistance && source.distance === inferredDistance) {
      metadataScore += 3;
      reasons.push('distance match');
    }

    if (inferredLevel && source.level === inferredLevel) {
      metadataScore += 2;
      reasons.push('level match');
    }

    if (params.season && source.season === params.season) {
      metadataScore += 1;
      reasons.push('season match');
    }

    if (params.durationWeeks > 0) {
      const diff = Math.abs(source.durationWeeks - params.durationWeeks);
      metadataScore += Math.max(0, 3 - Math.min(3, diff));
      reasons.push(`duration delta ${diff}w`);
    }

    const coachPrefix = params.coachId ? `coach:${params.coachId}` : null;
    const isCoachSource = Boolean(coachPrefix && source.sourceFilePath?.startsWith(coachPrefix));
    const sourcePriorityScore = isCoachSource ? 6 : 0;
    if (isCoachSource) {
      reasons.push('coach library priority');
    }

    const semanticCorpus = `${source.title} ${source.rawText.slice(0, 7000)}`;
    const sourceTokens = tokenize(semanticCorpus);
    const semanticScore = queryTokens.length ? jaccard(queryTokens, sourceTokens) : 0;

    if (semanticScore >= 0.08) reasons.push(`semantic ${(semanticScore * 100).toFixed(0)}%`);
    const score = metadataScore + semanticScore * 4 + sourcePriorityScore;

    matches.push({
      planSourceVersionId: version.id,
      planSourceId: source.id,
      title: source.title,
      score,
      semanticScore,
      metadataScore,
      sourcePriorityScore,
      sourceOrigin: isCoachSource ? 'coach' : 'global',
      reasons,
    });
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}

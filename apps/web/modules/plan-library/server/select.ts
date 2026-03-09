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
  athleteFitScore: number;
  templateQualityScore: number;
  exemplarBoostScore: number;
  outcomeBoostScore: number;
  durationDeltaWeeks: number;
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
  const hasSwim = disciplines.includes('SWIM') || disciplines.includes('SWIM_OPEN_WATER') || disciplines.includes('OPEN_WATER_SWIM');
  const hasBike = disciplines.includes('BIKE') || disciplines.includes('BRICK');
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

  const templates = await prisma.planLibraryTemplate.findMany({
    where: {
      isPublished: true,
    },
    include: {
      exemplarLinks: {
        where: {
          isActive: true,
        },
        select: {
          retrievalKey: true,
          retrievalWeight: true,
        },
      },
      usageTraces: {
        where: {
          outcomeScore: {
            not: null,
          },
        },
        select: {
          outcomeScore: true,
          feedbackCount: true,
        },
        take: 50,
      },
      weeks: {
        include: {
          sessions: {
            select: {
              title: true,
              notes: true,
            },
          },
        },
      },
    },
  });

  const matches: PlanSourceMatch[] = [];

  for (const template of templates) {
    let metadataScore = 0;
    const reasons: string[] = [];
    let athleteFitScore = 0;

    if (inferredSport && template.sport === inferredSport) {
      metadataScore += 3;
      athleteFitScore += 3;
      reasons.push('sport match');
    }

    if (inferredDistance && template.distance === inferredDistance) {
      metadataScore += 3;
      athleteFitScore += 3;
      reasons.push('distance match');
    }

    if (inferredLevel && template.level === inferredLevel) {
      metadataScore += 2;
      athleteFitScore += 2;
      reasons.push('level match');
    }

    if (params.season) {
      reasons.push('season requested');
    }

    if (params.durationWeeks > 0) {
      const diff = Math.abs(template.durationWeeks - params.durationWeeks);
      metadataScore += Math.max(0, 3 - Math.min(3, diff));
      athleteFitScore += Math.max(0, 3 - Math.min(3, diff));
      reasons.push(`duration delta ${diff}w`);
    }

    const isCoachSource = Boolean(params.coachId && template.createdBy === params.coachId);
    const sourcePriorityScore = isCoachSource ? 6 : 0;
    if (isCoachSource) {
      reasons.push('coach library priority');
    }

    const disciplineKeys = (params.athleteProfile?.disciplines ?? [])
      .map((entry) => String(entry ?? '').trim().toUpperCase())
      .filter((entry) => entry.length > 0);
    const exemplarKeys = Array.from(
      new Set([
        ...disciplineKeys.map((discipline) => `global|disc:${discipline}`),
        ...disciplineKeys.flatMap((discipline) =>
          params.coachId
            ? [`coach:${params.coachId}|disc:${discipline}`, `coach:${params.coachId}|disc:${discipline}|type:endurance`]
            : []
        ),
      ])
    );
    const exemplarBoost = template.exemplarLinks
      .filter((link) => exemplarKeys.some((key) => link.retrievalKey.startsWith(key)))
      .reduce((sum, link) => sum + Number(link.retrievalWeight ?? 0), 0);
    const exemplarBoostScore = Math.max(0, Math.min(8, exemplarBoost * 0.35));
    if (exemplarBoostScore > 0) {
      reasons.push(`exemplar boost ${exemplarBoostScore.toFixed(1)}`);
    }

    const semanticCorpus = [
      template.title,
      ...template.weeks.flatMap((week) => week.sessions.map((session) => `${session.title ?? ''} ${session.notes ?? ''}`)),
    ]
      .join(' ')
      .slice(0, 9000);
    const sourceTokens = tokenize(semanticCorpus);
    const semanticScore = queryTokens.length ? jaccard(queryTokens, sourceTokens) : 0;
    const templateQualityScore = Math.max(0, Math.min(4, Number(template.qualityScore ?? 0) * 4));
    const outcomeSamples = template.usageTraces
      .map((trace) => (typeof trace.outcomeScore === 'number' ? trace.outcomeScore : null))
      .filter((value): value is number => value != null);
    const averageOutcomeScore =
      outcomeSamples.length > 0 ? outcomeSamples.reduce((sum, value) => sum + value, 0) / outcomeSamples.length : null;
    const outcomeBoostScore =
      averageOutcomeScore == null ? 0 : Math.max(-1.5, Math.min(2.5, (averageOutcomeScore - 0.55) * 4));
    metadataScore += templateQualityScore;
    reasons.push(`quality ${Math.round((template.qualityScore ?? 0) * 100)}%`);
    if (averageOutcomeScore != null) {
      reasons.push(`outcomes ${Math.round(averageOutcomeScore * 100)}%`);
    }

    if (semanticScore >= 0.08) reasons.push(`semantic ${(semanticScore * 100).toFixed(0)}%`);
    const score = metadataScore + semanticScore * 4 + sourcePriorityScore + exemplarBoostScore + outcomeBoostScore;

    matches.push({
      planSourceVersionId: template.id,
      planSourceId: template.id,
      title: template.title,
      score,
      semanticScore,
      metadataScore,
      sourcePriorityScore,
      athleteFitScore,
      templateQualityScore,
      exemplarBoostScore,
      outcomeBoostScore,
      durationDeltaWeeks: params.durationWeeks > 0 ? Math.abs(template.durationWeeks - params.durationWeeks) : 0,
      sourceOrigin: isCoachSource ? 'coach' : 'global',
      reasons,
    });
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}

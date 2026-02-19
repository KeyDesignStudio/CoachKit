import { prisma } from '@/lib/prisma';

import { loadAthleteProfileSnapshot } from './athlete-brief';

const DAY_LABELS: Record<string, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};

const GOAL_TIMELINE_WEEKS: Record<string, number | null> = {
  'No date in mind': null,
  'In 6-8 weeks': 8,
  'In 2-3 months': 12,
  'In 3-6 months': 24,
  'In 6-12 months': 48,
  'In 6–8 weeks': 8,
  'In 2–3 months': 12,
  'In 3–6 months': 24,
  'In 6–12 months': 48,
};

type PlanFieldKey =
  | 'primaryGoal'
  | 'focus'
  | 'eventName'
  | 'eventDate'
  | 'timelineWeeks'
  | 'weeklyMinutesTarget'
  | 'availableDays'
  | 'disciplines'
  | 'experienceLevel'
  | 'injuryStatus'
  | 'constraintsNotes';

export type PlanSignal = Partial<Record<PlanFieldKey, unknown>>;

type SourceTag = 'athlete_profile' | 'submitted_intake' | 'approved_ai_profile';

type Candidate = { source: SourceTag; value: unknown };

function normalizeText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n));
}

function normalizeDateYmd(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => normalizeText(v)).filter((v): v is string => Boolean(v));
  }
  const single = normalizeText(value);
  if (!single) return [];
  return single
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function normalizeDays(value: unknown): string[] {
  const raw = normalizeList(value);
  const mapped = raw.map((d) => DAY_LABELS[d] ?? d);
  return Array.from(new Set(mapped));
}

function normalizeDisciplines(value: unknown): string[] {
  return Array.from(new Set(normalizeList(value).map((d) => d.toUpperCase())));
}

function normalizeTimelineWeeks(value: unknown): number | null {
  const asText = normalizeText(value);
  if (asText && asText in GOAL_TIMELINE_WEEKS) {
    return GOAL_TIMELINE_WEEKS[asText] ?? null;
  }
  return normalizeNumber(value);
}

function normalizeWeeklyMinutes(value: unknown): number | null {
  return normalizeNumber(value);
}

function canonicalizeValue(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((v) => String(v)).sort());
  }
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function isPresent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function extractSignalsFromQuestionMap(map: Record<string, unknown> | null | undefined): PlanSignal {
  if (!map || typeof map !== 'object') return {};

  const goalType = normalizeText(map.goal_type);
  const goalDetails = normalizeText(map.goal_details);

  return {
    primaryGoal: goalDetails ?? goalType ?? undefined,
    focus: normalizeText(map.goal_focus) ?? undefined,
    eventName: normalizeText(map.event_name) ?? undefined,
    eventDate: normalizeDateYmd(map.event_date) ?? undefined,
    timelineWeeks: normalizeTimelineWeeks(map.goal_timeline ?? map.timeline_weeks) ?? undefined,
    weeklyMinutesTarget: normalizeWeeklyMinutes(map.weekly_minutes) ?? undefined,
    availableDays: normalizeDays(map.availability_days),
    disciplines: normalizeDisciplines(map.disciplines),
    experienceLevel: normalizeText(map.experience_level) ?? undefined,
    injuryStatus: normalizeText(map.injury_status) ?? undefined,
    constraintsNotes: normalizeText(map.constraints_notes ?? map.travel_constraints) ?? undefined,
  };
}

function extractSignalsFromAthleteProfile(profile: Awaited<ReturnType<typeof loadAthleteProfileSnapshot>>): PlanSignal {
  if (!profile) return {};
  return {
    primaryGoal: profile.primaryGoal ?? undefined,
    focus: profile.focus ?? undefined,
    eventName: profile.eventName ?? undefined,
    eventDate: profile.eventDate ?? undefined,
    timelineWeeks: profile.timelineWeeks ?? undefined,
    weeklyMinutesTarget: profile.weeklyMinutesTarget ?? undefined,
    availableDays: Array.isArray(profile.availableDays) ? profile.availableDays : [],
    disciplines: Array.isArray(profile.disciplines) ? profile.disciplines : [],
    experienceLevel: profile.experienceLevel ?? undefined,
    injuryStatus: profile.injuryStatus ?? undefined,
    constraintsNotes: profile.constraintsNotes ?? profile.travelConstraints ?? undefined,
  };
}

function chooseValue(candidates: Candidate[]): { source: SourceTag; value: unknown } | null {
  for (const candidate of candidates) {
    if (isPresent(candidate.value)) return { source: candidate.source, value: candidate.value };
  }
  return null;
}

function detectConflict(candidates: Candidate[]): Candidate[] {
  const present = candidates.filter((c) => isPresent(c.value));
  if (present.length < 2) return [];

  const distinct = new Map<string, Candidate>();
  for (const item of present) {
    const key = canonicalizeValue(item.value);
    if (!distinct.has(key)) distinct.set(key, item);
  }
  if (distinct.size <= 1) return [];
  return present;
}

export type EffectiveInputConflict = {
  field: PlanFieldKey;
  chosenSource: SourceTag;
  chosenValue: unknown;
  candidates: Array<{ source: SourceTag; value: unknown }>;
};

export type EffectiveInputContext = {
  athleteProfileSnapshot: Awaited<ReturnType<typeof loadAthleteProfileSnapshot>>;
  mergedSignals: PlanSignal;
  conflicts: EffectiveInputConflict[];
  preflight: {
    hasConflicts: boolean;
    conflictCount: number;
    intakeResponseId: string | null;
    approvedAiProfileId: string | null;
  };
};

export function buildEffectiveSignalsForSources(params: {
  athleteProfileSignals: PlanSignal;
  intakeSignals: PlanSignal;
  approvedAiSignals: PlanSignal;
}): {
  mergedSignals: PlanSignal;
  conflicts: EffectiveInputConflict[];
} {
  const fields: PlanFieldKey[] = [
    'primaryGoal',
    'focus',
    'eventName',
    'eventDate',
    'timelineWeeks',
    'weeklyMinutesTarget',
    'availableDays',
    'disciplines',
    'experienceLevel',
    'injuryStatus',
    'constraintsNotes',
  ];

  const mergedSignals: PlanSignal = {};
  const conflicts: EffectiveInputConflict[] = [];

  for (const field of fields) {
    const candidates: Candidate[] = [
      { source: 'approved_ai_profile', value: params.approvedAiSignals[field] },
      { source: 'submitted_intake', value: params.intakeSignals[field] },
      { source: 'athlete_profile', value: params.athleteProfileSignals[field] },
    ];

    const chosen = chooseValue(candidates);
    if (chosen) mergedSignals[field] = chosen.value;

    const conflictCandidates = detectConflict(candidates);
    if (chosen && conflictCandidates.length) {
      conflicts.push({
        field,
        chosenSource: chosen.source,
        chosenValue: chosen.value,
        candidates: conflictCandidates,
      });
    }
  }

  return { mergedSignals, conflicts };
}

export async function buildEffectivePlanInputContext(params: {
  coachId: string;
  athleteId: string;
}): Promise<EffectiveInputContext> {
  const [athleteProfileSnapshot, latestSubmittedIntake, latestApprovedAiProfile] = await Promise.all([
    loadAthleteProfileSnapshot({ coachId: params.coachId, athleteId: params.athleteId }),
    prisma.athleteIntakeResponse.findFirst({
      where: {
        athleteId: params.athleteId,
        coachId: params.coachId,
        status: 'SUBMITTED',
      },
      orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, draftJson: true },
    }),
    prisma.athleteProfileAI.findFirst({
      where: {
        athleteId: params.athleteId,
        coachId: params.coachId,
        status: 'APPROVED',
      },
      orderBy: [{ approvedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, extractedProfileJson: true, coachOverridesJson: true },
    }),
  ]);

  const athleteSignals = extractSignalsFromAthleteProfile(athleteProfileSnapshot);
  const intakeSignals = extractSignalsFromQuestionMap((latestSubmittedIntake?.draftJson as Record<string, unknown> | null) ?? null);
  const aiMergedQuestionMap = {
    ...((latestApprovedAiProfile?.extractedProfileJson as Record<string, unknown> | null) ?? {}),
    ...((latestApprovedAiProfile?.coachOverridesJson as Record<string, unknown> | null) ?? {}),
  };
  const approvedAiSignals = extractSignalsFromQuestionMap(aiMergedQuestionMap);

  const { mergedSignals, conflicts } = buildEffectiveSignalsForSources({
    athleteProfileSignals: athleteSignals,
    intakeSignals,
    approvedAiSignals,
  });

  return {
    athleteProfileSnapshot,
    mergedSignals,
    conflicts,
    preflight: {
      hasConflicts: conflicts.length > 0,
      conflictCount: conflicts.length,
      intakeResponseId: latestSubmittedIntake?.id ?? null,
      approvedAiProfileId: latestApprovedAiProfile?.id ?? null,
    },
  };
}

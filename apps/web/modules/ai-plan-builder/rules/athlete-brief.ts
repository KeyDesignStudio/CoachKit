import { z } from 'zod';

import type { AiJsonValue } from '../ai/types';

const briefListSchema = z.array(z.string().min(1)).max(8).default([]);

export const athleteBriefSchema = z.object({
  version: z.literal('v1').default('v1'),
  snapshot: z
    .object({
      headline: z.string().min(1).max(240).optional(),
      tags: briefListSchema,
    })
    .default({ tags: [] }),
  goals: z
    .object({
      type: z.string().min(1).max(120).optional(),
      details: z.string().min(1).max(240).optional(),
      timeline: z.string().min(1).max(120).optional(),
      focus: z.string().min(1).max(120).optional(),
    })
    .default({}),
  disciplineProfile: z
    .object({
      experienceLevel: z.string().min(1).max(80).optional(),
      disciplines: z.array(z.string().min(1)).max(6).default([]),
      weeklyMinutes: z.number().int().min(0).max(1500).optional(),
      recentConsistency: z.string().min(1).max(120).optional(),
      swimConfidence: z.number().min(1).max(5).optional(),
      bikeConfidence: z.number().min(1).max(5).optional(),
      runConfidence: z.number().min(1).max(5).optional(),
    })
    .default({ disciplines: [] }),
  constraints: z
    .object({
      availabilityDays: z.array(z.string().min(1)).max(7).default([]),
      scheduleVariability: z.string().min(1).max(120).optional(),
      sleepQuality: z.string().min(1).max(120).optional(),
      injuryStatus: z.string().min(1).max(160).optional(),
      notes: z.string().min(1).max(240).optional(),
    })
    .default({ availabilityDays: [] }),
  coaching: z
    .object({
      feedbackStyle: z.string().min(1).max(120).optional(),
      tonePreference: z.string().min(1).max(120).optional(),
      checkinPreference: z.string().min(1).max(120).optional(),
      structurePreference: z.number().min(1).max(5).optional(),
      motivationStyle: z.string().min(1).max(120).optional(),
      notes: z.string().min(1).max(240).optional(),
    })
    .default({}),
  risks: briefListSchema,
  planGuidance: z
    .object({
      tone: z.string().min(1).max(120).optional(),
      focusNotes: briefListSchema,
      coachingCues: briefListSchema,
      safetyNotes: briefListSchema,
    })
    .default({ focusNotes: [], coachingCues: [], safetyNotes: [] }),
});

export type AthleteBriefJson = z.infer<typeof athleteBriefSchema>;

export type AthleteIntakeSubmissionPayload = {
  version?: string | null;
  sections: Array<{
    key: string;
    title?: string | null;
    answers: Array<{ questionKey: string; answer: AiJsonValue }>;
  }>;
};

export type AthleteProfileSnapshot = {
  disciplines?: string[];
  goalsText?: string | null;
  trainingPlanFrequency?: string | null;
  trainingPlanDayOfWeek?: number | null;
  trainingPlanWeekOfMonth?: number | null;
  coachNotes?: string | null;
};

function normalizeAnswerText(value: AiJsonValue): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((v) => normalizeAnswerText(v)).filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim();
}

function pushUnique(target: string[], value: string, max = 6) {
  const v = value.trim();
  if (!v) return;
  if (target.length >= max) return;
  if (target.some((t) => t.toLowerCase() === v.toLowerCase())) return;
  target.push(v);
}

function detectRiskFlags(text: string): string[] {
  const t = text.toLowerCase();
  const flags: string[] = [];
  if (t.includes('injur') || t.includes('pain') || t.includes('sore')) flags.push('Injury or pain noted');
  if (t.includes('burnout') || t.includes('overwhelm') || t.includes('fatigue')) flags.push('Fatigue or burnout risk');
  if (t.includes('sleep') && (t.includes('poor') || t.includes('inconsistent'))) flags.push('Sleep quality may limit recovery');
  return flags;
}

function normalizeArray(value: AiJsonValue): string[] {
  if (Array.isArray(value)) return value.map((v) => normalizeAnswerText(v)).filter(Boolean);
  const text = normalizeAnswerText(value);
  if (!text) return [];
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function humanizeLabel(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeOptionalNumber(value: AiJsonValue): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.round(n));
}

function flattenAnswers(intake: AthleteIntakeSubmissionPayload): Record<string, AiJsonValue> {
  const map: Record<string, AiJsonValue> = {};
  for (const section of intake.sections ?? []) {
    for (const answer of section.answers ?? []) {
      map[String(answer.questionKey)] = answer.answer as AiJsonValue;
    }
  }
  return map;
}

export function buildAthleteBriefDeterministic(params: {
  intake: AthleteIntakeSubmissionPayload;
  profile?: AthleteProfileSnapshot | null;
}): AthleteBriefJson {
  const answers = flattenAnswers(params.intake);
  const profile = params.profile ?? {};

  const risks: string[] = [];
  const focusNotes: string[] = [];
  const coachingCues: string[] = [];
  const safetyNotes: string[] = [];
  const tags: string[] = [];

  const get = (key: string) => normalizeAnswerText(answers[key]);
  const getList = (key: string) => normalizeArray(answers[key]);
  const getNumber = (key: string) => normalizeOptionalNumber(answers[key]);

  const goalType = get('goal_type');
  const goalDetails = get('goal_details') || profile.goalsText || '';
  const goalTimeline = get('goal_timeline');
  const goalFocus = get('goal_focus');

  const experienceLevel = get('experience_level');
  const disciplinesRaw = getList('disciplines');
  const disciplines = disciplinesRaw.length
    ? disciplinesRaw
    : Array.isArray(profile.disciplines)
      ? profile.disciplines.map((d) => String(d))
      : [];
  const weeklyMinutes = getNumber('weekly_minutes');
  const recentConsistency = get('recent_consistency');
  const swimConfidence = getNumber('swim_confidence');
  const bikeConfidence = getNumber('bike_confidence');
  const runConfidence = getNumber('run_confidence');

  const availabilityDays = getList('availability_days');
  const scheduleVariability = get('schedule_variability');
  const sleepQuality = get('sleep_quality');
  const injuryStatus = get('injury_status');
  const constraintNotes = get('constraints_notes');

  const feedbackStyle = get('feedback_style');
  const tonePreference = get('tone_preference');
  const checkinPreference = get('checkin_preference');
  const structurePreference = getNumber('structure_preference');
  const motivationStyle = get('motivation_style');
  const coachingNotes = get('coaching_notes');

  const headlineParts = [] as string[];
  const primaryGoal = goalDetails || goalType;
  if (primaryGoal) headlineParts.push(`Goal: ${primaryGoal}`);
  if (experienceLevel) headlineParts.push(`Experience: ${experienceLevel}`);
  if (disciplines.length) headlineParts.push(`Disciplines: ${disciplines.map(humanizeLabel).join(', ')}`);
  const headline = headlineParts.join(' • ') || undefined;

  pushUnique(tags, goalFocus);
  pushUnique(tags, experienceLevel);
  disciplines.map(humanizeLabel).slice(0, 4).forEach((d) => pushUnique(tags, d));
  if (injuryStatus && !injuryStatus.toLowerCase().includes('no')) {
    pushUnique(tags, 'Injury considerations');
  }

  if (injuryStatus && !injuryStatus.toLowerCase().includes('no')) {
    pushUnique(risks, 'Injury or medical considerations noted');
    pushUnique(safetyNotes, 'Respect injury considerations and adjust intensity as needed.');
  }
  if (sleepQuality && ['inconsistent', 'poor'].some((t) => sleepQuality.toLowerCase().includes(t))) {
    pushUnique(risks, 'Sleep quality may limit recovery');
    pushUnique(safetyNotes, 'Prioritize recovery when sleep is limited.');
  }
  if (scheduleVariability && scheduleVariability.toLowerCase().includes('unpredictable')) {
    pushUnique(risks, 'Schedule may be unpredictable');
  }
  if (weeklyMinutes && weeklyMinutes < 180) {
    pushUnique(risks, 'Low weekly availability');
  }

  const riskSignals = detectRiskFlags([constraintNotes, injuryStatus, sleepQuality].filter(Boolean).join(' '));
  riskSignals.forEach((flag) => pushUnique(risks, flag));

  if (goalFocus) pushUnique(focusNotes, `Plan focus: ${goalFocus}.`);
  if (goalTimeline && !goalTimeline.toLowerCase().includes('no date')) {
    pushUnique(focusNotes, `Target timeline: ${goalTimeline}.`);
  }
  if (weeklyMinutes) pushUnique(focusNotes, `Weekly minutes target: ${weeklyMinutes}.`);
  if (availabilityDays.length) pushUnique(focusNotes, `Schedule around: ${availabilityDays.join(', ')}.`);
  if (recentConsistency) pushUnique(focusNotes, `Maintain consistency: ${recentConsistency.toLowerCase()}.`);

  if (feedbackStyle) pushUnique(coachingCues, `Feedback: ${feedbackStyle}.`);
  if (checkinPreference) pushUnique(coachingCues, `Check-ins: ${checkinPreference}.`);
  if (motivationStyle) pushUnique(coachingCues, `Motivation: ${motivationStyle}.`);
  if (tonePreference) pushUnique(coachingCues, `Tone: ${tonePreference}.`);

  return athleteBriefSchema.parse({
    version: 'v1',
    snapshot: {
      headline,
      tags,
    },
    goals: {
      type: goalType || undefined,
      details: goalDetails || undefined,
      timeline: goalTimeline || undefined,
      focus: goalFocus || undefined,
    },
    disciplineProfile: {
      experienceLevel: experienceLevel || undefined,
      disciplines,
      weeklyMinutes: weeklyMinutes ?? undefined,
      recentConsistency: recentConsistency || undefined,
      swimConfidence: swimConfidence ?? undefined,
      bikeConfidence: bikeConfidence ?? undefined,
      runConfidence: runConfidence ?? undefined,
    },
    constraints: {
      availabilityDays,
      scheduleVariability: scheduleVariability || undefined,
      sleepQuality: sleepQuality || undefined,
      injuryStatus: injuryStatus || undefined,
      notes: constraintNotes || undefined,
    },
    coaching: {
      feedbackStyle: feedbackStyle || undefined,
      tonePreference: tonePreference || undefined,
      checkinPreference: checkinPreference || undefined,
      structurePreference: structurePreference ?? undefined,
      motivationStyle: motivationStyle || undefined,
      notes: coachingNotes || undefined,
    },
    risks,
    planGuidance: {
      tone: tonePreference || feedbackStyle || undefined,
      focusNotes,
      coachingCues,
      safetyNotes,
    },
  });
}

export function formatAthleteBriefAsSummaryText(brief: AthleteBriefJson): string {
  const lines: string[] = [];
  const pushLine = (label: string, value: string | undefined | null) => {
    if (!value) return;
    lines.push(`${label}: ${value}`);
  };
  const pushList = (label: string, values: string[] | undefined | null) => {
    if (!values?.length) return;
    lines.push(`${label}: ${values.join(', ')}`);
  };

  pushLine('Snapshot', brief.snapshot?.headline ?? undefined);
  pushList('Tags', brief.snapshot?.tags ?? []);

  pushLine('Goal type', brief.goals?.type ?? undefined);
  pushLine('Goal details', brief.goals?.details ?? undefined);
  pushLine('Goal timeline', brief.goals?.timeline ?? undefined);
  pushLine('Goal focus', brief.goals?.focus ?? undefined);

  pushLine('Experience level', brief.disciplineProfile?.experienceLevel ?? undefined);
  pushList('Disciplines', brief.disciplineProfile?.disciplines ?? []);
  pushLine(
    'Weekly minutes',
    typeof brief.disciplineProfile?.weeklyMinutes === 'number' ? String(brief.disciplineProfile.weeklyMinutes) : undefined
  );
  pushLine('Recent consistency', brief.disciplineProfile?.recentConsistency ?? undefined);
  pushLine(
    'Swim confidence',
    brief.disciplineProfile?.swimConfidence ? `${brief.disciplineProfile.swimConfidence}/5` : undefined
  );
  pushLine(
    'Bike confidence',
    brief.disciplineProfile?.bikeConfidence ? `${brief.disciplineProfile.bikeConfidence}/5` : undefined
  );
  pushLine(
    'Run confidence',
    brief.disciplineProfile?.runConfidence ? `${brief.disciplineProfile.runConfidence}/5` : undefined
  );

  pushList('Available days', brief.constraints?.availabilityDays ?? []);
  pushLine('Schedule variability', brief.constraints?.scheduleVariability ?? undefined);
  pushLine('Sleep quality', brief.constraints?.sleepQuality ?? undefined);
  pushLine('Injury status', brief.constraints?.injuryStatus ?? undefined);
  pushLine('Constraints notes', brief.constraints?.notes ?? undefined);

  pushLine('Feedback style', brief.coaching?.feedbackStyle ?? undefined);
  pushLine('Tone preference', brief.coaching?.tonePreference ?? undefined);
  pushLine('Check-in preference', brief.coaching?.checkinPreference ?? undefined);
  pushLine(
    'Structure preference',
    brief.coaching?.structurePreference ? `${brief.coaching.structurePreference}/5` : undefined
  );
  pushLine('Motivation style', brief.coaching?.motivationStyle ?? undefined);
  pushLine('Coaching notes', brief.coaching?.notes ?? undefined);

  pushList('Risks', brief.risks ?? []);
  pushList('Plan focus notes', brief.planGuidance?.focusNotes ?? []);
  pushList('Coaching cues', brief.planGuidance?.coachingCues ?? []);
  pushList('Safety notes', brief.planGuidance?.safetyNotes ?? []);

  return lines.join('\n');
}

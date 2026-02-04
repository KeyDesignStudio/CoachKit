import { athleteBriefV1_1Schema, type AthleteBriefV1_1, type BriefInput } from './types';

function pushUnique(target: string[], value: string | undefined, max = 6) {
  if (!value) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  if (target.includes(trimmed)) return;
  if (target.length >= max) return;
  target.push(trimmed);
}

function detectRiskFlags(text: string): string[] {
  const t = text.toLowerCase();
  const flags: string[] = [];
  if (t.includes('injur') || t.includes('pain') || t.includes('sore')) flags.push('Injury or pain noted');
  if (t.includes('sleep') && (t.includes('poor') || t.includes('inconsistent'))) flags.push('Sleep quality may limit recovery');
  if (t.includes('fatigue') || t.includes('burnout')) flags.push('Fatigue or burnout risk');
  return flags;
}

function buildPlanGuidance(input: BriefInput): string | undefined {
  const parts: string[] = [];
  if (input.goalPrimary) parts.push(`Focus: ${input.goalPrimary}`);
  if (input.weeklyMinutes) parts.push(`Weekly mins target ~${input.weeklyMinutes}`);
  if (input.availabilityDays?.length) parts.push(`Available ${input.availabilityDays.length} days`);
  if (input.injuryStatus) parts.push(`Watch: ${input.injuryStatus}`);
  if (input.sleepQuality) parts.push(`Sleep: ${input.sleepQuality}`);
  if (input.scheduleNotes) parts.push(input.scheduleNotes);
  if (input.coachingPreferences?.tone) parts.push(`Tone: ${input.coachingPreferences.tone}`);
  return parts.length ? parts.join('; ') : undefined;
}

function buildSummaryText(input: BriefInput): string {
  const lines: string[] = [];
  const add = (label: string, value: string | number | undefined | null) => {
    if (value == null || value === '') return;
    lines.push(`- ${label}: ${value}`);
  };
  const addList = (label: string, values?: string[]) => {
    if (!values?.length) return;
    lines.push(`- ${label}: ${values.join(', ')}`);
  };

  add('Goal', input.goalPrimary);
  addList('Secondary goals', input.secondaryGoals);
  add('Goal focus', input.goalFocus);
  add('Timeline', input.goalTimeline);
  add('Event', input.eventName);
  add('Event date', input.eventDate);
  add('Experience', input.experienceLevel);
  addList('Disciplines', input.disciplines);
  add('Weekly minutes', input.weeklyMinutes);
  addList('Availability', input.availabilityDays);
  add('Schedule', input.scheduleNotes);
  add('Sleep quality', input.sleepQuality);
  add('Injury or pain', input.injuryStatus);
  addList('Pain history', input.painHistory);
  add('Coach notes', input.coachNotes);
  if (!lines.length) return '- No intake or coach profile data yet.';
  return lines.join('\n');
}

function buildRiskFlags(input: BriefInput): string[] {
  const flags: string[] = [];
  if (input.injuryStatus) pushUnique(flags, 'Injury or pain considerations');
  if (input.painHistory?.length) pushUnique(flags, 'Pain history flagged');
  if (input.sleepQuality && ['poor', 'inconsistent'].some((t) => input.sleepQuality!.toLowerCase().includes(t))) {
    pushUnique(flags, 'Sleep quality may limit recovery');
  }
  if (typeof input.weeklyMinutes === 'number' && input.weeklyMinutes < 180) {
    pushUnique(flags, 'Low weekly availability');
  }
  const detected = detectRiskFlags(
    [input.constraintNotes, input.injuryStatus, input.sleepQuality, ...(input.painHistory ?? [])].filter(Boolean).join(' ')
  );
  detected.forEach((flag) => pushUnique(flags, flag));
  return flags;
}

function buildTags(input: BriefInput, riskFlags: string[]): string[] {
  const tags: string[] = [];
  if (input.goalFocus) pushUnique(tags, input.goalFocus);
  if (input.experienceLevel) pushUnique(tags, input.experienceLevel);
  if (input.eventName) pushUnique(tags, input.eventName);
  if (input.disciplines?.length) {
    input.disciplines.slice(0, 3).forEach((d) => pushUnique(tags, d));
  }
  if (riskFlags.length) pushUnique(tags, 'Safety first');
  return tags;
}

export function buildAthleteBriefV1_1(input: BriefInput): {
  briefJson: AthleteBriefV1_1;
  summaryText: string;
  riskFlags: string[];
} {
  const now = new Date().toISOString();
  const riskFlags = buildRiskFlags(input);
  const planGuidance = buildPlanGuidance(input);
  const summaryText = buildSummaryText(input);
  const tags = buildTags(input, riskFlags);

  const briefJson = athleteBriefV1_1Schema.parse({
    version: 'v1.1',
    snapshot: {
      primaryGoal: input.goalPrimary,
      disciplines: input.disciplines,
      experienceLabel: input.experienceLevel || undefined,
      tags,
    },
    coachingPreferences: {
      tone: input.coachingPreferences?.tone || undefined,
      feedbackStyle: input.coachingPreferences?.feedbackStyle || undefined,
      checkinCadence: input.coachingPreferences?.checkinCadence || undefined,
      structurePreference: input.coachingPreferences?.structurePreference || undefined,
      motivationStyle: input.coachingPreferences?.motivationStyle || undefined,
    },
    trainingProfile: {
      weeklyMinutesTarget: input.weeklyMinutes,
      availabilityDays: input.availabilityDays,
      scheduleNotes: input.scheduleNotes || undefined,
      recentConsistency: input.recentConsistency || undefined,
      timezone: input.timezone || undefined,
      dateOfBirth: input.dateOfBirth || undefined,
    },
    constraintsAndSafety: {
      injuryStatus: input.injuryStatus || undefined,
      painHistory: input.painHistory,
      sleepQuality: input.sleepQuality || undefined,
      notes: input.constraintNotes || undefined,
    },
    coachObservations: {
      notes: input.coachNotes || undefined,
      goalsText: input.goalsText || undefined,
    },
    planGuidance,
    riskFlags,
    provenance: {
      intake: input.sourcesPresent.intake,
      coachProfile: input.sourcesPresent.coachProfile,
    },
    generatedAt: now,
    updatedAt: now,
  });

  return { briefJson, summaryText, riskFlags };
}

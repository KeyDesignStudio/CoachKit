import { z } from 'zod';

import type { AiJsonValue } from '../ai/types';

export const athleteBriefSchema = z.object({
  coachingStyleSummary: z.array(z.string().min(1)).max(6).default([]),
  motivationTriggers: z.array(z.string().min(1)).max(6).default([]),
  riskFlags: z.array(z.string().min(1)).max(6).default([]),
  goalContext: z.array(z.string().min(1)).max(6).default([]),
  swimProfile: z.array(z.string().min(1)).max(6).default([]),
  bikeProfile: z.array(z.string().min(1)).max(6).default([]),
  runProfile: z.array(z.string().min(1)).max(6).default([]),
  lifeConstraints: z.array(z.string().min(1)).max(6).default([]),
  coachFocusNotes: z.array(z.string().min(1)).max(6).default([]),
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
  if (t.includes('injur') || t.includes('pain') || t.includes('sore')) flags.push('Injury risk or pain noted');
  if (t.includes('burnout') || t.includes('overwhelm') || t.includes('fatigue')) flags.push('Burnout or fatigue risk');
  if (t.includes('low confidence') || t.includes('anx')) flags.push('Confidence or anxiety risk');
  if (t.includes('sleep') && (t.includes('poor') || t.includes('inconsistent'))) flags.push('Sleep quality could be limiting');
  return flags;
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

  const coachingStyleSummary: string[] = [];
  const motivationTriggers: string[] = [];
  const riskFlags: string[] = [];
  const goalContext: string[] = [];
  const swimProfile: string[] = [];
  const bikeProfile: string[] = [];
  const runProfile: string[] = [];
  const lifeConstraints: string[] = [];
  const coachFocusNotes: string[] = [];

  const get = (key: string) => normalizeAnswerText(answers[key]);

  pushUnique(coachingStyleSummary, get('coach_feedback_style'));
  pushUnique(coachingStyleSummary, `Check-ins: ${get('coach_checkin_preference')}`);
  pushUnique(coachingStyleSummary, `Tone preference: ${get('coach_tone_preference')}`);
  const structurePref = get('coach_structure_preference');
  if (structurePref) pushUnique(coachingStyleSummary, `Structure level: ${structurePref}/5`);
  pushUnique(coachingStyleSummary, `Green flags: ${get('coach_green_flags')}`);
  pushUnique(coachingStyleSummary, `Avoid: ${get('coach_red_flags')}`);

  pushUnique(motivationTriggers, get('motivation_triggers'));
  pushUnique(motivationTriggers, `Success looks like: ${get('success_definition')}`);
  pushUnique(motivationTriggers, `Tough sessions: ${get('tough_session_response')}`);
  const confidence = get('confidence_level');
  if (confidence) pushUnique(motivationTriggers, `Confidence: ${confidence}/5`);
  pushUnique(motivationTriggers, get('mindset_challenges'));

  const goal = get('primary_goal') || profile.goalsText || '';
  if (goal) pushUnique(goalContext, `Primary goal: ${goal}`);
  pushUnique(goalContext, `Event date: ${get('goal_date')}`);
  pushUnique(goalContext, `Why it matters: ${get('goal_reason')}`);
  pushUnique(goalContext, `Secondary goals: ${get('secondary_goals')}`);
  pushUnique(goalContext, `Experience: ${get('goal_experience_level')}`);
  pushUnique(goalContext, `Next 8–12 weeks focus: ${get('next_12_weeks_priority')}`);

  pushUnique(swimProfile, `Background: ${get('swim_background')}`);
  const swimConfidence = get('swim_open_water_confidence');
  if (swimConfidence) pushUnique(swimProfile, `Open water confidence: ${swimConfidence}/5`);
  pushUnique(swimProfile, `Weekly sessions: ${get('swim_weekly_sessions')}`);
  pushUnique(swimProfile, `Limiter: ${get('swim_limiters')}`);
  pushUnique(swimProfile, `Focus: ${get('swim_preference')}`);
  pushUnique(swimProfile, `Injury notes: ${get('swim_injury_notes')}`);

  pushUnique(bikeProfile, `Background: ${get('bike_background')}`);
  pushUnique(bikeProfile, `Weekly sessions: ${get('bike_weekly_sessions')}`);
  pushUnique(bikeProfile, `Limiter: ${get('bike_limiters')}`);
  pushUnique(bikeProfile, `Focus: ${get('bike_preference')}`);
  pushUnique(bikeProfile, `Environment: ${get('bike_environment')}`);
  pushUnique(bikeProfile, `Injury notes: ${get('bike_injury_notes')}`);

  pushUnique(runProfile, `Background: ${get('run_background')}`);
  pushUnique(runProfile, `Weekly sessions: ${get('run_weekly_sessions')}`);
  pushUnique(runProfile, `Limiter: ${get('run_limiters')}`);
  pushUnique(runProfile, `Focus: ${get('run_preference')}`);
  pushUnique(runProfile, `Surface: ${get('run_surface')}`);
  pushUnique(runProfile, `Injury notes: ${get('run_injury_notes')}`);

  const availabilityDays = get('availability_days');
  if (availabilityDays) pushUnique(lifeConstraints, `Available days: ${availabilityDays}`);
  const availabilityMinutes = get('availability_minutes');
  if (availabilityMinutes) pushUnique(lifeConstraints, `Weekly minutes: ${availabilityMinutes}`);
  pushUnique(lifeConstraints, `Constraints: ${get('schedule_constraints')}`);
  pushUnique(lifeConstraints, `Sleep: ${get('sleep_quality')}`);
  pushUnique(lifeConstraints, `Schedule variability: ${get('travel_variability')}`);
  pushUnique(lifeConstraints, `Equipment: ${get('equipment_access')}`);
  pushUnique(lifeConstraints, `Injury/medical: ${get('injury_risk_notes')}`);

  const riskSignals = detectRiskFlags(
    [
      get('swim_injury_notes'),
      get('bike_injury_notes'),
      get('run_injury_notes'),
      get('injury_risk_notes'),
      get('mindset_challenges'),
      get('sleep_quality'),
    ]
      .filter(Boolean)
      .join(' ')
  );
  riskSignals.forEach((flag) => pushUnique(riskFlags, flag));
  if (confidence && Number(confidence) <= 2) pushUnique(riskFlags, 'Confidence is low right now');

  if (riskFlags.length) {
    pushUnique(coachFocusNotes, 'Start with conservative progression and clear recovery cues.');
  }
  if (availabilityMinutes && Number(availabilityMinutes) < 240) {
    pushUnique(coachFocusNotes, 'Prioritize consistency over volume; keep sessions efficient.');
  }
  if (get('coach_structure_preference') && Number(get('coach_structure_preference')) >= 4) {
    pushUnique(coachFocusNotes, 'Provide a structured week with clear expectations.');
  }
  if (get('coach_checkin_preference')) {
    pushUnique(coachFocusNotes, `Match check-ins to: ${get('coach_checkin_preference')}.`);
  }
  if (goal) pushUnique(coachFocusNotes, `Keep alignment with goal: ${goal}.`);

  return athleteBriefSchema.parse({
    coachingStyleSummary,
    motivationTriggers,
    riskFlags,
    goalContext,
    swimProfile,
    bikeProfile,
    runProfile,
    lifeConstraints,
    coachFocusNotes,
  });
}

export function formatAthleteBriefAsSummaryText(brief: AthleteBriefJson): string {
  const lines: string[] = [];
  const pushSection = (title: string, values: string[]) => {
    if (!values.length) return;
    lines.push(`${title}:`);
    values.forEach((v) => lines.push(`- ${v}`));
  };

  pushSection('Coaching style', brief.coachingStyleSummary ?? []);
  pushSection('Motivation', brief.motivationTriggers ?? []);
  pushSection('Risks', brief.riskFlags ?? []);
  pushSection('Goal context', brief.goalContext ?? []);
  pushSection('Swim', brief.swimProfile ?? []);
  pushSection('Bike', brief.bikeProfile ?? []);
  pushSection('Run', brief.runProfile ?? []);
  pushSection('Life constraints', brief.lifeConstraints ?? []);
  pushSection('Coach focus', brief.coachFocusNotes ?? []);

  return lines.join('\n');
}

import type { AthleteProfileSnapshot } from '@/modules/ai/athlete-brief/types';
import { computeStableSha256 } from '@/modules/ai-plan-builder/rules/stable-hash';

import type { PlanReasoningV1, PlanReasoningItem, PlanReasoningRisk, PlanReasoningTargets, WeekReasoningV1 } from './types';

type DraftPlanJsonV1 = {
  version: 'v1';
  setup?: Record<string, unknown>;
  weeks: Array<{
    weekIndex: number;
    locked?: boolean;
    sessions: Array<{
      weekIndex: number;
      ordinal: number;
      dayOfWeek: number;
      discipline: string;
      type: string;
      durationMinutes: number;
      notes?: string | null;
      locked?: boolean;
    }>;
  }>;
};

type ReasoningInput = {
  athleteProfile: AthleteProfileSnapshot;
  setup: Record<string, any>;
  draftPlanJson: DraftPlanJsonV1;
};

const DAY_NAMES_SUN0 = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function normalizeText(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeLower(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function parseExperienceLevel(value: string): 'beginner' | 'intermediate' | 'advanced' | 'unknown' {
  const v = value.toLowerCase();
  if (v.includes('beginner') || v.includes('novice') || v.includes('new')) return 'beginner';
  if (v.includes('advanced') || v.includes('expert') || v.includes('elite')) return 'advanced';
  if (v.includes('intermediate') || v.includes('some')) return 'intermediate';
  return 'unknown';
}

function deriveWeeklyMinutesTarget(params: {
  profile: AthleteProfileSnapshot;
  setup: Record<string, any>;
}) {
  if (typeof params.profile.weeklyMinutesTarget === 'number' && Number.isFinite(params.profile.weeklyMinutesTarget)) {
    return Math.max(0, Math.round(params.profile.weeklyMinutesTarget));
  }

  const availableDays =
    (Array.isArray(params.profile.availableDays) && params.profile.availableDays.length > 0
      ? params.profile.availableDays.length
      : Array.isArray(params.setup.weeklyAvailabilityDays)
        ? params.setup.weeklyAvailabilityDays.length
        : 4) || 4;

  const experience = parseExperienceLevel(normalizeText(params.profile.experienceLevel));
  const baseMinutes = experience === 'beginner' ? 180 : experience === 'advanced' ? 420 : experience === 'intermediate' ? 300 : 240;
  const scaled = Math.round((baseMinutes * Math.max(3, Math.min(7, availableDays))) / 5);
  return Math.max(120, Math.min(900, scaled));
}

function deriveMaxIntensityDays(params: {
  profile: AthleteProfileSnapshot;
  setup: Record<string, any>;
}) {
  const setupValue = typeof params.setup.maxIntensityDaysPerWeek === 'number' ? Math.round(params.setup.maxIntensityDaysPerWeek) : null;
  const experience = parseExperienceLevel(normalizeText(params.profile.experienceLevel));
  const derived = experience === 'beginner' ? 1 : experience === 'advanced' ? 3 : 2;
  let value = setupValue ?? derived;

  const injury = normalizeLower(params.profile.injuryStatus);
  const sleep = normalizeLower(params.profile.sleepQuality);
  const hasInjury = Boolean(injury) && !injury.includes('no injur');
  const poorSleep = sleep.includes('poor') || sleep.includes('bad');
  if (hasInjury || poorSleep) {
    value = 1;
  }

  const variability = normalizeLower(params.profile.scheduleVariability);
  if (variability.includes('high')) {
    value = Math.max(1, value - 1);
  }

  return Math.max(1, Math.min(3, value));
}

function deriveMaxDoubles(params: { setup: Record<string, any>; profile: AthleteProfileSnapshot }) {
  if (typeof params.setup.maxDoublesPerWeek === 'number' && Number.isFinite(params.setup.maxDoublesPerWeek)) {
    return Math.max(0, Math.round(params.setup.maxDoublesPerWeek));
  }
  const experience = parseExperienceLevel(normalizeText(params.profile.experienceLevel));
  return experience === 'advanced' ? 2 : experience === 'beginner' ? 0 : 1;
}

function isIntensitySession(type: string) {
  const t = normalizeLower(type);
  return (
    t.includes('interval') ||
    t.includes('tempo') ||
    t.includes('threshold') ||
    t.includes('speed') ||
    t.includes('hill') ||
    t.includes('vo2') ||
    t.includes('race') ||
    t.includes('hard')
  );
}

function disciplineKey(value: string) {
  const v = normalizeLower(value);
  if (v.includes('swim')) return 'swim';
  if (v.includes('bike') || v.includes('ride') || v.includes('cycle')) return 'bike';
  if (v.includes('run')) return 'run';
  if (v.includes('strength') || v.includes('gym')) return 'strength';
  return 'other';
}

function weekIntentFor(params: { weekIndex: number; totalWeeks: number }) {
  const { weekIndex, totalWeeks } = params;
  if (totalWeeks <= 0) return 'build' as const;
  if (weekIndex >= totalWeeks - 1) return 'race' as const;
  if (weekIndex >= totalWeeks - 2) return 'taper' as const;
  if ((weekIndex + 1) % 4 === 0) return 'deload' as const;
  if ((weekIndex + 1) % 4 === 1) return 'build' as const;
  return 'consolidate' as const;
}

function formatLongSessionDay(day: number | null) {
  if (day === null || day === undefined) return null;
  return DAY_NAMES_SUN0[day] ?? `Day ${day}`;
}

export function buildPlanReasoningV1(input: ReasoningInput): PlanReasoningV1 {
  const profile = input.athleteProfile ?? ({} as AthleteProfileSnapshot);
  const setup = input.setup ?? {};
  const draftPlanJson = input.draftPlanJson;

  const inputsHash = computeStableSha256({
    profile: {
      experienceLevel: profile.experienceLevel ?? null,
      weeklyMinutesTarget: profile.weeklyMinutesTarget ?? null,
      disciplines: profile.disciplines ?? [],
      swimConfidence: profile.swimConfidence ?? null,
      bikeConfidence: profile.bikeConfidence ?? null,
      runConfidence: profile.runConfidence ?? null,
      availableDays: profile.availableDays ?? [],
      scheduleVariability: profile.scheduleVariability ?? null,
      sleepQuality: profile.sleepQuality ?? null,
      injuryStatus: profile.injuryStatus ?? null,
      constraintsNotes: profile.constraintsNotes ?? null,
      feedbackStyle: profile.feedbackStyle ?? null,
      tonePreference: profile.tonePreference ?? null,
      checkInCadence: profile.checkInCadence ?? null,
      trainingPlanSchedule: profile.trainingPlanSchedule ?? null,
    },
    setup: {
      startDate: setup.startDate ?? null,
      completionDate: setup.completionDate ?? setup.eventDate ?? null,
      weeksToEvent: setup.weeksToEvent ?? null,
      weekStart: setup.weekStart ?? null,
      maxIntensityDaysPerWeek: setup.maxIntensityDaysPerWeek ?? null,
      maxDoublesPerWeek: setup.maxDoublesPerWeek ?? null,
      longSessionDay: setup.longSessionDay ?? null,
      disciplineEmphasis: setup.disciplineEmphasis ?? null,
      weeklyAvailabilityDays: setup.weeklyAvailabilityDays ?? null,
      weeklyAvailabilityMinutes: setup.weeklyAvailabilityMinutes ?? null,
    },
  });

  let weeklyMinutesTarget = deriveWeeklyMinutesTarget({ profile, setup });
  if (normalizeLower(profile.scheduleVariability).includes('high')) {
    weeklyMinutesTarget = Math.max(60, Math.round(weeklyMinutesTarget * 0.9));
  }
  const maxIntensityDaysPerWeek = deriveMaxIntensityDays({ profile, setup });
  const maxDoublesPerWeek = deriveMaxDoubles({ profile, setup });
  const longSessionDay = typeof setup.longSessionDay === 'number' ? setup.longSessionDay : null;

  const priorities: PlanReasoningItem[] = [];
  if (normalizeText(profile.primaryGoal)) {
    priorities.push({ key: 'goal', label: `Anchor on goal: ${normalizeText(profile.primaryGoal)}` });
  }
  if (normalizeText(setup.disciplineEmphasis)) {
    const label = normalizeText(setup.disciplineEmphasis);
    priorities.push({ key: 'discipline-emphasis', label: `Emphasize ${label} focus` });
  }
  const lowConfidence = [
    { key: 'swim', value: profile.swimConfidence },
    { key: 'bike', value: profile.bikeConfidence },
    { key: 'run', value: profile.runConfidence },
  ]
    .filter((c) => typeof c.value === 'number' && (c.value ?? 0) <= 2)
    .map((c) => c.key);
  if (lowConfidence.length) {
    priorities.push({ key: 'confidence', label: `Build confidence in ${lowConfidence.join(', ')}` });
  }

  const constraints: PlanReasoningItem[] = [];
  constraints.push({ key: 'no-consecutive-intensity', label: 'Avoid consecutive intensity days' });
  constraints.push({ key: 'doubles-cap', label: `Cap doubles at ${maxDoublesPerWeek}/week` });
  if (typeof longSessionDay === 'number') {
    constraints.push({ key: 'long-session-day', label: `Long session preference: ${formatLongSessionDay(longSessionDay)}` });
  }
  const availabilityDays = Array.isArray(profile.availableDays) && profile.availableDays.length
    ? profile.availableDays.length
    : Array.isArray(setup.weeklyAvailabilityDays)
      ? setup.weeklyAvailabilityDays.length
      : null;
  if (availabilityDays && availabilityDays <= 3) {
    constraints.push({ key: 'limited-availability', label: `Limited availability (${availabilityDays} days)` });
  }
  if (normalizeLower(profile.scheduleVariability).includes('high')) {
    constraints.push({ key: 'variability', label: 'High schedule variability — keep plan flexible' });
  }

  const risks: PlanReasoningRisk[] = [];
  const injury = normalizeLower(profile.injuryStatus);
  if (injury && !injury.includes('no injur')) {
    risks.push({ key: 'injury', label: `Injury status noted: ${normalizeText(profile.injuryStatus)}`, severity: 'high' });
  }
  const sleep = normalizeLower(profile.sleepQuality);
  if (sleep.includes('poor') || sleep.includes('bad')) {
    risks.push({ key: 'sleep', label: 'Poor sleep quality — keep intensity conservative', severity: 'med' });
  }
  if (normalizeLower(profile.scheduleVariability).includes('high')) {
    risks.push({ key: 'variability', label: 'High schedule variability may disrupt consistency', severity: 'med' });
  }
  if (typeof setup.weeklyAvailabilityMinutes === 'number' && weeklyMinutesTarget > setup.weeklyAvailabilityMinutes) {
    risks.push({ key: 'time-budget', label: 'Weekly minutes target exceeds declared time budget', severity: 'low' });
  }

  const targets: PlanReasoningTargets = {
    weeklyMinutesTarget,
    maxIntensityDaysPerWeek,
    maxDoublesPerWeek,
    longSessionDay,
  };

  const explanations: string[] = [];
  explanations.push(`Weekly minutes target set to ${weeklyMinutesTarget} based on profile and availability.`);
  explanations.push(`Intensity capped at ${maxIntensityDaysPerWeek} day(s) per week to align with recovery signals.`);
  if (lowConfidence.length) {
    explanations.push(`Low-confidence disciplines (${lowConfidence.join(', ')}) get extra volume focus with reduced intensity.`);
  }
  if (normalizeLower(profile.scheduleVariability).includes('high')) {
    explanations.push('High variability drives a more conservative week-to-week progression.');
  }

  const weeks: WeekReasoningV1[] = draftPlanJson.weeks.map((week, idx) => {
    const totalMinutes = week.sessions.reduce((sum, s) => sum + (Number(s.durationMinutes) || 0), 0);
    const prevWeek = draftPlanJson.weeks[idx - 1];
    const prevMinutes = prevWeek ? prevWeek.sessions.reduce((sum, s) => sum + (Number(s.durationMinutes) || 0), 0) : 0;
    const volumeDeltaPct = prevMinutes > 0 ? Math.round(((totalMinutes - prevMinutes) / prevMinutes) * 100) : 0;

    const intensityDays = new Set<number>();
    const split: Record<string, number> = {};

    for (const session of week.sessions) {
      if (isIntensitySession(session.type)) {
        intensityDays.add(Number(session.dayOfWeek) || 0);
      }
      const key = disciplineKey(session.discipline);
      split[key] = (split[key] ?? 0) + (Number(session.durationMinutes) || 0);
    }

    const notes: string[] = [];
    const intent = weekIntentFor({ weekIndex: week.weekIndex, totalWeeks: draftPlanJson.weeks.length });
    notes.push(`Week intent: ${intent}.`);
    if (typeof longSessionDay === 'number') {
      notes.push(`Long session is targeted for ${formatLongSessionDay(longSessionDay)}.`);
    }
    if (volumeDeltaPct !== 0) {
      notes.push(`Volume change vs prior week: ${volumeDeltaPct > 0 ? '+' : ''}${volumeDeltaPct}%.`);
    }

    return {
      weekIndex: week.weekIndex,
      weekIntent: intent,
      volumeMinutesPlanned: totalMinutes,
      volumeDeltaPct,
      intensityDaysPlanned: intensityDays.size,
      disciplineSplitMinutes: {
        swim: split.swim,
        bike: split.bike,
        run: split.run,
        strength: split.strength,
        other: split.other,
      },
      notes,
    };
  });

  return {
    version: 'v1',
    generatedAt: new Date().toISOString(),
    inputsHash,
    priorities,
    constraints,
    risks,
    targets,
    explanations,
    weeks,
  };
}

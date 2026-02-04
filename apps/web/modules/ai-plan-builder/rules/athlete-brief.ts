import {
  athleteBriefSchema,
  athleteBriefV1Schema,
  athleteBriefV1_1Schema,
  type AthleteBriefJson,
  type AthleteProfileSnapshot,
} from '@/modules/ai/athlete-brief/types';
import { mergeBriefInput } from '@/modules/ai/athlete-brief/merge';
import { buildAthleteBriefV1_1 } from '@/modules/ai/athlete-brief/builder';

export { athleteBriefSchema, athleteBriefV1Schema, athleteBriefV1_1Schema };
export type { AthleteBriefJson, AthleteProfileSnapshot };

export function buildAthleteBriefDeterministic(params: {
  profile?: AthleteProfileSnapshot | null;
}): AthleteBriefJson {
  const input = mergeBriefInput({ athleteProfile: params.profile ?? null });
  return buildAthleteBriefV1_1(input).briefJson;
}

export function formatAthleteBriefAsSummaryText(brief: AthleteBriefJson): string {
  const lines: string[] = [];
  const pushLine = (label: string, value: string | number | undefined | null) => {
    if (value == null || value === '') return;
    lines.push(`${label}: ${value}`);
  };
  const pushList = (label: string, values: string[] | undefined | null) => {
    if (!values?.length) return;
    lines.push(`${label}: ${values.join(', ')}`);
  };

  if (brief.version === 'v1.1') {
    pushLine('Goal', brief.snapshot?.primaryGoal ?? undefined);
    pushLine('Experience', brief.snapshot?.experienceLabel ?? undefined);
    pushList('Disciplines', brief.snapshot?.disciplines ?? []);
    pushList('Tags', brief.snapshot?.tags ?? []);

    pushLine('Weekly minutes', brief.trainingProfile?.weeklyMinutesTarget ?? undefined);
    pushList('Availability', brief.trainingProfile?.availabilityDays ?? []);
    pushLine('Schedule', brief.trainingProfile?.scheduleNotes ?? undefined);
    pushLine('Timezone', brief.trainingProfile?.timezone ?? undefined);

    pushLine('Injury status', brief.constraintsAndSafety?.injuryStatus ?? undefined);
    pushList('Pain history', brief.constraintsAndSafety?.painHistory ?? []);
    pushLine('Sleep quality', brief.constraintsAndSafety?.sleepQuality ?? undefined);
    pushLine('Safety notes', brief.constraintsAndSafety?.notes ?? undefined);

    pushLine('Coach notes', brief.coachObservations?.notes ?? undefined);

    pushLine('Plan guidance', brief.planGuidance ?? undefined);
    pushList('Risk flags', brief.riskFlags ?? []);

    return lines.join('\n');
  }

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

import { briefInputSchema, type AthleteProfileSnapshot, type BriefInput } from './types';

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatScheduleNotes(profile?: AthleteProfileSnapshot | null): string | undefined {
  if (!profile?.trainingPlanSchedule) return undefined;
  const frequency = profile.trainingPlanSchedule.frequency ?? null;
  const dayOfWeek = profile.trainingPlanSchedule.dayOfWeek ?? null;
  const weekOfMonth = profile.trainingPlanSchedule.weekOfMonth ?? null;

  if (!frequency || frequency === 'AD_HOC') return undefined;

  if (frequency === 'WEEKLY' && dayOfWeek !== null) {
    return `Weekly on ${dayNames[dayOfWeek] ?? 'selected day'}`;
  }

  if (frequency === 'FORTNIGHTLY' && dayOfWeek !== null) {
    return `Fortnightly on ${dayNames[dayOfWeek] ?? 'selected day'}`;
  }

  if (frequency === 'MONTHLY' && weekOfMonth !== null && dayOfWeek !== null) {
    return `Monthly (week ${weekOfMonth}) on ${dayNames[dayOfWeek] ?? 'selected day'}`;
  }

  return 'Schedule set by coach';
}

function availabilityFromSchedule(profile?: AthleteProfileSnapshot | null): string[] {
  if (!profile?.trainingPlanSchedule) return [];
  const dayOfWeek = profile.trainingPlanSchedule.dayOfWeek ?? null;
  if (dayOfWeek === null || dayOfWeek === undefined) return [];
  const label = dayNames[dayOfWeek];
  return label ? [label] : [];
}

function formatPainHistory(profile?: AthleteProfileSnapshot | null): string[] {
  const items = profile?.painHistory ?? [];
  if (!items.length) return [];
  return items.slice(0, 5).map((item) => String(item));
}

function hasCoachProfileData(profile?: AthleteProfileSnapshot | null): boolean {
  if (!profile) return false;
  return Boolean(
    profile.disciplines?.length ||
      profile.primaryGoal ||
      profile.focus ||
      profile.timelineWeeks ||
      profile.coachNotes ||
      profile.trainingPlanSchedule ||
      profile.timezone ||
      profile.dateOfBirth ||
      profile.painHistory?.length ||
      profile.availableDays?.length
  );
}

export function mergeBriefInput(params: {
  athleteProfile?: AthleteProfileSnapshot | null;
}): BriefInput {
  const profile = params.athleteProfile ?? null;
  const profileDisciplines = Array.isArray(profile?.disciplines) ? profile?.disciplines.map(String) : [];
  const profileAvailabilityDays = Array.isArray(profile?.availableDays) ? profile?.availableDays.map(String) : [];
  const scheduleDays = availabilityFromSchedule(profile);
  const painHistory = formatPainHistory(profile);
  const structurePreference = profile?.structurePreference != null ? `${profile.structurePreference}/5` : undefined;
  const experienceLevel = profile?.experienceLevel || (profileDisciplines.length ? 'some experience' : undefined) || 'unknown';
  const timelineLabel = profile?.timelineWeeks ? `${profile.timelineWeeks} weeks` : undefined;

  const briefInput = {
    sourcesPresent: {
      intake: false,
      coachProfile: hasCoachProfileData(profile),
    },
    goalPrimary: profile?.primaryGoal || undefined,
    goalFocus: profile?.focus || undefined,
    goalTimeline: timelineLabel,
    secondaryGoals: profile?.secondaryGoals ?? undefined,
    eventName: profile?.eventName || undefined,
    eventDate: profile?.eventDate || undefined,
    disciplines: profileDisciplines,
    experienceLevel,
    availabilityDays: profileAvailabilityDays.length ? profileAvailabilityDays : scheduleDays,
    weeklyMinutes: profile?.weeklyMinutesTarget ?? undefined,
    scheduleNotes: formatScheduleNotes(profile),
    recentConsistency: profile?.consistencyLevel || undefined,
    sleepQuality: profile?.sleepQuality || undefined,
    injuryStatus: profile?.injuryStatus || (painHistory.length ? painHistory.join('; ') : undefined),
    constraintNotes: profile?.constraintsNotes || profile?.travelConstraints || undefined,
    coachNotes: profile?.coachNotes || undefined,
    goalsText: undefined,
    painHistory,
    timezone: profile?.timezone || undefined,
    dateOfBirth: profile?.dateOfBirth || undefined,
    coachingPreferences: {
      tone: profile?.tonePreference || undefined,
      feedbackStyle: profile?.feedbackStyle || undefined,
      checkinCadence: profile?.checkInCadence || undefined,
      structurePreference,
      motivationStyle: profile?.motivationStyle || undefined,
    },
  } satisfies BriefInput;

  return briefInputSchema.parse(briefInput);
}

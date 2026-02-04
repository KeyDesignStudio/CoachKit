import { prisma } from '@/lib/prisma';

import { type AthleteBriefJson, type AthleteProfileSnapshot } from '@/modules/ai/athlete-brief/types';
import { ensureAthleteBriefFromSources } from '@/modules/ai/athlete-brief/store';
import { formatAthleteBriefAsSummaryText } from '../rules/athlete-brief';

export async function getLatestAthleteBrief(params: { coachId: string; athleteId: string }) {
  return ensureAthleteBrief({ coachId: params.coachId, athleteId: params.athleteId });
}

export async function getLatestAthleteBriefJson(params: { coachId: string; athleteId: string }): Promise<AthleteBriefJson | null> {
  const generated = await ensureAthleteBrief({ coachId: params.coachId, athleteId: params.athleteId });
  return generated.brief ?? null;
}

export async function getLatestAthleteBriefSummary(params: { coachId: string; athleteId: string }): Promise<string | null> {
  const generated = await ensureAthleteBrief({ coachId: params.coachId, athleteId: params.athleteId });
  if (generated.summaryText) return generated.summaryText;
  if (!generated.brief) return null;
  return formatAthleteBriefAsSummaryText(generated.brief);
}

export async function loadAthleteProfileSnapshot(params: {
  coachId: string;
  athleteId: string;
}): Promise<AthleteProfileSnapshot | null> {
  const profile = await prisma.athleteProfile.findUnique({
    where: { userId: params.athleteId },
    select: {
      firstName: true,
      lastName: true,
      gender: true,
      timezone: true,
      trainingSuburb: true,
      email: true,
      mobilePhone: true,
      dateOfBirth: true,
      disciplines: true,
      primaryGoal: true,
      secondaryGoals: true,
      focus: true,
      eventName: true,
      eventDate: true,
      timelineWeeks: true,
      experienceLevel: true,
      weeklyMinutesTarget: true,
      consistencyLevel: true,
      swimConfidence: true,
      bikeConfidence: true,
      runConfidence: true,
      availableDays: true,
      scheduleVariability: true,
      sleepQuality: true,
      equipmentAccess: true,
      travelConstraints: true,
      injuryStatus: true,
      constraintsNotes: true,
      feedbackStyle: true,
      tonePreference: true,
      checkInCadence: true,
      structurePreference: true,
      motivationStyle: true,
      trainingPlanSchedule: true,
      coachNotes: true,
      painHistory: true,
      coachJournal: true,
    },
  });

  if (!profile) return null;

  return {
    firstName: profile.firstName ?? null,
    lastName: profile.lastName ?? null,
    gender: profile.gender ?? null,
    timezone: profile.timezone ?? null,
    trainingSuburb: profile.trainingSuburb ?? null,
    email: profile.email ?? null,
    mobilePhone: profile.mobilePhone ?? null,
    dateOfBirth: profile.dateOfBirth ? profile.dateOfBirth.toISOString().split('T')[0] : null,
    disciplines: profile.disciplines ?? [],
    primaryGoal: profile.primaryGoal ?? null,
    secondaryGoals: profile.secondaryGoals ?? [],
    focus: profile.focus ?? null,
    eventName: profile.eventName ?? null,
    eventDate: profile.eventDate ? profile.eventDate.toISOString().split('T')[0] : null,
    timelineWeeks: profile.timelineWeeks ?? null,
    experienceLevel: profile.experienceLevel ?? null,
    weeklyMinutesTarget: profile.weeklyMinutesTarget ?? null,
    consistencyLevel: profile.consistencyLevel ?? null,
    swimConfidence: profile.swimConfidence ?? null,
    bikeConfidence: profile.bikeConfidence ?? null,
    runConfidence: profile.runConfidence ?? null,
    availableDays: profile.availableDays ?? [],
    scheduleVariability: profile.scheduleVariability ?? null,
    sleepQuality: profile.sleepQuality ?? null,
    equipmentAccess: profile.equipmentAccess ?? null,
    travelConstraints: profile.travelConstraints ?? null,
    injuryStatus: profile.injuryStatus ?? null,
    constraintsNotes: profile.constraintsNotes ?? null,
    feedbackStyle: profile.feedbackStyle ?? null,
    tonePreference: profile.tonePreference ?? null,
    checkInCadence: profile.checkInCadence ?? null,
    structurePreference: profile.structurePreference ?? null,
    motivationStyle: profile.motivationStyle ?? null,
    trainingPlanSchedule: (profile.trainingPlanSchedule as AthleteProfileSnapshot['trainingPlanSchedule']) ?? null,
    coachNotes: profile.coachNotes ?? null,
    painHistory: Array.isArray(profile.painHistory) ? (profile.painHistory as string[]) : null,
    coachJournal: profile.coachJournal ?? null,
  };
}

export async function ensureAthleteBrief(params: {
  coachId: string;
  athleteId: string;
}) {
  const profile = await loadAthleteProfileSnapshot({ coachId: params.coachId, athleteId: params.athleteId });
  return ensureAthleteBriefFromSources({
    athleteId: params.athleteId,
    coachId: params.coachId,
    athleteProfile: profile,
  });
}

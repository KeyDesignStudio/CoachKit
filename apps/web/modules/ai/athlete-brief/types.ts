import { z } from 'zod';

const briefListSchema = z.array(z.string().min(1)).max(8).default([]);

export const athleteBriefV1Schema = z.object({
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

export const athleteBriefV1_1Schema = z.object({
  version: z.literal('v1.1'),
  snapshot: z
    .object({
      primaryGoal: z.string().min(1).max(240).optional(),
      disciplines: z.array(z.string().min(1)).max(6).default([]),
      experienceLabel: z.string().min(1).max(120).optional(),
      tags: briefListSchema,
    })
    .default({ disciplines: [], tags: [] }),
  coachingPreferences: z
    .object({
      tone: z.string().min(1).max(120).optional(),
      feedbackStyle: z.string().min(1).max(120).optional(),
      checkinCadence: z.string().min(1).max(120).optional(),
      structurePreference: z.string().min(1).max(120).optional(),
      motivationStyle: z.string().min(1).max(120).optional(),
    })
    .default({}),
  trainingProfile: z
    .object({
      weeklyMinutesTarget: z.number().int().min(0).max(1500).optional(),
      availabilityDays: z.array(z.string().min(1)).max(7).default([]),
      scheduleNotes: z.string().min(1).max(160).optional(),
      recentConsistency: z.string().min(1).max(120).optional(),
      timezone: z.string().min(1).max(80).optional(),
      dateOfBirth: z.string().min(1).max(32).optional(),
    })
    .default({ availabilityDays: [] }),
  constraintsAndSafety: z
    .object({
      injuryStatus: z.string().min(1).max(200).optional(),
      painHistory: z.array(z.string().min(1)).max(8).default([]),
      sleepQuality: z.string().min(1).max(120).optional(),
      notes: z.string().min(1).max(240).optional(),
    })
    .default({ painHistory: [] }),
  coachObservations: z
    .object({
      notes: z.string().min(1).max(500).optional(),
      goalsText: z.string().min(1).max(240).optional(),
    })
    .default({}),
  planGuidance: z.string().min(1).max(400).optional(),
  riskFlags: briefListSchema,
  provenance: z
    .object({
      intake: z.boolean().default(false),
      coachProfile: z.boolean().default(false),
    })
    .default({ intake: false, coachProfile: false }),
  generatedAt: z.string().min(1).max(40).optional(),
  updatedAt: z.string().min(1).max(40).optional(),
});

export const athleteBriefSchema = z.union([athleteBriefV1_1Schema, athleteBriefV1Schema]);

export type AthleteBriefV1 = z.infer<typeof athleteBriefV1Schema>;
export type AthleteBriefV1_1 = z.infer<typeof athleteBriefV1_1Schema>;
export type AthleteBriefJson = z.infer<typeof athleteBriefSchema>;

export const briefInputSchema = z.object({
  sourcesPresent: z.object({
    intake: z.boolean().default(false),
    coachProfile: z.boolean().default(false),
  }),
  goalPrimary: z.string().optional(),
  goalFocus: z.string().optional(),
  goalTimeline: z.string().optional(),
  secondaryGoals: z.array(z.string()).optional(),
  eventName: z.string().optional(),
  eventDate: z.string().optional(),
  disciplines: z.array(z.string().min(1)).max(6).default([]),
  experienceLevel: z.string().optional(),
  availabilityDays: z.array(z.string().min(1)).max(7).default([]),
  weeklyMinutes: z.number().int().min(0).max(1500).optional(),
  scheduleNotes: z.string().optional(),
  recentConsistency: z.string().optional(),
  sleepQuality: z.string().optional(),
  injuryStatus: z.string().optional(),
  constraintNotes: z.string().optional(),
  coachNotes: z.string().optional(),
  goalsText: z.string().optional(),
  painHistory: z.array(z.string().min(1)).max(8).default([]),
  timezone: z.string().optional(),
  dateOfBirth: z.string().optional(),
  coachingPreferences: z
    .object({
      tone: z.string().optional(),
      feedbackStyle: z.string().optional(),
      checkinCadence: z.string().optional(),
      structurePreference: z.string().optional(),
      motivationStyle: z.string().optional(),
    })
    .default({}),
});

export type BriefInput = z.infer<typeof briefInputSchema>;

export type AthleteProfileSnapshot = {
  firstName?: string | null;
  lastName?: string | null;
  gender?: string | null;
  timezone?: string | null;
  trainingSuburb?: string | null;
  email?: string | null;
  mobilePhone?: string | null;
  dateOfBirth?: string | null;
  disciplines?: string[];
  primaryGoal?: string | null;
  secondaryGoals?: string[];
  focus?: string | null;
  eventName?: string | null;
  eventDate?: string | null;
  timelineWeeks?: number | null;
  experienceLevel?: string | null;
  weeklyMinutesTarget?: number | null;
  consistencyLevel?: string | null;
  swimConfidence?: number | null;
  bikeConfidence?: number | null;
  runConfidence?: number | null;
  availableDays?: string[];
  scheduleVariability?: string | null;
  sleepQuality?: string | null;
  equipmentAccess?: string | null;
  travelConstraints?: string | null;
  injuryStatus?: string | null;
  constraintsNotes?: string | null;
  feedbackStyle?: string | null;
  tonePreference?: string | null;
  checkInCadence?: string | null;
  structurePreference?: number | null;
  motivationStyle?: string | null;
  trainingPlanSchedule?: {
    frequency?: string | null;
    dayOfWeek?: number | null;
    weekOfMonth?: number | null;
  } | null;
  coachNotes?: string | null;
  painHistory?: string[] | null;
  coachJournal?: string | null;
};

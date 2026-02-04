import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

export const athleteIntakeAnswerSchema = z.object({
  questionKey: z.string().min(1),
  answer: z.unknown(),
});

export const athleteIntakeSectionSchema = z.object({
  key: z.string().min(1),
  title: z.string().optional().nullable(),
  answers: z.array(athleteIntakeAnswerSchema),
});

export const athleteIntakeSubmissionSchema = z.object({
  version: z.string().optional().nullable(),
  sections: z.array(athleteIntakeSectionSchema).min(1),
});

export type AthleteIntakeSubmissionPayload = z.infer<typeof athleteIntakeSubmissionSchema>;

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
  'In 6–8 weeks': 8,
  'In 2–3 months': 12,
  'In 3–6 months': 24,
  'In 6–12 months': 48,
};

function flattenIntakeAnswers(payload: AthleteIntakeSubmissionPayload): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const section of payload.sections ?? []) {
    for (const answer of section.answers ?? []) {
      map[String(answer.questionKey)] = answer.answer as unknown;
    }
  }
  return map;
}

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

function normalizeDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return new Date(`${trimmed}T00:00:00.000Z`);
    }
  }
  return null;
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => normalizeText(v)).filter((v): v is string => Boolean(v));
  }
  const text = normalizeText(value);
  if (!text) return [];
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function mapIntakeToAthleteProfileUpdate(payload: AthleteIntakeSubmissionPayload) {
  const answers = flattenIntakeAnswers(payload);
  const get = (key: string) => normalizeText(answers[key]);
  const getList = (key: string) => normalizeList(answers[key]);
  const getNumber = (key: string) => normalizeNumber(answers[key]);
  const getDate = (key: string) => normalizeDate(answers[key]);

  const goalType = get('goal_type');
  const goalDetails = get('goal_details');
  const goalFocus = get('goal_focus');
  const goalTimeline = get('goal_timeline');

  const availabilityDays = getList('availability_days').map((d) => DAY_LABELS[d] ?? d);

  return {
    firstName: get('first_name'),
    lastName: get('last_name'),
    gender: get('gender'),
    trainingSuburb: get('training_suburb'),
    mobilePhone: get('mobile_phone'),
    dateOfBirth: getDate('date_of_birth'),
    disciplines: getList('disciplines'),
    primaryGoal: goalDetails ?? goalType,
    secondaryGoals: getList('secondary_goals'),
    focus: goalFocus,
    eventName: get('event_name'),
    eventDate: getDate('event_date'),
    timelineWeeks: goalTimeline ? GOAL_TIMELINE_WEEKS[goalTimeline] ?? null : null,
    experienceLevel: get('experience_level'),
    weeklyMinutesTarget: getNumber('weekly_minutes'),
    consistencyLevel: get('recent_consistency'),
    swimConfidence: getNumber('swim_confidence'),
    bikeConfidence: getNumber('bike_confidence'),
    runConfidence: getNumber('run_confidence'),
    availableDays: availabilityDays,
    scheduleVariability: get('schedule_variability'),
    sleepQuality: get('sleep_quality'),
    equipmentAccess: get('equipment_access'),
    travelConstraints: get('travel_constraints'),
    injuryStatus: get('injury_status'),
    constraintsNotes: get('constraints_notes'),
    feedbackStyle: get('feedback_style'),
    tonePreference: get('tone_preference'),
    checkInCadence: get('checkin_preference'),
    structurePreference: getNumber('structure_preference'),
    motivationStyle: get('motivation_style'),
  };
}

export async function applyIntakeToAthleteProfile(params: {
  athleteId: string;
  coachId: string;
  payload: AthleteIntakeSubmissionPayload;
}) {
  const updates = mapIntakeToAthleteProfileUpdate(params.payload);

  return prisma.athleteProfile.update({
    where: { userId: params.athleteId },
    data: updates,
  });
}

export async function createAthleteIntakeSubmission(params: {
  athleteId: string;
  coachId: string;
  payload: AthleteIntakeSubmissionPayload;
}) {
  const payload = athleteIntakeSubmissionSchema.parse(params.payload);

  const submission = await (prisma as any).athleteIntakeSubmission.create({
    data: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      answersJson: payload as unknown,
      submittedAt: new Date(),
    },
  });

  await applyIntakeToAthleteProfile({ athleteId: params.athleteId, coachId: params.coachId, payload });

  return submission;
}

export async function getLatestAthleteIntakeSubmission(params: {
  athleteId: string;
  coachId: string;
}) {
  return (prisma as any).athleteIntakeSubmission.findFirst({
    where: { athleteId: params.athleteId, coachId: params.coachId },
    orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function requireAthleteCoachId(athleteId: string): Promise<string> {
  const profile = await prisma.athleteProfile.findUnique({
    where: { userId: athleteId },
    select: { coachId: true },
  });
  if (!profile?.coachId) {
    throw new ApiError(400, 'COACH_REQUIRED', 'Athlete must be assigned to a coach to submit intake.');
  }
  return profile.coachId;
}

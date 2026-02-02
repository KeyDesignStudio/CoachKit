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

export async function createAthleteIntakeSubmission(params: {
  athleteId: string;
  coachId: string;
  payload: AthleteIntakeSubmissionPayload;
}) {
  const payload = athleteIntakeSubmissionSchema.parse(params.payload);

  return (prisma as any).athleteIntakeSubmission.create({
    data: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      answersJson: payload as unknown,
      submittedAt: new Date(),
    },
  });
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

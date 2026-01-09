import { NextRequest } from 'next/server';
import { UserRole } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';

const createAthleteSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1),
  timezone: z.string().trim().min(1),
  disciplines: z.array(z.string().trim().min(1)).min(1),
  goalsText: z.string().trim().max(2000).optional(),
  planCadenceDays: z.number().int().min(1).max(42).optional().default(7),
});

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireCoach();

    const athletes = await prisma.athleteProfile.findMany({
      where: { coachId: user.id },
      include: { user: true },
      orderBy: { user: { createdAt: 'asc' } },
    });

    return success({ athletes });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireCoach();
    const payload = createAthleteSchema.parse(await request.json());

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: payload.email } });

      if (existing) {
        throw new ApiError(409, 'EMAIL_IN_USE', 'Email is already registered.');
      }

      const athleteUser = await tx.user.create({
        data: {
          email: payload.email,
          name: payload.name,
          role: UserRole.ATHLETE,
          timezone: payload.timezone,
        },
      });

      return tx.athleteProfile.create({
        data: {
          userId: athleteUser.id,
          coachId: user.id,
          disciplines: payload.disciplines,
          goalsText: payload.goalsText,
          planCadenceDays: payload.planCadenceDays,
        },
        include: { user: true },
      });
    });

    return success({ athlete: result }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

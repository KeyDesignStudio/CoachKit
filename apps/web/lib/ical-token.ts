import crypto from 'crypto';

import { prisma } from '@/lib/prisma';
import { notFound } from '@/lib/errors';

export function createIcalToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function getOrCreateIcalToken(athleteUserId: string): Promise<{ token: string; rotatedAt: Date }> {
  const existing = await prisma.athleteProfile.findUnique({
    where: { userId: athleteUserId },
    select: { icalToken: true, icalTokenRotatedAt: true },
  });

  if (!existing) {
    throw notFound('Athlete profile not found.');
  }

  if (existing.icalToken) {
    return { token: existing.icalToken, rotatedAt: existing.icalTokenRotatedAt ?? new Date(0) };
  }

  const rotatedAt = new Date();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = createIcalToken();

    try {
      const updated = await prisma.athleteProfile.update({
        where: { userId: athleteUserId },
        data: { icalToken: token, icalTokenRotatedAt: rotatedAt },
        select: { icalToken: true, icalTokenRotatedAt: true },
      });

      if (updated.icalToken) {
        return { token: updated.icalToken, rotatedAt: updated.icalTokenRotatedAt ?? rotatedAt };
      }
    } catch (err: any) {
      // Unique constraint collision is extremely unlikely, but we retry just in case.
      if (err?.code === 'P2002') continue;
      throw err;
    }
  }

  throw new Error('Failed to generate a unique iCal token.');
}

export async function rotateIcalToken(athleteUserId: string): Promise<{ token: string; rotatedAt: Date }> {
  const profile = await prisma.athleteProfile.findUnique({
    where: { userId: athleteUserId },
    select: { userId: true },
  });

  if (!profile) {
    throw notFound('Athlete profile not found.');
  }

  const rotatedAt = new Date();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = createIcalToken();

    try {
      const updated = await prisma.athleteProfile.update({
        where: { userId: athleteUserId },
        data: { icalToken: token, icalTokenRotatedAt: rotatedAt },
        select: { icalToken: true, icalTokenRotatedAt: true },
      });

      if (updated.icalToken) {
        return { token: updated.icalToken, rotatedAt: updated.icalTokenRotatedAt ?? rotatedAt };
      }
    } catch (err: any) {
      if (err?.code === 'P2002') continue;
      throw err;
    }
  }

  throw new Error('Failed to rotate iCal token.');
}

import crypto from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { notFound } from '@/lib/errors';

function generateToken(): string {
  // URL-safe token for calendar subscriptions.
  // Keep it opaque; treat as a secret bearer token.
  return crypto.randomBytes(24).toString('base64url');
}

async function ensureAthleteProfileExists(userId: string) {
  const profile = (await prisma.athleteProfile.findUnique(
    {
      where: { userId },
      select: { userId: true, icalToken: true },
    } as any
  )) as { userId: string; icalToken: string | null } | null;

  if (!profile) {
    throw notFound('Athlete profile not found.');
  }

  return profile;
}

export async function getOrCreateIcalToken(userId: string): Promise<{ token: string }> {
  const profile = await ensureAthleteProfileExists(userId);
  if (profile.icalToken) return { token: profile.icalToken };

  // Token must be unique; retry in the extremely unlikely event of collision.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = generateToken();

    try {
      const updated = (await prisma.athleteProfile.update(
        {
          where: { userId },
          data: { icalToken: token, icalTokenRotatedAt: new Date() },
          select: { icalToken: true },
        } as any
      )) as unknown as { icalToken: string | null };

      if (!updated.icalToken) {
        throw new Error('Failed to persist iCal token.');
      }

      return { token: updated.icalToken };
    } catch (error) {
      // Retry on unique constraint violation.
      if (typeof error === 'object' && error && 'code' in error && (error as any).code === 'P2002') {
        continue;
      }
      throw error;
    }
  }

  throw new Error('Failed to generate a unique iCal token.');
}

export async function rotateIcalToken(userId: string): Promise<{ token: string }> {
  await ensureAthleteProfileExists(userId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = generateToken();

    try {
      const updated = (await prisma.athleteProfile.update(
        {
          where: { userId },
          data: { icalToken: token, icalTokenRotatedAt: new Date() },
          select: { icalToken: true },
        } as any
      )) as unknown as { icalToken: string | null };

      if (!updated.icalToken) {
        throw new Error('Failed to rotate iCal token.');
      }

      return { token: updated.icalToken };
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && (error as any).code === 'P2002') {
        continue;
      }
      throw error;
    }
  }

  throw new Error('Failed to rotate iCal token.');
}

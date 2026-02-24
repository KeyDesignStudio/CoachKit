import { NextRequest } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type RecipientRow = {
  id: string;
  name: string;
  type: 'COACH' | 'ATHLETE' | 'ALL_SQUAD';
};

function firstNameOf(name: string) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return '';
  const [first = ''] = trimmed.split(/\s+/);
  return first.toLowerCase();
}

export async function GET(_request: NextRequest) {
  try {
    const { user } = await requireAuth();

    if (user.role === 'COACH') {
      const athletes = await prisma.athleteProfile.findMany({
        where: { coachId: user.id },
        select: { user: { select: { id: true, name: true } } },
      });

      const athleteRows: RecipientRow[] = athletes
        .map((row) => ({
          id: row.user.id,
          name: String(row.user.name ?? 'Athlete'),
          type: 'ATHLETE' as const,
        }))
        .sort((a, b) => firstNameOf(a.name).localeCompare(firstNameOf(b.name)) || a.name.localeCompare(b.name));

      return success({
        recipients: [
          { id: 'ALL_SQUAD', name: 'All squad members', type: 'ALL_SQUAD' as const },
          ...athleteRows,
        ],
      });
    }

    const athleteProfile = await prisma.athleteProfile.findUnique({
      where: { userId: user.id },
      select: { coachId: true },
    });

    if (!athleteProfile) {
      return success({ recipients: [] });
    }

    const [coach, coachedAthletes] = await Promise.all([
      prisma.user.findUnique({
        where: { id: athleteProfile.coachId },
        select: { id: true, name: true },
      }),
      prisma.athleteProfile.findMany({
        where: {
          coachId: athleteProfile.coachId,
          userId: { not: user.id },
        },
        select: {
          user: { select: { id: true, name: true } },
        },
      }),
    ]);

    const coachRow: RecipientRow[] = coach
      ? [{ id: coach.id, name: String(coach.name ?? 'Coach'), type: 'COACH' as const }]
      : [];

    const athleteRows: RecipientRow[] = coachedAthletes
      .map((row) => ({
        id: row.user.id,
        name: String(row.user.name ?? 'Athlete'),
        type: 'ATHLETE' as const,
      }))
      .sort((a, b) => firstNameOf(a.name).localeCompare(firstNameOf(b.name)) || a.name.localeCompare(b.name));

    return success({
      recipients: [...coachRow, ...athleteRows],
    });
  } catch (error) {
    return handleError(error);
  }
}

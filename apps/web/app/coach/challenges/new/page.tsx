import { requireCoach } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ChallengeCreateForm } from '@/app/coach/challenges/new/ChallengeCreateForm';

export const dynamic = 'force-dynamic';

export default async function NewCoachChallengePage() {
  const { user } = await requireCoach();

  const squads = await prisma.squad.findMany({
    where: { coachId: user.id },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  return <ChallengeCreateForm squads={squads} />;
}

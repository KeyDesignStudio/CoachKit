import { CoachChallengeDetailClient } from '@/app/coach/challenges/[id]/CoachChallengeDetailClient';

export const dynamic = 'force-dynamic';

export default function CoachChallengeDetailPage({ params }: { params: { id: string } }) {
  return <CoachChallengeDetailClient challengeId={params.id} />;
}

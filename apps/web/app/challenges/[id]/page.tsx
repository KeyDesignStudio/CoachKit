import { AthleteChallengeDetailClient } from '@/app/challenges/[id]/AthleteChallengeDetailClient';

export const dynamic = 'force-dynamic';

export default function AthleteChallengeDetailPage({ params }: { params: { id: string } }) {
  return <AthleteChallengeDetailClient challengeId={params.id} />;
}

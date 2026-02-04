'use client';

import { useParams, useRouter } from 'next/navigation';

import { AthleteDetailDrawer } from '@/components/coach/AthleteDetailDrawer';

export default function AthleteProfilePage() {
  const router = useRouter();
  const params = useParams();
  const athleteIdParam = params?.athleteId;
  const athleteId = Array.isArray(athleteIdParam) ? athleteIdParam[0] : athleteIdParam ?? null;

  if (!athleteId) {
    return (
      <div className="px-6 pt-6">
        <p className="text-[var(--muted)]">Athlete not found.</p>
      </div>
    );
  }

  return (
    <section className="px-6 py-6">
      <AthleteDetailDrawer
        isOpen={true}
        athleteId={athleteId}
        onClose={() => router.push('/coach/athletes')}
        onSaved={() => undefined}
        onDeleted={() => router.push('/coach/athletes')}
        variant="page"
      />
    </section>
  );
}

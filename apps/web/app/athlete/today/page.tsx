'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AthleteTodayPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/athlete/calendar');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-[var(--muted)]">Redirecting to calendar...</p>
    </div>
  );
}

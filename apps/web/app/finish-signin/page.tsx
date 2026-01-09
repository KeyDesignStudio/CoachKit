'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';

export default function FinishSignIn() {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);
  const MAX_ATTEMPTS = 10; // 10 attempts = ~5 seconds

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    async function checkUserStatus() {
      try {
        const response = await fetch('/api/me');
        
        if (response.ok) {
          // User found in database
          const data = await response.json();
          if (data.success && data.data.user) {
            const user = data.data.user;
            if (user.role === 'COACH') {
              router.replace('/coach/dashboard' as any);
            } else if (user.role === 'ATHLETE') {
              router.replace('/athlete/calendar' as any);
            } else {
              // Unknown role, go to access denied
              router.replace('/access-denied' as any);
            }
            return;
          }
        } else if (response.status === 401) {
          // Not authenticated, go to sign-in
          router.replace('/sign-in' as any);
          return;
        } else if (response.status === 403) {
          // User not invited
          router.replace('/access-denied' as any);
          return;
        }

        // User not found yet in DB, retry
        if (attempts < MAX_ATTEMPTS) {
          setAttempts(a => a + 1);
          timeoutId = setTimeout(checkUserStatus, 500);
        } else {
          // Max attempts reached, assume not invited
          router.replace('/access-denied' as any);
        }
      } catch (error) {
        // Network error, retry
        if (attempts < MAX_ATTEMPTS) {
          setAttempts(a => a + 1);
          timeoutId = setTimeout(checkUserStatus, 500);
        } else {
          router.replace('/access-denied' as any);
        }
      }
    }

    checkUserStatus();

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [attempts, router]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="max-w-md rounded-3xl p-8 text-center">
        <div className="mb-4 flex justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--muted)] border-t-[var(--primary)]" />
        </div>
        <h1 className="mb-4 text-2xl font-semibold">Finishing sign-in…</h1>
        <p className="text-[var(--muted)]">
          Setting up your account...
        </p>
      </Card>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';

export default function FinishSignIn() {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);
  const MAX_ATTEMPTS = 20; // 20 attempts = ~10 seconds
  const INITIAL_DELAY = 300; // Wait 300ms before first attempt

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    async function checkUserStatus() {
      try {
        const response = await fetch('/api/me');
        
        if (response.ok) {
          // User found in database - redirect immediately
          const data = await response.json();
          if (data.data && data.data.user) {
            const user = data.data.user;
            if (user.role === 'ADMIN') {
              router.replace('/' as any);
            } else if (user.role === 'COACH') {
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
          // 403: Could be timing issue OR truly not invited
          // Only redirect to access-denied on FINAL attempt
          if (attempts >= MAX_ATTEMPTS - 1) {
            // Final attempt and still 403 - truly not invited
            router.replace('/access-denied' as any);
            return;
          }
          // Not final attempt - treat as "not ready yet", keep polling
        }

        // User not found yet in DB, retry
        if (attempts < MAX_ATTEMPTS) {
          setAttempts(a => a + 1);
          timeoutId = setTimeout(checkUserStatus, 500);
        } else {
          // Max attempts reached, go to access denied
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

    // Initial delay before first poll to allow DB sync
    timeoutId = setTimeout(checkUserStatus, attempts === 0 ? INITIAL_DELAY : 0);

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

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export default function AccessDenied() {
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);
  const [showDenied, setShowDenied] = useState(false);

  useEffect(() => {
    // Check if user is authenticated and determine their role home
    async function checkAuth() {
      try {
        const response = await fetch('/api/me');
        
        if (response.ok) {
          // User is authenticated and has a role - redirect them immediately
          const data = await response.json();
          if (data.data && data.data.user) {
            const user = data.data.user;
            if (user.role === 'COACH') {
              router.replace('/coach/dashboard' as any);
            } else if (user.role === 'ATHLETE') {
              router.replace('/athlete/calendar' as any);
            } else {
              // Unknown role, show denied
              setIsChecking(false);
              setShowDenied(true);
            }
            return;
          }
        } else if (response.status === 401) {
          // Not authenticated, go to sign-in
          router.replace('/sign-in' as any);
          return;
        } else if (response.status === 403) {
          // Truly not invited - show denied UI
          setIsChecking(false);
          setShowDenied(true);
          return;
        }
        
        // Other errors - show denied UI
        setIsChecking(false);
        setShowDenied(true);
      } catch (error) {
        // Network error - show denied UI
        setIsChecking(false);
        setShowDenied(true);
      }
    }

    checkAuth();
  }, [router]);

  const handleReturnHome = () => {
    router.push('/sign-in' as any);
  };

  // Show checking state (no denied card)
  if (isChecking) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="max-w-md rounded-3xl p-8 text-center">
          <div className="mb-4 flex justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--muted)] border-t-[var(--primary)]" />
          </div>
          <p className="text-[var(--muted)]">Checking access...</p>
        </Card>
      </div>
    );
  }

  // Only show denied card if truly denied
  if (!showDenied) {
    return null;
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="max-w-md rounded-3xl p-8 text-center">
        <h1 className="mb-4 text-2xl font-semibold">Access Not Granted</h1>
        <p className="mb-6 text-[var(--muted)]">
          Your account is not authorized to access CoachKit. This is an invite-only platform.
        </p>
        <p className="mb-6 text-sm text-[var(--muted)]">
          If you believe you should have access, please contact your coach or administrator.
        </p>
        <div className="flex flex-col gap-3">
          <Button onClick={handleReturnHome} className="w-full">
            Return to Sign In
          </Button>
          <a href="/sign-out" className="text-sm text-[var(--muted)] hover:underline">
            Sign Out
          </a>
        </div>
      </Card>
    </div>
  );
}

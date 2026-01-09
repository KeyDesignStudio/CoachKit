'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export default function AccessDenied() {
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if user is authenticated and determine their role home
    async function checkAuth() {
      try {
        const response = await fetch('/api/me');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data.user) {
            const user = data.data.user;
            // User is authenticated and has a role - redirect them
            if (user.role === 'COACH') {
              setRedirectUrl('/coach/dashboard');
            } else if (user.role === 'ATHLETE') {
              setRedirectUrl('/athlete/calendar');
            } else {
              // Unknown role, stay on access denied
              setRedirectUrl(null);
            }
          } else {
            // Not authenticated, go to sign-in
            setRedirectUrl('/sign-in');
          }
        } else {
          // API error, go to sign-in
          setRedirectUrl('/sign-in');
        }
      } catch (error) {
        // Network error, go to sign-in
        setRedirectUrl('/sign-in');
      } finally {
        setIsLoading(false);
      }
    }

    checkAuth();
  }, []);

  const handleReturnHome = () => {
    if (redirectUrl) {
      window.location.href = redirectUrl;
    }
  };

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
          {isLoading ? (
            <Button disabled className="w-full">
              Loading...
            </Button>
          ) : (
            <Button onClick={handleReturnHome} className="w-full">
              Return Home
            </Button>
          )}
          <a href="/sign-out" className="text-sm text-[var(--muted)] hover:underline">
            Sign Out
          </a>
        </div>
      </Card>
    </div>
  );
}

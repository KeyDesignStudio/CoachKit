import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { requireAuth } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { RoleForbiddenCard } from '@/components/RoleForbiddenCard';

/**
 * Coach Layout - Role-Based Access Control
 * 
 * Security:
 * - Server component that runs before any coach page
 * - Validates user has COACH role in database
 * - Redirects unauthorized users
 */
export default async function CoachLayout({ children }: { children: ReactNode }) {
  try {
    const { user } = await requireAuth();

    if (user.role !== 'COACH' && user.role !== 'ADMIN') {
      console.warn('[Authz] Forbidden: coach segment access denied', {
        userId: user.id,
        authProviderId: user.authProviderId,
        role: user.role,
      });

      return (
        <RoleForbiddenCard
          title="403 — Coach access required"
          message="You are signed in, but your account does not have coach access."
          details="If you believe this is a mistake, ask your administrator to confirm your role and athlete linkage."
          primaryHref="/"
          primaryLabel="Go Home"
        />
      );
    }

    return <>{children}</>;
  } catch (error) {
    if (error instanceof ApiError) {
      // Middleware usually handles this, but keep a server-side fallback.
      if (error.status === 401) {
        console.info('[Authz] Redirecting to sign-in (coach segment)', { code: error.code });
        redirect('/sign-in');
      }

      // Authenticated but not invited (or other forbidden) should land on the existing access denied surface.
      if (error.status === 403) {
        console.warn('[Authz] Redirecting to access-denied (coach segment)', { code: error.code });
        redirect('/access-denied');
      }
    }

    throw error;
  }
}

import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { requireAuth } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { RoleForbiddenCard } from '@/components/RoleForbiddenCard';
import { AskFloatingPopup } from '@/components/knowledge/AskFloatingPopup';

/**
 * Athlete Layout - Role-Based Access Control
 * 
 * Security:
 * - Server component that runs before any athlete page
 * - Validates user has ATHLETE role in database
 * - Redirects unauthorized users
 */
export default async function AthleteLayout({ children }: { children: ReactNode }) {
  try {
    const { user } = await requireAuth();

    if (user.role !== 'ATHLETE') {
      console.warn('[Authz] Forbidden: athlete segment access denied', {
        userId: user.id,
        authProviderId: user.authProviderId,
        role: user.role,
      });

      return (
        <RoleForbiddenCard
          title="403 — Athlete access required"
          message="You are signed in, but your account does not have athlete access."
          primaryHref="/"
          primaryLabel="Go Home"
        />
      );
    }

    return (
      <>
        {children}
        <AskFloatingPopup />
      </>
    );
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        console.info('[Authz] Redirecting to sign-in (athlete segment)', { code: error.code });
        redirect('/sign-in');
      }

      if (error.status === 403) {
        console.warn('[Authz] Redirecting to access-denied (athlete segment)', { code: error.code });
        redirect('/access-denied');
      }
    }

    throw error;
  }
}

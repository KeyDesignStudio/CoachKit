import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import type { ReactNode } from 'react';

import { requireAuth } from '@/lib/auth';

/**
 * Athlete Layout - Role-Based Access Control
 * 
 * Security:
 * - Server component that runs before any athlete page
 * - Validates user has ATHLETE role in database
 * - Redirects unauthorized users
 */
export default async function AthleteLayout({ children }: { children: ReactNode }) {
  const disableAuth =
    process.env.NODE_ENV === 'development' &&
    (process.env.DISABLE_AUTH === 'true' || process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true');

  if (disableAuth) {
    const { user } = await requireAuth();

    if (user.role !== 'ATHLETE') {
      redirect(user.role === 'ADMIN' ? '/admin/workout-library' : '/coach/dashboard');
    }

    return <>{children}</>;
  }

  const { userId } = await auth();

  // Must be authenticated (middleware handles this, but double-check)
  if (!userId) {
    redirect('/sign-in');
  }

  // Look up user in database
  const user = await prisma.user.findUnique({
    where: { authProviderId: userId },
    select: { role: true },
  });

  // Not in database = not invited
  if (!user) {
    redirect('/access-denied');
  }

  if (user.role !== 'ATHLETE') {
    redirect(user.role === 'ADMIN' ? '/admin/workout-library' : '/coach/dashboard');
  }

  // Authorized - render athlete pages
  return <>{children}</>;
}

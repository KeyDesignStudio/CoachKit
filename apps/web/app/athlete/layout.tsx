import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import type { ReactNode } from 'react';

/**
 * Athlete Layout - Role-Based Access Control
 * 
 * Security:
 * - Server component that runs before any athlete page
 * - Validates user has ATHLETE role in database
 * - Redirects unauthorized users
 */
export default async function AthleteLayout({ children }: { children: ReactNode }) {
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

  // Must have ATHLETE role
  if (user.role !== 'ATHLETE') {
    console.log(`[Athlete Layout] User with role ${user.role} blocked from athlete routes`);
    redirect('/coach/dashboard');
  }

  // Authorized - render athlete pages
  return <>{children}</>;
}

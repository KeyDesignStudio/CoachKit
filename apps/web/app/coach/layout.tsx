import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import type { ReactNode } from 'react';

/**
 * Coach Layout - Role-Based Access Control
 * 
 * Security:
 * - Server component that runs before any coach page
 * - Validates user has COACH role in database
 * - Redirects unauthorized users
 */
export default async function CoachLayout({ children }: { children: ReactNode }) {
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

  // Must have COACH role
  if (user.role !== 'COACH') {
    console.log(`[Coach Layout] User with role ${user.role} blocked from coach routes`);
    redirect('/athlete/calendar');
  }

  // Authorized - render coach pages
  return <>{children}</>;
}

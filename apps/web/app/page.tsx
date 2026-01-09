import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

export default async function HomePage() {
  const { userId } = await auth();

  // Not authenticated - redirect to sign-in
  if (!userId) {
    redirect('/sign-in');
  }

  try {
    // Look up user in database
    const user = await prisma.user.findUnique({
      where: { authProviderId: userId },
      select: { role: true },
    });

    // Authenticated but not in DB - not invited
    if (!user) {
      redirect('/access-denied');
    }

    // Redirect based on role
    if (user.role === 'COACH') {
      redirect('/coach/dashboard');
    } else {
      redirect('/athlete/calendar');
    }
  } catch (error) {
    console.error('[Root] Error checking user:', error);
    redirect('/access-denied');
  }
}

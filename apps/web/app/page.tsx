import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

// Auth-dependent; must be dynamic to avoid static caching of redirects.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HomePage() {
  // Dev-only escape hatch used by screenshot automation (no Clerk keys in CI).
  // Do not enable this in production.
  if (
    process.env.NODE_ENV === 'development' &&
    (process.env.DISABLE_AUTH === 'true' || process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true')
  ) {
    redirect('/dev/calendar-geometry-compare');
  }

  const { userId } = await auth();

  // Not authenticated - redirect to sign-in
  if (!userId) {
    redirect('/sign-in');
  }

  // Look up user in database
  const user = await prisma.user.findUnique({
    where: { authProviderId: userId },
    select: { role: true },
  });

  // Authenticated but not in DB yet - might be race condition after first sign-up
  // Redirect to finish-signin page which will poll until user appears in DB
  if (!user) {
    redirect('/finish-signin');
  }

  // Redirect based on role
  if (user.role === 'ADMIN') {
    console.info('[Authz] Root redirect', { role: user.role, userId, target: '/admin/ai-usage' });
    redirect('/admin/ai-usage');
  }

  if (user.role === 'COACH') {
    console.info('[Authz] Root redirect', { role: user.role, userId, target: '/coach/dashboard' });
    redirect('/coach/dashboard');
  }

  if (user.role === 'ATHLETE') {
    console.info('[Authz] Root redirect', { role: user.role, userId, target: '/athlete/calendar' });
    redirect('/athlete/calendar');
  }

  // Unknown role should be treated as not invited.
  redirect('/access-denied');
}

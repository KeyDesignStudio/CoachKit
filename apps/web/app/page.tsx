import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

// Auth-dependent; must be dynamic to avoid static caching of redirects.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HomePage() {
  const isAuthDisabled =
    process.env.NODE_ENV === 'development' &&
    (process.env.DISABLE_AUTH === 'true' || process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true');
  const isRoleRedirectAllowed = (path: string, roleName: string) => {
    if (!path || !path.startsWith('/') || path.startsWith('//')) return false;
    if (roleName === 'ATHLETE') return path.startsWith('/athlete');
    if (roleName === 'COACH') return path.startsWith('/coach');
    if (roleName === 'ADMIN') return path.startsWith('/admin');
    return false;
  };

  // Dev-only escape hatch used by screenshot automation (no Clerk keys in CI).
  // Do not enable this in production.
  if (isAuthDisabled) {
    const roleCookie = cookies().get('coachkit-role')?.value ?? '';
    const role = roleCookie === 'ATHLETE' || roleCookie === 'COACH' || roleCookie === 'ADMIN' ? roleCookie : null;
    if (!role) {
      redirect('/dev/calendar-geometry-compare');
    }

    const redirectCookie = cookies().get('coachkit-redirect')?.value ?? '';
    const roleRedirect = isRoleRedirectAllowed(redirectCookie, role) ? redirectCookie : null;

    if (role === 'ADMIN') {
      redirect('/admin/ai-usage');
    }
    if (role === 'COACH') {
      redirect(roleRedirect || '/coach/dashboard');
    }
    if (role === 'ATHLETE') {
      redirect(roleRedirect || '/athlete/dashboard');
    }

    redirect('/access-denied');
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

  const redirectCookie = cookies().get('coachkit-redirect')?.value ?? '';
  const role = user.role;
  const roleRedirect = isRoleRedirectAllowed(redirectCookie, role) ? redirectCookie : null;

  // Redirect based on role
  if (user.role === 'ADMIN') {
    console.info('[Authz] Root redirect', { role: user.role, userId, target: '/admin/ai-usage' });
    redirect('/admin/ai-usage');
  }

  if (user.role === 'COACH') {
    const target = roleRedirect || '/coach/dashboard';
    console.info('[Authz] Root redirect', { role: user.role, userId, target });
    redirect(target);
  }

  if (user.role === 'ATHLETE') {
    const target = roleRedirect || '/athlete/dashboard';
    console.info('[Authz] Root redirect', { role: user.role, userId, target });
    redirect(target);
  }

  // Unknown role should be treated as not invited.
  redirect('/access-denied');
}

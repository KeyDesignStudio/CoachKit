import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';

// Define protected routes that require authentication
const isProtectedRoute = createRouteMatcher([
  '/coach(.*)',
  '/athlete(.*)',
]);

/**
 * Clerk Middleware with Role-Based Route Protection
 * 
 * Security Model:
 * 1. All /coach/* and /athlete/* routes require Clerk authentication
 * 2. After auth, checks DB User.role to enforce access:
 *    - /coach/* requires role=COACH
 *    - /athlete/* requires role=ATHLETE
 * 3. Redirects unauthorized users to home page
 * 
 * Invite-Only:
 * - Only users with a matching User record (by authProviderId or email) can access
 * - Users without DB records see "Access not granted" page
 */
export default clerkMiddleware(async (auth, request) => {
  const { userId } = await auth();
  const { pathname } = request.nextUrl;

  // Protect all coach and athlete routes
  if (isProtectedRoute(request)) {
    // Require authentication
    if (!userId) {
      const signInUrl = new URL('/sign-in', request.url);
      signInUrl.searchParams.set('redirect_url', pathname);
      return NextResponse.redirect(signInUrl);
    }

    try {
      // Look up user in database by Clerk ID
      const user = await prisma.user.findUnique({
        where: { authProviderId: userId },
        select: { id: true, role: true, email: true, authProviderId: true },
      });

      if (!user) {
        // User authenticated with Clerk but no DB record = not invited
        return NextResponse.redirect(new URL('/access-denied', request.url));
      }

      // Enforce role-based route access
      const isCoachRoute = pathname.startsWith('/coach');
      const isAthleteRoute = pathname.startsWith('/athlete');

      if (isCoachRoute && user.role !== 'COACH') {
        console.log(`[Middleware] User ${user.email} (${user.role}) blocked from ${pathname}`);
        return NextResponse.redirect(new URL('/athlete/calendar', request.url));
      }

      if (isAthleteRoute && user.role !== 'ATHLETE') {
        console.log(`[Middleware] User ${user.email} (${user.role}) blocked from ${pathname}`);
        return NextResponse.redirect(new URL('/coach/dashboard', request.url));
      }

      // Authorized - allow access
      return NextResponse.next();
    } catch (error) {
      console.error('[Middleware] Error checking user access:', error);
      return NextResponse.redirect(new URL('/error', request.url));
    }
  }

  // Public routes - allow access
  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};

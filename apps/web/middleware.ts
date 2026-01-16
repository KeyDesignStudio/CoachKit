import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const DISABLE_AUTH =
  process.env.NODE_ENV === 'development' &&
  (process.env.DISABLE_AUTH === 'true' || process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true');

// Define protected routes that require authentication
const isProtectedRoute = createRouteMatcher([
  '/coach(.*)',
  '/athlete(.*)',
]);

/**
 * Clerk Middleware - Authentication Only
 * 
 * Security Model:
 * 1. All /coach/* and /athlete/* routes require Clerk authentication
 * 2. Role and invitation checks are handled in server components (layouts)
 * 3. Unauthenticated users are redirected to sign-in
 * 
 * Note: No database queries in middleware (Edge runtime limitation)
 */
const middleware = DISABLE_AUTH
  ? (request: Request) => {
      // Guardrail: dev pages never exist in production.
      if (process.env.NODE_ENV === 'production' && new URL(request.url).pathname.startsWith('/dev')) {
        return new NextResponse('Not Found', { status: 404 });
      }

      return NextResponse.next();
    }
  : clerkMiddleware(async (auth, request) => {
      // Guardrail: dev pages never exist in production.
      if (process.env.NODE_ENV === 'production' && request.nextUrl.pathname.startsWith('/dev')) {
        return new NextResponse('Not Found', { status: 404 });
      }

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
      }

      // Allow all authenticated/public routes to proceed
      // Role enforcement happens in layout.tsx files
      return NextResponse.next();
    });

export default middleware;

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};

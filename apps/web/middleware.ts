import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const DISABLE_AUTH =
  process.env.NODE_ENV === 'development' &&
  (process.env.DISABLE_AUTH === 'true' || process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true');

const AI_PLAN_BUILDER_V1 =
  process.env.AI_PLAN_BUILDER_V1 === '1' ||
  process.env.AI_PLAN_BUILDER_V1 === 'true' ||
  process.env.NEXT_PUBLIC_AI_PLAN_BUILDER_V1 === '1' ||
  process.env.NEXT_PUBLIC_AI_PLAN_BUILDER_V1 === 'true';

function isAiPlanBuilderPathSegment(pathname: string) {
  // Ensure we only match the real segment name, not a substring.
  // Examples matched: /.../ai-plan-builder, /.../ai-plan-builder/...
  // Examples NOT matched: /.../ai-plan-builderish
  return /(^|\/)(ai-plan-builder)(\/|$)/.test(pathname);
}

function shouldBlockAiPlanBuilderRoute(pathname: string) {
  if (AI_PLAN_BUILDER_V1) return false;

  // Only block AI Plan Builder module routes (pages + API). Never block anything else.
  if (pathname.startsWith('/coach/athletes/') && isAiPlanBuilderPathSegment(pathname)) return true;
  if (pathname.startsWith('/api/coach/athletes/') && isAiPlanBuilderPathSegment(pathname)) return true;

  return false;
}

// Define protected routes that require authentication
const isProtectedRoute = createRouteMatcher([
  '/coach(.*)',
  '/athlete(.*)',
  '/challenges(.*)',
]);

const CLERK_BYPASS_PATHS = new Set([
  // Cron endpoints authenticate via CRON_SECRET header and must not be blocked by Clerk.
  '/api/integrations/strava/cron',
  '/api/admin/integrations/strava/debug-links',
]);

function getPathname(request: any) {
  // NextRequest has nextUrl; Request does not.
  return request?.nextUrl?.pathname ?? new URL(request.url).pathname;
}

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
const authMiddleware = DISABLE_AUTH
  ? (request: Request) => {
      // Guardrail: dev pages never exist in production.
      if (process.env.NODE_ENV === 'production' && new URL(request.url).pathname.startsWith('/dev')) {
        return new NextResponse('Not Found', { status: 404 });
      }

      // Feature-flagged module routes must not be reachable when disabled.
      const pathname = new URL(request.url).pathname;
      if (shouldBlockAiPlanBuilderRoute(pathname)) return new NextResponse('Not Found', { status: 404 });

      return NextResponse.next();
    }
  : clerkMiddleware(async (auth, request) => {
      // Guardrail: dev pages never exist in production.
      if (process.env.NODE_ENV === 'production' && request.nextUrl.pathname.startsWith('/dev')) {
        return new NextResponse('Not Found', { status: 404 });
      }

      // Feature-flagged module routes must not be reachable when disabled.
      if (shouldBlockAiPlanBuilderRoute(request.nextUrl.pathname)) return new NextResponse('Not Found', { status: 404 });

      const { userId } = await auth();
      const { pathname } = request.nextUrl;

      // Protect all coach and athlete routes
      if (isProtectedRoute(request)) {
        // Require authentication
        if (!userId) {
          const signInUrl = new URL('/sign-in', request.url);
          signInUrl.searchParams.set('redirect_url', pathname);
          const response = NextResponse.redirect(signInUrl);
          response.cookies.set('coachkit-redirect', pathname, {
            path: '/',
            sameSite: 'lax',
            maxAge: 300,
          });
          return response;
        }
      }

      // Allow all authenticated/public routes to proceed
      // Role enforcement happens in layout.tsx files
      return NextResponse.next();
    });

export default function middleware(request: any, event: any) {
  const pathname = getPathname(request);

  // Bypass Clerk entirely for explicitly allowed paths.
  if (CLERK_BYPASS_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  return (authMiddleware as any)(request, event);
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};

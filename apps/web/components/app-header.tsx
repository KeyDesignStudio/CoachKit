import Link from 'next/link';
import type { Route } from 'next';
import { auth, currentUser } from '@clerk/nextjs/server';
import { UserButton } from '@clerk/nextjs';

import { prisma } from '@/lib/prisma';
import { Card } from '@/components/ui/Card';
import { DEFAULT_BRAND_NAME, getHeaderClubBranding } from '@/lib/branding';

type NavLink = { href: Route; label: string; roles: ('COACH' | 'ATHLETE')[] };

const allNavLinks: NavLink[] = [
  { href: '/coach/dashboard', label: 'Dashboard', roles: ['COACH'] },
  { href: '/coach/athletes', label: 'Manage Athletes', roles: ['COACH'] },
  { href: '/coach/calendar', label: 'Workout Scheduling', roles: ['COACH'] },
  { href: '/coach/group-sessions', label: 'Sessions', roles: ['COACH'] },
  { href: '/coach/settings', label: 'Settings', roles: ['COACH'] },
  { href: '/athlete/calendar', label: 'Workout Schedule', roles: ['ATHLETE'] },
  { href: '/athlete/settings', label: 'Settings', roles: ['ATHLETE'] },
];

/**
 * AppHeader - Server Component with Clerk Authentication
 * 
 * Security:
 * - Fetches user role from database using Clerk userId
 * - Falls back to email lookup for first-time login (same logic as requireAuth)
 * - Filters navigation based on actual DB role (not client state)
 * - Shows UserButton for authenticated users
 */
export async function AppHeader() {
  const { userId } = await auth();

  // Get user from database if authenticated
  let userRole: 'COACH' | 'ATHLETE' | null = null;
  let clubBranding = { displayName: DEFAULT_BRAND_NAME, logoUrl: null as string | null };
  let brandingCoachId: string | null = null;

  if (userId) {
    // Try to find user by authProviderId first
    let user = await prisma.user.findUnique({
      where: { authProviderId: userId },
      select: { role: true, branding: true, email: true, id: true, authProviderId: true },
    });

    // If not found by authProviderId, try email lookup (first-time login)
    if (!user) {
      const clerkUser = await currentUser();
      if (clerkUser?.emailAddresses?.[0]?.emailAddress) {
        const email = clerkUser.emailAddresses[0].emailAddress;
        
        const existingUser = await prisma.user.findUnique({
          where: { email },
          select: { role: true, branding: true, email: true, id: true, authProviderId: true },
        });

        if (existingUser && !existingUser.authProviderId) {
          // Link the Clerk user to our DB user
          user = await prisma.user.update({
            where: { id: existingUser.id },
            data: { authProviderId: userId },
            select: { role: true, branding: true, email: true, id: true, authProviderId: true },
          });
          
          console.log(`[AppHeader] Linked Clerk user ${userId} to DB user ${user.email}`);
        } else if (existingUser) {
          user = existingUser;
        }
      }
    }

    if (user) {
      userRole = user.role;

      // Resolve the coachId we should use for club branding
      if (user.role === 'COACH') {
        brandingCoachId = user.id;
      } else {
        const athleteProfile = await prisma.athleteProfile.findUnique({
          where: { userId: user.id },
          select: { coachId: true },
        });
        brandingCoachId = athleteProfile?.coachId ?? null;
      }

      // Always read club branding directly from CoachBranding to avoid any ambiguity.
      if (brandingCoachId) {
        const coachBranding = await prisma.coachBranding.findUnique({
          where: { coachId: brandingCoachId },
          select: { displayName: true, logoUrl: true },
        });

        if (coachBranding) {
          clubBranding = {
            displayName: coachBranding.displayName || DEFAULT_BRAND_NAME,
            logoUrl: coachBranding.logoUrl,
          };
        }
      }
    }
  }

  // Filter navigation by authenticated role
  const navLinks = userRole
    ? allNavLinks.filter((link) => link.roles.includes(userRole))
    : [];

  const headerClubBranding = getHeaderClubBranding(clubBranding);

  return (
    <header className="px-4 pt-4 md:px-6 md:pt-6">
      {/* NOTE (dev-only): Keep shared wrapper surfaces token-only; avoid translucent white overlays, gradients, and backdrop blur (they cause coach/athlete surface drift). */}
      <Card className="relative flex flex-col gap-4 rounded-3xl bg-[var(--bg-surface)] p-5 md:flex-row md:items-center md:justify-between">
        {/* Center block: true-centered CoachKit branding (independent of nav width) */}
        <div className="pointer-events-none absolute left-1/2 top-5 z-10 flex h-[55px] -translate-x-1/2 items-center">
          <Link
            href="/" 
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full px-2 py-1 font-display font-semibold tracking-tight text-[var(--text)]"
          >
            <span className="hidden text-base sm:inline">CoachKit</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/coachkit-logo.png"
              alt="CoachKit"
              className="h-9 w-9 object-contain"
            />
          </Link>
        </div>

        {/* Left block: Club branding (logo-only else text fallback) */}
        <div className="flex min-w-0 items-center">
          {headerClubBranding.type === 'logo' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={headerClubBranding.logoUrl}
              alt={`${headerClubBranding.name} logo`}
              className="h-12 w-auto object-contain sm:h-14"
            />
          ) : (
            <span
              className="max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-[var(--text)] sm:max-w-[320px]"
            >
              {headerClubBranding.name}
            </span>
          )}
        </div>

        {/* Right block: Nav + user (unchanged) */}
        <div className="flex items-center gap-3 md:gap-4">
          {navLinks.length > 0 ? (
            <>
              {/* Mobile: collapsible menu (no hover reliance) */}
              <details className="relative md:hidden">
                <summary className="list-none cursor-pointer select-none rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 min-h-[44px] inline-flex items-center text-sm font-medium text-[var(--text)]">
                  Menu
                </summary>
                <nav className="absolute right-0 mt-2 w-[min(320px,calc(100vw-2rem))] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-sm p-2">
                  {navLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="flex items-center rounded-xl px-3 min-h-[44px] text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-structure)]"
                    >
                      {link.label}
                    </Link>
                  ))}
                </nav>
              </details>

              {/* Desktop */}
              <nav className="hidden md:flex flex-wrap gap-2 text-sm font-medium">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded-full px-3 py-2 min-h-[44px] inline-flex items-center text-[var(--muted)] hover:bg-[var(--bg-structure)]"
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </>
          ) : null}

          {userId && <UserButton afterSignOutUrl="/" />}
        </div>
      </Card>
    </header>
  );
}

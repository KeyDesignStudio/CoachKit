import Link from 'next/link';
import type { Route } from 'next';
import { auth, currentUser } from '@clerk/nextjs/server';
import { UserButton } from '@clerk/nextjs';

import { prisma } from '@/lib/prisma';
import { Card } from '@/components/ui/Card';
import { DEFAULT_BRAND_NAME, resolveLogoUrl } from '@/lib/branding';
import { BrandingDebug } from '@/components/dev/branding-debug';

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

  const clubName = (() => {
    const raw = (clubBranding.displayName || '').trim();
    if (!raw || raw === DEFAULT_BRAND_NAME) return 'Your Club';
    return raw;
  })();

  return (
    <header className="px-6 pt-6">
      {/* NOTE (dev-only): Keep shared wrapper surfaces token-only; avoid translucent white overlays, gradients, and backdrop blur (they cause coach/athlete surface drift). */}
      <Card className="relative flex flex-col gap-4 rounded-3xl bg-[var(--bg-surface)] p-5 md:flex-row md:items-center md:justify-between">
        {process.env.NODE_ENV !== 'production' ? (
          <BrandingDebug coachId={brandingCoachId} rawLogoUrl={clubBranding.logoUrl} resolvedLogoUrl={resolveLogoUrl(clubBranding.logoUrl)} />
        ) : null}

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

        {/* Left block: Club branding (name then logo) */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <p className="m-0 max-w-[10rem] truncate font-display text-base font-semibold tracking-tight text-[var(--text)] sm:max-w-[14rem] md:max-w-[18rem]">
              {clubName}
            </p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={resolveLogoUrl(clubBranding.logoUrl)}
            alt={`${clubName} logo`}
            className="h-[55px] w-[55px] object-contain"
          />
        </div>

        {/* Right block: Nav + user (unchanged) */}
        <div className="flex items-center gap-4">
          {navLinks.length > 0 && (
            <nav className="flex flex-wrap gap-2 text-sm font-medium">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-full px-3 py-1 text-[var(--muted)] hover:bg-[var(--bg-structure)]"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          )}

          {userId && <UserButton afterSignOutUrl="/" />}
        </div>
      </Card>
    </header>
  );
}

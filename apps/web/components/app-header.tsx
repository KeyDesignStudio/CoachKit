import Link from 'next/link';
import type { Route } from 'next';
import { auth, currentUser } from '@clerk/nextjs/server';

import { prisma } from '@/lib/prisma';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { DEFAULT_BRAND_NAME, getHeaderClubBranding } from '@/lib/branding';
import { MobileNavDrawer } from '@/components/MobileNavDrawer';
import { MobileHeaderTitle } from '@/components/MobileHeaderTitle';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { UserHeaderControl } from '@/components/UserHeaderControl';

type NavLink = { href: Route; label: string; roles: ('COACH' | 'ATHLETE' | 'ADMIN')[] };

const DESKTOP_NAV_LINK_CLASS =
  'rounded-full px-3 py-2 min-h-[44px] inline-flex items-center text-[var(--muted)] hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]';

const allNavLinks: NavLink[] = [
  { href: '/coach/dashboard', label: 'Dashboard', roles: ['COACH'] },
  { href: '/coach/athletes', label: 'Manage Athletes', roles: ['COACH'] },
  { href: '/coach/calendar', label: 'Workout Scheduling', roles: ['COACH'] },
  { href: '/coach/group-sessions', label: 'SESSION BUILDER', roles: ['COACH'] },
  { href: '/coach/settings', label: 'Settings', roles: ['COACH'] },
  { href: '/admin/workout-library', label: 'Admin', roles: ['ADMIN'] },
  { href: '/athlete/dashboard', label: 'Dashboard', roles: ['ATHLETE'] },
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
  let userRole: 'COACH' | 'ATHLETE' | 'ADMIN' | null = null;
  let clubBranding = {
    displayName: DEFAULT_BRAND_NAME,
    logoUrl: null as string | null,
    darkLogoUrl: null as string | null,
  };
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
      if (user.role === 'COACH' || user.role === 'ADMIN') {
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
          select: { displayName: true, logoUrl: true, darkLogoUrl: true },
        });

        if (coachBranding) {
          clubBranding = {
            displayName: coachBranding.displayName || DEFAULT_BRAND_NAME,
            logoUrl: coachBranding.logoUrl,
            darkLogoUrl: coachBranding.darkLogoUrl ?? null,
          };
        }
      }
    }
  }

  // Filter navigation by authenticated role
  const navLinks = userRole
    ? allNavLinks.filter((link) => link.roles.includes(userRole))
    : [];

  // ADMIN is a separate mode: never mount coach/athlete navigation for admins.
  if (userRole === 'ADMIN') {
    return <AdminHeader />;
  }

  const headerRoleLabel = userRole === 'COACH' || userRole === 'ATHLETE' ? userRole : undefined;

  const headerClubBranding = getHeaderClubBranding(clubBranding);

  const mobileLinks = navLinks.map((link) => ({ href: link.href as string, label: link.label }));

  return (
    <>
      {/* Mobile-only top branding: scrolls away; sticky header remains */}
      <div data-mobile-top-branding="v1" className="md:hidden px-4 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {headerClubBranding.type === 'logo' ? (
              <picture>
                {headerClubBranding.darkLogoUrl ? (
                  <source srcSet={headerClubBranding.darkLogoUrl} media="(prefers-color-scheme: dark)" />
                ) : null}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={headerClubBranding.logoUrl}
                  alt={`${headerClubBranding.name} logo`}
                  className="h-8 w-auto object-contain"
                />
              </picture>
            ) : (
              <span className="block max-w-[55vw] truncate text-xs font-medium text-[var(--muted)]">
                {headerClubBranding.name}
              </span>
            )}
          </div>

          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full px-2 py-1 font-display font-semibold tracking-tight text-[var(--text)]"
            aria-label="CoachKit"
          >
            <span className="text-sm">CoachKit</span>
            <picture>
              <source srcSet="/brand/CoachKit_Dark.png" media="(prefers-color-scheme: dark)" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/coachkit-logo.png"
                alt="CoachKit"
                className="h-[26.4px] w-[26.4px] object-contain"
              />
            </picture>
          </Link>
        </div>
      </div>

      <header className="sticky top-0 z-50 bg-[var(--bg-page)] px-4 pt-2 md:px-6 md:pt-6">
        {/* NOTE (dev-only): Keep shared wrapper surfaces token-only; avoid translucent white overlays, gradients, and backdrop blur (they cause coach/athlete surface drift). */}
        <Card className="rounded-3xl bg-[var(--bg-surface)] p-0">
          {/* Mobile (iOS-first): single row header */}
          <div data-mobile-header="v1" className="md:hidden flex h-14 items-center gap-2 px-3">
            {navLinks.length > 0 ? <MobileNavDrawer links={mobileLinks} /> : <div className="h-11 w-11" />}
            <MobileHeaderTitle />
            <div className="flex min-w-0 max-w-[40vw] justify-end">
              {userId && <UserHeaderControl roleLabel={headerRoleLabel} />}
            </div>
          </div>

        {/* Desktop: keep existing multi-brand header */}
        <div className="relative hidden md:flex md:flex-row md:items-center md:justify-between md:gap-4 md:p-5">
            {/* CoachKit branding: centered within the left half to avoid nav overlap */}
            <div className="pointer-events-none absolute left-1/4 min-[2000px]:left-1/2 top-5 z-10 flex h-[55px] -translate-x-1/2 items-center">
            <Link
              href="/" 
              className="pointer-events-auto inline-flex items-center gap-2 rounded-full px-2 py-1 font-display font-semibold tracking-tight text-[var(--text)]"
            >
              <span className="hidden text-base sm:inline">CoachKit</span>
              <picture>
                <source srcSet="/brand/CoachKit_Dark.png" media="(prefers-color-scheme: dark)" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/brand/coachkit-logo.png"
                  alt="CoachKit"
                  className="h-[39.6px] w-[39.6px] object-contain"
                />
              </picture>
            </Link>
          </div>

          {/* Left block: Club branding (logo-only else text fallback) */}
          <div className="flex min-w-0 items-center">
            {headerClubBranding.type === 'logo' ? (
              <picture>
                {headerClubBranding.darkLogoUrl ? (
                  <source srcSet={headerClubBranding.darkLogoUrl} media="(prefers-color-scheme: dark)" />
                ) : null}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={headerClubBranding.logoUrl}
                  alt={`${headerClubBranding.name} logo`}
                  className="h-12 w-auto object-contain sm:h-14"
                />
              </picture>
            ) : (
              <span
                className="max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-[var(--text)] sm:max-w-[320px]"
              >
                {headerClubBranding.name}
              </span>
            )}
          </div>

          {/* Right block: Nav + user (desktop) */}
          <div className="flex items-center gap-3 md:gap-4">
            {navLinks.length > 0 ? (
              <nav className="hidden md:flex flex-wrap gap-2 text-sm font-medium uppercase">
                {navLinks.map((link) =>
                  link.href.endsWith('/settings') ? (
                    <Link
                      key={link.href}
                      href={link.href}
                      aria-label="Settings"
                      className={`${DESKTOP_NAV_LINK_CLASS} justify-center`}
                    >
                      <Icon name="settings" size="md" className="text-[var(--muted)]" />
                      <span className="sr-only">Settings</span>
                    </Link>
                  ) : (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`${DESKTOP_NAV_LINK_CLASS} whitespace-nowrap`}
                    >
                      {link.label}
                    </Link>
                  )
                )}
              </nav>
            ) : null}

            {userId && <UserHeaderControl />}
          </div>
        </div>
        </Card>
      </header>
    </>
  );
}

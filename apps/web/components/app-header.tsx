import Link from 'next/link';
import type { Route } from 'next';
import { auth, currentUser } from '@clerk/nextjs/server';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { DEFAULT_BRAND_NAME, getHeaderClubBranding } from '@/lib/branding';
import { MobileNavDrawer } from '@/components/MobileNavDrawer';
import { MobileHeaderTitle } from '@/components/MobileHeaderTitle';
import { UserHeaderControl } from '@/components/UserHeaderControl';
import { tokens } from '@/components/ui/tokens';
import { cn } from '@/lib/cn';

type NavLink = { href: Route; label: string; roles: ('COACH' | 'ATHLETE' | 'ADMIN')[] };

const DESKTOP_NAV_LINK_CLASS = cn(
  'rounded-full px-3 py-2 min-h-[44px] inline-flex items-center hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]',
  tokens.typography.navLink
);

const allNavLinks: NavLink[] = [
  { href: '/coach/dashboard', label: 'Dashboard', roles: ['COACH'] },
  { href: '/coach/assistant' as Route, label: 'Assistant', roles: ['COACH'] },
  { href: '/coach/challenges', label: 'Challenges', roles: ['COACH'] },
  { href: '/coach/notifications', label: 'Notifications', roles: ['COACH'] },
  { href: '/coach/athletes', label: 'Athletes', roles: ['COACH'] },
  { href: '/coach/calendar', label: 'Scheduling', roles: ['COACH'] },
  { href: '/coach/group-sessions', label: 'SESSION BUILDER', roles: ['COACH'] },
  { href: '/coach/settings', label: 'Settings', roles: ['COACH'] },
  { href: '/athlete/dashboard', label: 'Dashboard', roles: ['ATHLETE'] },
  { href: '/challenges' as Route, label: 'Challenges', roles: ['ATHLETE'] },
  { href: '/athlete/notifications', label: 'Notifications', roles: ['ATHLETE'] },
  { href: '/athlete/calendar', label: 'Workout Schedule', roles: ['ATHLETE'] },
  { href: '/athlete/settings', label: 'Settings', roles: ['ATHLETE'] },
];

function isAuthDisabled() {
  return (
    process.env.NODE_ENV === 'development' &&
    (process.env.DISABLE_AUTH === 'true' || process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true')
  );
}

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
  const authDisabled = isAuthDisabled();

  // Get user from database if authenticated
  let userRole: 'COACH' | 'ATHLETE' | 'ADMIN' | null = null;
  let currentDbUserId: string | null = null;
  let unreadNotificationsCount = 0;
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
      currentDbUserId = user.id;

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
  } else if (authDisabled) {
    const { user } = await requireAuth();
    userRole = user.role;
    currentDbUserId = user.id;

    if (user.role === 'COACH' || user.role === 'ADMIN') {
      brandingCoachId = user.id;
    } else {
      const athleteProfile = await prisma.athleteProfile.findUnique({
        where: { userId: user.id },
        select: { coachId: true },
      });
      brandingCoachId = athleteProfile?.coachId ?? null;
    }

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

  if (currentDbUserId && (userRole === 'COACH' || userRole === 'ATHLETE')) {
    if (userRole === 'COACH') {
      const unreadMessages = await prisma.message.findMany({
        where: {
          deletedAt: null,
          senderRole: 'ATHLETE',
          coachReadAt: null,
          thread: { coachId: currentDbUserId },
        },
        select: {
          senderUserId: true,
          thread: { select: { athleteId: true } },
        },
      });

      // Only count unread rows that can appear in the coach mailbox list.
      unreadNotificationsCount = unreadMessages.filter(
        (message) => message.senderUserId === message.thread.athleteId
      ).length;
    } else {
      unreadNotificationsCount = await prisma.message.count({
        where: {
          deletedAt: null,
          senderRole: 'COACH',
          athleteReadAt: null,
          thread: { athleteId: currentDbUserId },
        },
      });
    }
  }

  // Filter navigation by authenticated role
  const navLinks = userRole
    ? allNavLinks.filter((link) => link.roles.includes(userRole))
    : [];

  const desktopTextLinks = navLinks.filter(
    (link) => !link.href.endsWith('/settings') && !link.href.endsWith('/notifications')
  );
  const desktopNotificationsLink = navLinks.find((link) => link.href.endsWith('/notifications'));
  const desktopSettingsLink = navLinks.find((link) => link.href.endsWith('/settings'));
  const isCoachDesktop = userRole === 'COACH';

  const coachPrimaryDesktopOrder: Route[] = [
    '/coach/dashboard',
    '/coach/calendar',
    '/coach/notifications',
    '/coach/settings',
  ];
  const coachPrimaryDesktopLinks = coachPrimaryDesktopOrder
    .map((href) => navLinks.find((link) => link.href === href))
    .filter((link): link is NavLink => Boolean(link));

  const coachSecondaryDesktopLinks: Array<{ href: Route; label: string; context: string }> = [
    { href: '/coach/group-sessions', label: 'Session Builder', context: 'Scheduling' },
    { href: '/coach/assistant' as Route, label: 'Assistant', context: 'Athletes' },
  ];

  const headerClubBranding = getHeaderClubBranding(clubBranding);

  const mobileLinks = navLinks.map((link) => ({ href: link.href as string, label: link.label }));
  const showUserControl = Boolean(userId) || authDisabled;

  return (
    <>
      {/* Mobile-only top branding: scrolls away; sticky header remains */}
      <div data-mobile-top-branding="v1" className="md:hidden px-0 pt-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {headerClubBranding.type === 'logo' ? (
              <>
                {headerClubBranding.darkLogoUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={headerClubBranding.logoUrl}
                      alt={`${headerClubBranding.name} logo`}
                      className="h-11 w-auto object-contain dark:hidden"
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={headerClubBranding.darkLogoUrl}
                      alt={`${headerClubBranding.name} logo`}
                      className="hidden h-11 w-auto object-contain dark:block"
                    />
                  </>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={headerClubBranding.logoUrl}
                    alt={`${headerClubBranding.name} logo`}
                    className="h-11 w-auto object-contain"
                  />
                )}
              </>
            ) : (
              <span className="block max-w-[55vw] md:truncate text-xs font-medium text-[var(--muted)]">
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/coachkit-logo.png"
              alt="CoachKit"
              className="h-[29px] w-[29px] object-contain dark:hidden"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/CoachKit_Dark.png"
              alt="CoachKit"
              className="hidden h-[29px] w-[29px] object-contain dark:block"
            />
          </Link>
        </div>
      </div>

      <header className="sticky top-0 z-50 bg-[var(--bg-page)] px-0 pt-0 md:px-0 md:pt-0">
        {/* NOTE (dev-only): Keep shared wrapper surfaces token-only; avoid translucent white overlays, gradients, and backdrop blur (they cause coach/athlete surface drift). */}
        <Card className="rounded-none bg-[var(--bg-surface)] p-0">
          {/* Mobile (iOS-first): single row header */}
          <div data-mobile-header="v1" className="md:hidden flex h-14 items-center gap-2 px-3">
            {navLinks.length > 0 ? <MobileNavDrawer links={mobileLinks} /> : <div className="h-11 w-11" />}
            <MobileHeaderTitle />
            <div className="flex min-w-0 max-w-[40vw] justify-end">
              {showUserControl && <UserHeaderControl />}
            </div>
          </div>

        {/* Desktop: keep existing multi-brand header */}
        <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center md:gap-4 md:px-6 md:py-0">
          {/* Left block: Club branding (row 1, col 1) */}
          <div className="col-start-1 row-start-1 flex min-w-0 items-center justify-start">
            {headerClubBranding.type === 'logo' ? (
              <>
                {headerClubBranding.darkLogoUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={headerClubBranding.logoUrl}
                      alt={`${headerClubBranding.name} logo`}
                      className="h-12 w-auto object-contain sm:h-14 dark:hidden"
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={headerClubBranding.darkLogoUrl}
                      alt={`${headerClubBranding.name} logo`}
                      className="hidden h-12 w-auto object-contain sm:h-14 dark:block"
                    />
                  </>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={headerClubBranding.logoUrl}
                    alt={`${headerClubBranding.name} logo`}
                    className="h-12 w-auto object-contain sm:h-14"
                  />
                )}
              </>
            ) : (
              <span
                className="max-w-[240px] md:overflow-hidden md:text-ellipsis md:whitespace-nowrap text-sm font-medium text-[var(--text)] sm:max-w-[320px]"
              >
                {headerClubBranding.name}
              </span>
            )}
          </div>

          {/* Center block: true-centered CoachKit branding */}
          <div className="col-start-2 row-start-1 justify-self-center pointer-events-none z-10 flex items-center">
            <Link
              href="/" 
              className="pointer-events-auto inline-flex items-center gap-2 rounded-full px-2 py-1 font-display font-semibold tracking-tight text-[var(--text)]"
            >
              <span className="hidden text-base sm:inline">CoachKit</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/coachkit-logo.png"
                alt="CoachKit"
                className="h-[44px] w-[44px] object-contain dark:hidden"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/CoachKit_Dark.png"
                alt="CoachKit"
                className="hidden h-[44px] w-[44px] object-contain dark:block"
              />
            </Link>
          </div>

          {/* Right block: Nav + user (desktop) (row 1, col 3) */}
          <div className="col-start-3 row-start-1 flex items-center justify-end gap-3 md:gap-4">
            {navLinks.length > 0 ? (
              isCoachDesktop ? (
                <div className="hidden md:flex items-center gap-3">
                  <nav className="flex items-center gap-2">
                    {coachPrimaryDesktopLinks.map((link) => (
                      <Link key={link.href} href={link.href} className={cn(DESKTOP_NAV_LINK_CLASS, 'md:whitespace-nowrap')}>
                        {link.label}
                        {link.href === '/coach/notifications' && unreadNotificationsCount > 0 ? (
                          <span className="ml-2 inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" aria-hidden="true" />
                        ) : null}
                      </Link>
                    ))}
                  </nav>
                  <div className="h-5 w-px bg-[var(--border-subtle)]" aria-hidden="true" />
                  <nav className="flex items-center gap-2">
                    {coachSecondaryDesktopLinks.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className={cn(
                          'rounded-full border border-[var(--border-subtle)] px-3 py-1.5 min-h-[36px] inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--bg-structure)]',
                          'md:whitespace-nowrap'
                        )}
                      >
                        <span className="text-[9px] text-[var(--muted)]/80">{link.context}</span>
                        <span className="text-[var(--text)]">{link.label}</span>
                      </Link>
                    ))}
                  </nav>
                </div>
              ) : (
                <nav className="hidden md:flex flex-wrap gap-2">
                  {desktopTextLinks.map((link) => (
                    <Link key={link.href} href={link.href} className={cn(DESKTOP_NAV_LINK_CLASS, 'md:whitespace-nowrap')}>
                      {link.label}
                    </Link>
                  ))}

                  {desktopNotificationsLink ? (
                    <Link
                      key={desktopNotificationsLink.href}
                      href={desktopNotificationsLink.href}
                      aria-label="Notifications"
                      className={cn(DESKTOP_NAV_LINK_CLASS, 'relative justify-center')}
                    >
                      <Icon name="inbox" size="sm" className="text-[13.5px] text-inherit" />
                      {unreadNotificationsCount > 0 ? (
                        <span
                          aria-hidden="true"
                          className="absolute right-2 top-2 inline-flex h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-[var(--bg-surface)]"
                        />
                      ) : null}
                      {unreadNotificationsCount > 0 ? (
                        <span className="sr-only">{`${unreadNotificationsCount} unread notification${unreadNotificationsCount === 1 ? '' : 's'}`}</span>
                      ) : null}
                      <span className="sr-only">Notifications</span>
                    </Link>
                  ) : null}

                  {desktopSettingsLink ? (
                    <Link
                      key={desktopSettingsLink.href}
                      href={desktopSettingsLink.href}
                      aria-label="Settings"
                      className={cn(DESKTOP_NAV_LINK_CLASS, 'justify-center')}
                    >
                      <Icon name="settings" size="sm" className="text-[13.5px] text-inherit" />
                      <span className="sr-only">Settings</span>
                    </Link>
                  ) : null}
                </nav>
              )
            ) : null}

            {showUserControl && <UserHeaderControl />}
          </div>
        </div>
        </Card>
      </header>
    </>
  );
}

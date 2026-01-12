import Link from 'next/link';
import type { Route } from 'next';
import { auth, currentUser } from '@clerk/nextjs/server';
import { UserButton } from '@clerk/nextjs';

import { prisma } from '@/lib/prisma';
import { Card } from '@/components/ui/Card';
import { DEFAULT_BRAND_NAME } from '@/lib/branding';

type NavLink = { href: Route; label: string; roles: ('COACH' | 'ATHLETE')[] };

const allNavLinks: NavLink[] = [
  { href: '/coach/dashboard', label: 'Dashboard', roles: ['COACH'] },
  { href: '/coach/athletes', label: 'Athletes', roles: ['COACH'] },
  { href: '/coach/calendar', label: 'Calendar', roles: ['COACH'] },
  { href: '/coach/group-sessions', label: 'Sessions', roles: ['COACH'] },
  { href: '/coach/settings', label: 'Settings', roles: ['COACH'] },
  { href: '/athlete/calendar', label: 'My Calendar', roles: ['ATHLETE'] },
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
  let branding = { displayName: DEFAULT_BRAND_NAME, logoUrl: null as string | null };

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
      
      if (user.role === 'COACH' && user.branding) {
        branding = {
          displayName: user.branding.displayName || DEFAULT_BRAND_NAME,
          logoUrl: user.branding.logoUrl,
        };
      }
    }
  }

  // Filter navigation by authenticated role
  const navLinks = userRole
    ? allNavLinks.filter((link) => link.roles.includes(userRole))
    : [];

  const subtitle = branding.displayName !== DEFAULT_BRAND_NAME ? branding.displayName : '';

  return (
    <header className="px-6 pt-6">
      {/* NOTE (dev-only): Keep shared wrapper surfaces token-only; avoid translucent white overlays, gradients, and backdrop blur (they cause coach/athlete surface drift). */}
      <Card className="flex flex-col gap-4 rounded-3xl p-5 bg-[var(--bg-surface)] md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logoUrl}
              alt={`${branding.displayName} logo`}
              className="h-[55px] w-[55px] object-contain"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-structure)] text-lg font-semibold text-[var(--text)]">
              CK
            </div>
          )}
          <div>
            <a href="/" className="font-display text-xl font-semibold tracking-tight">
              CoachKit
            </a>
            {subtitle ? <p className="text-sm text-[var(--muted)]">{subtitle}</p> : null}
          </div>
        </div>

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

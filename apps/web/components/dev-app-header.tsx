'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { MobileNavDrawer } from '@/components/MobileNavDrawer';
import { MobileHeaderTitle } from '@/components/MobileHeaderTitle';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';

type Role = 'COACH' | 'ATHLETE' | 'ADMIN' | null;

type NavLink = { href: string; label: string; roles: Array<'COACH' | 'ATHLETE' | 'ADMIN'> };

const DESKTOP_NAV_LINK_CLASS =
  'rounded-full px-3 py-2 min-h-[44px] inline-flex items-center text-[var(--muted)] hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]';

const ALL_NAV_LINKS: NavLink[] = [
  { href: '/coach/dashboard', label: 'Dashboard', roles: ['COACH'] },
  { href: '/coach/notifications', label: 'Notifications', roles: ['COACH'] },
  { href: '/coach/athletes', label: 'Manage Athletes', roles: ['COACH'] },
  { href: '/coach/calendar', label: 'Workout Scheduling', roles: ['COACH'] },
  { href: '/coach/group-sessions', label: 'SESSION BUILDER', roles: ['COACH'] },
  { href: '/coach/settings', label: 'Settings', roles: ['COACH'] },
  { href: '/admin/workout-library', label: 'Admin', roles: ['ADMIN'] },
  { href: '/athlete/dashboard', label: 'Dashboard', roles: ['ATHLETE'] },
  { href: '/athlete/notifications', label: 'Notifications', roles: ['ATHLETE'] },
  { href: '/athlete/calendar', label: 'Workout Schedule', roles: ['ATHLETE'] },
  { href: '/athlete/settings', label: 'Settings', roles: ['ATHLETE'] },
];

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/([.$?*|{}()\[\]\\/+^])/g, '\\$1')}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function DevAppHeader() {
  const [role, setRole] = useState<Role>(null);

  useEffect(() => {
    const raw = getCookie('coachkit-role');
    setRole(raw === 'COACH' || raw === 'ATHLETE' || raw === 'ADMIN' ? raw : 'COACH');
  }, []);

  const navLinks = useMemo(() => {
    if (!role) return [];
    return ALL_NAV_LINKS.filter((l) => l.roles.includes(role));
  }, [role]);

  const mobileLinks = useMemo(() => navLinks.map((l) => ({ href: l.href, label: l.label })), [navLinks]);

  return (
    <>
      {/* Mobile-only top branding: scrolls away; sticky header remains */}
      <div data-mobile-top-branding="v1" className="md:hidden px-4 pt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="block max-w-[55vw] truncate text-xs font-medium text-[var(--muted)]">Your Club</span>
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
                className="h-[29px] w-[29px] object-contain"
              />
            </picture>
          </Link>
        </div>
      </div>

      <header className="sticky top-0 z-50 bg-[var(--bg-page)] px-4 pt-2 md:px-6 md:pt-6">
        <Card className="rounded-3xl bg-[var(--bg-surface)] p-0">
          {/* Mobile: single-row header */}
          <div data-mobile-header="v1" className="md:hidden flex h-14 items-center gap-2 px-3">
            {navLinks.length > 0 ? <MobileNavDrawer links={mobileLinks} /> : <div className="h-11 w-11" />}
            <MobileHeaderTitle />
            <div className="flex w-11 justify-end">
              {/* Placeholder avatar in dev mode */}
              <div className="h-11 w-11 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] inline-flex items-center justify-center text-sm font-semibold text-[var(--text)]">
                D
              </div>
            </div>
          </div>

        {/* Desktop: minimal dev header */}
        <div className="hidden md:flex items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--bg-card)] border border-[var(--border-subtle)]">
              <Icon name="menu" size="md" className="text-[var(--muted)]" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--text)] truncate">CoachKit (dev)</div>
              <div className="text-xs text-[var(--muted)] truncate">Auth disabled</div>
            </div>
          </div>

          <nav className="hidden md:flex flex-wrap gap-2 text-sm font-medium uppercase">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href as any} className={`${DESKTOP_NAV_LINK_CLASS} whitespace-nowrap`}>
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="h-11 w-11 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] inline-flex items-center justify-center text-sm font-semibold text-[var(--text)]">
            D
          </div>
        </div>
        </Card>
      </header>
    </>
  );
}

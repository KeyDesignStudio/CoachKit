'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

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
  { href: '/coach/athletes', label: 'Athletes', roles: ['COACH'] },
  { href: '/coach/calendar', label: 'Scheduling', roles: ['COACH'] },
  { href: '/coach/group-sessions', label: 'SESSION BUILDER', roles: ['COACH'] },
  { href: '/coach/settings', label: 'Settings', roles: ['COACH'] },
  { href: '/athlete/dashboard', label: 'Dashboard', roles: ['ATHLETE'] },
  { href: '/athlete/notifications', label: 'Notifications', roles: ['ATHLETE'] },
  { href: '/athlete/calendar', label: 'Workout Schedule', roles: ['ATHLETE'] },
  { href: '/athlete/settings', label: 'Settings', roles: ['ATHLETE'] },
];

function DevUserMenu({ role }: { role: Role }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((value) => !value), []);

  useEffect(() => {
    close();
  }, [close, pathname]);

  const settingsHref = role === 'ATHLETE' ? '/athlete/settings' : '/coach/settings';

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="user-header-control"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        onClick={toggle}
        className="h-11 w-11 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] inline-flex items-center justify-center text-sm font-semibold text-[var(--text)]"
      >
        D
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div
            role="menu"
            aria-label="Account menu"
            className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[0_18px_48px_-32px_rgba(15,23,42,0.55)]"
          >
            <div className="px-4 py-3">
              <div className="text-sm font-semibold text-[var(--text)] truncate">Account</div>
              <div className="text-xs text-[var(--muted)] truncate">Dev mode</div>
            </div>
            <div className="h-px bg-[var(--border-subtle)]" />
            <div className="p-2">
              <button
                type="button"
                role="menuitem"
                className="w-full min-h-[44px] rounded-xl px-3 inline-flex items-center gap-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)]"
                onClick={() => {
                  close();
                  router.push(settingsHref);
                }}
              >
                <Icon name="settings" size="sm" className="text-[var(--muted)]" />
                <span>Account settings</span>
              </button>
              {role === 'ATHLETE' ? (
                <button
                  type="button"
                  role="menuitem"
                  className="mt-1 w-full min-h-[44px] rounded-xl px-3 inline-flex items-center gap-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)]"
                  onClick={() => {
                    close();
                    router.push('/athlete/profile');
                  }}
                >
                  <Icon name="info" size="sm" className="text-[var(--muted)]" />
                  <span>Athlete profile</span>
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

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

  const desktopTextLinks = useMemo(
    () => navLinks.filter((link) => !link.href.endsWith('/settings') && !link.href.endsWith('/notifications')),
    [navLinks]
  );
  const desktopNotificationsLink = useMemo(
    () => navLinks.find((link) => link.href.endsWith('/notifications')),
    [navLinks]
  );
  const desktopSettingsLink = useMemo(() => navLinks.find((link) => link.href.endsWith('/settings')), [navLinks]);

  const mobileLinks = useMemo(() => navLinks.map((l) => ({ href: l.href, label: l.label })), [navLinks]);

  return (
    <>
      {/* Mobile-only top branding: scrolls away; sticky header remains */}
      <div data-mobile-top-branding="v1" className="md:hidden px-0 pt-0">
        <div className="flex items-center justify-between gap-3">
          <span className="block max-w-[55vw] truncate text-xs font-medium text-[var(--muted)]">Your Club</span>
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
        <Card className="rounded-none bg-[var(--bg-surface)] p-0">
          {/* Mobile: single-row header */}
          <div data-mobile-header="v1" className="md:hidden flex h-14 items-center gap-2 px-3">
            {navLinks.length > 0 ? <MobileNavDrawer links={mobileLinks} /> : <div className="h-11 w-11" />}
            <MobileHeaderTitle />
            <div className="flex w-11 justify-end">
              <DevUserMenu role={role} />
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
            {desktopTextLinks.map((link) => (
              <Link key={link.href} href={link.href as any} className={`${DESKTOP_NAV_LINK_CLASS} whitespace-nowrap`}>
                {link.label}
              </Link>
            ))}

            {desktopNotificationsLink ? (
              <Link
                key={desktopNotificationsLink.href}
                href={desktopNotificationsLink.href as any}
                aria-label="Notifications"
                className={`${DESKTOP_NAV_LINK_CLASS} justify-center`}
              >
                <Icon name="inbox" size="sm" className="text-[13.5px] text-[var(--muted)]" />
                <span className="sr-only">Notifications</span>
              </Link>
            ) : null}

            {desktopSettingsLink ? (
              <Link
                key={desktopSettingsLink.href}
                href={desktopSettingsLink.href as any}
                aria-label="Settings"
                className={`${DESKTOP_NAV_LINK_CLASS} justify-center`}
              >
                <Icon name="settings" size="sm" className="text-[13.5px] text-[var(--muted)]" />
                <span className="sr-only">Settings</span>
              </Link>
            ) : null}
          </nav>

          <DevUserMenu role={role} />
        </div>
        </Card>
      </header>
    </>
  );
}

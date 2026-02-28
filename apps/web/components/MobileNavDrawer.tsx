'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

export type MobileNavLink = {
  href: Route | string;
  label: string;
  ariaLabel?: string;
};

type MobileNavDrawerProps = {
  links: MobileNavLink[];
};

export function MobileNavDrawer({ links }: MobileNavDrawerProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    // Close drawer on navigation.
    setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [close, open]);

  const effectiveLinks = useMemo(() => {
    // Defensive: avoid empty/duplicate labels in drawer.
    const seen = new Set<string>();
    const dedupedWithIndex = links
      .map((link, index) => ({ link, index }))
      .filter(({ link }) => {
        const key = `${link.href}::${link.label}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    const hasCoachLinks = dedupedWithIndex.some(({ link }) => String(link.href).startsWith('/coach/'));
    if (!hasCoachLinks) {
      const hasAthleteLinks = dedupedWithIndex.some(({ link }) => String(link.href).startsWith('/athlete/'));
      if (!hasAthleteLinks) {
        return dedupedWithIndex.map(({ link }) => link);
      }

      const athleteOrder: Array<string> = [
        '/athlete/dashboard',
        '/athlete/calendar',
        '/athlete/future-self',
        '/athlete/notifications',
        '/athlete/settings',
      ];
      const athleteRank = new Map<string, number>(athleteOrder.map((href, idx) => [href, idx]));
      const normalizedAthlete = dedupedWithIndex.map(({ link, index }) => ({
        link,
        href: String(link.href),
        index,
      }));

      normalizedAthlete.sort((a, b) => {
        const ra = athleteRank.get(a.href);
        const rb = athleteRank.get(b.href);
        const aKnown = typeof ra === 'number';
        const bKnown = typeof rb === 'number';
        if (aKnown && bKnown) return ra! - rb!;
        if (aKnown) return -1;
        if (bKnown) return 1;
        return a.index - b.index;
      });

      return normalizedAthlete.map(({ link }) => link);
    }

    // Mobile-only coach menu rules:
    // - Order: Dashboard, Athletes, Scheduling, Session Builder, Notifications, Settings
    // - Label: "SESSION BUILDER" -> "Session Builder"
    const coachOrder: Array<string> = [
      '/coach/dashboard',
      '/coach/athletes',
      '/coach/calendar',
      '/coach/group-sessions',
      '/coach/notifications',
      '/coach/settings',
    ];
    const coachRank = new Map<string, number>(coachOrder.map((href, idx) => [href, idx]));

    const normalized = dedupedWithIndex.map(({ link, index }) => {
      const href = String(link.href);
      const label = href === '/coach/group-sessions' ? 'Session Builder' : link.label;
      return { link: { ...link, label }, href, index };
    });

    normalized.sort((a, b) => {
      const ra = coachRank.get(a.href);
      const rb = coachRank.get(b.href);
      const aKnown = typeof ra === 'number';
      const bKnown = typeof rb === 'number';
      if (aKnown && bKnown) return ra! - rb!;
      if (aKnown) return -1;
      if (bKnown) return 1;
      return a.index - b.index;
    });

    return normalized.map(({ link }) => link);
  }, [links]);

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        className={cn(
          'inline-flex h-11 w-11 items-center justify-center rounded-full',
          'border border-[var(--border-subtle)] bg-[var(--bg-card)]',
          'text-[var(--text)]',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]'
        )}
        aria-label={open ? 'Close menu' : 'Open menu'}
      >
        <Icon name={open ? 'close' : 'menu'} size="md" className="text-[var(--text)]" aria-hidden />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/25" onClick={close} />

          <nav
            data-mobile-nav-drawer="v1"
            className={cn(
              'fixed left-0 top-0 z-50 h-full w-[min(86vw,360px)]',
              'bg-[var(--bg-surface)] border-r border-[var(--border-subtle)]',
              'overflow-y-auto'
            )}
            aria-label="Mobile navigation"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
              <div className="text-sm font-semibold text-[var(--text)]">Menu</div>
              <button
                type="button"
                onClick={close}
                className={cn(
                  'inline-flex h-11 w-11 items-center justify-center rounded-full',
                  'text-[var(--text)] hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)]',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]'
                )}
                aria-label="Close menu"
              >
                <Icon name="close" size="md" className="text-[var(--text)]" aria-hidden />
              </button>
            </div>

            <div className="flex flex-col px-2 py-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {effectiveLinks.map((link) => {
                const active = pathname === link.href;
                return (
                  <Link
                    key={`${link.href}::${link.label}`}
                    href={link.href as any}
                    aria-label={link.ariaLabel ?? link.label}
                    className={cn(
                      'w-full min-h-[44px] px-4 py-3 rounded-xl',
                      'text-sm font-medium text-[var(--text)]',
                      'inline-flex items-center',
                      'hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)]',
                      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]',
                      active ? 'bg-[var(--bg-structure)]' : ''
                    )}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </>
      ) : null}
    </>
  );
}

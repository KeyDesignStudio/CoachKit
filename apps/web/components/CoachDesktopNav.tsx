'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/cn';

type CoachDesktopPrimaryLink = {
  href: string;
  label: string;
};

type CoachDesktopSubmenu = {
  parentHref: string;
  childHref: string;
  childLabel: string;
};

type CoachDesktopNavProps = {
  links: CoachDesktopPrimaryLink[];
  submenus: CoachDesktopSubmenu[];
  unreadNotificationsCount?: number;
  navLinkClassName: string;
};

export function CoachDesktopNav({
  links,
  submenus,
  unreadNotificationsCount = 0,
  navLinkClassName,
}: CoachDesktopNavProps) {
  const pathname = usePathname();
  const [openParentHref, setOpenParentHref] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const submenuByParent = useMemo(() => new Map(submenus.map((submenu) => [submenu.parentHref, submenu])), [submenus]);

  useEffect(() => {
    setOpenParentHref(null);
  }, [pathname]);

  useEffect(() => {
    if (!openParentHref) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setOpenParentHref(null);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [openParentHref]);

  const closeMenu = useCallback(() => setOpenParentHref(null), []);

  return (
    <div ref={wrapperRef} className="relative" onMouseLeave={closeMenu}>
      <nav className="flex items-center gap-2">
        {links.map((link) => {
          const submenu = submenuByParent.get(link.href);
          const isOpen = openParentHref === link.href;

          if (!submenu) {
            return (
              <Link key={link.href} href={link.href as never} className={cn(navLinkClassName, 'md:whitespace-nowrap')}>
                {link.label}
                {link.href === '/coach/notifications' && unreadNotificationsCount > 0 ? (
                  <span className="ml-2 inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" aria-hidden="true" />
                ) : null}
              </Link>
            );
          }

          return (
            <div key={link.href} className="relative inline-flex items-center">
              <Link href={link.href as never} className={cn(navLinkClassName, 'rounded-r-none pr-1 md:whitespace-nowrap')}>
                {link.label}
              </Link>
              <button
                type="button"
                aria-label={`Open ${link.label} submenu`}
                aria-expanded={isOpen}
                onClick={() => setOpenParentHref((current) => (current === link.href ? null : link.href))}
                className={cn(
                  navLinkClassName,
                  'rounded-l-none pl-1 pr-2',
                  'border-l border-[var(--border-subtle)]/70'
                )}
              >
                <span className={cn('text-[10px] text-[var(--muted)] transition-transform', isOpen ? 'rotate-180' : '')} aria-hidden="true">
                  v
                </span>
              </button>

              {isOpen ? (
                <div
                  className={cn(
                    'absolute right-0 top-[calc(100%+0.4rem)] z-20 min-w-[188px]',
                    'rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1.5',
                    'shadow-[0_18px_48px_-32px_rgba(15,23,42,0.55)]'
                  )}
                >
                  <Link
                    href={submenu.childHref as never}
                    className="inline-flex w-full items-center rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text)] hover:bg-[var(--bg-structure)]"
                    onClick={closeMenu}
                  >
                    {submenu.childLabel}
                  </Link>
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </div>
  );
}

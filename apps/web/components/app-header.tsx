'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';

import { useBranding } from '@/components/branding-context';
import { Card } from '@/components/ui/Card';
import { DEFAULT_BRAND_NAME } from '@/lib/branding';

const navLinks: { href: Route; label: string }[] = [
  { href: '/coach/dashboard', label: 'Coach · Dashboard' },
  { href: '/coach/athletes', label: 'Coach · Athlete Profiles' },
  { href: '/coach/calendar', label: 'Coach · Calendar' },
  { href: '/coach/multi-calendar', label: 'Coach · Multi-athlete Calendar' },
  { href: '/coach/group-sessions', label: 'Coach · Group Sessions' },
  { href: '/coach/settings', label: 'Coach · Settings' },
  { href: '/athlete/calendar', label: 'Athlete · Calendar' },
];

export function AppHeader() {
  const { branding } = useBranding();
  const pathname = usePathname();

  const subtitle = useMemo(() => {
    if (!branding.displayName || branding.displayName === DEFAULT_BRAND_NAME) {
      return '';
    }

    return branding.displayName;
  }, [branding.displayName]);

  return (
    <header className="px-6 pt-6">
      <Card className="flex flex-col gap-4 rounded-3xl p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logoUrl}
              alt={`${branding.displayName || DEFAULT_BRAND_NAME} logo`}
              className="h-[55px] w-[55px] object-contain"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/30 bg-white/30 text-lg font-semibold text-[var(--text)]">
              CK
            </div>
          )}
          <div>
            <Link href="/" className="font-display text-xl font-semibold tracking-tight">
              CoachKit
            </Link>
            {subtitle ? <p className="text-sm text-[var(--muted)]">{subtitle}</p> : null}
          </div>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm font-medium text-[var(--muted)]">
          {navLinks.map((link) => {
            const active = pathname?.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={
                  active
                    ? 'rounded-full bg-white/70 px-3 py-1 text-[var(--text)] shadow-sm'
                    : 'rounded-full px-3 py-1 hover:bg-white/30'
                }
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </Card>
    </header>
  );
}

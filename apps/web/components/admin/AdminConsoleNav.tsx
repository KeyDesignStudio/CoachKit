'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/cn';

type NavItem = {
  label: string;
  href: string;
};

const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/admin' },
  { label: 'AI Usage', href: '/admin/ai-usage' },
  { label: 'AI Audits', href: '/admin/ai-audits' },
  { label: 'Engine Controls', href: '/admin/ai-plan-builder/engine-controls' },
  { label: 'Policy Tuning', href: '/admin/ai-plan-builder/policy-tuning' },
  { label: 'Plan Library', href: '/admin/plan-library' },
  { label: 'Parser Studio', href: '/admin/plan-library/parser-studio' },
  { label: 'Strava Sync', href: '/admin/strava-sync' },
  { label: 'Data Audit', href: '/admin/audit' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminConsoleNav() {
  const pathname = usePathname();

  return (
    <div className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[var(--bg-page)]/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-2 overflow-x-auto px-4 py-3">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href as any}
              className={cn(
                'whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'border-[var(--text)] bg-[var(--text)] text-[var(--bg-page)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text)] hover:bg-[var(--bg-structure)]'
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

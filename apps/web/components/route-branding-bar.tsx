'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';

import { useBranding } from '@/components/branding-context';
import { DEFAULT_BRAND_NAME, resolveLogoUrl } from '@/lib/branding';

export function RouteBrandingBar() {
  const pathname = usePathname();
  const { branding } = useBranding();

  const shouldShow = useMemo(() => {
    if (!pathname) {
      return false;
    }
    return pathname.startsWith('/coach') || pathname.startsWith('/athlete');
  }, [pathname]);

  if (!shouldShow) {
    return null;
  }

  // NOTE (dev-only): Keep shared wrapper surfaces token-only; avoid translucent white overlays, gradients, and backdrop blur (they cause coach/athlete surface drift).

  return (
    <div className="px-6 pt-4">
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={resolveLogoUrl(branding.logoUrl)}
          alt={`${branding.displayName || DEFAULT_BRAND_NAME} logo`}
          className="h-14 w-14 rounded-xl object-cover border border-[var(--border-subtle)] bg-[var(--bg-card)]"
        />
        <div>
          <p className="m-0 text-xs text-[var(--muted)]">Program branding</p>
          <p className="m-0 font-semibold text-[var(--text)]">{branding.displayName || DEFAULT_BRAND_NAME}</p>
        </div>
      </div>
    </div>
  );
}

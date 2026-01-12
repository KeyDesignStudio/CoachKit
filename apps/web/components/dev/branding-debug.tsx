'use client';

import { useEffect, useRef } from 'react';

export function BrandingDebug({
  coachId,
  rawLogoUrl,
  resolvedLogoUrl,
}: {
  coachId: string | null;
  rawLogoUrl: string | null;
  resolvedLogoUrl: string;
}) {
  const loggedRef = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (loggedRef.current) return;
    loggedRef.current = true;

    // Debug-only: helps confirm the club logo is sourced from CoachBranding.logoUrl.
    // Do not log in production.
    // eslint-disable-next-line no-console
    console.log('[BrandingDebug] club branding', {
      coachId,
      rawLogoUrl,
      resolvedLogoUrl,
    });
  }, [coachId, rawLogoUrl, resolvedLogoUrl]);

  return null;
}

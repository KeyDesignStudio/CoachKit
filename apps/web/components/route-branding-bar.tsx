'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';

import { useBranding } from '@/components/branding-context';
import { DEFAULT_BRAND_NAME } from '@/lib/branding';

export function RouteBrandingBar() {
  const pathname = usePathname();
  const { branding } = useBranding();

  const shouldShow = useMemo(() => {
    if (!pathname) {
      return false;
    }

    if (!branding.logoUrl) {
      return false;
    }

    return pathname.startsWith('/coach') || pathname.startsWith('/athlete');
  }, [branding.logoUrl, pathname]);

  if (!shouldShow) {
    return null;
  }

  return (
    <div style={{ padding: '1rem 1.5rem 0', background: '#ffffff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={branding.logoUrl ?? ''}
          alt={`${branding.displayName || DEFAULT_BRAND_NAME} logo`}
          style={{ width: 56, height: 56, borderRadius: '0.75rem', objectFit: 'cover', border: '1px solid #e2e8f0' }}
        />
        <div>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8' }}>Program branding</p>
          <p style={{ margin: 0, fontWeight: 600 }}>{branding.displayName || DEFAULT_BRAND_NAME}</p>
        </div>
      </div>
    </div>
  );
}

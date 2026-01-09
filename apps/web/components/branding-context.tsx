'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useApi } from '@/components/api-client';
import { DEFAULT_BRANDING, type BrandingPayload } from '@/lib/branding';

export type BrandingContextValue = {
  branding: BrandingPayload;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
};

const BrandingContext = createContext<BrandingContextValue | undefined>(undefined);

/**
 * BrandingProvider - Client-side branding context
 * 
 * Note: This is primarily for client components that need branding.
 * Server components should fetch branding directly from the database.
 */
export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { request } = useApi();
  const [branding, setBranding] = useState<BrandingPayload>(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadBranding = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const data = await request<{ branding: BrandingPayload }>('/api/branding');
      setBranding(data.branding);
    } catch (err) {
      setBranding(DEFAULT_BRANDING);
      setError(err instanceof Error ? err.message : 'Failed to load branding.');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    loadBranding();
  }, [loadBranding]);

  const value = useMemo<BrandingContextValue>(
    () => ({
      branding,
      loading,
      error,
      refresh: loadBranding,
    }),
    [branding, loading, error, loadBranding]
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  const context = useContext(BrandingContext);

  if (!context) {
    throw new Error('useBranding must be used within a BrandingProvider');
  }

  return context;
}

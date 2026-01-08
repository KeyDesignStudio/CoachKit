'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useUser } from '@/components/user-context';
import { DEFAULT_BRANDING, type BrandingPayload } from '@/lib/branding';

export type BrandingContextValue = {
  branding: BrandingPayload;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
};

const BrandingContext = createContext<BrandingContextValue | undefined>(undefined);

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const { request } = useApi();
  const [branding, setBranding] = useState<BrandingPayload>(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadBranding = useCallback(async () => {
    if (!user.userId) {
      setBranding(DEFAULT_BRANDING);
      setError('');
      return;
    }

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
  }, [request, user.userId]);

  useEffect(() => {
    loadBranding();
  }, [loadBranding, user.role]);

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

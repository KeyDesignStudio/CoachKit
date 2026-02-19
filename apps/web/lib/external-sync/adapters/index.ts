import type { ExternalProviderAdapter, ExternalSyncProvider } from '@/lib/external-sync/types';
import { stravaProviderAdapter } from '@/lib/external-sync/adapters/strava';

const providerAdapters: Record<ExternalSyncProvider, ExternalProviderAdapter<any> | null> = {
  STRAVA: stravaProviderAdapter,
  GARMIN: null,
  WAHOO: null,
  COROS: null,
  POLAR: null,
};

export function getProviderAdapter(provider: ExternalSyncProvider) {
  return providerAdapters[provider];
}

export function listRegisteredProviderAdapters() {
  return Object.entries(providerAdapters)
    .filter(([, adapter]) => Boolean(adapter))
    .map(([provider]) => provider as ExternalSyncProvider);
}

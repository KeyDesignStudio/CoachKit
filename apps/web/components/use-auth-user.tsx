'use client';

import { useEffect, useState } from 'react';
import { UserRole } from '@prisma/client';

export type AuthUser = {
  userId: string;
  role: UserRole;
  email: string;
  name: string | null;
  timezone: string;
};

type AuthState = {
  user: AuthUser | null;
  error: Error | null;
  loading: boolean;
};

const USER_CACHE_TTL_MS = 60_000;

const authState: AuthState = {
  user: null,
  error: null,
  loading: true,
};

let authFetchedAt = 0;
let inFlightUserRequest: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

async function fetchAuthUserShared(): Promise<void> {
  const fresh = Date.now() - authFetchedAt < USER_CACHE_TTL_MS;
  if (fresh && !authState.loading) {
    return;
  }

  if (inFlightUserRequest) {
    await inFlightUserRequest;
    return;
  }

  authState.loading = true;
  notifyListeners();

  inFlightUserRequest = (async () => {
    try {
      const response = await fetch('/api/me');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to fetch user');
      }

      authState.user = data.data.user;
      authState.error = null;
      authFetchedAt = Date.now();
    } catch (err) {
      authState.error = err instanceof Error ? err : new Error('Failed to fetch user');
    } finally {
      authState.loading = false;
      inFlightUserRequest = null;
      notifyListeners();
    }
  })();

  await inFlightUserRequest;
}

/**
 * Client-side hook to fetch the authenticated user from /api/me
 * This replaces the legacy useUser hook from user-context
 */
export function useAuthUser() {
  const [state, setState] = useState<AuthState>(() => ({ ...authState }));

  useEffect(() => {
    const sync = () => setState({ ...authState });
    listeners.add(sync);
    sync();
    void fetchAuthUserShared();

    return () => {
      listeners.delete(sync);
    };
  }, []);

  return state;
}

'use client';

import { useUser } from '@clerk/nextjs';
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
let cachedClerkUserId: string | null = null;
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

function resetCachedAuthState() {
  authState.user = null;
  authState.error = null;
  authState.loading = true;
  authFetchedAt = 0;
  inFlightUserRequest = null;
}

/**
 * Client-side hook to fetch the authenticated user from /api/me
 * This replaces the legacy useUser hook from user-context
 */
export function useAuthUser() {
  const { user: clerkUser, isLoaded: clerkLoaded } = useUser();
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

  useEffect(() => {
    if (!clerkLoaded) return;

    const nextClerkUserId = clerkUser?.id ?? null;
    if (cachedClerkUserId !== nextClerkUserId) {
      cachedClerkUserId = nextClerkUserId;
      resetCachedAuthState();
      notifyListeners();
      if (nextClerkUserId) {
        void fetchAuthUserShared();
      }
    }
  }, [clerkLoaded, clerkUser?.id]);

  return state;
}

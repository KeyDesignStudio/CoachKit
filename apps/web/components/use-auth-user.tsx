'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useUser } from '@clerk/nextjs';

import type { AuthUser } from '@/lib/auth-user';

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

type AuthUserBootstrapValue = {
  initialUser: AuthUser | null;
  initialClerkUserId: string | null;
  resolved: boolean;
};

const AuthUserBootstrapContext = createContext<AuthUserBootstrapValue | null>(null);

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function primeAuthState(params: { user: AuthUser | null; clerkUserId: string | null; resolved: boolean }) {
  authState.user = params.user;
  authState.error = null;
  authState.loading = !params.resolved;
  authFetchedAt = params.user ? Date.now() : 0;
  cachedClerkUserId = params.clerkUserId;
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

export function AuthUserProvider(props: {
  children: ReactNode;
  initialUser: AuthUser | null;
  initialClerkUserId: string | null;
  resolved?: boolean;
}) {
  const value = useMemo<AuthUserBootstrapValue>(
    () => ({
      initialUser: props.initialUser,
      initialClerkUserId: props.initialClerkUserId,
      resolved: props.resolved ?? true,
    }),
    [props.initialClerkUserId, props.initialUser, props.resolved]
  );

  return <AuthUserBootstrapContext.Provider value={value}>{props.children}</AuthUserBootstrapContext.Provider>;
}

/**
 * Client-side hook to fetch the authenticated user from /api/me
 * This replaces the legacy useUser hook from user-context
 */
export function useAuthUser() {
  const bootstrap = useContext(AuthUserBootstrapContext);
  const disableAuth =
    process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true' ||
    process.env.DISABLE_AUTH === 'true';

  let clerkUser: ReturnType<typeof useUser>['user'] = null;
  let clerkLoaded = disableAuth;
  try {
    const clerk = useUser();
    clerkUser = clerk.user;
    clerkLoaded = clerk.isLoaded;
  } catch {
    // In auth-disabled/dev surfaces there may be no ClerkProvider.
    // Keep hook resilient and rely on /api/me as the source of truth.
    clerkUser = null;
    clerkLoaded = true;
  }
  const [state, setState] = useState<AuthState>(() => {
    if (bootstrap?.resolved) {
      return {
        user: bootstrap.initialUser,
        error: null,
        loading: false,
      };
    }

    return { ...authState };
  });

  useEffect(() => {
    const sync = () => setState({ ...authState });

    if (bootstrap?.resolved) {
      primeAuthState({
        user: bootstrap.initialUser,
        clerkUserId: bootstrap.initialClerkUserId,
        resolved: bootstrap.resolved,
      });
    }

    listeners.add(sync);
    sync();

    if (!bootstrap?.resolved) {
      void fetchAuthUserShared();
    }

    return () => {
      listeners.delete(sync);
    };
  }, [bootstrap]);

  useEffect(() => {
    if (disableAuth) return;
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

'use client';

import { useCallback } from 'react';

type ApiOptions = RequestInit & {
  data?: unknown;
};

type ApiResponse<T> = {
  data: T;
  error: null;
};

/**
 * API Client Hook (Clerk-based)
 * 
 * Security:
 * - No longer uses x-user-id header (REMOVED for security)
 * - Relies on Clerk session cookie for authentication
 * - Server validates requests using Clerk auth tokens
 * 
 * Note: All API calls now require Clerk authentication
 */
export function useApi() {
  const request = useCallback(async <T,>(path: string, options: ApiOptions = {}): Promise<T> => {
    const method = (options.method ?? 'GET').toUpperCase();
    const isGet = method === 'GET';
    const canDedupe = isGet && options.cache !== 'no-store' && options.cache !== 'reload';

    // In-flight request de-duping for GETs.
    // This complements HTTP caching headers (private, short TTL).
    const dedupeKey = canDedupe ? `${method} ${path}` : null;
    if (dedupeKey && inFlightGets.has(dedupeKey)) {
      return (await inFlightGets.get(dedupeKey)!) as T;
    }

    const headers = new Headers(options.headers);

    if (options.data !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    const doFetch = async (): Promise<T> => {
      const response = await fetch(path, {
        ...options,
        method,
        headers,
        body: options.data !== undefined ? JSON.stringify(options.data) : options.body,
        credentials: 'same-origin', // Include Clerk session cookie
      });

      const payload = (await response.json()) as ApiResponse<T> | { error?: { message?: string } };

      if (!response.ok) {
        throw new Error(payload.error?.message ?? 'Request failed');
      }

      return (payload as ApiResponse<T>).data;
    };

    const promise = doFetch();
    if (dedupeKey) {
      inFlightGets.set(dedupeKey, promise);
    }

    try {
      return await promise;
    } finally {
      if (dedupeKey) {
        inFlightGets.delete(dedupeKey);
      }
    }
  }, []);

  return { request };
}

const inFlightGets = new Map<string, Promise<unknown>>();

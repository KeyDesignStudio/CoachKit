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
    const headers = new Headers(options.headers);

    if (options.data !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    const response = await fetch(path, {
      ...options,
      headers,
      body: options.data !== undefined ? JSON.stringify(options.data) : options.body,
      credentials: 'same-origin', // Include Clerk session cookie
    });

    const payload = (await response.json()) as ApiResponse<T> | { error?: { message?: string } };

    if (!response.ok) {
      throw new Error(payload.error?.message ?? 'Request failed');
    }

    return (payload as ApiResponse<T>).data;
  }, []);

  return { request };
}

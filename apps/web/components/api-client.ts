'use client';

import { useCallback } from 'react';

import { useUser } from '@/components/user-context';

type ApiOptions = RequestInit & {
  data?: unknown;
};

type ApiResponse<T> = {
  data: T;
  error: null;
};

export function useApi() {
  const { user } = useUser();

  const request = useCallback(
    async <T,>(path: string, options: ApiOptions = {}): Promise<T> => {
      if (!user.userId) {
        throw new Error('Set an active user first.');
      }

      const headers = new Headers(options.headers);
      headers.set('x-user-id', user.userId);

      if (options.data !== undefined && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }

      const response = await fetch(path, {
        ...options,
        headers,
        body: options.data !== undefined ? JSON.stringify(options.data) : options.body,
      });

      const payload = (await response.json()) as ApiResponse<T> | { error?: { message?: string } };

      if (!response.ok) {
        throw new Error(payload.error?.message ?? 'Request failed');
      }

      return (payload as ApiResponse<T>).data;
    },
    [user.userId]
  );

  return { request };
}

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

/**
 * Client-side hook to fetch the authenticated user from /api/me
 * This replaces the legacy useUser hook from user-context
 */
export function useAuthUser() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchUser() {
      try {
        const response = await fetch('/api/me');
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error?.message || 'Failed to fetch user');
        }

        setUser(data.data.user);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch user'));
      } finally {
        setLoading(false);
      }
    }

    fetchUser();
  }, []);

  return { user, loading, error };
}

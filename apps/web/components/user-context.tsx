'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type UserRoleType = 'COACH' | 'ATHLETE';

export type UserState = {
  userId: string;
  role: UserRoleType;
};

const STORAGE_KEY = 'coachKitUser';
const COOKIE_NAME = 'coachkit-role';
const DEFAULT_STATE: UserState = {
  userId: '',
  role: 'COACH',
};

type UserContextValue = {
  user: UserState;
  setUser: (next: UserState) => void;
};

const UserContext = createContext<UserContextValue | undefined>(undefined);

/**
 * Set a cookie that middleware can read for route protection
 */
function setRoleCookie(role: UserRoleType) {
  if (typeof document === 'undefined') return;
  
  // Set cookie with 30 day expiry
  const expires = new Date();
  expires.setDate(expires.getDate() + 30);
  document.cookie = `${COOKIE_NAME}=${role}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<UserState>(DEFAULT_STATE);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as UserState;

        if (parsed.userId && (parsed.role === 'COACH' || parsed.role === 'ATHLETE')) {
          setUserState(parsed);
          setRoleCookie(parsed.role);
        }
      } catch (error) {
        console.warn('Failed to parse stored user state', error);
      }
    } else {
      // Set default role cookie on first load
      setRoleCookie(DEFAULT_STATE.role);
    }
  }, []);

  const setUser = (next: UserState) => {
    setUserState(next);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setRoleCookie(next.role);
    }
  };

  const value = useMemo(() => ({ user, setUser }), [user]);

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const context = useContext(UserContext);

  if (!context) {
    throw new Error('useUser must be used within a UserProvider');
  }

  return context;
}

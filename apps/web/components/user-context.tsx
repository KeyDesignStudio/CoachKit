'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type UserRoleType = 'COACH' | 'ATHLETE';

export type UserState = {
  userId: string;
  role: UserRoleType;
};

const STORAGE_KEY = 'coachKitUser';
const DEFAULT_STATE: UserState = {
  userId: '',
  role: 'COACH',
};

type UserContextValue = {
  user: UserState;
  setUser: (next: UserState) => void;
};

const UserContext = createContext<UserContextValue | undefined>(undefined);

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
        }
      } catch (error) {
        console.warn('Failed to parse stored user state', error);
      }
    }
  }, []);

  const setUser = (next: UserState) => {
    setUserState(next);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
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

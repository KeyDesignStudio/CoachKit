'use client';

import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'coachkit-theme';

function normalizePreference(raw: string | null | undefined): ThemePreference {
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return 'system';
}

export function readThemePreferenceFromStorage(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    return normalizePreference(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function applyThemePreference(preference: ThemePreference) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;

  if (preference === 'dark') {
    root.dataset.theme = 'dark';
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
    return;
  }

  if (preference === 'light') {
    root.dataset.theme = 'light';
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
    return;
  }

  // system
  root.classList.remove('dark');
  root.style.colorScheme = '';
  try {
    delete (root as any).dataset.theme;
  } catch {
    root.removeAttribute('data-theme');
  }
}

export function writeThemePreferenceToStorage(preference: ThemePreference) {
  if (typeof window === 'undefined') return;
  try {
    if (preference === 'system') {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // ignore
  }
}

export function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>('system');

  useEffect(() => {
    const stored = readThemePreferenceFromStorage();
    setPreference(stored);
    applyThemePreference(stored);
  }, []);

  const setThemePreference = useCallback((next: ThemePreference) => {
    setPreference(next);
    writeThemePreferenceToStorage(next);
    applyThemePreference(next);
  }, []);

  return { preference, setThemePreference };
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/cn';

export type CoachKitThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'coachkit-theme';
const THEME_CHANGE_EVENT = 'coachkit:theme-change';

function isThemeChoice(value: unknown): value is CoachKitThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function applyCoachKitTheme(choice: CoachKitThemeChoice) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  if (choice === 'system') {
    root.removeAttribute('data-theme');
    return;
  }

  root.setAttribute('data-theme', choice);
}

export function readCoachKitThemeFromStorage(): CoachKitThemeChoice {
  if (typeof window === 'undefined') return 'system';

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isThemeChoice(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

export function ThemeSelector({ className }: { className?: string }) {
  const [choice, setChoice] = useState<CoachKitThemeChoice>('system');

  useEffect(() => {
    const initial = readCoachKitThemeFromStorage();
    setChoice(initial);
    applyCoachKitTheme(initial);
  }, []);

  const options = useMemo(
    () =>
      [
        { value: 'system' as const, label: 'System' },
        { value: 'light' as const, label: 'Light' },
        { value: 'dark' as const, label: 'Dark' },
      ] satisfies Array<{ value: CoachKitThemeChoice; label: string }>,
    []
  );

  const setTheme = useCallback((next: CoachKitThemeChoice) => {
    setChoice(next);

    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }

    applyCoachKitTheme(next);

    try {
      window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    } catch {
      // ignore
    }
  }, []);

  return (
    <div className={cn('flex w-full max-w-[420px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-1', className)}>
      {options.map((opt) => {
        const active = choice === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setTheme(opt.value)}
            aria-pressed={active}
            className={cn(
              'flex-1 min-h-[44px] rounded-xl px-3 text-sm font-medium transition-colors',
              active ? 'bg-[var(--bg-card)] text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

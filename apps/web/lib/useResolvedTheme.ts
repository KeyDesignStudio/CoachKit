'use client';

import { useSyncExternalStore } from 'react';

export type ResolvedTheme = 'light' | 'dark';
export type CoachKitThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'coachkit-theme';
const THEME_CHANGE_EVENT = 'coachkit:theme-change';

function isThemeChoice(value: unknown): value is CoachKitThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark';
}

function readChoiceFromStorage(): CoachKitThemeChoice {
  if (typeof window === 'undefined') return 'system';

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isThemeChoice(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

function readResolvedThemeFromDomOrSystem(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 'light';

  // If data-theme is explicitly set, treat it as authoritative.
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;

  const choice = readChoiceFromStorage();
  if (choice === 'light' || choice === 'dark') return choice;

  const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
  return mql?.matches ? 'dark' : 'light';
}

let initialized = false;
let currentTheme: ResolvedTheme = 'light';
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function refresh() {
  const next = readResolvedThemeFromDomOrSystem();
  if (next === currentTheme) return;
  currentTheme = next;
  notify();
}

function init() {
  if (initialized) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  initialized = true;
  currentTheme = readResolvedThemeFromDomOrSystem();

  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) refresh();
  });

  window.addEventListener(THEME_CHANGE_EVENT, refresh);

  const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
  mql?.addEventListener?.('change', refresh);

  // Covers pre-hydration init script + any future attribute changes.
  const observer = new MutationObserver(() => refresh());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

function subscribe(listener: () => void) {
  init();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ResolvedTheme {
  init();
  return currentTheme;
}

function getServerSnapshot(): ResolvedTheme {
  return 'light';
}

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

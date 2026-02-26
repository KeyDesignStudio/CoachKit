// Centralized discipline color theme for glass UI
// Used by both calendar WorkoutCard and review board ReviewChip

import type { IconName } from './iconRegistry';

export type DisciplineKey = 'RUN' | 'BIKE' | 'SWIM' | 'BRICK' | 'STRENGTH' | 'REST' | 'OTHER';

export type DisciplineTheme = {
  accentClass: string; // Left border color
  bgClass: string; // Subtle background tint
  textClass: string; // Badge text color
  badgeText: string; // Short label for badge
  iconName: IconName; // Icon key from registry
};

export const DISCIPLINE_THEMES: Record<DisciplineKey, DisciplineTheme> = {
  RUN: {
    accentClass: 'border-l-blue-400/60',
    bgClass: 'bg-blue-50/30',
    textClass: 'text-blue-700',
    badgeText: 'RUN',
    iconName: 'disciplineRun',
  },
  BIKE: {
    accentClass: 'border-l-emerald-400/60',
    bgClass: 'bg-emerald-50/30',
    textClass: 'text-emerald-700',
    badgeText: 'BIKE',
    iconName: 'disciplineBike',
  },
  SWIM: {
    accentClass: 'border-l-cyan-400/60',
    bgClass: 'bg-cyan-50/30',
    textClass: 'text-cyan-700',
    badgeText: 'SWIM',
    iconName: 'disciplineSwim',
  },
  BRICK: {
    accentClass: 'border-l-purple-400/60',
    bgClass: 'bg-purple-50/30',
    textClass: 'text-purple-700',
    badgeText: 'BRICK',
    iconName: 'disciplineBrick',
  },
  STRENGTH: {
    accentClass: 'border-l-orange-400/60',
    bgClass: 'bg-orange-50/30',
    textClass: 'text-orange-700',
    badgeText: 'STR',
    iconName: 'disciplineStrength',
  },
  REST: {
    accentClass: 'border-l-slate-400/60',
    bgClass: 'bg-slate-50/30',
    textClass: 'text-slate-700',
    badgeText: 'REST',
    iconName: 'disciplineRest',
  },
  OTHER: {
    accentClass: 'border-l-pink-400/60',
    bgClass: 'bg-pink-50/30',
    textClass: 'text-pink-700',
    badgeText: 'OTHER',
    iconName: 'favorite',
  },
};

export function getDisciplineTheme(discipline: string | undefined | null): DisciplineTheme {
  if (!discipline) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[disciplineTheme] Received null/undefined discipline, falling back to OTHER');
    }
    return DISCIPLINE_THEMES.OTHER;
  }
  
  const normalized = discipline.toUpperCase() as DisciplineKey;
  const theme = DISCIPLINE_THEMES[normalized] || DISCIPLINE_THEMES.OTHER;
  
  // Dev-time regression guard: warn if expected discipline falls back to OTHER
  if (process.env.NODE_ENV === 'development' && theme === DISCIPLINE_THEMES.OTHER && normalized !== 'OTHER') {
    console.warn(`[disciplineTheme] Unknown discipline "${discipline}" (normalized: "${normalized}"), falling back to OTHER icon`);
  }
  
  return theme;
}

import type { IconName } from './iconRegistry';

type BlockIconMap = Record<string, IconName>;

const BLOCK_ICON_MAP: BlockIconMap = {
  'training request': 'idea',
  'confirm athlete snapshot': 'info',
  'athlete snapshot': 'info',
  'block setup': 'planned',
  'block blueprint': 'planned',
  'weekly plan review': 'needsReview',
  'week-by-week draft review': 'needsReview',
  'preview & edit weekly plan': 'needsReview',
  'approve & schedule': 'reviewed',
  'approve and publish': 'reviewed',
  'approve and schedule': 'reviewed',
  'workout plan': 'planned',
  'weather conditions': 'weatherPartlyCloudy',
  'workout status': 'completed',
  'needs your attention': 'warning',
  'make your selection': 'filter',
  'planned vs completed': 'planned',
  calories: 'nutrition',
  'strava vitals': 'strava',
  'athlete strava vitals': 'strava',
  'squad strava vitals': 'strava',
  'review inbox': 'needsReview',
  'event countdown': 'today',
  mailbox: 'inbox',
  'calendar sync': 'calendarAddOn',
  'other device connectors beta': 'link',
  'sync issues and reconciliation': 'warning',
  appearance: 'settings',
  timezone: 'today',
  'weather location': 'weatherPartlyCloudy',
  strava: 'link',
  'add workout': 'scheduleAdd',
  'confirm & log': 'completed',
  'log activity': 'completed',
  ask: 'chat',
  'thanks you re all set': 'reviewed',
};

function normalizeBlockTitle(input: string): string {
  return String(input)
    .toLowerCase()
    .replace(/^\s*\d+\)\s*/g, '')
    .replace(/[&/]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getBlockIconForTitle(title?: string | null): IconName | null {
  const key = normalizeBlockTitle(String(title ?? ''));
  if (!key) return null;
  return BLOCK_ICON_MAP[key] ?? null;
}

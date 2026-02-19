#!/usr/bin/env node

const baseUrl = process.env.COACHKIT_BASE_URL || process.env.APP_BASE_URL;
const cronSecret = process.env.CRON_SECRET || process.env.COACHKIT_CRON_SECRET;
const provider = (process.env.PROVIDER || 'STRAVA').toUpperCase();
const forceDays = process.env.FORCE_DAYS || '3';
const athleteId = process.env.ATHLETE_ID || '';

if (!baseUrl) {
  console.error('[external-sync-backfill] Missing COACHKIT_BASE_URL or APP_BASE_URL');
  process.exit(1);
}

if (!cronSecret) {
  console.error('[external-sync-backfill] Missing CRON_SECRET or COACHKIT_CRON_SECRET');
  process.exit(1);
}

if (provider !== 'STRAVA') {
  console.error(`[external-sync-backfill] Provider ${provider} is not wired yet. Use PROVIDER=STRAVA.`);
  process.exit(1);
}

const params = new URLSearchParams();
params.set('mode', 'backfill');
params.set('forceDays', forceDays);
if (athleteId) params.set('athleteId', athleteId);

const endpoint = `${baseUrl.replace(/\/$/, '')}/api/integrations/strava/cron?${params.toString()}`;

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'x-cron-secret': cronSecret,
  },
});

const text = await response.text();

if (!response.ok) {
  console.error('[external-sync-backfill] Request failed', {
    status: response.status,
    body: text.slice(0, 1000),
  });
  process.exit(1);
}

console.log('[external-sync-backfill] success', text.slice(0, 2000));

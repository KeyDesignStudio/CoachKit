# STRAVA time smoke test

Goal: verify that STRAVA-synced sessions show consistent *actual* start times across Athlete calendar (week + month) and session detail, and that dev debug output is strictly non-production and opt-in.

## Setup
1) Set `NEXT_PUBLIC_DEBUG_STRAVA_TIME=true` in your local `.env.local`.
2) Restart `npm run dev`.

## Checklist
1) Open `/athlete/calendar` and check both views:
   - Week view
   - Month view
2) Identify a STRAVA-synced session that previously showed an incorrect time (e.g., early-morning when the ride was afternoon).
3) Click into the same session’s detail page and confirm “Actual start time (from Strava)” matches what the calendar shows *after re-poll*.
4) Trigger a backfill poll:
   - `POST /api/integrations/strava/poll?forceDays=14`
5) Reload `/athlete/calendar` and confirm the browser console prints `[strava-time]` entries that include:
   - `athleteTimezone`
   - `stravaStartDateUtcRaw`
   - `effectiveStartTimeUtc`
   - `formattedLocalTime`
6) Confirm calendar time == detail time for 3 sample sessions:
   - 1 session that was previously wrong
   - 2 normal sessions
7) Turn debug off:
   - Remove or set `NEXT_PUBLIC_DEBUG_STRAVA_TIME=false`
   - Restart dev server
   - Confirm there are no `[strava-time]` console logs
   - Confirm API responses do **not** include `debugTime` (e.g., check `/api/athlete/calendar?...` and `/api/athlete/calendar-items/:id`).

## Production guardrail
- `debugTime` and `[strava-time]` logs must never appear when `NODE_ENV=production`, regardless of environment variables.

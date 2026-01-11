# Strava troubleshooting

## A) Overview
Strava activity times are deceptively tricky because Strava returns **two** different time fields:
- `start_date`: an ISO timestamp representing the **UTC instant** when the activity started.
- `start_date_local`: an ISO-like timestamp representing the athlete’s **local wall-clock** time.

Common failure modes:
- Treating `start_date_local` as if it were UTC (shifts the displayed time by the athlete’s offset).
- Legacy database rows created before canonical rules existed (older ingests may have stored an incorrect `startTime`).
- Assuming the browser timezone is authoritative (it is not—`User.timezone` is).

These issues are subtle because the data “looks right” (valid ISO strings) while still representing the wrong instant.

## B) Canonical Time Rules
**Authoritative timestamp (Strava):**
- The canonical start instant for Strava-synced completions is `metricsJson.strava.startDateUtc` (derived from Strava `start_date`).

**How APIs derive the effective actual start time:**
- For STRAVA completions: `effectiveStartTimeUtc = metricsJson.strava.startDateUtc` (if valid), else fall back to stored `startTime`.
- For MANUAL completions: `effectiveStartTimeUtc = startTime`.

**How calendar + detail views display time:**
- Calendar and detail views should display the same effective timestamp for the same completion.
- Displayed time is produced by formatting the UTC instant into the athlete’s timezone.

**Timezone source of truth:**
- `User.timezone` is the source of truth for display and day-boundary logic.
- Browser timezone should not be treated as authoritative.

## C) Debug Mode (DEV ONLY)
Debug mode exists purely for diagnosing Strava time mismatches during development.

**Enable:**
- Set `NEXT_PUBLIC_DEBUG_STRAVA_TIME=true` in `.env.local` and restart the dev server.

**What appears when enabled:**
- APIs may include a dev-only debug object under:
  - `latestCompletedActivity.debug.stravaTime` (calendar)
  - `item.completedActivities[0].debug.stravaTime` (detail)

Typical fields:
- `tzUsed`
- `stravaStartDateUtcRaw`
- `stravaStartDateLocalRaw`
- `storedStartTimeUtc`

**Where to inspect:**
- API JSON: `/api/athlete/calendar?...` and `/api/athlete/calendar-items/:itemId`
- Browser console: `[strava-time]` logs (throttled)

**Production guarantee:**
- Debug is guarded exclusively by `isStravaTimeDebugEnabled()` and it always returns `false` in production.
- This debug mode never runs in production and must not be relied on for any feature behavior.

## Production safety verification
Verified in code:
- `isStravaTimeDebugEnabled()` checks `NODE_ENV !== "production"`, so it is always `false` in production builds.
- All Strava time debug JSON and `[strava-time]` console logs are guarded by `isStravaTimeDebugEnabled()`.
- UI display logic uses canonical timestamps and timezone formatting; it never depends on debug-only fields.

## D) Backfill / Self-Heal
When legacy rows have incorrect timestamps, a backfill poll can re-fetch activities and overwrite canonical fields.

**How it works:**
- `POST /api/integrations/strava/poll?forceDays=N`
- The poll fetches recent activities in the last `N` days and upserts completions idempotently.

**When to use:**
- Only when diagnosing or correcting known recent mismatches.

**Safety constraints:**
- `forceDays` is clamped to a safe range (1..30).
- No surprise extra Strava calls should happen unless `forceDays` is explicitly provided.

## E) Validation Checklist
Use this to confirm the system is behaving correctly:
1) Identify a session that previously displayed the wrong time.
2) Trigger backfill: `POST /api/integrations/strava/poll?forceDays=14`.
3) Confirm the calendar time matches the detail time for at least 3 sessions.
4) In debug mode, confirm:
   - `stravaStartDateUtcRaw` is present
   - `effectiveStartTimeUtc` is consistent across calendar + detail
   - `formattedLocalTime` matches what the UI displays

**What “correct” looks like:**
- The same session shows the same “Actual start time (from Strava)” on the detail page and in both calendar views.
- Times match the athlete’s expected local time when formatted using `User.timezone`.

# Prisma scripts (dev/test)

These scripts are **DEV/TEST ONLY** and can modify real data.

## reset-athlete1-foundation-rides

Resets Athlete 1’s planned sessions to a daily BIKE plan for Strava matching tests.

**What it does**
  - title: `Foundation Indoor Ride`
  - `plannedStartTimeLocal`: `16:00`
  - `plannedDurationMinutes`: `60`
  - status: `PLANNED`
  - `2025-12-22`
  - `2025-12-29`
  - `2026-01-05`

**WARNING**

**Run (from repo root)**
```bash
cd /Volumes/DockSSD/Projects/CoachKit
export DATABASE_URL='postgresql://...'

npx --prefix apps/web ts-node --project apps/web/tsconfig.prisma.json \
  apps/web/prisma/scripts/reset-athlete1-foundation-rides.ts
```

After running, re-run Strava poll and check matching:

## reset-athlete1-strava-draft-test-range.ts

Resets Athlete 1 for end-to-end testing of the Strava **draft until athlete confirms** workflow.

What it does:
- Deletes Athlete 1 calendar items in a fixed date range
- Sets any STRAVA `CompletedActivity` rows in that time window back to an **unlinked + unconfirmed** state (`calendarItemId = null`, `confirmedAt = null`)
- Recreates one planned BIKE workout per day and publishes the covering plan weeks
- Clears `StravaConnection.lastSyncAt` so the next poll re-processes activities

Fixed parameters:
- athleteId: `user-athlete-one`
- coachId: `user-coach-multisport`
- date range (inclusive): `2025-12-26` to `2026-01-08`

What it does **not** do:
- Does not delete any `CompletedActivity` rows
- Does not modify athlete notes/pain (`notes`, `painFlag`) or existing Strava metadata (`metricsJson`)

**Run (from repo root)**

```bash
cd /Volumes/DockSSD/Projects/CoachKit
export DATABASE_URL='postgresql://...'
export CONFIRM_RESET='YES'

npx --prefix apps/web ts-node --project apps/web/tsconfig.prisma.json \
  apps/web/prisma/scripts/reset-athlete1-strava-draft-test-range.ts
```

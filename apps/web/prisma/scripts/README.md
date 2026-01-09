# Prisma scripts (dev/test)

These scripts are **DEV/TEST ONLY** and can modify real data.

## reset-athlete1-foundation-rides

Resets Athlete 1’s planned sessions to a daily BIKE plan for Strava matching tests.

**What it does**
- Deletes `CalendarItem` rows for athlete `user-athlete-one` under coach `user-coach-multisport` within `2025-12-26` → `2026-01-08`.
- Inserts one planned BIKE ride per day:
  - title: `Foundation Indoor Ride`
  - `plannedStartTimeLocal`: `16:00`
  - `plannedDurationMinutes`: `60`
  - status: `PLANNED`
- Upserts + publishes `PlanWeek` for week starts:
  - `2025-12-22`
  - `2025-12-29`
  - `2026-01-05`
- Clears `StravaConnection.lastSyncAt` for Athlete 1 to force the next poll to re-fetch and attempt matching.

**WARNING**
- This **will modify whichever database** your `DATABASE_URL` points to.
- Do not run this unless you are intentionally targeting the correct environment.

**Run (from repo root)**
```bash
cd /Volumes/DockSSD/Projects/CoachKit
export DATABASE_URL='postgresql://...'

npx --prefix apps/web ts-node --project apps/web/tsconfig.prisma.json \
  apps/web/prisma/scripts/reset-athlete1-foundation-rides.ts
```

After running, re-run Strava poll and check matching:
- `POST /api/integrations/strava/poll?athleteId=user-athlete-one`

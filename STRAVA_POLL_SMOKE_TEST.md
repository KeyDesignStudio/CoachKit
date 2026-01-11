# Strava Poll Sync - Smoke Test Steps

## Prereqs
- Strava connect flow works (see `STRAVA_CONNECT_SMOKE_TEST.md`)
- Database migrated to include polling idempotency fields:
  - `CompletedActivity.externalProvider`
  - `CompletedActivity.externalActivityId`
  - Unique index on `(source, externalActivityId)`
  - `StravaConnection.lastSyncAt`

## What this does
- Calls Strava once per athlete to list recent activities
- Upserts `CompletedActivity` with `source=STRAVA` using `(source, externalActivityId)` idempotency
- Attempts to match each activity to a planned `CalendarItem` (same discipline, same day, closest `plannedStartTimeLocal`)
- Marks matched `CalendarItem.status = COMPLETED_SYNCED_DRAFT` (only if it was `PLANNED` or `MODIFIED`)
- Athlete must confirm to transition to `COMPLETED_SYNCED` (coach-visible)

## Endpoint
- `POST /api/integrations/strava/poll`
- Coach can scope to one athlete:
  - `POST /api/integrations/strava/poll?athleteId=<athleteUserId>`

Response shape:
- `{ data: { polledAthletes, fetched, created, updated, matched, skippedExisting, errors }, error: null }`

## Setup
1. Start dev server: `npm run dev` (from `apps/web`)
2. Ensure the athlete has connected Strava in `/athlete/settings`
3. Ensure the athlete has at least one planned session on the same day/time as a Strava activity (to verify matching)

## Test 1: Athlete poll
**Expected**: Creates/upserts completions and (when possible) marks planned items as `COMPLETED_SYNCED_DRAFT`.

**Steps**:
1. Login as the athlete
2. Navigate to `/athlete/settings` and press **Sync now** in the Strava card
3. **Verify**: The success panel shows non-zero `Fetched` when there is recent Strava activity
4. **Verify**: `Created + Updated + Skipped` is non-zero if the athlete has recent Strava activity
5. **Verify (matching)**: Navigate to `/athlete/calendar` and confirm any matched planned session shows a pending/Strava-detected state
6. **Verify (confirm)**: Open the workout detail and press **Confirm** to transition to `COMPLETED_SYNCED`

## Test 2: Idempotency (re-run)
**Expected**: Re-running does not create duplicates.

**Steps**:
1. Press **Sync now** again immediately
2. **Verify**: `Created` is `0` (or very low) and `Skipped` increases
3. **Verify**: No duplicate `CompletedActivity` rows for the same Strava activity

## Test 3: Coach poll (optional)
**Expected**: Coach can poll all connected athletes, or a single athlete they own.

**Steps**:
1. Login as a coach
2. POST the poll endpoint:
   - All connected athletes under this coach:
     - `fetch('/api/integrations/strava/poll', { method: 'POST' }).then(r => r.json()).then(console.log)`
   - Single athlete (must belong to coach):
     - `fetch('/api/integrations/strava/poll?athleteId=<athleteUserId>', { method: 'POST' }).then(r => r.json()).then(console.log)`
3. **Verify**: `data.polledAthletes` matches the number of polled athletes

## Notes
- The poll uses a small safety buffer and a watermark (`StravaConnection.lastSyncAt`) to reduce repeat imports.
- If Strava rate limits (`429`), the response will include an error entry and stop early.

## Success Criteria
- ✅ Poll endpoint works for athlete and coach
- ✅ Idempotent under retries (no duplicates)
- ✅ Matched planned items become `COMPLETED_SYNCED_DRAFT` and only become `COMPLETED_SYNCED` after athlete confirms
- ✅ No tokens are exposed to the browser

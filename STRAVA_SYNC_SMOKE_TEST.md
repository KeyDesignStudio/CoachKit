# Strava sync smoke test (production)

Goal: validate Strava **From Strava** fields + **draft until athlete confirms** behavior using the production DB.

## Preconditions
- Athlete 1 is connected to Strava in CoachKit.
- `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` are configured server-side.

## Smoke steps
1) As Athlete 1, open `/athlete/settings`.
2) In the Strava card, press **Sync now**.
   - Expect: a green “Strava sync complete” panel with counts (`Fetched`, `Matched`, `Created`, `Updated`, `Skipped`, `Errors`).
   - Note: Sync uses `forceDays=14` so it re-fetches the last 14 days safely and relies on idempotency to avoid duplicates.
3) As Athlete 1, open an activity that was synced from Strava (calendar/workout detail).
   - Expect: a **From Strava** card showing start time and available fields (type/name/speed/HR as applicable).
4) Unplanned activity visibility (trust fix):
   - In Strava, record an ad-hoc activity that has no matching planned session in CoachKit (e.g., create it on a day/time with no planned workout).
   - Run **Sync now** again.
   - Expect: the activity appears as its own calendar entry with an "(unscheduled)" suffix (internally a CalendarItem with `origin=STRAVA`, `planningStatus=UNPLANNED`).
   - Expect: no Strava activity is silently dropped even when matching fails.
4) Draft workflow validation:
   - After sync, the matched planned item should show as “Strava detected / pending” (internally `COMPLETED_SYNCED_DRAFT`).
   - As Coach, verify the completion is **not** visible for review yet.
5) As Athlete 1, confirm the synced completion (add notes/pain as desired).
   - Expect: item becomes fully completed (internally `COMPLETED_SYNCED`).
6) As Coach, verify the confirmed completion is now visible for review and includes athlete notes/pain.
7) Delete + resync self-heal:
   - As Athlete 1, delete the unplanned Strava calendar entry.
   - Run **Sync now** again.
   - Expect: the calendar entry reappears (idempotent per Strava activity; no duplicates).

## Safety notes
- This flow does **not** reset/detach planned sessions.
- Tokens never go to the browser; the client only sees summary counts.

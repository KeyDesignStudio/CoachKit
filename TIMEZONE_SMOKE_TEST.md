# TIMEZONE Smoke Test

Date: 2026-01-11

## Preconditions
- You have at least one athlete user and one coach user.
- The athlete has at least one Strava-synced completion with a known UTC start time (example: 16:48 in Australia/Brisbane).
- There is at least one planned workout for “today” (athlete-local) that is not completed.

## Case 1 — Athlete timezone = Australia/Brisbane
1) As the athlete, go to /athlete/settings.
2) Set **Timezone** to **Australia – Brisbane (AEST)**.
3) Open /athlete/calendar.
4) Verify the Strava-completed item shows **16:48** (or expected local time) anywhere a time is shown:
   - Week rows
   - Month tiles
5) Open the workout detail page for the same item.
6) Verify:
   - “Actual start time (from Strava)” matches **16:48**
   - Any other displayed times are consistent with the calendar.

## Case 2 — Switch athlete timezone to America/Los_Angeles
1) As the athlete, go to /athlete/settings.
2) Set **Timezone** to **United States – Los Angeles (PT)**.
3) Return to /athlete/calendar.
4) Verify the same Strava completion time is converted everywhere consistently:
   - Week rows
   - Month tiles
   - Workout detail

## Case 3 — Missed logic uses athlete local midnight
1) As the athlete, set timezone to a timezone that is very different from your machine’s local timezone (e.g. America/Los_Angeles).
2) Ensure a planned workout exists for “today” in the athlete’s timezone.
3) Before athlete-local midnight:
   - Verify the session is **not** marked missed.
4) After athlete-local midnight (or by temporarily setting timezone to one where “today” differs):
   - Verify the session becomes **missed** only when the athlete’s local day has ended.

## Case 4 — Coach timezone differs from athlete
1) As the coach, go to /coach/settings.
2) Set coach timezone to **United Kingdom – London (GMT/BST)**.
3) Open coach pages that show times.
4) Verify coach-visible times are shown in the coach timezone.
5) As the athlete, verify athlete pages still render times in the athlete timezone.

## Notes
- Strava timestamps remain stored canonically in UTC; UI formatting converts using User.timezone.
- Timezone validation only allows selecting from the curated TIMEZONE_OPTIONS list.

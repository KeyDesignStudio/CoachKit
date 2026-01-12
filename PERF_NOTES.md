# Performance Notes

## Phase 1 (Coach Calendar + Coach Dashboard)

### Goals
- Render an immediate UI frame (no blank/white screen) using skeletons.
- Parallelize/limit client fetch fan-out for stacked mode.
- Add safe, short-lived per-user caching for read-heavy coach APIs.
- Add dev-only performance marks to measure frame→data time.

## Implemented

### Skeleton UI
- `/coach/calendar`: shows week/month skeletons while loading; header renders immediately.
- `/coach/dashboard`: shows list skeleton (default) or month-grid skeleton while loading; header renders immediately.

### Parallel fetch + concurrency limiting
- `/coach/calendar` single-athlete mode:
  - Fetches calendar items and plan weeks in parallel.
  - Plan-weeks is treated as *auxiliary* (if it fails, calendar items still render).
- `/coach/calendar` stacked mode:
  - Multi-athlete calendar fetch is concurrency-limited (currently 5) to avoid request storms.

### Safe caching (coach APIs)
These routes set `Cache-Control: private` with a short TTL (plus `stale-while-revalidate`) and `Vary: Cookie`.

- `GET /api/coach/calendar`: `max-age=30`, `stale-while-revalidate=60`
- `GET /api/coach/plan-weeks`: `max-age=30`, `stale-while-revalidate=60`
- `GET /api/coach/review-inbox`: `max-age=30`, `stale-while-revalidate=60`
- `GET /api/coach/athletes`: `max-age=60`, `stale-while-revalidate=120`

Notes:
- This is *per-user* caching (browser/private caches only). It does not rely on shared/CDN caching.
- Cache keys naturally include query params (e.g. date ranges).

### Refresh bypass
- Coach dashboard Refresh appends a cache-busting query param (`?t=...`) and uses `fetch` with `cache: 'no-store'`.

### Client request de-duping
- `useApi()` de-dupes in-flight GET requests per component instance (same URL) to prevent duplicate concurrent GETs.
- Any request using `cache: 'no-store'` / `cache: 'reload'` bypasses de-dupe.

### Dev-only perf marks
- `/coach/calendar`: measures `coach-calendar-load` from `coach-calendar-frame` → `coach-calendar-data`.
- `/coach/dashboard`: measures `coach-dashboard-load` from `coach-dashboard-frame` → `coach-dashboard-data`.

## Next (Phase 2)
- Apply the same skeleton + parallel fetch + caching pattern to `/athlete/calendar` and `/athlete/workouts/[id]`.

## Phase 2 (Athlete Calendar + Athlete Workout Detail)

### Skeleton UI
- `/athlete/calendar`: week + month skeleton grids (no blank state while auth/data loads).
- `/athlete/workouts/[id]`: skeleton cards for header/Strava block/log/form actions.

### Parallel fetch
- `GET /api/athlete/calendar`: athlete profile + calendar items are fetched in parallel.
- `GET /api/athlete/calendar-items/[itemId]`: base item + comments + completed activity are fetched in parallel.

### Safe caching (athlete GET APIs)
These routes set `Cache-Control: private` with a short TTL (plus `stale-while-revalidate`) and `Vary: Cookie`.

- `GET /api/athlete/calendar`: `max-age=30`, `stale-while-revalidate=60`
- `GET /api/athlete/calendar-items/[itemId]`: `max-age=30`, `stale-while-revalidate=60`

### Refresh hard-bypass
- `/athlete/calendar` Refresh uses `?t=...` + `fetch` with `cache: 'no-store'`.
- Action endpoints (complete/confirm/skip) re-fetch workout detail with the same hard-bypass so the UI updates immediately.

### Dev-only perf marks
- `/athlete/calendar`: measures `athlete-calendar-load` (frame → first data).
- `/athlete/workouts/[id]`: measures `athlete-workout-load` (frame → first data).

### How to test
- Run: `cd apps/web && NEXT_PUBLIC_SHOW_DEV_PAGES=true npm run dev -- -p 3000`
- Open:
  - `/athlete/calendar` and toggle Week/Month while watching for immediate frame + skeleton.
  - `/athlete/workouts/[id]` (pick any existing item) and confirm skeleton shows immediately on navigation.
  - Use Refresh on athlete calendar and confirm it refetches (should not be satisfied by cache).

### What “good” looks like
- Page frame renders immediately (header + controls) with skeletons in place.
- Changing week/month or navigating prev/next shows skeleton quickly without layout shifts.
- Refresh forces a network re-fetch (cache bypass) and does not get stuck behind in-flight dedupe.
- DevTools `performance` entries include the `*-load` measures (dev-only).

# Workout Library (Triathlon / Multisport)


## Rollout Notes

- No feature flags required.
- Rollout includes Prisma migration `20260116124208_workout_detail_fields`.
- Post-merge, ensure the deploy pipeline runs migrations (e.g. `prisma migrate deploy`).
  - No retroactive mutation of existing `CalendarItem` history.
- Keep existing auth/Strava/calendar behavior unchanged.

## Non-Goals
- This is not an athlete activity history store.
- This does not import or store raw Kaggle datasets in-repo.

---

## Data Model

### `WorkoutLibrarySession`
Represents a reusable workout template (not tied to an athlete).

Fields:
- `id`: `cuid()` or `uuid`
- `title`: string
- `discipline`: enum (`RUN`, `BIKE`, `SWIM`, `BRICK`, `STRENGTH`, `OTHER`)
- `tags`: string[]
- `description`: string (text)
- `durationSec`: int (stored as `0` when distance-only)
- `intensityTarget`: string
- `distanceMeters?`: float
- `elevationGainMeters?`: float
- `notes?`: string (text)
- `equipment`: string[]
- `workoutStructure?`: JSON (intervals/segments)
- `createdAt`, `updatedAt`
- `createdByUserId?`: string (FK → `User.id`)

Indexes:
- `discipline`
- `title` (for search)
- `tags` (prefer GIN if supported; revisit if schema needs a join table)

### `WorkoutLibraryFavorite`
Per-coach favorites.

Fields:
- `id`
- `coachId` (FK → `User.id`)
- `librarySessionId` (FK → `WorkoutLibrarySession.id`)
- `createdAt`

Constraints:
- Unique `(coachId, librarySessionId)`

### `WorkoutLibraryUsage`
Logs “used” events to enable “most used” sorting later.

Fields:
- `id`
- `coachId` (FK → `User.id`)
- `librarySessionId` (FK → `WorkoutLibrarySession.id`)
- `usedAt`

Index:
- `(librarySessionId, usedAt)`

---

## How Coaches Use the Library

Primary flow:
1) Open Session Builder: `/coach/group-sessions`.
2) Use the **Library** tab to search/filter and preview a workout.
3) Optional: favorite workouts (Favorites tab is a filtered view).
4) Click “Use in Session Builder” to prefill a new Group Session.
5) Create the session, then **Apply** it to athletes/squads.
6) Verify scheduled workouts render rich detail in:
  - Coach Calendar edit drawer (`/coach/calendar`)
  - Athlete workout detail (`/athlete/workouts/[id]`)

Notes:
- Coaches cannot create/edit library sessions; only Admin can.
- Coaches can write per-coach favorites and usage signals.

---

## Scheduling + Workout Detail Persistence

Session Builder creates a `GroupSession`. When it is applied to athletes, Calendar Items are created.

To preserve rich detail:
- `WorkoutLibrarySession` fields are copied into `GroupSession` when injected.
- `GroupSession` fields are copied into `CalendarItem` during apply.
- Coach calendar drawer edits persist on `CalendarItem`.
- Athlete workout detail reads from `CalendarItem`.

---

## API Endpoints

### Coach (read-only)
- `GET /api/coach/workout-library`
  - Query: `q`, `discipline`, `tags`, `durationMin`, `durationMax`, `intensityTarget`, `favoritesOnly`
  - Returns: `items[]` with `isFavorite` and `usageCount`
- `GET /api/coach/workout-library/:id` (full detail)
- `POST /api/coach/workout-library/:id/favorite`
- `DELETE /api/coach/workout-library/:id/favorite`
- `POST /api/coach/workout-library/:id/used`

Caching (planned):
- Coach GET endpoints: `Cache-Control: private, max-age=30` and `Vary: Cookie`.
- No caching for mutation endpoints.

### Admin (CRUD + import)
- `GET/POST /api/admin/workout-library`
- `GET/PATCH/DELETE /api/admin/workout-library/:id`
- `POST /api/admin/workout-library/import`

Validation rules (planned):
- `discipline` required
- `title` required
- `durationSec` OR `distanceMeters` required
- `workoutStructure` must be valid JSON if present

---

## Admin Role Behavior

Definition:
- Admin-only access to `/api/admin/**` routes and `/admin/workout-library` UI.
- Implemented as `UserRole.ADMIN` (Prisma enum).

Rules:
- Coaches without admin permissions must receive 403 for admin routes.
- Admin navigation link is only visible to `ADMIN` users.

Dev note (auth disabled):
- If `DISABLE_AUTH=true`, you must set cookie `coachkit-role=ADMIN` to access admin UI/routes.

---

## Import Workflow

Important: DO NOT commit Kaggle/raw datasets into the repo.

Admin UI import:
- Location: `/admin/workout-library` → Import tab
- Upload `.csv` or `.json`
- Default is **dry-run** validation with per-row errors; import is blocked until errors are fixed.

CSV format:
- Header columns:
  - Required: `title`, `discipline`, `description`, `intensityTarget`
  - Optional: `tags`, `durationSec`, `distanceMeters`, `elevationGainMeters`, `notes`, `equipment`, `workoutStructure`
- `tags` and `equipment` accept comma-separated strings.
- `workoutStructure` accepts JSON text in the cell (or leave blank).

JSON format:
- Either an array of items, or `{ "items": [...] }`.
- Items accept the same keys as above. `tags`/`equipment` can be arrays or comma-separated strings.

Where to place datasets locally:
- Anywhere outside the repo (recommended): `~/Downloads/coachkit-datasets/`.

---

## Smoke Tests (manual)

### Build + tests (Phase guardrail)
- `cd apps/web && npm run build`
- `cd apps/web && npm run test:mobile:neon`

### UI flows (planned later)
- Coach: Session Builder → Library tab → search/filter → preview → favorite → inject.
- Confirm no changes to calendar views and no impact on athlete history.

---

## Phase Notes

### Phase 0
- Branch created: `feature/workout-library`
- This doc added as a living spec.
- No functional code changes in Phase 0.

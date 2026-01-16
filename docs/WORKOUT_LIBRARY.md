# Workout Library (Triathlon / Multisport)

Owner: Agent
Status: Phase 0 (stub)

## Goals
- Provide a curated, searchable library of multisport workout templates (RUN/BIKE/SWIM/BRICK/STRENGTH/OTHER).
- Allow coaches to browse/preview/favorite and inject workouts into **Session Builder** (`/coach/group-sessions`).
- Keep the library **independent from athlete history**:
  - No writes to `CompletedActivity`.
  - No retroactive mutation of existing `CalendarItem` history.
- Keep existing auth/Strava/calendar behavior unchanged.

## Non-Goals
- This is not an athlete activity history store.
- This does not import or store raw Kaggle datasets in-repo.

---

## Data Model (planned)

### `WorkoutLibrarySession`
Represents a reusable workout template (not tied to an athlete).

Fields (Phase 1 target):
- `id`: `cuid()` or `uuid`
- `title`: string
- `discipline`: enum (`RUN`, `BIKE`, `SWIM`, `BRICK`, `STRENGTH`, `OTHER`)
- `tags`: string[]
- `description`: string (text)
- `durationSec`: int
- `intensityTarget`: string
- `distanceMeters?`: float
- `elevationGainMeters?`: float
- `notes?`: string (text)
- `equipment`: string[]
- `workoutStructure?`: JSON (intervals/segments)
- `createdAt`, `updatedAt`
- `createdByUserId?`: string (FK → `User.id`)

Indexes (Phase 1 target):
- `discipline`
- `title` (for search)
- `tags` (prefer GIN if supported; revisit if schema needs a join table)

### `WorkoutLibraryFavorite`
Per-coach favorites.

Fields (Phase 1 target):
- `id`
- `coachId` (FK → `User.id`)
- `librarySessionId` (FK → `WorkoutLibrarySession.id`)
- `createdAt`

Constraints:
- Unique `(coachId, librarySessionId)`

### `WorkoutLibraryUsage`
Logs “used” events to enable “most used” sorting later.

Fields (Phase 1 target):
- `id`
- `coachId` (FK → `User.id`)
- `librarySessionId` (FK → `WorkoutLibrarySession.id`)
- `usedAt`

Index:
- `(librarySessionId, usedAt)`

---

## API Endpoints (planned)

### Coach (read-only)
- `GET /api/coach/workout-library`
  - Query: `q`, `discipline[]`, `tags[]`, `durationMin`, `durationMax`, `intensityTarget`, `page`, `pageSize`
  - Returns: `items[]`, `total`, `favorites` flag per item
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

## Admin Role Behavior (planned)

Definition (Phase 2 initial):
- Admin-only access to `/api/admin/**` routes.
- Implementation options:
  - Prefer: `User.isAdmin` boolean (if it exists or is added).
  - Temporary fallback: allowlist via env var of admin emails/userIds.

Rules:
- Coaches without admin permissions must receive 403 for admin routes.
- No coach navigation link to admin UI by default.

---

## Import Workflow (datasets)

Important: DO NOT commit Kaggle/raw datasets into the repo.

Planned local ingestion scripts:
- Location: `apps/web/prisma/scripts/library-import/`
- Inputs via env vars:
  - `KAGGLE_WORKOUT_DATA_PATH=/absolute/path/to/file.csv|json`
  - `EXERCISE_DB_PATH=/absolute/path/to/free-exercise-db.json`
- Safety:
  - `CONFIRM_LIBRARY_IMPORT=YES` required to write
  - Default `DRY_RUN=true`

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

# Workout Library (Triathlon / Multisport)


## RC1 Checklist (Freeze)

RC1 is approved only when all items below are complete and verified on a non-prod Neon branch.

- [ ] Schema complete (migrations applied; no runtime Prisma errors)
- [ ] Admin UI functional (`/admin/workout-library`: CRUD, import dry-run, import apply confirm, purge drafts)
- [ ] Coach Library usable (`/coach/group-sessions` → Library tab: search/filter, favorites, inject)
- [ ] Injection into Session Builder verified (library → group session prefill)
- [ ] Athlete workout detail renders correctly (`/athlete/workouts/[id]` shows rich detail)
- [ ] Mobile tests green (Neon): `cd apps/web && npm run test:mobile:neon`
- [ ] Dev server stays stable during tests (no crashes). Console warnings are acceptable if the suite is green.

## Known Deferred Items

- (empty)


## Rollout Notes

- No feature flags required.
- Rollout includes Prisma migration `20260116124208_workout_detail_fields`.
- After merging to `main` and before validating production UI, run migrations against Neon PROD (manual):
  - `DATABASE_URL="<NEON_PROD_DATABASE_URL_DIRECT>" npm run migrate:prod`
  - See `docs/DEPLOY_MIGRATIONS.md` for details and expected output.
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

### Import safety rules (guardrails)

These rules are enforced server-side to prevent accidental large or unsafe ingestions:

- Max rows per import request: 500
- Dry-run is supported and should be the default workflow.
- Non-dry-run requires an explicit confirmation flag (`confirmApply`) from the UI.
- All imported sessions are created as `DRAFT` (not visible to coaches).
- Sessions are tagged with a `source` (e.g. `KAGGLE`, `FREE_EXERCISE_DB`, `MANUAL`).
- Imported sessions compute a deterministic `fingerprint` from the workout structure and are deduped:
  - Default behavior is to skip rows whose fingerprint already exists.
  - Import responses include `skippedExistingCount`.

Coach endpoints only return `PUBLISHED` sessions; drafts are hidden from all coach views.

### Free Exercise DB (Phase 1)

This ingestion runs server-side (no dataset committed to the repo) and is Admin-only.

- Dataset source (default): `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json`
- Admin endpoint: `POST /api/admin/workout-library/import/free-exercise-db`
  - Request: `{ dryRun: boolean, confirmApply?: boolean, limit?: number (<=500), offset?: number }`
  - Dry-run is supported and should be the default.
  - Apply requires `confirmApply=true`.
  - Creates `DRAFT` sessions with `source=FREE_EXERCISE_DB`.
  - Uses deterministic `fingerprint` idempotency.
- Admin UI: `/admin/workout-library` → Import tab → “Import (Free Exercise DB)”

Testing note:
- Playwright uses a local fixture via `FREE_EXERCISE_DB_DATA_PATH=tests/fixtures/free-exercise-db-sample.json` to avoid network dependency.

---

### Kaggle (Phase 2)

This ingestion is Admin-only.

- Admin endpoint: `POST /api/admin/workout-library/import/kaggle`
  - Request: `{ dryRun: boolean, confirmApply?: boolean, maxRows?: number (<=2000), offset?: number }`
  - Dry-run is supported and should be the default.
  - Apply requires `confirmApply=true`.
  - Creates `DRAFT` sessions with `source=KAGGLE`.

Dataset configuration (no datasets committed to the repo):

- Vercel Preview/Production: set `KAGGLE_DATA_URL` (see [docs/DEPLOY_ENV.md](docs/DEPLOY_ENV.md)).
- Local/dev/tests: set `KAGGLE_DATA_PATH` to a JSON fixture file.

Observability:

- The runtime logs a single line indicating `Kaggle source = URL` (hostname/path basename only) or `Kaggle source = PATH` (file basename only).
- On failures, the API returns structured errors like `KAGGLE_NOT_CONFIGURED`, `KAGGLE_FETCH_FAILED`, `KAGGLE_PARSE_FAILED` with a `requestId` you can correlate in Vercel logs.

---

## Semantic Mapping Contract (Pre-Ingestion)

These mappings define the canonical values CoachKit expects. Any ingestion pipeline must map source values into these canonical forms before writing sessions.

### Canonical discipline

Canonical enum: `RUN`, `BIKE`, `SWIM`, `BRICK`, `STRENGTH`, `OTHER`.

| Source value examples | Canonical CoachKit value |
|---|---|
| `run`, `running`, `jog`, `treadmill run` | `RUN` |
| `bike`, `cycling`, `ride`, `trainer ride`, `indoor bike` | `BIKE` |
| `swim`, `swimming`, `pool swim`, `open water swim` | `SWIM` |
| `brick`, `bike+run`, `run off bike`, `transition run` | `BRICK` |
| `strength`, `weights`, `gym`, `lift`, `resistance training` | `STRENGTH` |
| anything else / unknown | `OTHER` |

### Canonical intensity

CoachKit stores `intensityTarget` as a free-text string and derives `intensityCategory`.

Canonical categories (for ingestion): `Z1`–`Z5`, `Recovery`, `Tempo`, `Threshold`, `VO2`.

Mapping into stored `intensityCategory`:

| Source value examples | Canonical category | Stored `intensityCategory` |
|---|---|---|
| `Z1`, `Zone 1`, `Easy`, `Recovery` | `Recovery` | `Z1` |
| `Z2`, `Zone 2`, `Endurance` | `Z2` | `Z2` |
| `Z3`, `Zone 3`, `Tempo`, `Sweet Spot` | `Tempo` | `Z3` |
| `Z4`, `Zone 4`, `Threshold`, `FTP` | `Threshold` | `Z4` |
| `Z5`, `Zone 5`, `VO2`, `VO2max` | `VO2` | `Z5` |

If an import source only provides an RPE (e.g. `RPE 7/10`), preserve the full text in `intensityTarget` and leave `intensityCategory` unset (`null`).

### Canonical equipment vocabulary

Canonical equipment values:

- `Bike`
- `Indoor Trainer`
- `Treadmill`
- `Track`
- `Pool`
- `Open Water`
- `Dumbbells`
- `Bands`
- `Kettlebell`
- `RowErg`
- `Other`

| Source value examples | Canonical CoachKit equipment |
|---|---|
| `road bike`, `tt bike`, `tri bike`, `bike` | `Bike` |
| `trainer`, `smart trainer`, `indoor` | `Indoor Trainer` |
| `treadmill`, `TM` | `Treadmill` |
| `track` | `Track` |
| `pool` | `Pool` |
| `open water`, `OWS` | `Open Water` |
| `weights`, `dumbbells` | `Dumbbells` |
| `bands`, `resistance band` | `Bands` |
| `kettlebell`, `KB` | `Kettlebell` |
| `rower`, `erg`, `concept2` | `RowErg` |
| unknown | `Other` |

### Purging draft imports

Admin Maintenance supports purging all draft imports for a source (useful for rollback if a dataset is wrong):

- Location: `/admin/workout-library` → Maintenance
- Action: “Purge draft imports by source”
- Dry-run supported.
- Apply requires confirmation text: `PURGE_<SOURCE>` (e.g. `PURGE_KAGGLE`).

Admin UI import:
- Location: `/admin/workout-library` → Import tab
- Upload `.csv` or `.json`
- Default is **dry-run** validation with per-row errors; import is blocked until errors are fixed.
- You must select a `source`; imports create `DRAFT` sessions.
- To apply (non-dry-run), you must explicitly confirm apply.

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

### Rollback checklist (imports)

If an import was applied and needs to be reverted:

1) Run a dry-run purge for the relevant source to see how many drafts would be deleted.
2) Run the purge apply with the required confirmation text.
3) Re-run coach UI smoke checks and confirm the library contents look correct.

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

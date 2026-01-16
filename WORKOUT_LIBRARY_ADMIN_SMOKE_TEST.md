# Workout Library Admin Smoke Test

## Preconditions
- You have an `ADMIN` user in the database (Prisma `User.role = ADMIN`).
- If running with auth disabled (`DISABLE_AUTH=true`), set cookie `coachkit-role=ADMIN`.

## Guardrails
- `cd apps/web && npm run build`
- `cd apps/web && npm run test:mobile:neon`

## Access Control
1) Sign in as a normal coach (role `COACH`).
- Visit `/admin/workout-library` → should redirect to `/access-denied`.
- Call `GET /api/admin/workout-library` → should be denied.

2) Sign in as an admin (role `ADMIN`).
- Confirm the nav shows an **Admin** link.
- Visit `/admin/workout-library` → should load.

## CRUD
1) Create
- Click **New**.
- Create a session with:
  - title, discipline, description, intensityTarget
  - either `durationSec` OR `distanceMeters`
- Expect it to appear in the list.

2) Edit
- Select the created session.
- Update tags/equipment/notes and save.
- Refresh → changes persist.

3) Delete
- Delete the created session.
- Refresh → it no longer appears.

## Import (CSV)
1) Prepare a small CSV file (2–3 rows) with headers:
- `title,discipline,description,intensityTarget,tags,durationSec,distanceMeters,elevationGainMeters,notes,equipment,workoutStructure`

2) Dry-run
- Upload CSV.
- Click **Validate**.
- Expect: counts + preview + any per-row errors.

3) Import
- Uncheck **Dry run**.
- Click **Import Now**.
- Expect: created count > 0 and sessions appear in the list.

## Import (JSON)
1) Upload JSON as either an array or `{ "items": [...] }`.
2) Validate then import; confirm sessions appear.

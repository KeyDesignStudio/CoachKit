# Workout Library runbook

## Where the data lives

Workout Library items live in the Postgres table `"WorkoutLibrarySession"` (Prisma model: `WorkoutLibrarySession`).

## Prompt Template import (Admin)

Workout Library is populated via the **Prompt Library import** (prompt templates), not via Plan Library.

### Import endpoint

- `POST /api/admin/workout-library/import`
- Creates `DRAFT` sessions by default.
- Idempotent by fingerprint: `sha256(title + discipline + category)`.

### Supported fields

Required (CSV/JSON):

- `title`
- `discipline` (RUN/BIKE/SWIM/BRICK/STRENGTH/OTHER)
- `category`
- `workoutDetail` (stored as `WorkoutLibrarySession.description`)

Optional:

- `tags` (comma-separated)
- `equipment` (comma-separated)

Notes:

- Coaches only see `PUBLISHED` items.
- Admins can publish/unpublish via the admin UI.

## Verification queries (psql)

Count:

```sql
SELECT COUNT(*) FROM "WorkoutLibrarySession";
```

Count by status:

```sql
SELECT status, COUNT(*) FROM "WorkoutLibrarySession" GROUP BY status;
```

Sample:

```sql
SELECT id, title, status, "createdAt" FROM "WorkoutLibrarySession" ORDER BY "createdAt" DESC LIMIT 10;
```

## Diagnostics endpoint

Admin-only:


Returns:

```json
{
  "ok": true,
  "db": { "host": "...", "database": "...", "schema": "..." },
  "counts": {
    "workoutLibrarySessionTotal": 0,
    "published": 0,
    "draft": 0
  },
  "sample": [
    { "id": "...", "title": "...", "status": "PUBLISHED", "createdAt": "..." }
  ]
}
```

Notes:

## Purging legacy Plan-derived templates (Admin)

If older Plan Library imports created `WorkoutLibrarySession` rows, use the admin purge tool (dry-run first) to delete only plan-derived templates.

## Coach list API caching

Coach list endpoint:

- `GET /api/coach/workout-library`

Notes:
- Route is `force-dynamic` and responds with `Cache-Control: no-store`.
- If you need extra server logs, set `DIAG_MODE=1` and watch for structured logs including `requestId`, db info, counts, and the first 3 IDs.

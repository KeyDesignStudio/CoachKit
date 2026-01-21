# Workout Library runbook

## Where the data lives

Workout Library items live in the Postgres table `"WorkoutLibrarySession"` (Prisma model: `WorkoutLibrarySession`).

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

- `GET /api/admin/diagnostics/workout-library`

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
- The response never includes `DATABASE_URL` (secrets). Only safe host/database/schema info.
- All responses are `Cache-Control: no-store`.

## Coach list API caching

Coach list endpoint:

- `GET /api/coach/workout-library`

Notes:
- Route is `force-dynamic` and responds with `Cache-Control: no-store`.
- If you need extra server logs, set `DIAG_MODE=1` and watch for structured logs including `requestId`, db info, counts, and the first 3 IDs.

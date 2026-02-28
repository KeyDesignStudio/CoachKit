# Future Self Engine V1 - Technical Notes

## DB schema
- `AthleteTwin`
  - one row per athlete (`athleteId` PK)
  - stores sport profile, baseline metrics, rolling metrics, data quality, last input metadata
  - `modelVersion` stored for explainability and reproducibility
- `ProjectionSnapshot`
  - immutable projection run records
  - stores scenario knobs, selected horizon, outputs, assumptions, confidence, and panel visibility
  - indexed by athlete + creation time for fast latest lookup
- `AthleteCheckin`
  - dated athlete check-ins for weight/waist/sleep/stress notes

Migration:
- `apps/web/prisma/migrations/20260227183000_future_self_engine_v1/migration.sql`

## API endpoints
- `POST /api/projections/run`
  - coach-owned action
  - input: `athlete_id`, `horizon_weeks`, `scenario`, `visibility`
  - output: created snapshot payload
- `GET /api/projections/latest?athlete_id=`
  - coach/admin: must pass `athlete_id`
  - athlete: resolves own athlete id and applies visibility filtering
- `POST /api/projections/visibility`
  - coach toggles panel visibility for athlete-facing view
- `POST /api/twin/recompute`
  - recomputes athlete twin state on demand

## Modelling rules (V1)
- Explainable only; no black-box AI
- Training load proxy:
  - duration × bounded intensity factor (RPE-adjusted when available)
- Performance:
  - running and cycling derived from recent completed activities
  - conservative bounded improvement curve using scenario knobs and recent load trend
- Body trend:
  - check-in linear trend with safe weekly clamp
- Confidence:
  - A/B/C based on history length, benchmark availability, and recent data density
- All outputs include assumptions + confidence + disclaimer

## Confidence scoring rules
- A: 12+ week history, recent benchmark, high data consistency
- B: 6+ week history with partial benchmark/consistency
- C: sparse data, directional only

## UI surfaces
- Coach:
  - `/coach/athletes/[athleteId]/future-self`
  - scenario knobs, run action, panel visibility toggles, share-ready card
- Athlete:
  - `/athlete/future-self`
  - coach-framed hero, horizon selector, visible panels only, assumptions/disclaimer copy

## Logging and versioning
- Snapshot stores `modelVersion`
- Snapshot stores scenario and assumptions used in each run

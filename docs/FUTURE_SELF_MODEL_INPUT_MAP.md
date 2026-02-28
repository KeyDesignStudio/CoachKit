# Future Self Engine V1 - Model Input Map

## Supported sports (default)
- Running
- Cycling

## Panel input requirements

### Performance trajectory
- Run predictions (5k/10k):
  - Required: completed run activities with distance + duration
  - Minimum to show confidently: at least 1 recent run effort (`>=4km` for 5k, `>=8km` for 10k)
  - Fallback: hide panel values and show directional summary only
- Cycling FTP-like projection:
  - Required: bike activities with average/weighted power in metrics
  - Minimum to show confidently: at least 1 effort with power and duration `>=15min`
  - Fallback: hide FTP value and show directional summary only

### Consistency and adherence
- Required:
  - planned sessions in last 28 days (`CalendarItem`)
  - completed status in last 28 days (`COMPLETED_*`)
- Minimum to show:
  - at least 6 planned sessions in last 28 days
- Fallback:
  - if sparse, still show scenario statement but confidence grade drops to C

### Body composition trend
- Weight trend:
  - Required: `AthleteCheckin.weight`
  - Minimum to show: `>=3` weigh-ins in last 30 days
  - Fallback: hide numeric projection and show friendly “not enough check-ins yet”
- Silhouette eligibility:
  - Required: projected weight + waist (`AthleteCheckin.waist`)
  - Minimum to show: at least one recent waist + enough weight points for trend
  - Fallback: silhouette disabled

## Data fields used (V1)
- `AthleteProfile`
  - `disciplines`, `eventName`, `eventDate`
- `CompletedActivity`
  - `startTime`, `durationMinutes`, `distanceKm`, `rpe`, `metricsJson`, `calendarItem.discipline`
- `CalendarItem`
  - `date`, `status`, `deletedAt`
- `AthleteCheckin` (new)
  - `date`, `weight`, `waist`, `sleepHours`, `perceivedStress`, `notes`
- `AthleteTwin` (new)
  - rolling baseline/state cache
- `ProjectionSnapshot` (new)
  - scenario inputs, outputs, assumptions, confidence, visibility toggles

## Fallback rules
- Missing run benchmark: no run time projection values; keep panel directional with explicit reason
- Missing bike benchmark: no FTP value; keep panel directional with explicit reason
- Missing check-ins: hide body trend numbers and silhouette
- Missing planned-session baseline: adherence baseline shown as 0%; confidence downgraded
- Athlete-visible payload: apply coach visibility toggle per panel (hidden panels set to null)

## Confidence scoring rules (A/B/C)
- Grade A:
  - `>=12` weeks effective history
  - benchmark present for panel
  - consistent recent activity days (`>=14` in lookback)
- Grade B:
  - `>=6` weeks history
  - partial benchmark or moderate consistency (`>=10` activity days)
- Grade C:
  - sparse/short history or missing benchmark
  - panel remains directional with wider bands

## Band and bounds rules
- Confidence bands widen by:
  - lower confidence grade
  - longer horizon (4 -> 24 weeks)
- Weight trend:
  - linear fit with regression-to-mean behavior
  - weekly change clamped to safe bound (`-1.0kg` to `+1.0kg`)
- Performance improvement:
  - conservative bounded response curve
  - max capped improvement in V1 (no aggressive gains)

## Assumptions surfaced in UI
- Recency window used
- Scenario knobs used (adherence, volume, intensity, taper)
- Non-deterministic language only (“likely”, “range”, “if consistency stays similar”)
- Disclaimer always visible: projections are estimates, not guarantees

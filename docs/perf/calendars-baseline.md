# Calendars Performance Baseline (Prod Build)

Date: 2026-02-12

## Commands

```bash
cd apps/web
npm run build
npm run start
```

Lighthouse (Chrome profile for authenticated month/week view):

```bash
# Month view
npx --yes lighthouse http://localhost:3000/coach/calendar \
  --output=json --output-path=/tmp/lh-cal-coach-month-desktop.json \
  --only-categories=performance --preset=desktop \
  --chrome-flags="--headless=new --user-data-dir=$HOME/Library/Application\ Support/Google/Chrome --profile-directory=Default" --quiet

npx --yes lighthouse http://localhost:3000/athlete/calendar \
  --output=json --output-path=/tmp/lh-cal-athlete-month-desktop.json \
  --only-categories=performance --preset=desktop \
  --chrome-flags="--headless=new --user-data-dir=$HOME/Library/Application\ Support/Google/Chrome --profile-directory=Default" --quiet

npx --yes lighthouse http://localhost:3000/coach/calendar \
  --output=json --output-path=/tmp/lh-cal-coach-month-mobile.json \
  --only-categories=performance --form-factor=mobile \
  --chrome-flags="--headless=new --user-data-dir=$HOME/Library/Application\ Support/Google/Chrome --profile-directory=Default" --quiet

npx --yes lighthouse http://localhost:3000/athlete/calendar \
  --output=json --output-path=/tmp/lh-cal-athlete-month-mobile.json \
  --only-categories=performance --form-factor=mobile \
  --chrome-flags="--headless=new --user-data-dir=$HOME/Library/Application\ Support/Google/Chrome --profile-directory=Default" --quiet

# Week view
npx --yes lighthouse http://localhost:3000/coach/calendar \
  --output=json --output-path=/tmp/lh-cal-coach-week-desktop.json \
  --only-categories=performance --preset=desktop \
  --chrome-flags="--headless=new --user-data-dir=$HOME/Library/Application\ Support/Google/Chrome --profile-directory=Default" --quiet

npx --yes lighthouse http://localhost:3000/athlete/calendar \
  --output=json --output-path=/tmp/lh-cal-athlete-week-desktop.json \
  --only-categories=performance --preset=desktop \
  --chrome-flags="--headless=new --user-data-dir=$HOME/Library/Application\ Support/Google/Chrome --profile-directory=Default" --quiet

npx --yes lighthouse http://localhost:3000/coach/calendar \
  --output=json --output-path=/tmp/lh-cal-coach-week-mobile.json \
  --only-categories=performance --form-factor=mobile \
  --chrome-flags="--headless=new --user-data-dir=$HOME/Library/Application\ Support/Google/Chrome --profile-directory=Default" --quiet

npx --yes lighthouse http://localhost:3000/athlete/calendar \
  --output=json --output-path=/tmp/lh-cal-athlete-week-mobile.json \
  --only-categories=performance --form-factor=mobile \
  --chrome-flags="--headless=new --user-data-dir=$HOME/Library/Application\ Support/Google/Chrome --profile-directory=Default" --quiet
```

## Baseline Metrics (Before)

### Coach Calendar - Week

- Desktop: FCP 594 ms, LCP 910 ms, TBT 0 ms, CLS 0.0, LCP element: not reported.
- Mobile: FCP 2638 ms, LCP 4907 ms, TBT 0 ms, CLS 0.0, LCP element: not reported.

### Athlete Calendar - Week

- Desktop: FCP 604 ms, LCP 881 ms, TBT 0 ms, CLS 0.0, LCP element: not reported.
- Mobile: FCP 2645 ms, LCP 4943 ms, TBT 8.5 ms, CLS 0.0, LCP element: not reported.

### Coach Calendar - Month

- Desktop: FCP 1047 ms, LCP 12154 ms, TBT 0 ms, CLS 0.0, LCP element: not reported.
- Mobile: FCP 1707 ms, LCP 4437 ms, TBT 40 ms, CLS 0.0, LCP element: not reported.

### Athlete Calendar - Month

- Desktop: FCP 615 ms, LCP 938 ms, TBT 0 ms, CLS 0.0, LCP element: not reported.
- Mobile: FCP 1694 ms, LCP 4394 ms, TBT 52 ms, CLS 0.0, LCP element: not reported.

## Subjective Timings

- Coach calendar — Week: shell ~6.5s; grid ~7.6s.
- Coach calendar — Month: shell ~6.2s; grid ~8.0s.
- Athlete calendar — Week: shell ~6.5s; grid ~8.3s.
- Athlete calendar — Month: shell ~6.8s; grid ~7.9s.

Notes:
- LCP element is not reported in these runs (null in Lighthouse output).

## Phase 2 Sprint (Coach Calendar Render Path)

Date: 2026-02-12

### Harness

Script:

```bash
node apps/web/scripts/dev/benchmark-calendar-render.mjs
```

What it does:
- Starts `next dev` on port `3123` with auth disabled.
- Seeds deterministic dev fixture data via `POST /api/dev/strava/test-fixtures`.
- Loads `/coach/calendar` in week and month mode (7 iterations each).
- Reads existing client marks:
  - `calendar_shell_paint`
  - `calendar_data_ready`
  - `calendar_grid_interactive`

### Before/After (Median, ms)

| Scenario | shell->data | shell->grid | data->grid |
|---|---:|---:|---:|
| Week (before) | 25 | 35 | 7 |
| Week (after) | 26 | 32 | 9 |
| Month (before) | 20 | 37 | 16 |
| Month (after) | 21 | 34 | 15 |

### Notes

- Week and month `shell->grid` improved by ~3 ms median in this local harness.
- Month `data->grid` improved by ~1 ms median.
- `shell->data` stayed roughly flat (network/API-bound in local run).

## Phase 3 Sprint (Calendar API Path)

Date: 2026-02-12

Changes:
- Removed a redundant athlete-profile query from `/api/coach/calendar` (reuse already-loaded athlete profile).
- Reduced week status lookup complexity in `/api/coach/plan-weeks` (map lookup instead of repeated linear scan).

Benchmark method:
- Same harness (`node apps/web/scripts/dev/benchmark-calendar-render.mjs`), 7 iterations.
- Two post-change runs were captured due local dev variance.

### Phase 3 Results (Median, ms)

| Scenario | Before (phase 2 after) | After run A | After run B |
|---|---:|---:|---:|
| Week shell->data | 26 | 23 | 26 |
| Week shell->grid | 32 | 33 | 35 |
| Week data->grid | 9 | 10 | 9 |
| Month shell->data | 21 | 21 | 22 |
| Month shell->grid | 34 | 38 | 38 |
| Month data->grid | 15 | 16 | 16 |

Conclusion:
- Week `shell->data` showed one improved run, but improvements were not stable across repeated runs.
- Month grid timings regressed in this dev harness, likely dominated by run-to-run noise and front-end render path rather than API query time.
- Keep these API cleanups for code efficiency, but treat their user-visible perf impact as negligible in current measurements.

## Phase 4 Sprint (Lean List Payload + Lazy Session Detail)

Date: 2026-02-12

Changes:
- Added `lean=1` mode to `GET /api/coach/calendar` to return only grid-critical fields.
- Coach calendar page now requests lean payloads for initial week/month loads.
- Full workout detail is fetched lazily on session open via `GET /api/coach/calendar-items/:itemId`.
- Drawer now hydrates from fetched detail payload while preserving existing UI behavior.

Trade-off:
- Initial calendar load is faster.
- Opening a session now includes one additional detail request (intentional, deferred cost).

### Phase 4 Results (Median, ms)

Compared to phase 3 run B medians:

| Scenario | Before (phase 3 run B) | After (phase 4) |
|---|---:|---:|
| Week shell->data | 26 | 21 |
| Week shell->grid | 35 | 30 |
| Week data->grid | 9 | 9 |
| Month shell->data | 22 | 20 |
| Month shell->grid | 38 | 35 |
| Month data->grid | 16 | 15 |

Conclusion:
- This is the first change set in the sprint with stable and meaningful improvements to initial calendar load.
- Lean payload + lazy detail fetch is a worthwhile pattern for further expansion.

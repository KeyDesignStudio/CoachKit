# Mobile QA (CoachKit)

Goal: Treat mobile (phones + tablets) as the primary UX. This doc defines the minimum device matrix, required flows, and a repeatable QA routine.

## Devices (minimum)

Phones
- iPhone SE (small)
- iPhone 14/15 (standard)
- iPhone 14/15 Pro Max (large)
- Pixel 7/8 (Android)

Tablets
- iPad mini
- iPad (11-inch)

Optional
- Galaxy Fold (narrow + wide)

## Viewports (DevTools presets)

Chrome DevTools Device Toolbar
- iPhone SE: 375x667
- iPhone 14/15: 390x844
- iPhone Pro Max: 430x932
- Pixel 7/8: 412x915
- iPad mini: 768x1024
- iPad 11-inch: 834x1194

Safari iOS checks (required)
- iPhone SE + iPhone standard
- Verify safe-area spacing (home bar + notch)
- Verify keyboard behavior in drawers/forms

## Required flows (must execute)

### Coach flows
1) Sign in
2) Dashboard
- Inbox list renders; loading state visible
- Bulk select UX works (tap targets)
- Bulk mark reviewed reachable without scrolling hunt
- Open detail drawer; return back
3) Manage Athletes
- Grid renders without horizontal scroll
- Open athlete detail drawer; edit fields; save
- Journal tab usable on mobile
- Pain history list readable
4) Workout Scheduling (Coach calendar)
- Week view: usable on phone (no 7-column squeeze)
- Athlete selector works
- Add workout is reachable (no hover-only controls)
- Add multiple workouts same day
- Edit workout
- Stacked mode: athlete slots aligned across days
- Month view readable; +N more behavior works
5) Group Sessions
- Grid renders; cards are tappable
- Create; edit; apply
6) Settings
- Timezone
- Logo upload

### Athlete flows
1) Sign in
2) Workout Schedule
- Week + month views render without horizontal scroll
- Add workout (if allowed) or view-only interactions
3) Open workout detail
4) Strava detected flow
- Draft -> add notes/pain/RPE -> Confirm
- Verify persistence on refresh
5) Athlete settings
- Timezone
- Strava connect/sync now

## Interaction checklist (must pass)

Layout
- No horizontal scroll on any core page
- Long text truncates (no accidental tall cards)
- Today highlight consistent

Touch + accessibility
- Tap targets >= 44px (buttons, icon buttons, list rows)
- No hover-only affordances (mobile has no hover)
- Modals/drawers usable one-handed
- Close/back behavior consistent

Keyboard + forms
- Inputs not hidden by keyboard
- Numeric fields use numeric input modes where appropriate
- Select controls usable on mobile
- Error states are clear and don't cause large layout jumps

Performance
- Skeletons show on key screens (calendar, dashboard, lists)
- No blank content while loading

## Mobile QA routine (5-10 minutes)

Run before every push that affects UI:
1) `cd apps/web && npm run build`
2) Automated mobile smoke:
- `cd apps/web && npm run test:mobile`
- Covers `/coach/athletes` (iPhone + iPad)
3) Manual 5-minute sanity in Chrome DevTools:
- iPhone SE -> Coach Dashboard + Coach Calendar week
- iPhone 14 -> Athlete Calendar week + workout detail
- iPad mini -> Coach Athletes + Group Sessions

If regressions are found:
- Add an entry to "Known Issues" below (date + device + steps + expected vs actual)

## Known Issues

(Keep this section current. Add newest entries at the top.)

- 2026-01-13: (placeholder) -> Describe issue, device, steps, expected/actual, and link to follow-up.

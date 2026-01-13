# CoachKit Font Report

Last updated: 2026-01-13

This document inventories the font loading strategy and the typography utilities in use across the CoachKit web app.

## Scope

- Includes: global font loading (CSS + `<link>`), Tailwind typography utilities (`text-*`, `font-*`, `tracking-*`, `leading-*`, case transforms).
- Excludes: layout/surface tokens (backgrounds, borders, shadows) except where they affect typographic consistency (contrast/readability).

## Sources of Truth (Global)

### Primary text font

- Loaded via Google Fonts CSS import in `apps/web/app/globals.css`:
  - `Space Grotesk` with weights `400`, `500`, `600`.
- Applied globally on `body` in `apps/web/app/globals.css`:
  - `font-family: 'Space Grotesk', 'SF Pro Display', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;`

### Icon font

- Loaded via a `<link rel="stylesheet">` in `apps/web/app/layout.tsx`:
  - Google `Material Symbols Outlined` with `wght=300` (variable font).
- Icon rendering is centralized in `apps/web/components/ui/Icon.tsx` and must use the `material-symbols-outlined` font class.

### Tailwind font-family utilities

- Tailwind config defines a single custom family in `apps/web/tailwind.config.js`:
  - `theme.extend.fontFamily.display = ['Space Grotesk', 'Segoe UI', 'sans-serif']`
- Observed usage:
  - `font-display` is used (currently in the global header branding).

## Typography Utility Inventory (Observed)

Counts below are derived from repository scans over `apps/web/**` (excluding `node_modules`).

### Text size utilities

Named sizes (Tailwind):

| Token | Count |
| --- | ---: |
| `text-sm` | 249 |
| `text-xs` | 111 |
| `text-lg` | 20 |
| `text-2xl` | 16 |
| `text-xl` | 12 |
| `text-3xl` | 7 |
| `text-base` | 4 |

Arbitrary pixel sizes:

| Token | Count |
| --- | ---: |
| `text-[10px]` | 16 |
| `text-[16px]` | 10 |
| `text-[11px]` | 2 |
| `text-[13px]` | 1 |

Notes:
- `text-[16px]` appears frequently on icons and dense UI elements.

### Font weight utilities

| Token | Count |
| --- | ---: |
| `font-medium` | 154 |
| `font-semibold` | 56 |
| `font-normal` | 11 |
| `font-bold` | 2 |

### Font family utilities

| Token | Count |
| --- | ---: |
| `font-display` | 1 |

### Tracking (letter-spacing)

Named tracking:

| Token | Count |
| --- | ---: |
| `tracking-wide` | 26 |
| `tracking-tight` | 2 |
| `tracking-wider` | 1 |

Arbitrary tracking:

| Token | Count |
| --- | ---: |
| `tracking-[0.3em]` | 9 |
| `tracking-[0.18em]` | 7 |

### Leading (line-height)

| Token | Count |
| --- | ---: |
| `leading-none` | 20 |

### Case transforms

| Token | Count |
| --- | ---: |
| `uppercase` | 45 |

## Canonical Typography Patterns (What the UI is doing)

These patterns show up repeatedly and effectively act like typographic “roles”.

- **Section eyebrow / context label** (Coach and Athlete headers):
  - `text-xs md:text-sm uppercase tracking-[0.3em] text-[var(--muted)]`
  - Examples:
    - `apps/web/app/coach/dashboard/page.tsx`
    - `apps/web/app/coach/calendar/page.tsx`
    - `apps/web/app/athlete/calendar/page.tsx`
    - `apps/web/app/athlete/settings/page.tsx`

- **Primary page title**:
  - `text-2xl md:text-3xl font-semibold` (sometimes `tracking-tight`)
  - Examples:
    - `apps/web/app/coach/dashboard/page.tsx`
    - `apps/web/app/coach/calendar/page.tsx`

- **Dense micro-labels / badges / calendar chips**:
  - `text-[10px]` (often paired with `leading-none`)
  - Examples appear in calendar day cells and week rows.

- **Form labels**:
  - `text-sm font-medium` or `text-xs font-medium` depending on density.

- **Icon sizing** (Material Symbols):
  - `xs`: `text-[13px]` (with inline `style.fontSize = '13px'`)
  - `sm`: `text-base` (16px)
  - `md`: `text-lg` (18px)
  - `lg`: `text-xl` (20px)
  - Implemented in `apps/web/components/ui/Icon.tsx`.

## Surface-by-Surface Notes (Selected)

This is not a full per-component catalog; it highlights the primary surfaces that set typography expectations.

### Global layout + header

- Global defaults:
  - `apps/web/app/layout.tsx`: `<body className="bg-[var(--bg-page)] text-[var(--text)]">`
  - `apps/web/app/globals.css`: applies `Space Grotesk` stack to `body`.
- Header branding:
  - `apps/web/components/app-header.tsx`: center CoachKit mark uses `font-display font-semibold tracking-tight`.

### Coach: Dashboard

- `apps/web/app/coach/dashboard/page.tsx`:
  - Eyebrow: `text-xs md:text-sm uppercase tracking-[0.3em]`
  - Title: `text-2xl md:text-3xl font-semibold tracking-tight`
  - Subheads also use `text-xs font-medium uppercase` variants.

### Coach: Calendar

- `apps/web/app/coach/calendar/page.tsx`:
  - Same eyebrow + title pattern as dashboard.
  - Status pill uses `text-xs font-medium`.

### Coach: Athletes

- `apps/web/app/coach/athletes/page.tsx`:
  - Title uses `text-xl md:text-2xl font-bold`.
  - Card rows use `font-medium`, `text-sm`, `text-xs` with truncation.

### Athlete: Calendar

- `apps/web/app/athlete/calendar/page.tsx`:
  - Eyebrow: `text-xs md:text-sm uppercase tracking-[0.3em]`
  - Title: `text-2xl md:text-3xl` with conditional `font-medium` vs `font-normal`.

### Athlete: Workout detail

- `apps/web/app/athlete/workouts/[id]/page.tsx`:
  - Header title: `text-xl font-semibold`.
  - “Workout Detail” label uses `text-xs font-medium uppercase tracking-wide`.
  - “From Strava” section uses `text-lg font-semibold`.

## Inconsistency Flags (Actionable)

These are concrete “drift points” discovered from the inventory.

1) **`font-bold` used, but Space Grotesk 700 is not loaded**
- Global font import loads `400/500/600` only.
- `font-bold` appears (e.g. `apps/web/app/coach/athletes/page.tsx`).
- Result: browsers may synthesize bold or fall back inconsistently.
- Fix options:
  - Add `700` to the Google Fonts import for `Space Grotesk`, or
  - Avoid `font-bold` and stick to `font-semibold` as the heaviest weight.

2) **Mixed text color strategies**
- Many components use CSS variable colors: `text-[var(--text)]`, `text-[var(--muted)]`.
- Some surfaces still use Tailwind palette colors (examples observed):
  - `text-slate-600`, `text-emerald-700`, `text-red-700`, `text-rose-500`, `text-amber-700`.
- This isn’t strictly a font issue, but it affects readability/contrast consistency and makes typography roles harder to standardize.

3) **Label tracking is split across named + arbitrary utilities**
- Both `tracking-wide` and `tracking-[0.18em]` / `tracking-[0.3em]` are used.
- Recommendation: pick one canonical label tracking (or define semantic Tailwind tokens) so headings/eyebrows look identical across coach + athlete surfaces.

## Notes / Next Steps (Optional)

If you want to harden typography consistency without changing the visual design, the next low-risk step is to introduce a small set of semantic Tailwind component classes (e.g. `ui-eyebrow`, `ui-h1`, `ui-label`) and gradually replace inline token strings.

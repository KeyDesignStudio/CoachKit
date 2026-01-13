# Mobile Layout Contract (CoachKit)

This document defines the mobile-first layout rules and standard UI patterns.

## Breakpoints

- Base (mobile-first): <768px
- `md`: >= 768px
- `lg`: >= 1024px
- `xl`: >= 1280px

Rule: Base styles must be designed for phone screens first. Only add `md/lg/xl` to enhance layout.

## Global rules

- No horizontal scrolling unless explicitly designed for it.
- All interactive controls must have a tap target of at least 44x44px.
- Never rely on hover-only affordances.
- Long text truncates instead of wrapping into tall cards.
- Loading states must be visible (skeletons or spinners), never blank screens.
- Keyboard-safe: focused input must remain visible above the keyboard.
- Safe area: respect iOS safe areas for bottom action bars and full-screen modals.

## Standard patterns

### Navigation
- Header must not cram links on small widths.
- Prefer a compact header + a menu affordance on mobile.
- Coach vs Athlete nav should stay minimal and task-focused.

### Filters and secondary controls
- On mobile, secondary filters should move into a "Filters" bottom sheet when space is tight.
- Keep primary actions visible without scrolling.

### Drawers and modals
- Mobile: full-screen modal (or near-full height) with a clear Close control.
- Desktop: side-panel drawer where appropriate.
- Primary actions should be sticky on mobile (Save/Confirm/Mark Reviewed).
- Bottom action bars should include safe-area padding.

### Lists and grids
- Use responsive grids (mobile 1-col) for card collections.
- Ensure cards have consistent height; truncate text lines.
- Avoid nested scroll areas on mobile unless essential.

### Calendars
- Week view:
  - Mobile: vertical day cards or horizontal day paging (no 7-column squeeze)
  - Add workout must be reachable without hover
- Month view:
  - Readable at phone scale
  - Multi-workout days show "+N more" and open a sheet/drawer

## Implementation notes (Tailwind)

- Prefer `min-w-0` on flex/grid children that contain truncation.
- Use `overflow-x-hidden` at page shell level if needed, but root-cause overflow first.
- Ensure icon-only buttons use at least `h-11 w-11` on mobile.

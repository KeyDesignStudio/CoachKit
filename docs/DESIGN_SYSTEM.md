# CoachKit Design System

This is the authoritative documentation for the CoachKit Design System. All development must adhere to the principles and constraints defined here.

## A) Design System Philosophy

*   **Single Source of Truth**: `components/ui/tokens.ts` is the single source of truth for all styling values (spacing, typography, borders, radius, colors).
*   **Primitives over Tweaking**: Pages must compose high-level primitives (`Block`, `BlockTitle`, `Input`) rather than building custom UI from scratch.
*   **No Hard-Coding**: Hard-coded Tailwind utility classes (e.g., `text-[13px]`, `gap-3`) are strictly forbidden outside of the core primitives. Pages consume tokens; primitives consume tokens.

## B) Tokens Layer (`components/ui/tokens.ts`)

The `tokens` object is the canonical definition for:

### Typography
*   **`tokens.typography.h1`**: Page headings (24px/bold).
*   **`tokens.typography.h2`**: Section headings (20px/semibold).
*   **`tokens.typography.blockTitle`**: Block/Panel headers (18px/semibold).
*   **`tokens.typography.sectionLabel`**: Data labels (12px/uppercase/tracking-wider/muted).
*   **`tokens.typography.body`**: Standard reading text (14px).
*   **`tokens.typography.bodyMuted`**: Secondary text (14px).
*   **`tokens.typography.meta`**: Small metadata text (12px).

### Spacing
*   **`tokens.spacing.screenPadding`**: Global screen gutters.
*   **`tokens.spacing.dashboardSectionGap`**: Vertical rhythm between major page sections.
*   **`tokens.spacing.gridGap`**: Horizontal/Vertical gaps in grids.
*   **`tokens.spacing.blockGapY`**: Vertical stacking within a Block.
*   **`tokens.spacing.widgetGap`**: Smaller gap (8px) for widgets/lists.
*   **`tokens.spacing.tight`**: Tight stacking for data pairs (label + value).

### Borders & Radius
*   **`tokens.borders.default`**: Standard subtle border for Blocks.
*   **`tokens.borders.input`**: Input field borders.
*   **`tokens.radius.card`**: Standard curvature for Blocks (12px/xl).

### Colour Intent
*   **Text**: `[var(--text)]` (Primary), `[var(--muted)]` (Secondary).
*   **Surfaces**: `[var(--bg-card)]` (Blocks), `[var(--bg-page)]` (Backgrounds).

### Design Problem Solution
Tokens solve the issue of "drift". By referencing `tokens.spacing.gridGap` instead of `gap-4`, we ensure that if we update the design spacing system later, we update it in one place, and every dashboard updates simultaneously.

## C) Core UI Primitives (Authoritative)

### `Block`
*   **Purpose**: The fundamental container for content. Replaces `Card` or `div` with border/shadow.
*   **Ownership**: Owns border, background, radius, shadow, and internal padding.
*   **Usage**: Wrap any grouped content in `<Block>`.

### `BlockTitle`
*   **Purpose**: Standard section heading within a Block.
*   **Ownership**: Font size, weight, color, letter spacing.
*   **Usage**: `<BlockTitle>Workout Plan</BlockTitle>`

### `FieldLabel`
*   **Purpose**: Standard label for a data point or form field.
*   **Ownership**: Uppercase transformation, tracking, font size, mute color.
*   **Usage**: `<FieldLabel>Start Time</FieldLabel>`

### `Input` / `SelectField`
*   **Purpose**: Standardized user input controls.
*   **Ownership**: Borders, focus states, internal padding, font size.

### `Button`
*   **Purpose**: Interactive actions.
*   **Ownership**: Variants (primary, ghost, secondary), sizes.

## D) Forbidden Patterns (Explicit)

The following patterns are **Strictly Forbidden** in page files (`app/**/*.tsx`):

*   ❌ `text-[13px]` or random font sizes. (Use `tokens.typography.*`)
*   ❌ `gap-3` or `gap-5`. (Use `tokens.spacing.*`)
*   ❌ `px-4 py-6`. (Use `tokens.spacing.screenPadding` or rely on `Block` defaults)
*   ❌ `border-gray-200`. (Use `tokens.borders.default`)
*   ❌ `rounded-lg` on structural containers. (Use `tokens.radius.card` or `Block`)
*   ❌ `uppercase tracking-wider` inline. (Use `FieldLabel` or `tokens.typography.sectionLabel`)
*   ❌ `font-bold` ad-hoc usage. (Use `tokens.typography.h*`)

### Correct Refactoring Example

**BAD:**
```tsx
<div className="p-4 border rounded-xl gap-4 flex flex-col">
  <h2 className="text-lg font-bold">Details</h2>
  <div className="text-[13px] uppercase text-gray-500">Name</div>
</div>
```

**GOOD:**
```tsx
<Block>
  <BlockTitle>Details</BlockTitle>
  <div>
    <FieldLabel>Name</FieldLabel>
  </div>
</Block>
```

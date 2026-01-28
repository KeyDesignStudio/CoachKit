# CoachKit Design System v2

**Status**: Enforced
**Last Updated**: 2026-01-28
**Scope**: All UI/UX across Athlete and Coach apps.

---

## 1. Core Philosophy

1.  **Strict Token Usage**: No arbitrary values. If it's not in `tokens.ts`, it doesn't exist.
2.  **Primitives First**: Build using `Block`, `Button`, `Input`. Do not style `div`s manually.
3.  **Predictable Rhythm**: Spacing is mathematical (4px grid), not optical.
4.  **Enforced Consistency**: Components that look the same must *be* the same.

---

## 2. Visual Foundations

### Typography
Regulated by `tokens.typography`. All fonts use the system font stack (San Francisco, Segoe UI, etc.).

| Logical Role | Token | Style | Usage |
| :--- | :--- | :--- | :--- |
| **Page Title** | `typography.h1` | 24px Bold Tight | Main page headers (`<h1>`) |
| **Section** | `typography.h2` | 20px Semibold Tight | Major page sections (`<h2>`) |
| **Subsection** | `typography.h3` | 18px Medium Tight | Card groups / modal titles |
| **Block Title** | `typography.blockTitle` | 14px Bold Uppercase | Headers inside Blocks |
| **Body** | `typography.body` | 14px Regular | Default text |
| **Muted** | `typography.bodyMuted` | 14px Regular Muted | Helper text, secondary descriptions |
| **Meta** | `typography.meta` | 12px Regular Muted | Timestamps, IDs, footer info |
| **Label** | `typography.sectionLabel` | 10px Bold Uppercase | Field labels, graph axes |

### Spacing & Layout
Regulated by `tokens.spacing`. Based on a 4px grid.

- **Screen Padding**: `spacing.screenPadding` (Mobile: 16px, Desktop: 24px).
- **Section Gap**: `spacing.dashboardSectionGap` (24px). Separates major vertical zones.
- **Grid Gap**: `spacing.gridGap` (16px -> 24px). Standard grid separation.
- **Block Gap**: `spacing.blockGapY` (16px). Vertical spacing between elements inside a Block.
- **Tight Gap**: `spacing.tight` (6px). Spacing between a Label and its Input.

### Colors
Regulated by CSS Variables mapped to `tokens.colors`.

- **Primary**: `var(--primary)` (Action Blue).
- **Text**: `var(--text)` (Dark Grey/Black).
- **Muted**: `var(--muted)` (Slate Grey).
- **Surfaces**:
    - Page: `var(--bg-page)` (Off-white/Dark bg).
    - Card: `var(--bg-card)` (White/Panel bg).
    - Structure: `var(--bg-structure)` (Grouped areas).

### Borders & Radius
- **Radius**:
    - Cards/Inputs/Buttons: `rounded-xl` (12px) or `rounded-2xl` (16px) depending on size. Defined in `tokens.radius`.
    - Pills: `rounded-full` (9999px).
- **Borders**:
    - Default: `1px solid var(--border-subtle)`.
    - Focus: `Ring` using `var(--ring)`.

---

## 3. Component Taxonomy

### Primitives (Low Level)
These components wrap HTML elements and apply tokens.

*   **`Block`**: The fundamental container. Owns `bg-card`, `border`, `shadow`, `padding`.
*   **`BlockTitle`**: Standard header for Blocks.
*   **`Button`**: Interactive element. Owns `height` (44px min), `padding`, `radius`, `transition`.
*   **`Input` / `SelectField`**: Form controls. Owns `height` (44px min), `border`, `radius`.
*   **`FieldLabel`**: Standard label for inputs. Upper-case, bold, tiny.
*   **`Icon`**: Unified SVG wrapper.

### Compounds (High Level)
These compose primitives for specific domain tasks.

*   **`StatRow`**: Key/Value pair (Label + StatValue).
*   **`EmptyState`**: Icon + Title + Description centered in a Block.
*   **`PageHeader`**: H1 + Actions.

---

## 4. States & Variants

### Loading
- **Skeleton**: Use `FullScreenLogoLoader` for pages, or skeleton primitives for blocks.
- **Opacity**: Loading states should use `tokens.opacity.disabled` (0.5).

### Empty
- Always describe *what* is missing and *how* to fix it (e.g., "No workouts found. Create one?").

### Disabled
- Interactive elements must set `disabled={true}` and apply `tokens.opacity.disabled`.

---

## 5. Enforcement & Auditing

### Forbidden Patterns
❌ **Arbitrary Values**: `mt-[13px]`, `p-[7px]`.
❌ **Manual Borders**: `border-gray-200` (Use `tokens.borders.default`).
❌ **Manual Text Sizes**: `text-lg` (Use `tokens.typography.h3`).
❌ **Hardcoded Colors**: `text-[#333]` (Use `tokens.colors.text.main`).

### Audit Commands

Run these to find violations:

**Find arbitrary spacing:**
```bash
grep -r "p-\[" apps/web/app
grep -r "m-\[" apps/web/app
grep -r "gap-\[" apps/web/app
```

**Find arbitrary text sizes:**
```bash
grep -r "text-\[" apps/web/app
```

**Find hardcoded colors:**
```bash
grep -r "bg-\[" apps/web/app
grep -r "text-\[" apps/web/app
```

**Find manual borders:**
```bash
grep -r "border-gray" apps/web/app
```


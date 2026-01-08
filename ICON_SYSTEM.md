# CoachKit Icon System

## Architecture

CoachKit uses a centralized icon system based on **Google Material Symbols (Outlined style)** to ensure visual consistency across the entire platform.

### Non-Negotiable Rules

1. **Single Source of Truth**: All icons are defined in `components/ui/iconRegistry.ts`
2. **Typed Keys Only**: Icons can only be rendered via `<Icon name="..." />` with a typed `IconName`
3. **No Direct Imports**: Pages and components **must not** import icons directly from any icon library

### Adding New Icons

To introduce a new icon to the platform:

1. Add the icon key to `ICON_NAMES` array in `components/ui/iconRegistry.ts`
2. Map the key to the appropriate Material Symbol name in the `ICONS` object
3. Use the icon via `<Icon name="yourIconKey" />` in your component

**Example:**
```typescript
// In iconRegistry.ts
export const ICON_NAMES = [
  // ... existing icons
  'newFeature',
] as const;

export const ICONS: Record<IconName, string> = {
  // ... existing mappings
  newFeature: 'new_releases', // Material Symbol name
};
```

```tsx
// In your component
import { Icon } from '@/components/ui/Icon';

<Icon name="newFeature" size="sm" className="text-blue-600" />
```

### Icon Sizes

- `sm` - 16px (chips, cards, inline text)
- `md` - 18px (section headers, form labels)
- `lg` - 20px (primary actions, page headers)

### Styling

Icons inherit `currentColor` by default, so they respect Tailwind color classes:
```tsx
<Icon name="coachAdvice" className="text-amber-600" />
```

### Current Icon Categories

1. **Discipline Icons**: `disciplineRun`, `disciplineBike`, `disciplineSwim`, etc.
2. **Feedback Metadata**: `coachAdvice`, `athleteComment`, `anyComment`
3. **Workflow States**: `planned`, `completed`, `skipped`, `reviewed`
4. **Navigation/Actions**: `prev`, `next`, `today`, `refresh`, `filter`, etc.

## Migration Notes

- Lucide React has been removed as a dependency
- All emoji icons (💡, 💬, ✓, etc.) have been replaced with Material Symbols
- The icon system uses font-based rendering for optimal performance

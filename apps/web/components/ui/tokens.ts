type UiDensity = 'compact' | 'comfortable';

const uiDensity: UiDensity =
  String(process.env.NEXT_PUBLIC_UI_DENSITY ?? 'compact').toLowerCase() === 'comfortable'
    ? 'comfortable'
    : 'compact';

const spacingByDensity = {
  compact: {
    // Global Layout
    screenPadding: 'p-3 md:p-4',
    dashboardSectionGap: 'space-y-4',

    // Container Internals
    blockPadding: 'p-3 md:p-4',
    blockPaddingX: 'px-3 md:px-4',
    blockPaddingY: 'py-3 md:py-4',

    // Component Stacking
    blockGapY: 'space-y-3',
    blockRowGap: 'gap-3',
    gridGap: 'gap-3 lg:gap-4',

    // Detailed Spacing
    widgetGap: 'gap-2',
    fieldGapY: 'space-y-3',
    tight: 'space-y-1',
    tinyGap: 'gap-1',

    // Specific container presets
    elementPadding: 'px-2.5 py-1.5',
    pill: 'px-2 py-0.5',
    containerPadding: 'p-2.5',
  },
  comfortable: {
    // Global Layout
    screenPadding: 'p-4 md:p-6',
    dashboardSectionGap: 'space-y-6',

    // Container Internals
    blockPadding: 'p-4 md:p-5',
    blockPaddingX: 'px-4 md:px-5',
    blockPaddingY: 'py-4 md:py-5',

    // Component Stacking
    blockGapY: 'space-y-4',
    blockRowGap: 'gap-4',
    gridGap: 'gap-4 lg:gap-6',

    // Detailed Spacing
    widgetGap: 'gap-2',
    fieldGapY: 'space-y-4',
    tight: 'space-y-1.5',
    tinyGap: 'gap-1',

    // Specific container presets
    elementPadding: 'px-3 py-2',
    pill: 'px-2 py-0.5',
    containerPadding: 'p-3',
  },
} as const;

const typographyByDensity = {
  compact: {
    body: 'text-sm text-[var(--text)] leading-normal',
    bodySemi: 'text-sm font-semibold text-[var(--text)] leading-normal',
    bodyBold: 'text-sm font-bold text-[var(--text)] leading-normal',
    bodyLarge: 'text-base text-[var(--text)] leading-snug',
    bodyMuted: 'text-sm text-[var(--muted)] leading-normal',
  },
  comfortable: {
    body: 'text-sm text-[var(--text)] leading-relaxed',
    bodySemi: 'text-sm font-semibold text-[var(--text)] leading-relaxed',
    bodyBold: 'text-sm font-bold text-[var(--text)] leading-relaxed',
    bodyLarge: 'text-base text-[var(--text)] leading-relaxed',
    bodyMuted: 'text-sm text-[var(--muted)] leading-relaxed',
  },
} as const;

const spacing = spacingByDensity[uiDensity];
const typographyDensity = typographyByDensity[uiDensity];

export const tokens = {
  spacing: {
    // Global Layout
    screenPadding: spacing.screenPadding,
    dashboardSectionGap: spacing.dashboardSectionGap,

    // Container Internals
    blockPadding: spacing.blockPadding,
    blockPaddingX: spacing.blockPaddingX,
    blockPaddingY: spacing.blockPaddingY,

    // Component Stacking
    blockGapY: spacing.blockGapY, // Standard gap between significant elements
    blockRowGap: spacing.blockRowGap, // Horizontal gap for flex items
    gridGap: spacing.gridGap, // Standard grid spacing

    // Detailed Spacing
    widgetGap: spacing.widgetGap, // Tighter gap for widgets/lists
    fieldGapY: spacing.fieldGapY, // form field spacing (kept backward compat name)
    tight: spacing.tight, // Label + Value
    tinyGap: spacing.tinyGap, // Metadata/Icon spacing

    // Specific container presets
    elementPadding: spacing.elementPadding, // Buttons, Inputs
    pill: spacing.pill, // Tags, badges
    containerPadding: spacing.containerPadding, // Small cards

    // Touch targets
    touchTarget: 'min-h-[44px]',
  },

  borders: {
    default: 'border border-[var(--border-subtle)]',
    input: 'border border-[var(--border-subtle)] focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)]',
    divider: 'border-t border-[var(--border-subtle)]',
    error: 'border-red-500',
    transparent: 'border-transparent',
    interactive: 'border border-[var(--border-subtle)] hover:border-[var(--text)] transition-colors',
    focus: 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2',
    ring: 'ring-offset-background',
  },

  radius: {
    card: 'rounded-2xl',     // Updated to modern standard
    input: 'rounded-xl',     
    button: 'rounded-xl',
    pill: 'rounded-full',
    sm: 'rounded-lg',
    none: 'rounded-none',
  },

  colors: {
    // Utility classes mapping to CSS vars
    text: {
      main: 'text-[var(--text)]',
      muted: 'text-[var(--muted)]',
      primary: 'text-[var(--primary)]',
      danger: 'text-rose-500',
      success: 'text-[var(--text-success)]',
      onPrimary: 'text-white',
    },
    bg: {
      page: 'bg-[var(--bg-page)]',
      card: 'bg-[var(--bg-card)]',
      surface: 'bg-[var(--bg-surface)]',
      structure: 'bg-[var(--bg-structure)]',
      transparent: 'bg-transparent',
      primary: 'bg-[var(--primary)]',
      danger: 'bg-rose-500',
      success: 'bg-[var(--bg-success)]',
    },
    border: {
      subtle: 'border-[var(--border-subtle)]',
    },
    brand: {
      strava: 'text-[#fc4c02]',
    },
  },

  elevation: {
    none: 'shadow-none',
    sm: 'shadow-sm',
    card: 'shadow-sm',
    modal: 'shadow-xl',
    glass: 'shadow-glass backdrop-blur-md',
  },

  opacity: {
    disabled: 'disabled:opacity-50 disabled:pointer-events-none',
    muted: 'opacity-70',
    ghost: 'opacity-0',
  },

  zIndex: {
    base: 'z-0',
    sticky: 'z-10',
    dropdown: 'z-40',
    modal: 'z-50',
    popover: 'z-60',
    toast: 'z-[70]',
  },

  typography: {
    // Headings
    h1: 'text-2xl font-bold text-[var(--text)] tracking-tight',
    h2: 'text-xl font-semibold text-[var(--text)] tracking-tight',
    h3: 'text-lg font-medium text-[var(--text)] tracking-tight',
    h4: 'text-base font-semibold text-[var(--text)]',

    // UI Elements
    blockTitle: 'text-sm font-bold text-[var(--text)] uppercase tracking-wide',
    sectionLabel: 'text-[10px] sm:text-xs font-bold text-[var(--muted)] uppercase tracking-wider',
    navLink: 'text-xs font-bold text-[var(--muted)] hover:text-[var(--text)] uppercase tracking-wide transition-colors',
    
    // Body
    body: typographyDensity.body,
    bodySemi: typographyDensity.bodySemi,
    bodyBold: typographyDensity.bodyBold,
    bodyLarge: typographyDensity.bodyLarge,
    bodyMuted: typographyDensity.bodyMuted,
    
    // Data
    meta: 'text-xs text-[var(--muted)]',
    statLabel: 'text-xs font-medium text-[var(--muted)] uppercase tracking-wide',
    statValue: 'text-sm sm:text-base font-semibold text-[var(--text)]',
    
    // Interactive
    button: 'text-sm font-medium',
    input: 'text-sm text-[var(--text)] placeholder:text-[var(--muted)]',
    label: 'text-xs font-bold uppercase tracking-wide',
    small: 'text-xs',
  },

  icons: {
    xs: 'w-3 h-3',
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
    xl: 'w-8 h-8',
  },

  focus: {
    ring: 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2',
    ringOffset: 'ring-offset-background',
  },
  
  // Transitions
  transition: {
    default: 'transition-all duration-200 ease-in-out',
    fast: 'transition-all duration-100 ease-out',
  },
  system: {
    uiDensity,
  },
} as const;

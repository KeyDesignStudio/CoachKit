import { CALENDAR_ACTION_ICON_CLASS } from '@/components/calendar/iconTokens';

// Token contract: calendar density + scannability
// - Mobile-first tokens for calendar density/scannability.
// - Use `md:` overrides for desktop.
// - Do not introduce one-off padding/gap values in calendar components; extend tokens instead.

export const mobilePillPadding = 'px-2 py-1 md:py-1.5';
export const mobilePillGap = 'gap-1.5 md:gap-2';
export const mobileHeaderPadding = 'px-3 py-1.5 md:py-2';
export const mobileHeaderActionSize = 'h-9 w-9 md:h-6 md:w-6';
export const mobileDayCellPadding = 'p-1.5 md:p-2';

// Reuse the existing ~10% smaller action/status icon calibration.
// Do not apply this to discipline icons.
export const mobileIconSize = CALENDAR_ACTION_ICON_CLASS;

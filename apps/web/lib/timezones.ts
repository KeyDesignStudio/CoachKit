export type TimezoneOption = {
  value: string;
  label: string;
};

// Flat list, intentionally ordered (Australia-first). Keep this list small (~40-60).
export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  // 1) Australia (top of list; explicit order)
  { value: 'Australia/Brisbane', label: 'Australia – Brisbane (AEST)' },
  { value: 'Australia/Sydney', label: 'Australia – Sydney (AEDT/AEST)' },
  { value: 'Australia/Melbourne', label: 'Australia – Melbourne (AEDT/AEST)' },
  { value: 'Australia/Adelaide', label: 'Australia – Adelaide (ACDT/ACST)' },
  { value: 'Australia/Darwin', label: 'Australia – Darwin (ACST)' },
  { value: 'Australia/Perth', label: 'Australia – Perth (AWST)' },
  { value: 'Australia/Hobart', label: 'Australia – Hobart (AEDT/AEST)' },

  // 2) New Zealand
  { value: 'Pacific/Auckland', label: 'New Zealand – Auckland (NZDT/NZST)' },

  // 3) United States
  { value: 'America/Los_Angeles', label: 'United States – Los Angeles (PT)' },
  { value: 'America/Denver', label: 'United States – Denver (MT)' },
  { value: 'America/Chicago', label: 'United States – Chicago (CT)' },
  { value: 'America/New_York', label: 'United States – New York (ET)' },

  // 4) United Kingdom & Europe
  { value: 'Europe/London', label: 'United Kingdom – London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Europe – Paris (CET/CEST)' },
  { value: 'Europe/Berlin', label: 'Europe – Berlin (CET/CEST)' },
  { value: 'Europe/Madrid', label: 'Europe – Madrid (CET/CEST)' },
  { value: 'Europe/Rome', label: 'Europe – Rome (CET/CEST)' },
  { value: 'Europe/Amsterdam', label: 'Europe – Amsterdam (CET/CEST)' },

  // Common extra Europe
  { value: 'Europe/Dublin', label: 'Europe – Dublin (GMT/IST)' },
  { value: 'Europe/Lisbon', label: 'Europe – Lisbon (WET/WEST)' },
  { value: 'Europe/Zurich', label: 'Europe – Zurich (CET/CEST)' },
  { value: 'Europe/Stockholm', label: 'Europe – Stockholm (CET/CEST)' },
  { value: 'Europe/Copenhagen', label: 'Europe – Copenhagen (CET/CEST)' },
  { value: 'Europe/Athens', label: 'Europe – Athens (EET/EEST)' },

  // 5) Asia (common training markets)
  { value: 'Asia/Singapore', label: 'Asia – Singapore (SGT)' },
  { value: 'Asia/Tokyo', label: 'Asia – Tokyo (JST)' },
  { value: 'Asia/Hong_Kong', label: 'Asia – Hong Kong (HKT)' },
  { value: 'Asia/Seoul', label: 'Asia – Seoul (KST)' },
  { value: 'Asia/Bangkok', label: 'Asia – Bangkok (ICT)' },
  { value: 'Asia/Dubai', label: 'Asia – Dubai (GST)' },

  // Common extra Asia
  { value: 'Asia/Shanghai', label: 'Asia – Shanghai (CST)' },
  { value: 'Asia/Taipei', label: 'Asia – Taipei (CST)' },
  { value: 'Asia/Kuala_Lumpur', label: 'Asia – Kuala Lumpur (MYT)' },
  { value: 'Asia/Manila', label: 'Asia – Manila (PHT)' },
  { value: 'Asia/Jakarta', label: 'Asia – Jakarta (WIB)' },
  { value: 'Asia/Ho_Chi_Minh', label: 'Asia – Ho Chi Minh City (ICT)' },

  // 6) Americas (non-US)
  { value: 'America/Toronto', label: 'Canada – Toronto (ET)' },
  { value: 'America/Vancouver', label: 'Canada – Vancouver (PT)' },
  { value: 'America/Sao_Paulo', label: 'Brazil – São Paulo (BRT)' },
  { value: 'America/Mexico_City', label: 'Mexico – Mexico City (CT)' },
  { value: 'America/Buenos_Aires', label: 'Argentina – Buenos Aires (ART)' },

  // 7) Africa
  { value: 'Africa/Johannesburg', label: 'Africa – Johannesburg (SAST)' },
  { value: 'Africa/Cairo', label: 'Africa – Cairo (EET/EEST)' },

  // 8) Catch-all (bottom)
  { value: 'UTC', label: 'UTC' },
];

const timezoneLabelByValue = new Map(TIMEZONE_OPTIONS.map((o) => [o.value, o.label] as const));

export function getTimezoneLabel(tz: string): string {
  return timezoneLabelByValue.get(tz) ?? tz;
}

export const TIMEZONE_VALUES = new Set(TIMEZONE_OPTIONS.map((o) => o.value));

function getZonedDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

/**
 * True only after a given date's local day has ended in the provided timezone.
 *
 * Example: if dateYmd is "2026-01-11" and in that timezone it's still
 * 2026-01-11, this returns false. Once that timezone rolls over to 2026-01-12,
 * it returns true.
 */
export function isPastEndOfLocalDay(dateYmd: string, timeZone: string, now: Date = new Date()): boolean {
  const todayKey = getZonedDateKey(now, timeZone);
  return todayKey > dateYmd;
}

export function isValidIanaTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string') return false;
  if (timeZone.length > 64) return false;

  try {
    // Throws RangeError if invalid.
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

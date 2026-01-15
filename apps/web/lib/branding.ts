export const DEFAULT_BRAND_NAME = 'CoachKit';

export const DEFAULT_LOGO_URL = '/brand/coachkit-logo.png';

export const DEFAULT_DARK_LOGO_URL = '/brand/CoachKit_Dark.png';

export type BrandingPayload = {
  coachId: string | null;
  displayName: string;
  logoUrl: string | null;
  darkLogoUrl: string | null;
};

export function resolveLogoUrl(logoUrl: string | null | undefined) {
  const normalized = typeof logoUrl === 'string' ? logoUrl.trim() : '';
  return normalized ? normalized : DEFAULT_LOGO_URL;
}

export type HeaderClubBranding =
  | { type: 'logo'; logoUrl: string; darkLogoUrl: string | null; name: string }
  | { type: 'text'; name: string };

/**
 * Header-specific club branding rules:
 * - Show the club logo ONLY when a real logo exists
 * - Otherwise show the club name text ONLY
 * - Never fall back to CoachKit logo for the club slot
 */
export function getHeaderClubBranding(coachBranding: {
  displayName?: string | null;
  logoUrl?: string | null;
  darkLogoUrl?: string | null;
}): HeaderClubBranding {
  const rawName = (coachBranding.displayName ?? '').trim();
  const name = !rawName || rawName === DEFAULT_BRAND_NAME ? 'Your Club' : rawName;

  const rawLogoUrl = (coachBranding.logoUrl ?? '').trim();
  const hasRealLogo = Boolean(rawLogoUrl) && rawLogoUrl !== DEFAULT_LOGO_URL;

  const rawDarkLogoUrl = (coachBranding.darkLogoUrl ?? '').trim();
  const normalizedDarkLogoUrl = rawDarkLogoUrl || null;

  if (hasRealLogo) {
    return { type: 'logo', logoUrl: rawLogoUrl, darkLogoUrl: normalizedDarkLogoUrl, name };
  }

  return { type: 'text', name };
}

export const DEFAULT_BRANDING: BrandingPayload = {
  coachId: null,
  displayName: DEFAULT_BRAND_NAME,
  logoUrl: null,
  darkLogoUrl: null,
};

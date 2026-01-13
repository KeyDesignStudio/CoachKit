export const DEFAULT_BRAND_NAME = 'CoachKit';

export const DEFAULT_LOGO_URL = '/brand/coachkit-logo.png';

export type BrandingPayload = {
  coachId: string | null;
  displayName: string;
  logoUrl: string | null;
};

export function resolveLogoUrl(logoUrl: string | null | undefined) {
  const normalized = typeof logoUrl === 'string' ? logoUrl.trim() : '';
  return normalized ? normalized : DEFAULT_LOGO_URL;
}

export type HeaderClubBranding =
  | { type: 'logo'; logoUrl: string; name: string }
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
}): HeaderClubBranding {
  const rawName = (coachBranding.displayName ?? '').trim();
  const name = !rawName || rawName === DEFAULT_BRAND_NAME ? 'Your Club' : rawName;

  const rawLogoUrl = (coachBranding.logoUrl ?? '').trim();
  const hasRealLogo = Boolean(rawLogoUrl) && rawLogoUrl !== DEFAULT_LOGO_URL;

  if (hasRealLogo) {
    return { type: 'logo', logoUrl: rawLogoUrl, name };
  }

  return { type: 'text', name };
}

export const DEFAULT_BRANDING: BrandingPayload = {
  coachId: null,
  displayName: DEFAULT_BRAND_NAME,
  logoUrl: null,
};

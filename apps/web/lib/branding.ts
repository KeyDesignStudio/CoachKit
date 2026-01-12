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

export const DEFAULT_BRANDING: BrandingPayload = {
  coachId: null,
  displayName: DEFAULT_BRAND_NAME,
  logoUrl: null,
};

export const DEFAULT_BRAND_NAME = 'CoachKit';

export type BrandingPayload = {
  coachId: string | null;
  displayName: string;
  logoUrl: string | null;
};

export const DEFAULT_BRANDING: BrandingPayload = {
  coachId: null,
  displayName: DEFAULT_BRAND_NAME,
  logoUrl: null,
};

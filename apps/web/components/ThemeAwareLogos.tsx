'use client';

import { useResolvedTheme } from '@/lib/useResolvedTheme';

type ThemeAwareClubLogoProps = {
  logoUrl: string | null | undefined;
  darkLogoUrl: string | null | undefined;
  alt: string;
  className?: string;
};

export function ThemeAwareClubLogo({ logoUrl, darkLogoUrl, alt, className }: ThemeAwareClubLogoProps) {
  const resolvedTheme = useResolvedTheme();

  const src =
    resolvedTheme === 'dark'
      ? (darkLogoUrl || logoUrl || null)
      : (logoUrl || null);

  if (!src) return null;

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} suppressHydrationWarning />;
}

type ThemeAwareCoachKitLogoProps = {
  alt?: string;
  className?: string;
};

export function ThemeAwareCoachKitLogo({ alt = 'CoachKit', className }: ThemeAwareCoachKitLogoProps) {
  const resolvedTheme = useResolvedTheme();

  const src = resolvedTheme === 'dark' ? '/brand/CoachKit_Dark.png' : '/brand/coachkit-logo.png';

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} suppressHydrationWarning />;
}

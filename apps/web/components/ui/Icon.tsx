// Icon Component - Centralized icon rendering using Google Material Symbols
// 
// CRITICAL: This is the ONLY way to render icons in CoachKit.
// Do not import lucide-react, heroicons, or other icon libraries directly.
// All icons must be registered in iconRegistry.ts first.

import { type IconName, getIcon } from './iconRegistry';
import { cn } from '@/lib/cn';

type IconSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<IconSize, string> = {
  xs: 'text-[13px]', // ~80% of 16px
  sm: 'text-base', // 16px
  md: 'text-lg',   // 18px  
  lg: 'text-xl',   // 20px
};

const IMAGE_SIZE_CLASSES: Record<IconSize, string> = {
  xs: 'h-[13px] w-[13px]',
  sm: 'h-4 w-4',
  md: 'h-[18px] w-[18px]',
  lg: 'h-5 w-5',
};

const OPSZ_BY_SIZE: Record<IconSize, number> = {
  xs: 16,
  sm: 20,
  md: 20,
  lg: 20,
};

type IconProps = {
  name: IconName;
  size?: IconSize;
  className?: string;
  filled?: boolean;
  'aria-hidden'?: boolean;
  'aria-label'?: string;
};

export function Icon({ 
  name, 
  size = 'sm', 
  className,
  filled = false,
  'aria-hidden': ariaHidden = true,
  'aria-label': ariaLabel,
}: IconProps) {
  if (name === 'strava') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/integrations/strava-logo.svg"
        alt={ariaHidden ? '' : ariaLabel ?? 'Strava'}
        aria-hidden={ariaHidden}
        className={cn('inline-block align-middle object-contain', IMAGE_SIZE_CLASSES[size], className)}
      />
    );
  }

  if (name === 'snickersBar') {
    return (
      <span
        className={cn('inline-block align-middle bg-current', IMAGE_SIZE_CLASSES[size], className)}
        aria-hidden={ariaHidden}
        aria-label={ariaLabel ?? 'Chocolate bar'}
        style={{
          maskImage: "url('/icons/chocolate-bar.svg')",
          WebkitMaskImage: "url('/icons/chocolate-bar.svg')",
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
        }}
      />
    );
  }

  const materialSymbol = getIcon(name);
  const opsz = OPSZ_BY_SIZE[size];
  const fontSize = size === 'xs' ? '13px' : undefined;
  
  return (
    <span
      className={cn(
        'material-symbols-outlined',
        SIZE_CLASSES[size],
        className
      )}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      style={{ 
        fontSize,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 300, 'GRAD' 0, 'opsz' ${opsz}`,
      }}
    >
      {materialSymbol}
    </span>
  );
}

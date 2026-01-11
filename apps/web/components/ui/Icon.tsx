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
  'aria-hidden'?: boolean;
  'aria-label'?: string;
};

export function Icon({ 
  name, 
  size = 'sm', 
  className,
  'aria-hidden': ariaHidden = true,
  'aria-label': ariaLabel,
}: IconProps) {
  const materialSymbol = getIcon(name);
  const opsz = OPSZ_BY_SIZE[size];
  
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
        fontVariationSettings: `'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' ${opsz}`
      }}
    >
      {materialSymbol}
    </span>
  );
}

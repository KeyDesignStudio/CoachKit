import { ButtonHTMLAttributes, forwardRef } from 'react';

import { cn } from '@/lib/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

import { tokens } from './tokens';

// ... existing code ...

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border border-black bg-white text-black hover:bg-black hover:text-white active:bg-black active:text-white',
  secondary:
    'border border-black bg-white text-black hover:bg-black hover:text-white active:bg-black active:text-white',
  ghost: 'text-[var(--text)] hover:bg-[var(--bg-structure)]',
  danger:
    'border border-[#e11d48] bg-white text-[#e11d48] hover:bg-[#e11d48] hover:text-white active:bg-[#e11d48] active:text-white',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-4 py-1.5 text-sm',
  md: 'px-5 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', disabled, children, ...props },
  ref
) {
  const isBusy = props['aria-busy'] === true || props['aria-busy'] === 'true';

  return (
    <button
      ref={ref}
      className={cn(
        'relative isolate inline-flex items-center justify-center overflow-hidden font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0',
        tokens.spacing.touchTarget,
        tokens.borders.focus,
        tokens.radius.button,
        tokens.transition.default,
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      disabled={disabled}
      {...props}
    >
      {isBusy ? <span aria-hidden className="pointer-events-none absolute inset-0 origin-left animate-button-progress-fill bg-black/20" /> : null}
      <span className="relative z-[1] inline-flex items-center justify-center">{children}</span>
    </button>
  );
});

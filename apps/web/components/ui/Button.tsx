import { ButtonHTMLAttributes, forwardRef } from 'react';

import { cn } from '@/lib/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

import { tokens } from './tokens';

// ... existing code ...

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--primary)] text-white shadow-lg shadow-indigo-500/30 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0',
  secondary:
    'bg-white/70 text-[var(--text)] border border-white/40 hover:bg-white/80 backdrop-blur-xl',
  ghost: 'text-[var(--text)] hover:bg-white/30',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-4 py-1.5 text-sm',
  md: 'px-5 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0',
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
    />
  );
});

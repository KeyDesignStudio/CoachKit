import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { tokens } from './tokens';
import { Select, SelectProps } from './Select';

export type SelectFieldProps = SelectProps & {
  containerClassName?: string;
};

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { className, containerClassName, ...props },
  ref
) {
  return (
    <div className={cn('relative', containerClassName)}>
      <Select
        ref={ref}
        className={cn(
          tokens.borders.input,
          tokens.radius.input,
          'bg-[var(--bg-surface)] py-2 px-3 focus:ring-1 focus:ring-[var(--brand)]',
          className
        )}
        {...props}
      />
    </div>
  );
});

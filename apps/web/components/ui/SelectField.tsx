import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
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
        className={className}
        {...props}
      />
    </div>
  );
});

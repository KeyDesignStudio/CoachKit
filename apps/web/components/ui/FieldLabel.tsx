import { LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { tokens } from './tokens';

export type FieldLabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export function FieldLabel({ className, ...props }: FieldLabelProps) {
  return <label className={cn('block', tokens.typography.sectionLabel, 'mb-2', className)} {...props} />;
}

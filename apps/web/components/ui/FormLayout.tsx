import { ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { tokens } from './tokens';

type GridColumns = {
  base?: 1 | 2 | 3 | 4;
  md?: 1 | 2 | 3 | 4;
  lg?: 1 | 2 | 3 | 4;
  xl?: 1 | 2 | 3 | 4;
};

type GridSpan = {
  base?: 1 | 2 | 3 | 4;
  md?: 1 | 2 | 3 | 4;
  lg?: 1 | 2 | 3 | 4;
  xl?: 1 | 2 | 3 | 4;
};

const columnClassMap = {
  base: {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
  },
  md: {
    1: 'md:grid-cols-1',
    2: 'md:grid-cols-2',
    3: 'md:grid-cols-3',
    4: 'md:grid-cols-4',
  },
  lg: {
    1: 'lg:grid-cols-1',
    2: 'lg:grid-cols-2',
    3: 'lg:grid-cols-3',
    4: 'lg:grid-cols-4',
  },
  xl: {
    1: 'xl:grid-cols-1',
    2: 'xl:grid-cols-2',
    3: 'xl:grid-cols-3',
    4: 'xl:grid-cols-4',
  },
} as const;

const spanClassMap = {
  base: {
    1: 'col-span-1',
    2: 'col-span-2',
    3: 'col-span-3',
    4: 'col-span-4',
  },
  md: {
    1: 'md:col-span-1',
    2: 'md:col-span-2',
    3: 'md:col-span-3',
    4: 'md:col-span-4',
  },
  lg: {
    1: 'lg:col-span-1',
    2: 'lg:col-span-2',
    3: 'lg:col-span-3',
    4: 'lg:col-span-4',
  },
  xl: {
    1: 'xl:col-span-1',
    2: 'xl:col-span-2',
    3: 'xl:col-span-3',
    4: 'xl:col-span-4',
  },
} as const;

const maxWidthMap = {
  md: 'max-w-[768px]',
  lg: 'max-w-[1024px]',
  xl: 'max-w-[1200px]',
  '2xl': 'max-w-[1280px]',
  '3xl': 'max-w-[1400px]',
  full: 'max-w-full',
} as const;

type FormPageContainerProps = {
  children: ReactNode;
  className?: string;
  maxWidth?: keyof typeof maxWidthMap;
};

export function FormPageContainer({
  children,
  className,
  maxWidth = '2xl',
}: FormPageContainerProps) {
  return (
    <div className={cn(tokens.spacing.screenPadding, 'mx-auto w-full', maxWidthMap[maxWidth], className)}>
      {children}
    </div>
  );
}

type FormGridProps = {
  children: ReactNode;
  className?: string;
  columns?: GridColumns;
} & React.HTMLAttributes<HTMLDivElement>;

export function FormGrid({
  children,
  className,
  columns = { base: 1, md: 2, xl: 4 },
  ...props
}: FormGridProps) {
  const columnClasses = [
    columns.base ? columnClassMap.base[columns.base] : null,
    columns.md ? columnClassMap.md[columns.md] : null,
    columns.lg ? columnClassMap.lg[columns.lg] : null,
    columns.xl ? columnClassMap.xl[columns.xl] : null,
  ];

  return (
    <div className={cn('grid', tokens.spacing.gridGap, ...columnClasses, className)} {...props}>
      {children}
    </div>
  );
}

type FormFieldSpanProps = {
  children: ReactNode;
  className?: string;
  span?: GridSpan;
};

export function FormFieldSpan({ children, className, span = { base: 1 } }: FormFieldSpanProps) {
  const spanClasses = [
    span.base ? spanClassMap.base[span.base] : null,
    span.md ? spanClassMap.md[span.md] : null,
    span.lg ? spanClassMap.lg[span.lg] : null,
    span.xl ? spanClassMap.xl[span.xl] : null,
  ];

  return <div className={cn(...spanClasses, className)}>{children}</div>;
}

type FormSectionProps = {
  title: string;
  description?: string;
  className?: string;
};

export function FormSection({ title, description, className }: FormSectionProps) {
  return (
    <div className={cn('col-span-full', className)}>
      <div className={cn(tokens.typography.sectionLabel, 'mb-2')}>{title}</div>
      {description ? <p className={tokens.typography.bodyMuted}>{description}</p> : null}
      <div className={cn(tokens.borders.divider, 'mt-3')} />
    </div>
  );
}
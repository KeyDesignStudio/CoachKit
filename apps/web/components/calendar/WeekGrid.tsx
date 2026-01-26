import { ReactNode } from 'react';

type WeekGridProps = {
  children: ReactNode;
  includeSummaryColumn?: boolean;
};

export function WeekGrid({ children, includeSummaryColumn = false }: WeekGridProps) {
  return (
    <>
      {/* Mobile: Vertical day list */}
      <div className="flex flex-col gap-3 md:hidden">{children}</div>

      {/* Desktop: 7-column grid */}
      <div className={`hidden md:grid ${includeSummaryColumn ? 'md:grid-cols-8' : 'md:grid-cols-7'} gap-3`}>
        {children}
      </div>
    </>
  );
}

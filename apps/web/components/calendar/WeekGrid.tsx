import { ReactNode } from 'react';

type WeekGridProps = {
  children: ReactNode;
};

export function WeekGrid({ children }: WeekGridProps) {
  return (
    <>
      {/* Mobile: Vertical day list */}
      <div className="flex flex-col gap-3 md:hidden">{children}</div>

      {/* Desktop: 7-column grid */}
      <div className="hidden md:grid md:grid-cols-7 gap-3">{children}</div>
    </>
  );
}

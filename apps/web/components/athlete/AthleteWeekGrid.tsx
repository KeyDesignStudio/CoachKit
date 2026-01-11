import { ReactNode } from 'react';

type AthleteWeekGridProps = {
  children: ReactNode;
};

export function AthleteWeekGrid({ children }: AthleteWeekGridProps) {
  return (
    <>
      {/* Mobile: Vertical day list */}
      <div className="flex flex-col gap-3 md:hidden">{children}</div>

      {/* Desktop: 7-column grid */}
      <div className="hidden md:grid md:grid-cols-7 gap-3">{children}</div>
    </>
  );
}

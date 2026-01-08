import { ReactNode } from 'react';

type WeekGridProps = {
  children: ReactNode;
};

export function WeekGrid({ children }: WeekGridProps) {
  return (
    <>
      {/* Mobile: Vertical day list */}
      <div className="flex flex-col gap-3 md:hidden">
        {children}
      </div>
      {/* Desktop: 7-column grid */}
      <div className="hidden md:grid md:grid-cols-7 gap-0 overflow-hidden rounded-3xl border border-white/20 bg-white/40 backdrop-blur-3xl shadow-inner">
        {children}
      </div>
    </>
  );
}

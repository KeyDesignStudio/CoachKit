'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';

type TitleEventDetail = { title: string };

type MobileHeaderTitleProps = {
  defaultTitle?: string;
};

function fallbackTitleFromPath(pathname: string): string {
  if (pathname.startsWith('/coach/calendar')) return 'Calendar';
  if (pathname.startsWith('/coach/dashboard')) return 'Dashboard';
  if (pathname.startsWith('/coach/athletes')) return 'Athletes';
  if (pathname.startsWith('/coach/group-sessions')) return 'Group Sessions';
  if (pathname.startsWith('/coach/settings')) return 'Settings';

  if (pathname.startsWith('/athlete/calendar')) return 'Calendar';
  if (pathname.startsWith('/athlete/today')) return 'Today';
  if (pathname.startsWith('/athlete/workouts')) return 'Workouts';
  if (pathname.startsWith('/athlete/settings')) return 'Settings';

  return 'CoachKit';
}

export function MobileHeaderTitle({ defaultTitle }: MobileHeaderTitleProps) {
  const pathname = usePathname();
  const fallback = useMemo(() => fallbackTitleFromPath(pathname), [pathname]);
  const [title, setTitle] = useState<string>(defaultTitle ?? fallback);

  useEffect(() => {
    // Reset to route fallback on navigation; calendar pages can override via event.
    setTitle(defaultTitle ?? fallback);
  }, [defaultTitle, fallback, pathname]);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<TitleEventDetail>;
      const nextTitle = custom.detail?.title;
      if (typeof nextTitle === 'string' && nextTitle.trim()) {
        setTitle(nextTitle.trim());
      }
    };

    window.addEventListener('coachkit:mobile-header-title', handler);
    return () => window.removeEventListener('coachkit:mobile-header-title', handler);
  }, []);

  return (
    <div className="min-w-0 flex-1 text-center">
      <div className="truncate text-sm font-semibold text-[var(--text)]">{title}</div>
    </div>
  );
}

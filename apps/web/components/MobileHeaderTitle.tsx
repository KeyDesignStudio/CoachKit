'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';

import { getPageTitleFromPath } from '@/lib/mobile-header-title';

type TitleEventDetail = { title: string };

type MobileHeaderTitleProps = {
  defaultTitle?: string;
};

export function MobileHeaderTitle({ defaultTitle }: MobileHeaderTitleProps) {
  const pathname = usePathname();
  const fallback = useMemo(() => getPageTitleFromPath(pathname), [pathname]);
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
    <div className="min-w-0 flex-1 text-center" data-testid="mobile-header-title">
      <div className="truncate text-sm font-semibold text-[var(--text)]">{title}</div>
    </div>
  );
}

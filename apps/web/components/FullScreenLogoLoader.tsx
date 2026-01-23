'use client';

import { useEffect, useState } from 'react';

export function FullScreenLogoLoader({ delayMs = 200 }: { delayMs?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-label="Loading"
      aria-live="polite"
      className="fixed inset-0 z-[80] grid place-items-center bg-[var(--bg-page)] px-6 touch-none overscroll-contain"
    >
      <picture>
        <source srcSet="/brand/CoachKit_Dark.png" media="(prefers-color-scheme: dark)" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/coachkit-logo.png"
          alt=""
          className="h-[300px] w-auto max-w-[75vw] select-none object-contain"
        />
      </picture>
    </div>
  );
}

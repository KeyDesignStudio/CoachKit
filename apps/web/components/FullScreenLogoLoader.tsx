'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const FADE_IN_DELAY_MS = 80;
const FADE_IN_DURATION_MS = 180;
const FADE_OUT_DURATION_MS = 160;

export function FullScreenLogoLoader() {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const isVisibleRef = useRef(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  useEffect(() => {
    const mql = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const apply = () => setReduceMotion(Boolean(mql?.matches));
    apply();
    mql?.addEventListener?.('change', apply);
    return () => mql?.removeEventListener?.('change', apply);
  }, []);

  useEffect(() => {
    // This component being rendered means "shouldShowLoader" is true.
    if (reduceMotion) {
      setIsMounted(true);
      setIsVisible(true);
      return;
    }

    setIsMounted(true);
    setIsVisible(false);
    const timer = window.setTimeout(() => setIsVisible(true), FADE_IN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [reduceMotion]);

  // When React unmounts the loader (e.g. route finished loading), clone the overlay
  // so we can animate out before removing it.
  useLayoutEffect(() => {
    if (reduceMotion) return;

    return () => {
      // If we never became visible (e.g. very fast navigation), don't animate out.
      if (!isVisibleRef.current) return;

      const node = overlayRef.current;
      if (!node) return;

      try {
        const clone = node.cloneNode(true) as HTMLDivElement;
        clone.setAttribute('data-cloned-loader', 'true');
        clone.className = node.className;
        clone.style.opacity = '1';
        document.body.appendChild(clone);

        // Force a reflow so the transition applies.
        void clone.getBoundingClientRect();

        clone.classList.remove('opacity-100');
        clone.classList.add('opacity-0');
        clone.classList.remove('pointer-events-auto');
        clone.classList.add('pointer-events-none');
        clone.classList.remove('ease-out');
        clone.classList.add('ease-in');
        clone.style.transitionProperty = 'opacity';
        clone.style.transitionDuration = `${FADE_OUT_DURATION_MS}ms`;

        window.setTimeout(() => {
          try {
            clone.remove();
          } catch {
            // noop
          }
        }, FADE_OUT_DURATION_MS);
      } catch {
        // noop
      }
    };
  }, [reduceMotion]);

  if (!isMounted) return null;

  return (
    <div
      ref={overlayRef}
      role="status"
      aria-label="Loading"
      aria-live="polite"
      className={
        'fixed inset-0 z-[80] grid place-items-center bg-[var(--bg-page)] px-6 touch-none overscroll-contain ' +
        'transition-opacity ' +
        (isVisible
          ? `opacity-100 pointer-events-auto duration-[${FADE_IN_DURATION_MS}ms] ease-out`
          : `opacity-0 pointer-events-none duration-[${FADE_OUT_DURATION_MS}ms] ease-in`)
      }
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

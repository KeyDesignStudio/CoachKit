
'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const FADE_DURATION_MS = 450;

export function FullScreenLogoLoader() {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const isVisibleRef = useRef(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [useDarkLogo, setUseDarkLogo] = useState(false);

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
    if (typeof document === 'undefined') return;

    const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
    const compute = () => {
      const explicit = document.documentElement.getAttribute('data-theme');
      if (explicit === 'dark') return setUseDarkLogo(true);
      if (explicit === 'light') return setUseDarkLogo(false);
      return setUseDarkLogo(Boolean(mql?.matches));
    };

    compute();

    const observer = new MutationObserver(() => compute());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    mql?.addEventListener?.('change', compute);

    return () => {
      observer.disconnect();
      mql?.removeEventListener?.('change', compute);
    };
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
    const raf = window.requestAnimationFrame(() => setIsVisible(true));
    return () => window.cancelAnimationFrame(raf);
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
        document.body.appendChild(clone);

        clone.classList.remove('pointer-events-auto');
        clone.classList.add('pointer-events-none');

        const logo = clone.querySelector<HTMLImageElement>('img[data-loader-logo="true"]');
        if (!logo) return;

        logo.style.opacity = '0.25';
        logo.style.transitionProperty = 'opacity';
        logo.style.transitionDuration = `${FADE_DURATION_MS}ms`;
        logo.style.transitionTimingFunction = 'ease-in-out';

        // Force a reflow so the transition applies.
        void logo.getBoundingClientRect();
        logo.style.opacity = '0';

        window.setTimeout(() => {
          try {
            clone.remove();
          } catch {
            // noop
          }
        }, FADE_DURATION_MS);
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
        'fixed inset-0 z-[80] flex items-center justify-center bg-[var(--bg-page)] px-6 touch-none overscroll-contain ' +
        (isVisible ? 'pointer-events-auto' : 'pointer-events-none')
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        data-loader-logo="true"
        src={useDarkLogo ? '/brand/CoachKit_Dark.png' : '/brand/coachkit-logo.png'}
        alt=""
        className={
          'h-[300px] w-auto max-w-[75vw] select-none object-contain will-change-[opacity] ' +
          (reduceMotion
            ? ''
            : `transition-opacity duration-[${FADE_DURATION_MS}ms] ease-in-out`)
        }
        style={{ opacity: isVisible ? 0.25 : 0 }}
      />
    </div>
  );
}

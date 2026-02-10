import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Script from 'next/script';
import { ClerkProvider } from '@clerk/nextjs';

import '@/app/globals.css';
import { AppHeader } from '@/components/app-header';
import { BrandingProvider } from '@/components/branding-context';
import { DevAppHeader } from '@/components/dev-app-header';

export const metadata: Metadata = {
  title: 'CoachKit',
  applicationName: 'CoachKit',
  description: 'CoachKit — Training management platform for coaches and athletes.',
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/icon.png', type: 'image/png' }],
    apple: [{ url: '/icon.png', type: 'image/png' }],
  },
};

// Auth-gated app: render on-demand.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  const disableAuth =
    process.env.NODE_ENV === 'development' &&
    (process.env.DISABLE_AUTH === 'true' || process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true');

  const gitSha = process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown';
  const vercelEnv = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown';

  const content = (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,300,0,0"
        />
      </head>
      <body className="bg-[var(--bg-page)] text-[var(--text)] overflow-x-hidden">
        <Script
          id="coachkit-theme-preference"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(() => {
  try {
    const key = 'coachkit-theme';
    const pref = localStorage.getItem(key);
    const root = document.documentElement;

    if (pref === 'dark' || pref === 'light') {
      root.dataset.theme = pref;
      if (pref === 'dark') root.classList.add('dark');
      else root.classList.remove('dark');
      root.style.colorScheme = pref;
      return;
    }

    // system
    const isSystemDark = (() => {
      try {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      } catch {
        return false;
      }
    })();

    root.classList.toggle('dark', isSystemDark);
    root.style.colorScheme = isSystemDark ? 'dark' : '';
    try {
      delete root.dataset.theme;
    } catch {
      root.removeAttribute('data-theme');
    }

    // Keep in sync if OS theme changes while the app is open.
    try {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = (e) => {
        // Only react in system mode.
        const prefNow = localStorage.getItem(key);
        if (prefNow === 'dark' || prefNow === 'light') return;
        root.classList.toggle('dark', !!e.matches);
        root.style.colorScheme = e.matches ? 'dark' : '';
      };
      if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
      else if (typeof mql.addListener === 'function') mql.addListener(onChange);
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }
})();`,
          }}
        />
        <Script
          id="coachkit-build-marker"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `window.__COACHKIT_BUILD__ = { gitSha: ${JSON.stringify(gitSha)}, env: ${JSON.stringify(
              vercelEnv
            )}, builtAt: new Date().toISOString() };`,
          }}
        />
        {disableAuth ? (
          <div className="flex min-h-screen flex-col gap-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
            <DevAppHeader />
            <main className="px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] md:px-6">{children}</main>
          </div>
        ) : (
          <BrandingProvider>
            <div className="flex min-h-screen flex-col gap-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
              <AppHeader />
              <main className="px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] md:px-6">{children}</main>
            </div>
          </BrandingProvider>
        )}
      </body>
    </html>
  );

  return disableAuth ? content : <ClerkProvider>{content}</ClerkProvider>;
}

import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';

import '@/app/globals.css';
import { AppHeader } from '@/components/app-header';
import { BrandingProvider } from '@/components/branding-context';
import { DevAppHeader } from '@/components/dev-app-header';

export const metadata: Metadata = {
  title: 'CoachKit',
  description: 'CoachKit — Training management platform for coaches and athletes.',
};

// Auth-gated app: render on-demand.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  const disableAuth =
    process.env.NODE_ENV === 'development' &&
    (process.env.DISABLE_AUTH === 'true' || process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true');

  const content = (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,300,0,0"
        />
      </head>
      <body className="bg-[var(--bg-page)] text-[var(--text)] overflow-x-hidden">
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

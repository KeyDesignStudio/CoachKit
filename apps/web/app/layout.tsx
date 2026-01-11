import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';

import '@/app/globals.css';
import { AppHeader } from '@/components/app-header';
import { BrandingProvider } from '@/components/branding-context';

export const metadata: Metadata = {
  title: 'CoachKit',
  description: 'CoachKit — Training management platform for coaches and athletes.',
};

// Auth-gated app: render on-demand.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <head>
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,300,0,0"
          />
        </head>
        <body className="bg-[var(--bg-page)] text-[var(--text)]">
          <BrandingProvider>
            <div className="flex min-h-screen flex-col gap-6 pb-10">
              <AppHeader />
              <main className="px-6 pb-8">{children}</main>
            </div>
          </BrandingProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}

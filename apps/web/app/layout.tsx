import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import '@/app/globals.css';
import { UserProvider } from '@/components/user-context';
import { UserSwitcher } from '@/components/user-switcher';
import { AppHeader } from '@/components/app-header';
import { BrandingProvider } from '@/components/branding-context';

export const metadata: Metadata = {
  title: 'CoachKit',
  description: 'CoachKit — internal coaching assistant and diagnostics.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,300,0,0"
        />
      </head>
      <body className="bg-[var(--bg)] text-[var(--text)]">
        <UserProvider>
          <BrandingProvider>
            <div className="flex min-h-screen flex-col gap-6 pb-10">
              <AppHeader />
              <div className="px-6">
                <UserSwitcher />
              </div>
              <main className="px-6 pb-8">{children}</main>
            </div>
          </BrandingProvider>
        </UserProvider>
      </body>
    </html>
  );
}

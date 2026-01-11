import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

export default function DevLayout({ children }: { children: ReactNode }) {
  // DEV-ONLY: preview route, must not be available in production.
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <>{children}</>;
}

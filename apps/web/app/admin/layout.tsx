import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  try {
    await requireAdmin();
  } catch {
    redirect('/access-denied?reason=forbidden');
  }

  return <>{children}</>;
}

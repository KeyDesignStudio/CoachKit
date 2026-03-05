import type { ReactNode } from 'react';

import { AdminConsoleNav } from '@/components/admin/AdminConsoleNav';

export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AdminConsoleNav />
      {children}
    </>
  );
}
